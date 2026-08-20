import { PermanentError, SyncQueue, type QueueEntry } from './sync-queue';
import { getStore } from './storage';

/**
 * Client API des surfaces terrain (POS / KDS).
 *
 * Lectures : réseau, avec cache local de repli (le menu doit rester
 * consultable sans internet). Écritures : toujours par la file de sync.
 *
 * ─── LE PORT DE TRANSPORT ───
 *
 * `SmClient` n'appelle plus `fetch` : il parle à un PORT (`Transport`), et
 * l'application choisit l'adaptateur. C'est l'architecture hexagonale de
 * l'ADR 0001 appliquée au dernier endroit du noyau où l'extérieur était encore
 * câblé en dur — et l'extérieur est précisément ce qui bouge.
 *
 * Deux adaptateurs existent aujourd'hui :
 *
 *   `httpTransport()`   — le réseau réel. Comportement strictement identique à
 *                         ce que ce fichier faisait avant : mêmes statuts,
 *                         mêmes messages, même distinction coupure/refus ;
 *   `demoTransport()`   — cf. `./demo` : la même API, servie depuis une
 *                         fixture, entièrement dans le navigateur du visiteur.
 *                         AUCUNE base de données n'est touchée.
 *
 * Le port porte `baseUrl` ET `path` séparément, plutôt qu'une URL déjà
 * concaténée : l'adaptateur HTTP recolle les deux, l'adaptateur de
 * démonstration aiguille sur le chemin sans avoir à défaire une chaîne.
 */

export interface TransportRequest {
  method: string;
  /** Racine de l'API — sans intérêt pour un adaptateur en mémoire. */
  baseUrl: string;
  /** Chemin relatif, requête comprise : `/orders?status=new`. */
  path: string;
  headers: Record<string, string>;
  /** Corps métier NON sérialisé : c'est l'adaptateur qui décide de l'encodage. */
  body?: unknown;
}

export interface TransportResponse {
  status: number;
  /**
   * Corps décodé. `undefined` quand il n'y en avait pas (204) ou qu'il n'était
   * pas du JSON lisible — la distinction avec un `null` JSON valide compte :
   * une lecture qui ne se décode pas doit basculer sur le cache local, pas
   * rendre `null` au poste comme si le serveur avait répondu ça.
   */
  body?: unknown;
}

export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

/**
 * Réseau injoignable — à distinguer d'un refus du serveur.
 *
 * La file de sync s'appuie sur cette différence : une coupure se rejoue, un
 * refus métier se retire. Un adaptateur qui confondrait les deux ferait perdre
 * des commandes ou bloquerait la file indéfiniment.
 */
export class TransportUnreachable extends Error {}

/** Adaptateur réseau — l'implémentation historique, inchangée. */
export function httpTransport(): Transport {
  return {
    async send({ method, baseUrl, path, headers, body }) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        throw new TransportUnreachable(
          err instanceof Error ? err.message : 'Réseau indisponible',
        );
      }
      if (res.status === 204) return { status: 204 };
      try {
        return { status: res.status, body: await res.json() };
      } catch {
        // Corps illisible : `body` reste absent, l'appelant tranche.
        return { status: res.status };
      }
    },
  };
}

export interface ApiConfig {
  baseUrl: string;
  /** Jeton staff (login par PIN) — injecté après authentification. */
  token?: string | null;
  /** Adaptateur de transport — HTTP réel par défaut. */
  transport?: Transport;
}

export class SmApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

const CACHE_PREFIX = 'sm.cache.';

/** Message d'erreur d'un corps de réponse, quand le serveur en fournit un. */
function messageOf(body: unknown, status: number): string {
  return (body as { message?: string } | null | undefined)?.message ?? `Erreur ${status}`;
}

export class SmClient {
  readonly queue: SyncQueue;
  private token: string | null;
  private readonly transport: Transport;

  constructor(private config: ApiConfig) {
    this.token = config.token ?? null;
    this.transport = config.transport ?? httpTransport();
    this.queue = new SyncQueue((entry) => this.sendQueued(entry));
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setBaseUrl(baseUrl: string) {
    this.config.baseUrl = baseUrl;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private send(method: string, path: string, body?: unknown): Promise<TransportResponse> {
    return this.transport.send({
      method,
      baseUrl: this.config.baseUrl,
      path,
      headers: this.headers(),
      ...(body === undefined ? null : { body }),
    });
  }

  /** Envoi d'une entrée de file : distingue coupure réseau et refus métier. */
  private async sendQueued(entry: QueueEntry): Promise<unknown> {
    // Réseau injoignable : `TransportUnreachable` remonte telle quelle et la
    // file garde l'entrée pour un rejeu ultérieur.
    const res = await this.send(entry.method, entry.path, entry.body);

    if (res.status >= 200 && res.status < 300) return res.body ?? null;

    const message = messageOf(res.body, res.status);

    // 5xx et 429 : incident temporaire, on rejouera.
    if (res.status >= 500 || res.status === 429) throw new Error(message);
    // 401 : le jeton a expiré — on rejouera après ré-authentification.
    if (res.status === 401) throw new Error('Session expirée');
    // Autres 4xx : refus définitif.
    throw new PermanentError(message, res.status);
  }

  // ─── Lectures avec cache de repli ───

  async get<T>(path: string, opts?: { cacheKey?: string }): Promise<T> {
    const key = opts?.cacheKey ? CACHE_PREFIX + opts.cacheKey : null;
    try {
      const res = await this.send('GET', path);
      if (res.status < 200 || res.status >= 300) {
        throw new SmApiError(messageOf(res.body, res.status), res.status, res.body);
      }
      if (res.body === undefined) {
        throw new SmApiError('Réponse illisible', res.status, undefined);
      }
      const data = res.body as T;
      if (key) await getStore().setItem(key, JSON.stringify(data));
      return data;
    } catch (err) {
      if (key) {
        const cached = await getStore().getItem(key);
        if (cached) return JSON.parse(cached) as T;
      }
      throw err;
    }
  }

  /** Lecture du cache seul (démarrage hors ligne). */
  async cached<T>(cacheKey: string): Promise<T | null> {
    const raw = await getStore().getItem(CACHE_PREFIX + cacheKey);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  // ─── Écritures (toujours par la file) ───

  post(path: string, body?: unknown, subject?: string) {
    return this.queue.enqueue({ method: 'POST', path, body, subject });
  }

  patch(path: string, body?: unknown, subject?: string) {
    return this.queue.enqueue({ method: 'PATCH', path, body, subject });
  }

  /** Écriture immédiate hors file — pour l'authentification uniquement. */
  async direct<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
    const data = res.body ?? null;
    if (res.status < 200 || res.status >= 300) {
      throw new SmApiError(messageOf(res.body, res.status), res.status, data);
    }
    return data as T;
  }
}
