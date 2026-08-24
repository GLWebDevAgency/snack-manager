import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateOrderSchema,
  type CreateOrder,
  type JwtPayload,
  type OrderStatus,
  publicOrderingState,
  TrackingTokenQuerySchema,
  type TrackingTokenQuery,
  UpdateOrderStatusSchema,
} from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Public, TenantId } from '../../common/auth';
import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
  ) {}

  // ─── Staff (POS / téléphone) ───

  @Post('orders')
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(CreateOrderSchema)) body: CreateOrder,
  ) {
    return this.orders.create(tenantId, body, user.sub);
  }

  @Get('orders')
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.list(tenantId, { status, since });
  }

  @Get('orders/:id')
  byId(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.byId(tenantId, id);
  }

  @Patch('orders/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(UpdateOrderStatusSchema)) body: { status: OrderStatus },
  ) {
    return this.orders.updateStatus(tenantId, id, body.status, user.sub);
  }

  /** Annulation — exige la re-saisie du PIN (traçabilité NF525). */
  @HttpCode(200)
  @Post('orders/:id/cancel')
  async cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { pin: string; reason?: string },
  ) {
    const staffId = await this.auth.verifyPin(tenantId, body.pin);
    return this.orders.cancel(tenantId, id, staffId, body.reason ?? '');
  }

  /** Remise — exige la re-saisie du PIN (traçabilité NF525). */
  @HttpCode(200)
  @Post('orders/:id/discount')
  async discount(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { pin: string; amount: number; reason?: string },
  ) {
    const staffId = await this.auth.verifyPin(tenantId, body.pin);
    return this.orders.discount(tenantId, id, staffId, Number(body.amount), body.reason ?? '');
  }

  // ─── Public (commande en ligne, sans compte) ───

  @Public()
  // 20 commandes/minute par adresse : aucun client réel n'y touche, un
  // script qui rembourrerait la cuisine de fausses commandes, si.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/tenants/:slug/orders')
  async createOnline(@Param('slug') slug: string, @Body(zod(CreateOrderSchema)) body: CreateOrder) {
    const tenant = await this.tenants.bySlug(slug);
    // Pause volontaire du gérant OU suspension du compte par Snack Manager :
    // même fermeture propre côté client, messages distincts (le consommateur
    // ne doit jamais lire « impayé » — le litige ne le concerne pas).
    const gate = publicOrderingState(tenant.account, {
      paused: tenant.settings?.onlineOrderingPaused ?? false,
      message: tenant.settings?.pauseMessage ?? null,
    });
    if (gate.paused) return gate;
    // Canal forcé : une commande postée sur la route publique est toujours « online »
    return this.orders.create(String(tenant._id), { ...body, channel: 'online' }, 'online');
  }

  /**
   * Suivi client — exige `?t=<trackingToken>` (remis à la création).
   * Sans jeton valide : 404, jamais 403 (voir `OrdersService.publicTracking`).
   */
  @Public()
  @Get('public/orders/:id')
  tracking(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.orders.publicTracking(id, query.t);
  }
}
