import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
      useFactory: (config: ConfigService) => new Redis(config.getOrThrow<string>('REDIS_URL')),
    },
    {
      provide: REDIS_SUB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis(config.getOrThrow<string>('REDIS_URL')),
    },
  ],
  exports: [REDIS_PUB, REDIS_SUB],
})
export class RedisModule {}
