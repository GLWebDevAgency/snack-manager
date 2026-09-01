import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const POSTGRES_POOL = 'POSTGRES_POOL';

/** Un seul budget de connexions pour tous les contextes Drizzle de l'API. */
export function postgresPoolMax(raw: unknown): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : 10;
}

@Injectable()
class PostgresShutdown implements OnApplicationShutdown {
  constructor(private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POSTGRES_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: postgresPoolMax(config.get('SM_PG_POOL_MAX')),
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
        }),
    },
    {
      provide: PostgresShutdown,
      inject: [POSTGRES_POOL],
      useFactory: (pool: Pool) => new PostgresShutdown(pool),
    },
  ],
  exports: [POSTGRES_POOL],
})
export class PostgresModule {}
