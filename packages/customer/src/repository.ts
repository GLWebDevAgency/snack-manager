import type { Pool, PoolClient } from 'pg';
import type { CustomerIdentityRepository, CustomerScope } from './port';
import { withCustomerScope } from './client';
import { lockParent, session } from './queries';
import { reserveVerification } from './reservation';
import { claimVerification, completeVerification, recoverVerification, settleVerification } from './checks';
import { claimSchema, completionSchema, nameSchema, recoverySchema, reservationSchema, revocationSchema,
  sessionSchema, settlementSchema, validate, browserPreparationSchema, browserBindingSchema, browserIssueSchema,
  intentBindingSchema, intentCloseSchema, intentResultSchema } from './validation';
import { prepareBrowser, issueBrowser, confirmBrowser, validateBrowser, restoreBrowser } from './browser-preparation';
import { lockIntentParent } from './intent-queries';
import { prepareIntent, closeIntent, validateIntent, resultIntent } from './verification-intents';
import * as enrollment from './enrollment';
import * as enrollmentValidation from './enrollment-validation';
import * as accessValidation from './access-validation';
import * as login from './passkey-login';
import * as recovery from './recovery-grant';
import * as protection from './recovery-protection';
import * as activation from './recovery-activation';
import { readProtectedCustomerSession } from './protected-session';

type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
const browserRestoreSchema = browserBindingSchema.omit({ browserRef: true });

/** Parent serialization is bounded to local SQL; never held over provider calls. */
export class PostgresCustomerIdentityRepository implements CustomerIdentityRepository {
  constructor(private readonly pool: Pool) {}
  prepareBrowser(raw: Input<'prepareBrowser'>) {
    const input = validate(browserPreparationSchema, raw);
    return withCustomerScope(this.pool, input, client => prepareBrowser(client, input));
  }
  issueBrowser(raw: Input<'issueBrowser'>) {
    const input = validate(browserIssueSchema, raw);
    return withCustomerScope(this.pool, input, client => issueBrowser(client, input));
  }
  confirmBrowser(raw: Input<'confirmBrowser'>) {
    const input = validate(browserBindingSchema, raw);
    return withCustomerScope(this.pool, input, client => confirmBrowser(client, input));
  }
  validateBrowser(raw: Input<'validateBrowser'>) {
    const input = validate(browserBindingSchema, raw);
    return withCustomerScope(this.pool, input, client => validateBrowser(client, input));
  }
  restoreBrowser(raw: Input<'restoreBrowser'>) {
    const input = validate(browserRestoreSchema, raw);
    return withCustomerScope(this.pool, input, client => restoreBrowser(client, input));
  }
  readEnrollment(raw: Input<'readEnrollment'>) {
    const input = validate(enrollmentValidation.enrollmentBindingSchema, raw);
    return this.intentLocked(input, client => enrollment.readEnrollment(client, input));
  }
  readEnrollmentKey(raw: Input<'readEnrollmentKey'>) {
    const input = validate(enrollmentValidation.enrollmentReadKeySchema, raw);
    return this.intentLocked(input, client => enrollment.readEnrollmentKey(client, input));
  }
  readEnrollmentAssertion(raw: Input<'readEnrollmentAssertion'>) {
    const input = validate(enrollmentValidation.enrollmentReadAssertionSchema, raw);
    return this.intentLocked(input, client => enrollment.readEnrollmentAssertion(client, input));
  }
  prepareEnrollmentKey(raw: Input<'prepareEnrollmentKey'>) {
    const input = validate(enrollmentValidation.enrollmentKeySchema, raw);
    return this.intentLocked(input, client => enrollment.prepareEnrollmentKey(client, input));
  }
  recordEnrollmentKey(raw: Input<'recordEnrollmentKey'>) {
    const input = validate(enrollmentValidation.enrollmentRecordKeySchema, raw);
    return this.intentLocked(input, client => enrollment.recordEnrollmentKey(client, input));
  }
  prepareEnrollmentAssertion(raw: Input<'prepareEnrollmentAssertion'>) {
    const input = validate(enrollmentValidation.enrollmentAssertionSchema, raw);
    return this.intentLocked(input, client => enrollment.prepareEnrollmentAssertion(client, input));
  }
  recordEnrollmentAssertion(raw: Input<'recordEnrollmentAssertion'>) {
    const input = validate(enrollmentValidation.enrollmentRecordAssertionSchema, raw);
    return this.intentLocked(input, client => enrollment.recordEnrollmentAssertion(client, input));
  }
  issueEnrollmentRecovery(raw: Input<'issueEnrollmentRecovery'>) {
    const input = validate(enrollmentValidation.enrollmentCodeSchema, raw);
    return this.intentLocked(input, client => enrollment.issueEnrollmentRecovery(client, input));
  }
  activateEnrollment(raw: Input<'activateEnrollment'>) {
    const input = validate(enrollmentValidation.enrollmentActivationSchema, raw);
    return this.intentLocked(input, client => enrollment.activateEnrollment(client, input));
  }
  recoverEnrollmentActivation(raw: Input<'recoverEnrollmentActivation'>) {
    const input = validate(enrollmentValidation.enrollmentActivationRecoverySchema, raw);
    return this.intentLocked(input, client => enrollment.recoverEnrollmentActivation(client, input));
  }
  preparePasskeyLogin(raw: Input<'preparePasskeyLogin'>) {
    const input = validate(accessValidation.preparePasskeyLogin, raw);
    return this.intentLocked(input, client => login.preparePasskeyLogin(client, input));
  }
  claimPasskeyLogin(raw: Input<'claimPasskeyLogin'>) {
    const input = validate(accessValidation.claimPasskeyLogin, raw);
    return this.intentLocked(input, client => login.claimPasskeyLogin(client, input));
  }
  completePasskeyLogin(raw: Input<'completePasskeyLogin'>) {
    const input = validate(accessValidation.completePasskeyLogin, raw);
    return this.intentLocked(input, client => login.completePasskeyLogin(client, input));
  }
  resultPasskeyLogin(raw: Input<'resultPasskeyLogin'>) {
    const input = validate(accessValidation.resultPasskeyLogin, raw);
    return this.intentLocked(input, client => login.resultPasskeyLogin(client, input));
  }
  beginAccountRecovery(raw: Input<'beginAccountRecovery'>) {
    const input = validate(accessValidation.beginAccountRecovery, raw);
    return this.intentLocked(input, client => recovery.beginAccountRecovery(client, input));
  }
  readAccountRecovery(raw: Input<'readAccountRecovery'>) {
    const input = validate(accessValidation.readAccountRecovery, raw);
    return this.intentLocked(input, client => recovery.readAccountRecovery(client, input));
  }
  prepareRecoveryKey(raw: Input<'prepareRecoveryKey'>) {
    const input = validate(accessValidation.prepareRecoveryKey, raw);
    return this.intentLocked(input, client => protection.prepareRecoveryKey(client, input));
  }
  readRecoveryKey(raw: Input<'readRecoveryKey'>) {
    const input = validate(accessValidation.readRecoveryKey, raw);
    return this.intentLocked(input, client => protection.readRecoveryKey(client, input));
  }
  recordRecoveryKey(raw: Input<'recordRecoveryKey'>) {
    const input = validate(accessValidation.recordRecoveryKey, raw);
    return this.intentLocked(input, client => protection.recordRecoveryKey(client, input));
  }
  prepareRecoveryAssertion(raw: Input<'prepareRecoveryAssertion'>) {
    const input = validate(accessValidation.prepareRecoveryAssertion, raw);
    return this.intentLocked(input, client => protection.prepareRecoveryAssertion(client, input));
  }
  readRecoveryAssertion(raw: Input<'readRecoveryAssertion'>) {
    const input = validate(accessValidation.readRecoveryAssertion, raw);
    return this.intentLocked(input, client => protection.readRecoveryAssertion(client, input));
  }
  recordRecoveryAssertion(raw: Input<'recordRecoveryAssertion'>) {
    const input = validate(accessValidation.recordRecoveryAssertion, raw);
    return this.intentLocked(input, client => protection.recordRecoveryAssertion(client, input));
  }
  issueRecoveryReplacement(raw: Input<'issueRecoveryReplacement'>) {
    const input = validate(accessValidation.issueRecoveryReplacement, raw);
    return this.intentLocked(input, client => protection.issueRecoveryReplacement(client, input));
  }
  activateAccountRecovery(raw: Input<'activateAccountRecovery'>) {
    const input = validate(accessValidation.activateAccountRecovery, raw);
    return this.intentLocked(input, client => activation.activateAccountRecovery(client, input));
  }
  recoverAccountRecoveryActivation(raw: Input<'recoverAccountRecoveryActivation'>) {
    const input = validate(accessValidation.recoverAccountRecoveryActivation, raw);
    return this.intentLocked(input, client => activation.recoverAccountRecoveryActivation(client, input));
  }
  private intentLocked<T>(scope: CustomerScope, work: (client: PoolClient) => Promise<T>) {
    return withCustomerScope(this.pool, scope, async client => {
      await lockIntentParent(client, scope);
      await lockParent(client, scope);
      return work(client);
    });
  }
  prepareIntent(raw: Input<'prepareIntent'>) {
    const input = validate(intentBindingSchema, raw);
    return this.intentLocked(input, client => prepareIntent(client, input));
  }
  closeIntent(raw: Input<'closeIntent'>) {
    const input = validate(intentCloseSchema, raw);
    return this.intentLocked(input, client => closeIntent(client, input));
  }
  validateIntent(raw: Input<'validateIntent'>) {
    const input = validate(intentBindingSchema, raw);
    return this.intentLocked(input, client => validateIntent(client, input));
  }
  resultIntent(raw: Input<'resultIntent'>) {
    const input = validate(intentResultSchema, raw);
    return this.intentLocked(input, client => resultIntent(client, input));
  }
  private locked<T>(scope: CustomerScope, work: (client: PoolClient) => Promise<T>): Promise<T | null> {
    return withCustomerScope(this.pool, scope, async client => {
      await lockIntentParent(client, scope);
      return await lockParent(client, scope) ? work(client) : null;
    });
  }
  reserve(raw: Input<'reserve'>) {
    const input = validate(reservationSchema, raw);
    return withCustomerScope(this.pool, input, async client => {
      await lockIntentParent(client, input);
      return reserveVerification(client, input);
    });
  }
  settleSend(raw: Input<'settleSend'>) {
    const input = validate(settlementSchema, raw);
    return this.locked(input, client => settleVerification(client, input));
  }
  claimCheck(raw: Input<'claimCheck'>) {
    const input = validate(claimSchema, raw);
    return this.locked(input, client => claimVerification(client, input));
  }
  recoverCheck(raw: Input<'recoverCheck'>) {
    const input = validate(recoverySchema, raw);
    return this.locked(input, client => recoverVerification(client, input));
  }
  completeCheck(raw: Input<'completeCheck'>) {
    const input = validate(completionSchema, raw);
    return this.locked(input, client => completeVerification(client, input));
  }
  authenticate(raw: Input<'authenticate'>) {
    const input = validate(sessionSchema, raw);
    return this.locked(input, client => session(client, input, input.sessionHash, input.browserHash, input));
  }
  authenticateProtected(raw: Input<'authenticateProtected'>) {
    const input = validate(sessionSchema, raw);
    return this.intentLocked(input, async client => {
      const current = await readProtectedCustomerSession(client, input);
      return current ? { accountId: current.profile.accountId,
        sessionId: current.sessionId, expiresAt: current.expiresAt } : null;
    });
  }
  updateName(raw: Input<'updateName'>) {
    const input = validate(nameSchema, raw);
    return this.locked(input, async client => {
      const current = await session(client, input, input.sessionHash, input.browserHash, input);
      if (!current) return null;
      await client.query('SELECT id FROM customer.accounts WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 FOR UPDATE',
        [input.parentRef, input.tenantRef, current.profile.accountId]);
      if (!await session(client, input, input.sessionHash, input.browserHash, input)) return null;
      const changed = await client.query(`UPDATE customer.accounts a SET encrypted_name=$4,revision=revision+1
        WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.revision=$5 AND a.active
          AND EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=a.parent_ref AND s.tenant_ref=a.tenant_ref
            AND s.account_id=a.id AND s.session_hash=$6 AND s.revoked_at IS NULL
            AND s.expires_at>clock_timestamp() AND s.account_version=a.session_version AND s.browser_hash=$7
            AND EXISTS (SELECT 1 FROM customer.session_publications u
              WHERE (u.parent_ref,u.tenant_ref,u.session_id,u.browser_ref,u.browser_hash,u.browser_generation)
                =(s.parent_ref,s.tenant_ref,s.id,s.browser_ref,s.browser_hash,s.browser_generation)
                AND u.operation_id=$9 AND u.check_id=$10)
            AND s.browser_ref=$8 AND EXISTS (SELECT 1 FROM customer.browser_preparations p
              WHERE (p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)=(s.parent_ref,s.tenant_ref,s.browser_ref,s.browser_hash)
                AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp())
            AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
              (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
              =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)))`,
      [input.parentRef, input.tenantRef, current.profile.accountId, input.encryptedName, input.expectedRevision, input.sessionHash, input.browserHash, input.browserRef, input.expectedOperationId, input.expectedCheckId]);
      return changed.rowCount ? session(client, input, input.sessionHash, input.browserHash, input) : null;
    });
  }
  async revoke(raw: Input<'revoke'>): Promise<void> {
    const input = validate(revocationSchema, raw);
    await this.locked(input, async client => {
      const current = await session(client, input, input.sessionHash, input.browserHash, input);
      if (!current) return;
      await client.query('SELECT id FROM customer.accounts WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 FOR UPDATE',
        [input.parentRef, input.tenantRef, current.profile.accountId]);
      if (!await session(client, input, input.sessionHash, input.browserHash, input)) return;
      // The final SQL mutation checks expiry before changing either identity or
      // context. Parent serialization keeps the current pointer stable throughout.
      const changed = input.all ? await client.query(`UPDATE customer.accounts a SET session_version=session_version+1
        WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.active
          AND EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=a.parent_ref AND s.tenant_ref=a.tenant_ref
            AND s.account_id=a.id AND s.session_hash=$4 AND s.revoked_at IS NULL
            AND s.expires_at>clock_timestamp() AND s.account_version=a.session_version AND s.browser_hash=$5
            AND EXISTS (SELECT 1 FROM customer.session_publications u
              WHERE (u.parent_ref,u.tenant_ref,u.session_id,u.browser_ref,u.browser_hash,u.browser_generation)
                =(s.parent_ref,s.tenant_ref,s.id,s.browser_ref,s.browser_hash,s.browser_generation)
                AND u.operation_id=$7 AND u.check_id=$8)
            AND s.browser_ref=$6 AND EXISTS (SELECT 1 FROM customer.browser_preparations p
              WHERE (p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)=(s.parent_ref,s.tenant_ref,s.browser_ref,s.browser_hash)
                AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp())
            AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
              (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
              =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)))`,
      [input.parentRef, input.tenantRef, current.profile.accountId, input.sessionHash, input.browserHash, input.browserRef, input.expectedOperationId, input.expectedCheckId])
        : await client.query(`UPDATE customer.sessions s SET revoked_at=clock_timestamp()
        WHERE parent_ref=$1 AND tenant_ref=$2 AND session_hash=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND EXISTS (SELECT 1 FROM customer.session_publications u
            WHERE (u.parent_ref,u.tenant_ref,u.session_id,u.browser_ref,u.browser_hash,u.browser_generation)
              =(s.parent_ref,s.tenant_ref,s.id,s.browser_ref,s.browser_hash,s.browser_generation)
              AND u.operation_id=$6 AND u.check_id=$7)
          AND browser_hash=$4 AND browser_ref=$5 AND EXISTS (SELECT 1 FROM customer.browser_preparations p
            WHERE (p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)=(s.parent_ref,s.tenant_ref,s.browser_ref,s.browser_hash)
              AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp())
          AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
            (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
            =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id))`,
      [input.parentRef, input.tenantRef, input.sessionHash, input.browserHash, input.browserRef, input.expectedOperationId, input.expectedCheckId]);
      if (!changed.rowCount) return;
      const detached = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=NULL
        WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND current_session_id=$4`,
      [input.parentRef, input.tenantRef, input.browserHash, current.sessionId]);
      if (detached.rowCount !== 1) throw new Error('Continuité navigateur indisponible');
    });
  }
}
