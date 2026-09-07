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

@Module({
  controllers: [DeliveryController, DeliveryOperatorsController, DeliveryAccessController, DeliveryMissionsController, DeliveryCourierMissionsController],
  providers: [DeliveryService, DeliveryOperatorsService, DeliveryAccessService, DeliveryAccessGuard, DeliveryMissionsService, DeliveryMissionsQuotaGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
