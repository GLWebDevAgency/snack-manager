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

  it('admits six distinct customers on one production IP and refuses the seventh without a debit', async () => {
    const input = reservation(); input.limits.ipSendReservations = 6;
    await fund(input, { maxSendReservations: 10, authorizedSpendMicrousd: 6000 });
    for (let index = 0; index < 7; index++) {
      const next = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef,
        ipHash: input.ipHash, limits: input.limits });
      await prepare(next);
      expect((await repo.reserve(next)).kind).toBe(index < 6 ? 'reserved' : 'denied');
    }
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 6, spent: 3600 }]);
  });

  const dates = (age = 0) => ({ providerCreatedAt: 1_800_000_000_000,
    providerObservedAt: 1_800_000_000_000 + age });
  const settle = (input: ProductionVerificationReservation, age = 0) => repo.settleSend({ ...input,
    verificationSid: `VE${hash().slice(0,32)}`, ...dates(age) });

  it.each([0, 1000, 597_000])('persists a conservative provider age of %i ms from the original SQL anchor', async age => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    const before = (await f.admin.query('SELECT created_at,expires_at FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0];
    const guard = (await f.admin.query(`SELECT extract(epoch FROM (g.active_until-c.created_at))*1000 AS duration
      FROM customer.phone_guards g JOIN customer.challenges c ON c.parent_ref=g.parent_ref
      WHERE c.id=$1 AND g.global_phone_hash=$2`, [input.challengeId,input.globalPhoneHash])).rows[0];
    expect(Number(guard.duration)).toBeGreaterThanOrEqual(650_000);
    const pending = await settle(input, age); expect(pending).not.toBeNull();
    const row = (await f.admin.query(`SELECT created_at,expires_at,provider_created_at,provider_observed_at,
      extract(epoch FROM (expires_at-created_at))*1000 AS duration FROM customer.challenges WHERE id=$1`, [input.challengeId])).rows[0];
    expect(row.created_at).toEqual(before.created_at); expect(Number(row.duration)).toBe(598_000-age);
    expect(row.expires_at.getTime()).toBeLessThanOrEqual(before.expires_at.getTime());
    expect(row.provider_created_at.getTime()).toBe(dates(age).providerCreatedAt);
    expect(row.provider_observed_at.getTime()).toBe(dates(age).providerObservedAt);
    const replay = await repo.settleSend({ ...input, verificationSid: pending!.verificationSid, ...dates(0) });
    expect(replay?.expiresAt).toBe(pending!.expiresAt);
    expect((await f.admin.query('SELECT expires_at,provider_observed_at FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0])
      .toEqual({ expires_at: row.expires_at, provider_observed_at: row.provider_observed_at });
  });

  it.each([598_000, 599_000, 600_000, 86_400_000])('never publishes a provider resource already %i ms old', async age => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    expect(await settle(input, age)).toBeNull();
    expect((await f.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0].state).toBe('expired');
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
  });

  it('keeps a missing acknowledgement uncertain and refuses an old writer without date evidence', async () => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    const sid = `VE${hash().slice(0,32)}`;
    await expect(f.admin.query("UPDATE customer.challenges SET state='pending',verification_sid=$2 WHERE id=$1",
      [input.challengeId, sid])).rejects.toMatchObject({ code: '23514' });
    expect(await repo.settleSend({ ...input, verificationSid: sid })).toBeNull();
    expect((await f.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0].state).toBe('uncertain');
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
  });

  it('cannot rewrite the original SQL anchor, date evidence or deadline after settlement', async () => {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input); await settle(input);
    for (const assignment of ["created_at=created_at+interval '1 second'", "expires_at=expires_at+interval '1 millisecond'",
      "provider_observed_at=provider_observed_at+interval '1 second'", 'provider_created_at=NULL,provider_observed_at=NULL']) {
      await expect(f.admin.query(`UPDATE customer.challenges SET ${assignment} WHERE id=$1`, [input.challengeId])).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('rejects the unobserved SID of an old uncertain send after its phone guard has elapsed', async () => {
    const input = reservation(); const grant = await fund(input);
    const oldId = randomUUID(); const oldOperation = randomUUID();
    // Historical ACK-lost evidence is inserted at its original time. No journal
    // is rewritten, clock mocked, guard disabled or provider contacted.
    await f.admin.query(`WITH stamp AS (SELECT clock_timestamp()-interval '11 minutes' AS at)
      INSERT INTO customer.challenges(id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,
        service_sid,max_checks,created_at,expires_at,state)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,5,at,at+interval '10 minutes','uncertain' FROM stamp`,
    [oldId,input.parentRef,input.tenantRef,oldOperation,hash(),hash(),input.phoneHash,input.encryptedPhone,input.serviceSid]);
    await f.admin.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,
      sms_units,reserved_at,funding_kind,production_authorization_ref,reserved_microusd,funding_expires_at,cost_evidence_reference)
      VALUES($1,$2,$3,$4,$5,$6,'observed',2,clock_timestamp()-interval '11 minutes','production_paid','A',600,$7,'cost-A')`,
    [oldOperation,input.parentRef,input.tenantRef,oldId,input.globalPhoneHash,input.ipHash,new Date(grant.expiresAt)]);
    await f.admin.query(`INSERT INTO customer.phone_guards(parent_ref,global_phone_hash,active_until)
      VALUES($1,$2,clock_timestamp()-interval '10 seconds')`, [input.parentRef,input.globalPhoneHash]);
    await prepare(input); expect((await repo.reserve(input)).kind).toBe('reserved');
    const sid = `VE${hash().slice(0,32)}`;
    expect(await repo.settleSend({ ...input, verificationSid: sid, ...dates(660_000) })).toBeNull();
    expect((await f.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [oldId])).rows[0].state).toBe('uncertain');
    expect((await f.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0].state).toBe('expired');
    expect(await repo.claimCheck({ ...input, checkId: randomUUID() })).toBeNull();
    expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 2, spent: 1200 }]);
  });

  async function claimedShortChallenge() {
    const input = reservation(); await fund(input); await prepare(input); await repo.reserve(input);
    expect(await settle(input, 597_000)).not.toBeNull();
    const check = { ...input, checkId: randomUUID(), requestHash: hash() };
    expect(await repo.claimCheck(check)).not.toBeNull();
    return { ...check, result: 'approved' as const, accountId: randomUUID(), sessionId: randomUUID(),
      sessionHash: hash(), sessionExpiresAt: Date.now()+600_000, existingSessionHash: null };
  }

  it('refuses a provider approval after the local age deadline while waiting on the SQL parent lock', async () => {
    const input = await claimedShortChallenge(); const blocker = await f.admin.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef]);
      const waiting = repo.completeCheck(input);
      await blocker.query('SELECT pg_sleep(1.05)'); await blocker.query('COMMIT');
      expect(await waiting).toBeNull();
      expect((await f.admin.query('SELECT id FROM customer.registration_enrollments WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
      expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('rolls back enrollment inserted after its final time predicate when the code expires during the SQL statement', async () => {
    await f.admin.query(`CREATE SEQUENCE customer.fixture_phone_enrollment_hits;
      GRANT USAGE ON SEQUENCE customer.fixture_phone_enrollment_hits TO "${f.role}";
      CREATE FUNCTION customer.fixture_delay_phone_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE remaining double precision;
      BEGIN
        SELECT extract(epoch FROM (expires_at-clock_timestamp())) INTO remaining
          FROM customer.challenges WHERE id=NEW.challenge_id;
        IF remaining IS NULL OR remaining<=0 OR remaining>1.1 THEN RAISE EXCEPTION 'Fixture checkpoint not reached'; END IF;
        PERFORM nextval('customer.fixture_phone_enrollment_hits');
        PERFORM pg_sleep(remaining+0.03);
        PERFORM nextval('customer.fixture_phone_enrollment_hits');
        RETURN NEW;
      END; $$;
      CREATE TRIGGER fixture_delay_phone_enrollment BEFORE INSERT ON customer.registration_enrollments
      FOR EACH ROW EXECUTE FUNCTION customer.fixture_delay_phone_enrollment()`);
    try {
      const input = await claimedShortChallenge();
      await expect(repo.completeCheck(input)).rejects.toThrow('Identité client indisponible');
      // Sequences survive transaction rollback: the test must actually cross
      // the deadline, not pass due to a setup/checkpoint failure before INSERT.
      expect((await f.admin.query('SELECT last_value,is_called FROM customer.fixture_phone_enrollment_hits')).rows[0])
        .toEqual({ last_value: '2', is_called: true });
      expect((await f.admin.query('SELECT id FROM customer.registration_enrollments WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
      expect((await f.admin.query('SELECT id FROM customer.accounts WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
      expect((await f.admin.query('SELECT state FROM customer.check_attempts WHERE id=$1', [input.checkId])).rows[0].state).toBe('checking');
      expect(await spent(input)).toEqual([{ authorization_ref: 'A', sends: 1, spent: 600 }]);
    } finally {
      await f.admin.query(`DROP TRIGGER fixture_delay_phone_enrollment ON customer.registration_enrollments;
        DROP FUNCTION customer.fixture_delay_phone_enrollment(); DROP SEQUENCE customer.fixture_phone_enrollment_hits`);
    }
  });

  it('rotates A→B without refunding A or moving its pending/check funding to B', async () => {
    const input = reservation(); const a = await fund(input, { authorizedSpendMicrousd: 600 }); await prepare(input);
    expect((await repo.reserve(input)).kind).toBe('reserved');
    const pending = await repo.settleSend({ parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
      now: Date.now(), verificationSid: `VE${hash().slice(0,32)}`,
      providerCreatedAt: 1_800_000_000_000, providerObservedAt: 1_800_000_000_000 });
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
      now: Date.now(), verificationSid: `VE${hash().slice(0,32)}`,
      providerCreatedAt: 1_800_000_000_000, providerObservedAt: 1_800_000_000_000 });
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
