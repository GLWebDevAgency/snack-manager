import { Module } from '@nestjs/common';
import { IssuerConfig } from './issuer.config';
import { MyBillingController } from './my-billing.controller';
import { MyBillingService } from './my-billing.service';
import { TenantSessionGuard } from './tenant-session.guard';

/**
 * « ABONNEMENT » — la facturation vue par le RESTAURATEUR.
 *
 * Module distinct de `CrmModule`, et non un contrôleur de plus à l'intérieur :
 * les deux surfaces n'ont ni le même public, ni le même cloisonnement, ni le
 * même garde. `CrmModule` est trans-tenant et réservé à `sm_admin` ; celui-ci
 * est tenant-scopé, réservé au gérant, et c'est le seul de toute l'API qui
 * reste accessible à un établissement SUSPENDU. Mélanger les deux dans un même
 * module ferait cohabiter, à deux lignes d'écart, une règle d'accès et son
 * exception — la prochaine relecture s'y tromperait.
 *
 * Aucune dépendance : les modèles Mongoose viennent de `DatabaseModule`
 * (@Global), `JwtService` du `JwtModule` global d'`AuthModule`, et
 * `ConfigService` du `ConfigModule` global.
 */
@Module({
  controllers: [MyBillingController],
  providers: [MyBillingService, IssuerConfig, TenantSessionGuard],
})
export class BillingModule {}
