import { Module } from '@nestjs/common';
import { EncaissementModule } from '../encaissement/encaissement.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OrderingController } from './ordering.controller';
import { StripeConnectWebhookController } from './stripe-connect-webhook.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentsService } from './payments.service';
import { SiteService } from './site.service';
import { SlotsService } from './slots.service';
import { TicketService } from './ticket.service';

/**
 * Commande en ligne : créneaux de retrait, paiement Stripe optionnel,
 * impression (ticket JSON + ESC/POS) et page publique du restaurant.
 *
 * Les modèles Mongoose viennent de `DatabaseModule` (@Global).
 * Services exportés pour que la caisse et le KDS puissent réimprimer un ticket
 * ou vérifier un créneau sans repasser par HTTP.
 */
@Module({
  imports: [TenantsModule, EncaissementModule],
  // LES DEUX WEBHOOKS SONT DÉCLARÉS ICI, ET C'EST VITAL.
  //
  // `StripeWebhookController` ne l'était PAS : sa route répondait 404 en
  // production, et toute commande payée en ligne serait restée « en attente »
  // sans le moindre message — la panne que son propre en-tête décrit comme
  // celle « que ce fichier existe pour éviter ». Un contrôleur Nest n'existe
  // que s'il figure ici ; `encaissement.test.ts` le vérifie désormais.
  controllers: [OrderingController, StripeWebhookController, StripeConnectWebhookController],
  providers: [SlotsService, PaymentsService, TicketService, SiteService],
  exports: [SlotsService, TicketService, PaymentsService],
})
export class OrderingModule {}
