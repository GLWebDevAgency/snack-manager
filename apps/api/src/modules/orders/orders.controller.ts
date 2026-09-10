import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreatePublicOrder,
  CreatePublicOrderSchema,
  CreateStaffOrderSchema,
  StaffPhoneOrderAttemptRequestSchema,
  type StaffPhoneOrderAttemptRequest,
  type OrderCancel,
  OrderCancelSchema,
  type OrderDiscount,
  OrderDiscountSchema,
  type CreateOrder,
  type JwtPayload,
  ORDER_READ_ROLES,
  type OrderStatus,
  TrackingTokenQuerySchema,
  type TrackingTokenQuery,
  UpdateOrderStatusSchema,
} from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { SlotsService } from '../ordering/slots.service';
import { PublicOrderGate } from './public-order-gate';
import { Fonction } from '../../common/capacites';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { executeOnlineCheckout } from './online-order-checkout.service';

@Controller()
@Fonction('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly slots: SlotsService,
    private readonly publicOrderGate: PublicOrderGate,
    @Optional() private readonly admissions?: PublicOrderAdmissionService,
    @Optional() private readonly recoveryQuota?: SharedPublicQuota,
  ) {}

  // ─── Staff (POS / téléphone) ───
  //
  // AUCUNE de ces routes ne portait de rôle, et l'absence de `@Roles` vaut
  // « tout rôle authentifié » : un code cuisine atteignait la prise de
  // commande, l'annulation et la remise. Chaque route dit désormais qui elle
  // sert, et le dit explicitement — y compris quand la réponse est « tout le
  // monde », qui est une décision et non un oubli.

  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/slots')
  async staffSlots(@TenantId() tenantId: string, @Query('date') date?: string) {
    const tenant = await this.orders.tenantForStaffSlots(tenantId);
    return { tenantId, ...await this.slots.compute(tenant, date, 'pickup', 'staff') };
  }

  @Roles('owner', 'gerant', 'caisse')
  @HttpCode(200)
  @Post('orders/recovery')
  staffRecovery(@TenantId() tenantId: string, @Body(zod(StaffPhoneOrderAttemptRequestSchema)) body: StaffPhoneOrderAttemptRequest) {
    return this.orders.staffAttempt(tenantId, body, false);
  }

  @Roles('owner', 'gerant', 'caisse')
  @HttpCode(200)
  @Post('orders/abandon')
  staffAbandon(@TenantId() tenantId: string, @Body(zod(StaffPhoneOrderAttemptRequestSchema)) body: StaffPhoneOrderAttemptRequest) {
    return this.orders.staffAttempt(tenantId, body, true);
  }

  /** La cuisine ne prend pas les commandes : elle les prépare. */
  @Roles('owner', 'gerant', 'caisse')
  @Post('orders')
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(CreateStaffOrderSchema)) body: CreateOrder,
  ) {
    // Le pilote livre uniquement les commandes passées par le checkout :
    // c'est cette porte qui réserve la capacité et exige le paiement Stripe.
    // Les appareils continuent à lire/préparer ces tickets, sans pouvoir
    // créer une livraison qui contournerait les contrôles du parcours public.
    if (body.type === 'delivery') {
      throw new ForbiddenException('La livraison se réserve depuis le parcours de commande en ligne');
    }
    return this.orders.create(tenantId, body, user.sub, user.deviceId ?? null);
  }

  /** Tout l'équipage lit la file : c'est l'écran de travail du KDS. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders')
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.list(tenantId, { status, since });
  }

  /** Même périmètre que la liste, sans charger jusqu'à 200 commandes. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders/count')
  count(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.count(tenantId, { status, since });
  }

  /**
   * Réconciliation exacte d'une vente créée par une caisse hors ligne.
   *
   * La liste opérationnelle est volontairement plafonnée. Elle ne peut donc
   * pas servir de preuve qu'une ancienne commande synchronisée existe encore
   * dans un restaurant à fort débit. Le `clientId` UUID est la clé
   * d'idempotence du poste et la recherche reste strictement tenant-scopée.
   */
  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId/loyalty')
  async loyaltyEarnStatus(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const status = await this.orders.loyaltyEarnStatusByClientId(tenantId, clientId);
    if (!status) throw new NotFoundException('Commande introuvable');
    return status;
  }

  @Roles('owner', 'cogerant', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId')
  async byClientId(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const order = await this.orders.findByClientId(tenantId, clientId);
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  @Roles(...ORDER_READ_ROLES)
  @Get('orders/:id')
  byId(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.byId(tenantId, id);
  }

  /**
   * La cuisine peut préparer et marquer prêt. Le service distingue la remise
   * au client, réservée au comptoir/gestion : transmettre l'identité complète
   * permet de faire ce contrôle avant toute mutation ou réponse idempotente.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Patch('orders/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(UpdateOrderStatusSchema)) body: { status: OrderStatus },
  ) {
    return this.orders.updateStatus(tenantId, id, body.status, user);
  }

  /**
   * Annulation — exige la re-saisie du PIN (traçabilité NF525).
   *
   * Le rôle du valideur est vérifié EN PLUS du code : annuler une commande la
   * sort de la recette du jour, et c'est un geste de comptoir, pas de cuisine.
   * Re-saisir un code prouve qui agit, jamais que cette personne en a le droit.
   */
  /*
   * Le JETON reste ouvert à tout l'équipage, et c'est voulu : la tablette est
   * en session « caisse » quand le gérant vient taper SON code par-dessus.
   * Restreindre ici empêcherait le gérant d'autoriser quoi que ce soit depuis
   * le comptoir. C'est le PIN re-saisi qui décide, pas la session ouverte.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/cancel')
  async cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderCancelSchema)) body: OrderCancel,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    if (valideur.role === 'cuisine') {
      throw new ForbiddenException(
        'Ce code ne permet pas d’annuler une commande — demandez à la caisse ou au gérant.',
      );
    }
    return this.orders.cancel(tenantId, id, valideur, body.reason);
  }

  /**
   * Remise — exige la re-saisie du PIN ET le droit d'accorder ce montant.
   *
   * Le corps n'était pas validé, le motif était facultatif, le rôle n'était pas
   * lu et le seul plafond était le sous-total : un code cuisine offrait la
   * commande entière sans motif. Le montant se juge maintenant dans le domaine,
   * contre `REMISE_PLAFOND_CENTS`.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/discount')
  async discount(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderDiscountSchema)) body: OrderDiscount,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    return this.orders.discount(tenantId, id, valideur, body.amount, body.reason);
  }

  // ─── Public (commande en ligne, sans compte) ───

  @Public()
  // 20 commandes/minute par adresse : aucun client réel n'y touche, un
  // script qui rembourrerait la cuisine de fausses commandes, si.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/tenants/:slug/orders')
  async createOnline(
    @Param('slug') slug: string,
    @Body(zod(CreatePublicOrderSchema)) body: CreatePublicOrder,
    @Req() request?: Request,
  ) {
    return executeOnlineCheckout({ orders: this.orders, tenants: this.tenants, slots: this.slots,
      publicOrderGate: this.publicOrderGate, admissions: this.admissions, recoveryQuota: this.recoveryQuota }, slug, body, request);
  }

  /**
   * Suivi client — exige `?t=<trackingToken>` (remis à la création).
   * Sans jeton valide : 404, jamais 403 (voir `OrdersService.publicTracking`).
   */
  @Public()
  @Get('public/tenants/:slug/orders/:id/reorder')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reorder(@Param('slug') slug: string, @Param('id') id: string, @Query('t') token: unknown) {
    return this.orders.publicReorder(slug, id, token);
  }

  @Public()
  @Get('public/orders/:id')
  tracking(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.orders.publicTracking(id, query.t);
  }
}
