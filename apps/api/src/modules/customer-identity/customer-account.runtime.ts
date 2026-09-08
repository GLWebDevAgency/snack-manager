import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { CustomerIdentityCrypto, type CustomerIdentityRepository } from '@sm/customer';
import { CustomerAccountEnvelopes, CustomerAccountResponses, type CustomerAccountAction,
  type CustomerAccountEnvelope } from '@sm/contracts';
import { CustomerIdentityError, CustomerIdentityService, type CustomerSessionView } from './customer-identity.service';
import { customerAccessConfiguration, customerSendConfiguration, type CustomerAccessConfiguration } from './customer-account.config';
import { customerSafeError } from './customer-account.error';
import { CustomerAccountHumanVerifier } from './customer-account.human';
import type { CustomerRelay } from './customer-account.guard';
import type { PhoneVerificationTransport } from './phone-verification.port';
import { planTrialPhoneVerification } from './trial-verification-policy';

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
    @Inject(CUSTOMER_VERIFICATION_TRANSPORT_FACTORY) private readonly transportFactory: CustomerVerificationTransportFactory) {}

  async execute(relay: CustomerRelay, raw: unknown): Promise<unknown> {
    try {
      const access = this.access(relay); await this.tenant(access);
      const send = customerSendConfiguration(this.config, access);
      if (relay.action === 'status') {
        this.access(relay, access); return { available: send !== null };
      }
      const spends = relay.action === 'start' || relay.action === 'check';
      if (spends && !send) throw new CustomerIdentityError('unavailable');
      const transport = spends && send ? this.transportFactory(send.transport) : closedTransport;
      const beforeProvider = async (phone: string, serviceSid: string) => {
        // A PG lock wait must not preserve permission to spend for a tenant
        // suspended while waiting. Check again at the last controllable boundary.
        await this.tenant(access); this.access(relay, access);
        const current = customerSendConfiguration(this.config, access);
        // Freeze the whole evidence/segment/ceiling snapshot as well as keys.
        // A final Mongo wait cannot upgrade an old one-segment reservation.
        if (!send || !current || JSON.stringify(current) !== JSON.stringify(send)) {
          throw new CustomerIdentityError('unavailable');
        }
        const plan = planTrialPhoneVerification({ policy: current.policy, evidence: current.evidence,
          request: { tenantRef: access.tenantRef, phone }, now: Date.now() });
        if (plan.kind !== 'reservation_required' || plan.accountSid !== access.parentRef || plan.serviceSid !== serviceSid) {
          throw new CustomerIdentityError('unavailable');
        }
      };
      const core = new CustomerIdentityService(this.repository, new CustomerIdentityCrypto(access.identityKey),
        spends ? {
          start: async input => { await beforeProvider(input.phone, input.serviceSid); return transport.start(input); },
          check: async input => { await beforeProvider(input.phone, input.serviceSid); return transport.check(input); },
        } : closedTransport, () => {
          this.access(relay, access);
          const current = spends ? customerSendConfiguration(this.config, access) : null;
          if (spends && !current) throw new CustomerIdentityError('unavailable');
          if (send && current && (send.transport.apiKeySid !== current.transport.apiKeySid
            || send.transport.apiKeySecret !== current.transport.apiKeySecret)) throw new CustomerIdentityError('unavailable');
          return { environment: access.environment, parentRef: access.parentRef,
            policy: current?.policy ?? null, evidence: current?.evidence ?? null };
        });
      const tenantRef = access.tenantRef; let result: unknown;
      switch (relay.action) {
        case 'start': {
          const input = this.input('start', raw);
          const verified = await this.human.verify({ secret: send!.turnstileSecret, token: input.request.turnstileToken,
            origin: relay.origin, slug: relay.slug, operationId: input.request.operationId });
          if (!verified) throw new CustomerIdentityError('invalid_request');
          this.access(relay, access); await this.tenant(access);
          result = await core.start({ tenantRef, phone: input.request.phone, operationId: input.request.operationId,
            browserSecret: input.browserSecret, clientIp: `relay:${relay.client}`, humanVerified: true });
          break;
        }
        case 'check': {
          const input = this.input('check', raw);
          const checked = await core.check({ tenantRef, ...input.request, browserSecret: input.browserSecret,
            existingSessionToken: input.sessionToken });
          result = { token: checked.token, view: view(checked.view) }; break;
        }
        case 'recover': {
          const input = this.input('recover', raw);
          const recovered = await core.recover({ tenantRef, ...input.request, browserSecret: input.browserSecret });
          result = { token: recovered.token, view: view(recovered.view) }; break;
        }
        case 'session': {
          const input = this.input('session', raw);
          result = view(await core.session({ tenantRef, token: input.sessionToken })); break;
        }
        case 'name': {
          const input = this.input('name', raw);
          result = view(await core.updateName({ tenantRef, token: input.sessionToken, ...input.request })); break;
        }
        case 'logout': {
          const input = this.input('logout', raw);
          await core.logout({ tenantRef, token: input.sessionToken, ...input.request }); break;
        }
      }
      // Mongo lifecycle and PG are distinct stores. A request already in flight
      // may cross a revocation; no private response escapes a newly blocked tenant.
      this.access(relay, access); await this.tenant(access);
      return CustomerAccountResponses[relay.action].parse(result);
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
}
function view(value: CustomerSessionView) {
  return { expiresAt: value.expiresAt, profile: { name: value.profile.name, phoneE164: value.profile.phoneE164,
    phoneVerifiedAt: value.profile.phoneVerifiedAt, revision: value.profile.revision } };
}
