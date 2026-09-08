import { z } from 'zod';

export const CustomerAccountActionSchema = z.enum(['status', 'browser', 'intent', 'start', 'check', 'recover', 'session', 'name', 'logout']);
export type CustomerAccountAction = z.infer<typeof CustomerAccountActionSchema>;
export const CUSTOMER_ACCOUNT_TURNSTILE_ACTION = 'customer-account-start';
export const customerAccountTurnstileData = (slug: string, operationId: string) => `${slug}_${operationId}`;
export const CustomerAccountSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const CustomerAccountBrowserRefSchema = uuid;
export const CUSTOMER_ACCOUNT_BROWSER_REF_HEADER = 'x-sm-customer-browser-ref';
export const CUSTOMER_ACCOUNT_OPERATION_HEADER = 'x-sm-customer-operation-id';
export const CUSTOMER_ACCOUNT_CHECK_HEADER = 'x-sm-customer-check-id';
export const CustomerAccountPublicationSchema = z.strictObject({ expectedOperationId: uuid, expectedCheckId: uuid });
export type CustomerAccountPublication = z.infer<typeof CustomerAccountPublicationSchema>;
// 32 octets canonical base64url : les deux bits terminaux restent nuls.
const token = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const name = z.string().trim().min(1).max(120).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)).nullable();
const revision = z.number().int().min(0).max(2_147_483_646);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 604_800_000);
const empty = z.strictObject({});
export const CustomerBrowserPreparationSchema = z.strictObject({
  browserRef: uuid,
  state: z.enum(['prepared', 'issued', 'confirmed', 'expired']),
  admissionExpiresAt: timestamp,
  expiresAt: timestamp,
}).refine(value => value.admissionExpiresAt <= value.expiresAt);
export type CustomerBrowserPreparation = z.infer<typeof CustomerBrowserPreparationSchema>;
export const CustomerVerificationIntentSchema = z.strictObject({
  operationId: uuid, state: z.enum(['open', 'closed', 'consumed', 'expired']), expiresAt: timestamp,
});
export type CustomerVerificationIntent = z.infer<typeof CustomerVerificationIntentSchema>;

/** Browser DTOs never carry the HttpOnly identities or server attestations. */
export const CustomerAccountBrowserRequests = {
  status: empty,
  browser: z.discriminatedUnion('step', [
    z.strictObject({ step: z.enum(['prepare', 'issue', 'confirm']), browserRef: uuid }),
    // Explicit public-selector restoration, not session/account recovery.
    z.strictObject({ step: z.literal('restore') }),
  ]),
  intent: z.strictObject({ step: z.enum(['prepare', 'close']), operationId: uuid }),
  start: z.strictObject({ phone, operationId: uuid, turnstileToken: z.string().min(1).max(2048) }),
  check: z.strictObject({ operationId: uuid, challengeId: uuid, checkId: uuid, code: z.string().regex(/^\d{6}$/) }),
  recover: z.strictObject({ operationId: uuid, checkId: uuid.nullable() }),
  session: empty,
  name: z.strictObject({ name, expectedRevision: revision }),
  logout: z.strictObject({ all: z.boolean() }),
} as const;

/** Server-to-server only; the relay signature authenticates the entire envelope. */
export const CustomerAccountEnvelopes = {
  status: z.strictObject({ request: CustomerAccountBrowserRequests.status }),
  browser: z.strictObject({ request: CustomerAccountBrowserRequests.browser,
    browserSecret: token.nullable(), candidateSecret: token.nullable() }).refine(value =>
    value.request.step === 'prepare' ? value.browserSecret === null && value.candidateSecret === null
      : value.request.step === 'issue' ? value.candidateSecret !== null
        : value.browserSecret !== null && value.candidateSecret === null),
  intent: z.strictObject({ browserRef: uuid, browserSecret: token, candidateProof: token.nullable(),
    request: CustomerAccountBrowserRequests.intent }).refine(value =>
    value.request.step === 'prepare' ? value.candidateProof !== null : value.candidateProof === null),
  start: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, request: CustomerAccountBrowserRequests.start }),
  check: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, sessionToken: token.nullable(), request: CustomerAccountBrowserRequests.check }),
  recover: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, request: CustomerAccountBrowserRequests.recover }),
  session: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.session }),
  name: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.name }),
  logout: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.logout }),
} as const;
export type CustomerAccountEnvelope<A extends CustomerAccountAction> = z.infer<(typeof CustomerAccountEnvelopes)[A]>;
export const CustomerAccountViewSchema = z.strictObject({
  expiresAt: timestamp,
  profile: z.strictObject({ name, phoneE164: phone, phoneVerifiedAt: timestamp, revision }),
});
export type CustomerAccountView = z.infer<typeof CustomerAccountViewSchema>;
const verificationResultIdentity = { operationId: uuid, expiresAt: timestamp };
const verificationResultSelection = { challengeId: uuid.nullable(), checkId: uuid.nullable() };
/** Only approved carries a private projection, and only through the BFF.
 * Unresolved is never evidence that a delayed write cannot still be admitted. */
const verificationPendingResults = [
  z.strictObject({ state: z.literal('unresolved'), ...verificationResultIdentity, ...verificationResultSelection }),
  z.strictObject({ state: z.literal('code_required'), ...verificationResultIdentity, challengeId: uuid, checkId: z.null() }),
  z.strictObject({ state: z.literal('incorrect'), ...verificationResultIdentity, challengeId: uuid, checkId: uuid }),
  z.strictObject({ state: z.enum(['closed', 'expired', 'failed']), ...verificationResultIdentity, ...verificationResultSelection }),
 ] as const;
export const CustomerVerificationResultSchema = z.discriminatedUnion('state', [
  ...verificationPendingResults,
  z.strictObject({ state: z.literal('approved'), ...verificationResultIdentity,
    challengeId: uuid, checkId: uuid, token, view: CustomerAccountViewSchema }),
]);
export type CustomerVerificationResult = z.infer<typeof CustomerVerificationResultSchema>;
export const CustomerVerificationPublicResultSchema = z.discriminatedUnion('state', [
  ...verificationPendingResults,
  z.strictObject({ state: z.literal('approved'), ...verificationResultIdentity,
    challengeId: uuid, checkId: uuid, view: CustomerAccountViewSchema }),
]);
export type CustomerVerificationPublicResult = z.infer<typeof CustomerVerificationPublicResultSchema>;
export const CustomerAccountResponses = {
  status: z.strictObject({ available: z.boolean() }),
  browser: z.strictObject({ preparation: CustomerBrowserPreparationSchema, emitCookie: z.boolean() })
    .refine(value => !value.emitCookie || value.preparation.state === 'issued'),
  intent: z.strictObject({ intent: CustomerVerificationIntentSchema, emitCookie: z.boolean() })
    .refine(value => !value.emitCookie || value.intent.state === 'open'),
  start: z.strictObject({ challengeId: uuid, expiresAt: timestamp }),
  check: z.strictObject({ token, view: CustomerAccountViewSchema }),
  recover: CustomerVerificationResultSchema,
  session: CustomerAccountViewSchema,
  name: CustomerAccountViewSchema,
  logout: z.undefined(),
} as const;
export const CustomerAccountErrorSchema = z.strictObject({
  code: z.enum(['CUSTOMER_UNAVAILABLE', 'CUSTOMER_INVALID_REQUEST', 'CUSTOMER_UNAUTHORIZED',
    'CUSTOMER_CONFLICT', 'CUSTOMER_RATE_LIMITED', 'CUSTOMER_RELAY_REFUSED']),
  message: z.string().max(200),
});
