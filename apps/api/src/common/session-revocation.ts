import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_PUB } from '../redis.module';

export const SESSION_REVOCATION_CHANNEL = 'sessions:revocations';

export type SessionRevocation =
  | { scope: 'tenant'; tenantId: string }
  /**
   * UN COMPTE À MOT DE PASSE — révoqué, ou changé de rôle.
   *
   * Le quatrième périmètre, ajouté avec les comptes multiples par restaurant.
   * Il ne remplace rien : côté HTTP, `SessionAccessService` relit déjà le
   * document à chaque requête et refuse un compte disparu ou dont le rôle a
   * bougé. Mais une socket ouverte ne fait aucune requête HTTP — elle attend
   * des commandes, parfois des heures. Sans cet événement, un cogérant révoqué
   * continuerait de voir défiler les commandes de son ancien restaurant jusqu'à
   * la revalidation périodique.
   *
   * `staff` et `user` restent DEUX périmètres et non un « compte » unifié : un
   * porteur de code et un compte à mot de passe ne vivent pas dans la même
   * collection, et confondre leurs identifiants ferait couper la mauvaise
   * session le jour où deux ObjectId se ressemblent.
   */
  | { scope: 'user'; tenantId: string; userId: string }
  | { scope: 'staff'; tenantId: string; staffId: string }
  | { scope: 'device'; tenantId: string; deviceId: string };

export function parseSessionRevocation(raw: string): SessionRevocation | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.tenantId !== 'string') return null;
    if (value.scope === 'tenant') return { scope: 'tenant', tenantId: value.tenantId };
    if (value.scope === 'user' && typeof value.userId === 'string') {
      return { scope: 'user', tenantId: value.tenantId, userId: value.userId };
    }
    if (value.scope === 'staff' && typeof value.staffId === 'string') {
      return { scope: 'staff', tenantId: value.tenantId, staffId: value.staffId };
    }
    if (value.scope === 'device' && typeof value.deviceId === 'string') {
      return { scope: 'device', tenantId: value.tenantId, deviceId: value.deviceId };
    }
  } catch {
    // Événement externe ou tronqué : il ne doit jamais faire tomber l'API.
  }
  return null;
}

/** Publie les invalidations sur chaque réplique API sans exposer de secret. */
@Injectable()
export class SessionRevocationPublisher {
  private readonly logger = new Logger(SessionRevocationPublisher.name);

  constructor(@Inject(REDIS_PUB) private readonly redis: Redis) {}

  tenant(tenantId: string): Promise<void> {
    return this.publish({ scope: 'tenant', tenantId });
  }

  /** Un compte à mot de passe révoqué ou changé de rôle. */
  user(tenantId: string, userId: string): Promise<void> {
    return this.publish({ scope: 'user', tenantId, userId });
  }

  staff(tenantId: string, staffId: string): Promise<void> {
    return this.publish({ scope: 'staff', tenantId, staffId });
  }

  device(tenantId: string, deviceId: string): Promise<void> {
    return this.publish({ scope: 'device', tenantId, deviceId });
  }

  private async publish(event: SessionRevocation): Promise<void> {
    try {
      await this.redis.publish(SESSION_REVOCATION_CHANNEL, JSON.stringify(event));
    } catch (error) {
      // La mutation métier reste vraie même si Redis vacille. Le gateway
      // revalide aussi avant diffusion et périodiquement : l'événement est le
      // chemin immédiat, pas l'unique contrôle de sécurité.
      this.logger.error(
        `Publication de révocation impossible (${event.scope})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
