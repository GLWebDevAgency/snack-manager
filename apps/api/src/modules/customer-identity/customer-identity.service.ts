import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CustomerAccountBrowserRequests, CustomerAccountResponses, CustomerEnrollmentSchema, type CustomerVerificationResult } from '@sm/contracts';
import {
  CustomerIdentityCrypto,
  type CustomerIdentityRepository, type CustomerScope, type CustomerSession,
  type PendingChallenge, type CheckResult, type CustomerCheckCompletion,
} from '@sm/customer';
import type { PhoneVerificationTransport } from './phone-verification.port';
import { SimpleWebAuthnPasskeyVerifier } from './passkey-verifier';
import type { PasskeyVerifier } from './passkey-verifier.port';
import { protectCustomerEnrollment } from './customer-protection';
import { loginCustomerPasskey } from './customer-passkey-login';
import { recoverCustomerAccount } from './customer-account-recovery';
import { CustomerCredentialAccessError, type CustomerCredentialAccessPort } from './customer-credential-access.port';
import { costEvidenceReferenceOf, CustomerVerificationModeSchema, paidBudgetOf, planCustomerPhoneVerification,
  type CustomerVerificationMode, type ReservedCustomerVerificationPlan } from './verification-plan';

const tenant = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(value => Buffer.from(value, 'base64url').toString('base64url') === value);
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const browserBindingSchema = z.strictObject({ tenantRef: tenant, browserRef: uuid, browserSecret: token });
type BrowserBinding = z.infer<typeof browserBindingSchema>;
const intentBindingSchema = browserBindingSchema.extend({ operationId: uuid, intentProof: token });
type IntentBinding = z.infer<typeof intentBindingSchema>;
const intentSchema = browserBindingSchema.extend({ request: CustomerAccountBrowserRequests.intent,
  candidateProof: token.nullable() }).refine(value => value.request.step === 'prepare' ? value.candidateProof !== null : value.candidateProof === null);
const startSchema = z.strictObject({
  tenantRef: tenant, phone, operationId: uuid, browserRef: uuid, browserSecret: token, intentProof: token,
  clientIp: z.string().min(1).max(160), humanVerified: z.literal(true),
});
const checkSchema = z.strictObject({
  tenantRef: tenant, operationId: uuid, intentProof: token, challengeId: uuid, checkId: uuid, code: z.string().regex(/^\d{6}$/),
  browserRef: uuid, browserSecret: token, existingSessionToken: token.nullable(),
});
const recoverSchema = intentBindingSchema.extend({ checkId: uuid.nullable() });
const protectionSchema = browserBindingSchema.extend({ intentProof: token,
  origin: z.string().min(1).max(200), request: CustomerAccountBrowserRequests.protection });
const credentialAccessShape = { intentProof: token, origin: z.string().min(1).max(200), clientIp: z.string().min(1).max(160) };
const passkeyLoginSchema = browserBindingSchema.extend({ ...credentialAccessShape, request: CustomerAccountBrowserRequests.passkey });
const accountRecoverySchema = browserBindingSchema.extend({ ...credentialAccessShape, request: CustomerAccountBrowserRequests.recovery });
const sessionSchema = browserBindingSchema.extend({ token, expectedOperationId: uuid, expectedCheckId: uuid });
const browserSchema = z.strictObject({ tenantRef: tenant, request: CustomerAccountBrowserRequests.browser,
  browserSecret: token.nullable(), candidateSecret: token.nullable() }).refine(value =>
  value.request.step === 'prepare' ? value.browserSecret === null && value.candidateSecret === null
    : value.request.step === 'issue' ? value.candidateSecret !== null
      : value.browserSecret !== null && value.candidateSecret === null);
const updateSchema = sessionSchema.extend({
  name: z.string().trim().min(1).max(120).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).nullable(),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
});
const logoutSchema = sessionSchema.extend({ all: z.boolean() });
const SESSION_TTL_MS = 7 * 86_400_000;
const fundingSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('trial') }),
  z.strictObject({ mode: z.literal('paid'), authorizationRef: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
    currency: z.literal('USD'), reservedMicrousd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
]);

/** Trusted server configuration only. No default activation and no adapter
 * configuration from an HTTP body. The future Nest composition must derive
 * environment from the actual deployed runtime, never from a public request. */
export type CustomerIdentityConfiguration = {
  mode: CustomerVerificationMode;
  environment: string;
  parentRef: string;
  policy: unknown;
  evidence: unknown;
};
export type CustomerSessionView = {
  sessionId: string;
  expiresAt: number;
  profile: { name: string | null; phoneE164: string; phoneVerifiedAt: number; revision: number };
};
export class CustomerIdentityError extends Error {
  constructor(readonly reason: 'unavailable' | 'invalid_request' | 'unauthorized' | 'conflict' | 'not_found') {
    super(reason === 'unavailable' ? 'Service de compte momentanément indisponible.'
      : reason === 'conflict' ? 'Le profil a changé. Actualisez-le avant de réessayer.'
        : 'Accès au compte invalide ou expiré.');
    this.name = 'CustomerIdentityError';
  }
}

/** Application use cases; only the separate signed-relay boundary exposes them.
 * Durable authority lives in the PG repository; this class never substitutes
 * local state for its reservation, one-time check or session revocation.
 * Tests inject the provider and clock; no mock provider exists in runtime. */
export class CustomerIdentityService {
  constructor(
    private readonly repository: CustomerIdentityRepository,
    private readonly crypto: CustomerIdentityCrypto,
    private readonly transport: PhoneVerificationTransport,
    private readonly configuration: () => CustomerIdentityConfiguration,
    private readonly now: () => number = Date.now,
    private readonly beforeProvider: () => Promise<void> = async () => {},
    private readonly passkeys: PasskeyVerifier = new SimpleWebAuthnPasskeyVerifier(),
  ) {}

  /** Preparations do not authorize a send and never consume a provider budget.
   * Only the repository's one-time issue CAS can authorize a Set-Cookie. */
  async browser(raw: unknown) {
    return this.protect(async () => {
      const input = this.parse(browserSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      const browserRef = input.request.step === 'restore' ? null : input.request.browserRef;
      let result;
      switch (input.request.step) {
        case 'prepare':
          result = { preparation: await this.repository.prepareBrowser({ ...scope, browserRef: input.request.browserRef }), emitCookie: false };
          break;
        case 'issue':
          result = await this.repository.issueBrowser({ ...scope, browserRef: input.request.browserRef,
            browserHash: this.crypto.hash('browser', scope.tenantRef, input.candidateSecret!),
            currentBrowserHash: input.browserSecret === null ? null
              : this.crypto.hash('browser', scope.tenantRef, input.browserSecret) });
          break;
        case 'confirm':
          result = { preparation: await this.repository.confirmBrowser({ ...scope, browserRef: input.request.browserRef,
            browserHash: this.crypto.hash('browser', scope.tenantRef, input.browserSecret!) }), emitCookie: false };
          break;
        case 'restore':
          result = { preparation: await this.repository.restoreBrowser({ ...scope,
            browserHash: this.crypto.hash('browser', scope.tenantRef, input.browserSecret!) }), emitCookie: false };
      }
      const parsed = CustomerAccountResponses.browser.safeParse(result);
      if (!parsed.success || (browserRef !== null && parsed.data.preparation.browserRef !== browserRef)
        || (parsed.data.emitCookie && input.request.step !== 'issue')) throw new CustomerIdentityError('unauthorized');
      if (input.request.step === 'restore') {
        // Returning the public selector does not select an intention or private
        // publication. Revalidate the actual cookie at the final async boundary;
        // never confirm an issued preparation or extend its original lifetime.
        if (parsed.data.preparation.state !== 'confirmed' || parsed.data.preparation.expiresAt > this.now() + SESSION_TTL_MS) {
          throw new CustomerIdentityError('unauthorized');
        }
        const current = await this.requireBrowser({ tenantRef: input.tenantRef,
          browserRef: parsed.data.preparation.browserRef, browserSecret: input.browserSecret! });
        if (parsed.data.preparation.expiresAt !== current.expiresAt || current.expiresAt <= this.now()) {
          throw new CustomerIdentityError('unauthorized');
        }
      }
      // Recheck current server configuration after waiting for the durable CAS.
      if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) {
        throw new CustomerIdentityError('unavailable');
      }
      return parsed.data;
    });
  }

  /** The runtime calls this before Turnstile; use cases call it independently.
   * This is a point-in-time check, not a lock held across a provider request. */
  async requireBrowser(raw: unknown): Promise<{ expiresAt: number }> {
    return this.protect(async () => {
      const input = this.parse(browserBindingSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      const result = await this.repository.validateBrowser({ ...scope, browserRef: input.browserRef,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret) });
      if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) {
        throw new CustomerIdentityError('unavailable');
      }
      if (!result || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= this.now()) {
        throw new CustomerIdentityError('unauthorized');
      }
      return { expiresAt: result.expiresAt };
    });
  }

  private binding(input: BrowserBinding): BrowserBinding {
    return { tenantRef: input.tenantRef, browserRef: input.browserRef, browserSecret: input.browserSecret };
  }

  private intentBinding(input: IntentBinding): IntentBinding {
    return { ...this.binding(input), operationId: input.operationId, intentProof: input.intentProof };
  }

  private intentScope(input: IntentBinding) {
    return { ...this.scope(input.tenantRef, this.configuration()), browserRef: input.browserRef,
      browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret), operationId: input.operationId,
      proofHash: this.crypto.hash('intent-proof', input.tenantRef, input.intentProof) };
  }

  async intent(raw: unknown) {
    return this.protect(async () => {
      const input = this.parse(intentSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = { ...this.scope(input.tenantRef, this.configuration()), browserRef: input.browserRef,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret), operationId: input.request.operationId };
      const result = input.request.step === 'prepare'
        ? await this.repository.prepareIntent({ ...scope, proofHash: this.crypto.hash('intent-proof', input.tenantRef, input.candidateProof!) })
        : { intent: await this.repository.closeIntent(scope), emitCookie: false };
      const parsed = CustomerAccountResponses.intent.safeParse(result);
      if (!parsed.success || parsed.data.intent.operationId !== input.request.operationId
        || (parsed.data.emitCookie && input.request.step !== 'prepare')
        || (input.request.step === 'close' && !['closed', 'expired'].includes(parsed.data.intent.state))) {
        throw new CustomerIdentityError('unauthorized');
      }
      await this.requireBrowser(this.binding(input));
      return parsed.data;
    });
  }

  /** Open-intent admission only. Result reads separately authenticate a proof
   * even when the intention has already been consumed or closed. */
  async requireIntent(raw: unknown): Promise<{ expiresAt: number }> {
    return this.protect(async () => {
      const input = this.parse(intentBindingSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.intentScope(input);
      const result = await this.repository.validateIntent(scope);
      if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) throw new CustomerIdentityError('unavailable');
      if (!result || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= this.now()) throw new CustomerIdentityError('unauthorized');
      return { expiresAt: result.expiresAt };
    });
  }

  private async boundView(input: BrowserBinding, scope: CustomerScope, session: CustomerSession) {
    const browser = await this.requireBrowser(this.binding(input));
    if (session.expiresAt > browser.expiresAt) throw new CustomerIdentityError('unauthorized');
    return this.view(scope, session);
  }

  async start(raw: unknown): Promise<{ challengeId: string; expiresAt: number }> {
    return this.protect(async () => {
      const input = this.parse(startSchema, raw);
      await this.requireIntent(this.intentBinding(input));
      const config = this.configuration();
      const scope = this.scope(input.tenantRef, config);
      const now = this.now();
      const plan = this.plan(config, input.tenantRef, input.phone, now);
      const { challengeTtlMs, ...plannedLimits } = plan.limits;
      const limits = 'paidBudget' in plannedLimits ? { ...plannedLimits,
        paidBudget: { ...plannedLimits.paidBudget, costEvidenceReference: costEvidenceReferenceOf(plan)! } } : plannedLimits;
      const phoneHash = this.crypto.hash('phone', input.tenantRef, input.phone);
      const browserHash = this.crypto.hash('browser', input.tenantRef, input.browserSecret);
      const reserved = await this.repository.reserve({
        ...scope, proofHash: this.crypto.hash('intent-proof', input.tenantRef, input.intentProof),
        browserRef: input.browserRef, operationId: input.operationId, challengeId: randomUUID(),
        requestHash: this.crypto.hash('request', input.tenantRef,
          JSON.stringify([input.operationId, phoneHash, browserHash, input.browserRef])),
        browserHash, phoneHash,
        globalPhoneHash: this.crypto.hash('global-phone', config.parentRef, input.phone),
        ipHash: this.crypto.hash('ip', config.parentRef, input.clientIp),
        encryptedPhone: this.crypto.seal('phone', input.tenantRef, phoneHash, input.phone),
        serviceSid: plan.serviceSid, evidenceReference: plan.evidenceReference,
        planExpiresAt: plan.expiresAt,
        expiresAt: Math.min(now + challengeTtlMs, plan.expiresAt),
        now, limits,
      });
      if (reserved.kind === 'pending') {
        await this.requireIntent(this.intentBinding(input));
        this.assertChallenge(scope, reserved.challenge, phoneHash, plan.serviceSid);
        this.assertFunding(scope, reserved.challenge, this.plan(this.configuration(), input.tenantRef, input.phone, this.now()));
        return this.challengeView(reserved.challenge);
      }
      if (reserved.kind !== 'reserved') throw new CustomerIdentityError('unavailable');

      let sid: string;
      try {
        await this.beforeProvider();
        await this.requireIntent(this.intentBinding(input));
        // Lock waits/configuration refreshes must not turn the old reservation
        // into permission for a different service, segment cost or allowance.
        const current = this.plan(this.configuration(), input.tenantRef, input.phone, this.now());
        if (this.now() >= plan.expiresAt || current.accountSid !== plan.accountSid
          || current.serviceSid !== plan.serviceSid || current.evidenceReference !== plan.evidenceReference
          || costEvidenceReferenceOf(current) !== costEvidenceReferenceOf(plan)
          || JSON.stringify(current.limits) !== JSON.stringify(plan.limits)) {
          throw new CustomerIdentityError('unavailable');
        }
        // No automatic retry, even if the provider sent but its answer was lost.
        sid = (await this.transport.start({ phone: input.phone, serviceSid: plan.serviceSid })).verificationSid;
      } catch {
        await this.repository.settleSend({ ...scope, challengeId: reserved.challengeId, verificationSid: null, now: this.now() });
        throw new CustomerIdentityError('unavailable');
      }
      const pending = await this.repository.settleSend({
        ...scope, challengeId: reserved.challengeId, verificationSid: sid, now: this.now(),
      });
      if (!pending) throw new CustomerIdentityError('unavailable');
      await this.requireIntent(this.intentBinding(input));
      this.assertChallenge(scope, pending, phoneHash, plan.serviceSid, reserved.challengeId);
      this.assertFunding(scope, pending, this.plan(this.configuration(), input.tenantRef, input.phone, this.now()));
      return this.challengeView(pending);
    });
  }

  async check(raw: unknown): Promise<z.infer<typeof CustomerAccountResponses.check>> {
    return this.protect(async () => {
      const input = this.parse(checkSchema, raw);
      let browser = await this.requireBrowser(this.binding(input));
      const config = this.configuration();
      const scope = this.scope(input.tenantRef, config);
      const accessToken = this.crypto.tokenForIntentCheck(input.tenantRef, input.browserSecret, input.operationId, input.intentProof, input.challengeId, input.checkId);
      const sessionHash = this.crypto.hash('session', input.tenantRef, accessToken);
      const claim = { ...scope, browserRef: input.browserRef, operationId: input.operationId,
        proofHash: this.crypto.hash('intent-proof', input.tenantRef, input.intentProof),
        requestHash: this.crypto.hash('request', input.tenantRef,
          JSON.stringify(['customer-check-body-v1', input.operationId, input.challengeId, input.checkId, input.code])),
        challengeId: input.challengeId, checkId: input.checkId,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret), now: this.now() };
      // This private receipt is valid only for the original consumed challenge,
      // exact browser/check and STILL-LIVE session. No new TTL or provider call.
      const recovered = await this.repository.recoverCheck({ ...claim, sessionHash });
      if (recovered) return this.checkCompletion(input, scope, recovered, accessToken);
      await this.requireIntent(this.intentBinding(input));
      const pending = await this.repository.claimCheck(claim);
      if (!pending) throw new CustomerIdentityError('unauthorized');

      let result: CheckResult = 'uncertain';
      try {
        this.assertChallenge(scope, pending, pending.phoneHash, pending.serviceSid, input.challengeId);
        const verifiedPhone = this.crypto.open('phone', input.tenantRef, pending.phoneHash, pending.encryptedPhone);
        await this.beforeProvider();
        browser = await this.requireBrowser(this.binding(input));
        await this.requireIntent(this.intentBinding(input));
        // No await between this fresh funding/policy decision and the provider.
        this.assertChallenge(scope, pending, pending.phoneHash, pending.serviceSid, input.challengeId);
        const plan = this.plan(this.configuration(), input.tenantRef, verifiedPhone, this.now());
        if (plan.accountSid !== scope.parentRef || plan.serviceSid !== pending.serviceSid) {
          throw new CustomerIdentityError('unavailable');
        }
        this.assertFunding(scope, pending, plan);
        result = await this.transport.check({ phone: verifiedPhone, serviceSid: pending.serviceSid,
          verificationSid: pending.verificationSid, code: input.code });
      } catch {
        // Includes decryption/configuration/transport failures. The claimed
        // remote check is conservatively terminal; no implicit approval.
      }
      const now = this.now();
      const completed = await this.repository.completeCheck({ ...claim, now, result,
        sessionId: randomUUID(), sessionHash, sessionExpiresAt: Math.min(now + SESSION_TTL_MS, browser.expiresAt),
        accountId: randomUUID(), existingSessionHash: input.existingSessionToken === null ? null
          : this.crypto.hash('session', input.tenantRef, input.existingSessionToken),
      });
      if (result === 'uncertain') throw new CustomerIdentityError('unavailable');
      if (result !== 'approved' || !completed) throw new CustomerIdentityError('unauthorized');
      return this.checkCompletion(input, scope, completed, accessToken);
    });
  }

  private async checkCompletion(input: BrowserBinding & { operationId: string; checkId: string }, scope: CustomerScope,
    completed: CustomerCheckCompletion, accessToken: string) {
    await this.requireBrowser(this.binding(input));
    if (completed.kind === 'enrollment') {
      const enrollment = CustomerEnrollmentSchema.parse(completed.enrollment);
      if (enrollment.operationId !== input.operationId || enrollment.checkId !== input.checkId || enrollment.expiresAt <= this.now()) {
        throw new CustomerIdentityError('unauthorized');
      }
      return CustomerAccountResponses.check.parse({ state: 'enrollment', enrollment });
    }
    const view = await this.boundView(input, scope, completed.session);
    return CustomerAccountResponses.check.parse({ state: 'authenticated', token: accessToken,
      view: { expiresAt: view.expiresAt, profile: view.profile } });
  }

  async protection(raw: unknown) {
    return this.protect(async () => {
      const input = this.parse(protectionSchema, raw);
      const bound = { ...this.binding(input), operationId: input.request.operationId, intentProof: input.intentProof };
      const scope = this.intentScope(bound);
      const result = await protectCustomerEnrollment({ repository: this.repository, crypto: this.crypto, verifier: this.passkeys,
        binding: { ...scope, checkId: input.request.checkId }, browserSecret: input.browserSecret, intentProof: input.intentProof,
        origin: input.origin, now: this.now, browser: () => this.requireBrowser(this.binding(input)), intent: () => this.requireIntent(bound),
        view: async session => { const value = await this.boundView(input, scope, session);
          return { expiresAt: value.expiresAt, profile: value.profile }; },
      }, input.request);
      await this.requireBrowser(this.binding(input));
      if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) throw new CustomerIdentityError('unavailable');
      return result;
    });
  }

  async passkey(raw: unknown) {
    return this.protect(async () => this.credentialAccess(this.parse(passkeyLoginSchema, raw), loginCustomerPasskey));
  }

  async recovery(raw: unknown) {
    return this.protect(async () => this.credentialAccess(this.parse(accountRecoverySchema, raw), recoverCustomerAccount));
  }

  private async credentialAccess<Request extends { operationId: string; attemptId: string }, Result>(
    input: BrowserBinding & { intentProof: string; origin: string; clientIp: string; request: Request },
    work: (port: CustomerCredentialAccessPort, request: Request) => Promise<Result>,
  ): Promise<Result> {
    const bound = { ...this.binding(input), operationId: input.request.operationId, intentProof: input.intentProof };
    const scope = this.intentScope(bound);
    const result = await work({ repository: this.repository, crypto: this.crypto, verifier: this.passkeys,
      binding: { ...scope, attemptId: input.request.attemptId }, source: input.clientIp,
      browserSecret: input.browserSecret, intentProof: input.intentProof, origin: input.origin, now: this.now,
      browser: () => this.requireBrowser(this.binding(input)), intent: () => this.requireIntent(bound),
      view: async session => { const value = await this.boundView(input, scope, session);
        return { expiresAt: value.expiresAt, profile: value.profile }; },
    }, input.request);
    await this.requireBrowser(this.binding(input));
    if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) throw new CustomerIdentityError('unavailable');
    return result;
  }

  async session(raw: unknown): Promise<CustomerSessionView> {
    return this.protect(async () => {
      const input = this.parse(sessionSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.scope(input.tenantRef, this.configuration());
      const session = await this.repository.authenticate({ ...scope, browserRef: input.browserRef,
        expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret),
        sessionHash: this.crypto.hash('session', input.tenantRef, input.token), now: this.now() });
      if (!session) throw new CustomerIdentityError('unauthorized');
      return this.boundView(input, scope, session);
    });
  }

  /** No PII leaves this port. Authorization is sampled in PostgreSQL, not a
   * cross-store transaction; the checkout rechecks before its Mongo commit. */
  async commercePrincipal(raw: unknown) {
    return this.protect(async () => {
      const input = this.parse(sessionSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.scope(input.tenantRef, this.configuration());
      const principal = await this.repository.authenticateProtected({ ...scope, browserRef: input.browserRef,
        expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret),
        sessionHash: this.crypto.hash('session', input.tenantRef, input.token), now: this.now() });
      if (!principal || principal.expiresAt <= this.now()) throw new CustomerIdentityError('unauthorized');
      if (this.scope(input.tenantRef, this.configuration()).parentRef !== scope.parentRef) throw new CustomerIdentityError('unavailable');
      await this.requireBrowser(this.binding(input));
      return { ...scope, ...principal };
    });
  }

  /** Read an already committed private receipt. A missing receipt must never
   * claim a check, consume an attempt, accept an OTP or call the provider. */
  async recover(raw: unknown): Promise<CustomerVerificationResult> {
    return this.protect(async () => {
      const input = this.parse(recoverSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.intentScope(input);
      const selection = { ...scope, checkId: input.checkId };
      const result = await this.repository.resultIntent({ ...selection, sessionHash: null });
      if (!result || result.operationId !== input.operationId || result.checkId !== input.checkId) throw new CustomerIdentityError('unauthorized');
      if (!['closed', 'expired', 'failed'].includes(result.state) && result.expiresAt <= this.now()) throw new CustomerIdentityError('unauthorized');
      if (result.state !== 'approved') {
        await this.requireBrowser(this.binding(input));
        return CustomerAccountResponses.recover.parse(result);
      }
      if (input.checkId === null || typeof result.challengeId !== 'string'
        || !uuid.safeParse(result.challengeId).success || result.session !== null) throw new CustomerIdentityError('unauthorized');
      const accessToken = this.crypto.tokenForIntentCheck(input.tenantRef, input.browserSecret, input.operationId,
        input.intentProof, result.challengeId, input.checkId);
      // The metadata read grants no lasting authority. This second SQL read
      // repeats proof/generation/current-session checks using the derived hash.
      const confirmed = await this.repository.resultIntent({ ...selection,
        sessionHash: this.crypto.hash('session', input.tenantRef, accessToken) });
      if (!confirmed || confirmed.state !== 'approved' || !confirmed.session
        || confirmed.operationId !== input.operationId || confirmed.checkId !== input.checkId
        || confirmed.challengeId !== result.challengeId || confirmed.expiresAt !== result.expiresAt) throw new CustomerIdentityError('unauthorized');
      const view = await this.boundView(input, scope, confirmed.session);
      return CustomerAccountResponses.recover.parse({ state: 'approved', operationId: input.operationId,
        challengeId: confirmed.challengeId, checkId: input.checkId, expiresAt: confirmed.expiresAt,
        token: accessToken, view: { expiresAt: view.expiresAt, profile: view.profile } });
    });
  }

  async updateName(raw: unknown): Promise<CustomerSessionView> {
    return this.protect(async () => {
      const input = this.parse(updateSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.scope(input.tenantRef, this.configuration());
      const sessionHash = this.crypto.hash('session', input.tenantRef, input.token);
      const browserHash = this.crypto.hash('browser', input.tenantRef, input.browserSecret);
      const publication = { expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId };
      const session = await this.repository.authenticate({ ...scope, ...publication, browserRef: input.browserRef, sessionHash, browserHash, now: this.now() });
      if (!session) throw new CustomerIdentityError('unauthorized');
      const updated = await this.repository.updateName({ ...scope, ...publication, browserRef: input.browserRef, sessionHash, browserHash,
        expectedRevision: input.expectedRevision,
        encryptedName: input.name === null ? null
          : this.crypto.seal('name', input.tenantRef, session.profile.accountId, input.name),
        now: this.now(),
      });
      if (!updated) throw new CustomerIdentityError('conflict');
      return this.boundView(input, scope, updated);
    });
  }

  async logout(raw: unknown): Promise<void> {
    return this.protect(async () => {
      const input = this.parse(logoutSchema, raw);
      await this.requireBrowser(this.binding(input));
      const scope = this.scope(input.tenantRef, this.configuration());
      await this.repository.revoke({ ...scope, browserRef: input.browserRef,
        expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId,
        sessionHash: this.crypto.hash('session', input.tenantRef, input.token),
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret),
        all: input.all, now: this.now(),
      });
    });
  }

  private plan(config: CustomerIdentityConfiguration, tenantRef: string, phoneValue: string, now: number) {
    this.scope(tenantRef, config);
    const result = planCustomerPhoneVerification({ mode: config.mode, policy: config.policy, evidence: config.evidence,
      request: { tenantRef, phone: phoneValue }, now });
    if (result.kind !== 'reservation_required' || result.accountSid !== config.parentRef) {
      throw new CustomerIdentityError('unavailable');
    }
    return result;
  }

  private scope(tenantRef: string, config: CustomerIdentityConfiguration): CustomerScope {
    if (!CustomerVerificationModeSchema.safeParse(config.mode).success
      || config.environment !== 'staging' || !/^AC[0-9a-fA-F]{32}$/.test(config.parentRef)) {
      throw new CustomerIdentityError('unavailable');
    }
    return { tenantRef, parentRef: config.parentRef };
  }

  private challengeView(challenge: PendingChallenge) {
    if (challenge.expiresAt <= this.now()) throw new CustomerIdentityError('unavailable');
    return { challengeId: challenge.challengeId, expiresAt: challenge.expiresAt };
  }

  private assertFunding(scope: CustomerScope, pending: PendingChallenge, plan: ReservedCustomerVerificationPlan): void {
    if (plan.accountSid !== scope.parentRef || plan.tenantRef !== scope.tenantRef || pending.serviceSid !== plan.serviceSid) {
      throw new CustomerIdentityError('unavailable');
    }
    const funding = fundingSchema.safeParse(pending.funding);
    if (!funding.success) throw new CustomerIdentityError('unavailable');
    const paid = paidBudgetOf(plan);
    if (!paid) {
      if (funding.data.mode !== 'trial') throw new CustomerIdentityError('unavailable');
      return;
    }
    if (funding.data.mode !== 'paid' || funding.data.authorizationRef !== paid.authorizationRef
      || funding.data.currency !== paid.currency || funding.data.expiresAt <= this.now()
      || funding.data.reservedMicrousd < paid.reservePerSendMicrousd) {
      throw new CustomerIdentityError('unavailable');
    }
  }

  private assertChallenge(scope: CustomerScope, pending: PendingChallenge,
    phoneHash: string, serviceSid: string, challengeId?: string): void {
    if (!uuid.safeParse(pending.challengeId).success || pending.expiresAt <= this.now()
      || pending.phoneHash !== phoneHash || pending.serviceSid !== serviceSid
      || (challengeId !== undefined && pending.challengeId !== challengeId)) {
      throw new CustomerIdentityError('unavailable');
    }
    const clear = this.crypto.open('phone', scope.tenantRef, phoneHash, pending.encryptedPhone);
    if (!phone.safeParse(clear).success || this.crypto.hash('phone', scope.tenantRef, clear) !== phoneHash) {
      throw new CustomerIdentityError('unavailable');
    }
  }

  private view(scope: CustomerScope, session: CustomerSession): CustomerSessionView {
    if (session.expiresAt <= this.now()) throw new CustomerIdentityError('unauthorized');
    const p = session.profile;
    const phoneE164 = this.crypto.open('phone', scope.tenantRef, p.phoneHash, p.encryptedPhone);
    if (!phone.safeParse(phoneE164).success || this.crypto.hash('phone', scope.tenantRef, phoneE164) !== p.phoneHash) {
      throw new CustomerIdentityError('unavailable');
    }
    return { sessionId: session.sessionId, expiresAt: session.expiresAt,
      profile: { name: p.encryptedName === null ? null : this.crypto.open('name', scope.tenantRef, p.accountId, p.encryptedName),
        phoneE164, phoneVerifiedAt: p.phoneVerifiedAt, revision: p.revision } };
  }

  private parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new CustomerIdentityError('invalid_request');
    return parsed.data;
  }

  private async protect<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if (error instanceof CustomerIdentityError) throw error;
      if (error instanceof CustomerCredentialAccessError) throw new CustomerIdentityError('unauthorized');
      // Never attach cause, SQL parameters, raw provider body or an OTP.
      throw new CustomerIdentityError('unavailable');
    }
  }
}
