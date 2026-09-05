import { Module } from '@nestjs/common';
import { BillingIdentityController } from './billing-identity.controller';
import { IssuerConfig } from './issuer.config';
import { MyBillingController } from './my-billing.controller';
import { MyBillingService } from './my-billing.service';
import { TenantSessionGuard } from './tenant-session.guard';
import { InvoiceCheckoutController, InvoiceCheckoutWebhookController, InvoiceOwnerGuard } from './invoice-checkout.controller';
import { InvoiceCheckoutGateway } from './invoice-checkout.gateway';
import { InvoiceCheckoutService } from './invoice-checkout.service';

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
/**
 * DEUX CONTRÔLEURS, DEUX RÉGIMES D'ACCÈS, ET C'EST VOULU.
 *
 * `MyBillingController` LIT, sous un garde dédié qui laisse passer un compte
 * suspendu ; `BillingIdentityController` ÉCRIT, sous le garde global qui le
 * refuse. Les fusionner obligerait à porter l'exception au niveau de la classe,
 * et la première route d'écriture ajoutée par distraction hériterait d'une
 * ouverture que personne n'aurait décidée.
 */
@Module({
  controllers: [MyBillingController, BillingIdentityController, InvoiceCheckoutController, InvoiceCheckoutWebhookController],
  providers: [MyBillingService, IssuerConfig, TenantSessionGuard, InvoiceOwnerGuard, InvoiceCheckoutGateway, InvoiceCheckoutService],
})
export class BillingModule {}
