import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CollectOrderPaymentSchema, type CollectOrderPayment, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { OrderCounterCollectionService } from './order-counter-collection.service';

@Controller('orders')
@Fonction('orders')
@Roles('owner', 'cogerant', 'gerant', 'caisse')
export class OrderCounterController {
  constructor(private readonly collection: OrderCounterCollectionService) {}

  @Post(':id/collect')
  @HttpCode(200)
  collect(@TenantId() tenantId: string, @Param('id') id: string, @CurrentUser() actor: JwtPayload,
    @Body(zod(CollectOrderPaymentSchema)) body: CollectOrderPayment) {
    return this.collection.collect(tenantId, id, actor, body);
  }
}
