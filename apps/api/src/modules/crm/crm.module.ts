import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { InsightsService } from './insights.service';
import { PlatformController, PublicPlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SignalsService } from './signals.service';

/**
 * Back-office interne Snack Manager (CRM HQ) — pipeline commercial, places
 * fondateur, MRR estimé, santé du parc client.
 *
 * Surface TRANS-TENANT réservée au rôle `sm_admin`. Les modèles Mongoose
 * (Lead, Tenant, Order) viennent du DatabaseModule global.
 */
/**
 * Les réglages de PLATEFORME entrent dans ce module plutôt que dans un module
 * neuf : `CrmModule` est déjà déclaré dans `app.module.ts`, et l'oubli d'un
 * enregistrement s'est produit DEUX FOIS sur ce projet (ordering, screens) —
 * routes silencieusement absentes, aucun message, aucune erreur au démarrage.
 * Le contrôleur public y figure au même titre : c'est le même service, avec
 * deux régimes d'accès.
 */
@Module({
  controllers: [
    CrmController,
    AdminController,
    HealthController,
    BillingController,
    PlatformController,
    PublicPlatformController,
  ],
  providers: [
    CrmService,
    AdminService,
    HealthService,
    InsightsService,
    BillingService,
    SignalsService,
    PlatformService,
  ],
  // `AdminService` est exporté pour que toute autre surface du CRM qui ouvre le
  // dossier d'un client puisse tracer la consultation dans le même journal
  // (`recordDetailView`) : un accès non journalisé serait un angle mort.
  //
  // `BillingService` l'est pour la même raison, en sens inverse : il porte le
  // seul chiffre qui dit si un client paie (`outstandingFor`), et l'axe
  // « paiement » du score de santé doit pouvoir le lire au lieu de le deviner.
  exports: [AdminService, BillingService],
})
export class CrmModule {}
