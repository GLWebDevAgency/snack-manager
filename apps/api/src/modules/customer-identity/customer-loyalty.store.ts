import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { CustomerLoyaltyRequestSchema, CustomerLoyaltyProgramSchema, CustomerLoyaltyMemberSchema,
  CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION,
  type CustomerLoyaltyProgram, type CustomerLoyaltyMember, type CustomerLoyaltyRequest, type CustomerLoyaltyResponse } from '@sm/contracts';
import type { CustomerIdentityCrypto, ProtectedCustomerSession } from '@sm/customer';
import { hashLoyaltyQrToken, type LoyaltyCryptoAdapter } from '@sm/loyalty';

type WithoutExpiry<T> = T extends { expiresAt: number } ? Omit<T, 'expiresAt'> : never;
export type CustomerLoyaltyStoreResult = WithoutExpiry<CustomerLoyaltyResponse>;
export interface CustomerLoyaltyStoreContext {
  readonly client: PoolClient;
  readonly session: ProtectedCustomerSession;
  readonly scope: { readonly parentRef: string; readonly tenantRef: string };
  readonly identity: CustomerIdentityCrypto;
  readonly crypto: LoyaltyCryptoAdapter;
}
export class CustomerLoyaltyStoreError extends Error {
  constructor(readonly result: CustomerLoyaltyStoreResult) {
    super('Adhésion fidélité indisponible.');
    this.name = 'CustomerLoyaltyStoreError';
  }
}
type Join = Extract<CustomerLoyaltyRequest, { step: 'join' }>;
type Attach = Extract<CustomerLoyaltyRequest, { step: 'attach' }>;
type Operation = { kind: string; status: string; request_fingerprint: string; result: unknown; completed_at: Date | null };
type Membership = { member_id: string; operation_id: string; request_hash: string };
type MemberRow = { id: string; status: string; joined_at: Date; enrollment_handoff_at: Date | null;
  qr_generation: string; balance_units: string };
const unavailable = (): never => { throw new CustomerLoyaltyStoreError({ state: 'unavailable' }); };
const refuse = (result: CustomerLoyaltyStoreResult): never => { throw new CustomerLoyaltyStoreError(result); };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const attachmentReceiptSchema = z.strictObject({ customerAccountAttachment: z.literal('v1'), parentRef: z.string().min(1),
  accountId: CustomerLoyaltyMemberSchema.shape.id, memberId: CustomerLoyaltyMemberSchema.shape.id,
  programId: CustomerLoyaltyProgramSchema.shape.id, rulesVersion: CustomerLoyaltyProgramSchema.shape.version,
  termsNoticeVersion: z.literal(CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION), termsAccepted: z.literal(true),
  presentedQrHash: hashSchema, qrTokenHash: hashSchema, revokedTokens: z.literal(1),
  previousGeneration: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  qrGeneration: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
}).refine(value => value.qrGeneration === value.previousGeneration + 1);
const attachmentReason = 'customer_account_attachment';
function equalHash(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b)
    && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Only the durable server-proven owner and accepted intention participate in
 * idempotence. A later name edit, browser change or QR rotation is not a new
 * enrollment, and no raw phone/profile belongs in the operation inbox. */
function fingerprint(ctx: CustomerLoyaltyStoreContext, request: Join): string {
  return ctx.crypto.operationFingerprint({ tenantRef: ctx.scope.tenantRef, kind: 'member_create', payload: {
    purpose: 'protected-customer-membership-v1', parentRef: ctx.scope.parentRef, accountId: ctx.session.profile.accountId,
    programId: request.programId, rulesVersion: request.rulesVersion, termsNoticeVersion: request.termsNoticeVersion, termsAccepted: true,
  } });
}
function attachmentFingerprint(ctx: CustomerLoyaltyStoreContext,
  request: Pick<Attach, 'programId' | 'rulesVersion' | 'termsNoticeVersion'>, presentedQrHash: string): string {
  return ctx.crypto.operationFingerprint({ tenantRef: ctx.scope.tenantRef, kind: 'token_replace', payload: {
    purpose: 'protected-customer-attachment-v1', parentRef: ctx.scope.parentRef, accountId: ctx.session.profile.accountId,
    programId: request.programId, rulesVersion: request.rulesVersion, termsNoticeVersion: request.termsNoticeVersion,
    termsAccepted: true, presentedQrHash,
  } });
}
function verifiedProfile(ctx: CustomerLoyaltyStoreContext): { name: string | null; phone: string } {
  try {
    const p = ctx.session.profile;
    const phone = ctx.identity.open('phone', ctx.scope.tenantRef, p.phoneHash, p.encryptedPhone);
    if (!/^\+33[67]\d{8}$/.test(phone) || !equalHash(ctx.identity.hash('phone', ctx.scope.tenantRef, phone), p.phoneHash)
      || !Number.isSafeInteger(p.phoneVerifiedAt) || p.phoneVerifiedAt <= 0) return unavailable();
    const name = p.encryptedName === null ? null : ctx.identity.open('name', ctx.scope.tenantRef, p.accountId, p.encryptedName);
    if (name !== null && (!name.length || name.length > 120 || name.trim() !== name || /[\p{Cc}\p{Cf}]/u.test(name))) return unavailable();
    return { name, phone };
  } catch { return unavailable(); }
}
async function currentProgram(ctx: CustomerLoyaltyStoreContext): Promise<CustomerLoyaltyProgram | null> {
  // Same lock as legacy program publication. Never acknowledge terms from a
  // version read before a concurrent publish committed.
  const rows = await ctx.client.query(`SELECT p.id,p.status,p.current_version AS version,v.name,v.mechanism,v.terms_summary,
    v.unit_label_singular,v.unit_label_plural FROM loyalty.programs p JOIN loyalty.program_versions v
    ON (v.tenant_ref,v.program_id,v.version)=(p.tenant_ref,p.id,p.current_version)
    WHERE p.tenant_ref=$1 FOR SHARE OF p`, [ctx.scope.tenantRef]);
  const row = rows.rows[0];
  if (!row || row.status !== 'active') return null;
  const parsed = CustomerLoyaltyProgramSchema.safeParse({ id: row.id, version: Number(row.version), name: row.name,
    mechanism: row.mechanism, termsSummary: row.terms_summary, unitLabelSingular: row.unit_label_singular, unitLabelPlural: row.unit_label_plural });
  return parsed.success ? parsed.data : unavailable();
}
async function association(ctx: CustomerLoyaltyStoreContext): Promise<Membership | null> {
  return (await ctx.client.query<Membership>(`SELECT member_id,operation_id,request_hash FROM customer.loyalty_memberships
    WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3`,
  [ctx.scope.parentRef, ctx.scope.tenantRef, ctx.session.profile.accountId])).rows[0] ?? null;
}
async function operation(ctx: CustomerLoyaltyStoreContext, id: string, lock = false): Promise<Operation | null> {
  return (await ctx.client.query<Operation>(`SELECT kind,status,request_fingerprint,result,completed_at FROM loyalty.operations
    WHERE tenant_ref=$1 AND operation_id=$2${lock ? ' FOR UPDATE' : ''}`, [ctx.scope.tenantRef, id])).rows[0] ?? null;
}
async function ownedMember(ctx: CustomerLoyaltyStoreContext, link: Membership, program: CustomerLoyaltyProgram): Promise<CustomerLoyaltyMember> {
  const original = await operation(ctx, link.operation_id);
  const receipt = object(original?.result);
  if (!original || original.status !== 'completed' || !original.completed_at
    || !receipt || receipt.memberId !== link.member_id
    || receipt.parentRef !== ctx.scope.parentRef || receipt.accountId !== ctx.session.profile.accountId
    || receipt.programId !== program.id || !equalHash(link.request_hash, original.request_fingerprint)) return unavailable();
  let event: 'joined' | 'token_replaced', notice: string | null, reason: string | null, initialGeneration = 1;
  if (original.kind === 'member_create' && receipt.customerAccountEnrollment === 'v1' && receipt.customerAccountAttachment === undefined) {
    const request = CustomerLoyaltyRequestSchema.safeParse({ step: 'join', operationId: link.operation_id, programId: receipt.programId,
      rulesVersion: receipt.rulesVersion, termsNoticeVersion: receipt.termsNoticeVersion, termsAccepted: true });
    if (!request.success || request.data.step !== 'join' || !equalHash(link.request_hash, fingerprint(ctx, request.data))) return unavailable();
    event = 'joined'; notice = request.data.termsNoticeVersion; reason = null;
  } else if (original.kind === 'token_replace') {
    const attached = attachmentReceiptSchema.safeParse(receipt);
    if (!attached.success || !equalHash(link.request_hash, attachmentFingerprint(ctx, attached.data, attached.data.presentedQrHash))) return unavailable();
    event = 'token_replaced'; notice = null; reason = attachmentReason; initialGeneration = attached.data.qrGeneration;
  } else return unavailable();
  const row = (await ctx.client.query<MemberRow>(`SELECT m.id,m.status,m.joined_at,m.enrollment_handoff_at,m.qr_generation,w.balance_units
    FROM loyalty.members m JOIN loyalty.wallets w ON (w.tenant_ref,w.member_id)=(m.tenant_ref,m.id)
    WHERE m.tenant_ref=$1 AND m.id=$2 AND w.program_id=$3
      AND EXISTS (SELECT 1 FROM loyalty.membership_events e WHERE e.tenant_ref=m.tenant_ref AND e.member_id=m.id
        AND e.operation_id=$4 AND e.source='online' AND e.actor_ref=$5 AND e.kind=$6
        AND e.terms_notice_version IS NOT DISTINCT FROM $7::text AND e.reason IS NOT DISTINCT FROM $8::text)
    FOR SHARE OF m`, [ctx.scope.tenantRef, link.member_id, program.id, link.operation_id,
    `customer:${ctx.session.profile.accountId}`, event, notice, reason])).rows[0];
  if (!row || row.status !== 'active' || !row.enrollment_handoff_at || Number(row.qr_generation) < initialGeneration) return unavailable();
  const parsed = CustomerLoyaltyMemberSchema.safeParse({ id: row.id, joinedAt: row.joined_at.toISOString(), qrGeneration: Number(row.qr_generation),
    balanceUnits: Number(row.balance_units), unitLabelSingular: program.unitLabelSingular, unitLabelPlural: program.unitLabelPlural });
  return parsed.success ? parsed.data : unavailable();
}

async function currentCard(ctx: CustomerLoyaltyStoreContext, link: Membership, member: CustomerLoyaltyMember): Promise<CustomerLoyaltyStoreResult> {
  // The member SHARE lock already fences legacy rotation/lifecycle, which
  // acquire member UPDATE before changing tokens/events. Do not acquire a new
  // operation lock here (that would invert the legacy operation -> member order).
  const token = (await ctx.client.query<{ token_hash: string }>(`SELECT token_hash FROM loyalty.member_tokens
    WHERE tenant_ref=$1 AND member_id=$2 AND status='active' AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [ctx.scope.tenantRef, member.id])).rows;
  if (token.length !== 1) return unavailable();
  const candidates = await ctx.client.query<{ operation_id: string; result: unknown }>(`SELECT o.operation_id,o.result
    FROM loyalty.membership_events e JOIN loyalty.operations o ON (o.tenant_ref,o.operation_id)=(e.tenant_ref,e.operation_id)
    WHERE e.tenant_ref=$1 AND e.member_id=$2 AND o.status='completed' AND o.completed_at IS NOT NULL
      AND (($3::bigint=1 AND e.kind='joined' AND o.kind='member_create' AND o.operation_id=$4)
        OR ($3::bigint>1 AND e.kind='token_replaced' AND o.kind='token_replace' AND o.result->>'qrGeneration'=$3::text))
    LIMIT 2`, [ctx.scope.tenantRef, member.id, String(member.qrGeneration), link.operation_id]);
  if (candidates.rows.length !== 1) return unavailable();
  const candidate = candidates.rows[0]!; const result = object(candidate.result);
  if (!result || result.memberId !== member.id || !equalHash(result.qrTokenHash, token[0]!.token_hash)
    || result.qrGeneration !== member.qrGeneration
    || (member.qrGeneration > 1 && result.previousGeneration !== member.qrGeneration - 1)) return unavailable();
  const derived = ctx.crypto.deriveEnrollmentQrToken({ tenantRef: ctx.scope.tenantRef, memberId: member.id, operationId: candidate.operation_id });
  if (!equalHash(derived.tokenHash, token[0]!.token_hash)) return unavailable();
  return { state: 'card', member, qrToken: derived.clearToken };
}

async function createMembership(ctx: CustomerLoyaltyStoreContext, request: Join, requestHash: string,
  profile: { name: string; phone: string }): Promise<Membership> {
  const { tenantRef, parentRef } = ctx.scope;
  const accountId = ctx.session.profile.accountId;
  const memberId = randomUUID();
  // Preserve the complete customer display name: no guessed first/last split,
  // no truncation to the POS input limit, no address or marketing side effect.
  const encrypted = ctx.crypto.encryptProfile({ tenantRef, memberId }, { firstName: profile.name, phone: profile.phone });
  const phoneHash = ctx.crypto.phoneLookupHash(tenantRef, profile.phone);
  await ctx.client.query(`WITH instant AS (SELECT clock_timestamp() AS at)
    INSERT INTO loyalty.members(id,tenant_ref,status,joined_at,enrollment_handoff_at)
    SELECT $1,$2,'active',at,at FROM instant`, [memberId, tenantRef]);
  // This native unique index arbitrates a simultaneous POS enrollment. Never
  // catch SQL here: the outer protected transaction must roll every row back.
  await ctx.client.query(`INSERT INTO loyalty.member_profiles(member_id,tenant_ref,encrypted_payload,phone_lookup_hash,key_version)
    VALUES($1,$2,$3,$4,$5)`, [memberId, tenantRef, JSON.stringify(encrypted), phoneHash, encrypted.keyVersion]);
  await ctx.client.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [tenantRef, memberId, request.programId]);
  await ctx.client.query(`INSERT INTO loyalty.membership_events(tenant_ref,member_id,operation_id,kind,terms_notice_version,source,actor_ref)
    VALUES($1,$2,$3,'joined',$4,'online',$5)`, [tenantRef, memberId, request.operationId, request.termsNoticeVersion, `customer:${accountId}`]);
  const token = ctx.crypto.deriveEnrollmentQrToken({ tenantRef, memberId, operationId: request.operationId });
  await ctx.client.query(`INSERT INTO loyalty.member_tokens(tenant_ref,member_id,token_hash,status,expires_at)
    VALUES($1,$2,$3,'active',NULL)`, [tenantRef, memberId, token.tokenHash]);
  const result = { customerAccountEnrollment: 'v1', parentRef, accountId, memberId, programId: request.programId,
    rulesVersion: request.rulesVersion, termsNoticeVersion: request.termsNoticeVersion, qrGeneration: 1, qrTokenHash: token.tokenHash };
  const completed = await ctx.client.query(`UPDATE loyalty.operations SET status='completed',result=$3,completed_at=clock_timestamp()
    WHERE tenant_ref=$1 AND operation_id=$2 AND status='pending' AND kind='member_create' AND request_fingerprint=$4`,
  [tenantRef, request.operationId, JSON.stringify(result), requestHash]);
  if (completed.rowCount !== 1) return unavailable();
  await ctx.client.query(`INSERT INTO customer.loyalty_memberships(parent_ref,tenant_ref,account_id,member_id,operation_id,request_hash)
    VALUES($1,$2,$3,$4,$5,$6)`, [parentRef, tenantRef, accountId, memberId, request.operationId, requestHash]);
  return { member_id: memberId, operation_id: request.operationId, request_hash: requestHash };
}

const attachmentRefused = (): never => refuse({ state: 'attachment_refused' });
async function attachmentTarget(ctx: CustomerLoyaltyStoreContext, programId: string, presentedQrHash: string) {
  const { tenantRef } = ctx.scope;
  // Resolve only the presented capability. This first read grants nothing:
  // rotation/lifecycle may run before the member lock is acquired below.
  const candidate = (await ctx.client.query<{ member_id: string }>(`SELECT member_id FROM loyalty.member_tokens
    WHERE tenant_ref=$1 AND token_hash=$2`, [tenantRef, presentedQrHash])).rows[0];
  if (!candidate) return attachmentRefused();
  const row = (await ctx.client.query<{ id: string; qr_generation: string }>(`SELECT m.id,m.qr_generation FROM loyalty.members m
    WHERE m.tenant_ref=$1 AND m.id=$2 AND m.status='active' AND m.enrollment_handoff_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM loyalty.wallets w WHERE w.tenant_ref=m.tenant_ref AND w.member_id=m.id AND w.program_id=$3)
    FOR UPDATE OF m`, [tenantRef, candidate.member_id, programId])).rows[0];
  if (!row) return attachmentRefused();
  const previousGeneration = Number(row.qr_generation);
  if (!Number.isSafeInteger(previousGeneration) || previousGeneration < 1 || previousGeneration >= Number.MAX_SAFE_INTEGER) return attachmentRefused();
  const token = (await ctx.client.query<{ id: string; token_hash: string; valid: boolean }>(`SELECT id,token_hash,
    (revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())) AS valid
    FROM loyalty.member_tokens WHERE tenant_ref=$1 AND member_id=$2 AND status='active' FOR UPDATE`, [tenantRef, row.id])).rows;
  if (token.length !== 1 || !token[0]!.valid || !equalHash(token[0]!.token_hash, presentedQrHash)) return attachmentRefused();
  // RLS can hide a different parent's link. The native tenant/member UNIQUE
  // constraint remains the final arbiter and must roll the entire rotation back.
  if ((await ctx.client.query('SELECT 1 FROM customer.loyalty_memberships WHERE tenant_ref=$1 AND member_id=$2', [tenantRef, row.id])).rowCount) {
    return attachmentRefused();
  }
  const joined = (await ctx.client.query(`SELECT e.id FROM loyalty.membership_events e JOIN loyalty.operations o
    ON (o.tenant_ref,o.operation_id)=(e.tenant_ref,e.operation_id) WHERE e.tenant_ref=$1 AND e.member_id=$2
      AND e.kind='joined' AND e.source IN ('pos','admin','standalone') AND o.kind='member_create'
      AND o.status='completed' AND o.completed_at IS NOT NULL LIMIT 2`, [tenantRef, row.id])).rows;
  if (joined.length !== 1) return attachmentRefused();
  const profile = (await ctx.client.query<{ encrypted_payload: string; phone_lookup_hash: string | null; key_version: number }>(
    'SELECT encrypted_payload,phone_lookup_hash,key_version FROM loyalty.member_profiles WHERE tenant_ref=$1 AND member_id=$2 FOR SHARE',
    [tenantRef, row.id])).rows[0];
  try {
    const verified = verifiedProfile(ctx);
    if (!profile || !equalHash(profile.phone_lookup_hash, ctx.crypto.phoneLookupHash(tenantRef, verified.phone))) return attachmentRefused();
    const encrypted = JSON.parse(profile.encrypted_payload);
    const existing = ctx.crypto.decryptProfile({ tenantRef, memberId: row.id }, encrypted);
    if (encrypted.keyVersion !== profile.key_version || !existing.phone
      || !equalHash(profile.phone_lookup_hash, ctx.crypto.phoneLookupHash(tenantRef, existing.phone))) return attachmentRefused();
  } catch { return attachmentRefused(); }
  return { memberId: row.id, previousGeneration, tokenId: token[0]!.id };
}

async function attachMembership(ctx: CustomerLoyaltyStoreContext, request: Attach): Promise<CustomerLoyaltyStoreResult> {
  const { parentRef, tenantRef } = ctx.scope;
  const accountId = ctx.session.profile.accountId;
  const presentedQrHash = hashLoyaltyQrToken(request.qrToken);
  const requestHash = attachmentFingerprint(ctx, request, presentedQrHash);
  const link = await association(ctx);
  const original = await operation(ctx, request.operationId, true);
  if (original && (original.kind !== 'token_replace' || !equalHash(original.request_fingerprint, requestHash)
    || !link || link.operation_id !== request.operationId)) return refuse({ state: 'conflict' });
  if (!original && link) return attachmentRefused();
  // Even a competing insertion of this operation must settle before taking
  // program/member locks; a reversed order could deadlock a POS publication.
  if (!original) await ctx.client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
    VALUES($1,$2,'token_replace',$3)`, [tenantRef, request.operationId, requestHash]);
  const program = await currentProgram(ctx);
  if (!program) return unavailable();
  // The exact durable owner/intent is enough for replay, even after the
  // presented QR was revoked. Never rotate again or return the initial secret.
  if (link) return { state: 'member', member: await ownedMember(ctx, link, program) };
  if (request.programId !== program.id || request.rulesVersion !== program.version) {
    return refuse({ state: 'terms_changed', program, profileReady: ctx.session.profile.encryptedName !== null });
  }
  const target = await attachmentTarget(ctx, program.id, presentedQrHash);
  const qrGeneration = target.previousGeneration + 1;
  const token = ctx.crypto.deriveEnrollmentQrToken({ tenantRef, memberId: target.memberId, operationId: request.operationId });
  const advanced = await ctx.client.query(`UPDATE loyalty.members SET qr_generation=$3
    WHERE tenant_ref=$1 AND id=$2 AND qr_generation=$4`, [tenantRef, target.memberId, qrGeneration, target.previousGeneration]);
  if (advanced.rowCount !== 1) return attachmentRefused();
  const revoked = await ctx.client.query(`UPDATE loyalty.member_tokens SET status='revoked',revoked_at=clock_timestamp()
    WHERE tenant_ref=$1 AND id=$2 AND status='active' AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>clock_timestamp())`, [tenantRef, target.tokenId]);
  if (revoked.rowCount !== 1) return attachmentRefused();
  await ctx.client.query(`INSERT INTO loyalty.member_tokens(tenant_ref,member_id,token_hash,status,expires_at)
    VALUES($1,$2,$3,'active',NULL)`, [tenantRef, target.memberId, token.tokenHash]);
  await ctx.client.query(`INSERT INTO loyalty.membership_events(tenant_ref,member_id,operation_id,kind,reason,source,actor_ref)
    VALUES($1,$2,$3,'token_replaced',$4,'online',$5)`, [tenantRef, target.memberId, request.operationId, attachmentReason, `customer:${accountId}`]);
  const result = attachmentReceiptSchema.parse({ customerAccountAttachment: 'v1', parentRef, accountId, memberId: target.memberId,
    programId: program.id, rulesVersion: request.rulesVersion, termsNoticeVersion: request.termsNoticeVersion, termsAccepted: true,
    presentedQrHash, qrTokenHash: token.tokenHash, previousGeneration: target.previousGeneration, qrGeneration, revokedTokens: 1 });
  const completed = await ctx.client.query(`UPDATE loyalty.operations SET status='completed',result=$3,completed_at=clock_timestamp()
    WHERE tenant_ref=$1 AND operation_id=$2 AND status='pending' AND kind='token_replace' AND request_fingerprint=$4`,
  [tenantRef, request.operationId, JSON.stringify(result), requestHash]);
  if (completed.rowCount !== 1) return attachmentRefused();
  await ctx.client.query(`INSERT INTO customer.loyalty_memberships(parent_ref,tenant_ref,account_id,member_id,operation_id,request_hash)
    VALUES($1,$2,$3,$4,$5,$6)`, [parentRef, tenantRef, accountId, target.memberId, request.operationId, requestHash]);
  return { state: 'member', member: await ownedMember(ctx,
    { member_id: target.memberId, operation_id: request.operationId, request_hash: requestHash }, program) };
}

/** Trusted SQL adapter, not an authentication boundary. Invoke ONLY from
 * withProtectedCustomerSession, with the exact server-derived parent/tenant.
 * Never create a pool, start/end a transaction, call a provider, publish a
 * result or retain this client. The outer final authority proof owns commit.
 * Lock order: customer intent/budget -> join operation -> program -> member ->
 * token. All business refusals throw a safe result, including after writes.
 * The runtime separately fences its current entitlement and returned QR. */
export async function runCustomerLoyalty(ctx: CustomerLoyaltyStoreContext,
  raw: CustomerLoyaltyRequest): Promise<CustomerLoyaltyStoreResult> {
  const parsed = CustomerLoyaltyRequestSchema.safeParse(raw);
  if (!parsed.success) return refuse({ state: 'conflict' });
  const request = parsed.data;
  if (request.step === 'attach') return attachMembership(ctx, request);
  let link = await association(ctx);
  let requestHash: string | undefined;
  if (request.step === 'join') {
    requestHash = fingerprint(ctx, request);
    const existing = await operation(ctx, request.operationId, true);
    if (existing && (existing.kind !== 'member_create' || !equalHash(existing.request_fingerprint, requestHash)
      || !link || link.operation_id !== request.operationId)) return refuse({ state: 'conflict' });
    if (!link && !existing) await ctx.client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
      VALUES($1,$2,'member_create',$3)`, [ctx.scope.tenantRef, request.operationId, requestHash]);
  }
  const program = await currentProgram(ctx);
  if (!program) return unavailable();
  if (link) {
    const member = await ownedMember(ctx, link, program);
    return request.step === 'card' ? currentCard(ctx, link, member) : { state: 'member', member };
  }
  if (request.step === 'card') return unavailable();
  const profile = verifiedProfile(ctx);
  if (request.step === 'view') return { state: 'available', program, profileReady: profile.name !== null };
  if (request.programId !== program.id || request.rulesVersion !== program.version) {
    return refuse({ state: 'terms_changed', program, profileReady: profile.name !== null });
  }
  if (profile.name === null) return refuse({ state: 'name_required' });
  link = await createMembership(ctx, request, requestHash!, { name: profile.name, phone: profile.phone });
  return { state: 'member', member: await ownedMember(ctx, link, program) };
}
