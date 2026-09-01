import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loyaltyDb } from './client';

const adminUrl = process.env.LOYALTY_TEST_DATABASE_URL;
const integration = adminUrl ? describe : describe.skip;
const appPassword = 'loyalty-test-only';

let adminPool: Pool;
let appPool: Pool;

async function withTenant<T>(
  tenantRef: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_ref', $1, true)`, [tenantRef]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

integration('migration PostgreSQL fidélité', () => {
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    const databaseName = url.pathname.slice(1);
    if (!/^snackmanager_loyalty_test_[a-z0-9_]+$/.test(databaseName)) {
      throw new Error(
        'La suite fidélité refuse toute base sans préfixe snackmanager_loyalty_test_',
      );
    }

    adminPool = new Pool({ connectionString: adminUrl, max: 4 });
    await migrate(loyaltyDb(adminPool), {
      migrationsFolder: resolve(__dirname, '../drizzle'),
      migrationsTable: '__drizzle_loyalty_migrations',
    });

    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loyalty_app_test') THEN
          CREATE ROLE loyalty_app_test LOGIN PASSWORD '${appPassword}';
        END IF;
      END
      $$;
      GRANT CONNECT ON DATABASE "${databaseName}" TO loyalty_app_test;
      GRANT USAGE ON SCHEMA loyalty TO loyalty_app_test;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loyalty TO loyalty_app_test;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA loyalty TO loyalty_app_test;
    `);

    const appUrl = new URL(adminUrl!);
    appUrl.username = 'loyalty_app_test';
    appUrl.password = appPassword;
    appPool = new Pool({ connectionString: appUrl.toString(), max: 6 });
  }, 20_000);

  afterAll(async () => {
    await appPool?.end();
    await adminPool?.end();
  });

  it('applique le schéma et masque toute ligne sans contexte tenant', async () => {
    const tenant = 'tenant-a';
    const program = '10000000-0000-4000-8000-000000000001';

    await withTenant(tenant, async (client) => {
      await client.query(
        `INSERT INTO loyalty.programs (id, tenant_ref, status, current_version)
         VALUES ($1, $2, 'active', 1)`,
        [program, tenant],
      );
      await client.query(
        `INSERT INTO loyalty.program_versions
          (tenant_ref, program_id, version, name, mechanism, minimum_purchase_cents,
           spend_step_cents, units_per_step, unit_label_singular, unit_label_plural, terms_summary)
         VALUES ($1, $2, 1, 'Classfood Club', 'points', 0, 100, 1, 'point', 'points', 'v1')`,
        [tenant, program],
      );
    });

    await expect(appPool.query('SELECT * FROM loyalty.programs')).resolves.toMatchObject({
      rowCount: 0,
    });
    await withTenant('tenant-b', async (client) => {
      const hidden = await client.query('SELECT * FROM loyalty.programs');
      expect(hidden.rowCount).toBe(0);
      await expect(
        client.query(
          `INSERT INTO loyalty.programs (tenant_ref, status, current_version)
           VALUES ('tenant-a', 'draft', 1)`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('sérialise deux gains concurrents sans casser le wallet ni le ledger', async () => {
    const tenant = 'tenant-a';
    const program = '10000000-0000-4000-8000-000000000001';
    const member = '20000000-0000-4000-8000-000000000001';
    const joinedOperation = '30000000-0000-4000-8000-000000000001';

    await withTenant(tenant, async (client) => {
      await client.query(
        `INSERT INTO loyalty.operations
          (tenant_ref, operation_id, kind, request_fingerprint, status, result, completed_at)
         VALUES ($1, $2, 'member_create', 'hmac:joined', 'completed', '{"member":"created"}', now())`,
        [tenant, joinedOperation],
      );
      await client.query(`INSERT INTO loyalty.members (id, tenant_ref) VALUES ($1, $2)`, [
        member,
        tenant,
      ]);
      await client.query(
        `INSERT INTO loyalty.membership_events
          (tenant_ref, member_id, operation_id, kind, terms_notice_version, source)
         VALUES ($1, $2, $3, 'joined', 'terms-2026-09', 'standalone')`,
        [tenant, member, joinedOperation],
      );
      await client.query(
        `INSERT INTO loyalty.wallets (tenant_ref, member_id, program_id)
         VALUES ($1, $2, $3)`,
        [tenant, member, program],
      );
    });

    const earn = async (operationId: string, units: number) =>
      withTenant(tenant, async (client) => {
        await client.query(
          `INSERT INTO loyalty.operations
            (tenant_ref, operation_id, kind, request_fingerprint)
           VALUES ($1, $2, 'earn', $3)`,
          [tenant, operationId, `hmac:${operationId}`],
        );
        const wallet = await client.query<{ balance_units: string; version: string }>(
          `UPDATE loyalty.wallets
             SET balance_units = balance_units + $4,
                 lifetime_earned_units = lifetime_earned_units + $4,
                 version = version + 1,
                 updated_at = now()
           WHERE tenant_ref = $1 AND member_id = $2 AND program_id = $3
           RETURNING balance_units, version`,
          [tenant, member, program, units],
        );
        const next = wallet.rows[0]!;
        await client.query(
          `INSERT INTO loyalty.ledger_entries
            (tenant_ref, member_id, program_id, operation_id, kind, delta_units,
             balance_after, source, rules_version, wallet_version, occurred_at)
           VALUES ($1, $2, $3, $4, 'earn', $5, $6, 'standalone', 1, $7, now())`,
          [tenant, member, program, operationId, units, next.balance_units, next.version],
        );
        await client.query(
          `UPDATE loyalty.operations
              SET status = 'completed', result = jsonb_build_object('balance', $3::integer), completed_at = now()
            WHERE tenant_ref = $1 AND operation_id = $2`,
          [tenant, operationId, next.balance_units],
        );
      });

    await Promise.all([
      earn('30000000-0000-4000-8000-000000000010', 10),
      earn('30000000-0000-4000-8000-000000000020', 20),
    ]);

    await withTenant(tenant, async (client) => {
      const wallet = await client.query(
        `SELECT balance_units, version FROM loyalty.wallets
          WHERE tenant_ref = $1 AND member_id = $2 AND program_id = $3`,
        [tenant, member, program],
      );
      expect(wallet.rows[0]).toMatchObject({ balance_units: '30', version: '2' });
      const ledger = await client.query(
        `SELECT wallet_version, balance_after FROM loyalty.ledger_entries
          WHERE tenant_ref = $1 AND member_id = $2 AND program_id = $3
          ORDER BY wallet_version`,
        [tenant, member, program],
      );
      expect(ledger.rows).toEqual([
        { wallet_version: '1', balance_after: '10' },
        { wallet_version: '2', balance_after: '30' },
      ]);
    });
  });

  it('interdit réécriture, saut de ledger et fausse compensation', async () => {
    const tenant = 'tenant-a';
    const program = '10000000-0000-4000-8000-000000000001';
    const member = '20000000-0000-4000-8000-000000000001';

    await expect(
      withTenant(tenant, async (client) => {
        await client.query(`UPDATE loyalty.program_versions SET name = 'Réécrit'`);
      }),
    ).rejects.toMatchObject({ code: '55000' });

    await expect(
      withTenant(tenant, async (client) => {
        const origin = await client.query<{ id: string }>(
          `SELECT id FROM loyalty.ledger_entries WHERE wallet_version = 1`,
        );
        const operation = '30000000-0000-4000-8000-000000000030';
        await client.query(
          `INSERT INTO loyalty.operations
            (tenant_ref, operation_id, kind, request_fingerprint)
           VALUES ($1, $2, 'reverse', 'hmac:bad-reverse')`,
          [tenant, operation],
        );
        const wallet = await client.query<{ balance_units: string; version: string }>(
          `UPDATE loyalty.wallets SET balance_units = balance_units - 5, version = version + 1
            WHERE tenant_ref = $1 AND member_id = $2 AND program_id = $3
            RETURNING balance_units, version`,
          [tenant, member, program],
        );
        await client.query(
          `INSERT INTO loyalty.ledger_entries
            (tenant_ref, member_id, program_id, operation_id, kind, delta_units,
             balance_after, source, rules_version, wallet_version, reversed_entry_id, occurred_at)
           VALUES ($1, $2, $3, $4, 'reverse', -5, $5, 'admin', 1, $6, $7, now())`,
          [
            tenant,
            member,
            program,
            operation,
            wallet.rows[0]!.balance_units,
            wallet.rows[0]!.version,
            origin.rows[0]!.id,
          ],
        );
      }),
    ).rejects.toMatchObject({ code: '23514' });

    await withTenant(tenant, async (client) => {
      const wallet = await client.query(`SELECT balance_units, version FROM loyalty.wallets`);
      expect(wallet.rows[0]).toMatchObject({ balance_units: '30', version: '2' });
      await expect(client.query(`UPDATE loyalty.ledger_entries SET reason = 'réécrit'`)).rejects.toMatchObject({
        code: '55000',
      });
    });

    await withTenant(tenant, async (client) => {
      await client.query(
        `INSERT INTO loyalty.earn_receipts
          (tenant_ref, source, external_ref, operation_id, member_id)
         VALUES ($1, 'standalone', 'ticket-schema-append-only', $2, $3)`,
        [tenant, '30000000-0000-4000-8000-000000000010', member],
      );
    });
    await expect(
      withTenant(tenant, async (client) => {
        await client.query(
          `UPDATE loyalty.earn_receipts
              SET external_ref = 'ticket-schema-rewritten'
            WHERE tenant_ref = $1 AND external_ref = 'ticket-schema-append-only'`,
          [tenant],
        );
      }),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(appPool.query('SELECT * FROM loyalty.earn_receipts')).resolves.toMatchObject({
      rowCount: 0,
    });
    await withTenant('tenant-b', async (client) => {
      const hidden = await client.query('SELECT * FROM loyalty.earn_receipts');
      expect(hidden.rowCount).toBe(0);
      await expect(
        client.query(
          `INSERT INTO loyalty.earn_receipts
            (tenant_ref, source, external_ref, operation_id, member_id)
           VALUES ($1, 'standalone', 'ticket-cross-tenant', $2, $3)`,
          [tenant, '30000000-0000-4000-8000-000000000010', member],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('refuse à la validation différée une version courante inexistante', async () => {
    await expect(
      withTenant('tenant-invalid', async (client) => {
        const program = '10000000-0000-4000-8000-000000000099';
        await client.query(
          `INSERT INTO loyalty.programs (id, tenant_ref, current_version)
           VALUES ($1, 'tenant-invalid', 2)`,
          [program],
        );
        await client.query(
          `INSERT INTO loyalty.program_versions
            (tenant_ref, program_id, version, name, mechanism, spend_step_cents,
             units_per_step, unit_label_singular, unit_label_plural)
           VALUES ('tenant-invalid', $1, 1, 'Invalide', 'points', 100, 1, 'point', 'points')`,
          [program],
        );
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('exige un motif lifecycle non nul et un seul QR actif par membre', async () => {
    const tenant = `guard-${randomUUID()}`;
    const member = randomUUID();
    const joinedOperation = randomUUID();

    await withTenant(tenant, async (client) => {
      await client.query(
        `INSERT INTO loyalty.operations
          (tenant_ref, operation_id, kind, request_fingerprint, status, result, completed_at)
         VALUES ($1, $2, 'member_create', 'hmac:joined', 'completed', '{}', now())`,
        [tenant, joinedOperation],
      );
      await client.query(
        `INSERT INTO loyalty.members (id, tenant_ref) VALUES ($1, $2)`,
        [member, tenant],
      );
      await client.query(
        `INSERT INTO loyalty.membership_events
          (tenant_ref, member_id, operation_id, kind, terms_notice_version, source)
         VALUES ($1, $2, $3, 'joined', 'terms-2026-09', 'standalone')`,
        [tenant, member, joinedOperation],
      );
      await client.query(
        `INSERT INTO loyalty.member_tokens (tenant_ref, member_id, token_hash)
         VALUES ($1, $2, 'hash-active-1')`,
        [tenant, member],
      );
    });

    await expect(
      withTenant(tenant, async (client) => {
        const lifecycleOperation = randomUUID();
        await client.query(
          `INSERT INTO loyalty.operations
            (tenant_ref, operation_id, kind, request_fingerprint)
           VALUES ($1, $2, 'member_lifecycle', 'hmac:lifecycle')`,
          [tenant, lifecycleOperation],
        );
        await client.query(
          `INSERT INTO loyalty.membership_events
            (tenant_ref, member_id, operation_id, kind, reason, source)
           VALUES ($1, $2, $3, 'blocked', NULL, 'admin')`,
          [tenant, member, lifecycleOperation],
        );
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'membership_events_terms_shape',
    });

    await expect(
      withTenant(tenant, async (client) => {
        await client.query(
          `INSERT INTO loyalty.member_tokens (tenant_ref, member_id, token_hash)
           VALUES ($1, $2, 'hash-active-2')`,
          [tenant, member],
        );
      }),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'member_tokens_one_active_uq',
    });
  });

  it('ferme explicitement les opérations antérieures lors du cutover de remise', async () => {
    const tenant = `cutover-${randomUUID()}`;
    const completedOperation = randomUUID();
    const pendingOperation = randomUUID();
    const completedMember = randomUUID();
    const pendingMember = randomUUID();
    await adminPool.query(
      `INSERT INTO loyalty.operations
        (tenant_ref, operation_id, kind, request_fingerprint, status, result, completed_at)
       VALUES
        ($1, $2, 'member_create', 'old-create-fingerprint', 'completed',
          jsonb_build_object('memberId', $3::text, 'qrTokenHash', repeat('a', 64)), now()),
        ($1, $4, 'member_create', 'old-pending-fingerprint', 'pending', NULL, NULL)`,
      [tenant, completedOperation, completedMember, pendingOperation],
    );
    await adminPool.query(
      `INSERT INTO loyalty.members (id, tenant_ref, enrollment_handoff_at)
       VALUES ($1, $3, NULL), ($2, $3, NULL)`,
      [completedMember, pendingMember, tenant],
    );

    const migration = readFileSync(
      resolve(__dirname, '../drizzle/0005_cynical_scalphunter.sql'),
      'utf8',
    );
    const statements = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim());
    const memberBackfill = statements.find((statement) =>
      statement.startsWith('UPDATE "loyalty"."members"'),
    );
    const operationCutover = statements.find((statement) =>
      statement.startsWith('-- Le protocole précédent'),
    );
    if (!memberBackfill || !operationCutover) {
      throw new Error('Migration 0005 incomplète');
    }
    await adminPool.query(memberBackfill);
    await adminPool.query(operationCutover);

    const operationsAfter = await adminPool.query<{
      operation_id: string;
      request_fingerprint: string;
      status: string;
      result: Record<string, unknown>;
      completed: boolean;
    }>(
      `SELECT operation_id::text, request_fingerprint, status::text, result,
              completed_at IS NOT NULL AS completed
         FROM loyalty.operations
        WHERE tenant_ref = $1
        ORDER BY operation_id`,
      [tenant],
    );
    expect(operationsAfter.rows).toHaveLength(2);
    for (const operation of operationsAfter.rows) {
      expect(operation).toMatchObject({
        request_fingerprint: '0'.repeat(64),
        status: 'completed',
        result: { enrollmentCutoverClosed: true },
        completed: true,
      });
      expect(operation.result).not.toHaveProperty('memberId');
      expect(operation.result).not.toHaveProperty('qrTokenHash');
    }
    const membersAfter = await adminPool.query<{ handed_off: boolean }>(
      `SELECT enrollment_handoff_at = joined_at AS handed_off
         FROM loyalty.members
        WHERE tenant_ref = $1`,
      [tenant],
    );
    expect(membersAfter.rows).toEqual([{ handed_off: true }, { handed_off: true }]);
  });
});
