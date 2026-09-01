import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  LoyaltyCustomerCardResolveSchema,
  type LoyaltyCustomerCardResolve,
} from '@sm/contracts';
import { Public } from '../../common/auth';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import {
  publicRelayHeadersPresent,
  verifiedPublicRelayClient,
} from '../../common/verified-public-relay';
import { zod } from '../../common/zod.pipe';
import { LoyaltyPublicService } from './loyalty-public.service';

export const LOYALTY_PUBLIC_SOURCE_RATE_LIMIT = 300;
export const LOYALTY_PUBLIC_TOKEN_RATE_LIMIT = 120;
export const LOYALTY_PUBLIC_GLOBAL_RATE_LIMIT = 3_000;

@Public()
@Controller('public/tenants/:slug/loyalty')
export class LoyaltyPublicController {
  constructor(
    private readonly loyalty: LoyaltyPublicService,
    private readonly quota: SharedPublicQuota,
  ) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  catalog(@Param('slug') slug: string) {
    return this.loyalty.catalog(slug);
  }

  @Post('card')
  @HttpCode(200)
  async card(
    @Param('slug') slug: string,
    @Body(zod(LoyaltyCustomerCardResolveSchema)) body: LoyaltyCustomerCardResolve,
    @Req() request: Request,
  ) {
    const relaySource = verifiedPublicRelayClient(request, slug, body.qrToken);
    if (relaySource === null && publicRelayHeadersPresent(request)) {
      throw new ServiceUnavailableException(
        'La vérification de sécurité du relais est momentanément indisponible',
      );
    }
    const source = relaySource ?? trustedClientIp(request);
    let sourceAllowed: boolean;
    let tokenAllowed: boolean;
    try {
      // Première barrière, indépendante du slug non authentifié : varier des
      // restaurants réels ou inexistants ne permet jamais à une seule source
      // d'épuiser la borne globale Redis de tous les clients.
      sourceAllowed = await this.quota.reserve({
        scope: 'loyalty-card-source',
        clientKey: `network:${source}`,
        windowMs: 60_000,
        clientLimit: LOYALTY_PUBLIC_SOURCE_RATE_LIMIT,
        globalLimit: LOYALTY_PUBLIC_GLOBAL_RATE_LIMIT,
      });
      // Une seconde fenêtre empêche qu'une carte volée soit martelée. Le
      // helper hache cette valeur avant Redis : aucun QR brut n'y est stocké.
      tokenAllowed = sourceAllowed
        ? await this.quota.reserveClient({
            scope: 'loyalty-card-token',
            clientKey: `tenant:${slug}\0token:${body.qrToken}`,
            windowMs: 60_000,
            clientLimit: LOYALTY_PUBLIC_TOKEN_RATE_LIMIT,
          })
        : false;
    } catch {
      throw new ServiceUnavailableException(
        'La vérification de la carte est momentanément indisponible',
      );
    }
    if (!sourceAllowed || !tokenAllowed) return this.tooManyCardChecks();
    return this.loyalty.card(slug, body.qrToken);
  }

  private tooManyCardChecks(): never {
    throw new HttpException(
      'Trop de vérifications de carte. Réessayez dans un instant.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
