import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SharedPublicQuota } from './common/shared-public-quota';

export const REDIS_PUB = 'REDIS_PUB';
export const REDIS_SUB = 'REDIS_SUB';

// Deux connexions distinctes : une connexion ioredis passée en mode
// subscriber ne peut plus émettre de commandes classiques.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_PUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Les écritures publiques échouent fermées sur Redis : elles doivent
          // toutefois rendre un 503 borné, pas attendre tout le rush.
          connectTimeout: 5_000,
          commandTimeout: 5_000,
          maxRetriesPerRequest: 1,
        }),
    },
    {
      provide: REDIS_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis(config.getOrThrow<string>('REDIS_URL')),
    },
    {
      provide: SharedPublicQuota,
      inject: [REDIS_PUB],
      useFactory: (redis: Redis) => new SharedPublicQuota(redis),
    },
  ],
  exports: [REDIS_PUB, REDIS_SUB, SharedPublicQuota],
})
export class RedisModule {}
