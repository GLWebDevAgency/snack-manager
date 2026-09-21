import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoyaltySaleSettlementReadQuerySchema, LoyaltySaleResolutionRequestSchema, LoyaltySaleSettlementQuerySchema, type JwtPayload, type LoyaltySaleResolutionRequest, type LoyaltySaleSettlementQuery } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { LoyaltySaleSettlementService } from './loyalty-sale-settlement.service';

@Controller('loyalty/sales')
@Roles('owner', 'gerant')
@Fonction('fidelite')
export class LoyaltySaleSettlementController {
  constructor(private readonly sales: LoyaltySaleSettlementService, private readonly owner: OwnerReauthentication) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@TenantId() tenant: string, @CurrentUser() actor: JwtPayload, @Query(zod(LoyaltySaleSettlementQuerySchema)) query: LoyaltySaleSettlementQuery) {
    return this.sales.list(tenant, actor, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@TenantId() tenant: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload, @Query(zod(LoyaltySaleSettlementReadQuerySchema)) query: { resolutionId?: string }) {
    return this.sales.get(tenant, id, actor, query.resolutionId);
  }
  @Post(':id/resolution')
  @Header('Cache-Control', 'private, no-store')
  @Roles('owner')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resolve(@TenantId() tenant: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(LoyaltySaleResolutionRequestSchema)) body: LoyaltySaleResolutionRequest) {
    await this.owner.verify(actor, body.password);
    return this.sales.resolve(tenant, id, actor, body);
  }
}
