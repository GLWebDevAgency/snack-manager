import { createHash, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

/**
 * Deux fenêtres glissantes réservées dans UNE commande Redis : la rotation de
 * l'identité client ne peut jamais contourner la borne globale et toutes les
 * répliques consomment le même budget.
 */
const RESERVE_SHARED_QUOTA = `
local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local window = tonumber(ARGV[1])
local client_limit = tonumber(ARGV[2])
local global_limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)

local client_count = redis.call('ZCARD', KEYS[1])
local global_count = redis.call('ZCARD', KEYS[2])
if client_count >= client_limit or global_count >= global_limit then
  return { 0, client_count, global_count }
end

redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('ZADD', KEYS[2], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window + 1000)
redis.call('PEXPIRE', KEYS[2], window + 1000)
return { 1, client_count + 1, global_count + 1 }
`;

/**
 * Fenêtre client seule. Elle complète, sans la remplacer, une réservation
 * source+globale déjà passée par l'appelant. C'est utile lorsqu'une route doit
 * aussi borner une dimension tenant ou secret : lui donner un second plafond
 * global créerait une nouvelle cible de déni de service, contournable en
 * faisant varier cette dimension.
 */
const RESERVE_CLIENT_QUOTA = `
local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local window = tonumber(ARGV[1])
local client_limit = tonumber(ARGV[2])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local client_count = redis.call('ZCARD', KEYS[1])
if client_count >= client_limit then
  return { 0, client_count }
end

redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window + 1000)
return { 1, client_count + 1 }
`;

export type PublicQuotaReservation = {
  /** Namespace constant de la route, jamais une valeur reçue du client. */
  scope: string;
  clientKey: string;
  windowMs: number;
  clientLimit: number;
  globalLimit: number;
};

export type PublicClientQuotaReservation = Omit<
  PublicQuotaReservation,
  'globalLimit'
>;

export class SharedPublicQuota {
  constructor(private readonly redis: Pick<Redis, 'eval'>) {}

  async reserve(input: PublicQuotaReservation): Promise<boolean> {
    assertInput(input);
    const clientDigest = createHash('sha256').update(input.clientKey).digest('base64url');
    const result = await this.redis.eval(
      RESERVE_SHARED_QUOTA,
      2,
      `public-quota:${input.scope}:client:${clientDigest}`,
      `public-quota:${input.scope}:global`,
      input.windowMs,
      input.clientLimit,
      input.globalLimit,
      randomUUID(),
    );
    if (!Array.isArray(result) || result.length < 1) {
      throw new Error('Réponse Redis de quota public invalide');
    }
    return Number(result[0]) === 1;
  }

  /**
   * Réserve une dimension secondaire sans fabriquer de plafond global
   * supplémentaire. La route doit avoir réservé sa borne source+globale avant
   * d'appeler cette méthode ; l'ordre est une propriété de sécurité.
   */
  async reserveClient(input: PublicClientQuotaReservation): Promise<boolean> {
    assertClientInput(input);
    const clientDigest = createHash('sha256').update(input.clientKey).digest('base64url');
    const result = await this.redis.eval(
      RESERVE_CLIENT_QUOTA,
      1,
      `public-quota:${input.scope}:client:${clientDigest}`,
      input.windowMs,
      input.clientLimit,
      randomUUID(),
    );
    if (!Array.isArray(result) || result.length < 1) {
      throw new Error('Réponse Redis de quota public invalide');
    }
    return Number(result[0]) === 1;
  }
}

function assertInput(input: PublicQuotaReservation): void {
  assertClientInput(input);
  assertPositiveInteger(input.globalLimit);
}

function assertClientInput(input: PublicClientQuotaReservation): void {
  if (!/^[a-z0-9][a-z0-9:-]{0,79}$/.test(input.scope)) {
    throw new Error('Namespace de quota public invalide');
  }
  for (const value of [input.windowMs, input.clientLimit]) {
    assertPositiveInteger(value);
  }
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Paramètre de quota public invalide');
  }
}
