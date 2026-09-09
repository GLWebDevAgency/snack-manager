import type { PoolClient } from 'pg';
import type { CustomerIdentityRepository } from './port';
import { args, openKey, storeKey } from './access-queries';
import { recoveryRow, grantView, freshGrant } from './recovery-grant';
type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
export async function readRecoveryKey(client: PoolClient, input: Input<'readRecoveryKey'>) {
  const row = await recoveryRow(client, input);
  return row?.registration_id === input.registrationId ? { registrationId: input.registrationId, origin: row.origin!, rpId: row.rp_id!,
    challenge: row.registration_challenge!, userHandle: row.user_handle!, expiresAt: row.expires_at.getTime() } : null;
}
export async function prepareRecoveryKey(client: PoolClient, input: Input<'prepareRecoveryKey'>) {
  const row = await recoveryRow(client, input); if (!row) return null;
  if (row.registration_id && (row.origin !== input.origin || row.rp_id !== input.rpId)) return null;
  if (!row.registration_id) await client.query(`UPDATE customer.account_recovery_grants SET registration_id=$5,origin=$6,rp_id=$7,registration_challenge=$8,user_handle=$9
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`,
  [...args(input), input.registrationId, input.origin, input.rpId, input.challenge, input.userHandle]);
  return readRecoveryKey(client, input);
}
export async function recordRecoveryKey(client: PoolClient, input: Input<'recordRecoveryKey'>) {
  const row = await recoveryRow(client, input); if (!row || row.registration_id !== input.registrationId) return null;
  if (row.registration_request_hash) return row.registration_request_hash === input.requestHash ? grantView(row) : null;
  await client.query(`UPDATE customer.account_recovery_grants SET registration_request_hash=$5,credential=$6::jsonb,registration_counter=$7
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`,
  [...args(input), input.requestHash, JSON.stringify(storeKey(input.credential)), input.credential.counter]);
  return freshGrant(client, input);
}
export async function readRecoveryAssertion(client: PoolClient, input: Input<'readRecoveryAssertion'>) {
  const row = await recoveryRow(client, input);
  return row?.credential && row.assertion_id === input.assertionId ? { assertionId: input.assertionId, origin: row.origin!, rpId: row.rp_id!,
    challenge: row.assertion_challenge!, userHandle: row.user_handle!, expiresAt: row.expires_at.getTime(),
    credential: openKey({ ...row.credential, counter: Number(row.registration_counter) }) } : null;
}
export async function prepareRecoveryAssertion(client: PoolClient, input: Input<'prepareRecoveryAssertion'>) {
  const row = await recoveryRow(client, input);
  if (!row?.credential || row.origin !== input.origin || row.rp_id !== input.rpId) return null;
  if (!row.assertion_id) await client.query(`UPDATE customer.account_recovery_grants SET assertion_id=$5,assertion_challenge=$6
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, [...args(input), input.assertionId, input.challenge]);
  return readRecoveryAssertion(client, input);
}
export async function recordRecoveryAssertion(client: PoolClient, input: Input<'recordRecoveryAssertion'>) {
  const row = await recoveryRow(client, input);
  if (!row?.credential || row.assertion_id !== input.assertionId || row.credential.credentialId !== input.credentialId
    || row.credential.deviceType !== input.deviceType) return null;
  if (row.assertion_request_hash) return row.assertion_request_hash === input.requestHash ? grantView(row) : null;
  if ((input.counter !== 0 || row.credential.counter !== 0) && input.counter <= row.credential.counter) return null;
  await client.query(`UPDATE customer.account_recovery_grants SET assertion_request_hash=$5,asserted_at=clock_timestamp(),credential=$6::jsonb
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`,
  [...args(input), input.requestHash, JSON.stringify({ ...row.credential, counter: input.counter, backedUp: input.backedUp })]);
  return freshGrant(client, input);
}
export async function issueRecoveryReplacement(client: PoolClient, input: Input<'issueRecoveryReplacement'>) {
  const row = await recoveryRow(client, input); if (!row?.asserted_at) return null;
  const old = row.recovery_receipts.find(r => r.rotationId === input.rotationId);
  if (old) return old.expectedVersion === input.expectedVersion ? { grant: grantView(row), emitCode: false } : null;
  if (row.activation_intent_id || input.expectedVersion !== row.recovery_receipts.length || input.expectedVersion >= 3) return null;
  await client.query(`UPDATE customer.account_recovery_grants SET recovery_receipts=recovery_receipts||$5::jsonb
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`,
  [...args(input), JSON.stringify([{ rotationId: input.rotationId, expectedVersion: input.expectedVersion, codeHash: input.codeHash }])]);
  return { grant: await freshGrant(client, input), emitCode: true };
}
