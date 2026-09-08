import { z } from 'zod';

export const CustomerAccountActionSchema = z.enum(['status', 'start', 'check', 'recover', 'session', 'name', 'logout']);
export type CustomerAccountAction = z.infer<typeof CustomerAccountActionSchema>;
export const CUSTOMER_ACCOUNT_TURNSTILE_ACTION = 'customer-account-start';
export const customerAccountTurnstileData = (slug: string, operationId: string) => `${slug}_${operationId}`;
export const CustomerAccountSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
// 32 octets canonical base64url : les deux bits terminaux restent nuls.
const token = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const name = z.string().trim().min(1).max(120).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).nullable();
const revision = z.number().int().min(0).max(2_147_483_646);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 604_800_000);
const empty = z.strictObject({});

/** Browser DTOs never carry the HttpOnly identities or server attestations. */
export const CustomerAccountBrowserRequests = {
  status: empty,
  start: z.strictObject({ phone, operationId: uuid, turnstileToken: z.string().min(1).max(2048) }),
  check: z.strictObject({ challengeId: uuid, checkId: uuid, code: z.string().regex(/^\d{6}$/) }),
  recover: z.strictObject({ challengeId: uuid, checkId: uuid }),
  session: empty,
  name: z.strictObject({ name, expectedRevision: revision }),
  logout: z.strictObject({ all: z.boolean() }),
} as const;

/** Server-to-server only; the relay signature authenticates the entire envelope. */
export const CustomerAccountEnvelopes = {
  status: z.strictObject({ request: CustomerAccountBrowserRequests.status }),
  start: z.strictObject({ browserSecret: token, request: CustomerAccountBrowserRequests.start }),
  check: z.strictObject({ browserSecret: token, sessionToken: token.nullable(), request: CustomerAccountBrowserRequests.check }),
  recover: z.strictObject({ browserSecret: token, request: CustomerAccountBrowserRequests.recover }),
  session: z.strictObject({ sessionToken: token, request: CustomerAccountBrowserRequests.session }),
  name: z.strictObject({ sessionToken: token, request: CustomerAccountBrowserRequests.name }),
  logout: z.strictObject({ sessionToken: token, request: CustomerAccountBrowserRequests.logout }),
} as const;
export type CustomerAccountEnvelope<A extends CustomerAccountAction> = z.infer<(typeof CustomerAccountEnvelopes)[A]>;
export const CustomerAccountViewSchema = z.strictObject({
  expiresAt: timestamp,
  profile: z.strictObject({ name, phoneE164: phone, phoneVerifiedAt: timestamp, revision }),
});
export type CustomerAccountView = z.infer<typeof CustomerAccountViewSchema>;
export const CustomerAccountResponses = {
  status: z.strictObject({ available: z.boolean() }),
  start: z.strictObject({ challengeId: uuid, expiresAt: timestamp }),
  check: z.strictObject({ token, view: CustomerAccountViewSchema }),
  recover: z.strictObject({ token, view: CustomerAccountViewSchema }),
  session: CustomerAccountViewSchema,
  name: CustomerAccountViewSchema,
  logout: z.undefined(),
} as const;
export const CustomerAccountErrorSchema = z.strictObject({
  code: z.enum(['CUSTOMER_UNAVAILABLE', 'CUSTOMER_INVALID_REQUEST', 'CUSTOMER_UNAUTHORIZED',
    'CUSTOMER_CONFLICT', 'CUSTOMER_RATE_LIMITED', 'CUSTOMER_RELAY_REFUSED']),
  message: z.string().max(200),
});
