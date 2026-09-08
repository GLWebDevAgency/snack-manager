import { z } from 'zod';
import { CustomerAccountSlugSchema } from '@sm/contracts';
import { CustomerVerificationModeSchema, planCustomerPhoneVerification, type CustomerVerificationMode } from './verification-plan';

export type CustomerConfigReader = { get(key: string): unknown };
const key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(value => Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const secret = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
const origin = z.string().max(200).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; }
  catch { return false; }
});
export type CustomerAccessConfiguration = {
  environment: 'staging'; parentRef: string; tenantRef: string; slug: string;
  mode: CustomerVerificationMode;
  origins: string[]; identityKey: string; relayKey: string;
};
/** No provider account, key or pilot default. Native Railway identity must
 * match a separately pinned operator target; a policy saying staging is not evidence. */
export function customerAccessConfiguration(config: CustomerConfigReader): CustomerAccessConfiguration | null {
  try {
    const mode = CustomerVerificationModeSchema.parse(config.get('SM_CUSTOMER_ACCOUNT_MODE'));
    if (config.get('RAILWAY_ENVIRONMENT_NAME') !== 'staging'
      || (config.get('SM_ENV') !== undefined && config.get('SM_ENV') !== 'staging')) return null;
    for (const part of ['ENVIRONMENT', 'PROJECT']) {
      const actual = uuid.parse(config.get(`RAILWAY_${part}_ID`));
      if (actual !== config.get(`SM_CUSTOMER_PILOT_${part}_ID`)) return null;
    }
    const identityKey = key.parse(config.get('SM_CUSTOMER_IDENTITY_KEY'));
    const relayKey = key.parse(config.get('SM_CUSTOMER_RELAY_SIGNING_KEY'));
    if (identityKey === relayKey) return null;
    const slugs = z.array(CustomerAccountSlugSchema).length(1).parse(json(config, 'SM_CUSTOMER_PILOT_SLUGS'));
    const origins = z.array(origin).min(1).max(5).parse(json(config, 'SM_CUSTOMER_PILOT_ORIGINS'));
    if (new Set(origins).size !== origins.length) return null;
    return { mode, environment: 'staging', identityKey, relayKey, slug: slugs[0]!, origins,
      tenantRef: z.string().regex(/^[0-9a-f]{24}$/).parse(config.get('SM_CUSTOMER_PILOT_TENANT_ID')),
      parentRef: z.string().regex(/^AC[0-9a-fA-F]{32}$/).parse(config.get('SM_CUSTOMER_VERIFY_ACCOUNT_SID')) };
  } catch { return null; }
}

/** Spending readiness is separate from existing-session access. Fresh credit
 * is always recalculated by the core immediately before the provider call. */
export function customerSendConfiguration(config: CustomerConfigReader, access: CustomerAccessConfiguration, now = Date.now()) {
  try {
    const policy = json(config, 'SM_CUSTOMER_VERIFY_POLICY');
    const evidence = json(config, 'SM_CUSTOMER_VERIFY_EVIDENCE');
    const candidate = z.object({ allowedPhones: z.array(z.string()).min(1) }).parse(policy).allowedPhones[0]!;
    if (config.get('SM_CUSTOMER_ACCOUNT_MODE') !== access.mode) return null;
    const plan = planCustomerPhoneVerification({ mode: access.mode, policy, evidence,
      request: { tenantRef: access.tenantRef, phone: candidate }, now });
    if (plan.kind !== 'reservation_required' || plan.accountSid !== access.parentRef) return null;
    const turnstileSecret = secret.parse(config.get('SM_CUSTOMER_TURNSTILE_SECRET_KEY'));
    // Official always-pass/always-fail testing keys are never a runtime proof.
    if (/^[123]x0000000000000000000000000000000[A-Z]{2}$/.test(turnstileSecret)) return null;
    return { policy, evidence, turnstileSecret,
      transport: { accountSid: access.parentRef,
        apiKeySid: z.string().regex(/^SK[0-9a-fA-F]{32}$/).parse(config.get('SM_CUSTOMER_VERIFY_API_KEY_SID')),
        apiKeySecret: secret.parse(config.get('SM_CUSTOMER_VERIFY_API_KEY_SECRET')) } };
  } catch { return null; }
}
function json(config: CustomerConfigReader, name: string): unknown {
  const value = config.get(name);
  if (typeof value !== 'string' || Buffer.byteLength(value) > 8192) throw new Error('Configuration indisponible');
  return JSON.parse(value) as unknown;
}
