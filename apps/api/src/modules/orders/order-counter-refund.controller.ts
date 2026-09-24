import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CounterRefundRequestSchema, CounterRefundConfirmationSchema, CounterRefundNoEffectSchema,
  type CounterRefundRequest, type CounterRefundConfirmation, type CounterRefundNoEffect, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { OrderCounterRefundService } from '../ordering/order-counter-refund.service';
import type { CounterRefundActor } from '../ordering/order-counter-refund.policy';

@Controller('orders/:id/counter-refunds')
@Fonction('orders')
@Roles('owner', 'gerant', 'caisse')
export class OrderCounterRefundController {
  constructor(private readonly refunds: OrderCounterRefundService, private readonly owner: OwnerReauthentication,
    private readonly auth: AuthService) {}

  private async approver(tenantId: string, actor: JwtPayload, body: CounterRefundRequest): Promise<CounterRefundActor> {
    if (actor.tenantId !== tenantId) throw new ForbiddenException('Établissement incohérent.');
    if (body.authorization.kind === 'owner_password') {
      await this.owner.verify(actor, body.authorization.password);
      return { sub: actor.sub, kind: 'user', role: 'owner' };
    }
    const verified = await this.auth.verifyPin(tenantId, body.authorization.pin);
    if (verified.role !== 'gerant') throw new ForbiddenException('Le code d’un gérant est requis pour rembourser au comptoir.');
    return { sub: verified.staffId, kind: 'staff', role: 'gerant' };
  }
  private intent(body: CounterRefundRequest) {
    return { operationId: body.operationId, amountCents: body.amountCents, reason: body.reason,
      tender: body.tender, allocation: body.allocation };
  }

  @Get('journal')
  @Header('Cache-Control', 'private, no-store')
  journal(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.refunds.journal(tenantId, id, actor);
  }
  @Post('prepare') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async prepare(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CounterRefundRequestSchema)) body: CounterRefundRequest) {
    return this.refunds.execute('prepare', tenantId, id, actor, await this.approver(tenantId, actor, body), this.intent(body));
  }
  @Post('start') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async start(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CounterRefundRequestSchema)) body: CounterRefundRequest) {
    return this.refunds.execute('start', tenantId, id, actor, await this.approver(tenantId, actor, body), this.intent(body));
  }
  @Post('confirm') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirm(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CounterRefundConfirmationSchema)) body: CounterRefundConfirmation) {
    return this.refunds.execute('confirm', tenantId, id, actor, await this.approver(tenantId, actor, body), this.intent(body),
      { attestation: body.attestation });
  }
  @Post('withdraw') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async withdraw(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CounterRefundRequestSchema)) body: CounterRefundRequest) {
    return this.refunds.execute('withdraw', tenantId, id, actor, await this.approver(tenantId, actor, body), this.intent(body));
  }
  @Post('no-effect') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async noEffect(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CounterRefundNoEffectSchema)) body: CounterRefundNoEffect) {
    if (actor.kind !== 'user' || actor.role !== 'owner' || body.authorization.kind !== 'owner_password') throw new ForbiddenException('Décision réservée au propriétaire.');
    return this.refunds.execute('no_effect', tenantId, id, actor, await this.approver(tenantId, actor, body), this.intent(body),
      { resolutionReason: body.resolutionReason });
  }
}
