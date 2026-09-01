import { Global, Module } from '@nestjs/common';
import { supplyDb } from '@sm/supply';
import type { Pool } from 'pg';
import { POSTGRES_POOL, PostgresModule } from './postgres.module';

export const SUPPLY_DB = 'SUPPLY_DB';
export const SUPPLY_POOL = 'SUPPLY_POOL';

/** Connexion PostgreSQL (contexte supply) partagée — injecter avec @Inject(SUPPLY_DB) : SupplyDb. */
@Global()
@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: SUPPLY_DB,
      inject: [POSTGRES_POOL],
      useFactory: (pool: Pool) => supplyDb(pool),
    },
    { provide: SUPPLY_POOL, useExisting: POSTGRES_POOL },
  ],
  exports: [SUPPLY_DB, SUPPLY_POOL],
})
export class SupplyDbModule {}
