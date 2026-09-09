import type { PoolClient } from 'pg';
import type { CustomerIdentityRepository } from './port';
import { args, publishAccess } from './access-queries';
import { recoveryRow, freshGrant } from './recovery-grant';
import { session } from './queries';
import { CustomerRepositoryError } from './client';
type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
export async function recoverAccountRecoveryActivation(client: PoolClient, input: Input<'recoverAccountRecoveryActivation'>) {
  const row = await recoveryRow(client, input, false);
  if (!row || row.state !== 'activated' || row.activation_id !== input.activationId || !row.session_id) return null;
  const current = await session(client, input, input.sessionHash, input.browserHash,
    { expectedOperationId: input.operationId, expectedCheckId: input.activationId });
  return current?.sessionId === row.session_id ? current : null;
}
export async function activateAccountRecovery(client: PoolClient, input: Input<'activateAccountRecovery'>) {
  const previous = await recoveryRow(client, input, false);
  if (!previous) return null;
  if (previous.state === 'activated') return previous.activation_id === input.activationId && previous.activation_request_hash === input.requestHash
    ? recoverAccountRecoveryActivation(client, input) : null;
  const row = await recoveryRow(client, input);
  if (!row?.credential || !row.asserted_at || row.failed_confirmations >= 5
    || (row.activation_intent_id !== null && row.activation_intent_id !== input.activationId)) return null;
  if (!row.activation_intent_id) await client.query(`UPDATE customer.account_recovery_grants SET activation_intent_id=$5
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, [...args(input), input.activationId]);
  const code = row.recovery_receipts.at(-1);
  if (!code || row.recovery_receipts.length !== input.recoveryVersion || code.codeHash !== input.codeHash) {
    await client.query(`UPDATE customer.account_recovery_grants SET failed_confirmations=failed_confirmations+1
      WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, args(input));
    await freshGrant(client, input); return null;
  }
  // Reservation was non-consuming. Only this final transaction burns the old
  // code and replaces the key, retaining every historical proof.
  const consumed = await client.query(`UPDATE customer.recovery_codes SET consumed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3 AND version=$4 AND code_hash=$5 AND consumed_at IS NULL AND revoked_at IS NULL`,
  [input.parentRef, input.tenantRef, row.account_id, row.source_version, row.source_hash]);
  if (consumed.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  await client.query(`UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3 AND revoked_at IS NULL`, [input.parentRef, input.tenantRef, row.account_id]);
  await client.query(`INSERT INTO customer.passkey_credentials(parent_ref,tenant_ref,account_id,rp_id,credential_id,public_key,user_handle,counter,device_type,backed_up,transports)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
  [input.parentRef, input.tenantRef, row.account_id, row.rp_id, row.credential.credentialId, Buffer.from(row.credential.publicKey, 'base64url'),
    row.user_handle, row.credential.counter, row.credential.deviceType, row.credential.backedUp, JSON.stringify(row.credential.transports)]);
  await client.query(`INSERT INTO customer.recovery_codes(parent_ref,tenant_ref,account_id,version,code_hash) VALUES($1,$2,$3,$4::bigint+1,$5)`,
    [input.parentRef, input.tenantRef, row.account_id, row.source_version, code.codeHash]);
  const bumped = await client.query(`UPDATE customer.accounts SET session_version=session_version+1
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 AND session_version=$4 AND active AND session_version<9007199254740991`,
  [input.parentRef, input.tenantRef, row.account_id, row.account_version]);
  if (bumped.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  await client.query(`UPDATE customer.sessions SET revoked_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3 AND revoked_at IS NULL`, [input.parentRef, input.tenantRef, row.account_id]);
  await publishAccess(client, input, { accountId: row.account_id, accountVersion: (BigInt(row.account_version) + 1n).toString(),
    generation: row.browser_generation, publicationId: input.activationId, method: 'recovery' });
  const changed = await client.query(`UPDATE customer.account_recovery_grants SET state='activated',activation_id=$5,activation_request_hash=$6,
    activated_at=clock_timestamp(),session_id=$7 WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4 AND state='open' AND expires_at>clock_timestamp()`,
  [...args(input), input.activationId, input.requestHash, input.sessionId]);
  if (changed.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  const result = await recoverAccountRecoveryActivation(client, input);
  if (!result) throw new CustomerRepositoryError('unavailable');
  return result;
}
