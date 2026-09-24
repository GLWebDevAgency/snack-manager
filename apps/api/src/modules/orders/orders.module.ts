import { Module } from '@nestjs/common';
import { OrderRewardsModule } from './order-rewards.module';
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
import { OrderCounterRefundController } from './order-counter-refund.controller';
import { OrderCounterRefundService } from '../ordering/order-counter-refund.service';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { PublicOrderRecoveryController } from './public-order-recovery.controller';
import { OnlineOrderCheckoutService } from './online-order-checkout.service';
import { CustomerOrderHistoryService } from './customer-order-history.service';
import { DiningController } from './dining.controller';
import { DiningService } from './dining.service';
import { DiningSchemaBootstrap } from './dining-schema-bootstrap';

@Module({
  imports: [OrderRewardsModule, TenantsModule, OrderingModule, EncaissementModule],
  controllers: [OrdersController, OrderFinanceController, OrderCounterController, OrderCounterRefundController, PublicOrderRecoveryController, DiningController],
  providers: [OrdersService, OrdersGateway, PublicOrderGate, OrderCounterCollectionService, OrderCounterRefundService, PublicOrderAdmissionService, OnlineOrderCheckoutService, CustomerOrderHistoryService, DiningService, DiningSchemaBootstrap],
  exports: [OnlineOrderCheckoutService],
})
export class OrdersModule {}
