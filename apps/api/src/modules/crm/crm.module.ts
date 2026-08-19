import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

/**
 * Back-office interne Snack Manager (CRM HQ) — pipeline commercial, places
 * fondateur, MRR estimé, santé du parc client.
 *
 * Surface TRANS-TENANT réservée au rôle `sm_admin`. Les modèles Mongoose
 * (Lead, Tenant, Order) viennent du DatabaseModule global.
 */
@Module({
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
