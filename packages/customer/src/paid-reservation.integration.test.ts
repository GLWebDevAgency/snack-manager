import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { confirmCustomerTestBrowser } from './browser-test-fixture';
import { CustomerRepositoryError, withCustomerScope } from './client';
import type { PaidVerificationReservation, TrialVerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
function paid(patch: Partial<PaidVerificationReservation> = {}): PaidVerificationReservation {
  const now = Date.now();
  return { parentRef: `parent_${hash().slice(0, 12)}`, tenantRef: `tenant_${hash().slice(0, 12)}`,
    browserRef: randomUUID(), operationId: randomUUID(), challengeId: randomUUID(), requestHash: hash(), browserHash: hash(),
    phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-ciphertext',
    serviceSid: `VA${'1'.repeat(32)}`, evidenceReference: 'fixture', now,
    planExpiresAt: now + 60_000, expiresAt: now + 600_000,
    limits: { maxSendReservations: 50, smsUnitsReservedPerSend: 2,
      paidBudget: { mode: 'paid', authorizationRef: 'one_off_fixture', costEvidenceReference: 'cost_fixture', currency: 'USD',
        authorizedSpendMicrousd: 1000, reservePerSendMicrousd: 600, expiresAt: now + 600_000 },
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 }, ...patch };
}
function trial(input = paid()): TrialVerificationReservation {
  const { paidBudget: _budget, maxSendReservations, ...common } = input.limits;
  return { ...input, limits: { ...common, trialSendReservations: maxSendReservations,
    freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100 } };
}

integration('paid reservations — native PostgreSQL, no provider', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(fixture.app);
  }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function reserve(input: PaidVerificationReservation | TrialVerificationReservation) {
    await confirmCustomerTestBrowser(repo, input);
    return repo.reserve(input);
  }

  it('serializes the last monetary reservation across tenants and creates no fictitious free allowance', async () => {
    const first = paid(); const second = paid({ parentRef: first.parentRef, limits: first.limits });
    const results = await Promise.all([reserve(first), reserve(second)]);
    expect(results.filter(result => result.kind === 'reserved')).toHaveLength(1);
    expect(results.filter(result => result.kind === 'denied')).toHaveLength(1);
    expect((await fixture.admin.query(`SELECT reserved_sends::int,sms_limit::int,verification_limit::int,
      reserved_sms::int,reserved_verifications::int FROM customer.parent_budgets WHERE parent_ref=$1`, [first.parentRef])).rows[0])
      .toEqual({ reserved_sends: 1, sms_limit: 0, verification_limit: 0, reserved_sms: 0, reserved_verifications: 0 });
    expect((await fixture.admin.query('SELECT reserved_spend_microusd::int AS spent FROM customer.paid_budgets WHERE parent_ref=$1', [first.parentRef])).rows[0].spent).toBe(600);
  });

  it('returns immutable paid funding on settlement, replay and check, spending only once', async () => {
    const input = paid();
    expect(await reserve(input)).toEqual({ kind: 'reserved', challengeId: input.challengeId });
    expect(await reserve(input)).toEqual({ kind: 'uncertain' });
    const pending = await repo.settleSend({ ...input, verificationSid: `VE${hash().slice(0, 32)}` });
    expect(pending?.funding).toEqual({ mode: 'paid', authorizationRef: input.limits.paidBudget.authorizationRef,
      currency: 'USD', reservedMicrousd: 600, expiresAt: input.limits.paidBudget.expiresAt });
    expect(await reserve({ ...input, challengeId: randomUUID() })).toEqual({ kind: 'pending', challenge: pending });
    expect((await repo.claimCheck({ ...input, checkId: randomUUID() }))?.funding).toEqual(pending?.funding);
    expect((await fixture.admin.query('SELECT reserved_spend_microusd::int AS spent FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].spent).toBe(600);
  });

  it('closes free caps of an existing trial parent without raising its historical send ceiling', async () => {
    const original = trial(); original.limits.trialSendReservations = 2;
    expect((await reserve(original)).kind).toBe('reserved');
    const next = paid({ parentRef: original.parentRef });
    expect((await reserve(next)).kind).toBe('reserved');
    expect(await reserve(trial(paid({ parentRef: original.parentRef })))).toEqual({ kind: 'denied' });
    expect(await reserve(paid({ parentRef: original.parentRef, limits: next.limits }))).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT send_limit::int,sms_limit::int,verification_limit::int,reserved_sends::int,reserved_sms::int FROM customer.parent_budgets WHERE parent_ref=$1', [original.parentRef])).rows[0])
      .toEqual({ send_limit: 2, sms_limit: 0, verification_limit: 0, reserved_sends: 2, reserved_sms: 2 });
  });

  it('never swaps authorization, resets uncertain spending or lifts an expired paid budget', async () => {
    const input = paid(); await reserve(input);
    await repo.settleSend({ ...input, verificationSid: null });
    const another = paid({ parentRef: input.parentRef });
    another.limits.paidBudget.authorizationRef = 'another_authorization';
    another.limits.maxSendReservations = 1;
    expect(await reserve(another)).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT send_limit::int FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].send_limit).toBe(50);
    for (const sql of ["SET reserved_spend_microusd=0", "SET authorized_spend_microusd=2000",
      "SET authorization_ref='replacement'", "SET expires_at=expires_at+interval '1 second'"]) {
      await expect(fixture.admin.query(`UPDATE customer.paid_budgets ${sql} WHERE parent_ref=$1`, [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(fixture.admin.query('DELETE FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    await fixture.admin.query("UPDATE customer.paid_budgets SET expires_at=clock_timestamp()-interval '1 second' WHERE parent_ref=$1", [input.parentRef]);
    expect(await reserve(paid({ parentRef: input.parentRef, limits: input.limits }))).toEqual({ kind: 'denied' });
  });

  it('SQL rejects overspending while allowing a cap below already irrevocably reserved spending', async () => {
    const input = paid(); await reserve(input);
    await expect(fixture.admin.query('UPDATE customer.paid_budgets SET reserved_spend_microusd=1001 WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    await fixture.admin.query('UPDATE customer.paid_budgets SET authorized_spend_microusd=0 WHERE parent_ref=$1', [input.parentRef]);
    await expect(fixture.admin.query('UPDATE customer.paid_budgets SET reserved_spend_microusd=601 WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    expect((await fixture.admin.query('SELECT reserved_spend_microusd::int,authorized_spend_microusd::int FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0])
      .toEqual({ reserved_spend_microusd: 600, authorized_spend_microusd: 0 });
  });

  it('refuses a check after paid authorization expiry is lowered, preserving the immutable receipt', async () => {
    const input = paid(); await reserve(input);
    await repo.settleSend({ ...input, verificationSid: `VE${hash().slice(0, 32)}` });
    await fixture.admin.query("UPDATE customer.paid_budgets SET expires_at=clock_timestamp()-interval '1 second' WHERE parent_ref=$1", [input.parentRef]);
    expect(await repo.claimCheck({ ...input, checkId: randomUUID() })).toBeNull();
    expect((await fixture.admin.query('SELECT funding_expires_at FROM customer.reservations WHERE id=$1', [input.operationId])).rows[0].funding_expires_at.getTime())
      .toBe(input.limits.paidBudget.expiresAt);
    expect((await fixture.admin.query('SELECT id FROM customer.check_attempts WHERE challenge_id=$1', [input.challengeId])).rowCount).toBe(0);
  });

  it('SQL-fences the old Trial check writer after a Paid transition', async () => {
    const old = trial(); await reserve(old);
    await repo.settleSend({ ...old, verificationSid: `VE${hash().slice(0, 32)}` });
    await reserve(paid({ parentRef: old.parentRef }));
    // Exact INSERT used by the pre-Paid claimCheck, bypassing the new TS guard.
    await expect(fixture.admin.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id)
      VALUES($1,$2,$3,$4)`, [randomUUID(), old.parentRef, old.tenantRef, old.challengeId])).rejects.toMatchObject({ code: '23514' });
    expect((await fixture.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [old.challengeId])).rows[0].state).toBe('pending');
  });

  it('keeps a provisioned check usable with cap zero, until the separate authorization expiry', async () => {
    const input = paid(); await reserve(input);
    await repo.settleSend({ ...input, verificationSid: `VE${hash().slice(0, 32)}` });
    const shortened = Date.now() + 30_000;
    await fixture.admin.query('UPDATE customer.paid_budgets SET authorized_spend_microusd=0,expires_at=$2 WHERE parent_ref=$1', [input.parentRef, new Date(shortened)]);
    const current = await repo.claimCheck({ ...input, checkId: randomUUID() });
    expect(current?.funding).toEqual({ mode: 'paid', authorizationRef: input.limits.paidBudget.authorizationRef,
      currency: 'USD', reservedMicrousd: 600, expiresAt: shortened });
    expect(await reserve(paid({ parentRef: input.parentRef }))).toEqual({ kind: 'denied' });
  });

  it('keeps the original cost evidence and reserve during replay with refreshed costs', async () => {
    const input = paid(); await reserve(input);
    const pending = await repo.settleSend({ ...input, verificationSid: `VE${hash().slice(0, 32)}` });
    const refreshed = { ...input, limits: { ...input.limits, paidBudget: { ...input.limits.paidBudget,
      costEvidenceReference: 'refreshed_cost', reservePerSendMicrousd: 900, authorizedSpendMicrousd: 50_000 } } };
    expect(await reserve(refreshed)).toEqual({ kind: 'pending', challenge: pending });
    expect((await fixture.admin.query('SELECT reserved_microusd::int,cost_evidence_reference FROM customer.reservations WHERE id=$1', [input.operationId])).rows[0])
      .toEqual({ reserved_microusd: 600, cost_evidence_reference: 'cost_fixture' });
    expect((await fixture.admin.query('SELECT authorized_spend_microusd::int,reserved_spend_microusd::int FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0])
      .toEqual({ authorized_spend_microusd: 1000, reserved_spend_microusd: 600 });
    await expect(fixture.admin.query("UPDATE customer.reservations SET cost_evidence_reference='replacement' WHERE id=$1", [input.operationId])).rejects.toMatchObject({ code: '23514' });
  });

  it('shares daily quotas with Trial and never counts paid sends as free consumption', async () => {
    const old = trial(); old.limits.globalSendReservations = 2; await reserve(old);
    const input = paid({ parentRef: old.parentRef }); input.limits.globalSendReservations = 2;
    input.limits.paidBudget.authorizedSpendMicrousd = 50_000;
    expect((await reserve(input)).kind).toBe('reserved');
    expect(await reserve(paid({ parentRef: old.parentRef, limits: input.limits }))).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT count(*)::int AS count FROM customer.reservations WHERE parent_ref=$1', [old.parentRef])).rows[0].count).toBe(2);
  });

  it('retains spending after the real COMMIT succeeds but its response is lost', async () => {
    const input = paid(); let commits = 0;
    await confirmCustomerTestBrowser(repo, input);
    const pool = { connect: async () => {
      const connection = await fixture.app.connect();
      return new Proxy(connection, { get(target, property) {
        if (property === 'query') return async (...args: Parameters<typeof connection.query>) => {
          const result = await Reflect.apply(connection.query, connection, args);
          if (args[0] === 'COMMIT') { commits++; throw new Error('fixture response lost'); }
          return result;
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(pool).reserve(input)).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect(commits).toBe(1);
    expect(await reserve(input)).toEqual({ kind: 'uncertain' });
    expect((await fixture.admin.query('SELECT reserved_spend_microusd::int AS spent FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].spent).toBe(600);
    expect((await fixture.admin.query('SELECT id FROM customer.reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1);
  });

  it('rechecks the paid expiry after waiting for its second row lock', async () => {
    const input = paid(); await reserve(input);
    const blocker = await fixture.admin.connect();
    let waiting: ReturnType<typeof repo.reserve> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query("UPDATE customer.paid_budgets SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE parent_ref=$1", [input.parentRef]);
      waiting = reserve(paid({ parentRef: input.parentRef, limits: input.limits }));
      await blocker.query('SELECT pg_sleep(0.15)');
      await blocker.query('COMMIT');
      expect(await waiting).toEqual({ kind: 'denied' });
      expect((await fixture.admin.query('SELECT id FROM customer.reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await waiting; }
  });

  it('uses exact integer arithmetic at the JSON-safe money ceiling', async () => {
    const input = paid(); input.limits.paidBudget.authorizedSpendMicrousd = Number.MAX_SAFE_INTEGER;
    input.limits.paidBudget.reservePerSendMicrousd = 1;
    await reserve(input);
    await fixture.admin.query('UPDATE customer.paid_budgets SET reserved_spend_microusd=$2 WHERE parent_ref=$1',
      [input.parentRef, String(BigInt(Number.MAX_SAFE_INTEGER) - 10n)]);
    const denied = paid({ parentRef: input.parentRef, limits: { ...input.limits,
      paidBudget: { ...input.limits.paidBudget, reservePerSendMicrousd: 11 } } });
    expect(await reserve(denied)).toEqual({ kind: 'denied' });
    const exact = paid({ parentRef: input.parentRef, limits: { ...input.limits,
      paidBudget: { ...input.limits.paidBudget, reservePerSendMicrousd: 10 } } });
    expect((await reserve(exact)).kind).toBe('reserved');
    expect((await fixture.admin.query('SELECT reserved_spend_microusd FROM customer.paid_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].reserved_spend_microusd)
      .toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('forces parent RLS on paid budgets for the ordinary runtime role', async () => {
    const input = paid(); await reserve(input);
    expect((await fixture.app.query('SELECT parent_ref FROM customer.paid_budgets')).rowCount).toBe(0);
    expect(await withCustomerScope(fixture.app, { ...input, parentRef: 'other' }, async connection =>
      (await connection.query('SELECT parent_ref FROM customer.paid_budgets')).rowCount)).toBe(0);
    await expect(withCustomerScope(fixture.app, { ...input, parentRef: 'other' }, connection => connection.query(`INSERT INTO customer.paid_budgets
      (parent_ref,authorization_ref,currency,authorized_spend_microusd,expires_at) VALUES($1,'foreign','USD',1,$2)`,
    [input.parentRef, new Date(input.expiresAt)]))).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect((await fixture.admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='customer.paid_budgets'::regclass")).rows[0])
      .toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
