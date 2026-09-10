import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DELIVERY_VIEW_VERSION_HEADER, DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionsQuerySchema,
  deliveryMissionForVersion, deliveryMissionsForVersion, deliveryMissionResultForVersion,
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
  async list(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload,
    @Query(zod(DeliveryMissionsQuerySchema)) query: DeliveryMissionsQuery,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionsForVersion(await this.missions.listManager(tenantId, actor, query), version);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async get(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionForVersion(await this.missions.getManager(tenantId, id, actor), version);
  }

  @Post(':id/assignment')
  @Roles('owner', 'gerant')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async assign(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryMissionAssignSchema)) body: DeliveryMissionAssign,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionResultForVersion(await this.missions.assign(tenantId, id, body, actor), version);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async dispatch(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryMissionDispatchSchema)) body: DeliveryMissionDispatch,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionResultForVersion(await this.missions.dispatchManager(tenantId, id, body, actor), version);
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
  async list(@Req() request: DeliveryAccessRequest, @Query(zod(DeliveryMissionsQuerySchema)) query: DeliveryMissionsQuery,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionsForVersion(await this.missions.listCourier(this.session(request), query), version);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  async get(@Req() request: DeliveryAccessRequest, @Param('id') id: string,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionForVersion(await this.missions.getCourier(this.session(request), id), version);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async dispatch(@Req() request: DeliveryAccessRequest, @Param('id') id: string,
    @Body(zod(DeliveryMissionDispatchSchema)) body: DeliveryMissionDispatch,
    @Headers(DELIVERY_VIEW_VERSION_HEADER) version?: string) {
    return deliveryMissionResultForVersion(await this.missions.dispatchCourier(this.session(request), id, body), version);
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
