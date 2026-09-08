import type { PoolClient } from 'pg';
import type { CustomerIdentityRepository, CustomerSession } from './port';
import type { CustomerEnrollment, EnrollmentBinding, EnrollmentPasskey } from './enrollment-port';
import { CustomerRepositoryError } from './client';
import { intentRow, validOpenIntent } from './intent-queries';
import { validateBrowser } from './browser-preparation';
import { session } from './queries';
import { recordSessionPublication } from './session-publications';

type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
type StoredKey = Omit<EnrollmentPasskey, 'publicKey'> & { publicKey: string };
type Row = {
  id: string; operation_id: string; challenge_id: string; browser_generation: string; expires_at: Date;
  phone_hash: string; encrypted_phone: string; verified_at: Date;
  registration_id: string | null; origin: string | null; rp_id: string | null;
  registration_challenge: string | null; user_handle: string | null; registration_request_hash: string | null;
  registration_counter: string | null;
  credential: StoredKey | null; assertion_id: string | null; assertion_challenge: string | null;
  assertion_request_hash: string | null; asserted_at: Date | null;
  recovery_receipts: { rotationId: string; expectedVersion: number; codeHash: string }[];
  activation_attempts: { activationId: string; requestHash: string; applied: boolean }[];
  activation_intent_id: string | null; failed_confirmations: number;
  activation_id: string | null; activated_at: Date | null; session_id: string | null;
};
function view(row: Row): CustomerEnrollment {
  return { operationId: row.operation_id, checkId: row.id, expiresAt: row.expires_at.getTime(),
    stage: row.asserted_at ? 'recovery_required' : row.credential ? 'assertion_required' : 'registration_required',
    recoveryVersion: row.recovery_receipts.length };
}
export async function enrollmentRow(client: PoolClient, input: EnrollmentBinding, active = true): Promise<Row | null> {
  const intent = active ? await validOpenIntent(client, input) : await intentRow(client, input);
  if (!intent || intent.proof_hash !== input.proofHash || !await validateBrowser(client, input)
    || intent.state === 'closed' || intent.expires_at.getTime() <= (await client.query<{ now: Date }>('SELECT clock_timestamp() now')).rows[0]!.now.getTime()) return null;
  const row = (await client.query<Row>(`SELECT e.* FROM customer.registration_enrollments e
    JOIN customer.check_attempts k ON (k.parent_ref,k.tenant_ref,k.id,k.challenge_id)=(e.parent_ref,e.tenant_ref,e.id,e.challenge_id)
    WHERE e.parent_ref=$1 AND e.tenant_ref=$2 AND e.operation_id=$3 AND e.id=$4 AND e.browser_ref=$5 AND e.browser_hash=$6
      AND k.state='verified' AND k.enrollment_id=e.id AND k.request_hash IS NOT NULL
      AND e.expires_at>clock_timestamp() FOR UPDATE OF e`,
  [input.parentRef, input.tenantRef, input.operationId, input.checkId, input.browserRef, input.browserHash])).rows[0] ?? null;
  return row && (!active || row.activated_at === null) ? row : null;
}
export async function readEnrollment(client: PoolClient, input: EnrollmentBinding) {
  const row = await enrollmentRow(client, input); return row ? view(row) : null;
}
async function fresh(client: PoolClient, input: EnrollmentBinding) {
  const row = await enrollmentRow(client, input);
  if (!row) throw new CustomerRepositoryError('unavailable');
  return view(row);
}
export async function prepareEnrollmentKey(client: PoolClient, input: Input<'prepareEnrollmentKey'>) {
  let row = await enrollmentRow(client, input);
  if (!row) return null;
  if (!row.registration_id) {
    await client.query(`UPDATE customer.registration_enrollments SET registration_id=$4,origin=$5,rp_id=$6,registration_challenge=$7,user_handle=$8
      WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`,
    [input.parentRef, input.tenantRef, input.checkId, input.registrationId, input.origin, input.rpId, input.challenge, input.userHandle]);
    row = await enrollmentRow(client, input);
  }
  if (!row || row.registration_id !== input.registrationId || row.origin !== input.origin || row.rp_id !== input.rpId) return null;
  return readEnrollmentKey(client, input);
}
export async function readEnrollmentKey(client: PoolClient, input: Input<'readEnrollmentKey'>) {
  const row = await enrollmentRow(client, input);
  if (!row || row.registration_id !== input.registrationId) return null;
  return { registrationId: row.registration_id, origin: row.origin!, rpId: row.rp_id!,
    challenge: row.registration_challenge!, userHandle: row.user_handle!, expiresAt: row.expires_at.getTime() };
}
export async function recordEnrollmentKey(client: PoolClient, input: Input<'recordEnrollmentKey'>) {
  const row = await enrollmentRow(client, input);
  if (!row || row.registration_id !== input.registrationId) return null;
  if (row.registration_request_hash) return row.registration_request_hash === input.requestHash ? view(row) : null;
  const credential = { ...input.credential, publicKey: Buffer.from(input.credential.publicKey).toString('base64url') };
  await client.query(`UPDATE customer.registration_enrollments SET registration_request_hash=$4,credential=$5::jsonb,registration_counter=$6
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId, input.requestHash, JSON.stringify(credential), input.credential.counter]);
  return fresh(client, input);
}
export async function prepareEnrollmentAssertion(client: PoolClient, input: Input<'prepareEnrollmentAssertion'>) {
  let row = await enrollmentRow(client, input);
  if (!row?.credential || row.origin !== input.origin || row.rp_id !== input.rpId) return null;
  if (!row.assertion_id) {
    await client.query(`UPDATE customer.registration_enrollments SET assertion_id=$4,assertion_challenge=$5
      WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId, input.assertionId, input.challenge]);
    row = await enrollmentRow(client, input);
  }
  if (!row?.credential || row.assertion_id !== input.assertionId) return null;
  return readEnrollmentAssertion(client, input);
}
export async function readEnrollmentAssertion(client: PoolClient, input: Input<'readEnrollmentAssertion'>) {
  const row = await enrollmentRow(client, input);
  if (!row?.credential || row.assertion_id !== input.assertionId) return null;
  return { assertionId: row.assertion_id, origin: row.origin!, rpId: row.rp_id!, challenge: row.assertion_challenge!,
    userHandle: row.user_handle!, credential: { ...row.credential, counter: Number(row.registration_counter), publicKey: new Uint8Array(Buffer.from(row.credential.publicKey, 'base64url')) },
    expiresAt: row.expires_at.getTime() };
}
export async function recordEnrollmentAssertion(client: PoolClient, input: Input<'recordEnrollmentAssertion'>) {
  const row = await enrollmentRow(client, input);
  if (!row?.credential || row.assertion_id !== input.assertionId || row.credential.credentialId !== input.credentialId
    || row.credential.deviceType !== input.deviceType) return null;
  if (row.assertion_request_hash) return row.assertion_request_hash === input.requestHash ? view(row) : null;
  if ((row.credential.counter !== 0 || input.counter !== 0) && input.counter <= row.credential.counter) return null;
  await client.query(`UPDATE customer.registration_enrollments SET assertion_request_hash=$4,asserted_at=clock_timestamp(),credential=$5::jsonb
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId, input.requestHash,
    JSON.stringify({ ...row.credential, counter: input.counter, backedUp: input.backedUp })]);
  return fresh(client, input);
}
export async function issueEnrollmentRecovery(client: PoolClient, input: Input<'issueEnrollmentRecovery'>) {
  const row = await enrollmentRow(client, input);
  if (!row?.asserted_at) return null;
  const existing = row.recovery_receipts.find(value => value.rotationId === input.rotationId);
  if (existing) return existing.expectedVersion === input.expectedVersion ? { enrollment: view(row), emitCode: false } : null;
  if (row.activation_intent_id || row.recovery_receipts.length !== input.expectedVersion || input.expectedVersion >= 3) return null;
  await client.query(`UPDATE customer.registration_enrollments SET recovery_receipts=recovery_receipts||$4::jsonb
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId,
    JSON.stringify([{ rotationId: input.rotationId, expectedVersion: input.expectedVersion, codeHash: input.codeHash }])]);
  return { enrollment: await fresh(client, input), emitCode: true };
}
export async function recoverEnrollmentActivation(client: PoolClient, input: Input<'recoverEnrollmentActivation'>): Promise<CustomerSession | null> {
  const row = await enrollmentRow(client, input, false);
  if (!row || row.activation_id !== input.activationId || !row.session_id) return null;
  const current = await session(client, input, input.sessionHash, input.browserHash,
    { expectedOperationId: input.operationId, expectedCheckId: input.activationId });
  return current?.sessionId === row.session_id ? current : null;
}
export async function activateEnrollment(client: PoolClient, input: Input<'activateEnrollment'>): Promise<CustomerSession | null> {
  const previous = await enrollmentRow(client, input, false);
  if (!previous) return null;
  const receipt = previous.activation_attempts.find(value => value.activationId === input.activationId);
  if (receipt) return receipt.requestHash === input.requestHash && receipt.applied ? recoverEnrollmentActivation(client, input) : null;
  const row = await enrollmentRow(client, input);
  if (!row?.asserted_at || !row.credential || row.failed_confirmations >= 5
    || (row.activation_intent_id !== null && row.activation_intent_id !== input.activationId)) return null;
  if (!row.activation_intent_id) await client.query(`UPDATE customer.registration_enrollments SET activation_intent_id=$4
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId, input.activationId]);
  const code = row.recovery_receipts.at(-1);
  if (!code || row.recovery_receipts.length !== input.recoveryVersion || code.codeHash !== input.codeHash) {
    await client.query(`UPDATE customer.registration_enrollments SET failed_confirmations=failed_confirmations+1
      WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.checkId]);
    await fresh(client, input); return null;
  }
  // Unique tenant+phone also fences another provider parent. Never adopt it.
  await client.query('SAVEPOINT activate_account');
  await client.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref,enrollment_id) VALUES($1,$2,$3,$4)',
    [input.accountId, input.parentRef, input.tenantRef, input.checkId]);
  const contact = await client.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone,verified_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_ref,phone_hash) DO NOTHING`,
  [input.parentRef, input.tenantRef, input.accountId, row.phone_hash, row.encrypted_phone, row.verified_at]);
  if (!contact.rowCount) { await client.query('ROLLBACK TO SAVEPOINT activate_account'); return null; }
  const key = await client.query(`INSERT INTO customer.passkey_credentials(parent_ref,tenant_ref,account_id,rp_id,credential_id,
    public_key,user_handle,counter,device_type,backed_up,transports) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT DO NOTHING`, [input.parentRef, input.tenantRef, input.accountId, row.rp_id, row.credential.credentialId,
    Buffer.from(row.credential.publicKey, 'base64url'), row.user_handle, row.credential.counter, row.credential.deviceType, row.credential.backedUp,
    JSON.stringify(row.credential.transports)]);
  if (!key.rowCount) { await client.query('ROLLBACK TO SAVEPOINT activate_account'); return null; }
  await client.query(`INSERT INTO customer.recovery_codes(parent_ref,tenant_ref,account_id,version,code_hash) VALUES($1,$2,$3,$4,$5)`,
    [input.parentRef, input.tenantRef, input.accountId, input.recoveryVersion, code.codeHash]);
  const created = await client.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() now)
    INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,created_at,expires_at,browser_ref,browser_hash,browser_generation)
    SELECT $1,$2,$3,$4,$5,0,stamp.now,LEAST($6::timestamptz,stamp.now+interval '168 hours',p.expires_at),$7,$8,$9::bigint+1
    FROM customer.browser_preparations p CROSS JOIN stamp JOIN customer.verification_intents i
      ON (i.parent_ref,i.tenant_ref,i.browser_ref,i.browser_hash)=(p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)
    WHERE p.parent_ref=$2 AND p.tenant_ref=$3 AND p.browser_ref=$7 AND p.browser_hash=$8 AND p.confirmed_at IS NOT NULL
      AND p.expires_at>stamp.now AND $6::timestamptz>stamp.now AND i.operation_id=$10 AND i.proof_hash=$11
      AND i.state='open' AND i.expires_at>stamp.now AND i.browser_generation=$9`,
  [input.sessionId, input.parentRef, input.tenantRef, input.accountId, input.sessionHash, new Date(input.sessionExpiresAt),
    input.browserRef, input.browserHash, row.browser_generation, input.operationId, input.proofHash]);
  if (created.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  const published = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$5
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND generation=$4`,
  [input.parentRef, input.tenantRef, input.browserHash, row.browser_generation, input.sessionId]);
  if (published.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  const consumed = await client.query(`UPDATE customer.verification_intents SET state='consumed',consumed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND state='open' AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.operationId]);
  if (consumed.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  await client.query(`UPDATE customer.registration_enrollments SET activation_id=$4,activated_at=clock_timestamp(),session_id=$5,
    activation_attempts=activation_attempts||$6::jsonb WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`,
  [input.parentRef, input.tenantRef, input.checkId, input.activationId, input.sessionId,
    JSON.stringify([{ activationId: input.activationId, requestHash: input.requestHash, applied: true }])]);
  await recordSessionPublication(client, { ...input, checkId: input.activationId, method: 'passkey' });
  const result = await recoverEnrollmentActivation(client, input);
  if (!result) throw new CustomerRepositoryError('unavailable');
  return result;
}
