import {
  Body, Controller, Get, Header, Headers, HttpCode, HttpException, HttpStatus, Post, Req,
  ServiceUnavailableException, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DELIVERY_VIEW_VERSION_HEADER, DeliverySessionExchangeSchema, deliverySessionForVersion, type DeliverySessionExchange } from '@sm/contracts';
import { Public } from '../../common/auth';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import { zod } from '../../common/zod.pipe';
import { DeliveryAccessGuard, type DeliveryAccessRequest } from './delivery-access.guard';
import { DeliveryAccessService, hashDeliveryAccessSecret } from './delivery-access.service';

@Public()
@Controller('delivery-access')
export class DeliveryAccessController {
  constructor(private readonly access: DeliveryAccessService, private readonly quota: SharedPublicQuota) {}

  @Post('exchange')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async exchange(
    @Body(zod(DeliverySessionExchangeSchema)) body: DeliverySessionExchange,
    @Req() request: Request,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string,
  ) {
    let allowed: boolean;
    try {
      allowed = await this.quota.reserve({
        scope: 'delivery-exchange-source', clientKey: trustedClientIp(request),
        // Le client réseau peut être l'egress partagé du BFF Next. Le second
        // quota reste propre à l'invitation et ne tourne jamais avec le nonce.
        windowMs: 60_000, clientLimit: 300, globalLimit: 1_000,
      });
      if (allowed) allowed = await this.quota.reserveClient({
        scope: 'delivery-exchange-invite', clientKey: hashDeliveryAccessSecret(body.token),
        windowMs: 60_000, clientLimit: 10,
      });
    } catch {
      throw new ServiceUnavailableException('La connexion livreur est momentanément indisponible');
    }
    if (!allowed) throw new HttpException('Trop de tentatives. Réessayez dans un instant.', HttpStatus.TOO_MANY_REQUESTS);
    const result = await this.access.exchange(body);
    return { ...result, session: deliverySessionForVersion(result.session, version) };
  }

  @Get('session')
  @UseGuards(DeliveryAccessGuard)
  @Header('Cache-Control', 'no-store')
  session(@Req() request: DeliveryAccessRequest, @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    if (!request.deliverySession) throw new UnauthorizedException();
    return deliverySessionForVersion(request.deliverySession.session, version);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(DeliveryAccessGuard)
  @Header('Cache-Control', 'no-store')
  async logout(@Req() request: DeliveryAccessRequest): Promise<void> {
    if (!request.deliverySession) throw new UnauthorizedException();
    await this.access.logout(request.deliverySession);
  }
}
