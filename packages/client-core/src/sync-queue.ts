import { getStore, withStoreLock, type KeyValueStore } from './storage';
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
  /**
   * Montant local d'affichage, en centimes.
   *
   * Il reste dans la file : `SmClient` n'envoie au transport que `body`. Ce
   * nombre sans PII permet d'identifier une vente refusée après minuit ou un
   * redémarrage, sans ajouter de ligne au journal qui alimente le Z.
   */
  displayAmountCents?: number;
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
  /** Faux dès qu'un autre onglet change l'appairage durable. */
  scopeValid: boolean;
  /**
   * Les mutations que le serveur a REFUSÉES définitivement, conservées.
   *
   * Elles étaient simplement retirées de la file : le commentaire disait « on
   * retire pour ne pas bloquer le service », ce qui est juste, mais retirer
   * SANS TRACE ne l'est pas. Sur une commande déjà encaissée — l'argent est
   * dans le tiroir, le client est parti avec son ticket — le refus faisait
   * disparaître la vente. Rien à l'écran ne disait laquelle, ni pourquoi.
   *
   * Aucun refus non acquitté n'est supprimé automatiquement. L'interface peut
   * paginer les lignes, mais borner le stockage effacerait précisément les
   * ventes les plus anciennes d'un incident de masse (carte modifiée, par ex.).
   * Si le stockage est plein, le commit échoue et la mutation reste en file.
   */
  rejected: RejectedEntry[];
}

/** Une mutation refusée, avec de quoi la retrouver et la ressaisir. */
export interface RejectedEntry {
  id: string;
  path: string;
  /** Le corps refusé — c'est lui qui permet de ressaisir la vente perdue. */
  body?: unknown;
  /** Copie locale sûre du montant, jamais envoyée au serveur ni comptée au Z. */
  displayAmountCents?: number;
  /** Le motif rendu par le serveur, en toutes lettres. */
  reason: string;
  status: number;
  at: number;
}

/**
 * File et refus dans UN SEUL document.
 *
 * Deux clés rendaient impossible une transition atomique : après un refus
 * permanent, un crash pouvait survenir entre le retrait de la file et
 * l'écriture du journal des rejets. La vente n'était alors nulle part. Le
 * snapshot v2 fait de cette transition une seule écriture locale.
 */
export const SYNC_QUEUE_STORAGE_KEY = 'sm.sync.state.v2';
const LEGACY_KEY = 'sm.sync.queue.v1';
const LEGACY_REJECTED_KEY = 'sm.sync.rejected.v1';

interface PersistedQueueV2 {
  version: 2;
  /** Frontière persistée : change à chaque désappairage. */
  epoch: number;
  /** Génération opaque de l'appairage autorisée à lire et écrire la file. */
  scope: string | null;
  /** Générations clôturées : un ancien onglet ne peut jamais les réactiver. */
  retiredScopes: string[];
  /**
   * Le tombstone de file est durable, mais les caches/identité applicatifs ne
   * sont pas encore tous purgés. Aucun nouveau scope ne peut être lié avant
   * l'acquittement explicite de cette seconde phase.
   */
  purgePending: boolean;
  entries: QueueEntry[];
  rejected: RejectedEntry[];
}

/** État illisible : on échoue fermé sans écraser la matière récupérable. */
export class QueueStorageCorruptedError extends Error {
  constructor() {
    super('La file hors-ligne est illisible. Ne redémarrez pas le poste et contactez le support.');
  }
}

/** Un autre onglet a désappairé le poste : cette instance ne doit plus écrire. */
export class QueueScopeChangedError extends Error {
  constructor() {
    super("Le poste a changé d'établissement dans une autre fenêtre. Rechargez l'application.");
  }
}

/** La surface terrain n'a pas encore restauré son appairage durable. */
export class QueueScopeNotBoundError extends Error {
  constructor() {
    super("La file hors-ligne attend l'appairage de cet appareil.");
  }
}

/** Cette génération a déjà été désappairée et ne peut être ressuscitée. */
export class QueueScopeRetiredError extends QueueScopeChangedError {
  constructor() {
    super();
    this.message = "Cet appairage a été révoqué dans une autre fenêtre. Rechargez l'application.";
  }
}

/** Une purge protégée refuse d'effacer toute vente non prouvée côté serveur. */
export class QueueContainsUnsyncedDataError extends Error {
  constructor(
    readonly pending: number,
    readonly rejected: number,
  ) {
    super(
      `${pending} mutation(s) en attente et ${rejected} rejet(s) doivent être traités avant le désappairage`,
    );
  }
}

export interface SyncQueueOptions {
  /** POS/KDS : aucune mutation n'est autorisée avant restauration de l'appairage. */
  requireScope?: boolean;
}

export interface BindQueueScopeOptions {
  /** Réponse fraîche du serveur : autorise un nouveau scope sur une file vide. */
  freshPairing?: boolean;
}

export interface ClearQueueOptions {
  /** Refuse atomiquement la purge si le snapshot durable contient une vente. */
  requireEmpty?: boolean;
}

const METHODS: readonly QueueMethod[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalDisplayAmount(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function isQueueEntry(value: unknown): value is QueueEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.method === 'string' &&
    METHODS.includes(value.method as QueueMethod) &&
    typeof value.path === 'string' &&
    value.path.startsWith('/') &&
    (value.subject === undefined || typeof value.subject === 'string') &&
    isOptionalDisplayAmount(value.displayAmountCents) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.attempts === 'number' &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0 &&
    (value.lastError === undefined || typeof value.lastError === 'string')
  );
}

function isRejectedEntry(value: unknown): value is RejectedEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.path === 'string' &&
    value.path.startsWith('/') &&
    isOptionalDisplayAmount(value.displayAmountCents) &&
    typeof value.reason === 'string' &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    typeof value.at === 'number' &&
    Number.isFinite(value.at)
  );
}

function identitiesAreUnique(
  entries: readonly QueueEntry[],
  rejected: readonly RejectedEntry[] = [],
): boolean {
  const ids = new Set<string>();
  for (const item of [...entries, ...rejected]) {
    if (ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function parseArray<T>(raw: string, accepts: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(accepts)) return parsed;
  } catch {
    // Le brut reste intact dans le stockage : rien n'est réécrit après l'erreur.
  }
  throw new QueueStorageCorruptedError();
}

function parseState(raw: string): PersistedQueueV2 {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedQueueV2> | null;
    if (
      parsed?.version === 2 &&
      (parsed.epoch === undefined ||
        (typeof parsed.epoch === 'number' &&
          Number.isInteger(parsed.epoch) &&
          parsed.epoch >= 0)) &&
      (parsed.scope === undefined ||
        parsed.scope === null ||
        (typeof parsed.scope === 'string' && parsed.scope.length > 0)) &&
      (parsed.retiredScopes === undefined ||
        (Array.isArray(parsed.retiredScopes) &&
          parsed.retiredScopes.every(
            (scope): scope is string => typeof scope === 'string' && scope.length > 0,
          ) &&
          new Set(parsed.retiredScopes).size === parsed.retiredScopes.length)) &&
      (parsed.purgePending === undefined || typeof parsed.purgePending === 'boolean') &&
      Array.isArray(parsed.entries) &&
      parsed.entries.every(isQueueEntry) &&
      Array.isArray(parsed.rejected) &&
      parsed.rejected.every(isRejectedEntry) &&
      identitiesAreUnique(parsed.entries, parsed.rejected)
    ) {
      return {
        version: 2,
        // Les snapshots v2 déjà déployés précèdent la frontière persistée.
        epoch: parsed.epoch ?? 0,
        scope: parsed.scope ?? null,
        retiredScopes: parsed.retiredScopes ?? [],
        // Les snapshots v2 antérieurs à la purge biphasée étaient complets.
        purgePending: parsed.purgePending ?? false,
        entries: parsed.entries,
        rejected: parsed.rejected,
      };
    }
  } catch {
    // Même politique que pour l'ancien format : conserver le brut, refuser.
  }
  throw new QueueStorageCorruptedError();
}

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
  /** Hydratation single-flight : deux premiers appels ne relisent jamais deux fois le disque. */
  private loadPromise: Promise<void> | null = null;
  /** Commit local court partagé par enqueue, flush, acquittement et purge. */
  private mutationTail: Promise<void> = Promise.resolve();
  /** Une migration v1 réussie nettoie ensuite physiquement son ancien brut. */
  private legacyCleanupPending = false;
  /** Génération durable partagée par tous les onglets du poste. */
  private storageEpoch = 0;
  /** Génération d'appairage validée contre le snapshot durable. */
  private boundScope: string | null = null;
  private retiredScopes: string[] = [];
  /** Bloque tout réappairage entre le clear de file et la purge des caches. */
  private purgePending = false;
  /** Liaison single-flight, publiée avant toute lecture du stockage. */
  private activeBinding: Promise<void> | null = null;
  private bindingTarget: string | null = null;
  /** Passage réseau courant ; `clear()` le clôture par génération puis le détache. */
  private activeFlush: Promise<SyncResult> | null = null;
  /** `clear()` est lui aussi single-flight : deux appelants attendent la même purge. */
  private activeClear: Promise<void> | null = null;
  /** Refuse tout nouveau geste pendant le désappairage. */
  private clearing = false;
  /** Une génération durable différente a été vue dans un autre onglet. */
  private scopeInvalidated = false;
  /**
   * Frontière d'établissement.
   *
   * Incrémentée SYNCHRONIQUEMENT dès `clear()` : un envoi A déjà parti peut
   * finir, mais aucune entrée A suivante ne sera envoyée avec le jeton B que
   * l'application vient d'adopter.
   */
  private generation = 0;
  private syncing = false;
  private listeners = new Set<Listener>();
  private state: QueueState = {
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    scopeValid: true,
    rejected: [],
  };

  constructor(
    private readonly send: Sender,
    private readonly options: SyncQueueOptions = {},
  ) {
    globalThis.addEventListener?.('storage', (event: Event) => {
      const key = (event as StorageEvent).key;
      if (key !== SYNC_QUEUE_STORAGE_KEY || !this.loaded || this.boundScope === null) return;
      void this.observeExternalScopeChange();
    });
  }

  private async observeExternalScopeChange(): Promise<void> {
    if (this.scopeInvalidated || this.clearing || this.boundScope === null) return;
    try {
      await this.assertDurableScope();
    } catch (error) {
      if (error instanceof QueueScopeChangedError) return;
      this.invalidateScope();
    }
  }

  // ─── Persistance ───

  private async readDurableState(): Promise<{
    entries: QueueEntry[];
    rejected: RejectedEntry[];
    epoch: number;
    scope: string | null;
    retiredScopes: string[];
    purgePending: boolean;
    legacy: boolean;
  }> {
    const store = getStore();
    const raw = await store.getItem(SYNC_QUEUE_STORAGE_KEY);

    if (raw !== null) {
      const parsed = parseState(raw);
      // Un v2 peut avoir été durable juste avant qu'un crash/refus de stockage
      // empêche le nettoyage v1. Vérifier leur existence permet au reboot de
      // reprendre l'effacement des anciens corps/PII au prochain commit.
      const [legacyEntries, legacyRejected] = await Promise.all([
        store.getItem(LEGACY_KEY),
        store.getItem(LEGACY_REJECTED_KEY),
      ]);
      return {
        ...parsed,
        legacy: legacyEntries !== null || legacyRejected !== null,
      };
    }

    // Migration paresseuse : une tablette déjà en service garde sa file v1.
    // Le premier changement réussi l'écrira ensuite atomiquement en v2.
    const [legacyEntries, legacyRejected] = await Promise.all([
      store.getItem(LEGACY_KEY),
      store.getItem(LEGACY_REJECTED_KEY),
    ]);
    const entries =
      legacyEntries === null ? [] : parseArray<QueueEntry>(legacyEntries, isQueueEntry);
    const rejected =
      legacyRejected === null
        ? []
        : parseArray<RejectedEntry>(legacyRejected, isRejectedEntry);
    if (!identitiesAreUnique(entries, rejected)) throw new QueueStorageCorruptedError();
    return {
      entries,
      rejected,
      epoch: 0,
      scope: null,
      retiredScopes: [],
      purgePending: false,
      legacy: legacyEntries !== null || legacyRejected !== null,
    };
  }

  private async hydrate() {
    const durable = await withStoreLock(() => this.readDurableState());
    if (this.boundScope !== null && durable.scope !== this.boundScope) {
      throw this.invalidateScope();
    }
    this.entries = durable.entries;
    this.state.rejected = durable.rejected;
    this.storageEpoch = durable.epoch;
    // Les consommateurs génériques restent compatibles ; les surfaces terrain
    // passent, elles, obligatoirement par `bindScope` avant cette hydratation.
    this.boundScope = durable.scope;
    this.retiredScopes = durable.retiredScopes;
    this.purgePending = durable.purgePending;
    this.legacyCleanupPending = durable.legacy;

    this.loaded = true;
    this.emit();
  }

  /** Relecture obligatoire sous verrou avant tout read-modify-write. */
  private async refreshBeforeMutation(): Promise<void> {
    const durable = await this.readDurableState();
    if (durable.epoch !== this.storageEpoch || durable.scope !== this.boundScope) {
      throw this.invalidateScope();
    }
    this.entries = durable.entries;
    this.state.rejected = durable.rejected;
    this.retiredScopes = durable.retiredScopes;
    this.purgePending = durable.purgePending;
    this.legacyCleanupPending = this.legacyCleanupPending || durable.legacy;
  }

  private invalidateScope(
    error: QueueScopeChangedError = new QueueScopeChangedError(),
  ): QueueScopeChangedError {
    if (!this.scopeInvalidated) {
      this.scopeInvalidated = true;
      this.generation += 1;
      this.syncing = false;
      this.state.lastError = error.message;
      this.emit();
    }
    return error;
  }

  /** Contrôle inter-onglets sans garder le verrou pendant le réseau. */
  private async assertDurableScope(): Promise<void> {
    await withStoreLock(() => this.assertDurableScopeUnlocked());
  }

  private async assertDurableScopeUnlocked(): Promise<void> {
    if (this.scopeInvalidated) throw new QueueScopeChangedError();
    const durable = await this.readDurableState();
    if (
      this.boundScope !== null &&
      durable.scope !== this.boundScope &&
      durable.retiredScopes.includes(this.boundScope)
    ) {
      throw this.invalidateScope(new QueueScopeRetiredError());
    }
    if (durable.epoch !== this.storageEpoch || durable.scope !== this.boundScope) {
      throw this.invalidateScope();
    }
  }

  private async ensureScopeReady(): Promise<void> {
    if (this.scopeInvalidated) throw new QueueScopeChangedError();
    if (!this.options.requireScope) return;
    if (this.activeBinding) await this.activeBinding;
    if (this.boundScope === null) throw new QueueScopeNotBoundError();
  }

  private async ensureBoundScopeReady(): Promise<void> {
    if (this.scopeInvalidated) throw new QueueScopeChangedError();
    if (this.activeBinding) await this.activeBinding;
    if (this.clearing) throw new QueueScopeChangedError();
    if (this.boundScope === null) throw new QueueScopeNotBoundError();
  }

  /**
   * Stockage métier protégé par la même frontière que la file réseau.
   * Chaque lecture/écriture revalide le scope durable SOUS le verrou partagé :
   * un vieil onglet A ne peut donc rien réécrire après le passage à B.
   */
  scopedStore(): KeyValueStore {
    const run = async <T>(work: (store: KeyValueStore) => Promise<T>): Promise<T> => {
      await this.ensureBoundScopeReady();
      const expectedScope = this.boundScope;
      const expectedEpoch = this.storageEpoch;
      const expectedGeneration = this.generation;
      if (expectedScope === null) throw new QueueScopeNotBoundError();
      return withStoreLock(async () => {
        // Ne jamais comparer avec le scope COURANT après l'attente du verrou :
        // clear/bind a pu le remplacer entre-temps. C'est l'autorité capturée
        // par l'appelant A qui doit encore être vraie au moment du commit.
        if (
          this.clearing ||
          this.scopeInvalidated ||
          this.generation !== expectedGeneration ||
          this.boundScope !== expectedScope ||
          this.storageEpoch !== expectedEpoch
        ) {
          throw new QueueScopeChangedError();
        }
        const durable = await this.readDurableState();
        if (durable.epoch !== expectedEpoch || durable.scope !== expectedScope) {
          const error = durable.retiredScopes.includes(expectedScope)
            ? new QueueScopeRetiredError()
            : new QueueScopeChangedError();
          throw this.invalidateScope(error);
        }
        return work(getStore());
      });
    };
    return {
      getItem: (key) => run((store) => store.getItem(key)),
      setItem: (key, value) => run((store) => store.setItem(key, value)),
      removeItem: (key) => run((store) => store.removeItem(key)),
      mutateItem: (key, mutate) =>
        run(async (store) => {
          const mutation = await mutate(await store.getItem(key));
          if (mutation.value === null) await store.removeItem(key);
          else await store.setItem(key, mutation.value);
          return mutation.result;
        }),
    };
  }

  private async load() {
    if (this.loaded) return;
    if (!this.loadPromise) this.loadPromise = this.hydrate();

    const attempt = this.loadPromise;
    try {
      await attempt;
    } catch (error) {
      // Une panne passagère de stockage peut être retentée. Une corruption
      // restera, elle, bloquante tant que son brut n'a pas été récupéré.
      if (this.loadPromise === attempt) this.loadPromise = null;
      throw error;
    }
  }

  private async persistSnapshot(
    entries: QueueEntry[],
    rejected: RejectedEntry[],
    epoch = this.storageEpoch,
    scope = this.boundScope,
    retiredScopes = this.retiredScopes,
    purgePending = this.purgePending,
  ): Promise<void> {
    const snapshot = JSON.stringify({
      version: 2,
      epoch,
      scope,
      retiredScopes,
      purgePending,
      entries,
      rejected,
    } satisfies PersistedQueueV2);
    const store = getStore();
    await store.setItem(SYNC_QUEUE_STORAGE_KEY, snapshot);

    if (this.legacyCleanupPending) {
      try {
        // Le v2 est déjà durable : un échec de nettoyage ne transforme pas un
        // enqueue réussi en faux échec. Il sera retenté au prochain commit.
        await store.setItem(LEGACY_KEY, '[]');
        await store.setItem(LEGACY_REJECTED_KEY, '[]');
        await store.removeItem(LEGACY_KEY);
        await store.removeItem(LEGACY_REJECTED_KEY);
        this.legacyCleanupPending = false;
      } catch {
        // Le clear explicite, lui, exigera au minimum l'écrasement des bruts.
      }
    }
  }

  /**
   * Lie la file à une génération locale d'appairage, jamais au jeton secret.
   *
   * Un scope retiré n'est jamais réactivable. Un appairage serveur frais crée
   * toujours un nouvel UUID local ; la restauration ordinaire d'un vieil
   * onglet échoue donc fermée, même après un crash intermédiaire.
   */
  bindScope(scope: string, options: BindQueueScopeOptions = {}): Promise<void> {
    const normalized = scope.trim();
    if (!normalized || normalized.length > 200) {
      return Promise.reject(new Error("Identifiant d'appairage invalide"));
    }
    if (this.scopeInvalidated) return Promise.reject(new QueueScopeChangedError());
    if (this.activeBinding) {
      if (this.bindingTarget === normalized) return this.activeBinding;
      return this.activeBinding.then(() => this.bindScope(normalized, options));
    }
    if (this.boundScope === normalized) return this.assertDurableScope();
    if (this.boundScope !== null && !options.freshPairing) {
      return Promise.reject(new QueueScopeChangedError());
    }

    this.bindingTarget = normalized;
    const lifecycle = this.runBindScope(normalized, options.freshPairing === true);
    const operation = lifecycle.finally(() => {
      if (this.activeBinding === operation) {
        this.activeBinding = null;
        this.bindingTarget = null;
      }
    });
    this.activeBinding = operation;
    return operation;
  }

  private async runBindScope(scope: string, freshPairing: boolean): Promise<void> {
    await this.mutationTail;
    await this.mutate(async () => {
      const durable = await this.readDurableState();
      const hasMatter = durable.entries.length > 0 || durable.rejected.length > 0;

      if (durable.retiredScopes.includes(scope)) {
        throw new QueueScopeRetiredError();
      }
      if (durable.purgePending) {
        // La file A est déjà tombstonée, mais son cache métier peut encore
        // exister. Autoriser B ici rendrait ces données lisibles sous B.
        throw new QueueScopeChangedError();
      }
      if (durable.scope !== null && durable.scope !== scope) {
        // Changer de génération sans un clear réussi ferait passer les ventes
        // ou caches UI de A sous le jeton B. Même une file vide et un appairage
        // serveur frais exigent donc le clear explicite de l'ancien tenant.
        throw new QueueScopeChangedError();
      }
      if (freshPairing && durable.scope === null && hasMatter) {
        // Seule exception : migration d'un snapshot ancien avec l'appairage
        // existant, qui utilise `freshPairing = false` et revendique sa matière.
        throw new QueueScopeChangedError();
      }

      const nextRetired = [...durable.retiredScopes];
      if (durable.scope !== null && durable.scope !== scope && !nextRetired.includes(durable.scope)) {
        nextRetired.push(durable.scope);
      }
      this.legacyCleanupPending = this.legacyCleanupPending || durable.legacy;
      if (durable.scope !== scope || durable.legacy) {
        await this.persistSnapshot(
          durable.entries,
          durable.rejected,
          durable.epoch,
          scope,
          nextRetired,
        );
      }

      this.entries = durable.entries;
      this.state.rejected = durable.rejected;
      this.storageEpoch = durable.epoch;
      this.boundScope = scope;
      this.retiredScopes = nextRetired;
      this.purgePending = false;
      this.loaded = true;
      this.loadPromise = Promise.resolve();
      this.emit();
    }, { refresh: false });
  }

  private mutate<T>(work: () => Promise<T>, options?: { refresh?: boolean }): Promise<T> {
    const operation = this.mutationTail.then(() =>
      withStoreLock(async () => {
        if (options?.refresh !== false) await this.refreshBeforeMutation();
        return work();
      }),
    );
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /**
   * Efface les refus — après que le gérant les a traités.
   *
   * Geste EXPLICITE et jamais automatique : un rejet qui disparaît tout seul
   * ramène exactement le défaut qu'on répare.
   */
  async acquitterRejets(idsAffiches?: readonly string[]) {
    await this.ensureScopeReady();
    await this.load();
    if (this.clearing) throw new Error('Réinitialisation du poste en cours');
    const ids = new Set(idsAffiches ?? this.state.rejected.map((entry) => entry.id));

    try {
      await this.mutate(async () => {
        if (this.clearing) throw new Error('Réinitialisation du poste en cours');
        const nextRejected = this.state.rejected.filter((entry) => !ids.has(entry.id));
        await this.persistSnapshot(this.entries, nextRejected);
        this.state.rejected = nextRejected;
        this.emit();
      });
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
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
      scopeValid: !this.scopeInvalidated,
      rejected: this.state.rejected,
    };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Une vue défaillante ne doit jamais figer la file qui protège les ventes.
      }
    }
  }

  getState(): QueueState {
    return this.state;
  }

  async pending(): Promise<QueueEntry[]> {
    await this.ensureScopeReady();
    await this.load();
    await this.mutate(async () => this.emit());
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
    await this.ensureScopeReady();
    if (this.clearing) throw new Error('Réinitialisation du poste en cours');
    await this.load();
    if (!isOptionalDisplayAmount(input.displayAmountCents)) {
      throw new TypeError(
        "Le montant local d'affichage doit être un entier non négatif en centimes",
      );
    }
    const entry: QueueEntry = {
      ...input,
      id: uuid(),
      createdAt: Date.now(),
      attempts: 0,
    };

    try {
      await this.mutate(async () => {
        if (this.clearing) throw new Error('Réinitialisation du poste en cours');
        // Une collision UUID est astronomiquement improbable, mais la traiter
        // comme une corruption est indispensable : les résultats de flush sont
        // indexés par identité et ne doivent jamais retirer deux mutations.
        if (
          this.entries.some((current) => current.id === entry.id) ||
          this.state.rejected.some((current) => current.id === entry.id)
        ) {
          throw new QueueStorageCorruptedError();
        }
        const nextEntries = [...this.entries, entry];
        await this.persistSnapshot(nextEntries, this.state.rejected);
        // Publication APRÈS le commit : tout ce qui est visible est durable.
        this.entries = nextEntries;
        this.emit();
      });
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }

    void this.flush().catch(() => undefined);
    return entry;
  }

  /**
   * Tente d'envoyer la file. Sans réseau, les entrées restent en place.
   * Un seul passage à la fois ; les appels concurrents sont ignorés.
   */
  flush(): Promise<SyncResult> {
    if (this.scopeInvalidated) return Promise.reject(new QueueScopeChangedError());
    // La promesse est publiée AVANT le premier `await`. Deux appels dans le
    // même tour JavaScript partagent donc réellement le même passage réseau :
    // aucune fenêtre d'hydratation ne peut laisser partir deux fois la vente.
    if (this.activeFlush) return this.activeFlush;

    const lifecycle = this.runFlushLifecycle();
    const operation = lifecycle.finally(() => {
      if (this.activeFlush === operation) this.activeFlush = null;
    });
    this.activeFlush = operation;
    return operation;
  }

  private async runFlushLifecycle(): Promise<SyncResult> {
    await this.ensureScopeReady();
    await this.load();
    // Toute mutation locale déjà engagée doit avoir fini son commit avant que
    // le réseau puisse photographier la file.
    await this.mutationTail;
    // Un autre onglet peut avoir ajouté une vente puis disparu. Le disque est
    // l'autorité : le survivant la reprend avant de décider que la file est vide.
    await this.mutate(async () => this.emit());
    if (this.clearing) return { sent: 0, failed: 0, remaining: this.entries.length };
    const eligible = [...this.entries];
    if (eligible.length === 0) {
      return { sent: 0, failed: 0, remaining: this.entries.length };
    }

    this.syncing = true;
    this.emit();

    return this.runFlush(eligible, this.generation);
  }

  private async runFlush(eligible: QueueEntry[], generation: number): Promise<SyncResult> {
    let sent = 0;
    let failed = 0;
    let lastError: string | null = this.state.lastError;
    const outcomes = new Map<
      string,
      | { kind: 'sent' }
      | { kind: 'temporary'; error: string }
      | { kind: 'permanent'; rejected: RejectedEntry }
    >();
    /** Sujets bloqués par un échec : leurs mutations suivantes attendent. */
    const blocked = new Set<string>();

    try {
      for (const entry of eligible) {
        if (generation !== this.generation) break;
        await this.assertDurableScope();
        if (entry.subject && blocked.has(entry.subject)) continue;

        try {
          await this.send(entry);
          // `clear()` a pu être appelé PENDANT le réseau. Le premier appel a
          // utilisé ses en-têtes déjà construits ; le suivant ne doit jamais
          // reconstruire des en-têtes avec le nouveau tenant.
          if (generation !== this.generation) break;
          await this.assertDurableScope();
          outcomes.set(entry.id, { kind: 'sent' });
          sent++;
          lastError = null;
        } catch (err) {
          // Une invalidation inter-onglets est une frontière de sécurité, pas
          // une panne du sender à journaliser comme mutation temporaire.
          if (err instanceof QueueScopeChangedError) throw err;
          if (generation !== this.generation) break;
          await this.assertDurableScope();
          if (err instanceof PermanentError) {
            // Refus métier (produit supprimé, commande déjà servie…) : rejouer ne
            // changera rien, on retire pour ne pas bloquer le service.
            //
            // Mais on CONSERVE. Sur une commande encaissée, l'argent est dans le
            // tiroir et le client est parti : la jeter en silence efface une vente
            // que plus personne ne peut retrouver. Le gérant doit pouvoir la
            // ressaisir, et pour cela la voir.
            outcomes.set(entry.id, {
              kind: 'permanent',
              rejected: {
                id: entry.id,
                path: entry.path,
                body: entry.body,
                ...(entry.displayAmountCents === undefined
                  ? null
                  : { displayAmountCents: entry.displayAmountCents }),
                reason: err.message,
                status: err.status,
                at: Date.now(),
              },
            });
            failed++;
            lastError = err.message;
          } else {
            const message = err instanceof Error ? err.message : String(err);
            outcomes.set(entry.id, { kind: 'temporary', error: message });
            lastError = message;
            if (entry.subject) blocked.add(entry.subject);
            failed++;
          }
        }
      }

      if (generation !== this.generation) {
        return { sent, failed, remaining: this.entries.length };
      }
      let remaining = this.entries.length;
      await this.mutate(async () => {
        if (generation !== this.generation) return;

        const nextEntries: QueueEntry[] = [];
        const newRejected: RejectedEntry[] = [];
        for (const entry of this.entries) {
          const outcome = outcomes.get(entry.id);
          if (!outcome) {
            nextEntries.push(entry);
          } else if (outcome.kind === 'temporary') {
            nextEntries.push({
              ...entry,
              attempts: entry.attempts + 1,
              lastError: outcome.error,
            });
          } else if (outcome.kind === 'permanent') {
            newRejected.unshift(outcome.rejected);
          }
          // `sent` et `permanent` quittent la file dans le snapshot candidat.
        }
        // La rétention appartient au geste explicite du gérant. Un `slice`
        // ici ferait disparaître les premières ventes d'un incident >20.
        const nextRejected = [...newRejected, ...this.state.rejected];
        await this.persistSnapshot(nextEntries, nextRejected);
        if (generation !== this.generation) return;

        this.entries = nextEntries;
        this.state.rejected = nextRejected;
        this.state.lastError = lastError;
        this.state.lastSyncAt = Date.now();
        remaining = nextEntries.length;
      });

      return { sent, failed, remaining };
    } catch (error) {
      // La mémoire n'a pas encore été publiée : elle reste exactement sur le
      // dernier snapshot durable et l'appel suivant peut tout rejouer.
      this.state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Même un disque plein ne peut laisser la file figée en « synchronisation ».
      // Un ancien flush détaché ne doit cependant pas éteindre l'indicateur du
      // nouveau tenant qui synchronise déjà sa propre file.
      if (generation === this.generation) {
        this.syncing = false;
        this.emit();
      }
    }
  }

  /**
   * Vide la file ET les rejets — appelé au désappairage de l'appareil.
   *
   * Les rejets partent avec : ils portent le corps de ventes d'un
   * établissement, et les laisser les ferait apparaître chez le suivant.
   */
  clear(options: ClearQueueOptions = {}): Promise<void> {
    if (this.scopeInvalidated) return Promise.reject(new QueueScopeChangedError());
    if (this.options.requireScope && this.boundScope === null) {
      return Promise.reject(new QueueScopeNotBoundError());
    }
    if (this.activeClear) return this.activeClear;
    // Doit précéder le premier `await` et même l'affectation `clearing` : la
    // boucle réseau voit la frontière dès l'appel, pas après son réveil.
    this.generation += 1;
    this.clearing = true;
    // Le vieux sender est désormais clôturé par `generation`. On le détache :
    // un fetch qui ne répond jamais ne peut pas bloquer le désappairage, et son
    // résultat tardif ne pourra ni committer ni lancer l'entrée suivante.
    this.activeFlush = null;

    const operation = this.runClear(options.requireEmpty === true).finally(() => {
      if (this.activeClear === operation) this.activeClear = null;
    });
    this.activeClear = operation;
    return operation;
  }

  private async runClear(requireEmpty: boolean): Promise<void> {
    try {
      // Une corruption ne doit pas empêcher un désappairage volontaire : on
      // attend seulement la lecture pour qu'elle ne repeuple plus la mémoire.
      await this.load().catch(() => undefined);
      await this.mutationTail;

      await this.mutate(async () => {
        const store = getStore();
        const retiringScope = this.boundScope;
        let nextEpoch = this.storageEpoch + 1;
        const currentRaw = await store.getItem(SYNC_QUEUE_STORAGE_KEY);
        if (currentRaw !== null) {
          let current: PersistedQueueV2 | null = null;
          try {
            current = parseState(currentRaw);
          } catch (error) {
            // Une purge volontaire reste autorisée sur un brut corrompu.
            // Une purge protégée, elle, ne peut pas prouver l'absence de vente
            // et doit donc échouer fermée.
            if (requireEmpty || !(error instanceof QueueStorageCorruptedError)) throw error;
          }
          if (current) {
            // Un ancien onglet n'a aucune autorité pour vider la file créée
            // après le réappairage d'un autre onglet.
            if (
              current.epoch !== this.storageEpoch ||
              current.scope !== retiringScope
            ) {
              throw this.invalidateScope();
            }
            if (
              requireEmpty &&
              (current.entries.length > 0 || current.rejected.length > 0)
            ) {
              throw new QueueContainsUnsyncedDataError(
                current.entries.length,
                current.rejected.length,
              );
            }
            nextEpoch = current.epoch + 1;
          }
        } else if (this.storageEpoch !== 0 || retiringScope !== null) {
          throw this.invalidateScope();
        } else if (requireEmpty) {
          // Migration v1 : l'absence de snapshot v2 ne prouve pas que les
          // anciennes clés soient vides.
          const durable = await this.readDurableState();
          if (durable.entries.length > 0 || durable.rejected.length > 0) {
            throw new QueueContainsUnsyncedDataError(
              durable.entries.length,
              durable.rejected.length,
            );
          }
        }
        // Écrasement strict avant publication : même si removeItem est refusé,
        // les anciennes clés ne contiennent déjà plus aucune PII.
        await store.setItem(LEGACY_KEY, '[]');
        await store.setItem(LEGACY_REJECTED_KEY, '[]');
        const nextRetired = [...this.retiredScopes];
        if (retiringScope !== null && !nextRetired.includes(retiringScope)) {
          nextRetired.push(retiringScope);
        }
        const purgePending = this.options.requireScope === true;
        await this.persistSnapshot([], [], nextEpoch, null, nextRetired, purgePending);

        this.entries = [];
        this.state.rejected = [];
        this.storageEpoch = nextEpoch;
        this.boundScope = null;
        this.retiredScopes = nextRetired;
        this.purgePending = purgePending;
        this.state.lastError = null;
        this.syncing = false;
        this.loaded = true;
        this.loadPromise = Promise.resolve();
        this.legacyCleanupPending = false;
        this.emit();

        // Suppression physique opportuniste ; l'écrasement précédent porte la
        // garantie de confidentialité si le navigateur bloque removeItem.
        await store.removeItem(LEGACY_KEY).catch(() => undefined);
        await store.removeItem(LEGACY_REJECTED_KEY).catch(() => undefined);
      }, { refresh: false });
      // Une file générique n'a pas de caches locataire à purger. POS/KDS
      // restent volontairement fermés jusqu'à `completeClear()`.
      if (!this.purgePending) this.clearing = false;
    } catch (error) {
      if (error instanceof QueueContainsUnsyncedDataError) {
        // Refus attendu et non destructif : la file reste exploitable pour
        // retenter sa synchronisation ou traiter ses rejets.
        this.clearing = false;
        this.syncing = false;
      }
      // Tant que la purge n'est pas durable, le poste reste volontairement
      // bloqué : il ne peut pas être réappairé à un autre restaurant.
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
  }

  /**
   * Acquitte la purge des caches/identité effectuée par POS ou KDS.
   *
   * `clear()` publie d'abord un tombstone `purgePending`. L'application purge
   * ensuite ses clés avec l'identité en dernier, puis appelle cette méthode.
   * Le petit intervalle entre les deux reste sûr : tout appairage frais y est
   * refusé. L'opération est idempotente pour permettre une reprise après crash.
   */
  async completeClear(): Promise<void> {
    await this.mutationTail;
    await this.mutate(async () => {
      const durable = await this.readDurableState();
      if (durable.scope !== null) throw new QueueScopeChangedError();
      if (!durable.purgePending) {
        this.clearing = false;
        return;
      }

      await this.persistSnapshot(
        durable.entries,
        durable.rejected,
        durable.epoch,
        null,
        durable.retiredScopes,
        false,
      );
      this.entries = durable.entries;
      this.state.rejected = durable.rejected;
      this.storageEpoch = durable.epoch;
      this.boundScope = null;
      this.retiredScopes = durable.retiredScopes;
      this.purgePending = false;
      this.loaded = true;
      this.loadPromise = Promise.resolve();
      this.clearing = false;
      this.emit();
    }, { refresh: false });
  }
}
