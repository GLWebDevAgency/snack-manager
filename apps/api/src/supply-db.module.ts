import { Global, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSupplyDb, type SupplyDb } from '@sm/supply';
import type { Pool } from 'pg';

export const SUPPLY_DB = 'SUPPLY_DB';
export const SUPPLY_POOL = 'SUPPLY_POOL';

/** Connexion PostgreSQL (contexte supply) partagée — injecter avec @Inject(SUPPLY_DB) : SupplyDb. */
@Global()
@Module({
  providers: [
    {
      provide: 'SUPPLY_CONN',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createSupplyDb(config.getOrThrow<string>('DATABASE_URL')),
    },
    { provide: SUPPLY_DB, inject: ['SUPPLY_CONN'], useFactory: (c: { db: SupplyDb }) => c.db },
    { provide: SUPPLY_POOL, inject: ['SUPPLY_CONN'], useFactory: (c: { pool: Pool }) => c.pool },
  ],
  exports: [SUPPLY_DB, SUPPLY_POOL],
})
export class SupplyDbModule implements OnApplicationShutdown {
  constructor(@Inject(SUPPLY_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
