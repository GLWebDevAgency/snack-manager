import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryOperatorsController } from './delivery-operators.controller';
import { DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryAccessController } from './delivery-access.controller';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryAccessGuard } from './delivery-access.guard';

@Module({
  controllers: [DeliveryController, DeliveryOperatorsController, DeliveryAccessController],
  providers: [DeliveryService, DeliveryOperatorsService, DeliveryAccessService, DeliveryAccessGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
