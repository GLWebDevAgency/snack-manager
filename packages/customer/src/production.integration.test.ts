import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { PostgresCustomerProductionOperator, type CustomerProductionBudgetAuthorization, type CustomerProductionAdmissionPolicy } from './production-operator';
import { withCustomerScope } from './client';
import type { CustomerProductionAdmission, ProductionVerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
function reservation(patch: Partial<ProductionVerificationReservation> = {}): ProductionVerificationReservation {
  const now = Date.now();
  return { parentRef: `parent_${hash().slice(0,12)}`, tenantRef: `tenant_${hash().slice(0,12)}`,
    browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash(), challengeId: randomUUID(),
    requestHash: hash(), phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'test-ciphertext',
    serviceSid: `VA${'1'.repeat(32)}`, evidenceReference: 'observed', planExpiresAt: now+600000, expiresAt: now+600000, now,
    limits: { smsUnitsReservedPerSend: 2, cooldownMs: 60000, windowMs: 86400000, globalSendReservations: 100,
      tenantSendReservations: 100, phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5,
      productionBudget: { mode: 'production_paid', authorizationRef: 'A', currency: 'USD', costEvidenceReference: 'cost-A', reservePerSendMicrousd: 600 } }, ...patch };
}
function authorization(input: ProductionVerificationReservation, patch: Partial<CustomerProductionBudgetAuthorization> = {}): CustomerProductionBudgetAuthorization {
  const { mode: _mode, ...money } = input.limits.productionBudget;
  return { parentRef: input.parentRef, tenantRef: input.tenantRef, serviceSid: input.serviceSid,
    ...money, authorizedSpendMicrousd: 1200, maxSendReservations: 2, notBefore: Date.now()-1000, expiresAt: Date.now()+600000, ...patch };
}
function admissionPolicy(input: ProductionVerificationReservation, patch: Partial<CustomerProductionAdmissionPolicy> = {}): CustomerProductionAdmissionPolicy {
  return { parentRef: input.parentRef, tenantRef: input.tenantRef, policyRef: 'target', windowMs: 3600000,
    browserSourceLimit: 100, browserTenantLimit: 1000, browserParentLimit: 1000, intentBrowserLimit: 100,
    intentSourceLimit: 100, intentTenantLimit: 1000, intentParentLimit: 1000, ...patch };
}
integration('production storage — real PostgreSQL with separate operator/runtime roles', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  let operator: PostgresCustomerProductionOperator;
  beforeAll(async () => {
    f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(f.app); operator = new PostgresCustomerProductionOperator(f.operator);
  }, 20000);
  afterAll(async () => { await f?.close(); });
  const binding = (input: ProductionVerificationReservation) => ({ parentRef: input.parentRef, tenantRef: input.tenantRef,
    browserRef: input.browserRef, browserHash: input.browserHash });
  async function prepare(input: ProductionVerificationReservation, admission: CustomerProductionAdmission = { mode: 'production_paid', sourceHash: input.ipHash }) {
    const b = binding(input);
    expect(await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: input.browserRef, admission })).not.toBeNull();
    await repo.issueBrowser({ ...b, currentBrowserHash: null }); await repo.confirmBrowser(b);
    expect(await repo.prepareIntent({ ...b, operationId: input.operationId, proofHash: input.proofHash, admission })).not.toBeNull();
  }
  async function fund(input: ProductionVerificationReservation, patch: Partial<CustomerProductionBudgetAuthorization> = {}) {
    await operator.authorizeAdmissions(admissionPolicy(input));
    const a = authorization(input, patch); const stored = a;
    // Funding metadata contains no policy mode at the operator boundary.
    await operator.authorizeBudget(stored);
    expect(await operator.activateBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef,
      authorizationRef: a.authorizationRef, expectedActiveAuthorizationRef: null })).toBe(true);
    return stored;
  }
  const available = (input: ProductionVerificationReservation) => repo.productionSendAvailability({ parentRef: input.parentRef,
    tenantRef: input.tenantRef, serviceSid: input.serviceSid, authorizationRef: input.limits.productionBudget.authorizationRef,
    costEvidenceReference: input.limits.productionBudget.costEvidenceReference, reservePerSendMicrousd: input.limits.productionBudget.reservePerSendMicrousd });
  const original = (input: ProductionVerificationReservation) => repo.revalidateProductionFunding({ parentRef: input.parentRef,
    tenantRef: input.tenantRef, challengeId: input.challengeId });
  async function spent(input: ProductionVerificationReservation) {
    return (await f.admin.query(`SELECT authorization_ref,reserved_sends::int AS sends,reserved_spend_microusd::int AS spent
      FROM customer.production_budget_authorizations WHERE parent_ref=$1 ORDER BY authorization_ref`, [input.parentRef])).rows;
  }

  it('requires a persisted active grant; status reads cannot create or consume one', async () => {
    const input = reservation();
    expect(await available(input)).toBe(false);
    await operator.authorizeAdmissions(admissionPolicy(input));
    await prepare(input);
    expect(await repo.reserve(input)).toEqual({ kind: 'denied' });
    expect(await spent(input)).toEqual([]);
    const stored = authorization(input);
    await operator.authorizeBudget(stored);
    expect(await available(input)).toBe(false);
    await operator.activateBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef, authorizationRef: 'A', expectedActiveAuthorizationRef: null });
  });

  it('serializes the last monetary unit and send count, including failed/uncertain delivery', async () => {
    const input = reservation(); await fund(input, { authorizedSpendMicrousd: 600, maxSendReservations: 10 });
    const second = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef, limits: input.limits });
    await Promise.all([prepare(input), prepare(second)]);
    expect(await available(input)).toBe(true); expect(await available(input)).toBe(true);
    const results = await Promise.all([repo.reserve(input), repo.reserve(second)]);
    expect(results.map(x => x.kind).sort()).toEqual(['denied','reserved']);
    const winner = results[0]!.kind==='reserved' ? input : second;
    expect(await original(winner)).toBe(true);
    expect(await available(winner)).toBe(false);
    await repo.settleSend({ parentRef: winner.parentRef, tenantRef: winner.tenantRef, challengeId: winner.challengeId,
      now: Date.now(), verificationSid: null });
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
    expect(await repo.reserve(winner)).toEqual({ kind: 'uncertain' });
  });

  it('enforces the explicit send ceiling independently of the monetary cap', async () => {
    const input = reservation(); await fund(input, { maxSendReservations: 1, authorizedSpendMicrousd: 6000 });
    const second = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef });
    await prepare(input); await prepare(second);
    expect((await repo.reserve(input)).kind).toBe('reserved');
    expect(await repo.reserve(second)).toEqual({ kind: 'denied' });
    expect(await available(input)).toBe(false);
  });

  it('rotates A→B without refunding A or moving its pending/check funding to B', async () => {
    const input = reservation(); const a = await fund(input, { authorizedSpendMicrousd: 600 }); await prepare(input);
    expect((await repo.reserve(input)).kind).toBe('reserved');
    const pending = await repo.settleSend({ parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
      now: Date.now(), verificationSid: `VE${hash().slice(0,32)}` });
    const b = { ...a, authorizationRef: 'B', costEvidenceReference: 'cost-B', authorizedSpendMicrousd: 1200 };
    await operator.authorizeBudget(b);
    expect(await operator.activateBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef,
      authorizationRef: 'B', expectedActiveAuthorizationRef: null })).toBe(false);
    expect(await operator.activateBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef,
      authorizationRef: 'B', expectedActiveAuthorizationRef: 'A' })).toBe(true);
    const nextLimits = { ...input.limits, productionBudget: { ...input.limits.productionBudget, authorizationRef: 'B', costEvidenceReference: 'cost-B' } };
    expect(await repo.reserve({ ...input, limits: nextLimits })).toEqual({ kind: 'pending', challenge: pending });
    const check = await repo.claimCheck({ parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
      operationId: input.operationId, proofHash: input.proofHash, requestHash: input.requestHash, browserRef: input.browserRef,
      browserHash: input.browserHash, checkId: randomUUID(), now: Date.now() });
    expect(check?.funding).toEqual(pending?.funding); expect(check?.funding).toMatchObject({ mode: 'production_paid', authorizationRef: 'A' });
    expect(await original(input)).toBe(true);
    const next = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef, limits: nextLimits }); await prepare(next);
    expect((await repo.reserve(next)).kind).toBe('reserved');
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }, { authorization_ref: 'B', sends: 1, spent: 600 }]);
    await expect(operator.activateBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef,
      authorizationRef: 'A', expectedActiveAuthorizationRef: 'B' })).rejects.toThrow();
    expect(await operator.revokeBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef, authorizationRef: 'A' })).toBe(true);
    expect(await original(input)).toBe(false); expect(await original(next)).toBe(true);
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }, { authorization_ref: 'B', sends: 1, spent: 600 }]);
  });

  it('never lifts historical pilot ceilings; runtime and operator cannot reset financial evidence', async () => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    const before = (await f.admin.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0];
    await expect(f.app.query("UPDATE customer.production_budget_authorizations SET authorized_spend_microusd=9999")).rejects.toMatchObject({ code: '42501' });
    await expect(f.app.query("UPDATE customer.production_budget_authorizations SET reserved_spend_microusd=0")).rejects.toMatchObject({ code: '42501' });
    await expect(f.app.query("DELETE FROM customer.production_budget_activation")).rejects.toMatchObject({ code: '42501' });
    await expect(f.operator.query("UPDATE customer.production_budget_authorizations SET authorized_spend_microusd=9999")).rejects.toMatchObject({ code: '42501' });
    await expect(f.operator.query("UPDATE customer.production_budget_authorizations SET reserved_spend_microusd=0")).rejects.toMatchObject({ code: '42501' });
    await expect(f.operator.query('INSERT INTO customer.reservations DEFAULT VALUES')).rejects.toMatchObject({ code: '42501' });
    await expect(f.admin.query('DELETE FROM customer.production_budget_authorizations WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    await expect(f.admin.query('UPDATE customer.production_budget_authorizations SET reserved_sends=0 WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    await expect(f.admin.query('UPDATE customer.production_budget_authorizations SET authorized_spend_microusd=2400 WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    expect((await f.admin.query('SELECT send_limit,sms_limit,verification_limit FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0])
      .toEqual({ send_limit: before.send_limit, sms_limit: before.sms_limit, verification_limit: before.verification_limit });
  });

  it('binds persisted grants to tenant, parent, service and exact cost evidence', async () => {
    const input = reservation(); await fund(input); await prepare(input);
    for (const changed of [{ tenantRef: 'another' }, { parentRef: 'another' }, { serviceSid: `VA${'2'.repeat(32)}` }]) {
      expect(await available({ ...input, ...changed })).toBe(false);
    }
    for (const changed of [{ authorizationRef: 'another' }, { reservePerSendMicrousd: 1 }, { costEvidenceReference: 'other' }]) {
      expect(await available({ ...input, limits: { ...input.limits, productionBudget: { ...input.limits.productionBudget, ...changed } } })).toBe(false);
    }
    expect(await withCustomerScope(f.app, { ...input, parentRef: 'other' }, async c => (await c.query('SELECT 1 FROM customer.production_budget_authorizations')).rowCount)).toBe(0);
    const runtimeOperator = new PostgresCustomerProductionOperator(f.app);
    await expect(runtimeOperator.authorizeAdmissions(admissionPolicy(reservation()))).rejects.toThrow();
  });

  it('preserves admissions without an SMS grant, then after depletion and financial revocation', async () => {
    const input = reservation(); await operator.authorizeAdmissions(admissionPolicy(input)); await prepare(input);
    expect(await available(input)).toBe(false);
    await fund(input, { authorizedSpendMicrousd: 600 }); expect((await repo.reserve(input)).kind).toBe('reserved');
    const second = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef }); await prepare(second);
    expect(await available(second)).toBe(false);
    await operator.revokeBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef, authorizationRef: 'A' });
    const third = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef }); await prepare(third);
    expect(await repo.validateBrowser(binding(third))).not.toBeNull();
  });

  it('retains saturated source windows and reads, and persists unknown-close tombstones', async () => {
    const input = reservation(); await operator.authorizeAdmissions(admissionPolicy(input, { browserSourceLimit: 1, intentSourceLimit: 2 }));
    const source = { mode: 'production_paid' as const, sourceHash: input.ipHash }; await prepare(input, source);
    const second = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef });
    expect(await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: second.browserRef, admission: source })).toBeNull();
    expect(await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: input.browserRef })).toMatchObject({ state: 'confirmed' });
    const closeId = randomUUID();
    expect(await repo.closeIntent({ ...binding(input), operationId: closeId, admission: source })).toMatchObject({ state: 'closed' });
    expect(await repo.prepareIntent({ ...binding(input), operationId: closeId, proofHash: hash(), admission: source })).toMatchObject({ intent: { state: 'closed' }, emitCookie: false });
    expect(await repo.closeIntent({ ...binding(input), operationId: randomUUID(), admission: source })).toBeNull();
    expect(await repo.closeIntent({ ...binding(input), operationId: input.operationId })).toMatchObject({ state: 'closed' });
    expect((await f.admin.query('SELECT kind,count(*)::int AS count FROM customer.production_admissions WHERE parent_ref=$1 GROUP BY kind ORDER BY kind', [input.parentRef])).rows)
      .toEqual([{ kind: 'browser', count: 1 }, { kind: 'intent', count: 2 }]);
    await expect(f.app.query('DELETE FROM customer.production_admissions')).rejects.toMatchObject({ code: '42501' });
  });

  it('serializes final browser and intention admission, preserving max three live proof intents even when closed', async () => {
    const input = reservation(); await operator.authorizeAdmissions(admissionPolicy(input, { browserTenantLimit: 1, browserParentLimit: 1 }));
    const inputs = Array.from({ length: 6 }, () => reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef }));
    const results = await Promise.all(inputs.map(x => repo.prepareBrowser({ parentRef: x.parentRef, tenantRef: x.tenantRef,
      browserRef: x.browserRef, admission: { mode: 'production_paid', sourceHash: x.ipHash } })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = inputs[results.findIndex(Boolean)]!; await prepare(winner);
    const intents = Array.from({ length: 5 }, () => ({ ...binding(winner), operationId: randomUUID(), proofHash: hash(), admission: { mode: 'production_paid' as const, sourceHash: hash() } }));
    const admitted = await Promise.all(intents.map(x => repo.prepareIntent(x)));
    expect(admitted.filter(Boolean)).toHaveLength(2);
    await repo.closeIntent({ ...binding(winner), operationId: winner.operationId });
    expect(await repo.prepareIntent({ ...binding(winner), operationId: randomUUID(), proofHash: hash(), admission: { mode: 'production_paid', sourceHash: hash() } })).toBeNull();
  });
  it('rejects expired authorization after waiting on the parent lock without a debit, while browser access stays available', async () => {
    const input = reservation(); await operator.authorizeAdmissions(admissionPolicy(input)); await prepare(input);
    await fund(input, { expiresAt: Date.now()+500 });
    const blocker = await f.admin.connect(); let waiting: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef]);
      waiting = repo.reserve({ ...input, now: 0 });
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'`, [f.database, f.role])).rows[0].n).toBe(1);
      await blocker.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))::double precision+0.02)
        FROM customer.production_budget_authorizations WHERE parent_ref=$1`, [input.parentRef]);
      await blocker.query('COMMIT');
      expect(await waiting).toEqual({ kind: 'denied' }); expect(await available(input)).toBe(false);
      expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 0, spent: 0 }]);
      await prepare(reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef }));
    } finally { await blocker.query('ROLLBACK').catch(() => undefined); blocker.release(); await waiting; }
  });

  it('rechecks revoked original authorization after a check claim, preserving the receipt and prohibiting SQL check bypass', async () => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    await repo.settleSend({ parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
      now: Date.now(), verificationSid: `VE${hash().slice(0,32)}` });
    const check = { parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
      operationId: input.operationId, proofHash: input.proofHash, requestHash: input.requestHash, browserRef: input.browserRef,
      browserHash: input.browserHash, checkId: randomUUID(), now: Date.now() };
    expect(await repo.claimCheck(check)).not.toBeNull(); expect(await original(input)).toBe(true);
    await operator.revokeBudget({ parentRef: input.parentRef, tenantRef: input.tenantRef, authorizationRef: 'A' });
    expect(await original(input)).toBe(false);
    await expect(f.admin.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id,request_hash)
      VALUES($1,$2,$3,$4,$5)`, [randomUUID(), input.parentRef, input.tenantRef, input.challengeId, hash()])).rejects.toMatchObject({ code: '23514' });
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
  });

  it('keeps the original admission revocation timestamp on identical updates and cannot undo it', async () => {
    const input = reservation(); await operator.authorizeAdmissions(admissionPolicy(input)); await prepare(input);
    const first = await withCustomerScope(f.operator, input, async c => (await c.query<{ revoked_at: string }>(
      `UPDATE customer.production_admission_policies SET revoked_at=clock_timestamp()
       WHERE parent_ref=$1 AND tenant_ref=$2 RETURNING revoked_at::text`, [input.parentRef, input.tenantRef])).rows[0]!.revoked_at);
    const replay = await withCustomerScope(f.operator, input, async c => (await c.query<{ revoked_at: string }>(
      `UPDATE customer.production_admission_policies SET revoked_at=revoked_at
       WHERE parent_ref=$1 AND tenant_ref=$2 RETURNING revoked_at::text`, [input.parentRef, input.tenantRef])).rows[0]!.revoked_at);
    expect(replay).toBe(first);
    await expect(withCustomerScope(f.operator, input, c => c.query(`UPDATE customer.production_admission_policies
      SET revoked_at=NULL WHERE parent_ref=$1 AND tenant_ref=$2`, [input.parentRef, input.tenantRef]))).rejects.toThrow();
    await expect(withCustomerScope(f.operator, input, c => c.query(`UPDATE customer.production_admission_policies
      SET revoked_at=clock_timestamp()+interval '1 day' WHERE parent_ref=$1 AND tenant_ref=$2`, [input.parentRef, input.tenantRef]))).rejects.toThrow();
    expect(await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: randomUUID(),
      admission: { mode: 'production_paid', sourceHash: hash() } })).toBeNull();
    expect(await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: input.browserRef })).toMatchObject({ state: 'confirmed' });
    expect((await f.admin.query('SELECT revoked_at::text FROM customer.production_admission_policies WHERE parent_ref=$1', [input.parentRef])).rows[0].revoked_at).toBe(first);
  });

});
