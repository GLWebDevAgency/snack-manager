import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { TenantsModule } from '../tenants/tenants.module';
// `SlotsService` sert à VÉRIFIER un créneau au moment de la commande, et non
// seulement à en proposer la liste : sans lui, la capacité et les fermetures
// ne valaient que dans l'écran du client.
import { OrderingModule } from '../ordering/ordering.module';
import { PublicOrderGate } from './public-order-gate';
import { OrderFinanceController } from './order-finance.controller';
import { EncaissementModule } from '../encaissement/encaissement.module';
import { OrderCounterController } from './order-counter.controller';
import { OrderCounterCollectionService } from './order-counter-collection.service';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { PublicOrderRecoveryController } from './public-order-recovery.controller';
import { OnlineOrderCheckoutService } from './online-order-checkout.service';
import { CustomerOrderHistoryService } from './customer-order-history.service';

@Module({
  imports: [TenantsModule, OrderingModule, EncaissementModule],
  controllers: [OrdersController, OrderFinanceController, OrderCounterController, PublicOrderRecoveryController],
  providers: [OrdersService, OrdersGateway, PublicOrderGate, OrderCounterCollectionService, PublicOrderAdmissionService, OnlineOrderCheckoutService, CustomerOrderHistoryService],
  exports: [OnlineOrderCheckoutService],
})
export class OrdersModule {}
