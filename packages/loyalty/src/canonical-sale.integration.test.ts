import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertCanonicalSaleTestTarget, canonicalSaleTestFixture, inCanonicalSaleTenant } from './canonical-sale.test-fixture';

const raw = process.env.LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL;
const integration = raw ? describe : describe.skip;
const RECEIPT_INDEX = 'earn_receipts_tenant_canonical_sale_uq';
const LEDGER_INDEX = 'ledger_earn_canonical_sale_uq';
type Member = { tenant: string; member: string; program: string };
type Source = 'pos' | 'online' | 'standalone' | 'admin' | 'system';

async function seedMember(pool: Pool, previous?: Member): Promise<Member> {
  const member = { tenant: previous?.tenant ?? randomUUID(), program: previous?.program ?? randomUUID(), member: randomUUID() };
  await inCanonicalSaleTenant(pool, member.tenant, async client => {
    if (!previous) {
      await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status,current_version) VALUES ($1,$2,'active',1)", [member.program, member.tenant]);
      await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
        spend_step_cents,units_per_step,unit_label_singular,unit_label_plural,terms_summary)
        VALUES($1,$2,1,'Test program','points',0,100,1,'point','points','Test terms')`, [member.tenant, member.program]);
    }
    await client.query('INSERT INTO loyalty.members(id,tenant_ref) VALUES($1,$2)', [member.member, member.tenant]);
    await client.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [member.tenant, member.member, member.program]);
  });
  return member;
}

// The real historical SQL write shape, not a new application-only column:
// operation + receipt (even zero) + wallet + immutable ledger, one transaction.
async function writeEarn(pool: Pool, member: Member, source: Source, ref: string, options: {
  receipt?: boolean; units?: number; kind?: 'earn' | 'adjust_credit'; beforeClaim?: () => Promise<void>;
} = {}) {
  const operation = randomUUID(); const units = options.units ?? 1; const kind = options.kind ?? 'earn';
  await inCanonicalSaleTenant(pool, member.tenant, async client => {
    await client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
      VALUES($1,$2,$3,$4)`, [member.tenant, operation, kind === 'earn' ? 'earn' : 'adjust', 'f'.repeat(64)]);
    await options.beforeClaim?.();
    if (options.receipt !== false) await client.query(`INSERT INTO loyalty.earn_receipts(tenant_ref,source,external_ref,operation_id,member_id)
      VALUES($1,$2,$3,$4,$5)`, [member.tenant, source, ref, operation, member.member]);
    if (units) {
      const wallet = await client.query<{ balance_units: string; version: string }>(`UPDATE loyalty.wallets
        SET balance_units=balance_units+$4,lifetime_earned_units=lifetime_earned_units+$4,version=version+1
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3 RETURNING balance_units,version`, [member.tenant, member.member, member.program, units]);
      await client.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,
        balance_after,source,external_ref,rules_version,wallet_version,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,now())`, [member.tenant, member.member, member.program, operation, kind, units,
        wallet.rows[0]!.balance_units, source, ref, wallet.rows[0]!.version]);
    }
    await client.query(`UPDATE loyalty.operations SET status='completed',result='{}',completed_at=now()
      WHERE tenant_ref=$1 AND operation_id=$2`, [member.tenant, operation]);
  });
  return operation;
}

async function contents(pool: Pool, tenant: string) {
  return inCanonicalSaleTenant(pool, tenant, async client => {
    const receipts = await client.query('SELECT * FROM loyalty.earn_receipts ORDER BY id');
    const ledger = await client.query('SELECT * FROM loyalty.ledger_entries ORDER BY id');
    const wallets = await client.query('SELECT * FROM loyalty.wallets ORDER BY member_id');
    const operations = await client.query('SELECT * FROM loyalty.operations ORDER BY operation_id');
    return { receipts: receipts.rows, ledger: ledger.rows, wallets: wallets.rows, operations: operations.rows };
  });
}

describe('isolated canonical sale PostgreSQL target', () => {
  it.each(['postgres://localhost/application', 'postgres://example.test/postgres', 'postgres://127.0.0.1/postgres?host=remote',
    'postgres://127.0.0.1/postgres#fragment', 'https://localhost/postgres', undefined])('refuses unsafe target %s', target => {
    expect(() => assertCanonicalSaleTestTarget(target)).toThrow('Local isolated PostgreSQL test target required');
  });
  it.each(['postgresql://localhost/postgres', 'postgres://127.0.0.1:5432/snackmanager_loyalty_test_ci',
    'postgres://[::1]/postgres'])('accepts loopback control database %s', target => {
    expect(assertCanonicalSaleTestTarget(target)).toBe(new URL(target).toString());
  });
});

integration('canonical sale uniqueness — genuine PostgreSQL and limited owner', () => {
  let fixture: Awaited<ReturnType<typeof canonicalSaleTestFixture>>;
  beforeAll(async () => { fixture = await canonicalSaleTestFixture(raw); }, 20_000);
  afterAll(async () => { await fixture?.close(); });

  it('owns forced-RLS tables without superuser/bypass and keeps all historical indexes', async () => {
    const role = await fixture.pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const tables = await fixture.pool.query(`SELECT relname,relforcerowsecurity,pg_get_userbyid(relowner)=current_user AS owned
      FROM pg_class WHERE oid IN ('loyalty.earn_receipts'::regclass,'loyalty.ledger_entries'::regclass) ORDER BY relname`);
    expect(tables.rows).toEqual([{ relname: 'earn_receipts', relforcerowsecurity: true, owned: true },
      { relname: 'ledger_entries', relforcerowsecurity: true, owned: true }]);
    const indexes = await fixture.pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='loyalty'");
    expect(indexes.rows.map(row => row.indexname)).toEqual(expect.arrayContaining([RECEIPT_INDEX, LEDGER_INDEX,
      'earn_receipts_tenant_source_external_ref_uq', 'ledger_earn_external_ref_uq', 'ledger_redeem_external_ref_uq']));
    for (const name of [RECEIPT_INDEX, LEDGER_INDEX]) {
      const definition = indexes.rows.find(row => row.indexname === name)?.indexdef;
      expect(definition).toContain('UNIQUE INDEX'); expect(definition).toContain('lower(split_part(external_ref');
    }
  });

  it.each(['pos-order', 'online-order', 'order', 'POS-ORDER', 'ONLINE-ORDER', 'ORDER', 'PoS-OrDeR', 'OnLiNe-OrDeR', 'OrDeR']
    .flatMap(prefix => (['pos', 'online'] as const).map(source => ({ prefix, source }))))(
    'aliases $prefix/$source and uppercase UUID cannot replay a POS sale, even for another member', async ({ prefix, source }) => {
      const member = await seedMember(fixture.pool); const other = await seedMember(fixture.pool, member); const sale = `abcdef12-${randomUUID().slice(9)}`;
      await writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`);
      const before = await contents(fixture.pool, member.tenant);
      await expect(writeEarn(fixture.pool, other, source, `${prefix}:${sale.toUpperCase()}`))
        .rejects.toMatchObject({ code: '23505', constraint: RECEIPT_INDEX });
      expect(await contents(fixture.pool, member.tenant)).toEqual(before);
      expect(before.receipts).toHaveLength(1); expect(before.ledger).toHaveLength(1);
    },
  );

  it('a zero-unit receipt still blocks another gain attempt for the canonical sale', async () => {
    const member = await seedMember(fixture.pool); const sale = randomUUID();
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`, { units: 0 });
    await expect(writeEarn(fixture.pool, member, 'online', `order:${sale}`, { units: 20 }))
      .rejects.toMatchObject({ code: '23505', constraint: RECEIPT_INDEX });
    const state = await contents(fixture.pool, member.tenant);
    expect(state.receipts).toHaveLength(1); expect(state.ledger).toHaveLength(0); expect(state.operations).toHaveLength(1);
    expect(state.wallets[0]).toMatchObject({ balance_units: '0', version: '0' });
  });

  it.each(['online-order', 'ONLINE-ORDER', 'OnLiNe-OrDeR'])('the ledger independently protects a historical gain against %s and rolls back its wallet update', async prefix => {
    const member = await seedMember(fixture.pool); const sale = randomUUID();
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`, { receipt: false });
    const before = await contents(fixture.pool, member.tenant);
    await expect(writeEarn(fixture.pool, member, 'online', `${prefix}:${sale.toUpperCase()}`))
      .rejects.toMatchObject({ code: '23505', constraint: LEDGER_INDEX });
    expect(await contents(fixture.pool, member.tenant)).toEqual(before);
  });

  it('two concurrent aliases commit exactly one receipt, operation, ledger and wallet delta', async () => {
    const member = await seedMember(fixture.pool); const other = await seedMember(fixture.pool, member); const sale = randomUUID();
    let release!: () => void; let bothArrived!: () => void; let arrivals = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { bothArrived = resolve; });
    const beforeClaim = async () => { if (++arrivals === 2) bothArrived(); await held; };
    const calls = [
      writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`, { beforeClaim }),
      writeEarn(fixture.pool, other, 'online', `order:${sale.toUpperCase()}`, { beforeClaim }),
    ];
    const pending = Promise.allSettled(calls);
    try {
      await Promise.race([ready, Promise.all(calls).then(() => { throw new Error('Writers completed before the barrier'); })]);
      expect(arrivals).toBe(2);
    } finally { release(); }
    const results = await pending;
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ status: 'rejected', reason: { code: '23505', constraint: RECEIPT_INDEX } });
    const state = await contents(fixture.pool, member.tenant);
    expect(state.receipts).toHaveLength(1); expect(state.ledger).toHaveLength(1); expect(state.operations).toHaveLength(1);
    expect(state.wallets.reduce((sum, row) => sum + Number(row.balance_units), 0)).toBe(1);
  });

  it('does not merge distinct tenants or distinct sale UUIDs', async () => {
    const first = await seedMember(fixture.pool); const second = await seedMember(fixture.pool); const sale = randomUUID();
    await writeEarn(fixture.pool, first, 'pos', `pos-order:${sale}`);
    await writeEarn(fixture.pool, second, 'online', `order:${sale.toUpperCase()}`);
    await writeEarn(fixture.pool, first, 'online', `order:${randomUUID()}`);
    expect((await contents(fixture.pool, first.tenant)).receipts).toHaveLength(2);
    expect((await contents(fixture.pool, second.tenant)).receipts).toHaveLength(1);
    expect((await fixture.pool.query('SELECT * FROM loyalty.earn_receipts')).rows).toEqual([]);
  });

  it.each(['standalone', 'admin', 'system'] as const)('does not reinterpret source %s as a canonical order', async source => {
    const member = await seedMember(fixture.pool); const sale = randomUUID();
    await writeEarn(fixture.pool, member, source, `order:${sale}`);
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`);
    expect((await contents(fixture.pool, member.tenant)).receipts).toHaveLength(2);
  });

  it.each(['missing-uuid', '00000000-0000-0000-0000-00000000000', '00000000-0000-0000-0000-0000000000000',
    'gggggggg-0000-0000-0000-000000000000', '00000000000000000000000000000000', '00000000-0000-0000-0000-000000000000:extra',
    '00000000-0000-0000-0000-000000000000\n'])('does not canonicalize malformed suffix %j', async suffix => {
    const member = await seedMember(fixture.pool);
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${suffix}`);
    await writeEarn(fixture.pool, member, 'online', `order:${suffix}`);
    expect((await contents(fixture.pool, member.tenant)).receipts).toHaveLength(2);
  });

  it('keeps legacy exact-reference protection and excludes non-earn ledger movements', async () => {
    const member = await seedMember(fixture.pool); const ref = `receipt:${randomUUID()}`;
    await writeEarn(fixture.pool, member, 'pos', ref);
    await expect(writeEarn(fixture.pool, member, 'pos', ref)).rejects.toMatchObject({ code: '23505', constraint: 'earn_receipts_tenant_source_external_ref_uq' });
    const sale = randomUUID();
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${sale}`);
    await writeEarn(fixture.pool, member, 'online', `order:${sale}`, { receipt: false, kind: 'adjust_credit' });
    expect((await contents(fixture.pool, member.tenant)).ledger).toHaveLength(3);
  });

  it('rerunning the real migrator is idempotent without changing historical financial rows', async () => {
    const member = await seedMember(fixture.pool);
    await writeEarn(fixture.pool, member, 'pos', `pos-order:${randomUUID()}`);
    const before = await contents(fixture.pool, member.tenant);
    const journal = await fixture.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations ORDER BY id');
    expect(journal.rows).toHaveLength(7);
    await fixture.upgrade(); await fixture.upgrade();
    expect((await fixture.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations ORDER BY id')).rows).toEqual(journal.rows);
    expect(await contents(fixture.pool, member.tenant)).toEqual(before);
  });

  it('upgrades a populated 0005 database without rewriting receipts, ledger, operations or wallets', async () => {
    const historical = await canonicalSaleTestFixture(raw, 6);
    try {
      const member = await seedMember(historical.pool); const sale = randomUUID(); const zeroSale = randomUUID();
      await writeEarn(historical.pool, member, 'pos', `pos-order:${sale}`, { units: 7 });
      await writeEarn(historical.pool, member, 'online', `online-order:${zeroSale}`, { units: 0 });
      const before = await contents(historical.pool, member.tenant);
      const journalBefore = await historical.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations ORDER BY id');
      expect(journalBefore.rows).toHaveLength(6);
      await historical.upgrade();
      const journalAfter = await historical.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations ORDER BY id');
      expect(journalAfter.rows).toHaveLength(7);
      expect(journalAfter.rows.slice(0, 6)).toEqual(journalBefore.rows);
      expect(journalAfter.rows[6]).toMatchObject({ created_at: '1789040000000' });
      expect(await contents(historical.pool, member.tenant)).toEqual(before);
      for (const original of [sale, zeroSale]) await expect(writeEarn(historical.pool, member, 'online', `order:${original.toUpperCase()}`))
        .rejects.toMatchObject({ code: '23505', constraint: RECEIPT_INDEX });
      expect(await contents(historical.pool, member.tenant)).toEqual(before);
      await historical.upgrade();
      expect((await historical.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations ORDER BY id')).rows).toEqual(journalAfter.rows);
    } finally { await historical.close(); }
  }, 20_000);

  it.each(['receipt', 'ledger'] as const)('historical %s collision hidden by FORCE RLS aborts both indexes and the migration journal', async collision => {
    const historical = await canonicalSaleTestFixture(raw, 6);
    try {
      const member = await seedMember(historical.pool); const sale = randomUUID();
      const options = collision === 'receipt' ? { units: 0 } : { receipt: false };
      await writeEarn(historical.pool, member, 'pos', `pos-order:${sale}`, options);
      await writeEarn(historical.pool, member, 'online', `OnLiNe-OrDeR:${sale.toUpperCase()}`, options);
      const before = await contents(historical.pool, member.tenant);
      expect((await historical.pool.query(`SELECT * FROM loyalty.${collision === 'receipt' ? 'earn_receipts' : 'ledger_entries'}`)).rows).toEqual([]);
      for (let attempt = 0; attempt < 2; attempt++) {
        let caught: unknown;
        try { await historical.upgrade(); } catch (error) { caught = error; }
        expect(caught).toBeDefined();
        const native = (caught as { cause?: unknown })?.cause ?? caught;
        expect(native).toMatchObject({ code: '23505', message: 'Canonical loyalty sale collision; migration rolled back' });
        const serialized = String(caught) + JSON.stringify(native);
        for (const privateValue of [sale, sale.toUpperCase(), member.tenant, member.member]) expect(serialized).not.toContain(privateValue);
        expect((await historical.pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='loyalty' AND indexname=ANY($1)", [[RECEIPT_INDEX, LEDGER_INDEX]])).rows).toEqual([]);
        expect((await historical.pool.query('SELECT * FROM drizzle.__drizzle_loyalty_migrations')).rows).toHaveLength(6);
        expect(await contents(historical.pool, member.tenant)).toEqual(before);
      }
    } finally { await historical.close(); }
  }, 20_000);
});
