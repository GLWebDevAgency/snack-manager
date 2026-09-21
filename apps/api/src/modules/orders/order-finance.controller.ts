import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OwnerOrderCancelSchema, OrderRefundAllocationRequestSchema, type OrderRefundAllocationRequest,
  type JwtPayload, type OrderRefundRequest, type OwnerOrderCancel } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { Fonction } from '../../common/capacites';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { OrderRefundsService } from '../ordering/order-refunds.service';
import { OrdersService } from './orders.service';
import { OrderRefundMutationPipe } from './order-refund-mutation.pipe';

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
  @Header('Cache-Control', 'private, no-store')
  summary(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.refunds.summary(tenantId, id);
  }

  @Get(':id/refunds/journal')
  @Header('Cache-Control', 'private, no-store')
  journal(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.refunds.journal(tenantId, id, actor.sub);
  }

  @Post(':id/refunds')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async refund(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(new OrderRefundMutationPipe()) body: OrderRefundRequest) {
    await this.owner.verify(actor, body.password);
    return this.refunds.request(tenantId, id, actor.sub, body);
  }

  @Post(':id/refunds/withdraw')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async withdrawRefund(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(new OrderRefundMutationPipe()) body: OrderRefundRequest) {
    await this.owner.verify(actor, body.password);
    return this.refunds.withdraw(tenantId, id, actor.sub, body);
  }

  @Post(':id/refunds/:refundId/allocation')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async allocateRefund(@TenantId() tenantId: string, @Param('id') id: string,
    @Param('refundId') refundId: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(OrderRefundAllocationRequestSchema)) body: OrderRefundAllocationRequest) {
    await this.owner.verify(actor, body.password);
    return this.refunds.allocate(tenantId, id, refundId, actor.sub, body);
  }

  @Post(':id/refunds/:refundId/allocation/withdraw')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async withdrawRefundAllocation(@TenantId() tenantId: string, @Param('id') id: string,
    @Param('refundId') refundId: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(OrderRefundAllocationRequestSchema)) body: OrderRefundAllocationRequest) {
    await this.owner.verify(actor, body.password);
    return this.refunds.withdrawAllocation(tenantId, id, refundId, actor.sub, body);
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
