import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOMER_LOYALTY_NOTICE_VERSION, CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION, type CustomerLoyaltyRequest } from '@sm/contracts';
import { CustomerIdentityCrypto, PostgresCustomerIdentityRepository, withProtectedCustomerSession,
  type CustomerIdentityRepository, type CustomerSession, type VerificationReservation } from '@sm/customer';
import { LoyaltyCryptoAdapter, loyaltyDb } from '@sm/loyalty';
import { LoyaltyMemberService, type LoyaltyActorContext } from '../loyalty/loyalty-member.service';
import type { LoyaltyPurchaseVerifier } from '../loyalty/loyalty-purchase-verifier';
import { CustomerLoyaltyStoreError, runCustomerLoyalty, readCustomerLoyaltySaleAttribution, type CustomerLoyaltyStoreContext,
  type CustomerLoyaltyStoreResult } from './customer-loyalty.store';
import { CustomerSaleAttributionService } from './customer-sale-attribution.service';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
type Fixture = { app: Pool; admin: Pool; role: string; close(): Promise<void> };
type Completion = Parameters<CustomerIdentityRepository['completeCheck']>[0];
type Principal = Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
type Join = Extract<CustomerLoyaltyRequest, { step: 'join' }>;
const identity = new CustomerIdentityCrypto(Buffer.alloc(32, 53).toString('base64'));
const crypto = new LoyaltyCryptoAdapter({ encryptionKeyBase64: Buffer.alloc(32, 17).toString('base64'),
  phoneLookupKeyBase64: Buffer.alloc(32, 43).toString('base64'), operationFingerprintKeyBase64: Buffer.alloc(32, 91).toString('base64'),
  qrTokenDerivationKeyBase64: Buffer.alloc(32, 127).toString('base64') });
const actor: LoyaltyActorContext = { source: 'pos', actorRef: 'fixture-cashier', deviceRef: 'fixture-pos' };
const manager: LoyaltyActorContext = { source: 'admin', actorRef: 'fixture-manager', deviceRef: null };

integration('customer loyalty writer — protected account and ordinary PostgreSQL role, no provider', () => {
  let f: Fixture;
  let repo: PostgresCustomerIdentityRepository;
  let pos: LoyaltyMemberService;
  let complete: (repo: CustomerIdentityRepository, input: Completion) => Promise<CustomerSession | null>;
  beforeAll(async () => {
    // Dynamic imports reuse the guarded disposable fixture without pulling its
    // sources into the Nest build. The upstream proof is simulated; every
    // repository enrollment/protection/publication transaction is genuine.
    const fixturePath = resolve(__dirname, '../../../../../packages/customer/src/test-fixture.ts');
    const enrollmentPath = resolve(__dirname, '../../../../../packages/customer/src/enrollment-test-fixture.ts');
    const fixture = await import(/* @vite-ignore */ fixturePath) as { customerTestFixture(raw: unknown): Promise<Fixture> };
    complete = (await import(/* @vite-ignore */ enrollmentPath) as { completeCustomerTestAccount: typeof complete }).completeCustomerTestAccount;
    f = await fixture.customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    await f.admin.query(`GRANT USAGE ON SCHEMA loyalty TO "${f.role}";
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA loyalty TO "${f.role}"`);
    repo = new PostgresCustomerIdentityRepository(f.app);
    pos = new LoyaltyMemberService(loyaltyDb(f.app), crypto, {
      confirmedPurchaseCents: async () => { throw new Error('Purchase/provider boundary must not be called'); },
    } as unknown as LoyaltyPurchaseVerifier);
  }, 20_000);
  afterAll(async () => { await f?.close(); });

  async function account(options: { phone?: string; name?: string | null; tenantRef?: string; parentRef?: string } = {}) {
    const now = Date.now();
    const phone = options.phone ?? '+33600000000';
    const tenantRef = options.tenantRef ?? `tenant_${hash()}`;
    const phoneHash = identity.hash('phone', tenantRef, phone);
    const input: VerificationReservation = { parentRef: options.parentRef ?? `parent_${hash()}`, tenantRef,
      browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash(), requestHash: hash(),
      challengeId: randomUUID(), phoneHash, globalPhoneHash: hash(), ipHash: hash(),
      encryptedPhone: identity.seal('phone', tenantRef, phoneHash, phone), serviceSid: `VA${randomBytes(16).toString('hex')}`,
      evidenceReference: 'fixture', planExpiresAt: now + 600_000, expiresAt: now + 600_000, now,
      limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1, freeSmsUnitsRemainingAtObservation: 100,
        freeVerificationUnitsRemainingAtObservation: 100, cooldownMs: 60_000, windowMs: 86_400_000,
        globalSendReservations: 10, tenantSendReservations: 10, phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } };
    const binding = { parentRef: input.parentRef, tenantRef, browserRef: input.browserRef, browserHash: input.browserHash };
    await repo.prepareBrowser({ parentRef: input.parentRef, tenantRef, browserRef: input.browserRef });
    await repo.issueBrowser({ ...binding, currentBrowserHash: null }); await repo.confirmBrowser(binding);
    await repo.prepareIntent({ ...binding, operationId: input.operationId, proofHash: input.proofHash });
    expect((await repo.reserve(input)).kind).toBe('reserved');
    await repo.settleSend({ ...input, verificationSid: `VE${randomBytes(16).toString('hex')}` });
    const check = { ...input, checkId: randomUUID(), requestHash: hash() };
    expect(await repo.claimCheck(check)).not.toBeNull();
    const completion: Completion = { ...check, result: 'approved', accountId: randomUUID(), sessionId: randomUUID(),
      sessionHash: hash(), sessionExpiresAt: now + 604_800_000, existingSessionHash: null };
    const session = await complete(repo, completion);
    expect(session).not.toBeNull();
    const principal: Principal = { ...binding, sessionHash: completion.sessionHash,
      expectedOperationId: input.operationId, expectedCheckId: check.checkId, now };
    const name = options.name === undefined ? 'Camille Martin' : options.name;
    if (name !== null) expect(await repo.updateName({ ...principal, browserHash: input.browserHash,
      encryptedName: identity.seal('name', tenantRef, completion.accountId, name), expectedRevision: 0 })).not.toBeNull();
    return { principal, phone, name, accountId: completion.accountId, sessionId: completion.sessionId };
  }
  async function program(tenantRef: string) {
    const id = randomUUID();
    const client = await f.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status) VALUES($1,$2,'active')", [id, tenantRef]);
      await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,spend_step_cents,units_per_step,
        unit_label_singular,unit_label_plural,terms_summary) VALUES($1,$2,1,'Club fixture','points',100,1,'point','points','Un point par euro.')`, [tenantRef, id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return id;
  }
  const join = (programId: string): Join => ({ step: 'join', operationId: randomUUID(), programId, rulesVersion: 1,
    termsAccepted: true, termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION });
  async function run(a: Awaited<ReturnType<typeof account>>, request: CustomerLoyaltyRequest,
    after?: (context: CustomerLoyaltyStoreContext, result: CustomerLoyaltyStoreResult) => Promise<void>,
    interpose?: (context: CustomerLoyaltyStoreContext) => CustomerLoyaltyStoreContext) {
    let safe: CustomerLoyaltyStoreResult | undefined;
    let native: unknown;
    try {
      return await withProtectedCustomerSession(f.app, a.principal, async context => {
        try {
          const original = { ...context, scope: a.principal, identity, crypto };
          const ctx = interpose ? interpose(original) : original;
          const result = await runCustomerLoyalty(ctx, request);
          await after?.(ctx, result);
          return result;
        } catch (error) {
          if (error instanceof CustomerLoyaltyStoreError) safe = error.result;
          else native = error;
          throw error;
        }
      });
    } catch (error) { if (safe) return safe; if (native) throw native; throw error; }
  }
  async function rows(tenantRef: string) {
    const names = ['members', 'member_profiles', 'wallets', 'membership_events', 'member_tokens', 'operations'];
    const counts: Record<string, number> = {};
    for (const table of names) counts[table] = (await f.admin.query(`SELECT count(*)::int AS n FROM loyalty.${table} WHERE tenant_ref=$1`, [tenantRef])).rows[0].n;
    counts.links = (await f.admin.query('SELECT count(*)::int AS n FROM customer.loyalty_memberships WHERE tenant_ref=$1', [tenantRef])).rows[0].n;
    return counts;
  }
  const empty = { members: 0, member_profiles: 0, wallets: 0, membership_events: 0, member_tokens: 0, operations: 0, links: 0 };

  const attach = (programId: string, qrToken: string): Extract<CustomerLoyaltyRequest, { step: 'attach' }> => ({
    step: 'attach', operationId: randomUUID(), programId, rulesVersion: 1, qrToken,
    termsAccepted: true, termsNoticeVersion: CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION,
  });
  async function existingCard(a: Awaited<ReturnType<typeof account>>, handed = true, phone: string | null = a.phone) {
    const operationId = randomUUID();
    const created = await pos.createMember(a.principal.tenantRef, { operationId, firstName: 'Carte POS existante', phone,
      termsAccepted: true, termsNoticeVersion: 'loyalty-2026-09' }, actor);
    if (handed) await pos.acknowledgeEnrollment(a.principal.tenantRef, { operationId }, actor);
    return { ...created, operationId };
  }
  async function preserved(tenantRef: string) {
    const snapshot: Record<string, unknown> = {};
    for (const table of ['member_profiles', 'wallets', 'ledger_entries', 'consent_events', 'consent_state']) {
      snapshot[table] = (await f.admin.query(`SELECT * FROM loyalty.${table} WHERE tenant_ref=$1`, [tenantRef])).rows;
    }
    snapshot.members = (await f.admin.query('SELECT id,status,joined_at,enrollment_handoff_at FROM loyalty.members WHERE tenant_ref=$1', [tenantRef])).rows;
    snapshot.joined = (await f.admin.query("SELECT * FROM loyalty.membership_events WHERE tenant_ref=$1 AND kind='joined'", [tenantRef])).rows;
    return snapshot;
  }

  async function attribution(a: Awaited<ReturnType<typeof account>>, interpose?: (ctx: CustomerLoyaltyStoreContext) => CustomerLoyaltyStoreContext) {
    return withProtectedCustomerSession(f.app, a.principal, async context => {
      const ctx = { ...context, scope: a.principal, identity, crypto };
      return readCustomerLoyaltySaleAttribution(interpose ? interpose(ctx) : ctx);
    });
  }
  it('sale attribution reads the current immutable rule, not the enrollment consent version, without writing or decrypting', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    const joined = await run(a, request); if (joined?.state !== 'member') throw new Error('Membership fixture missing');
    await f.admin.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
      maximum_units_per_purchase,spend_step_cents,units_per_step,unit_label_singular,unit_label_plural)
      VALUES($1,$2,2,'Club publié','points',500,50,200,3,'point','points')`, [a.principal.tenantRef, id]);
    await f.admin.query('UPDATE loyalty.programs SET current_version=2 WHERE id=$1', [id]);
    const before = await preserved(a.principal.tenantRef), counts = await rows(a.principal.tenantRef);
    const result = await attribution(a, ctx => ({ ...ctx, identity: { open: () => { throw new Error('Profile must not be opened'); } } as never,
      crypto: new Proxy(crypto, { get(target, key) {
        if (['decryptProfile', 'deriveEnrollmentQrToken', 'phoneLookupHash'].includes(String(key))) return () => { throw new Error('Private material must not be loaded'); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } }) }));
    expect(result).toEqual({ decision: 'attributed', memberId: joined.member.id, membershipOperationId: request.operationId,
      programId: id, rulesVersion: 2, rule: { mechanism: 'points', minimumPurchaseCents: 500, maximumUnitsPerPurchase: 50,
        spendStepCents: 200, unitsPerStep: 3 } });
    expect(await preserved(a.principal.tenantRef)).toEqual(before); expect(await rows(a.principal.tenantRef)).toEqual(counts);
    expect(JSON.stringify(result)).not.toMatch(/phone|encrypted|qrToken|balance|name|sessionHash|browserHash/);
  });
  it('sale attribution supports the exact attachment receipt without returning the former or current QR', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    const request = attach(id, old.qrToken); expect((await run(a, request))?.state).toBe('member');
    expect(await attribution(a)).toMatchObject({ decision: 'attributed', memberId: old.member.id, membershipOperationId: request.operationId,
      programId: id, rulesVersion: 1 });
    expect(JSON.stringify(await attribution(a))).not.toContain(old.qrToken);
  });
  it('sale attribution waits for a real concurrent publication and captures its committed rule, not the previously joined version', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    expect((await run(a, request))?.state).toBe('member');
    const publisher = await f.admin.connect();
    let reading: Promise<unknown> | undefined;
    try {
      await publisher.query('BEGIN');
      const pid = (await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await publisher.query('SELECT id FROM loyalty.programs WHERE id=$1 FOR UPDATE', [id]);
      await publisher.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
        maximum_units_per_purchase,spend_step_cents,units_per_step,unit_label_singular,unit_label_plural)
        VALUES($1,$2,2,'Club publié','points',500,50,200,3,'point','points')`, [a.principal.tenantRef, id]);
      await publisher.query('UPDATE loyalty.programs SET current_version=2 WHERE id=$1', [id]);
      reading = attribution(a).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))`, [f.role, pid])).rows[0].n,
      { timeout: 2000 }).toBe(1);
      await publisher.query('COMMIT');
      expect(await reading).toMatchObject({ value: { decision: 'attributed', programId: id, rulesVersion: 2,
        rule: { mechanism: 'points', minimumPurchaseCents: 500, maximumUnitsPerPurchase: 50, spendStepCents: 200, unitsPerStep: 3 } } });
    } finally { await publisher.query('ROLLBACK'); await reading; publisher.release(); }
  });
  it('sale attribution distinguishes no active program from a missing membership without creating either', async () => {
    const a = await account();
    expect(await attribution(a)).toEqual({ decision: 'none', reason: 'program_inactive' });
    const id = await program(a.principal.tenantRef);
    expect(await attribution(a)).toEqual({ decision: 'none', reason: 'not_enrolled' });
    await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE id=$1", [id]);
    expect(await attribution(a)).toEqual({ decision: 'none', reason: 'program_inactive' });
    expect(await rows(a.principal.tenantRef)).toEqual(empty);
  });
  it.each(['block', 'anonymize'] as const)('sale attribution proves an inactive member after %s, without adopting another card', async action => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    const joined = await run(a, join(id)); if (joined?.state !== 'member') throw new Error('Membership fixture missing');
    await pos.changeLifecycle(a.principal.tenantRef, joined.member.id, action === 'block'
      ? { operationId: randomUUID(), action, reasonCode: 'suspected_sharing' }
      : { operationId: randomUUID(), action, reasonCode: 'customer_request', confirmation: 'ANONYMISER' }, manager);
    const before = await rows(a.principal.tenantRef);
    expect(await attribution(a)).toEqual({ decision: 'none', reason: 'member_inactive' });
    expect(await rows(a.principal.tenantRef)).toEqual(before);
  });
  it('sale attribution refuses a corrupt ownership receipt instead of returning not_enrolled', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); await run(a, join(id));
    let observed = false;
    await expect(attribution(a, ctx => ({ ...ctx, client: new Proxy(ctx.client, { get(target, key) {
      if (key !== 'query') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
      return async (sql: string, values?: unknown[]) => {
        const result = await target.query(sql, values);
        if (sql.includes('SELECT kind,status,request_fingerprint,result,completed_at')) {
          observed = true;
          result.rows[0]!.result = { ...result.rows[0]!.result, accountId: randomUUID() };
        }
        return result;
      };
    } }) }))).rejects.toMatchObject({ reason: 'unavailable' });
    expect(observed).toBe(true);
  });
  it.each(['missing-version', 'invalid-rule', 'unused-rule-column', 'unknown-status'] as const)(
    'sale attribution refuses %s from the real SQL read, never treating corruption as proven absence', async kind => {
      const a = await account(); await program(a.principal.tenantRef);
      let observed = false;
      await expect(attribution(a, ctx => ({ ...ctx, client: new Proxy(ctx.client, { get(target, key) {
        if (key !== 'query') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
        return async (sql: string, values?: unknown[]) => {
          const result = await target.query(sql, values);
          if (sql.includes('p.current_version AS version')) {
            expect(result.rows).toHaveLength(1); observed = true;
            if (kind === 'missing-version') result.rows[0]!.version_program_id = null;
            if (kind === 'invalid-rule') result.rows[0]!.spend_step_cents = 0;
            if (kind === 'unused-rule-column') result.rows[0]!.units_per_visit = 1;
            if (kind === 'unknown-status') result.rows[0]!.status = 'corrupt';
          }
          return result;
        };
      } }) }))).rejects.toMatchObject({ reason: 'unavailable' });
      expect(observed).toBe(true); expect(await rows(a.principal.tenantRef)).toEqual(empty);
    });
  it('sale attribution service crosses the real protected SQL boundary and refuses a revoked session even with feature disabled', async () => {
    const a = await account({ parentRef: `AC${randomBytes(16).toString('hex')}`, tenantRef: randomBytes(12).toString('hex') });
    const id = await program(a.principal.tenantRef); const request = join(id);
    const joined = await run(a, request); if (joined?.state !== 'member') throw new Error('Membership fixture missing');
    const current = await repo.authenticateProtected(a.principal); if (!current) throw new Error('Session fixture missing');
    const input = { selection: a.principal, identity,
      expected: { owner: { parentRef: a.principal.parentRef, tenantRef: a.principal.tenantRef, accountId: a.accountId },
        sessionId: current.sessionId, expiresAt: current.expiresAt }, clientId: randomUUID(),
      totals: { subtotalCents: 1500, discountCents: 500, deliveryFeeCents: 300, totalCents: 1300 }, enabled: async () => true };
    const service = new CustomerSaleAttributionService(f.app, crypto);
    const before = await rows(a.principal.tenantRef), state = await preserved(a.principal.tenantRef);
    expect(await service.prepare(input)).toEqual({ version: 1, tenantRef: a.principal.tenantRef, clientId: input.clientId,
      owner: input.expected.owner, capturedAt: expect.any(Number),
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1000, excludedChargeCents: 300, chargedTotalCents: 1300 },
      decision: 'attributed', memberId: joined.member.id, membershipOperationId: request.operationId, programId: id, rulesVersion: 1,
      rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 } });
    expect(await rows(a.principal.tenantRef)).toEqual(before); expect(await preserved(a.principal.tenantRef)).toEqual(state);
    await repo.revoke({ ...a.principal, all: false });
    await expect(service.prepare({ ...input, enabled: async () => false })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(await rows(a.principal.tenantRef)).toEqual(before); expect(await preserved(a.principal.tenantRef)).toEqual(state);
  });

  it('attaches a handed POS card atomically, preserves its history and credit, and replaces only its QR', async () => {
    const a = await account({ name: null }); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    await pos.adjust(a.principal.tenantRef, old.member.id, { operationId: randomUUID(), units: 25, reason: 'Crédit antérieur fixture' }, manager);
    const before = await preserved(a.principal.tenantRef), counts = await rows(a.principal.tenantRef);
    const request = attach(id, old.qrToken); const result = await run(a, request);
    expect(result).toMatchObject({ state: 'member', member: { id: old.member.id, balanceUnits: 25, qrGeneration: 2 } });
    expect(result).not.toHaveProperty('qrToken'); expect(await preserved(a.principal.tenantRef)).toEqual(before);
    expect(await rows(a.principal.tenantRef)).toEqual({ ...counts, operations: counts.operations! + 1,
      membership_events: counts.membership_events! + 1, member_tokens: counts.member_tokens! + 1, links: 1 });
    const operation = (await f.admin.query('SELECT kind,status,result FROM loyalty.operations WHERE tenant_ref=$1 AND operation_id=$2',
      [a.principal.tenantRef, request.operationId])).rows[0];
    expect(operation).toMatchObject({ kind: 'token_replace', status: 'completed', result: {
      customerAccountAttachment: 'v1', parentRef: a.principal.parentRef, accountId: a.accountId, memberId: old.member.id,
      previousGeneration: 1, qrGeneration: 2, termsNoticeVersion: CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION } });
    expect(JSON.stringify(operation)).not.toContain(old.qrToken); expect(JSON.stringify(operation)).not.toContain(a.phone);
    await expect(pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: old.qrToken })).rejects.toMatchObject({ status: 404 });
    const current = await run(a, { step: 'card' }); if (current?.state !== 'card') throw new Error('Attached card absent');
    expect(current.qrToken).not.toBe(old.qrToken);
    expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: current.qrToken }))
      .toMatchObject({ id: old.member.id, balanceUnits: 25 });
  });

  it('attaches a historical cutover-closed POS operation and retries without replaying a revoked QR', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    // Reproduce the exact historical cutover receipt without replaying migrations.
    await f.admin.query(`UPDATE loyalty.operations SET request_fingerprint=repeat('0',64),result='{"enrollmentCutoverClosed":true}'::jsonb
      WHERE tenant_ref=$1 AND operation_id=$2`, [a.principal.tenantRef, old.operationId]);
    const request = attach(id, old.qrToken), result = await run(a, request); expect(result?.state).toBe('member');
    const counts = await rows(a.principal.tenantRef); expect(await run(a, request)).toEqual(result);
    const replacement = await pos.replaceQr(a.principal.tenantRef, old.member.id,
      { operationId: randomUUID(), expectedGeneration: 2, reasonCode: 'lost_or_compromised' }, manager);
    expect(await run(a, request)).toMatchObject({ state: 'member', member: { qrGeneration: 3 } });
    expect(await run(a, request)).not.toHaveProperty('qrToken');
    expect(await run(a, { step: 'card' })).toMatchObject({ state: 'card', qrToken: replacement.qrToken });
    expect(await run(a, { ...request, rulesVersion: 2 })).toEqual({ state: 'conflict' });
    expect(await run(a, { ...request, qrToken: replacement.qrToken })).toEqual({ state: 'conflict' });
    expect(await run(a, { ...request, operationId: randomUUID() })).toEqual({ state: 'attachment_refused' });
    expect(await rows(a.principal.tenantRef)).toEqual({ ...counts, operations: counts.operations! + 1,
      membership_events: counts.membership_events! + 1, member_tokens: counts.member_tokens! + 1 });
    expect((await f.admin.query('SELECT result FROM loyalty.operations WHERE operation_id=$1', [old.operationId])).rows[0].result)
      .toEqual({ enrollmentCutoverClosed: true });
  });

  it.each(['wrong-phone', 'no-phone', 'unhanded', 'expired', 'wrong-qr'] as const)
    ('refuses %s attachment uniformly without linking, rotating or claiming an operation', async kind => {
      const a = await account(); const id = await program(a.principal.tenantRef);
      const old = await existingCard(a, kind !== 'unhanded', kind === 'no-phone' ? null : kind === 'wrong-phone' ? '+33600000001' : a.phone);
      if (kind === 'expired') await f.admin.query("UPDATE loyalty.member_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE member_id=$1", [old.member.id]);
      const counts = await rows(a.principal.tenantRef), before = await preserved(a.principal.tenantRef);
      expect(await run(a, attach(id, kind === 'wrong-qr' ? randomBytes(32).toString('base64url') : old.qrToken)))
        .toEqual({ state: 'attachment_refused' });
      expect(await rows(a.principal.tenantRef)).toEqual(counts); expect(await preserved(a.principal.tenantRef)).toEqual(before);
      expect((await f.admin.query('SELECT qr_generation FROM loyalty.members WHERE id=$1', [old.member.id])).rows[0].qr_generation).toBe('1');
    });

  it('rolls back a rotation when a pre-existing ownership anchor is hidden by another parent RLS scope', async () => {
    const a = await account({ phone: '+33600000001' }); const id = await program(a.principal.tenantRef);
    const b = await account({ tenantRef: a.principal.tenantRef }); const old = await existingCard(b);
    expect(b.principal.parentRef).not.toBe(a.principal.parentRef); expect(b.accountId).not.toBe(a.accountId);
    // Construct only the immutable ownership anchor to exercise the native
    // cross-parent uniqueness backstop. This does not claim to replay a valid
    // prior attachment, nor bypass the customer phone anti-duplication flow.
    await f.admin.query(`INSERT INTO customer.loyalty_memberships(parent_ref,tenant_ref,account_id,member_id,operation_id,request_hash)
      VALUES($1,$2,$3,$4,$5,$6)`, [a.principal.parentRef, a.principal.tenantRef, a.accountId, old.member.id, old.operationId, hash()]);
    const visible = await withProtectedCustomerSession(f.app, b.principal, async ({ client }) =>
      (await client.query('SELECT 1 FROM customer.loyalty_memberships WHERE tenant_ref=$1 AND member_id=$2', [a.principal.tenantRef, old.member.id])).rowCount);
    expect(visible).toBe(0);
    const before = await rows(a.principal.tenantRef);
    await expect(run(b, attach(id, old.qrToken))).rejects.toMatchObject({ code: '23505', constraint: 'loyalty_memberships_tenant_member_uq' });
    expect(await rows(a.principal.tenantRef)).toEqual(before);
    expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: old.qrToken }))
      .toMatchObject({ id: old.member.id, status: 'active' }); // The losing rotation was rolled back.
    expect((await f.admin.query('SELECT qr_generation FROM loyalty.members WHERE id=$1', [old.member.id])).rows[0].qr_generation).toBe('1');
    expect(await run(b, { step: 'card' })).toEqual({ state: 'unavailable' });
    expect(await run(b, { ...attach(id, old.qrToken), operationId: old.operationId })).toEqual({ state: 'conflict' });
  });

  it.each(['session', 'protection', 'expiry'] as const)('rolls back attachment and QR replacement after loss of %s', async what => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    const before = await rows(a.principal.tenantRef); let wrote = false;
    await expect(run(a, attach(id, old.qrToken), async ({ client }, result) => {
      wrote = result.state === 'member';
      if (what === 'expiry') {
        await client.query("UPDATE customer.sessions SET expires_at=clock_timestamp()+interval '30 milliseconds' WHERE id=$1", [a.sessionId]);
        await client.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.025)
          FROM customer.sessions WHERE id=$1`, [a.sessionId]);
      } else await client.query(what === 'session'
        ? 'UPDATE customer.sessions SET revoked_at=clock_timestamp() WHERE account_id=$1'
        : 'UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp() WHERE account_id=$1', [a.accountId]);
    })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(wrote).toBe(true); expect(await rows(a.principal.tenantRef)).toEqual(before);
    expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: old.qrToken }))
      .toMatchObject({ id: old.member.id, status: 'active' });
  });

  it.each(['profile-context', 'profile-phone', 'profile-version', 'customer-phone', 'blocked', 'anonymized'] as const)
    ('rejects %s without converting possession of a QR into account authority', async kind => {
      const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
      if (kind.startsWith('profile')) {
        const payload = crypto.encryptProfile({ tenantRef: a.principal.tenantRef,
          memberId: kind === 'profile-context' ? randomUUID() : old.member.id },
        { firstName: 'Existing', phone: kind === 'profile-phone' ? '+33600000002' : a.phone });
        await f.admin.query('UPDATE loyalty.member_profiles SET encrypted_payload=$2,key_version=$3 WHERE member_id=$1',
          [old.member.id, JSON.stringify(payload), kind === 'profile-version' ? payload.keyVersion + 1 : payload.keyVersion]);
      } else if (kind === 'customer-phone') {
        await f.admin.query('UPDATE customer.verified_contacts SET encrypted_phone=$2 WHERE account_id=$1',
          [a.accountId, identity.seal('phone', a.principal.tenantRef, hash(), a.phone)]);
      } else await pos.changeLifecycle(a.principal.tenantRef, old.member.id, kind === 'blocked'
        ? { operationId: randomUUID(), action: 'block', reasonCode: 'suspected_sharing' }
        : { operationId: randomUUID(), action: 'anonymize', reasonCode: 'customer_request', confirmation: 'ANONYMISER' }, manager);
      const before = await rows(a.principal.tenantRef);
      expect(await run(a, attach(id, old.qrToken))).toEqual({ state: 'attachment_refused' });
      expect(await rows(a.principal.tenantRef)).toEqual(before);
    });

  it('rechecks the presented token when a genuine POS rotation wins after the initial QR lookup', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    let paused = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    // Observe the exact real query/promise, then pause its return. All SQL and
    // locking still execute on the original PostgreSQL connection.
    const attachment = run(a, attach(id, old.qrToken), undefined, ctx => ({ ...ctx, client: new Proxy(ctx.client, {
      get(target, key) {
        if (key === 'query') return (...args: unknown[]) => {
          const result = Reflect.apply(target.query, target, args) as Promise<unknown>;
          return typeof args[0] === 'string' && args[0].startsWith('SELECT member_id FROM loyalty.member_tokens')
            ? result.then(async value => { paused = true; await gate; return value; }) : result;
        };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      },
    }) })).then(value => ({ value }), error => ({ error }));
    try {
      await expect.poll(() => paused, { timeout: 2000 }).toBe(true);
      const replaced = await pos.replaceQr(a.principal.tenantRef, old.member.id,
        { operationId: randomUUID(), expectedGeneration: 1, reasonCode: 'lost_or_compromised' }, manager);
      release(); expect(await attachment).toEqual({ value: { state: 'attachment_refused' } });
      expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: replaced.qrToken })).toMatchObject({ id: old.member.id });
      expect((await rows(a.principal.tenantRef)).links).toBe(0);
      expect((await rows(a.principal.tenantRef)).operations).toBe(2);
    } finally { release(); await attachment; }
  });

  it('serializes attachment against a genuine POS rotation with an observed member row-lock wait', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    let pid = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const attachment = run(a, attach(id, old.qrToken), async ({ client }, result) => {
      if (result.state !== 'member') throw new Error('Attachment did not commit its local writes');
      pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; await gate;
    }).then(value => ({ value }), error => ({ error }));
    let rotation: Promise<{ value?: unknown; error?: unknown }> | undefined;
    try {
      await expect.poll(() => pid, { timeout: 2000 }).not.toBe(0);
      rotation = pos.replaceQr(a.principal.tenantRef, old.member.id,
        { operationId: randomUUID(), expectedGeneration: 1, reasonCode: 'lost_or_compromised' }, manager)
        .then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))`, [f.role, pid])).rows[0].n,
      { timeout: 2000 }).toBe(1);
      release(); expect(await attachment).toMatchObject({ value: { state: 'member', member: { qrGeneration: 2 } } });
      expect(await rotation).toMatchObject({ error: { status: 409 } });
      expect((await rows(a.principal.tenantRef)).operations).toBe(2);
    } finally { release(); await attachment; await rotation; }
  });

  it.each(['extra-field', 'qr-proof', 'notice', 'generation', 'discriminator'] as const)
    ('rejects corrupted attachment receipt %s without treating an ordinary rotation as ownership', async kind => {
      const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
      const request = attach(id, old.qrToken); expect((await run(a, request))?.state).toBe('member');
      const { result } = (await f.admin.query('SELECT result FROM loyalty.operations WHERE operation_id=$1', [request.operationId])).rows[0];
      const patch = kind === 'extra-field' ? { customerAccountEnrollment: 'v1' } : kind === 'qr-proof' ? { presentedQrHash: hash() }
        : kind === 'notice' ? { termsNoticeVersion: 'different-notice' } : kind === 'generation' ? { qrGeneration: 3 }
          : { customerAccountAttachment: 'v2' };
      await f.admin.query('UPDATE loyalty.operations SET result=$2 WHERE operation_id=$1', [request.operationId, JSON.stringify({ ...result, ...patch })]);
      const counts = await rows(a.principal.tenantRef);
      for (const read of [{ step: 'view' }, { step: 'card' }, request] as CustomerLoyaltyRequest[]) {
        expect(await run(a, read)).toEqual({ state: 'unavailable' });
      }
      expect(await rows(a.principal.tenantRef)).toEqual(counts);
    });

  it('requires current attachment terms and an exact protected publication, without requiring another name entry', async () => {
    const a = await account({ name: null }); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    const request = attach(id, old.qrToken), counts = await rows(a.principal.tenantRef);
    expect(await run(a, { ...request, rulesVersion: 2 })).toMatchObject({ state: 'terms_changed', program: { version: 1 } });
    for (const patch of [{ parentRef: `other_${hash()}` }, { tenantRef: `other_${hash()}` },
      { expectedCheckId: randomUUID() }, { browserHash: hash() }, { sessionHash: hash() }]) {
      expect(await run({ ...a, principal: { ...a.principal, ...patch } }, request)).toBeNull();
    }
    expect(await rows(a.principal.tenantRef)).toEqual(counts);
    expect((await run(a, request))?.state).toBe('member');
  });

  it('replays concurrent identical attachments after the real parent lock without a second QR rotation', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const old = await existingCard(a);
    const request = attach(id, old.qrToken); let pid = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = run(a, request, async ({ client }, result) => {
      if (result.state !== 'member') throw new Error('Attachment was refused');
      pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; await gate;
    }).then(value => ({ value }), error => ({ error }));
    let second: Promise<{ value?: CustomerLoyaltyStoreResult | null; error?: unknown }> | undefined;
    try {
      await expect.poll(() => pid, { timeout: 2000 }).not.toBe(0);
      second = run(a, request).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND wait_event='advisory' AND $2=ANY(pg_blocking_pids(pid))`,
      [f.role, pid])).rows[0].n, { timeout: 2000 }).toBe(1);
      release(); const result = await first; expect(result).toMatchObject({ value: { state: 'member', member: { qrGeneration: 2 } } });
      expect(await second).toEqual(result);
      expect(await rows(a.principal.tenantRef)).toMatchObject({ members: 1, operations: 2, member_tokens: 2, membership_events: 2, links: 1 });
    } finally { release(); await first; await second; }
  });

  it('shows versioned terms, creates seven durable records atomically and re-encrypts a full 120-character name', async () => {
    const a = await account({ name: 'É'.repeat(120) }); const id = await program(a.principal.tenantRef);
    expect(await run(a, { step: 'view' })).toMatchObject({ state: 'available', profileReady: true, program: { id, version: 1 } });
    expect((await f.app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const request = join(id);
    const result = await run(a, request, async ({ client }) => {
      expect(await rows(a.principal.tenantRef)).toEqual(empty);
      expect((await client.query('SELECT count(*)::int AS n FROM customer.loyalty_memberships WHERE account_id=$1', [a.accountId])).rows[0].n).toBe(1);
    });
    expect(result).toMatchObject({ state: 'member', member: { balanceUnits: 0, qrGeneration: 1 } });
    if (result?.state !== 'member') throw new Error('Membership absent');
    expect(await rows(a.principal.tenantRef)).toEqual(Object.fromEntries(Object.keys(empty).map(k => [k, 1])));
    const record = (await f.admin.query(`SELECT m.joined_at,m.enrollment_handoff_at,p.encrypted_payload,p.phone_lookup_hash
      FROM loyalty.members m JOIN loyalty.member_profiles p ON p.member_id=m.id WHERE m.id=$1`, [result.member.id])).rows[0];
    expect(record.enrollment_handoff_at).toEqual(record.joined_at);
    expect(crypto.decryptProfile({ tenantRef: a.principal.tenantRef, memberId: result.member.id }, JSON.parse(record.encrypted_payload)))
      .toEqual({ firstName: a.name, phone: a.phone });
    expect(record.phone_lookup_hash).toBe(crypto.phoneLookupHash(a.principal.tenantRef, a.phone));
    expect(record.phone_lookup_hash).not.toBe(identity.hash('phone', a.principal.tenantRef, a.phone));
    expect(JSON.stringify(result)).not.toContain(a.phone);
    expect(result).not.toHaveProperty('qrToken');
    const card = await run(a, { step: 'card' });
    if (card?.state !== 'card') throw new Error('Current card absent');
    expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: card.qrToken }))
      .toMatchObject({ id: result.member.id, alias: a.name, status: 'active', balanceUnits: 0 });
    for (const table of ['ledger_entries', 'consent_events', 'consent_state']) {
      expect((await f.admin.query(`SELECT count(*)::int AS n FROM loyalty.${table} WHERE tenant_ref=$1`, [a.principal.tenantRef])).rows[0].n).toBe(0);
    }
  });

  it('retries a lost response without a second card; the same operation with different terms conflicts', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    const initial = await run(a, request);
    expect(initial?.state).toBe('member');
    expect(await run(a, request)).toEqual(initial);
    expect(await run(a, { ...request, rulesVersion: 2 })).toEqual({ state: 'conflict' });
    expect(await run(a, join(id))).toEqual(initial);
    expect((await rows(a.principal.tenantRef)).members).toBe(1);
    expect((await rows(a.principal.tenantRef)).operations).toBe(1);
  });

  it('requires current terms and a name, with no pending operation leaked on business rejection', async () => {
    const a = await account({ name: null }); const id = await program(a.principal.tenantRef);
    expect(await run(a, { step: 'view' })).toMatchObject({ state: 'available', profileReady: false });
    expect(await run(a, join(id))).toEqual({ state: 'name_required' });
    expect(await run(a, { ...join(id), rulesVersion: 2 })).toMatchObject({ state: 'terms_changed', profileReady: false, program: { version: 1 } });
    expect(await rows(a.principal.tenantRef)).toEqual(empty);
  });

  it('uses only the current QR after two genuine POS rotations; join replay never contains a QR', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    const created = await run(a, request); if (created?.state !== 'member') throw new Error('Membership absent');
    const initial = await run(a, { step: 'card' }); expect(initial?.state).toBe('card');
    let last = '';
    for (const generation of [1, 2]) {
      const replacement = await pos.replaceQr(a.principal.tenantRef, created.member.id,
        { operationId: randomUUID(), reasonCode: 'lost_or_compromised', expectedGeneration: generation }, manager);
      const current = await run(a, { step: 'card' });
      expect(current).toMatchObject({ state: 'card', qrToken: replacement.qrToken, member: { qrGeneration: generation + 1 } });
      expect(current?.state === 'card' ? current.qrToken : null).not.toBe(initial?.state === 'card' ? initial.qrToken : null);
      expect(replacement.qrToken).not.toBe(last); last = replacement.qrToken;
      expect(await pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: replacement.qrToken }))
        .toMatchObject({ id: created.member.id, balanceUnits: 0 });
      if (initial?.state !== 'card') throw new Error('Initial QR absent');
      await expect(pos.resolveMember(a.principal.tenantRef, { by: 'qr_token', qrToken: initial.qrToken }))
        .rejects.toMatchObject({ status: 404 });
      const retried = await run(a, request); expect(retried?.state).toBe('member'); expect(retried).not.toHaveProperty('qrToken');
    }
  });

  it('does not adopt an existing POS card with the same phone and rolls back the native unique collision', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    const created = await pos.createMember(a.principal.tenantRef, { operationId: randomUUID(), firstName: 'Existing', phone: a.phone,
      termsAccepted: true, termsNoticeVersion: 'loyalty-2026-09' }, actor);
    const before = await rows(a.principal.tenantRef);
    await expect(run(a, join(id))).rejects.toMatchObject({ code: '23505', constraint: 'member_profiles_tenant_phone_uq' });
    expect(await rows(a.principal.tenantRef)).toEqual(before);
    expect((await f.admin.query('SELECT id FROM loyalty.members WHERE tenant_ref=$1', [a.principal.tenantRef])).rows).toEqual([{ id: created.member.id }]);
    expect(await run(a, { step: 'card' })).toEqual({ state: 'unavailable' });
  });

  it.each(['session', 'protection'] as const)('rolls back every loyalty record if %s disappears before the protected commit', async what => {
    const a = await account(); const id = await program(a.principal.tenantRef); let wrote = false;
    await expect(run(a, join(id), async ({ client }, result) => {
      wrote = result.state === 'member';
      await client.query(what === 'session'
        ? 'UPDATE customer.sessions SET revoked_at=clock_timestamp() WHERE account_id=$1'
        : 'UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp() WHERE account_id=$1', [a.accountId]);
    })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(wrote).toBe(true); expect(await rows(a.principal.tenantRef)).toEqual(empty);
  });

  it('refuses foreign account, parent, tenant and publication without leaking the linked member', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    expect((await run(a, join(id)))?.state).toBe('member');
    const b = await account({ parentRef: a.principal.parentRef, tenantRef: a.principal.tenantRef, phone: '+33600000001' });
    expect(await run(b, { step: 'card' })).toEqual({ state: 'unavailable' });
    for (const patch of [{ parentRef: `other_${hash()}` }, { tenantRef: `other_${hash()}` }, { expectedCheckId: randomUUID() }]) {
      expect(await run({ ...a, principal: { ...a.principal, ...patch } }, { step: 'card' })).toBeNull();
    }
  });

  it('keeps enrollment idempotent after the protected display name changes', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    const initial = await run(a, request); expect(initial?.state).toBe('member');
    expect(await repo.updateName({ ...a.principal, encryptedName: identity.seal('name', a.principal.tenantRef, a.accountId, 'Nouveau nom'),
      expectedRevision: 1 })).not.toBeNull();
    expect(await run(a, request)).toEqual(initial);
    expect((await rows(a.principal.tenantRef)).members).toBe(1);
  });

  it.each(['phone-context', 'phone-hash', 'name-context', 'name-control', 'name-length'] as const)
    ('rejects corrupted %s identity before any durable loyalty creation', async kind => {
      const a = await account(); const id = await program(a.principal.tenantRef);
      if (kind.startsWith('phone')) {
        const storedHash = identity.hash('phone', a.principal.tenantRef, a.phone);
        const sealed = identity.seal('phone', a.principal.tenantRef, kind === 'phone-context' ? hash() : storedHash,
          kind === 'phone-hash' ? '+33600000002' : a.phone);
        await f.admin.query('UPDATE customer.verified_contacts SET encrypted_phone=$2 WHERE account_id=$1', [a.accountId, sealed]);
      } else {
        const sealed = identity.seal('name', a.principal.tenantRef, kind === 'name-context' ? randomUUID() : a.accountId,
          kind === 'name-control' ? 'Camille\u200b' : kind === 'name-length' ? 'A'.repeat(121) : 'Camille');
        expect(await repo.updateName({ ...a.principal, encryptedName: sealed, expectedRevision: 1 })).not.toBeNull();
      }
      expect(await run(a, join(id))).toEqual({ state: 'unavailable' });
      expect(await rows(a.principal.tenantRef)).toEqual(empty);
    });

  it('requires reconfirmation of a newly published version and records precisely the accepted version', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); const request = join(id);
    await f.admin.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,spend_step_cents,units_per_step,
      unit_label_singular,unit_label_plural,terms_summary) VALUES($1,$2,2,'Club actualisé','points',200,1,'point','points','Un point pour deux euros.')`,
    [a.principal.tenantRef, id]);
    await f.admin.query('UPDATE loyalty.programs SET current_version=2 WHERE id=$1', [id]);
    expect(await run(a, request)).toMatchObject({ state: 'terms_changed', program: { version: 2, termsSummary: 'Un point pour deux euros.' } });
    expect(await rows(a.principal.tenantRef)).toEqual(empty);
    expect((await run(a, { ...request, rulesVersion: 2 }))?.state).toBe('member');
    const receipt = (await f.admin.query('SELECT result FROM loyalty.operations WHERE tenant_ref=$1 AND operation_id=$2',
      [a.principal.tenantRef, request.operationId])).rows[0].result;
    expect(receipt).toMatchObject({ programId: id, rulesVersion: 2, termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION });
  });

  it('never shows a blocked/anonymized card and never recreates it even after its phone index is freed', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    const created = await run(a, join(id)); if (created?.state !== 'member') throw new Error('Membership absent');
    await pos.changeLifecycle(a.principal.tenantRef, created.member.id,
      { operationId: randomUUID(), action: 'block', reasonCode: 'suspected_sharing' }, manager);
    for (const request of [{ step: 'view' }, { step: 'card' }, join(id)] as CustomerLoyaltyRequest[]) {
      expect(await run(a, request)).toEqual({ state: 'unavailable' });
    }
    await pos.changeLifecycle(a.principal.tenantRef, created.member.id,
      { operationId: randomUUID(), action: 'anonymize', reasonCode: 'customer_request', confirmation: 'ANONYMISER' }, manager);
    expect(await run(a, join(id))).toEqual({ state: 'unavailable' });
    expect(await run(a, { step: 'card' })).toEqual({ state: 'unavailable' });
    expect((await rows(a.principal.tenantRef)).links).toBe(1);
    expect((await rows(a.principal.tenantRef)).members).toBe(1);
  });

  it('does not offer creation or expose the QR while the programme is paused', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    expect((await run(a, join(id)))?.state).toBe('member');
    await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE id=$1", [id]);
    expect(await run(a, { step: 'card' })).toEqual({ state: 'unavailable' });
    expect(await run(a, { step: 'view' })).toEqual({ state: 'unavailable' });
    const b = await account(); const bid = await program(b.principal.tenantRef);
    await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE id=$1", [bid]);
    expect(await run(b, join(bid))).toEqual({ state: 'unavailable' });
    expect(await rows(b.principal.tenantRef)).toEqual(empty);
  });

  it.each(['token-hash', 'generation', 'expired-token'] as const)('refuses %s QR drift without falling back to the initial token', async kind => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    const created = await run(a, join(id)); if (created?.state !== 'member') throw new Error('Membership absent');
    expect((await run(a, { step: 'card' }))?.state).toBe('card');
    if (kind === 'generation') await f.admin.query('UPDATE loyalty.members SET qr_generation=42 WHERE id=$1', [created.member.id]);
    else if (kind === 'token-hash') await f.admin.query('UPDATE loyalty.member_tokens SET token_hash=$2 WHERE member_id=$1', [created.member.id, hash()]);
    else await f.admin.query("UPDATE loyalty.member_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE member_id=$1", [created.member.id]);
    expect(await run(a, { step: 'card' })).toEqual({ state: 'unavailable' });
    expect((await rows(a.principal.tenantRef)).member_tokens).toBe(1);
  });

  it('rolls back all seven records when the session expires while the callback is admitted', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef); let expired = false;
    await expect(run(a, join(id), async ({ client }, result) => {
      if (result.state !== 'member') throw new Error('Expected writes before expiry');
      await client.query("UPDATE customer.sessions SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE id=$1", [a.sessionId]);
      await client.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.025)
        FROM customer.sessions WHERE id=$1`, [a.sessionId]);
      expired = (await client.query('SELECT expires_at<=clock_timestamp() AS expired FROM customer.sessions WHERE id=$1', [a.sessionId])).rows[0].expired;
    })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(expired).toBe(true); expect(await rows(a.principal.tenantRef)).toEqual(empty);
  });

  it('arbitrates a real concurrent POS creation through the phone unique index, with an observed SQL wait', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    let enter!: (pid: number) => void; const entered = new Promise<number>(resolve => { enter = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const online = run(a, join(id), async ({ client }, result) => {
      if (result.state !== 'member') throw new Error('Expected online membership');
      enter((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); await gate;
    });
    // Install a rejection handler immediately; a failed observation must still
    // release both transactions and let fixture cleanup close every pool.
    const observedOnline = online.then(value => ({ value }), error => ({ error }));
    let posResult: Promise<{ value?: unknown; error?: unknown }> | undefined;
    try {
      const pid = await entered;
      posResult = pos.createMember(a.principal.tenantRef, { operationId: randomUUID(), firstName: 'POS concurrent', phone: a.phone,
        termsAccepted: true, termsNoticeVersion: 'loyalty-2026-09' }, actor).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND wait_event='transactionid' AND $2=ANY(pg_blocking_pids(pid))`,
      [f.role, pid])).rows[0].n, { timeout: 2000 }).toBe(1);
      release();
      expect(await observedOnline).toMatchObject({ value: { state: 'member' } });
      expect(await posResult).toMatchObject({ error: { status: 409 } });
      expect(await rows(a.principal.tenantRef)).toMatchObject({ members: 1, member_profiles: 1, wallets: 1,
        member_tokens: 1, membership_events: 1, links: 1, operations: 2 });
    } finally { release(); await observedOnline; await posResult; }
  });

  it('serializes two joins of the same account with an observed parent advisory lock and one operation', async () => {
    const a = await account(); const id = await program(a.principal.tenantRef);
    let enter!: (pid: number) => void; const entered = new Promise<number>(resolve => { enter = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const first = run(a, join(id), async ({ client }, result) => {
      if (result.state !== 'member') throw new Error('Expected first membership');
      enter((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); await gate;
    }).then(value => ({ value }), error => ({ error }));
    let second: Promise<{ value?: CustomerLoyaltyStoreResult | null; error?: unknown }> | undefined;
    try {
      const pid = await entered;
      second = run(a, join(id)).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND wait_event='advisory' AND $2=ANY(pg_blocking_pids(pid))`,
      [f.role, pid])).rows[0].n, { timeout: 2000 }).toBe(1);
      release(); const initial = await first;
      expect(initial).toMatchObject({ value: { state: 'member' } }); expect(await second).toEqual(initial);
      expect((await rows(a.principal.tenantRef)).operations).toBe(1);
    } finally { release(); await first; await second; }
  });
});
