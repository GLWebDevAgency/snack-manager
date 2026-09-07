import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DeliveryAccessService, type DeliveryAccessSession } from './delivery-access.service';

export type DeliveryAccessRequest = Request & { deliverySession?: DeliveryAccessSession };

/** Garde exclusivement livreur : ne crée jamais req.user ni de rôle POS/KDS. */
@Injectable()
export class DeliveryAccessGuard implements CanActivate {
  constructor(private readonly access: DeliveryAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeliveryAccessRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
    if (!match) throw new UnauthorizedException('Accès livreur invalide ou expiré');
    request.deliverySession = await this.access.authenticate(match[1]!);
    return true;
  }
}
