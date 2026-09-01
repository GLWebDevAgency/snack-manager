import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_PUB } from '../../redis.module';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'public-order';
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/**
 * Trois fenetres GLISSANTES dans UNE commande Redis. Le quota n'est reserve
 * que si les trois bornes passent : un tenant deja bloque ne consomme donc pas
 * le quota global, et le passage d'une frontiere de minute ne double pas le
 * debit autorise.
 */
const RESERVE_QUOTAS = `
local redis_time = redis.call('TIME')
local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
local windows = { tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]) }
local limits = { tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]) }
local counts = {}

for i = 1, 3 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windows[i])
  counts[i] = redis.call('ZCARD', KEYS[i])
end

if counts[1] >= limits[1] or counts[2] >= limits[2] or counts[3] >= limits[3] then
  return { 0, counts[1], counts[2], counts[3] }
end

for i = 1, 3 do
  redis.call('ZADD', KEYS[i], now, ARGV[7])
  redis.call('PEXPIRE', KEYS[i], windows[i] + 1000)
end

return { 1, counts[1] + 1, counts[2] + 1, counts[3] + 1 }
`;

const RELEASE_QUOTAS = `
for i = 1, 3 do redis.call('ZREM', KEYS[i], ARGV[1]) end
return 1
`;

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  cdata?: string;
  'error-codes'?: string[];
};

export type PublicOrderProof = {
  provider: 'turnstile';
  hostname: string;
  verifiedAt: Date;
  /** Opaque et strictement serveur : jamais persiste ni renvoye au client. */
  quotaReservation: { tenantId: string; id: string };
};
type VerifiedTurnstile = Omit<PublicOrderProof, 'quotaReservation'>;

/**
 * Frontiere anti-abus de la commande en ligne.
 *
 * Le throttle HTTP ralentit une adresse. Ce service traite le cas qui compte
 * pendant le rush : plusieurs adresses et plusieurs repliques tentant de
 * pousser des tickets dans UNE cuisine. La preuve humaine et les quotas
 * partages sont tous deux obligatoires ; leur indisponibilite ferme l'ecriture
 * publique, jamais les commandes POS/telephone authentifiees.
 */
@Injectable()
export class PublicOrderGate {
  private readonly logger = new Logger(PublicOrderGate.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  async authorize(input: {
    tenantId: string;
    tenantSlug: string;
    turnstileToken: string;
  }): Promise<PublicOrderProof> {
    const proof = await this.verifyTurnstile(input.tenantSlug, input.turnstileToken);
    const reservationId = await this.reserveSharedQuota(input.tenantId);
    return {
      ...proof,
      quotaReservation: { tenantId: input.tenantId, id: reservationId },
    };
  }

  /**
   * Rend une place si aucune commande n'est finalement creee (corps metier
   * invalide, creneau pris pendant Siteverify ou course idempotente).
   */
  async release(proof: PublicOrderProof): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_QUOTAS,
        3,
        ...this.quotaKeys(proof.quotaReservation.tenantId),
        proof.quotaReservation.id,
      );
    } catch (err) {
      // Ne jamais masquer l'erreur metier d'origine. Les cles expirent seules.
      this.logger.warn(`Reservation de quota non rendue : ${errorMessage(err)}`);
    }
  }

  /**
   * Section critique distribuee par restaurant et creneau. Siteverify est deja
   * termine quand on entre ici ; le verrou ne couvre que la seconde lecture de
   * capacite et l'ecriture Mongo, donc quelques dizaines de millisecondes.
   */
  async serializeSlot<T>(
    input: { tenantId: string; slot: string },
    work: () => Promise<T>,
  ): Promise<T> {
    const key = `public-orders:slot-lock:${input.tenantId}:${Buffer.from(input.slot).toString('base64url')}`;
    const owner = randomUUID();
    const deadline = Date.now() + 4_000;

    for (;;) {
      try {
        const acquired = await this.redis.set(key, owner, 'PX', 15_000, 'NX');
        if (acquired === 'OK') break;
      } catch (err) {
        this.logger.warn(`Verrou de creneau indisponible : ${errorMessage(err)}`);
        throw new ServiceUnavailableException(
          'Le creneau ne peut pas etre reserve pour le moment. Reessayez dans un instant.',
        );
      }
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException(
          'Le creneau est tres sollicite. Reessayez dans un instant.',
        );
      }
      await delay(40 + Math.floor(Math.random() * 40));
    }

    try {
      return await work();
    } finally {
      try {
        await this.redis.eval(RELEASE_LOCK, 1, key, owner);
      } catch (err) {
        // TTL de 15 s : une liberation ratee ne devient pas un verrou permanent.
        this.logger.warn(`Verrou de creneau non libere : ${errorMessage(err)}`);
      }
    }
  }

  private async verifyTurnstile(tenantSlug: string, token: string): Promise<VerifiedTurnstile> {
    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY')?.trim();
    const allowedHosts = this.allowedHostnames();
    if (!secret || allowedHosts.length === 0) {
      throw new ServiceUnavailableException(
        'La verification de securite est indisponible. Commandez par telephone pour le moment.',
      );
    }

    const hosted = Boolean(
      this.config.get<string>('RAILWAY_ENVIRONMENT_NAME') ||
        this.config.get<string>('RAILWAY_ENVIRONMENT_ID'),
    );
    const runtime = this.config.get<string>('NODE_ENV');
    const localRuntime = runtime === 'development' || runtime === 'test';
    const testMode = this.config.get<string>('TURNSTILE_TEST_MODE') === '1';
    if (
      secret === TURNSTILE_TEST_SECRET &&
      (!testMode || hosted || !localRuntime)
    ) {
      this.logger.error('Cle de test Turnstile refusee hors environnement local explicite.');
      throw new ServiceUnavailableException(
        'La verification de securite est indisponible. Commandez par telephone pour le moment.',
      );
    }

    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: token,
          idempotency_key: randomUUID(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      this.logger.warn(`Siteverify injoignable : ${errorMessage(err)}`);
      throw new ServiceUnavailableException(
        'La verification de securite ne repond pas. Reessayez dans un instant.',
      );
    }

    if (!response.ok) {
      this.logger.warn(`Siteverify a repondu HTTP ${response.status}.`);
      throw new ServiceUnavailableException(
        'La verification de securite ne repond pas. Reessayez dans un instant.',
      );
    }

    let result: TurnstileResult;
    try {
      result = (await response.json()) as TurnstileResult;
    } catch {
      throw new ServiceUnavailableException(
        'La verification de securite ne repond pas. Reessayez dans un instant.',
      );
    }

    const hostname = result.hostname?.toLowerCase() ?? '';
    const valid =
      result.success === true &&
      result.action === TURNSTILE_ACTION &&
      result.cdata === tenantSlug &&
      allowedHosts.some((allowed) => hostnameMatches(hostname, allowed));

    if (!valid) {
      // Les codes fournisseur aident l'exploitation sans exposer le jeton.
      const codes = result['error-codes']?.join(',') || 'preuve incoherente';
      this.logger.warn(`Preuve Turnstile refusee (${codes}).`);
      throw new BadRequestException(
        'La verification anti-robot a expire ou a echoue. Relancez-la puis reessayez.',
      );
    }

    return { provider: 'turnstile', hostname, verifiedAt: new Date() };
  }

  private allowedHostnames(): string[] {
    return (this.config.get<string>('TURNSTILE_ALLOWED_HOSTNAMES') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
      .filter(Boolean);
  }

  private async reserveSharedQuota(tenantId: string): Promise<string> {
    const burstWindowMs = 5 * 60_000;
    const hourWindowMs = 60 * 60_000;
    const globalWindowMs = 60_000;
    const tenantBurstLimit = this.limit('PUBLIC_ORDER_TENANT_BURST_LIMIT', 12, 1, 500);
    const tenantHourLimit = this.limit('PUBLIC_ORDER_TENANT_HOURLY_LIMIT', 60, 1, 5_000);
    const globalBurstLimit = this.limit('PUBLIC_ORDER_GLOBAL_MINUTE_LIMIT', 300, 1, 50_000);
    const reservationId = randomUUID();

    let result: [number, number, number, number];
    try {
      const raw = (await this.redis.eval(
        RESERVE_QUOTAS,
        3,
        ...this.quotaKeys(tenantId),
        burstWindowMs,
        hourWindowMs,
        globalWindowMs,
        tenantBurstLimit,
        tenantHourLimit,
        globalBurstLimit,
        reservationId,
      )) as Array<number | string>;
      result = [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
      if (result.some((value) => !Number.isFinite(value))) throw new Error('compteur illisible');
    } catch (err) {
      this.logger.warn(`Quota Redis indisponible : ${errorMessage(err)}`);
      throw new ServiceUnavailableException(
        'La prise de commande est momentanement protegee. Reessayez dans un instant.',
      );
    }

    if (result[0] !== 1) {
      throw new HttpException(
        'Trop de commandes viennent d arriver. Patientez quelques minutes ou appelez le restaurant.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return reservationId;
  }

  private quotaKeys(tenantId: string): [string, string, string] {
    return [
      `public-orders:tenant:${tenantId}:5m`,
      `public-orders:tenant:${tenantId}:1h`,
      'public-orders:global:1m',
    ];
  }

  private limit(key: string, fallback: number, min: number, max: number): number {
    const parsed = Number(this.config.get<string>(key));
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  }
}

function hostnameMatches(hostname: string, allowedRoot: string): boolean {
  return hostname === allowedRoot || hostname.endsWith(`.${allowedRoot}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
