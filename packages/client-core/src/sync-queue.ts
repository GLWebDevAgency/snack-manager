import { getStore } from './storage';
import { uuid } from './uuid';

/**
 * File de mutations persistée — le cœur de l'offline-first.
 *
 * Règle du projet : « un service complet doit fonctionner sans internet,
 * aucune commande perdue ». Toute écriture passe donc d'abord par cette file,
 * qui est écrite sur disque AVANT de tenter le réseau. Le rejeu est
 * idempotent côté serveur (upsert sur `{tenantId, clientId}` pour les
 * commandes), donc rejouer deux fois ne crée jamais de doublon.
 *
 * Invariants :
 *  - l'ordre d'émission est préservé (une commande est créée avant que son
 *    statut n'avance) ;
 *  - une entrée n'est retirée qu'après confirmation du serveur, ou après un
 *    refus définitif (4xx métier) — jamais sur une simple coupure réseau ;
 *  - une entrée qui échoue bloque celles qui la suivent pour le même sujet,
 *    afin de ne pas appliquer un changement de statut à une commande qui
 *    n'existe pas encore côté serveur.
 */

export type QueueMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface QueueEntry {
  /** Identifiant de l'entrée de file (≠ clientId métier). */
  id: string;
  method: QueueMethod;
  path: string;
  body?: unknown;
  /** Regroupe les mutations d'un même objet pour préserver leur ordre. */
  subject?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface SyncResult {
  sent: number;
  failed: number;
  remaining: number;
}

type Sender = (entry: QueueEntry) => Promise<unknown>;
type Listener = (state: QueueState) => void;

export interface QueueState {
  pending: number;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /**
   * Les mutations que le serveur a REFUSÉES définitivement, conservées.
   *
   * Elles étaient simplement retirées de la file : le commentaire disait « on
   * retire pour ne pas bloquer le service », ce qui est juste, mais retirer
   * SANS TRACE ne l'est pas. Sur une commande déjà encaissée — l'argent est
   * dans le tiroir, le client est parti avec son ticket — le refus faisait
   * disparaître la vente. Rien à l'écran ne disait laquelle, ni pourquoi.
   *
   * Bornée : une file de rejets qui gonfle indéfiniment finirait par remplir le
   * stockage de la tablette, et un service ne se relit pas sur trois cents
   * lignes. Les plus récents priment — ce sont eux qu'on peut encore rattraper.
   */
  rejected: RejectedEntry[];
}

/** Une mutation refusée, avec de quoi la retrouver et la ressaisir. */
export interface RejectedEntry {
  id: string;
  path: string;
  /** Le corps refusé — c'est lui qui permet de ressaisir la vente perdue. */
  body?: unknown;
  /** Le motif rendu par le serveur, en toutes lettres. */
  reason: string;
  status: number;
  at: number;
}

/** Au-delà, la tablette accumule sans qu'on puisse rien en faire. */
const MAX_REJECTED = 20;

const KEY = 'sm.sync.queue.v1';
const KEY_REJECTED = 'sm.sync.rejected.v1';

/** Erreur métier définitive : inutile de rejouer, on retire l'entrée. */
export class PermanentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export class SyncQueue {
  private entries: QueueEntry[] = [];
  private loaded = false;
  private syncing = false;
  private listeners = new Set<Listener>();
  private state: QueueState = {
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    rejected: [],
  };

  constructor(private readonly send: Sender) {}

  // ─── Persistance ───

  private async load() {
    if (this.loaded) return;
    const raw = await getStore().getItem(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as QueueEntry[];
        if (Array.isArray(parsed)) this.entries = parsed;
      } catch {
        // file corrompue : on repart à vide plutôt que de bloquer le service
      }
    }
    const bruts = await getStore().getItem(KEY_REJECTED);
    if (bruts) {
      try {
        const parsed = JSON.parse(bruts) as RejectedEntry[];
        if (Array.isArray(parsed)) this.state.rejected = parsed.slice(0, MAX_REJECTED);
      } catch {
        // liste corrompue : on repart à vide plutôt que de bloquer le service
      }
    }
    this.loaded = true;
    this.emit();
  }

  private async persist() {
    await getStore().setItem(KEY, JSON.stringify(this.entries));
    // Les refus survivent au redémarrage de la tablette : une vente perdue
    // découverte le lendemain matin reste une vente qu'on peut ressaisir.
    await getStore().setItem(KEY_REJECTED, JSON.stringify(this.state.rejected));
  }

  /**
   * Efface les refus — après que le gérant les a traités.
   *
   * Geste EXPLICITE et jamais automatique : un rejet qui disparaît tout seul
   * ramène exactement le défaut qu'on répare.
   */
  async acquitterRejets() {
    this.state.rejected = [];
    await this.persist();
    this.emit();
  }

  // ─── Observabilité ───

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.state = {
      pending: this.entries.length,
      syncing: this.syncing,
      lastSyncAt: this.state.lastSyncAt,
      lastError: this.state.lastError,
      rejected: this.state.rejected,
    };
    for (const l of this.listeners) l(this.state);
  }

  getState(): QueueState {
    return this.state;
  }

  async pending(): Promise<QueueEntry[]> {
    await this.load();
    return [...this.entries];
  }

  // ─── Écriture ───

  /**
   * Empile une mutation et déclenche une tentative d'envoi.
   * Retourne dès que l'entrée est persistée : l'appelant n'attend jamais
   * le réseau (mise à jour optimiste côté interface).
   */
  async enqueue(
    input: Omit<QueueEntry, 'id' | 'createdAt' | 'attempts'>,
  ): Promise<QueueEntry> {
    await this.load();
    const entry: QueueEntry = {
      ...input,
      id: uuid(),
      createdAt: Date.now(),
      attempts: 0,
    };
    this.entries.push(entry);
    await this.persist();
    this.emit();
    void this.flush();
    return entry;
  }

  /**
   * Tente d'envoyer la file. Sans réseau, les entrées restent en place.
   * Un seul passage à la fois ; les appels concurrents sont ignorés.
   */
  async flush(): Promise<SyncResult> {
    await this.load();
    if (this.syncing || this.entries.length === 0) {
      return { sent: 0, failed: 0, remaining: this.entries.length };
    }

    this.syncing = true;
    this.emit();

    let sent = 0;
    let failed = 0;
    /** Sujets bloqués par un échec : leurs mutations suivantes attendent. */
    const blocked = new Set<string>();

    for (const entry of [...this.entries]) {
      if (entry.subject && blocked.has(entry.subject)) continue;

      try {
        await this.send(entry);
        this.entries = this.entries.filter((e) => e.id !== entry.id);
        sent++;
        this.state.lastError = null;
      } catch (err) {
        if (err instanceof PermanentError) {
          // Refus métier (produit supprimé, commande déjà servie…) : rejouer ne
          // changera rien, on retire pour ne pas bloquer le service.
          //
          // Mais on CONSERVE. Sur une commande encaissée, l'argent est dans le
          // tiroir et le client est parti : la jeter en silence efface une vente
          // que plus personne ne peut retrouver. Le gérant doit pouvoir la
          // ressaisir, et pour cela la voir.
          this.entries = this.entries.filter((e) => e.id !== entry.id);
          this.state.rejected = [
            {
              id: entry.id,
              path: entry.path,
              body: entry.body,
              reason: err.message,
              status: err.status,
              at: Date.now(),
            },
            ...this.state.rejected,
          ].slice(0, MAX_REJECTED);
          failed++;
          this.state.lastError = err.message;
        } else {
          entry.attempts++;
          entry.lastError = err instanceof Error ? err.message : String(err);
          this.state.lastError = entry.lastError;
          if (entry.subject) blocked.add(entry.subject);
          failed++;
        }
      }
    }

    await this.persist();
    this.syncing = false;
    this.state.lastSyncAt = Date.now();
    this.emit();

    return { sent, failed, remaining: this.entries.length };
  }

  /** Vide la file — réservé aux outils de maintenance. */
  async clear() {
    this.entries = [];
    await this.persist();
    this.emit();
  }
}
