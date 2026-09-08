import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertLoyaltyMigrationsCurrent,
  LoyaltyCryptoAdapter,
  loyaltyDb,
} from '@sm/loyalty';
import { assertSupplyMigrationsCurrent } from '@sm/supply';
import { assertCustomerMigrationsCurrent } from '@sm/customer';
import type { Pool } from 'pg';
import { isDeployedRuntime } from './common/deployed-runtime';
import { POSTGRES_POOL, PostgresModule } from './postgres.module';

export const LOYALTY_DB = 'LOYALTY_DB';
export const LOYALTY_CRYPTO = 'LOYALTY_CRYPTO';

type LoyaltyPostgresRole = {
  role_name: unknown;
  rolsuper: unknown;
  rolbypassrls: unknown;
  rolcreaterole: unknown;
  rolcreatedb: unknown;
  rolreplication: unknown;
  has_role_membership: unknown;
  can_create_database_objects: unknown;
  can_create_public_schema: unknown;
  can_create_loyalty_schema: unknown;
  can_create_customer_schema: unknown;
  owns_application_objects: unknown;
};

/**
 * Les politiques FORCE RLS restent contournables par SUPERUSER et BYPASSRLS.
 * Dans tout environnement déployé, le processus utilise donc un rôle
 * applicatif ordinaire et refuse de démarrer sans confirmation exacte.
 */
export async function assertLoyaltyPostgresRoleIsRlsSafe(
  pool: Pick<Pool, 'query'>,
  runtime: Record<string, unknown>,
): Promise<void> {
  if (!isDeployedRuntime(runtime)) return;

  const expectedRole =
    typeof runtime.DATABASE_RUNTIME_ROLE === 'string'
      ? runtime.DATABASE_RUNTIME_ROLE.trim()
      : '';
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(expectedRole)) {
    throw new Error('DATABASE_RUNTIME_ROLE doit identifier le rôle PostgreSQL applicatif');
  }

  const result = await pool.query<LoyaltyPostgresRole>(`
    SELECT
      current_user::text AS role_name,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolreplication,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles parent
         WHERE parent.oid <> r.oid
           AND pg_has_role(r.oid, parent.oid, 'MEMBER')
      ) AS has_role_membership,
      has_database_privilege(r.oid, current_database(), 'CREATE') AS can_create_database_objects,
      has_schema_privilege(r.oid, 'public', 'CREATE') AS can_create_public_schema,
      COALESCE(
        has_schema_privilege(r.oid, to_regnamespace('loyalty'), 'CREATE'),
        false
      ) AS can_create_loyalty_schema,
      COALESCE(
        has_schema_privilege(r.oid, to_regnamespace('customer'), 'CREATE'),
        false
      ) AS can_create_customer_schema,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relowner = r.oid AND n.nspname IN ('public', 'loyalty', 'customer', 'drizzle')
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace n
         WHERE n.nspowner = r.oid AND n.nspname IN ('public', 'loyalty', 'customer', 'drizzle')
      ) AS owns_application_objects
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = current_user
  `);
  const role = result.rows[0];

  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    typeof role?.role_name !== 'string' ||
    role.role_name.length === 0 ||
    typeof role.rolsuper !== 'boolean' ||
    typeof role.rolbypassrls !== 'boolean' ||
    typeof role.rolcreaterole !== 'boolean' ||
    typeof role.rolcreatedb !== 'boolean' ||
    typeof role.rolreplication !== 'boolean' ||
    typeof role.has_role_membership !== 'boolean' ||
    typeof role.can_create_database_objects !== 'boolean' ||
    typeof role.can_create_public_schema !== 'boolean' ||
    typeof role.can_create_loyalty_schema !== 'boolean' ||
    typeof role.can_create_customer_schema !== 'boolean' ||
    typeof role.owns_application_objects !== 'boolean'
  ) {
    throw new Error('Impossible de confirmer le rôle PostgreSQL dédié à la fidélité');
  }

  if (
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolreplication ||
    role.has_role_membership ||
    role.can_create_database_objects ||
    role.can_create_public_schema ||
    role.can_create_loyalty_schema ||
    role.can_create_customer_schema ||
    role.owns_application_objects
  ) {
    throw new Error(
      'Le rôle PostgreSQL déployé conserve des privilèges incompatibles avec RLS',
    );
  }
  if (role.role_name !== expectedRole) {
    throw new Error('La connexion PostgreSQL n utilise pas DATABASE_RUNTIME_ROLE');
  }
}

type MigrationStateGates = {
  supply: (pool: Pick<Pool, 'query'>) => Promise<void>;
  loyalty: (pool: Pick<Pool, 'query'>) => Promise<void>;
  customer: (pool: Pick<Pool, 'query'>) => Promise<void>;
};

/** Vérifie aussi que DATABASE_URL cible exactement la base déjà migrée. */
export async function assertDeployedPostgresReady(
  pool: Pick<Pool, 'query'>,
  runtime: Record<string, unknown>,
  gates: MigrationStateGates = {
    supply: assertSupplyMigrationsCurrent,
    loyalty: assertLoyaltyMigrationsCurrent,
    customer: assertCustomerMigrationsCurrent,
  },
): Promise<void> {
  await assertLoyaltyPostgresRoleIsRlsSafe(pool, runtime);
  if (!isDeployedRuntime(runtime)) return;
  await gates.supply(pool);
  await gates.loyalty(pool);
  await gates.customer(pool);
}

@Global()
@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: LOYALTY_DB,
      inject: [POSTGRES_POOL, ConfigService],
      useFactory: async (pool: Pool, config: ConfigService) => {
        await assertDeployedPostgresReady(pool, {
          NODE_ENV: config.get('NODE_ENV'),
          RAILWAY_ENVIRONMENT_NAME: config.get('RAILWAY_ENVIRONMENT_NAME'),
          RAILWAY_ENVIRONMENT_ID: config.get('RAILWAY_ENVIRONMENT_ID'),
          DATABASE_RUNTIME_ROLE: config.get('DATABASE_RUNTIME_ROLE'),
        });
        return loyaltyDb(pool);
      },
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
