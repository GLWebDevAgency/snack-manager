import { PermanentError, SyncQueue, type QueueEntry } from './sync-queue';
import { getStore } from './storage';

/**
 * Client API des surfaces terrain (POS / KDS).
 *
 * Lectures : réseau, avec cache local de repli (le menu doit rester
 * consultable sans internet). Écritures : toujours par la file de sync.
 */

export interface ApiConfig {
  baseUrl: string;
  /** Jeton staff (login par PIN) — injecté après authentification. */
  token?: string | null;
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

export class SmClient {
  readonly queue: SyncQueue;
  private token: string | null;

  constructor(private config: ApiConfig) {
    this.token = config.token ?? null;
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

  /** Envoi d'une entrée de file : distingue coupure réseau et refus métier. */
  private async sendQueued(entry: QueueEntry): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${entry.path}`, {
        method: entry.method,
        headers: this.headers(),
        body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
      });
    } catch (err) {
      // Réseau injoignable : on garde l'entrée pour un rejeu ultérieur.
      throw new Error(err instanceof Error ? err.message : 'Réseau indisponible');
    }

    if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);

    const body = await res.json().catch(() => null);
    const message =
      (body as { message?: string } | null)?.message ?? `Erreur ${res.status}`;

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
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        headers: this.headers(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new SmApiError(
          (body as { message?: string } | null)?.message ?? `Erreur ${res.status}`,
          res.status,
          body,
        );
      }
      const data = (await res.json()) as T;
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
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new SmApiError(
        (data as { message?: string } | null)?.message ?? `Erreur ${res.status}`,
        res.status,
        data,
      );
    }
    return data as T;
  }
}
