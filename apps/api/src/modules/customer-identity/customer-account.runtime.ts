import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { CustomerIdentityCrypto, type CustomerIdentityRepository } from '@sm/customer';
import { aLaCapacite, publicLoyaltyAvailable, CustomerAccountEnvelopes, CustomerAccountResponses, customerAccountResponseLimit, type CustomerAccountAction,
  type CustomerAccountEnvelope } from '@sm/contracts';
import { CustomerIdentityError, CustomerIdentityService, type CustomerSessionView } from './customer-identity.service';
import { customerAccessConfiguration, customerSendConfiguration, type CustomerAccessConfiguration } from './customer-account.config';
import { customerSafeError } from './customer-account.error';
import { CustomerAccountHumanVerifier } from './customer-account.human';
import type { CustomerRelay } from './customer-account.guard';
import type { PhoneVerificationTransport } from './phone-verification.port';
import { OnlineOrderCheckoutService } from '../orders/online-order-checkout.service';
import { customerCommerce } from './customer-commerce';
import { CustomerLoyaltyService } from './customer-loyalty.service';

export const CUSTOMER_IDENTITY_REPOSITORY = Symbol('CUSTOMER_IDENTITY_REPOSITORY');
export const CUSTOMER_VERIFICATION_TRANSPORT_FACTORY = Symbol('CUSTOMER_VERIFICATION_TRANSPORT_FACTORY');
export type CustomerVerificationTransportFactory = (config: { accountSid: string; apiKeySid: string; apiKeySecret: string }) => PhoneVerificationTransport;
const closedTransport: PhoneVerificationTransport = {
  start: async () => { throw new CustomerIdentityError('unavailable'); },
  check: async () => { throw new CustomerIdentityError('unavailable'); },
};

@Injectable()
export class CustomerAccountRuntime {
  constructor(@Inject(ConfigService) private readonly config: ConfigService,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @Inject(CUSTOMER_IDENTITY_REPOSITORY) private readonly repository: CustomerIdentityRepository,
    @Inject(CustomerAccountHumanVerifier) private readonly human: CustomerAccountHumanVerifier,
    @Inject(CUSTOMER_VERIFICATION_TRANSPORT_FACTORY) private readonly transportFactory: CustomerVerificationTransportFactory,
    @Optional() @Inject(OnlineOrderCheckoutService) private readonly checkout?: OnlineOrderCheckoutService,
    @Optional() @Inject(CustomerLoyaltyService) private readonly loyalty?: CustomerLoyaltyService) {}

  async execute(relay: CustomerRelay, raw: unknown): Promise<unknown> {
    try {
      const access = this.access(relay); await this.tenant(access);
      const send = customerSendConfiguration(this.config, access);
      if (relay.action === 'status') {
        this.access(relay, access); return { available: send !== null, registrationAvailable: true, accessAvailable: true };
      }
      const spends = relay.action === 'start' || relay.action === 'check';
      if (spends && !send) throw new CustomerIdentityError('unavailable');
      const transport = spends && send ? this.transportFactory(send.transport) : closedTransport;
      const beforeProvider = async () => {
        // A PG lock wait must not preserve permission to spend for a tenant
        // suspended while waiting. Check again at the last controllable boundary.
        await this.tenant(access); this.access(relay, access);
        // The core revalidates its plan and immutable funding synchronously
        // after this await, immediately before the provider. A check may use a
        // fresh cost attestation only when its original reservation covers it.
      };
      const core = new CustomerIdentityService(this.repository, new CustomerIdentityCrypto(access.identityKey),
        transport, () => {
          this.access(relay, access);
          const current = spends ? customerSendConfiguration(this.config, access) : null;
          if (spends && !current) throw new CustomerIdentityError('unavailable');
          if (send && current && (send.transport.apiKeySid !== current.transport.apiKeySid
            || send.transport.apiKeySecret !== current.transport.apiKeySecret
            || send.turnstileSecret !== current.turnstileSecret)) throw new CustomerIdentityError('unavailable');
          return { mode: access.mode, environment: access.environment, parentRef: access.parentRef,
            policy: current?.policy ?? null, evidence: current?.evidence ?? null };
        }, Date.now, beforeProvider);
      const tenantRef = access.tenantRef; let result: unknown;
      let commerceFence: (() => Promise<unknown>) | undefined;
      let binding: { tenantRef: string; browserRef: string; browserSecret: string } | undefined;
      if (relay.action !== 'browser') {
        const input = this.input(relay.action, raw);
        binding = { tenantRef, browserRef: input.browserRef, browserSecret: input.browserSecret };
        // No Turnstile call, let alone Verify, before the selected preparation
        // and the actual HttpOnly cookie have been confirmed by PostgreSQL.
        await core.requireBrowser(binding);
      }
      switch (relay.action) {
        case 'browser': {
          result = await core.browser({ tenantRef, ...this.input('browser', raw) }); break;
        }
        case 'intent': {
          result = await core.intent({ tenantRef, ...this.input('intent', raw) }); break;
        }
        case 'start': {
          const input = this.input('start', raw);
          await core.requireIntent({ ...binding!, operationId: input.request.operationId, intentProof: input.intentProof });
          const verified = await this.human.verify({ secret: send!.turnstileSecret, token: input.request.turnstileToken,
            origin: relay.origin, slug: relay.slug, operationId: input.request.operationId });
          if (!verified) throw new CustomerIdentityError('invalid_request');
          this.access(relay, access); await this.tenant(access);
          result = await core.start({ ...binding!, intentProof: input.intentProof, phone: input.request.phone, operationId: input.request.operationId,
            clientIp: `relay:${relay.client}`, humanVerified: true });
          break;
        }
        case 'check': {
          const input = this.input('check', raw);
          const checked = await core.check({ ...binding!, ...input.request, intentProof: input.intentProof,
            existingSessionToken: input.sessionToken });
          result = checked; break;
        }
        case 'recover': {
          const input = this.input('recover', raw);
          result = await core.recover({ ...binding!, ...input.request, intentProof: input.intentProof }); break;
        }
        case 'protection': {
          result = await core.protection({ tenantRef, ...this.input('protection', raw), origin: relay.origin }); break;
        }
        case 'passkey': {
          result = await core.passkey({ tenantRef, ...this.input('passkey', raw), origin: relay.origin, clientIp: `relay:${relay.client}` }); break;
        }
        case 'recovery': {
          result = await core.recovery({ tenantRef, ...this.input('recovery', raw), origin: relay.origin, clientIp: `relay:${relay.client}` }); break;
        }
        case 'session': {
          const input = this.input('session', raw);
          result = view(await core.session({ ...binding!, token: input.sessionToken,
            expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId })); break;
        }
        case 'order-create': case 'orders': case 'order-detail': case 'order-reorder': {
          if (!this.checkout) throw new CustomerIdentityError('unavailable');
          const input = this.input(relay.action, raw);
          const authorize = async () => {
            this.access(relay, access); await this.tenant(access);
            return core.commercePrincipal({ ...binding!, token: input.sessionToken,
              expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId });
          };
          const command = relay.action === 'order-create' ? { action: relay.action, request: this.input('order-create', raw).request }
            : relay.action === 'orders' ? { action: relay.action, request: this.input('orders', raw).request }
              : relay.action === 'order-detail' ? { action: relay.action, request: this.input('order-detail', raw).request }
                : { action: relay.action, request: this.input('order-reorder', raw).request };
          result = await customerCommerce({ checkout: this.checkout, authorize, slug: relay.slug, client: relay.client, now: Date.now,
            publicationFence: recheck => { commerceFence = recheck; } }, command);
          break;
        }
        case 'loyalty': {
          if (!this.loyalty) throw new CustomerIdentityError('unavailable');
          const input = this.input('loyalty', raw);
          const identity = new CustomerIdentityCrypto(access.identityKey);
          result = await this.loyalty.execute({ request: input.request, identity,
            selection: { parentRef: access.parentRef, tenantRef, browserRef: input.browserRef,
              browserHash: identity.hash('browser', tenantRef, input.browserSecret),
              sessionHash: identity.hash('session', tenantRef, input.sessionToken),
              expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId, now: Date.now() },
            enabled: async () => { this.access(relay, access); return this.loyaltyTenant(access); },
            publicationFence: recheck => { commerceFence = recheck; },
          });
          break;
        }
        case 'name': {
          const input = this.input('name', raw);
          result = view(await core.updateName({ ...binding!, token: input.sessionToken, ...input.request,
            expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId })); break;
        }
        case 'logout': {
          const input = this.input('logout', raw);
          await core.logout({ ...binding!, token: input.sessionToken, ...input.request,
            expectedOperationId: input.expectedOperationId, expectedCheckId: input.expectedCheckId }); break;
        }
      }
      // Mongo lifecycle and PG are distinct stores. A request already in flight
      // may cross a revocation; no private response escapes a newly blocked tenant.
      this.access(relay, access); await this.tenant(access);
      if (binding) await core.requireBrowser(binding);
      // Final protected-session sample after every unrelated async wait. This
      // fences delayed private responses; it is not a PG/Mongo transaction.
      if (commerceFence) await commerceFence();
      if (relay.action === 'recover') {
        const verification = CustomerAccountResponses.recover.parse(result);
        if (verification.state === 'approved' && (verification.view.expiresAt <= Date.now() || verification.expiresAt <= Date.now())) {
          throw new CustomerIdentityError('unauthorized');
        }
        if (verification.state === 'enrollment' && (verification.enrollment.expiresAt <= Date.now()
          || verification.expiresAt <= Date.now())) throw new CustomerIdentityError('unauthorized');
        return verification;
      }
      const response = CustomerAccountResponses[relay.action].parse(result);
      if (response !== undefined && Buffer.byteLength(JSON.stringify(response)) > customerAccountResponseLimit(relay.action)) {
        throw new CustomerIdentityError('unavailable');
      }
      if (relay.action === 'browser' && this.input('browser', raw).request.step === 'restore') {
        const restored = CustomerAccountResponses.browser.parse(response);
        if (restored.preparation.state !== 'confirmed' || restored.emitCookie || restored.preparation.expiresAt <= Date.now()) {
          throw new CustomerIdentityError('unauthorized');
        }
      }
      if (response && relay.action !== 'browser' && relay.action !== 'intent') {
        const expiresAt = 'view' in response ? response.view.expiresAt
          : 'enrollment' in response ? response.enrollment.expiresAt
          : 'recovery' in response ? response.recovery.expiresAt
          : 'expiresAt' in response ? response.expiresAt : null;
        if (expiresAt !== null && expiresAt <= Date.now()) throw new CustomerIdentityError('unauthorized');
      }
      return response;
    } catch (error) { throw customerSafeError(error); }
  }

  private input<A extends CustomerAccountAction>(action: A, raw: unknown): CustomerAccountEnvelope<A> {
    const input = CustomerAccountEnvelopes[action].safeParse(raw);
    if (!input.success) throw new CustomerIdentityError('invalid_request');
    return input.data as CustomerAccountEnvelope<A>;
  }
  private access(relay: CustomerRelay, previous?: CustomerAccessConfiguration): CustomerAccessConfiguration {
    const value = customerAccessConfiguration(this.config);
    if (!value || value.slug !== relay.slug || !value.origins.includes(relay.origin)
      || (previous && JSON.stringify(value) !== JSON.stringify(previous))) throw new CustomerIdentityError('unavailable');
    return value;
  }
  private async tenant(access: CustomerAccessConfiguration): Promise<void> {
    const row = await this.tenants.findOne({ _id: access.tenantRef, slug: access.slug,
      'account.status': { $in: ['trial', 'active'] } }, { _id: 1, slug: 1, 'account.status': 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean().exec();
    if (!row || String(row._id) !== access.tenantRef || row.slug !== access.slug
      || !['trial', 'active'].includes(row.account?.status ?? '')) throw new CustomerIdentityError('unavailable');
  }
  private async loyaltyTenant(access: CustomerAccessConfiguration): Promise<boolean> {
    const row = await this.tenants.findOne({ _id: access.tenantRef, slug: access.slug },
      { _id: 1, slug: 1, account: 1, plan: 1, onlineOrdering: 1, onlineDelivery: 1, standaloneLoyalty: 1, derogationsCapacite: 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean().exec();
    return !!row && String(row._id) === access.tenantRef && row.slug === access.slug
      && ['trial', 'active'].includes(row.account?.status ?? '')
      && publicLoyaltyAvailable(row.account, aLaCapacite(row, 'loyalty'));
  }
}
function view(value: CustomerSessionView) {
  return { expiresAt: value.expiresAt, profile: { name: value.profile.name, phoneE164: value.profile.phoneE164,
    phoneVerifiedAt: value.profile.phoneVerifiedAt, revision: value.profile.revision } };
}
