import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryOperatorsController } from './delivery-operators.controller';
import { DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryAccessController } from './delivery-access.controller';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryMissionsController, DeliveryCourierMissionsController } from './delivery-missions.controller';
import { DeliveryMissionsService } from './delivery-missions.service';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';
import { DeliveryHandoffService } from './delivery-handoff.service';
import { DeliveryHandoffController, DeliveryCourierHandoffController, DeliveryCustomerProofController, DeliveryProofQuotaGuard } from './delivery-handoff.controller';

@Module({
  controllers: [DeliveryController, DeliveryOperatorsController, DeliveryAccessController, DeliveryMissionsController, DeliveryCourierMissionsController,
    DeliveryHandoffController, DeliveryCourierHandoffController, DeliveryCustomerProofController],
  providers: [DeliveryService, DeliveryOperatorsService, DeliveryAccessService, DeliveryAccessGuard, DeliveryMissionsService, DeliveryMissionsQuotaGuard,
    DeliveryHandoffService, DeliveryProofQuotaGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
