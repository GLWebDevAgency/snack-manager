import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { OrderReadyPreferenceSchema, OrderReadySubscribeSchema, type OrderReadyPreference, type OrderReadySubscribe } from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { OrderNotificationsService } from './order-notifications.service';

@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('public/tenants/:slug')
export class OrderNotificationsController {
  constructor(@Inject(OrderNotificationsService) private readonly notifications: OrderNotificationsService) {}

  @Get('order-notifications/config')
  @Header('Cache-Control', 'no-store')
  config(@Param('slug') slug: string) { return this.notifications.configView(slug); }

  @Post('orders/:id/ready-notification')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  subscribe(@Param('slug') slug: string, @Param('id') id: string, @Body(zod(OrderReadySubscribeSchema)) body: OrderReadySubscribe) {
    return this.notifications.subscribe(slug, id, body);
  }

  @Post('orders/:id/ready-notification/status')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  status(@Param('slug') slug: string, @Param('id') id: string, @Body(zod(OrderReadyPreferenceSchema)) body: OrderReadyPreference) {
    return this.notifications.status(slug, id, body);
  }

  @Delete('orders/:id/ready-notification')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  revoke(@Param('slug') slug: string, @Param('id') id: string, @Body(zod(OrderReadyPreferenceSchema)) body: OrderReadyPreference) {
    return this.notifications.revoke(slug, id, body);
  }
}
