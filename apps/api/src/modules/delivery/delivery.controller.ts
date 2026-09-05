import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  DeliveryDispatchSchema, DeliveryQuoteRequestSchema, DeliverySettingsSchema,
  type DeliveryDispatch, type DeliveryQuoteRequest, type DeliverySettings, type JwtPayload,
} from '@sm/contracts';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { Capacites } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { DeliveryService } from './delivery.service';

@Controller()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Public()
  @Get('public/tenants/:slug/delivery')
  publicSettings(@Param('slug') slug: string) { return this.delivery.publicSettings(slug); }

  @Public()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('public/tenants/:slug/delivery/quote')
  quote(@Param('slug') slug: string, @Body(zod(DeliveryQuoteRequestSchema)) body: DeliveryQuoteRequest) {
    return this.delivery.quote(slug, body);
  }

  @Roles('owner', 'gerant')
  @Capacites('delivery')
  @Get('delivery/settings')
  settings(@TenantId() tenantId: string) { return this.delivery.settings(tenantId); }

  @Roles('owner', 'gerant')
  @Capacites('delivery')
  @Patch('delivery/settings')
  updateSettings(@TenantId() tenantId: string, @CurrentUser() actor: JwtPayload, @Body(zod(DeliverySettingsSchema)) body: DeliverySettings) {
    return this.delivery.updateSettings(tenantId, body, actor);
  }

  @Roles('owner', 'gerant', 'caisse')
  @Capacites('delivery')
  @HttpCode(200)
  @Post('orders/:id/dispatch')
  dispatch(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload, @Body(zod(DeliveryDispatchSchema)) body: DeliveryDispatch) {
    return this.delivery.dispatch(tenantId, id, body, actor);
  }
}
