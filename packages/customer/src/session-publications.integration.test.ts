import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { confirmCustomerTestBrowser, prepareCustomerTestIntent } from './browser-test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import type { VerificationReservation } from './port';
import { CustomerRepositoryError, withCustomerScope } from './client';
import { recordSessionPublication, type SessionPublication } from './session-publications';
import type { Pool } from 'pg';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');

integration('shared session publication — real PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(f.app); }, 20_000);
  afterAll(async () => { await f?.close(); });
  async function approval() {
    const r: VerificationReservation = { parentRef: `p_${hash()}`, tenantRef: `t_${hash()}`,
      browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash(),
      challengeId: randomUUID(), requestHash: hash(), phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(),
      encryptedPhone: 'fixture', serviceSid: `VA${hash().slice(0, 32)}`, evidenceReference: 'fixture', now: Date.now(),
      planExpiresAt: Date.now() + 60_000, expiresAt: Date.now() + 600_000,
      limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1, freeSmsUnitsRemainingAtObservation: 100,
        freeVerificationUnitsRemainingAtObservation: 100, cooldownMs: 60_000, windowMs: 86_400_000,
        globalSendReservations: 10, tenantSendReservations: 10, phoneSendReservations: 3, ipSendReservations: 5,
        challengeCheckAttempts: 5 } };
    await confirmCustomerTestBrowser(repo, r); await prepareCustomerTestIntent(repo, r);
    expect((await repo.reserve(r)).kind).toBe('reserved');
    await repo.settleSend({ ...r, verificationSid: `VE${hash().slice(0, 32)}` });
    const claim = { ...r, requestHash: hash(), checkId: randomUUID() }; await repo.claimCheck(claim);
    return { ...claim, expectedOperationId: claim.operationId, expectedCheckId: claim.checkId,
      result: 'approved' as const, sessionId: randomUUID(), sessionHash: hash(), accountId: randomUUID(),
      existingSessionHash: null, sessionExpiresAt: Date.now() + 604_800_000 };
  }

  it('records one immutable phone publication in the same approval transaction and replays only that session', async () => {
    const input = await approval(); const result = await repo.completeCheck(input); expect(result).not.toBeNull();
    expect(await repo.completeCheck(input)).toEqual(result);
    expect((await f.admin.query(`SELECT session_id,operation_id,check_id,browser_ref,browser_hash,browser_generation,method
      FROM customer.session_publications WHERE parent_ref=$1`, [input.parentRef])).rows).toEqual([{
      session_id: input.sessionId, operation_id: input.operationId, check_id: input.checkId, browser_ref: input.browserRef,
      browser_hash: input.browserHash, browser_generation: '1', method: 'phone',
    }]);
  });

  it('rolls back approval, account and session if writing the publication receipt fails', async () => {
    const input = await approval();
    const interposed = { connect: async () => {
      const client = await f.app.connect();
      return { query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO customer.session_publications')) throw new Error('synthetic failed receipt');
        return client.query(sql, params);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(interposed).completeCheck(input)).rejects.toBeInstanceOf(CustomerRepositoryError);
    for (const table of ['accounts', 'sessions', 'session_publications']) {
      expect((await f.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [input.parentRef])).rowCount).toBe(0);
    }
    expect((await f.admin.query('SELECT state FROM customer.check_attempts WHERE id=$1', [input.checkId])).rows[0].state).toBe('checking');
    expect((await f.admin.query('SELECT generation,current_session_id FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef])).rows[0])
      .toEqual({ generation: '0', current_session_id: null });
    expect((await f.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].reserved_sends).toBe('1');
  });

  it('enforces both scopes, immutable fields and exact session/browser/intention foreign keys', async () => {
    const input = await approval(); await repo.completeCheck(input);
    expect((await f.app.query('SELECT 1 FROM customer.session_publications')).rowCount).toBe(0);
    for (const scope of [{ ...input, parentRef: 'foreign' }, { ...input, tenantRef: 'foreign' }]) {
      expect(await withCustomerScope(f.app, scope, async client => (await client.query('SELECT 1 FROM customer.session_publications')).rowCount)).toBe(0);
    }
    for (const sql of ["UPDATE customer.session_publications SET method='recovery' WHERE session_id=$1",
      'DELETE FROM customer.session_publications WHERE session_id=$1']) {
      await expect(f.admin.query(sql, [input.sessionId])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(f.admin.query('TRUNCATE customer.session_publications')).rejects.toMatchObject({ code: '23514' });
    const unpublishedSessionId = randomUUID();
    await f.admin.query(`INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,
      expires_at,browser_ref,browser_hash,browser_generation)
      SELECT $2,parent_ref,tenant_ref,account_id,$3,account_version,expires_at,browser_ref,browser_hash,2
      FROM customer.sessions WHERE id=$1`, [input.sessionId, unpublishedSessionId, hash()]);
    // Generation 2 matches that session, but not this generation-0 intention;
    // generation 3 matches neither. Both composite FKs must reject the receipt.
    for (const generation of [2, 3]) {
      await expect(f.admin.query(`INSERT INTO customer.session_publications(parent_ref,tenant_ref,session_id,
        operation_id,check_id,browser_ref,browser_hash,browser_generation,method)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'phone')`,
      [input.parentRef, input.tenantRef, unpublishedSessionId, input.operationId, randomUUID(),
        input.browserRef, input.browserHash, generation])).rejects.toMatchObject({ code: '23503' });
    }
    const missing = await approval(); // Its session does not yet exist.
    await expect(withCustomerScope(f.app, missing, async client => recordSessionPublication(client, { ...missing, method: 'phone' })))
      .rejects.toBeInstanceOf(CustomerRepositoryError);
  });

  it.each(['passkey', 'recovery'] as const)('uses a %s fixture publication without any fake Verify challenge', async method => {
    // This fixture proves the shared publication boundary, NOT a passkey/code verifier.
    const browser = { parentRef: `p_${hash()}`, tenantRef: `t_${hash()}`, browserRef: randomUUID(), browserHash: hash() };
    const a = { ...browser, operationId: randomUUID(), proofHash: hash() };
    await confirmCustomerTestBrowser(repo, a); await prepareCustomerTestIntent(repo, a);
    await f.admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
      VALUES($1,50,100,100)`, [a.parentRef]);
    const accountId = randomUUID();
    await f.admin.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)', [accountId, a.parentRef, a.tenantRef]);
    await f.admin.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone)
      VALUES($1,$2,$3,$4,'fixture')`, [a.parentRef, a.tenantRef, accountId, hash()]);
    await f.admin.query('INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash) VALUES($1,$2,$3)', [a.parentRef, a.tenantRef, a.browserHash]);
    async function publish(i: typeof a, generation: number) {
      const p: SessionPublication = { ...i, sessionId: randomUUID(), checkId: randomUUID(), method };
      const sessionHash = hash();
      await withCustomerScope(f.app, i, async client => {
        await client.query(`INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,expires_at,
          browser_ref,browser_hash,browser_generation) VALUES($1,$2,$3,$4,$5,0,clock_timestamp()+interval '1 day',$6,$7,$8)`,
        [p.sessionId, i.parentRef, i.tenantRef, accountId, sessionHash, i.browserRef, i.browserHash, generation]);
        await client.query(`UPDATE customer.browser_contexts SET generation=$4,current_session_id=$5
          WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3`, [i.parentRef, i.tenantRef, i.browserHash, generation, p.sessionId]);
        await client.query("UPDATE customer.verification_intents SET state='consumed',consumed_at=clock_timestamp() WHERE operation_id=$1", [i.operationId]);
        await recordSessionPublication(client, p);
      });
      return { ...i, sessionHash, expectedOperationId: p.operationId, expectedCheckId: p.checkId, now: Date.now() };
    }
    const first = await publish(a, 1); expect(await repo.authenticate(first)).not.toBeNull();
    const b = { ...a, operationId: randomUUID(), proofHash: hash() }; await prepareCustomerTestIntent(repo, b);
    const second = await publish(b, 2); const current = await repo.authenticate(second); expect(current).not.toBeNull();
    const close = (i: typeof a) => repo.closeIntent({ ...browser, operationId: i.operationId });
    await close(a); expect(await repo.authenticate(second)).toEqual(current); expect(await repo.authenticate(first)).toBeNull();
    const wrong = { ...second, expectedOperationId: first.operationId, expectedCheckId: first.expectedCheckId };
    expect(await repo.updateName({ ...wrong, encryptedName: 'denied', expectedRevision: 0 })).toBeNull();
    await repo.revoke({ ...wrong, all: true }); expect(await repo.authenticate(second)).toEqual(current);
    expect((await repo.updateName({ ...second, encryptedName: 'fixture-name', expectedRevision: 0 }))?.profile.revision).toBe(1);
    await close(b); expect(await repo.authenticate(second)).toBeNull();
    expect((await f.admin.query('SELECT 1 FROM customer.challenges WHERE parent_ref=$1', [a.parentRef])).rowCount).toBe(0);
    expect((await f.admin.query('SELECT 1 FROM customer.check_attempts WHERE parent_ref=$1', [a.parentRef])).rowCount).toBe(0);
  });
});
