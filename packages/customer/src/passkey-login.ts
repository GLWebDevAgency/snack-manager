import type { PoolClient } from 'pg';
import type { CustomerIdentityRepository } from './port';
import type { CustomerAccessResult, CustomerPasskeyLoginPreparation } from './access-port';
import { validOpenIntent } from './intent-queries';
import { dbTime, session } from './queries';
import { accessRow, args, canAdmit, openKey, publishAccess, reserveAdmission, type AccessRow, type StoredKey } from './access-queries';
import { CustomerRepositoryError } from './client';
type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
const view = (r: AccessRow): CustomerPasskeyLoginPreparation => ({ operationId: r.operation_id, attemptId: r.id,
  expiresAt: r.expires_at.getTime(), origin: r.origin!, rpId: r.rp_id!, challenge: r.challenge! });
export async function preparePasskeyLogin(client: PoolClient, input: Input<'preparePasskeyLogin'>) {
  const intent = await validOpenIntent(client, input); if (!intent) return null;
  const existing = await accessRow(client, input);
  if (existing) return existing.row.method === 'passkey' && existing.row.origin === input.origin && existing.row.rp_id === input.rpId
    && existing.row.state === 'prepared' ? view(existing.row) : null;
  if (!await canAdmit(client, input)) return null;
  const r = (await client.query<AccessRow>(`INSERT INTO customer.credential_access_attempts(parent_ref,tenant_ref,operation_id,id,
    browser_ref,browser_hash,browser_generation,method,expires_at,origin,rp_id,challenge,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,'passkey',$8,$9,$10,$11,'prepared') RETURNING *`,
  [...args(input), input.browserRef, input.browserHash, intent.browser_generation, intent.expires_at, input.origin, input.rpId, input.challenge])).rows[0]!;
  await reserveAdmission(client, input, 'passkey'); return view(r);
}
export async function claimPasskeyLogin(client: PoolClient, input: Input<'claimPasskeyLogin'>) {
  const found = await accessRow(client, input);
  if (!found || found.row.method !== 'passkey' || found.row.state !== 'prepared' || !await validOpenIntent(client, input)) return null;
  const { row } = found;
  const key = (await client.query<{ account_id: string; session_version: string; credential: StoredKey; user_handle: string }>(`
    SELECT k.account_id,a.session_version,k.user_handle,jsonb_build_object('credentialId',k.credential_id,'publicKey',encode(k.public_key,'base64'),
      'counter',k.counter,'deviceType',k.device_type,'backedUp',k.backed_up,'transports',k.transports) credential
    FROM customer.passkey_credentials k JOIN customer.accounts a ON (a.parent_ref,a.tenant_ref,a.id)=(k.parent_ref,k.tenant_ref,k.account_id)
    WHERE k.parent_ref=$1 AND k.tenant_ref=$2 AND k.rp_id=$3 AND k.credential_id=$4 AND k.user_handle=$5 AND k.revoked_at IS NULL AND a.active FOR UPDATE OF k,a`,
  [input.parentRef, input.tenantRef, row.rp_id, input.credentialId, input.userHandle])).rows[0];
  if (!key) {
    await client.query(`UPDATE customer.credential_access_attempts SET request_hash=$5,state='failed',completed_at=clock_timestamp()
      WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, [...args(input), input.requestHash]); return null;
  }
  key.credential.publicKey = Buffer.from(key.credential.publicKey, 'base64').toString('base64url');
  await client.query(`UPDATE customer.credential_access_attempts SET request_hash=$5,state='checking',account_id=$6,account_version=$7,credential=$8::jsonb,user_handle=$9
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`,
  [...args(input), input.requestHash, key.account_id, key.session_version, JSON.stringify(key.credential), key.user_handle]);
  if (!await validOpenIntent(client, input)) throw new CustomerRepositoryError('unavailable');
  return { ...view(row), userHandle: key.user_handle, credential: openKey(key.credential) };
}
export async function resultPasskeyLogin(client: PoolClient, input: Input<'resultPasskeyLogin'>): Promise<CustomerAccessResult | null> {
  const found = await accessRow(client, input); if (!found || found.row.method !== 'passkey') return null;
  const { row, intent } = found, base = { operationId: input.operationId, attemptId: input.attemptId, expiresAt: row.expires_at.getTime(), session: null };
  if (intent.state === 'closed') return { ...base, state: 'closed' };
  if (row.expires_at.getTime() <= await dbTime(client)) return { ...base, state: 'expired' };
  if (row.state === 'approved' && intent.state === 'consumed' && row.session_id) {
    const saved = (await client.query<{ session_hash: string }>('SELECT session_hash FROM customer.sessions WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3',
      [input.parentRef, input.tenantRef, row.session_id])).rows[0];
    if (!saved || (input.sessionHash !== null && input.sessionHash !== saved.session_hash)) return null;
    const current = await session(client, input, saved.session_hash, input.browserHash,
      { expectedOperationId: input.operationId, expectedCheckId: input.attemptId });
    return current?.sessionId === row.session_id ? { ...base, state: 'approved', session: input.sessionHash === null ? null : current } : { ...base, state: 'failed' };
  }
  if (!await validOpenIntent(client, input)) return { ...base, state: 'failed' };
  return { ...base, state: row.state === 'failed' ? 'failed' : 'unresolved' };
}
export async function completePasskeyLogin(client: PoolClient, input: Input<'completePasskeyLogin'>) {
  const found = await accessRow(client, input);
  if (!found || found.row.method !== 'passkey' || found.row.request_hash !== input.requestHash) return null;
  const { row } = found;
  if (row.state === 'approved') return (await resultPasskeyLogin(client, input))?.session ?? null;
  if (row.state !== 'checking') return null;
  const fail = async () => { await client.query(`UPDATE customer.credential_access_attempts SET state='failed',completed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, args(input)); return null; };
  const proof = input.assertion;
  if (!proof || !row.credential || !row.account_id || row.account_version === null || !await validOpenIntent(client, input)
    || proof.credentialId !== row.credential.credentialId || proof.deviceType !== row.credential.deviceType
    || ((proof.counter !== 0 || row.credential.counter !== 0) && proof.counter <= row.credential.counter)) return fail();
  const changed = await client.query(`UPDATE customer.passkey_credentials k SET counter=$6,backed_up=$7
    FROM customer.accounts a WHERE k.parent_ref=$1 AND k.tenant_ref=$2 AND k.rp_id=$3 AND k.credential_id=$4
      AND k.account_id=$5 AND k.revoked_at IS NULL AND k.counter=$8
      AND (a.parent_ref,a.tenant_ref,a.id)=(k.parent_ref,k.tenant_ref,k.account_id) AND a.active AND a.session_version=$9`,
  [input.parentRef, input.tenantRef, row.rp_id, proof.credentialId, row.account_id, proof.counter, proof.backedUp, row.credential.counter, row.account_version]);
  if (changed.rowCount !== 1) return fail();
  const current = await publishAccess(client, input, { accountId: row.account_id, accountVersion: row.account_version,
    generation: row.browser_generation, publicationId: input.attemptId, method: 'passkey' });
  await client.query(`UPDATE customer.credential_access_attempts SET state='approved',session_id=$5,completed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4`, [...args(input), input.sessionId]);
  return current;
}
