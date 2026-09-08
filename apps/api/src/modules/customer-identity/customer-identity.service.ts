import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CustomerIdentityCrypto,
  type CustomerIdentityRepository, type CustomerScope, type CustomerSession,
  type PendingChallenge, type CheckResult,
} from '@sm/customer';
import type { PhoneVerificationTransport } from './phone-verification.port';
import { costEvidenceReferenceOf, CustomerVerificationModeSchema, paidBudgetOf, planCustomerPhoneVerification,
  type CustomerVerificationMode, type ReservedCustomerVerificationPlan } from './verification-plan';

const tenant = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(value => Buffer.from(value, 'base64url').toString('base64url') === value);
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const startSchema = z.strictObject({
  tenantRef: tenant, phone, operationId: uuid, browserSecret: token,
  clientIp: z.string().min(1).max(160), humanVerified: z.literal(true),
});
const checkSchema = z.strictObject({
  tenantRef: tenant, challengeId: uuid, checkId: uuid, code: z.string().regex(/^\d{6}$/),
  browserSecret: token, existingSessionToken: token.nullable(),
});
const recoverSchema = checkSchema.omit({ code: true, existingSessionToken: true });
const sessionSchema = z.strictObject({ tenantRef: tenant, token, browserSecret: token });
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
  constructor(readonly reason: 'unavailable' | 'invalid_request' | 'unauthorized' | 'conflict') {
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
  ) {}

  async start(raw: unknown): Promise<{ challengeId: string; expiresAt: number }> {
    return this.protect(async () => {
      const input = this.parse(startSchema, raw);
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
        ...scope, operationId: input.operationId, challengeId: randomUUID(),
        requestHash: this.crypto.hash('request', input.tenantRef,
          JSON.stringify([input.operationId, phoneHash, browserHash])),
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
        this.assertChallenge(scope, reserved.challenge, phoneHash, plan.serviceSid);
        this.assertFunding(scope, reserved.challenge, this.plan(this.configuration(), input.tenantRef, input.phone, this.now()));
        return this.challengeView(reserved.challenge);
      }
      if (reserved.kind !== 'reserved') throw new CustomerIdentityError('unavailable');

      let sid: string;
      try {
        await this.beforeProvider();
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
      this.assertChallenge(scope, pending, phoneHash, plan.serviceSid, reserved.challengeId);
      this.assertFunding(scope, pending, this.plan(this.configuration(), input.tenantRef, input.phone, this.now()));
      return this.challengeView(pending);
    });
  }

  async check(raw: unknown): Promise<{ token: string; view: CustomerSessionView }> {
    return this.protect(async () => {
      const input = this.parse(checkSchema, raw);
      const config = this.configuration();
      const scope = this.scope(input.tenantRef, config);
      const accessToken = this.crypto.tokenForCheck(input.tenantRef, input.browserSecret, input.challengeId, input.checkId);
      const sessionHash = this.crypto.hash('session', input.tenantRef, accessToken);
      const claim = { ...scope, challengeId: input.challengeId, checkId: input.checkId,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret), now: this.now() };
      // This private receipt is valid only for the original consumed challenge,
      // exact browser/check and STILL-LIVE session. No new TTL or provider call.
      const recovered = await this.repository.recoverCheck({ ...claim, sessionHash });
      if (recovered) return { token: accessToken, view: this.view(scope, recovered) };
      const pending = await this.repository.claimCheck(claim);
      if (!pending) throw new CustomerIdentityError('unauthorized');

      let result: CheckResult = 'uncertain';
      try {
        this.assertChallenge(scope, pending, pending.phoneHash, pending.serviceSid, input.challengeId);
        const verifiedPhone = this.crypto.open('phone', input.tenantRef, pending.phoneHash, pending.encryptedPhone);
        await this.beforeProvider();
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
        sessionId: randomUUID(), sessionHash, sessionExpiresAt: now + SESSION_TTL_MS,
        accountId: randomUUID(), existingSessionHash: input.existingSessionToken === null ? null
          : this.crypto.hash('session', input.tenantRef, input.existingSessionToken),
      });
      if (result === 'uncertain') throw new CustomerIdentityError('unavailable');
      if (result !== 'approved' || !completed) throw new CustomerIdentityError('unauthorized');
      return { token: accessToken, view: this.view(scope, completed) };
    });
  }

  async session(raw: unknown): Promise<CustomerSessionView> {
    return this.protect(async () => {
      const input = this.parse(sessionSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      const session = await this.repository.authenticate({ ...scope,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret),
        sessionHash: this.crypto.hash('session', input.tenantRef, input.token), now: this.now() });
      if (!session) throw new CustomerIdentityError('unauthorized');
      return this.view(scope, session);
    });
  }

  /** Read an already committed private receipt. A missing receipt must never
   * claim a check, consume an attempt, accept an OTP or call the provider. */
  async recover(raw: unknown): Promise<{ token: string; view: CustomerSessionView }> {
    return this.protect(async () => {
      const input = this.parse(recoverSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      const accessToken = this.crypto.tokenForCheck(input.tenantRef, input.browserSecret, input.challengeId, input.checkId);
      const session = await this.repository.recoverCheck({ ...scope,
        challengeId: input.challengeId, checkId: input.checkId,
        browserHash: this.crypto.hash('browser', input.tenantRef, input.browserSecret),
        sessionHash: this.crypto.hash('session', input.tenantRef, accessToken), now: this.now(),
      });
      if (!session) throw new CustomerIdentityError('unauthorized');
      return { token: accessToken, view: this.view(scope, session) };
    });
  }

  async updateName(raw: unknown): Promise<CustomerSessionView> {
    return this.protect(async () => {
      const input = this.parse(updateSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      const sessionHash = this.crypto.hash('session', input.tenantRef, input.token);
      const browserHash = this.crypto.hash('browser', input.tenantRef, input.browserSecret);
      const session = await this.repository.authenticate({ ...scope, sessionHash, browserHash, now: this.now() });
      if (!session) throw new CustomerIdentityError('unauthorized');
      const updated = await this.repository.updateName({ ...scope, sessionHash, browserHash,
        expectedRevision: input.expectedRevision,
        encryptedName: input.name === null ? null
          : this.crypto.seal('name', input.tenantRef, session.profile.accountId, input.name),
        now: this.now(),
      });
      if (!updated) throw new CustomerIdentityError('conflict');
      return this.view(scope, updated);
    });
  }

  async logout(raw: unknown): Promise<void> {
    return this.protect(async () => {
      const input = this.parse(logoutSchema, raw);
      const scope = this.scope(input.tenantRef, this.configuration());
      await this.repository.revoke({ ...scope,
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
      // Never attach cause, SQL parameters, raw provider body or an OTP.
      throw new CustomerIdentityError('unavailable');
    }
  }
}
