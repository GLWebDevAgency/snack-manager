import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  DeliveryOperatorCreateSchema, DeliveryOperatorInviteSchema, DeliveryOperatorUpdateSchema, DeliveryOperatorsQuerySchema,
  type DeliveryOperatorsQuery,
  type DeliveryOperatorCreate, type DeliveryOperatorInvite, type DeliveryOperatorUpdate, type JwtPayload,
} from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { Capacites } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { DeliveryOperatorsService } from './delivery-operators.service';

/** Accès opérationnels : offre livraison seule suffisante, pas de /staff RH. */
@Roles('owner', 'gerant')
@Capacites('delivery')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('delivery/operators')
export class DeliveryOperatorsController {
  constructor(private readonly operators: DeliveryOperatorsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@TenantId() tenantId: string, @Query(zod(DeliveryOperatorsQuerySchema)) query: DeliveryOperatorsQuery) {
    return this.operators.list(tenantId, query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryOperatorCreateSchema)) body: DeliveryOperatorCreate) {
    return this.operators.create(tenantId, body, actor);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryOperatorUpdateSchema)) body: DeliveryOperatorUpdate) {
    return this.operators.update(tenantId, id, body, actor);
  }

  @Post(':id/invitation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  invite(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(DeliveryOperatorInviteSchema)) body: DeliveryOperatorInvite) {
    return this.operators.invitation(tenantId, id, body.expectedRevision, actor);
  }
}
