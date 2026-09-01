import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoyaltyCryptoAdapter, loyaltyDb } from '@sm/loyalty';
import type { Pool } from 'pg';
import { POSTGRES_POOL, PostgresModule } from './postgres.module';

export const LOYALTY_DB = 'LOYALTY_DB';
export const LOYALTY_CRYPTO = 'LOYALTY_CRYPTO';

@Global()
@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: LOYALTY_DB,
      inject: [POSTGRES_POOL],
      useFactory: (pool: Pool) => loyaltyDb(pool),
    },
    {
      provide: LOYALTY_CRYPTO,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LoyaltyCryptoAdapter({
          encryptionKeyBase64: config.getOrThrow<string>(
            'LOYALTY_PROFILE_ENCRYPTION_KEY_V1',
          ),
          phoneLookupKeyBase64: config.getOrThrow<string>('LOYALTY_PHONE_LOOKUP_KEY'),
          operationFingerprintKeyBase64: config.getOrThrow<string>(
            'LOYALTY_OPERATION_FINGERPRINT_KEY',
          ),
          qrTokenDerivationKeyBase64: config.getOrThrow<string>(
            'LOYALTY_QR_DERIVATION_KEY',
          ),
          encryptionKeyVersion: Number(config.get('LOYALTY_PROFILE_KEY_VERSION') ?? 1),
        }),
    },
  ],
  exports: [LOYALTY_DB, LOYALTY_CRYPTO],
})
export class LoyaltyDbModule {}
