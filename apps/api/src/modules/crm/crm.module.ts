import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ComptesService } from './comptes.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ConversionService } from './conversion.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { DevisService } from './devis.service';
import { IssuerConfig } from '../billing/issuer.config';
import { OriginesImages } from '../tenants/origines-images';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { InsightsService } from './insights.service';
import { PlatformController, PublicPlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { SignalsService } from './signals.service';
import { ContactIngestGuard } from './contact-ingest.guard';
import { PublicLeadsController } from './public-leads.controller';

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
    PublicLeadsController,
    ProductionController,
  ],
  providers: [
    CrmService,
    ConversionService,
    DevisService,
    // Le devis imprime la MÊME identité d'émetteur que les factures du gérant :
    // `IssuerConfig` est sans état (huit lectures d'environnement), le fournir
    // ici aussi coûte moins qu'un couplage de modules pour un singleton de plus.
    IssuerConfig,
    // Même raison, et la même liste que la route du restaurateur : la fiche
    // client pose un masque sur le MÊME document, avec les mêmes URL d'images
    // servies aux mêmes clients. `OriginesImages` est sans état.
    OriginesImages,
    AdminService,
    // Les comptes d'un restaurant. Séparé d'`AdminService` — qui tient le STATUT
    // du compte commercial — parce que ce sont deux objets différents : l'un
    // décide si l'établissement travaille, l'autre qui peut ouvrir la porte.
    ComptesService,
    HealthService,
    InsightsService,
    BillingService,
    SignalsService,
    PlatformService,
    ProductionService,
    ContactIngestGuard,
  ],
  // `AdminService` est exporté pour que toute autre surface du CRM qui ouvre le
  // dossier d'un client puisse tracer la consultation dans le même journal
  // (`recordDetailView`) : un accès non journalisé serait un angle mort.
  //
  // `BillingService` l'est pour la même raison, en sens inverse : il porte le
  // seul chiffre qui dit si un client paie (`outstandingFor`), et l'axe
  // « paiement » du score de santé doit pouvoir le lire au lieu de le deviner.
  //
  // `SignalsService` sort pour le veilleur d'alertes (`OpsModule`) : ce qui
  // sonne la nuit doit être EXACTEMENT ce que la file /sm/signals affiche le
  // matin — deux calculs divergeraient un jour, et ce jour-là on ne saurait
  // plus lequel croire.
  exports: [AdminService, BillingService, SignalsService],
})
export class CrmModule {}
