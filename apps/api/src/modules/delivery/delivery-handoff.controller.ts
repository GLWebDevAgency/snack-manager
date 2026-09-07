import { applyDecorators, Body, Controller, ForbiddenException, Get, Header, HttpCode, HttpException,
  Injectable, Param, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards,
  type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { DeliveryHandoffIncidentSchema, DeliveryHandoffReasonSchema, DeliveryHandoffResolveSchema,
  DeliveryHandoffSubmitSchema, DeliveryProofRequestSchema, roleSatisfait,
  type DeliveryHandoffIncident, type DeliveryHandoffReason, type DeliveryHandoffResolve,
  type DeliveryHandoffSubmit, type DeliveryProofRequest, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { Capacites } from '../../common/capacites';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import { zod } from '../../common/zod.pipe';
import { DeliveryAccessGuard, type DeliveryAccessRequest } from './delivery-access.guard';
import { DeliveryHandoffService } from './delivery-handoff.service';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';

const orderId = z.string().regex(/^[a-f0-9]{24}$/);
const PrivateHandoff = () => applyDecorators(Header('Cache-Control', 'private, no-store'),
  Header('Referrer-Policy', 'no-referrer'), Header('Vary', 'Authorization'));

@Controller('delivery/missions/:id/handoff')
@Roles('owner', 'gerant', 'caisse')
@Capacites('delivery')
@UseGuards(DeliveryMissionsQuotaGuard)
export class DeliveryHandoffController {
  constructor(private readonly handoff: DeliveryHandoffService) {}

  @Get()
  @PrivateHandoff()
  get(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload) {
    return this.handoff.getManager(tenantId, id, actor);
  }

  @Post('confirm')
  @HttpCode(200)
  @PrivateHandoff()
  confirm(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryHandoffSubmitSchema)) body: DeliveryHandoffSubmit) {
    return this.handoff.confirmManager(tenantId, id, body, actor);
  }

  @Post('incident')
  @HttpCode(200)
  @PrivateHandoff()
  incident(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryHandoffIncidentSchema)) body: DeliveryHandoffIncident) {
    return this.handoff.incidentManager(tenantId, id, body, actor);
  }

  @Post('override')
  @Roles('owner', 'gerant')
  @HttpCode(200)
  @PrivateHandoff()
  override(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryHandoffReasonSchema)) body: DeliveryHandoffReason) {
    return this.handoff.override(tenantId, id, body, actor);
  }

  @Post('rotate')
  @Roles('owner', 'gerant')
  @HttpCode(200)
  @PrivateHandoff()
  rotate(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryHandoffReasonSchema)) body: DeliveryHandoffReason) {
    return this.handoff.rotate(tenantId, id, body, actor);
  }

  @Post('resolve')
  @HttpCode(200)
  @PrivateHandoff()
  resolve(@TenantId() tenantId: string, @Param('id', zod(orderId)) id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryHandoffResolveSchema)) body: DeliveryHandoffResolve) {
    // La clôture d'une intention possède les droits de l'action, même absente.
    if (['override', 'rotate'].includes(body.action) && !roleSatisfait(actor.role, ['owner', 'gerant'])) {
      throw new ForbiddenException('Cette action nécessite un responsable.');
    }
    return this.handoff.resolveManager(tenantId, id, body, actor);
  }
}

@Public()
@Controller('delivery-access/missions/:id/handoff')
@UseGuards(DeliveryMissionsQuotaGuard, DeliveryAccessGuard)
export class DeliveryCourierHandoffController {
  constructor(private readonly handoff: DeliveryHandoffService) {}

  private session(request: DeliveryAccessRequest) {
    if (!request.deliverySession) throw new UnauthorizedException('Accès livreur invalide ou expiré');
    return request.deliverySession;
  }

  @Get()
  @PrivateHandoff()
  get(@Req() request: DeliveryAccessRequest, @Param('id', zod(orderId)) id: string) {
    return this.handoff.getCourier(this.session(request), id);
  }

  @Post('confirm')
  @HttpCode(200)
  @PrivateHandoff()
  confirm(@Req() request: DeliveryAccessRequest, @Param('id', zod(orderId)) id: string,
    @Body(zod(DeliveryHandoffSubmitSchema)) body: DeliveryHandoffSubmit) {
    return this.handoff.confirmCourier(this.session(request), id, body);
  }

  @Post('incident')
  @HttpCode(200)
  @PrivateHandoff()
  incident(@Req() request: DeliveryAccessRequest, @Param('id', zod(orderId)) id: string,
    @Body(zod(DeliveryHandoffIncidentSchema)) body: DeliveryHandoffIncident) {
    return this.handoff.incidentCourier(this.session(request), id, body);
  }

  @Post('resolve')
  @HttpCode(200)
  @PrivateHandoff()
  resolve(@Req() request: DeliveryAccessRequest, @Param('id', zod(orderId)) id: string,
    @Body(zod(DeliveryHandoffResolveSchema)) body: DeliveryHandoffResolve) {
    const session = this.session(request);
    if (!['handoff', 'incident'].includes(body.action)) throw new ForbiddenException('Cette action nécessite un responsable.');
    return this.handoff.resolveCourier(session, id, body);
  }
}

/** Source/globale avant tout accès DB ; aucun identifiant secret dans la clé. */
@Injectable()
export class DeliveryProofQuotaGuard implements CanActivate {
  constructor(private readonly quota: SharedPublicQuota) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    let allowed: boolean;
    try {
      allowed = await this.quota.reserve({ scope: 'delivery-proof-source', clientKey: trustedClientIp(request),
        windowMs: 60_000, clientLimit: 300, globalLimit: 1_000 });
    } catch { throw new ServiceUnavailableException('La preuve de remise est momentanément indisponible.'); }
    if (!allowed) throw new HttpException('Trop de demandes. Réessayez dans un instant.', 429);
    return true;
  }
}

@Public()
@Controller('public/orders/:id/delivery-proof')
@UseGuards(DeliveryProofQuotaGuard)
export class DeliveryCustomerProofController {
  constructor(private readonly handoff: DeliveryHandoffService) {}

  @Post()
  @HttpCode(200)
  @PrivateHandoff()
  proof(@Param('id', zod(orderId)) id: string, @Body(zod(DeliveryProofRequestSchema)) body: DeliveryProofRequest) {
    return this.handoff.customerProof(id, body);
  }
}
