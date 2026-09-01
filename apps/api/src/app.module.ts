import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { DatabaseModule } from './database.module';
import { RedisModule } from './redis.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { HealthController } from './modules/health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderingModule } from './modules/ordering/ordering.module';
import { EncaissementModule } from './modules/encaissement/encaissement.module';
import { SupplyDbModule } from './supply-db.module';
import { PostgresModule } from './postgres.module';
import { LoyaltyDbModule } from './loyalty-db.module';
import { SupplyModule } from './modules/supply/supply.module';
import { StatsModule } from './modules/stats/stats.module';
import { StaffModule } from './modules/staff/staff.module';
import { PlanningModule } from './modules/planning/planning.module';
import { EngageModule } from './modules/engage/engage.module';
import { SiteModule } from './modules/site/site.module';
import { ScreensModule } from './modules/screens/screens.module';
import { DevicesModule } from './modules/devices/devices.module';
import { CrmModule } from './modules/crm/crm.module';
import { BillingModule } from './modules/billing/billing.module';
import { OpsModule } from './modules/ops/ops.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { trustedClientIp } from './common/trusted-client-ip';
import { validatePublicRelayEnvironment } from './common/verified-public-relay';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validatePublicRelayEnvironment,
      // Dev local : .env à la racine du monorepo ; en prod Railway les
      // variables sont injectées directement dans l'environnement.
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URL'),
      }),
    }),
    /**
     * Limitation de débit — RÉGLAGE global, application CIBLÉE.
     *
     * Pas d'APP_GUARD : la file hors-ligne d'une caisse rejoue ses mutations
     * en rafale au retour du réseau, et un plafond global l'aurait punie pour
     * avoir fait exactement ce qu'on lui demande. Le garde est posé route par
     * route, uniquement là où la force brute paie : connexions, saisie de PIN,
     * codes d'appairage, création de commande publique.
     */
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 30 }],
      // Même frontière que les quotas Redis : Railway reconstruit X-Real-IP ;
      // X-Forwarded-For et le req.ip qui en découle ne sont jamais un tracker.
      getTracker: (request) => trustedClientIp(request),
    }),
    DatabaseModule,
    RedisModule,
    // Adaptateurs des ports (@Global) : DOMAIN_REGISTRAR, PAYMENT_GATEWAY…
    InfrastructureModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    MenuModule,
    OrdersModule,
    OrderingModule,
    /*
     * DÉCLARÉ ICI ALORS QU'`OrderingModule` L'IMPORTE DÉJÀ, ET C'EST VOLONTAIRE.
     *
     * Nest enregistre les contrôleurs des modules importés transitivement : les
     * routes `/encaissement/*` répondaient donc, mais seulement PARCE QUE le
     * module de commande a besoin du service pour savoir sur quel compte
     * encaisser. Le jour où cette dépendance disparaît — un refactoring, une
     * interface qui se déplace — le back-office perd l'écran de raccordement
     * sans qu'aucun test ne rougisse et sans qu'aucune erreur ne s'affiche :
     * juste des 404, sur les routes qui décident où va l'argent.
     *
     * Nest déduplique par référence : le déclarer deux fois ne coûte rien.
     */
    EncaissementModule,
    PostgresModule,
    SupplyDbModule,
    LoyaltyDbModule,
    LoyaltyModule,
    SupplyModule,
    StatsModule,
    StaffModule,
    // Planning des services prévus — complète `StaffModule`, qui ne connaît
    // que les pointages. Les préfixes `/staff` et `/planning` sont distincts.
    PlanningModule,
    EngageModule,
    SiteModule,
    ScreensModule,
    DevicesModule,
    CrmModule,
    // Facturation vue par le gérant (`/billing/me`) — distincte du CRM, qui la
    // voit côté équipe. Déclarée APRÈS `CrmModule` sans que l'ordre compte :
    // les préfixes `/billing` et `/crm` ne se recouvrent pas.
    BillingModule,
    // Exploitation : journal d'erreurs (filtre global + guichet public) et
    // veilleur d'alertes — le filet P0 du diagnostic quatre casquettes.
    OpsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
