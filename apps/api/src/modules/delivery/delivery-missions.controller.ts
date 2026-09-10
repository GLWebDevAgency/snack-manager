import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionsQuerySchema,
  type DeliveryMissionAssign, type DeliveryMissionDispatch, type DeliveryMissionsQuery, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { Capacites } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { DeliveryAccessGuard, type DeliveryAccessRequest } from './delivery-access.guard';
import { DeliveryMissionsService } from './delivery-missions.service';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';

@Controller('delivery/missions')
@Roles('owner', 'gerant', 'caisse')
@Capacites('delivery')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class DeliveryMissionsController {
  constructor(private readonly missions: DeliveryMissionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload,
    @Query(zod(DeliveryMissionsQuerySchema)) query: DeliveryMissionsQuery) {
    return this.missions.listManager(tenantId, actor, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.missions.getManager(tenantId, id, actor);
  }

  @Post(':id/assignment')
  @Roles('owner', 'gerant')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  assign(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryMissionAssignSchema)) body: DeliveryMissionAssign) {
    return this.missions.assign(tenantId, id, body, actor);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  dispatch(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryMissionDispatchSchema)) body: DeliveryMissionDispatch) {
    return this.missions.dispatchManager(tenantId, id, body, actor);
  }
}

/** La quota précède l'authentification DB, même pour un bearer deviné. */
@Public()
@Controller('delivery-access/missions')
@UseGuards(DeliveryMissionsQuotaGuard, DeliveryAccessGuard)
export class DeliveryCourierMissionsController {
  constructor(private readonly missions: DeliveryMissionsService) {}

  private session(request: DeliveryAccessRequest) {
    if (!request.deliverySession) throw new UnauthorizedException('Accès livreur invalide ou expiré');
    return request.deliverySession;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() request: DeliveryAccessRequest, @Query(zod(DeliveryMissionsQuerySchema)) query: DeliveryMissionsQuery) {
    return this.missions.listCourier(this.session(request), query);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() request: DeliveryAccessRequest, @Param('id') id: string) {
    return this.missions.getCourier(this.session(request), id);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  dispatch(@Req() request: DeliveryAccessRequest, @Param('id') id: string,
    @Body(zod(DeliveryMissionDispatchSchema)) body: DeliveryMissionDispatch) {
    return this.missions.dispatchCourier(this.session(request), id, body);
  }
}

@Public()
@Controller('delivery-access/history')
@UseGuards(DeliveryMissionsQuotaGuard, DeliveryAccessGuard)
export class DeliveryCourierHistoryController {
  constructor(private readonly missions: DeliveryMissionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Req() request: DeliveryAccessRequest, @Query(zod(DeliveryMissionsQuerySchema)) query: DeliveryMissionsQuery) {
    if (!request.deliverySession) throw new UnauthorizedException('Accès livreur invalide ou expiré');
    return this.missions.historyCourier(request.deliverySession, query);
  }
}
