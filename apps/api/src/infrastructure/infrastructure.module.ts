import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { configSourceOf } from './config-source';
import { createDomainRegistrar } from './domains/domain-registrar.factory';
import { RedisEventPublisher } from './events/redis-event-publisher';
import { MongoTenantIdLookup, TENANT_ID_LOOKUP } from './events/tenant-id-lookup';
import { createPaymentGateway } from './payments/payment-gateway.factory';
import { Argon2SecretHasher } from './security/argon2-secret-hasher';
import { DOMAIN_REGISTRAR, EVENT_PUBLISHER, PAYMENT_GATEWAY, SECRET_HASHER } from './tokens';

/**
 * L'autre moitié de l'hexagone : les adaptateurs, et rien d'autre.
 *
 * Aucun `@Injectable` métier ici. Ce module ne fait qu'une chose : décider quelle
 * implémentation concrète répond derrière chaque port, et la publier sous son
 * jeton. Les modules applicatifs demandent `DOMAIN_REGISTRAR` ou
 * `PAYMENT_GATEWAY` sans jamais nommer Railway ni Stripe — c'est ce qui permet
 * de changer de fournisseur en changeant une variable d'environnement.
 *
 * `@Global` volontairement, comme `RedisModule` et `DatabaseModule` : ces
 * dépendances sortantes sont des singletons de processus, les réimporter dans
 * chaque module n'apporterait qu'une liste à maintenir.
 *
 * ⚠️ Câblage : ajouter `InfrastructureModule` aux `imports` de `AppModule`.
 *
 * Aucune fabrique ne lève au démarrage : une variable manquante dégrade la
 * fonctionnalité concernée et laisse le service tourner. Une API qui refuse de
 * démarrer un vendredi soir pour un jeton Cloudflare expiré, c'est une caisse
 * morte pour une option que personne n'utilise ce soir-là.
 */
@Global()
@Module({
  providers: [
    {
      provide: DOMAIN_REGISTRAR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDomainRegistrar(configSourceOf(config)),
    },
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createPaymentGateway(configSourceOf(config)),
    },
    { provide: TENANT_ID_LOOKUP, useClass: MongoTenantIdLookup },
    { provide: EVENT_PUBLISHER, useClass: RedisEventPublisher },
    { provide: SECRET_HASHER, useClass: Argon2SecretHasher },
  ],
  exports: [DOMAIN_REGISTRAR, PAYMENT_GATEWAY, EVENT_PUBLISHER, SECRET_HASHER, TENANT_ID_LOOKUP],
})
export class InfrastructureModule {}
