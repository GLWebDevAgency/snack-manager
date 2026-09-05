import { Module } from '@nestjs/common';
import { EncaissementModule } from '../encaissement/encaissement.module';
import { TenantsModule } from '../tenants/tenants.module';
// La vitrine DÉRIVE `photoUrl` de la médiathèque (`site.service.ts`).
import { MediathequeModule } from '../mediatheque/mediatheque.module';
import { OrderingController } from './ordering.controller';
import { StripeConnectWebhookController } from './stripe-connect-webhook.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentsService } from './payments.service';
import { SiteService } from './site.service';
import { SlotsService } from './slots.service';
import { TicketService } from './ticket.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { ConfigService } from '@nestjs/config';
import { OrderRefundsService, STRIPE_REFUND_CLIENT, type RefundStripeClient } from './order-refunds.service';

/**
 * Commande en ligne : créneaux de retrait, paiement Stripe optionnel,
 * impression (ticket JSON + ESC/POS) et page publique du restaurant.
 *
 * Les modèles Mongoose viennent de `DatabaseModule` (@Global).
 * Services exportés pour que la caisse et le KDS puissent réimprimer un ticket
 * ou vérifier un créneau sans repasser par HTTP.
 */
@Module({
  imports: [TenantsModule, EncaissementModule, MediathequeModule, DeliveryModule],
  // LES DEUX WEBHOOKS SONT DÉCLARÉS ICI, ET C'EST VITAL.
  //
  // `StripeWebhookController` ne l'était PAS : sa route répondait 404 en
  // production, et toute commande payée en ligne serait restée « en attente »
  // sans le moindre message — la panne que son propre en-tête décrit comme
  // celle « que ce fichier existe pour éviter ». Un contrôleur Nest n'existe
  // que s'il figure ici ; `encaissement.test.ts` le vérifie désormais.
  controllers: [OrderingController, StripeWebhookController, StripeConnectWebhookController],
  providers: [SlotsService, PaymentsService, TicketService, SiteService, OrderRefundsService, {
    provide: STRIPE_REFUND_CLIENT,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      let client: RefundStripeClient | null = null;
      return async () => {
        const key = config.get<string>('STRIPE_SECRET_KEY');
        if (!key) return null;
        if (client) return client;
        const moduleName = 'stripe';
        const { default: Stripe } = await import(moduleName);
        client = new Stripe(key) as RefundStripeClient;
        return client;
      };
    },
  }],
  exports: [SlotsService, TicketService, PaymentsService, OrderRefundsService],
})
export class OrderingModule {}
