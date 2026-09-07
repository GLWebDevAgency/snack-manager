import { HttpException, Injectable, ServiceUnavailableException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import { hashDeliveryAccessSecret } from './delivery-access.service';

/** Quotas communs à toutes répliques ; aucun bearer brut en clé ou journal. */
@Injectable()
export class DeliveryMissionsQuotaGuard implements CanActivate {
  constructor(private readonly quota: SharedPublicQuota) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
    const mutation = request.method === 'POST';
    let allowed: boolean;
    try {
      allowed = await this.quota.reserve({ scope: 'delivery-missions-source', clientKey: trustedClientIp(request),
        windowMs: 60_000, clientLimit: 900, globalLimit: 6_000 });
      if (allowed && token) allowed = await this.quota.reserveClient({
        scope: mutation ? 'delivery-missions-write' : 'delivery-missions-read', clientKey: hashDeliveryAccessSecret(token),
        windowMs: 60_000, clientLimit: mutation ? 30 : 180,
      });
    } catch { throw new ServiceUnavailableException('Les missions sont momentanément indisponibles.'); }
    if (!allowed) throw new HttpException('Trop de demandes. Réessayez dans un instant.', 429);
    return true;
  }
}
