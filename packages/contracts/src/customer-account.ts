import { z } from 'zod';
import { CustomerCreateOrderRequestSchema, CustomerOrdersQuerySchema, CustomerOrderDetailRequestSchema,
  CustomerOrderCreateResponseSchema, CustomerOrdersPageSchema, CustomerOrderDetailResponseSchema,
  CustomerOrderReorderRequestSchema, CustomerOrderReorderResponseSchema } from './customer-orders';

export const CustomerAccountActionSchema = z.enum(['status', 'browser', 'intent', 'start', 'check', 'recover', 'protection', 'passkey', 'recovery', 'session', 'name', 'logout', 'order-create', 'orders', 'order-detail', 'order-reorder']);
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

export const CustomerEnrollmentSchema = z.strictObject({
  operationId: uuid, checkId: uuid, expiresAt: timestamp,
  stage: z.enum(['registration_required', 'assertion_required', 'recovery_required']),
  recoveryVersion: z.number().int().min(0).max(3),
});
export type CustomerEnrollment = z.infer<typeof CustomerEnrollmentSchema>;
// Transport bounds only. The server verifier additionally checks canonical bytes,
// signed origins, flags and signatures; a DTO never authorizes a credential.
const bytes = (max: number) => z.string().min(1).max(Math.ceil(max * 4 / 3)).regex(/^[A-Za-z0-9_-]+$/);
const transports = z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(7);
const credential = { id: bytes(1024), rawId: bytes(1024), type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.strictObject({ credProps: z.strictObject({ rk: z.boolean().optional() }).optional() }) };
export const CustomerPasskeyRegistrationSchema = z.strictObject({ ...credential, response: z.strictObject({
  clientDataJSON: bytes(4096), attestationObject: bytes(16_384), transports: transports.optional(),
  authenticatorData: bytes(4096).optional(), publicKey: bytes(4096).optional(), publicKeyAlgorithm: z.number().int().optional(),
}) });
export const CustomerPasskeyAssertionSchema = z.strictObject({ ...credential, response: z.strictObject({
  clientDataJSON: bytes(4096), authenticatorData: bytes(4096), signature: bytes(4096), userHandle: token.optional(),
}) });
const descriptor = z.strictObject({ id: bytes(1024), type: z.literal('public-key'), transports: transports.optional() });
export const CustomerPasskeyRegistrationOptionsSchema = z.strictObject({
  challenge: token, rp: z.strictObject({ id: z.string().min(1).max(253), name: z.string().min(1).max(120) }),
  user: z.strictObject({ id: token, name: z.string().min(1).max(120), displayName: z.string().min(1).max(120) }),
  pubKeyCredParams: z.array(z.strictObject({ type: z.literal('public-key'), alg: z.union([z.literal(-7), z.literal(-257), z.literal(-8)]) })).min(1).max(3),
  timeout: z.literal(60_000), attestation: z.literal('none'), excludeCredentials: z.array(descriptor).max(20),
  authenticatorSelection: z.strictObject({ residentKey: z.literal('required'), requireResidentKey: z.literal(true), userVerification: z.literal('required') }),
  extensions: z.strictObject({ credProps: z.literal(true) }),
});
export const CustomerPasskeyAssertionOptionsSchema = z.strictObject({
  challenge: token, rpId: z.string().min(1).max(253), timeout: z.literal(60_000),
  userVerification: z.literal('required'), allowCredentials: z.array(descriptor).max(20),
});
const enrollmentBinding = { operationId: uuid, checkId: uuid };
// Normalization is applied by the private crypto primitive, never by transport.
const recoveryInput = z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/);
export const CustomerProtectionRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('state'), ...enrollmentBinding }),
  z.strictObject({ step: z.literal('registration-options'), ...enrollmentBinding, registrationId: uuid }),
  z.strictObject({ step: z.literal('register'), ...enrollmentBinding, registrationId: uuid, response: CustomerPasskeyRegistrationSchema }),
  z.strictObject({ step: z.literal('assertion-options'), ...enrollmentBinding, assertionId: uuid }),
  z.strictObject({ step: z.literal('assert'), ...enrollmentBinding, assertionId: uuid, response: CustomerPasskeyAssertionSchema }),
  z.strictObject({ step: z.literal('recovery-code'), ...enrollmentBinding, rotationId: uuid, expectedVersion: z.number().int().min(0).max(2) }),
  z.strictObject({ step: z.literal('activate'), ...enrollmentBinding, activationId: uuid, recoveryVersion: z.number().int().min(1).max(3), code: recoveryInput }),
  z.strictObject({ step: z.literal('activation-result'), ...enrollmentBinding, activationId: uuid }),
]);
export type CustomerProtectionRequest = z.infer<typeof CustomerProtectionRequestSchema>;
const accessBinding = { operationId: uuid, attemptId: uuid };
export const CustomerPasskeyLoginRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('options'), ...accessBinding }),
  z.strictObject({ step: z.literal('assert'), ...accessBinding, response: CustomerPasskeyAssertionSchema.extend({
    response: CustomerPasskeyAssertionSchema.shape.response.extend({ userHandle: token }),
  }) }),
  z.strictObject({ step: z.literal('result'), ...accessBinding }),
]);
export type CustomerPasskeyLoginRequest = z.infer<typeof CustomerPasskeyLoginRequestSchema>;
export const CustomerRecoveryGrantSchema = z.strictObject({ ...accessBinding, expiresAt: timestamp,
  stage: z.enum(['registration_required', 'assertion_required', 'recovery_required']),
  // Number of replacement candidates in this grant, NOT the private account's
  // absolute recovery version. That value never comes from the browser.
  recoveryVersion: z.number().int().min(0).max(3),
});
export type CustomerRecoveryGrant = z.infer<typeof CustomerRecoveryGrantSchema>;
export const CustomerRecoveryRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('begin'), ...accessBinding, code: recoveryInput }),
  z.strictObject({ step: z.literal('state'), ...accessBinding }),
  z.strictObject({ step: z.literal('registration-options'), ...accessBinding, registrationId: uuid }),
  z.strictObject({ step: z.literal('register'), ...accessBinding, registrationId: uuid, response: CustomerPasskeyRegistrationSchema }),
  z.strictObject({ step: z.literal('assertion-options'), ...accessBinding, assertionId: uuid }),
  z.strictObject({ step: z.literal('assert'), ...accessBinding, assertionId: uuid, response: CustomerPasskeyAssertionSchema }),
  z.strictObject({ step: z.literal('recovery-code'), ...accessBinding, rotationId: uuid, expectedVersion: z.number().int().min(0).max(2) }),
  z.strictObject({ step: z.literal('activate'), ...accessBinding, activationId: uuid, recoveryVersion: z.number().int().min(1).max(3), code: recoveryInput }),
  z.strictObject({ step: z.literal('activation-result'), ...accessBinding, activationId: uuid }),
]);
export type CustomerRecoveryRequest = z.infer<typeof CustomerRecoveryRequestSchema>;
export const customerAccountRequestLimit = (action: CustomerAccountAction) => ['protection', 'passkey', 'recovery', 'order-create'].includes(action) ? 65_536 : 4096;
export const customerAccountResponseLimit = (action: CustomerAccountAction) => ['order-detail', 'order-reorder'].includes(action) ? 1_048_576
  : ['protection', 'passkey', 'recovery', 'order-create', 'orders'].includes(action) ? 65_536 : 16_384;

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
  protection: CustomerProtectionRequestSchema,
  passkey: CustomerPasskeyLoginRequestSchema,
  recovery: CustomerRecoveryRequestSchema,
  session: empty,
  name: z.strictObject({ name, expectedRevision: revision }),
  logout: z.strictObject({ all: z.boolean() }),
  'order-create': CustomerCreateOrderRequestSchema,
  orders: CustomerOrdersQuerySchema,
  'order-detail': CustomerOrderDetailRequestSchema,
  'order-reorder': CustomerOrderReorderRequestSchema,
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
  protection: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, request: CustomerAccountBrowserRequests.protection }),
  passkey: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, request: CustomerAccountBrowserRequests.passkey }),
  recovery: z.strictObject({ browserRef: uuid, browserSecret: token, intentProof: token, request: CustomerAccountBrowserRequests.recovery }),
  session: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.session }),
  name: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.name }),
  logout: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.logout }),
  'order-create': z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests['order-create'] }),
  orders: z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests.orders }),
  'order-detail': z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests['order-detail'] }),
  'order-reorder': z.strictObject({ browserRef: uuid, browserSecret: token, ...CustomerAccountPublicationSchema.shape, sessionToken: token, request: CustomerAccountBrowserRequests['order-reorder'] }),
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
  z.strictObject({ state: z.literal('enrollment'), ...verificationResultIdentity, challengeId: uuid, checkId: uuid, enrollment: CustomerEnrollmentSchema }),
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
const enrollmentResponse = z.strictObject({ state: z.literal('enrollment'), enrollment: CustomerEnrollmentSchema });
export const CustomerCheckResponseSchema = z.discriminatedUnion('state', [enrollmentResponse,
  z.strictObject({ state: z.literal('authenticated'), token, view: CustomerAccountViewSchema }),
]);
export const CustomerCheckPublicResponseSchema = z.discriminatedUnion('state', [enrollmentResponse,
  z.strictObject({ state: z.literal('authenticated'), view: CustomerAccountViewSchema }),
]);
const protectionPendingResponses = [enrollmentResponse,
  z.strictObject({ state: z.literal('registration-options'), enrollment: CustomerEnrollmentSchema, registrationId: uuid, options: CustomerPasskeyRegistrationOptionsSchema }),
  z.strictObject({ state: z.literal('assertion-options'), enrollment: CustomerEnrollmentSchema, assertionId: uuid, options: CustomerPasskeyAssertionOptionsSchema }),
  z.strictObject({ state: z.literal('recovery-code'), enrollment: CustomerEnrollmentSchema, code: z.string().regex(/^SM1(?:-[A-F0-9]{4}){8}$/).nullable() }),
] as const;
const activatedResponse = { state: z.literal('authenticated'), operationId: uuid, activationId: uuid, view: CustomerAccountViewSchema };
export const CustomerProtectionResponseSchema = z.discriminatedUnion('state', [...protectionPendingResponses,
  z.strictObject({ ...activatedResponse, token }),
]);
export const CustomerProtectionPublicResponseSchema = z.discriminatedUnion('state', [...protectionPendingResponses,
  z.strictObject(activatedResponse),
]);
export type CustomerProtectionResponse = z.infer<typeof CustomerProtectionResponseSchema>;
export type CustomerProtectionPublicResponse = z.infer<typeof CustomerProtectionPublicResponseSchema>;
const credentialAuthenticated = { state: z.literal('authenticated'), operationId: uuid, publicationId: uuid, view: CustomerAccountViewSchema };
const credentialPending = [
  z.strictObject({ state: z.literal('unresolved'), ...accessBinding, expiresAt: timestamp }),
  z.strictObject({ state: z.literal('failed'), ...accessBinding, expiresAt: timestamp }),
] as const;
const loginPending = [...credentialPending,
  z.strictObject({ state: z.literal('options'), ...accessBinding, expiresAt: timestamp, options: CustomerPasskeyAssertionOptionsSchema }),
] as const;
export const CustomerPasskeyLoginResponseSchema = z.discriminatedUnion('state', [...loginPending, z.strictObject({ ...credentialAuthenticated, token })]);
export const CustomerPasskeyLoginPublicResponseSchema = z.discriminatedUnion('state', [...loginPending, z.strictObject(credentialAuthenticated)]);
export type CustomerPasskeyLoginResponse = z.infer<typeof CustomerPasskeyLoginResponseSchema>;
export type CustomerPasskeyLoginPublicResponse = z.infer<typeof CustomerPasskeyLoginPublicResponseSchema>;
const recoveryPending = [...credentialPending,
  z.strictObject({ state: z.literal('recovery'), recovery: CustomerRecoveryGrantSchema }),
  z.strictObject({ state: z.literal('registration-options'), recovery: CustomerRecoveryGrantSchema, registrationId: uuid, options: CustomerPasskeyRegistrationOptionsSchema }),
  z.strictObject({ state: z.literal('assertion-options'), recovery: CustomerRecoveryGrantSchema, assertionId: uuid, options: CustomerPasskeyAssertionOptionsSchema }),
  z.strictObject({ state: z.literal('recovery-code'), recovery: CustomerRecoveryGrantSchema, code: z.string().regex(/^SM1(?:-[A-F0-9]{4}){8}$/).nullable() }),
] as const;
export const CustomerRecoveryResponseSchema = z.discriminatedUnion('state', [...recoveryPending, z.strictObject({ ...credentialAuthenticated, token })]);
export const CustomerRecoveryPublicResponseSchema = z.discriminatedUnion('state', [...recoveryPending, z.strictObject(credentialAuthenticated)]);
export type CustomerRecoveryResponse = z.infer<typeof CustomerRecoveryResponseSchema>;
export type CustomerRecoveryPublicResponse = z.infer<typeof CustomerRecoveryPublicResponseSchema>;
export const CustomerAccountResponses = {
  status: z.strictObject({ available: z.boolean(), registrationAvailable: z.boolean().optional(), accessAvailable: z.boolean().optional() }),
  browser: z.strictObject({ preparation: CustomerBrowserPreparationSchema, emitCookie: z.boolean() })
    .refine(value => !value.emitCookie || value.preparation.state === 'issued'),
  intent: z.strictObject({ intent: CustomerVerificationIntentSchema, emitCookie: z.boolean() })
    .refine(value => !value.emitCookie || value.intent.state === 'open'),
  start: z.strictObject({ challengeId: uuid, expiresAt: timestamp }),
  check: CustomerCheckResponseSchema,
  recover: CustomerVerificationResultSchema,
  protection: CustomerProtectionResponseSchema,
  passkey: CustomerPasskeyLoginResponseSchema,
  recovery: CustomerRecoveryResponseSchema,
  session: CustomerAccountViewSchema,
  name: CustomerAccountViewSchema,
  logout: z.undefined(),
  'order-create': CustomerOrderCreateResponseSchema,
  orders: CustomerOrdersPageSchema,
  'order-detail': CustomerOrderDetailResponseSchema,
  'order-reorder': CustomerOrderReorderResponseSchema,
} as const;
export const CustomerAccountErrorSchema = z.strictObject({
  code: z.enum(['CUSTOMER_UNAVAILABLE', 'CUSTOMER_INVALID_REQUEST', 'CUSTOMER_UNAUTHORIZED',
    'CUSTOMER_CONFLICT', 'CUSTOMER_RATE_LIMITED', 'CUSTOMER_RELAY_REFUSED']),
  message: z.string().max(200),
});
