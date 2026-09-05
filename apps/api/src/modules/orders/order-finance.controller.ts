import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OwnerOrderCancelSchema, OrderRefundRequestSchema, type JwtPayload, type OrderRefundRequest, type OwnerOrderCancel } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { Fonction } from '../../common/capacites';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { OrderRefundsService } from '../ordering/order-refunds.service';
import { OrdersService } from './orders.service';

@Roles('owner')
@Fonction('orders')
@Controller('orders')
export class OrderFinanceController {
  constructor(
    private readonly refunds: OrderRefundsService,
    private readonly orders: OrdersService,
    private readonly owner: OwnerReauthentication,
  ) {}

  @Get(':id/refunds')
  summary(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.refunds.summary(tenantId, id);
  }

  @Post(':id/refunds')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async refund(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(OrderRefundRequestSchema)) body: OrderRefundRequest) {
    await this.owner.verify(actor, body.password);
    return this.refunds.request(tenantId, id, actor.sub, body);
  }

  @Post(':id/cancel-owner')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async cancel(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(OwnerOrderCancelSchema)) body: OwnerOrderCancel) {
    await this.owner.verify(actor, body.password);
    return this.orders.cancelAsOwner(tenantId, id, actor, body.reason);
  }
}
