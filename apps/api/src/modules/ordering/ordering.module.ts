import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { OrderingController } from './ordering.controller';
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
  imports: [TenantsModule],
  controllers: [OrderingController],
  providers: [SlotsService, PaymentsService, TicketService, SiteService],
  exports: [SlotsService, TicketService, PaymentsService],
})
export class OrderingModule {}
