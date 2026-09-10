import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loyaltyDb } from '@sm/loyalty';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readLoyaltyEarnReceipt, type LoyaltyEarnReceiptInput } from './loyalty-earn-receipt.reader';

const target = process.env.LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL;
const integration = target ? describe : describe.skip;

integration('committed earn observation — isolated native PostgreSQL', () => {
  let fixture: { pool: Pool; close(): Promise<void> };
  let inCanonicalSaleTenant: <T>(pool: Pool, tenant: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
  beforeAll(async () => {
    // Ne pas inclure le migrateur des fixtures dans les entrées du build Nest.
    const path = resolve(__dirname, '../../../../../packages/loyalty/src/canonical-sale.test-fixture.ts');
    const module = await import(/* @vite-ignore */ path) as {
      canonicalSaleTestFixture(raw: unknown): Promise<typeof fixture>;
      inCanonicalSaleTenant: typeof inCanonicalSaleTenant;
    };
    inCanonicalSaleTenant = module.inCanonicalSaleTenant;
    fixture = await module.canonicalSaleTestFixture(target);
  }, 20_000);
  afterAll(async () => { await fixture?.close(); });

  async function seed() {
    const input: LoyaltyEarnReceiptInput = {
      tenantRef: randomUUID(), clientId: randomUUID(), memberId: randomUUID(), operationId: randomUUID(),
    };
    const programId = randomUUID();
    await inCanonicalSaleTenant(fixture.pool, input.tenantRef, async client => {
      await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status,current_version) VALUES($1,$2,'active',1)", [programId, input.tenantRef]);
      await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
        spend_step_cents,units_per_step,unit_label_singular,unit_label_plural,terms_summary)
        VALUES($1,$2,1,'Fixture','points',0,100,1,'point','points','Fixture')`, [input.tenantRef, programId]);
      await client.query('INSERT INTO loyalty.members(id,tenant_ref) VALUES($1,$2)', [input.memberId, input.tenantRef]);
      await client.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [input.tenantRef, input.memberId, programId]);
    });
    return { input, programId };
  }

  async function write(client: PoolClient, item: Awaited<ReturnType<typeof seed>>, options: {
    units?: number; prefix?: string; source?: string; receipt?: boolean; ledger?: boolean;
    operationKind?: string; pending?: boolean; result?: Record<string, unknown>; ledgerOverride?: Record<string, unknown>; suffix?: string;
  } = {}) {
    const { input, programId } = item;
    const units = options.units ?? 3;
    const id = randomUUID();
    const source = options.source ?? 'pos';
    const ref = `${options.prefix ?? 'pos-order'}:${input.clientId.toUpperCase()}${options.suffix ?? ''}`;
    await client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
      VALUES($1,$2,$3,$4)`, [input.tenantRef, input.operationId, options.operationKind ?? 'earn', 'e'.repeat(64)]);
    if (options.receipt !== false) await client.query(`INSERT INTO loyalty.earn_receipts(tenant_ref,source,external_ref,operation_id,member_id)
      VALUES($1,$2,$3,$4,$5)`, [input.tenantRef, source, ref, input.operationId, input.memberId]);
    if ((options.ledger ?? units > 0)) {
      const row = { kind: 'earn', delta: units || 1, source, ref, rulesVersion: 1, ...options.ledgerOverride };
      await client.query(`UPDATE loyalty.wallets SET balance_units=$4,lifetime_earned_units=$4,version=1
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3`, [input.tenantRef, input.memberId, programId, row.delta]);
      await client.query(`INSERT INTO loyalty.ledger_entries(id,tenant_ref,member_id,program_id,operation_id,kind,delta_units,
        balance_after,source,external_ref,rules_version,wallet_version,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,1,now())`,
      [id, input.tenantRef, input.memberId, programId, input.operationId, row.kind, row.delta, row.source, row.ref, row.rulesVersion]);
    }
    if (!options.pending) await client.query(`UPDATE loyalty.operations SET status='completed',result=$3::jsonb,completed_at=now()
      WHERE tenant_ref=$1 AND operation_id=$2`, [input.tenantRef, input.operationId, JSON.stringify({
      memberId: input.memberId, outcome: units ? 'earned' : 'below_minimum', awardedUnits: units,
      rulesVersion: 1, ledgerEntryId: units ? id : null,
      memberSnapshot: { privateFixtureMarker: 'never-project-this' }, ...options.result,
    })]);
  }

  const observe = (input: LoyaltyEarnReceiptInput) => readLoyaltyEarnReceipt(loyaltyDb(fixture.pool), input);

  it('observes nothing without writing an operation or asserting permanent absence', async () => {
    const item = await seed();
    expect(await observe(item.input)).toEqual({ kind: 'not_observed' });
    expect(await inCanonicalSaleTenant(fixture.pool, item.input.tenantRef, client => client.query('SELECT operation_id FROM loyalty.operations')))
      .toMatchObject({ rows: [] });
  });

  it.each(['pos-order', 'online-order', 'order', 'POS-ORDER', 'OnLiNe-OrDeR', 'ORDER'].flatMap(prefix =>
    ['pos', 'online'].map(source => ({ prefix, source }))))('recognizes $source/$prefix and uppercase UUID', async options => {
    const item = await seed();
    await inCanonicalSaleTenant(fixture.pool, item.input.tenantRef, client => write(client, item, options));
    expect(await observe(item.input)).toEqual({ kind: 'recorded', awardedUnits: 3, operationId: item.input.operationId });
  });

  it('recognizes zero without a ledger and ignores current program/member/wallet state', async () => {
    const item = await seed();
    await inCanonicalSaleTenant(fixture.pool, item.input.tenantRef, async client => {
      await write(client, item, { units: 0 });
      await client.query("UPDATE loyalty.programs SET status='paused' WHERE tenant_ref=$1", [item.input.tenantRef]);
      await client.query("UPDATE loyalty.members SET status='blocked',blocked_at=now() WHERE tenant_ref=$1", [item.input.tenantRef]);
    });
    expect(await observe(item.input)).toEqual({ kind: 'recorded', awardedUnits: 0, operationId: item.input.operationId });
  });

  it.each([
    { receipt: false }, { ledger: false }, { pending: true }, { operationKind: 'adjust' },
    { units: 0, ledger: true }, { result: { awardedUnits: 2 } }, { result: { awardedUnits: '3' } },
    { result: { rulesVersion: 2 } }, { result: { memberId: randomUUID() } },
    { result: { ledgerEntryId: randomUUID() } }, { result: { outcome: 'below_minimum' } },
    { ledgerOverride: { source: 'online' } }, { ledgerOverride: { ref: `order:${randomUUID()}` } },
    { source: 'admin' }, { suffix: '\n' }, { suffix: ':extra' }, { prefix: 'unrecognized' },
    { units: 0, result: { outcome: 'earned' } }, { units: 0, result: { awardedUnits: 1 } },
    { units: 0, result: { ledgerEntryId: randomUUID() } },
    { result: { rulesVersion: 0 } }, { result: { awardedUnits: Number.MAX_SAFE_INTEGER + 1 } },
  ])('refuses divergent or incomplete committed proof %#', async options => {
    const item = await seed();
    await inCanonicalSaleTenant(fixture.pool, item.input.tenantRef, client => write(client, item, options));
    expect(await observe(item.input)).toEqual({ kind: 'conflict' });
  });

  it('does not adopt another operation/member or read another tenant', async () => {
    const item = await seed();
    await inCanonicalSaleTenant(fixture.pool, item.input.tenantRef, client => write(client, item));
    expect(await observe({ ...item.input, operationId: randomUUID() })).toEqual({ kind: 'conflict' });
    expect(await observe({ ...item.input, memberId: randomUUID() })).toEqual({ kind: 'conflict' });
    expect(await observe({ ...item.input, tenantRef: randomUUID() })).toEqual({ kind: 'not_observed' });
    expect((await fixture.pool.query('SELECT * FROM loyalty.earn_receipts')).rows).toEqual([]);
  });

  it.each([0, 3])('an in-flight %i-unit commit stays unobserved, then becomes recorded without replay', async units => {
    const item = await seed();
    const client = await fixture.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_ref',$1,true)", [item.input.tenantRef]);
      await write(client, item, { units });
      expect(await observe(item.input)).toEqual({ kind: 'not_observed' });
      await client.query('COMMIT');
      expect(await observe(item.input)).toEqual({ kind: 'recorded', awardedUnits: units, operationId: item.input.operationId });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
});
