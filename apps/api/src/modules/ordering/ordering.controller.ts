import { Controller, Get, HttpCode, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  SlotsQuerySchema,
  TicketRequestQuerySchema,
  TrackingTokenQuerySchema,
  type SlotsQuery,
  type TicketRequestQuery,
  type TrackingTokenQuery,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public } from '../../common/auth';
import { TenantsService } from '../tenants/tenants.service';
import { PaymentsService } from './payments.service';
import { SiteService } from './site.service';
import { SlotsService } from './slots.service';
import { TicketService } from './ticket.service';

/**
 * Routes publiques de la commande en ligne (aucun compte requis).
 * Le tenant est résolu par son `slug` d'URL ; aucune de ces routes n'accepte
 * de `tenantId` — les routes authentifiées le prennent toujours dans le JWT.
 *
 * `POST /public/tenants/:slug/orders` vit dans `OrdersController` : la création
 * de commande reste la propriété du module Orders.
 */
@Controller()
export class OrderingController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly slots: SlotsService,
    private readonly payments: PaymentsService,
    private readonly tickets: TicketService,
    private readonly site: SiteService,
  ) {}

  /**
   * Créneaux de retrait d'une journée (défaut : aujourd'hui, heure du restaurant).
   * Renvoie toujours 200 : fermé ⇒ `closedToday` + `nextOpenDate`.
   */
  @Public()
  @Get('public/tenants/:slug/slots')
  async slotsForDay(@Param('slug') slug: string, @Query(zod(SlotsQuerySchema)) query: SlotsQuery) {
    const tenant = await this.tenants.bySlug(slug);
    return this.slots.compute(tenant, query.date, query.fulfillment);
  }

  /**
   * PaymentIntent Stripe d'une commande déjà créée.
   * Sans Stripe configuré : `{ unavailable: true, reason }` en 200 — le
   * passage au comptoir exige une confirmation serveur séparée, jamais un
   * simple changement local du choix de paiement.
   */
  @Public()
  @HttpCode(200)
  @Post('public/orders/:id/payment-intent')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  paymentIntent(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.payments.createIntent(id, query.t);
  }

  /** Same pickup order; the tracking secret authorizes a request, not a receipt. */
  @Public()
  @HttpCode(200)
  @Post('public/orders/:id/payment-counter')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  counterPayment(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.payments.switchToCounterPayment(id, query.t);
  }

  /**
   * Ticket imprimable, en JSON structuré (aperçu web, caisse, KDS).
   * Exige `?t=<trackingToken>` : le ticket porte le nom et le téléphone du
   * client, l'ObjectId seul ne suffit pas à l'ouvrir.
   */
  @Public()
  @Get('public/orders/:id/ticket')
  ticket(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.tickets.build(id, query.t);
  }

  /**
   * Même ticket, encodé en commandes ESC/POS prêtes à être poussées vers une
   * imprimante thermique. `?t=<trackingToken>` obligatoire, puis
   * `?width=32|42|48`, `?cut=partial|full|none`,
   * `?variant=customer|kitchen` (bon cuisine sans prix).
   */
  @Public()
  @Get('public/orders/:id/escpos')
  async escpos(
    @Param('id') id: string,
    @Query(zod(TicketRequestQuerySchema)) query: TicketRequestQuery,
  ): Promise<StreamableFile> {
    const ticket = await this.tickets.build(id, query.t);
    const buffer = this.tickets.render(ticket, query);
    return new StreamableFile(buffer, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="ticket-${ticket.pickupNumber}.bin"`,
      length: buffer.length,
    });
  }

  /** Page publique du restaurant en un appel (tenant, menu, créneaux, avis, pause). */
  @Public()
  @Get('public/tenants/:slug/site')
  publicSite(@Param('slug') slug: string, @Query(zod(SlotsQuerySchema)) query: SlotsQuery) {
    return this.site.build(slug, query.date);
  }
}
