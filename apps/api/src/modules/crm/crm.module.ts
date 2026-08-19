import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
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
  controllers: [CrmController, AdminController],
  providers: [CrmService, AdminService],
  // `AdminService` est exporté pour que toute autre surface du CRM qui ouvre le
  // dossier d'un client puisse tracer la consultation dans le même journal
  // (`recordDetailView`) : un accès non journalisé serait un angle mort.
  exports: [AdminService],
})
export class CrmModule {}
