import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOMER_LOYALTY_NOTICE_VERSION, type CustomerLoyaltyRequest } from '@sm/contracts';
import { CustomerIdentityCrypto, PostgresCustomerIdentityRepository, withProtectedCustomerSession,
  type CustomerIdentityRepository, type CustomerSession, type VerificationReservation } from '@sm/customer';
import { LoyaltyCryptoAdapter, loyaltyDb } from '@sm/loyalty';
import { LoyaltyMemberService, type LoyaltyActorContext } from '../loyalty/loyalty-member.service';
import type { LoyaltyPurchaseVerifier } from '../loyalty/loyalty-purchase-verifier';
import { CustomerLoyaltyStoreError, runCustomerLoyalty, type CustomerLoyaltyStoreContext,
  type CustomerLoyaltyStoreResult } from './customer-loyalty.store';

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
    after?: (context: CustomerLoyaltyStoreContext, result: CustomerLoyaltyStoreResult) => Promise<void>) {
    let safe: CustomerLoyaltyStoreResult | undefined;
    let native: unknown;
    try {
      return await withProtectedCustomerSession(f.app, a.principal, async context => {
        try {
          const ctx = { ...context, scope: a.principal, identity, crypto };
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
