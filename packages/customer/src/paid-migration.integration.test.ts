import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { withCustomerScope } from './client';
import { lockVerificationBudget } from './budgets';
import { PostgresCustomerIdentityRepository } from './repository';
import { migrateCustomer } from './migration';
import { assertCustomerMigrationsCurrent } from './migration-state';
import type { PaidVerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
function identity(): PaidVerificationReservation {
  const id = randomUUID().replaceAll('-', ''); const now = Date.now();
  return { parentRef: `parent_${id}`, tenantRef: `tenant_${id}`, operationId: randomUUID(), challengeId: randomUUID(),
    requestHash: id.repeat(2), browserHash: id.repeat(2), phoneHash: id.repeat(2), globalPhoneHash: id.repeat(2), ipHash: id.repeat(2),
    encryptedPhone: 'fixture-ciphertext', serviceSid: `VA${id}`, evidenceReference: 'provider_fixture',
    now, expiresAt: now + 600_000, planExpiresAt: now + 60_000,
    limits: { maxSendReservations: 50, smsUnitsReservedPerSend: 2,
      paidBudget: { mode: 'paid', authorizationRef: 'one_off', costEvidenceReference: 'cost_fixture', currency: 'USD',
        authorizedSpendMicrousd: 1000, reservePerSendMicrousd: 600, expiresAt: now + 600_000 },
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } };
}
/** The old column list is intentional: these are real historical SQL rows. */
async function seedLegacy(admin: Pool, input: PaidVerificationReservation, includeReservation = true) {
  await admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit,reserved_sends,reserved_sms,reserved_verifications)
    VALUES($1,5,20,10,1,2,1) ON CONFLICT DO NOTHING`, [input.parentRef]);
  await admin.query(`INSERT INTO customer.challenges
    (id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,service_sid,max_checks,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,5,$10)`, [input.challengeId, input.parentRef, input.tenantRef, input.operationId,
    input.requestHash, input.browserHash, input.phoneHash, input.encryptedPhone, input.serviceSid, new Date(input.expiresAt)]);
  if (includeReservation) await admin.query(`INSERT INTO customer.reservations
    (id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units) VALUES($1,$2,$3,$4,$5,$6,$7,2)`,
  [input.operationId, input.parentRef, input.tenantRef, input.challengeId, input.globalPhoneHash, input.ipHash, input.evidenceReference]);
}

integration('paid migration — historical rows and old SQL writer, native PostgreSQL', () => {
  it('upgrades actual migration 0000 without rewriting its proof, counters or migration hash', async () => {
    const input = identity(); let original: Record<string, unknown> | undefined; let originalHash: string | undefined;
    const fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL, { beforeUpgrade: async admin => {
      await seedLegacy(admin, input);
      original = (await admin.query('SELECT * FROM customer.reservations WHERE id=$1', [input.operationId])).rows[0];
      originalHash = (await admin.query('SELECT hash FROM drizzle.__drizzle_customer_migrations')).rows[0].hash;
    } });
    try {
      await assertCustomerMigrationsCurrent(fixture.app);
      expect((await fixture.admin.query('SELECT * FROM customer.reservations WHERE id=$1', [input.operationId])).rows[0])
        .toEqual({ ...original, funding_kind: 'trial', authorization_ref: null, reserved_microusd: '0', funding_expires_at: null, cost_evidence_reference: null });
      expect((await fixture.admin.query('SELECT reserved_sends, reserved_sms, reserved_verifications,send_limit,sms_limit,verification_limit FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0])
        .toEqual({ reserved_sends: '1', reserved_sms: '2', reserved_verifications: '1', send_limit: '5', sms_limit: '20', verification_limit: '10' });
      const repo = new PostgresCustomerIdentityRepository(fixture.app);
      expect((await repo.settleSend({ ...input, verificationSid: `VE${randomUUID().replaceAll('-', '')}` }))?.funding).toEqual({ mode: 'trial' });
      const history = (await fixture.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
      expect(history).toHaveLength(2); expect(history[0].hash).toBe(originalHash);
      await migrateCustomer(fixture.admin);
      expect((await fixture.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(history);
    } finally { await fixture.close(); }
  }, 20_000);

  it('makes a legacy Trial writer already waiting on the shared parent see the sealed free caps', async () => {
    const original = identity();
    const fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    const blocker = await fixture.admin.connect();
    let waiting: Promise<boolean> | undefined;
    try {
      await seedLegacy(fixture.admin, original);
      await blocker.query('BEGIN');
      const paid = identity(); paid.parentRef = original.parentRef;
      expect(await lockVerificationBudget(blocker, paid)).not.toBeNull();
      const application = `legacy_${randomUUID().replaceAll('-', '')}`;
      waiting = withCustomerScope(fixture.app, original, async client => {
        await client.query("SELECT set_config('application_name',$1,true)", [application]);
        // The exact pre-Paid SELECT/cap formula; intentionally no paid table read.
        const b = (await client.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [original.parentRef])).rows[0];
        const caps = [Math.min(Number(b.send_limit), 50), Math.min(Number(b.sms_limit), 100), Math.min(Number(b.verification_limit), 100)];
        await client.query('UPDATE customer.parent_budgets SET send_limit=$2,sms_limit=$3,verification_limit=$4 WHERE parent_ref=$1', [original.parentRef, ...caps]);
        return !(Number(b.reserved_sends) + 1 > caps[0]! || Number(b.reserved_sms) + 2 > caps[1]! || Number(b.reserved_verifications) + 1 > caps[2]!);
      });
      let observedLock = false;
      for (let i = 0; i < 100; i++) {
        observedLock = (await fixture.admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'", [application])).rowCount === 1;
        if (observedLock) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observedLock).toBe(true);
      await blocker.query('COMMIT');
      expect(await waiting).toBe(false);
      expect((await fixture.admin.query('SELECT reserved_sends::int,sms_limit::int,verification_limit::int FROM customer.parent_budgets WHERE parent_ref=$1', [original.parentRef])).rows[0])
        .toEqual({ reserved_sends: 1, sms_limit: 0, verification_limit: 0 });
    } finally {
      await blocker.query('ROLLBACK'); blocker.release(); await waiting;
      await fixture.close();
    }
  }, 20_000);

  it('rejects null/mixed funding and a valid authorization reference belonging to another parent', async () => {
    const fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    try {
      const input = identity(); await seedLegacy(fixture.admin, input, false);
      const foreign = identity(); foreign.limits.paidBudget.authorizationRef = 'foreign_authorization';
      await new PostgresCustomerIdentityRepository(fixture.app).reserve(foreign);
      const insert = (funding: string, auth: string | null, money: number, expiry: Date | null, cost: string | null) => fixture.admin.query(`INSERT INTO customer.reservations
        (id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units,funding_kind,authorization_ref,reserved_microusd,funding_expires_at,cost_evidence_reference)
        VALUES($1,$2,$3,$4,$5,$6,$7,2,$8,$9,$10,$11,$12)`, [input.operationId, input.parentRef, input.tenantRef,
        input.challengeId, input.globalPhoneHash, input.ipHash, input.evidenceReference, funding, auth, money, expiry, cost]);
      for (const values of [
        ['paid', null, 600, new Date(input.expiresAt), 'cost'],
        ['paid', 'one_off', 0, new Date(input.expiresAt), 'cost'],
        ['paid', 'one_off', 600, null, 'cost'], ['paid', 'one_off', 600, new Date(input.expiresAt), null],
        ['trial', 'one_off', 0, null, null], ['trial', null, 1, null, null],
      ] as const) await expect(insert(...values)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('paid', 'foreign_authorization', 600, new Date(input.expiresAt), 'cost')).rejects.toMatchObject({ code: '23503' });
      await expect(insert('trial', null, 0, null, null)).resolves.toMatchObject({ rowCount: 1 });
    } finally { await fixture.close(); }
  }, 20_000);
});
