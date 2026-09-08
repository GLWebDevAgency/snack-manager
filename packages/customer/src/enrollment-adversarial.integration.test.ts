import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { confirmCustomerTestBrowser, prepareCustomerTestIntent } from './browser-test-fixture';
import { completeCustomerTestAccount } from './enrollment-test-fixture';
import type { CustomerIdentityRepository, VerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const credentialId = () => randomBytes(32).toString('base64url');
const activationTables = ['accounts', 'verified_contacts', 'passkey_credentials', 'recovery_codes', 'sessions', 'session_publications'] as const;

/** Only the already-simulated WebAuthn verifier result varies. Every repository
 * operation, constraint and transaction still executes against real PostgreSQL. */
class CredentialFixtureRepository extends PostgresCustomerIdentityRepository {
  constructor(pool: Pool, private readonly verifiedCredentialId: string) { super(pool); }
  override recordEnrollmentKey(input: Parameters<CustomerIdentityRepository['recordEnrollmentKey']>[0]) {
    return super.recordEnrollmentKey({ ...input, credential: { ...input.credential, credentialId: this.verifiedCredentialId } });
  }
}

function reservation(patch: Partial<VerificationReservation> = {}): VerificationReservation {
  const now = Date.now();
  return { tenantRef: `tenant_${hash().slice(0, 12)}`, parentRef: `parent_${hash().slice(0, 12)}`,
    browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash(), requestHash: hash(),
    challengeId: randomUUID(), phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-ciphertext',
    serviceSid: `VA${randomBytes(16).toString('hex')}`, evidenceReference: 'fixture', planExpiresAt: now + 600_000,
    expiresAt: now + 600_000, now, limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1,
      freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 }, ...patch };
}

integration('protected enrollment adversarial transactions — real PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(fixture.app);
  }, 20_000);
  afterAll(async () => { await fixture?.close(); });

  async function admitted(input: VerificationReservation, shortDeadline = false) {
    await confirmCustomerTestBrowser(repo, input);
    // Seed only a shorter initial deadline, never UPDATE immutable evidence or
    // disable a guard; all admission/protection operations below remain real.
    if (shortDeadline) await fixture.admin.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() at)
      INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,
        browser_generation,state,created_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,0,'open',at-interval '10 minutes'+interval '2 seconds',at+interval '2 seconds' FROM stamp`,
    [input.parentRef, input.tenantRef, input.operationId, input.browserRef, input.browserHash, input.proofHash]);
    expect((await prepareCustomerTestIntent(repo, input))?.intent.state).toBe('open');
    expect((await repo.reserve(input)).kind).toBe('reserved');
    expect(await repo.settleSend({ ...input, verificationSid: `VE${randomBytes(16).toString('hex')}` })).not.toBeNull();
    const check = { ...input, checkId: randomUUID(), requestHash: hash() };
    expect(await repo.claimCheck(check)).not.toBeNull();
    return { ...check, result: 'approved' as const, accountId: randomUUID(), sessionId: randomUUID(),
      sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000, existingSessionHash: null,
      expectedCheckId: randomUUID() };
  }
  async function authority(parentRef: string) {
    return Promise.all(activationTables.map(async table => (await fixture.admin.query(
      `SELECT * FROM customer.${table} WHERE parent_ref=$1 ORDER BY 1`, [parentRef])).rows));
  }
  async function assertUnpublished(input: Awaited<ReturnType<typeof admitted>>, pinned: boolean) {
    expect(await authority(input.parentRef)).toEqual(activationTables.map(() => []));
    expect((await fixture.admin.query('SELECT generation,current_session_id FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef])).rows)
      .toEqual([{ generation: '0', current_session_id: null }]);
    expect((await fixture.admin.query('SELECT state,consumed_at FROM customer.verification_intents WHERE operation_id=$1', [input.operationId])).rows)
      .toEqual([{ state: 'open', consumed_at: null }]);
    expect((await fixture.admin.query('SELECT state,enrollment_id,session_id FROM customer.check_attempts WHERE id=$1', [input.checkId])).rows)
      .toEqual([{ state: 'verified', enrollment_id: input.checkId, session_id: null }]);
    expect((await fixture.admin.query(`SELECT activation_intent_id,failed_confirmations,activation_id,activated_at,session_id,activation_attempts
      FROM customer.registration_enrollments WHERE id=$1`, [input.checkId])).rows)
      .toEqual([{ activation_intent_id: pinned ? input.expectedCheckId : null, failed_confirmations: 0,
        activation_id: null, activated_at: null, session_id: null, activation_attempts: [] }]);
    expect((await fixture.admin.query('SELECT reserved_sends,reserved_sms,reserved_verifications FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows)
      .toEqual([{ reserved_sends: '1', reserved_sms: '1', reserved_verifications: '1' }]);
    expect((await fixture.admin.query('SELECT checks_used,state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows)
      .toEqual([{ checks_used: 1, state: 'consumed' }]);
  }

  it('rolls back provisional account/key/session writes when SQL expiry passes immediately before publication', async () => {
    // The sequence records the actual SQL checkpoint across transaction rollback.
    // No fake repository exception and no disabled production constraint.
    await fixture.admin.query(`CREATE SEQUENCE customer.fixture_enrollment_deadline_hits;
      GRANT USAGE ON SEQUENCE customer.fixture_enrollment_deadline_hits TO "${fixture.role}";
      CREATE FUNCTION customer.fixture_enrollment_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE deadline timestamptz; remaining double precision;
      BEGIN
        SELECT e.expires_at INTO deadline FROM customer.registration_enrollments e
          JOIN customer.accounts a ON (a.parent_ref,a.tenant_ref,a.enrollment_id)=(e.parent_ref,e.tenant_ref,e.id)
          JOIN customer.verified_contacts c ON (c.parent_ref,c.tenant_ref,c.account_id)=(a.parent_ref,a.tenant_ref,a.id)
          JOIN customer.passkey_credentials k ON (k.parent_ref,k.tenant_ref,k.account_id)=(a.parent_ref,a.tenant_ref,a.id)
          JOIN customer.recovery_codes r ON (r.parent_ref,r.tenant_ref,r.account_id)=(a.parent_ref,a.tenant_ref,a.id)
          JOIN customer.sessions s ON (s.parent_ref,s.tenant_ref,s.account_id)=(a.parent_ref,a.tenant_ref,a.id)
          WHERE e.parent_ref=NEW.parent_ref AND e.tenant_ref=NEW.tenant_ref AND e.browser_hash=NEW.browser_hash
            AND s.id=NEW.current_session_id AND s.browser_generation=NEW.generation
            AND e.activated_at IS NULL AND e.asserted_at IS NOT NULL
            AND e.browser_generation=OLD.generation AND NEW.generation=OLD.generation+1
            AND NOT EXISTS(SELECT 1 FROM customer.session_publications u WHERE u.session_id=s.id);
        remaining := extract(epoch FROM deadline-clock_timestamp());
        IF deadline IS NULL OR remaining<=0 OR remaining>2.5 THEN
          RAISE EXCEPTION 'Fixture deadline checkpoint not reached';
        END IF;
        PERFORM nextval('customer.fixture_enrollment_deadline_hits');
        PERFORM pg_sleep(remaining+0.025);
        IF clock_timestamp()<deadline THEN RAISE EXCEPTION 'Fixture deadline did not expire'; END IF;
        PERFORM nextval('customer.fixture_enrollment_deadline_hits');
        RETURN NEW;
      END; $$;
      CREATE TRIGGER fixture_enrollment_deadline BEFORE UPDATE OF current_session_id ON customer.browser_contexts
        FOR EACH ROW WHEN (NEW.current_session_id IS NOT NULL) EXECUTE FUNCTION customer.fixture_enrollment_deadline()`);
    try {
      const input = await admitted(reservation(), true);
      const before = (await fixture.admin.query('SELECT expires_at FROM customer.verification_intents WHERE operation_id=$1', [input.operationId])).rows;
      await expect(completeCustomerTestAccount(repo, input)).rejects.toThrow('Identité client indisponible');
      expect((await fixture.admin.query('SELECT last_value,is_called FROM customer.fixture_enrollment_deadline_hits')).rows)
        .toEqual([{ last_value: '2', is_called: true }]);
      expect((await fixture.admin.query('SELECT expires_at<=clock_timestamp() AS expired FROM customer.verification_intents WHERE operation_id=$1', [input.operationId])).rows)
        .toEqual([{ expired: true }]);
      expect((await fixture.admin.query('SELECT expires_at FROM customer.verification_intents WHERE operation_id=$1', [input.operationId])).rows).toEqual(before);
      await assertUnpublished(input, false);
      expect(await completeCustomerTestAccount(repo, input)).toBeNull();
      await assertUnpublished(input, false);
      expect((await fixture.admin.query('SELECT last_value FROM customer.fixture_enrollment_deadline_hits')).rows)
        .toEqual([{ last_value: '2' }]);
    } finally {
      await fixture.admin.query(`DROP TRIGGER fixture_enrollment_deadline ON customer.browser_contexts;
        DROP FUNCTION customer.fixture_enrollment_deadline(); DROP SEQUENCE customer.fixture_enrollment_deadline_hits`);
    }
  }, 10_000);

  it('refuses another provider parent using the same tenant/RP credential without orphan contact or adoption', async () => {
    const first = await admitted(reservation());
    const sharedCredential = credentialId();
    const winnerRepo = new CredentialFixtureRepository(fixture.app, sharedCredential);
    const winner = await completeCustomerTestAccount(winnerRepo, first);
    expect(winner).not.toBeNull();
    const winnerBefore = await authority(first.parentRef);
    const second = await admitted(reservation({ tenantRef: first.tenantRef }));
    expect(second.parentRef).not.toBe(first.parentRef);
    expect(second.phoneHash).not.toBe(first.phoneHash);
    expect(second.accountId).not.toBe(first.accountId);
    const loserRepo = new CredentialFixtureRepository(fixture.app, sharedCredential);
    expect(await completeCustomerTestAccount(loserRepo, second)).toBeNull();
    expect((await fixture.admin.query(`SELECT credential->>'credentialId' AS credential_id,rp_id
      FROM customer.registration_enrollments WHERE id=$1`, [second.checkId])).rows)
      .toEqual([{ credential_id: sharedCredential, rp_id: 'customer.fixture' }]);
    expect((await fixture.admin.query('SELECT parent_ref,account_id,credential_id,rp_id FROM customer.passkey_credentials WHERE tenant_ref=$1', [first.tenantRef])).rows)
      .toEqual([{ parent_ref: first.parentRef, account_id: first.accountId, credential_id: sharedCredential, rp_id: 'customer.fixture' }]);
    await assertUnpublished(second, true);
    expect(await completeCustomerTestAccount(loserRepo, second)).toBeNull();
    await assertUnpublished(second, true);
    expect(await authority(first.parentRef)).toEqual(winnerBefore);
    expect(await winnerRepo.authenticate({ ...first, expectedOperationId: first.operationId })).toEqual(winner);
    expect(await loserRepo.authenticate({ ...second, expectedOperationId: second.operationId })).toBeNull();
  });
});
