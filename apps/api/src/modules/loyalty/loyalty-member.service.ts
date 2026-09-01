import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  LoyaltyConsentMutationResultSchema,
  LoyaltyConsentStateViewSchema,
  LoyaltyDashboardSchema,
  LoyaltyEarnResultSchema,
  LoyaltyLedgerReversalResultSchema,
  LoyaltyMemberDetailSchema,
  LoyaltyMemberLifecycleResultSchema,
  LoyaltyMemberListSchema,
  LoyaltyMemberSummarySchema,
  LoyaltyMemberQrReplaceResultSchema,
  LoyaltyMutationResultSchema,
  LoyaltyRedeemResultSchema,
  LoyaltyRewardSnapshotSchema,
  type LoyaltyAdminAdjustment,
  type LoyaltyConsentEvent,
  type LoyaltyConsentMutationResult,
  type LoyaltyDashboard,
  type LoyaltyEarn,
  type LoyaltyEarnResult,
  type LoyaltyLedgerReversal,
  type LoyaltyLedgerReversalResult,
  type LoyaltyMemberCreate,
  type LoyaltyMemberCreateResult,
  type LoyaltyMemberDetail,
  type LoyaltyMemberLifecycle,
  type LoyaltyMemberLifecycleResult,
  type LoyaltyMemberList,
  type LoyaltyMemberListQuery,
  type LoyaltyMemberResolve,
  type LoyaltyMemberQrReplace,
  type LoyaltyMemberQrReplaceResult,
  type LoyaltyMemberSummary,
  type LoyaltyMutationResult,
  type LoyaltyRedeem,
  type LoyaltyRedeemResult,
  type LoyaltyRedemptionView,
  type LoyaltyRewardSnapshot,
} from '@sm/contracts';
import { Money, loyalty as loyaltyDomain } from '@sm/domain';
import {
  LoyaltyCryptoAdapter,
  alias,
  and,
  consentEvents,
  consentState,
  desc,
  earnReceipts,
  eq,
  gt,
  hashLoyaltyQrToken,
  isNull,
  lt,
  ledgerEntries,
  memberProfiles,
  memberTokens,
  members,
  membershipEvents,
  normalizeFrenchPhoneToE164,
  operations,
  or,
  programVersions,
  programs,
  redemptions,
  rewards,
  sql,
  wallets,
  withLoyaltyTenant,
  type LoyaltyDb,
  type LoyaltyTx,
} from '@sm/loyalty';
import { LOYALTY_CRYPTO, LOYALTY_DB } from '../../loyalty-db.module';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

type ProgramRow = typeof programs.$inferSelect;
type ProgramVersionRow = typeof programVersions.$inferSelect;
type MemberRow = typeof members.$inferSelect;
type MemberProfileRow = typeof memberProfiles.$inferSelect;
type WalletRow = typeof wallets.$inferSelect;
type LedgerRow = typeof ledgerEntries.$inferSelect;
type RedemptionRow = typeof redemptions.$inferSelect;

const reversalLedgerEntries = alias(ledgerEntries, 'reversal_ledger_entries');

export type LoyaltySource = 'standalone' | 'pos' | 'online' | 'admin' | 'system';

export interface LoyaltyActorContext {
  source: LoyaltySource;
  actorRef: string;
  deviceRef: string | null;
}

/**
 * Politique ferme du pilote : le canal SMS ne collecte aucun nouvel opt-in.
 *
 * Le code machine est stable afin que les clients puissent distinguer cette
 * indisponibilité volontaire d'un conflit de données sans comparer le texte
 * français. Cette règle n'est pas pilotée par configuration : une variable
 * d'environnement mal réglée ne doit jamais l'activer accidentellement.
 */
export const LOYALTY_SMS_GRANT_DISABLED_CODE = 'loyalty_sms_grant_disabled';
export const LOYALTY_SMS_GRANT_DISABLED_MESSAGE =
  "L'octroi du consentement SMS est désactivé pendant le pilote";

const POS_REDEMPTION_REFERENCE =
  /^pos-redemption:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ONLINE_REDEMPTION_REFERENCE =
  /^online-redemption:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CurrentProgram {
  program: ProgramRow;
  version: ProgramVersionRow;
}

interface ClaimedOperation {
  replayed: boolean;
  result: unknown;
}

function mustRow<T>(
  row: T | null | undefined,
  message = 'Écriture fidélité sans résultat',
): NonNullable<T> {
  if (row === undefined || row === null) throw new Error(message);
  return row;
}

interface PgErrorDetails {
  code?: string;
  constraint?: string;
}

function pgErrorDetails(error: unknown): PgErrorDetails {
  let current = error;
  let code: string | undefined;
  let constraint: string | undefined;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    code ??= typeof candidate.code === 'string' ? candidate.code : undefined;
    constraint ??=
      typeof candidate.constraint === 'string' ? candidate.constraint : undefined;
    if (code && constraint) break;
    current = candidate.cause;
  }
  return { code, constraint };
}

export function isUniqueConstraint(error: unknown, constraint: string): boolean {
  const details = pgErrorDetails(error);
  return details.code === '23505' && details.constraint === constraint;
}

function corruptedWallet(): never {
  throw new InternalServerErrorException('Données fidélité incohérentes');
}

function safeUnitAddition(current: number, delta: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(delta)) {
    return corruptedWallet();
  }
  const next = current + delta;
  if (!Number.isSafeInteger(next)) {
    throw new ConflictException('Le mouvement dépasse le plafond technique du programme');
  }
  return next;
}

function safeMetric(value: unknown, label: string): number {
  try {
    const parsed = typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(label);
    return Number(parsed);
  } catch {
    throw new InternalServerErrorException(`Métrique fidélité invalide : ${label}`);
  }
}

function currentEarnRule(version: ProgramVersionRow): loyaltyDomain.LoyaltyEarnRule {
  return version.mechanism === 'points'
    ? {
        mechanism: 'points',
        minimumPurchaseCents: version.minimumPurchaseCents,
        maximumUnitsPerPurchase: version.maximumUnitsPerPurchase,
        spendStepCents: version.spendStepCents!,
        unitsPerStep: version.unitsPerStep!,
      }
    : {
        mechanism: 'stamps',
        minimumPurchaseCents: version.minimumPurchaseCents,
        maximumUnitsPerPurchase: version.maximumUnitsPerPurchase,
        unitsPerVisit: version.unitsPerVisit!,
      };
}

async function loadCurrentProgram(
  tx: LoyaltyTx,
  tenantRef: string,
  lock = false,
): Promise<CurrentProgram | null> {
  const query = tx
    .select({ program: programs, version: programVersions })
    .from(programs)
    .innerJoin(
      programVersions,
      and(
        eq(programVersions.tenantRef, programs.tenantRef),
        eq(programVersions.programId, programs.id),
        eq(programVersions.version, programs.currentVersion),
      ),
    )
    .where(eq(programs.tenantRef, tenantRef))
    .limit(1);
  const rows = lock ? await query.for('share') : await query;
  return rows[0] ?? null;
}

async function claimOperation(
  tx: LoyaltyTx,
  input: {
    tenantRef: string;
    operationId: string;
    kind:
      | 'member_create'
      | 'earn'
      | 'redeem'
      | 'adjust'
      | 'consent'
      | 'member_lifecycle'
      | 'token_replace'
      | 'reverse';
    fingerprint: string;
  },
): Promise<ClaimedOperation> {
  const inserted = await tx
    .insert(operations)
    .values({
      tenantRef: input.tenantRef,
      operationId: input.operationId,
      kind: input.kind,
      requestFingerprint: input.fingerprint,
    })
    .onConflictDoNothing()
    .returning({ operationId: operations.operationId });
  if (inserted.length > 0) return { replayed: false, result: null };

  const [existing] = await tx
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.tenantRef, input.tenantRef),
        eq(operations.operationId, input.operationId),
      ),
    )
    .limit(1)
    .for('update');
  if (!existing) throw new ConflictException("L'opération concurrente doit être rejouée");
  if (existing.kind !== input.kind || existing.requestFingerprint !== input.fingerprint) {
    throw new ConflictException("Cette clé d'idempotence appartient à une autre opération");
  }
  if (existing.status !== 'completed' || existing.result === null) {
    throw new ConflictException("L'opération est encore en cours, réessayez");
  }
  return { replayed: true, result: existing.result };
}

async function completeOperation(
  tx: LoyaltyTx,
  tenantRef: string,
  operationId: string,
  result: object,
): Promise<void> {
  const [completed] = await tx
    .update(operations)
    .set({ status: 'completed', result, completedAt: new Date() })
    .where(
      and(
        eq(operations.tenantRef, tenantRef),
        eq(operations.operationId, operationId),
        eq(operations.status, 'pending'),
      ),
    )
    .returning({ operationId: operations.operationId });
  if (!completed) throw new Error('Opération fidélité déjà clôturée');
}

function maskedPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `•• •• •• ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

function ledgerView(row: LedgerRow): NonNullable<LoyaltyMutationResult['entry']> {
  return {
    id: row.id,
    kind: row.kind,
    deltaUnits: row.deltaUnits,
    balanceAfter: row.balanceAfter,
    source: row.source,
    reason: row.reason,
    externalRef: row.externalRef,
    recordedAt: row.recordedAt.toISOString(),
  };
}

interface StoredMemberSnapshot {
  balanceUnits: number;
  lifetimeEarnedUnits: number;
  lifetimeRedeemedUnits: number;
  lastActivityAt: string | null;
}

function memberSnapshot(member: LoyaltyMemberSummary): StoredMemberSnapshot {
  return {
    balanceUnits: member.balanceUnits,
    lifetimeEarnedUnits: member.lifetimeEarnedUnits,
    lifetimeRedeemedUnits: member.lifetimeRedeemedUnits,
    lastActivityAt: member.lastActivityAt,
  };
}

function memberWithSnapshot(
  current: LoyaltyMemberSummary,
  snapshot: StoredMemberSnapshot,
): LoyaltyMemberSummary {
  return LoyaltyMemberSummarySchema.parse({ ...current, ...snapshot });
}

function rewardSnapshot(row: typeof rewards.$inferSelect): LoyaltyRewardSnapshot {
  return LoyaltyRewardSnapshotSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    costUnits: row.costUnits,
    valueCents: row.valueCents,
    productRef: row.productRef,
  });
}

function redemptionView(row: RedemptionRow): LoyaltyRedemptionView {
  const snapshot = storedObject(row.rewardSnapshot, 'de récompense');
  return {
    id: row.id,
    status: 'consumed',
    externalRef: row.externalRef,
    rulesVersion: assertStoredSafeInteger(
      snapshot.rulesVersion,
      'rulesVersion',
      true,
    ),
    reward: LoyaltyRewardSnapshotSchema.parse(snapshot.reward),
    consumedAt: mustRow(row.consumedAt, 'Consommation fidélité sans horodatage').toISOString(),
  };
}

function storedObject(result: unknown, label: string): Record<string, unknown> {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error(`Résultat ${label} fidélité illisible`);
  }
  return result as Record<string, unknown>;
}

function assertStoredUuid(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`Identifiant ${label} fidélité illisible`);
  }
  return value;
}

function assertStoredHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Empreinte ${label} fidélité illisible`);
  }
  return value;
}

function assertStoredSafeInteger(value: unknown, label: string, positive = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (positive ? value <= 0 : value < 0)
  ) {
    throw new Error(`Valeur ${label} fidélité illisible`);
  }
  return value;
}

function parseStoredMemberSnapshot(value: unknown): StoredMemberSnapshot {
  const stored = storedObject(value, 'de solde');
  const lastActivityAt = stored.lastActivityAt;
  if (
    lastActivityAt !== null &&
    (typeof lastActivityAt !== 'string' || !Number.isFinite(new Date(lastActivityAt).getTime()))
  ) {
    throw new Error('Horodatage de solde fidélité illisible');
  }
  return {
    balanceUnits: assertStoredSafeInteger(stored.balanceUnits, 'balanceUnits'),
    lifetimeEarnedUnits: assertStoredSafeInteger(
      stored.lifetimeEarnedUnits,
      'lifetimeEarnedUnits',
    ),
    lifetimeRedeemedUnits: assertStoredSafeInteger(
      stored.lifetimeRedeemedUnits,
      'lifetimeRedeemedUnits',
    ),
    lastActivityAt,
  };
}

interface MemberCursor {
  joinedAt: string;
  id: string;
}

function encodeMemberCursor(member: MemberRow): string {
  return Buffer.from(
    JSON.stringify({ joinedAt: member.joinedAt.toISOString(), id: member.id }),
    'utf8',
  ).toString('base64url');
}

function decodeMemberCursor(raw: string): { joinedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as MemberCursor;
    const joinedAt = new Date(parsed.joinedAt);
    if (
      !Number.isFinite(joinedAt.getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.id,
      )
    ) {
      throw new Error('cursor');
    }
    return { joinedAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Curseur de pagination fidélité invalide');
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

@Injectable()
export class LoyaltyMemberService {
  constructor(
    @Inject(LOYALTY_DB) private readonly db: LoyaltyDb,
    @Inject(LOYALTY_CRYPTO) private readonly crypto: LoyaltyCryptoAdapter,
    private readonly purchases: LoyaltyPurchaseVerifier,
  ) {}

  private identityFromRows(
    tenantRef: string,
    member: MemberRow,
    profile: MemberProfileRow | null | undefined,
  ): Pick<LoyaltyMemberSummary, 'alias' | 'maskedPhone'> {
    let firstName: string | null = null;
    let phone: string | null = null;
    if (profile && member.status !== 'anonymized') {
      const decrypted = this.crypto.decryptProfile(
        { tenantRef, memberId: member.id },
        JSON.parse(profile.encryptedPayload) as Parameters<
          LoyaltyCryptoAdapter['decryptProfile']
        >[1],
      );
      firstName = decrypted.firstName?.trim() || null;
      phone = decrypted.phone;
    }
    const alias =
      member.status === 'anonymized'
        ? 'Carte anonymisée'
        : firstName ??
          (phone ? `Client · ${phone.slice(-4)}` : `Carte ${member.id.slice(0, 8)}`);

    return { alias, maskedPhone: maskedPhone(phone) };
  }

  private summaryFromRows(
    tenantRef: string,
    member: MemberRow,
    profile: MemberProfileRow | null | undefined,
    wallet: WalletRow | null | undefined,
  ): LoyaltyMemberSummary {
    if (!wallet) return corruptedWallet();
    const identity = this.identityFromRows(tenantRef, member, profile);
    return LoyaltyMemberSummarySchema.parse({
      id: member.id,
      ...identity,
      status: member.status,
      balanceUnits: wallet.balanceUnits,
      lifetimeEarnedUnits: wallet.lifetimeEarnedUnits,
      lifetimeRedeemedUnits: wallet.lifetimeRedeemedUnits,
      lastActivityAt: member.lastActivityAt?.toISOString() ?? null,
      joinedAt: member.joinedAt.toISOString(),
    });
  }

  private async memberSummary(
    tx: LoyaltyTx,
    tenantRef: string,
    memberId: string,
    program?: CurrentProgram | null,
  ): Promise<LoyaltyMemberSummary> {
    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
      .limit(1);
    if (!member) throw new NotFoundException('Carte fidélité introuvable');

    const [profile] = await tx
      .select()
      .from(memberProfiles)
      .where(
        and(
          eq(memberProfiles.tenantRef, tenantRef),
          eq(memberProfiles.memberId, memberId),
        ),
      )
      .limit(1);
    const current = program === undefined ? await loadCurrentProgram(tx, tenantRef) : program;
    let wallet: WalletRow | undefined;
    if (current) {
      [wallet] = await tx
        .select()
        .from(wallets)
        .where(
          and(
            eq(wallets.tenantRef, tenantRef),
            eq(wallets.memberId, memberId),
            eq(wallets.programId, current.program.id),
          ),
        )
        .limit(1);
    }

    return this.summaryFromRows(tenantRef, member, profile, wallet);
  }

  private async assertActiveMember(
    tx: LoyaltyTx,
    tenantRef: string,
    memberId: string,
  ): Promise<MemberRow> {
    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
      .limit(1)
      .for('update');
    if (!member) throw new NotFoundException('Carte fidélité introuvable');
    if (member.status !== 'active') {
      throw new ConflictException('Cette carte fidélité est bloquée ou anonymisée');
    }
    return member;
  }

  private async issueEnrollmentToken(
    tx: LoyaltyTx,
    tenantRef: string,
    memberId: string,
    operationId: string,
  ): Promise<{ clearToken: string; tokenHash: string }> {
    const token = this.crypto.deriveEnrollmentQrToken({
      tenantRef,
      memberId,
      operationId,
    });
    await tx.insert(memberTokens).values({
      tenantRef,
      memberId,
      tokenHash: token.tokenHash,
      status: 'active',
    });
    return token;
  }

  private async replayEnrollmentToken(
    tx: LoyaltyTx,
    tenantRef: string,
    memberId: string,
    operationId: string,
    expectedHash: string,
  ): Promise<string> {
    const token = this.crypto.deriveEnrollmentQrToken({ tenantRef, memberId, operationId });
    if (token.tokenHash !== expectedHash) {
      throw new InternalServerErrorException(
        "La clé QR ne correspond plus à l'adhésion d'origine",
      );
    }
    const [storedToken] = await tx
      .select({ status: memberTokens.status })
      .from(memberTokens)
      .where(
        and(
          eq(memberTokens.tenantRef, tenantRef),
          eq(memberTokens.memberId, memberId),
          eq(memberTokens.tokenHash, expectedHash),
        ),
      )
      .limit(1);
    if (!storedToken) {
      throw new InternalServerErrorException('Jeton QR d’adhésion introuvable');
    }
    if (storedToken.status !== 'active') {
      throw new ConflictException('Le QR initial de cette carte a été révoqué');
    }
    return token.clearToken;
  }

  async createMember(
    tenantRef: string,
    dto: LoyaltyMemberCreate,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyMemberCreateResult> {
    let normalizedPhone: string | null = null;
    try {
      normalizedPhone = dto.phone ? normalizeFrenchPhoneToE164(dto.phone) : null;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Téléphone invalide',
      );
    }
    const normalizedDto = { ...dto, phone: normalizedPhone };
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'member_create',
      payload: {
        ...normalizedDto,
        source: actor.source,
        actorRef: actor.actorRef,
        deviceRef: actor.deviceRef,
      },
    });
    try {
      return await withLoyaltyTenant(this.db, tenantRef, async (tx) => {
        const claim = await claimOperation(tx, {
          tenantRef,
          operationId: dto.operationId,
          kind: 'member_create',
          fingerprint,
        });
        if (claim.replayed) {
          const stored = storedObject(claim.result, "d'adhésion");
          const memberId = assertStoredUuid(stored.memberId, 'membre');
          const qrTokenHash = assertStoredHash(stored.qrTokenHash, 'QR');
          const member = await this.memberSummary(tx, tenantRef, memberId);
          if (member.status === 'anonymized') {
            throw new ConflictException('Cette adhésion a depuis été anonymisée');
          }
          return {
            operationId: dto.operationId,
            replayed: true,
            member,
            qrToken: await this.replayEnrollmentToken(
              tx,
              tenantRef,
              member.id,
              dto.operationId,
              qrTokenHash,
            ),
          };
        }

        const current = await loadCurrentProgram(tx, tenantRef, true);
        if (!current || current.program.status !== 'active') {
          throw new ConflictException("Le programme de fidélité n'est pas actif");
        }

        const memberId = randomUUID();
        const profile = this.crypto.encryptProfile(
          { tenantRef, memberId },
          { firstName: normalizedDto.firstName, phone: normalizedDto.phone },
        );
        await tx.insert(members).values({ id: memberId, tenantRef });
        await tx.insert(memberProfiles).values({
          tenantRef,
          memberId,
          encryptedPayload: JSON.stringify(profile),
          phoneLookupHash: normalizedDto.phone
            ? this.crypto.phoneLookupHash(tenantRef, normalizedDto.phone)
            : null,
          keyVersion: profile.keyVersion,
        });
        await tx.insert(wallets).values({
          tenantRef,
          memberId,
          programId: current.program.id,
        });
        await tx.insert(membershipEvents).values({
          tenantRef,
          memberId,
          operationId: dto.operationId,
          kind: 'joined',
          termsNoticeVersion: normalizedDto.termsNoticeVersion,
          source: actor.source,
          actorRef: actor.actorRef,
        });
        const qrToken = await this.issueEnrollmentToken(
          tx,
          tenantRef,
          memberId,
          dto.operationId,
        );
        const member = await this.memberSummary(tx, tenantRef, memberId, current);
        await completeOperation(tx, tenantRef, dto.operationId, {
          memberId,
          qrTokenHash: qrToken.tokenHash,
        });
        return {
          operationId: dto.operationId,
          replayed: false,
          member,
          qrToken: qrToken.clearToken,
        };
      });
    } catch (error) {
      if (isUniqueConstraint(error, 'member_profiles_tenant_phone_uq')) {
        throw new ConflictException('Ce téléphone est déjà rattaché à une carte fidélité');
      }
      throw error;
    }
  }

  async resolveMember(
    tenantRef: string,
    lookup: LoyaltyMemberResolve,
  ): Promise<LoyaltyMemberSummary> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      let memberId: string | null = null;
      if (lookup.by === 'member_ref') {
        memberId = lookup.memberRef;
      } else if (lookup.by === 'phone') {
        let phoneHash: string;
        try {
          phoneHash = this.crypto.phoneLookupHash(tenantRef, lookup.phone);
        } catch (error) {
          throw new BadRequestException(error instanceof Error ? error.message : 'Téléphone invalide');
        }
        const [profile] = await tx
          .select({ memberId: memberProfiles.memberId })
          .from(memberProfiles)
          .where(
            and(
              eq(memberProfiles.tenantRef, tenantRef),
              eq(memberProfiles.phoneLookupHash, phoneHash),
            ),
          )
          .limit(1);
        memberId = profile?.memberId ?? null;
      } else {
        let tokenHash: string;
        try {
          tokenHash = hashLoyaltyQrToken(lookup.qrToken);
        } catch {
          throw new NotFoundException('Carte fidélité introuvable');
        }
        const now = new Date();
        const [token] = await tx
          .select({ memberId: memberTokens.memberId })
          .from(memberTokens)
          .where(
            and(
              eq(memberTokens.tenantRef, tenantRef),
              eq(memberTokens.tokenHash, tokenHash),
              eq(memberTokens.status, 'active'),
              or(isNull(memberTokens.expiresAt), gt(memberTokens.expiresAt, now)),
            ),
          )
          .limit(1);
        memberId = token?.memberId ?? null;
      }
      if (!memberId) throw new NotFoundException('Carte fidélité introuvable');
      return this.memberSummary(tx, tenantRef, memberId);
    });
  }

  async earn(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyEarn,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyEarnResult> {
    if ((actor.source === 'pos' || actor.source === 'online') && dto.externalRef === null) {
      throw new BadRequestException('La référence du ticket est obligatoire pour ce canal');
    }
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'earn',
      // Une file offline peut être reprise après changement d'équipier. Le
      // ticket, le membre, le montant et le canal définissent l'intention ;
      // l'auteur/appareil de la PREMIÈRE écriture restent figés dans le ledger.
      payload: { memberId, ...dto, source: actor.source },
    });
    try {
      return await withLoyaltyTenant(this.db, tenantRef, async (tx) => {
        const claim = await claimOperation(tx, {
          tenantRef,
          operationId: dto.operationId,
          kind: 'earn',
          fingerprint,
        });
        if (claim.replayed) {
          const stored = storedObject(claim.result, 'de gain');
          const storedMemberId = assertStoredUuid(stored.memberId, 'membre');
          if (storedMemberId !== memberId) throw new Error('Membre du gain rejoué incohérent');
          const outcome = stored.outcome;
          if (outcome !== 'earned' && outcome !== 'below_minimum') {
            throw new Error('Issue du gain fidélité illisible');
          }
          const ledgerEntryId =
            stored.ledgerEntryId === null
              ? null
              : assertStoredUuid(stored.ledgerEntryId, 'ledger');
          const [ledger] = ledgerEntryId
            ? await tx
                .select()
                .from(ledgerEntries)
                .where(
                  and(
                    eq(ledgerEntries.tenantRef, tenantRef),
                    eq(ledgerEntries.id, ledgerEntryId),
                    eq(ledgerEntries.operationId, dto.operationId),
                  ),
                )
                .limit(1)
            : [];
          if (ledgerEntryId && !ledger) return corruptedWallet();
          const currentMember = await this.memberSummary(tx, tenantRef, memberId);
          return LoyaltyEarnResultSchema.parse({
            operationId: dto.operationId,
            replayed: true,
            outcome,
            awardedUnits: assertStoredSafeInteger(stored.awardedUnits, 'awardedUnits'),
            rulesVersion: assertStoredSafeInteger(
              stored.rulesVersion,
              'rulesVersion',
              true,
            ),
            member: memberWithSnapshot(
              currentMember,
              parseStoredMemberSnapshot(stored.memberSnapshot),
            ),
            entry: ledger ? ledgerView(ledger) : null,
          });
        }

        // Une opération déjà achevée doit rejouer son résultat même si la
        // commande a depuis été remboursée ou si Mongo est momentanément
        // indisponible. Seule une NOUVELLE mutation revalide la preuve mutable.
        const purchaseCents =
          actor.source === 'pos'
            ? await this.purchases.confirmedPurchaseCents({
                tenantRef,
                memberId,
                externalRef: dto.externalRef!,
                claimedPurchaseCents: dto.purchaseCents,
              })
            : dto.purchaseCents;

        const current = await loadCurrentProgram(tx, tenantRef, true);
        if (!current) throw new ConflictException('Programme de fidélité non configuré');
        await this.assertActiveMember(tx, tenantRef, memberId);
        if (dto.externalRef !== null) {
          await tx.insert(earnReceipts).values({
            tenantRef,
            source: actor.source,
            externalRef: dto.externalRef,
            operationId: dto.operationId,
            memberId,
          });
        }
        const [walletBefore] = await tx
          .select()
          .from(wallets)
          .where(
            and(
              eq(wallets.tenantRef, tenantRef),
              eq(wallets.memberId, memberId),
              eq(wallets.programId, current.program.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!walletBefore) return corruptedWallet();

        const calculated = loyaltyDomain.calculateLoyaltyEarn(
          { status: current.program.status, earn: currentEarnRule(current.version) },
          Money.fromCents(purchaseCents),
        );
        if (!calculated.ok) throw new ConflictException(calculated.error.message);

        const now = new Date();
        let entry: LoyaltyEarnResult['entry'] = null;
        if (calculated.value.units > 0) {
          const balanceAfter = safeUnitAddition(
            walletBefore.balanceUnits,
            calculated.value.units,
          );
          const lifetimeEarnedUnits = safeUnitAddition(
            walletBefore.lifetimeEarnedUnits,
            calculated.value.units,
          );
          const walletVersion = safeUnitAddition(walletBefore.version, 1);
          const wallet = mustRow(
            (
              await tx
                .update(wallets)
                .set({
                  balanceUnits: balanceAfter,
                  lifetimeEarnedUnits,
                  version: walletVersion,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(wallets.tenantRef, tenantRef),
                    eq(wallets.memberId, memberId),
                    eq(wallets.programId, current.program.id),
                    eq(wallets.version, walletBefore.version),
                  ),
                )
                .returning()
            )[0],
            'Wallet fidélité modifié en parallèle',
          );
          const row = mustRow(
            (
              await tx
                .insert(ledgerEntries)
                .values({
                  tenantRef,
                  memberId,
                  programId: current.program.id,
                  operationId: dto.operationId,
                  kind: 'earn',
                  deltaUnits: calculated.value.units,
                  balanceAfter: wallet.balanceUnits,
                  source: actor.source,
                  externalRef: dto.externalRef,
                  actorRef: actor.actorRef,
                  deviceRef: actor.deviceRef,
                  rulesVersion: current.program.currentVersion,
                  walletVersion: wallet.version,
                  reason: 'Gain automatique sur achat',
                  occurredAt: now,
                })
                .returning()
            )[0],
          );
          entry = ledgerView(row);
        }
        await tx
          .update(members)
          .set({ lastActivityAt: now })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));
        const member = await this.memberSummary(tx, tenantRef, memberId, current);
        const result = LoyaltyEarnResultSchema.parse({
          operationId: dto.operationId,
          replayed: false,
          outcome: calculated.value.reason,
          awardedUnits: calculated.value.units,
          rulesVersion: current.program.currentVersion,
          member,
          entry,
        });
        await completeOperation(tx, tenantRef, dto.operationId, {
          memberId,
          outcome: result.outcome,
          awardedUnits: result.awardedUnits,
          rulesVersion: result.rulesVersion,
          ledgerEntryId: entry?.id ?? null,
          memberSnapshot: memberSnapshot(member),
        });
        return result;
      });
    } catch (error) {
      if (
        isUniqueConstraint(error, 'earn_receipts_tenant_source_external_ref_uq') ||
        isUniqueConstraint(error, 'ledger_earn_external_ref_uq')
      ) {
        throw new ConflictException('Ce ticket a déjà été traité en fidélité');
      }
      throw error;
    }
  }

  async redeem(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyRedeem,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyRedeemResult> {
    const expectedReference =
      actor.source === 'pos'
        ? POS_REDEMPTION_REFERENCE
        : actor.source === 'online'
          ? ONLINE_REDEMPTION_REFERENCE
          : null;
    if (expectedReference && !expectedReference.test(dto.externalRef ?? '')) {
      throw new BadRequestException(
        'La référence de consommation de ce canal est invalide',
      );
    }
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'redeem',
      payload: { memberId, ...dto, ...actor },
    });
    try {
      return await withLoyaltyTenant(this.db, tenantRef, async (tx) => {
        const claim = await claimOperation(tx, {
          tenantRef,
          operationId: dto.operationId,
          kind: 'redeem',
          fingerprint,
        });
        if (claim.replayed) {
          const stored = storedObject(claim.result, 'de consommation');
          const storedMemberId = assertStoredUuid(stored.memberId, 'membre');
          if (storedMemberId !== memberId) {
            throw new Error('Membre de la consommation rejouée incohérent');
          }
          const ledgerEntryId = assertStoredUuid(stored.ledgerEntryId, 'ledger');
          const redemptionId = assertStoredUuid(stored.redemptionId, 'consommation');
          const [ledger] = await tx
            .select()
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenantRef, tenantRef),
                eq(ledgerEntries.id, ledgerEntryId),
                eq(ledgerEntries.operationId, dto.operationId),
              ),
            )
            .limit(1);
          const [storedRedemption] = await tx
            .select()
            .from(redemptions)
            .where(
              and(
                eq(redemptions.tenantRef, tenantRef),
                eq(redemptions.id, redemptionId),
                eq(redemptions.operationId, dto.operationId),
              ),
            )
            .limit(1);
          if (!ledger || !storedRedemption) return corruptedWallet();
          const currentMember = await this.memberSummary(tx, tenantRef, memberId);
          return LoyaltyRedeemResultSchema.parse({
            operationId: dto.operationId,
            replayed: true,
            member: memberWithSnapshot(
              currentMember,
              parseStoredMemberSnapshot(stored.memberSnapshot),
            ),
            entry: ledgerView(ledger),
            redemption: redemptionView(storedRedemption),
          });
        }

        if (dto.externalRef !== null) {
          const [duplicateRedemption] = await tx
            .select({ operationId: ledgerEntries.operationId })
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenantRef, tenantRef),
                eq(ledgerEntries.kind, 'redeem'),
                eq(ledgerEntries.source, actor.source),
                eq(ledgerEntries.externalRef, dto.externalRef),
              ),
            )
            .limit(1);
          if (duplicateRedemption) {
            throw new ConflictException(
              'Ce ticket a déjà consommé une récompense fidélité',
            );
          }
        }

        const current = await loadCurrentProgram(tx, tenantRef, true);
        if (!current || current.program.status !== 'active') {
          throw new ConflictException("Le programme de fidélité n'est pas actif");
        }
        await this.assertActiveMember(tx, tenantRef, memberId);
        const [reward] = await tx
          .select()
          .from(rewards)
          .where(
            and(
              eq(rewards.tenantRef, tenantRef),
              eq(rewards.id, dto.rewardId),
              eq(rewards.programId, current.program.id),
              eq(rewards.active, true),
            ),
          )
          .limit(1)
          .for('share');
        if (!reward) throw new NotFoundException('Récompense indisponible');
        if (reward.costUnits !== dto.expectedCostUnits) {
          throw new ConflictException(
            `Le coût de la récompense a changé (${reward.costUnits} unités)`,
          );
        }

        const [walletBefore] = await tx
          .select()
          .from(wallets)
          .where(
            and(
              eq(wallets.tenantRef, tenantRef),
              eq(wallets.memberId, memberId),
              eq(wallets.programId, current.program.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!walletBefore) return corruptedWallet();
        const redemption = loyaltyDomain.redeemLoyaltyUnits(
          walletBefore.balanceUnits,
          reward.costUnits,
        );
        if (!redemption.ok) throw new ConflictException(redemption.error.message);

        const now = new Date();
        const wallet = mustRow(
          (
            await tx
              .update(wallets)
              .set({
                balanceUnits: redemption.value.balanceAfter,
                lifetimeRedeemedUnits: safeUnitAddition(
                  walletBefore.lifetimeRedeemedUnits,
                  reward.costUnits,
                ),
                version: safeUnitAddition(walletBefore.version, 1),
                updatedAt: now,
              })
              .where(
                and(
                  eq(wallets.tenantRef, tenantRef),
                  eq(wallets.memberId, memberId),
                  eq(wallets.programId, current.program.id),
                  eq(wallets.version, walletBefore.version),
                ),
              )
              .returning()
          )[0],
          'Wallet fidélité modifié en parallèle',
        );
        const authoritativeReward = rewardSnapshot(reward);
        const persistedRewardSnapshot = {
          rulesVersion: current.program.currentVersion,
          reward: authoritativeReward,
        };
        const ledger = mustRow(
          (
            await tx
              .insert(ledgerEntries)
              .values({
                tenantRef,
                memberId,
                programId: current.program.id,
                operationId: dto.operationId,
                kind: 'redeem',
                deltaUnits: -reward.costUnits,
                balanceAfter: wallet.balanceUnits,
                source: actor.source,
                externalRef: dto.externalRef,
                actorRef: actor.actorRef,
                deviceRef: actor.deviceRef,
                rulesVersion: current.program.currentVersion,
                walletVersion: wallet.version,
                reason: reward.name,
                rewardSnapshot: persistedRewardSnapshot,
                occurredAt: now,
              })
              .returning()
          )[0],
        );
        const storedRedemption = mustRow(
          (
            await tx
              .insert(redemptions)
              .values({
                tenantRef,
                memberId,
                programId: current.program.id,
                rewardId: reward.id,
                operationId: dto.operationId,
                ledgerEntryId: ledger.id,
                externalRef: dto.externalRef,
                status: 'consumed',
                rewardSnapshot: persistedRewardSnapshot,
                reservedAt: now,
                consumedAt: now,
              })
              .returning()
          )[0],
        );
        await tx
          .update(members)
          .set({ lastActivityAt: now })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));

        const member = await this.memberSummary(tx, tenantRef, memberId, current);
        const result = LoyaltyRedeemResultSchema.parse({
          operationId: dto.operationId,
          replayed: false,
          member,
          entry: ledgerView(ledger),
          redemption: redemptionView(storedRedemption),
        });
        await completeOperation(tx, tenantRef, dto.operationId, {
          memberId,
          ledgerEntryId: ledger.id,
          redemptionId: storedRedemption.id,
          memberSnapshot: memberSnapshot(member),
        });
        return result;
      });
    } catch (error) {
      if (isUniqueConstraint(error, 'ledger_redeem_external_ref_uq')) {
        throw new ConflictException(
          'Ce ticket a déjà consommé une récompense fidélité',
        );
      }
      throw error;
    }
  }

  async adjust(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyAdminAdjustment,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyMutationResult> {
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'adjust',
      payload: { memberId, ...dto, ...actor },
    });
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const claim = await claimOperation(tx, {
        tenantRef,
        operationId: dto.operationId,
        kind: 'adjust',
        fingerprint,
      });
      if (claim.replayed) {
        const stored = storedObject(claim.result, 'de correction');
        const storedMemberId = assertStoredUuid(stored.memberId, 'membre');
        if (storedMemberId !== memberId) {
          throw new Error('Membre de la correction rejouée incohérent');
        }
        const ledgerEntryId = assertStoredUuid(stored.ledgerEntryId, 'ledger');
        const [ledger] = await tx
          .select()
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.tenantRef, tenantRef),
              eq(ledgerEntries.id, ledgerEntryId),
              eq(ledgerEntries.operationId, dto.operationId),
            ),
          )
          .limit(1);
        if (!ledger) return corruptedWallet();
        const currentMember = await this.memberSummary(tx, tenantRef, memberId);
        return LoyaltyMutationResultSchema.parse({
          operationId: dto.operationId,
          replayed: true,
          member: memberWithSnapshot(
            currentMember,
            parseStoredMemberSnapshot(stored.memberSnapshot),
          ),
          entry: ledgerView(ledger),
        });
      }

      const current = await loadCurrentProgram(tx, tenantRef, true);
      if (!current) throw new ConflictException('Programme de fidélité non configuré');
      await this.assertActiveMember(tx, tenantRef, memberId);
      const [walletBefore] = await tx
        .select()
        .from(wallets)
        .where(
          and(
            eq(wallets.tenantRef, tenantRef),
            eq(wallets.memberId, memberId),
            eq(wallets.programId, current.program.id),
          ),
        )
        .limit(1)
        .for('update');
      if (!walletBefore) return corruptedWallet();
      const balanceAfter = safeUnitAddition(walletBefore.balanceUnits, dto.units);
      if (balanceAfter < 0) {
        throw new ConflictException(
          `Solde insuffisant : ${walletBefore.balanceUnits} disponible, ${Math.abs(dto.units)} retiré`,
        );
      }

      const now = new Date();
      const wallet = mustRow(
        (
          await tx
            .update(wallets)
            .set({
              balanceUnits: balanceAfter,
              version: safeUnitAddition(walletBefore.version, 1),
              updatedAt: now,
            })
            .where(
              and(
                eq(wallets.tenantRef, tenantRef),
                eq(wallets.memberId, memberId),
                eq(wallets.programId, current.program.id),
                eq(wallets.version, walletBefore.version),
              ),
            )
            .returning()
        )[0],
        'Wallet fidélité modifié en parallèle',
      );
      const ledger = mustRow(
        (
          await tx
            .insert(ledgerEntries)
            .values({
              tenantRef,
              memberId,
              programId: current.program.id,
              operationId: dto.operationId,
              kind: dto.units > 0 ? 'adjust_credit' : 'adjust_debit',
              deltaUnits: dto.units,
              balanceAfter: wallet.balanceUnits,
              source: actor.source,
              actorRef: actor.actorRef,
              deviceRef: actor.deviceRef,
              rulesVersion: current.program.currentVersion,
              walletVersion: wallet.version,
              reason: dto.reason,
              occurredAt: now,
            })
            .returning()
        )[0],
      );
      await tx
        .update(members)
        .set({ lastActivityAt: now })
        .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));

      const member = await this.memberSummary(tx, tenantRef, memberId, current);
      const result = LoyaltyMutationResultSchema.parse({
        operationId: dto.operationId,
        replayed: false,
        member,
        entry: ledgerView(ledger),
      });
      await completeOperation(tx, tenantRef, dto.operationId, {
        memberId,
        ledgerEntryId: ledger.id,
        memberSnapshot: memberSnapshot(member),
      });
      return result;
    });
  }

  /**
   * Ajoute une compensation exacte à un gain ou une consommation existante.
   *
   * Le ledger reste append-only : l'origine n'est jamais modifiée. Le membre
   * puis son wallet sont verrouillés avant le calcul, et l'unicité
   * `reversed_entry_id` constitue le dernier rempart contre deux compensations
   * concurrentes de la même écriture.
   */
  async reverseLedgerEntry(
    tenantRef: string,
    memberId: string,
    originalEntryId: string,
    dto: LoyaltyLedgerReversal,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyLedgerReversalResult> {
    if (actor.source !== 'admin' && actor.source !== 'system') {
      throw new ForbiddenException(
        'Une compensation fidélité exige un gérant ou un traitement système',
      );
    }
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'reverse',
      payload: { memberId, originalEntryId, ...dto, ...actor },
    });

    try {
      return await withLoyaltyTenant(this.db, tenantRef, async (tx) => {
        const claim = await claimOperation(tx, {
          tenantRef,
          operationId: dto.operationId,
          kind: 'reverse',
          fingerprint,
        });
        if (claim.replayed) {
          const stored = storedObject(claim.result, 'de compensation');
          const storedMemberId = assertStoredUuid(stored.memberId, 'membre');
          const storedOriginalEntryId = assertStoredUuid(
            stored.originalEntryId,
            "ledger d'origine",
          );
          const reversalEntryId = assertStoredUuid(
            stored.reversalEntryId,
            'ledger de compensation',
          );
          if (
            storedMemberId !== memberId ||
            storedOriginalEntryId !== originalEntryId
          ) {
            throw new Error('Cible de la compensation rejouée incohérente');
          }
          const rows = await tx
            .select()
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.tenantRef, tenantRef),
                eq(ledgerEntries.memberId, memberId),
                or(
                  eq(ledgerEntries.id, originalEntryId),
                  eq(ledgerEntries.id, reversalEntryId),
                ),
              ),
            );
          const original = rows.find((row) => row.id === originalEntryId);
          const reversal = rows.find((row) => row.id === reversalEntryId);
          if (
            !original ||
            !reversal ||
            reversal.operationId !== dto.operationId ||
            reversal.reversedEntryId !== original.id
          ) {
            return corruptedWallet();
          }
          const currentMember = await this.memberSummary(tx, tenantRef, memberId);
          return LoyaltyLedgerReversalResultSchema.parse({
            operationId: dto.operationId,
            replayed: true,
            member: memberWithSnapshot(
              currentMember,
              parseStoredMemberSnapshot(stored.memberSnapshot),
            ),
            originalEntry: ledgerView(original),
            entry: ledgerView(reversal),
          });
        }

        const [member] = await tx
          .select()
          .from(members)
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
          .limit(1)
          .for('update');
        if (!member) throw new NotFoundException('Carte fidélité introuvable');

        const [original] = await tx
          .select()
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.tenantRef, tenantRef),
              eq(ledgerEntries.memberId, memberId),
              eq(ledgerEntries.id, originalEntryId),
            ),
          )
          .limit(1)
          .for('share');
        if (!original) throw new NotFoundException('Écriture fidélité introuvable');
        if (original.kind !== 'earn' && original.kind !== 'redeem') {
          throw new ConflictException(
            'Seuls un gain ou une consommation peuvent être compensés',
          );
        }

        const [existingReversal] = await tx
          .select({ id: ledgerEntries.id })
          .from(ledgerEntries)
          .where(
            and(
              eq(ledgerEntries.tenantRef, tenantRef),
              eq(ledgerEntries.memberId, memberId),
              eq(ledgerEntries.programId, original.programId),
              eq(ledgerEntries.reversedEntryId, original.id),
            ),
          )
          .limit(1);
        if (existingReversal) {
          throw new ConflictException('Cette écriture fidélité a déjà été compensée');
        }

        const [walletBefore] = await tx
          .select()
          .from(wallets)
          .where(
            and(
              eq(wallets.tenantRef, tenantRef),
              eq(wallets.memberId, memberId),
              eq(wallets.programId, original.programId),
            ),
          )
          .limit(1)
          .for('update');
        if (!walletBefore) return corruptedWallet();

        const reversalDelta = -original.deltaUnits;
        const balanceAfter = safeUnitAddition(
          walletBefore.balanceUnits,
          reversalDelta,
        );
        if (balanceAfter < 0) {
          throw new ConflictException(
            `Compensation impossible : ${walletBefore.balanceUnits} unité(s) disponible(s), ${original.deltaUnits} à retirer`,
          );
        }
        const lifetimeEarnedUnits =
          original.kind === 'earn'
            ? safeUnitAddition(
                walletBefore.lifetimeEarnedUnits,
                -original.deltaUnits,
              )
            : walletBefore.lifetimeEarnedUnits;
        const lifetimeRedeemedUnits =
          original.kind === 'redeem'
            ? safeUnitAddition(
                walletBefore.lifetimeRedeemedUnits,
                original.deltaUnits,
              )
            : walletBefore.lifetimeRedeemedUnits;
        if (lifetimeEarnedUnits < 0 || lifetimeRedeemedUnits < 0) {
          return corruptedWallet();
        }

        const now = new Date();
        const wallet = mustRow(
          (
            await tx
              .update(wallets)
              .set({
                balanceUnits: balanceAfter,
                lifetimeEarnedUnits,
                lifetimeRedeemedUnits,
                version: safeUnitAddition(walletBefore.version, 1),
                updatedAt: now,
              })
              .where(
                and(
                  eq(wallets.tenantRef, tenantRef),
                  eq(wallets.memberId, memberId),
                  eq(wallets.programId, original.programId),
                  eq(wallets.version, walletBefore.version),
                ),
              )
              .returning()
          )[0],
          'Wallet fidélité modifié en parallèle',
        );
        const reversal = mustRow(
          (
            await tx
              .insert(ledgerEntries)
              .values({
                tenantRef,
                memberId,
                programId: original.programId,
                operationId: dto.operationId,
                kind: 'reverse',
                deltaUnits: reversalDelta,
                balanceAfter: wallet.balanceUnits,
                source: actor.source,
                externalRef: original.externalRef,
                actorRef: actor.actorRef,
                deviceRef: actor.deviceRef,
                rulesVersion: original.rulesVersion,
                walletVersion: wallet.version,
                reason: dto.reason,
                reversedEntryId: original.id,
                occurredAt: now,
              })
              .returning()
          )[0],
        );

        if (original.kind === 'redeem') {
          const [reversedRedemption] = await tx
            .update(redemptions)
            .set({ status: 'reversed', reversedAt: now })
            .where(
              and(
                eq(redemptions.tenantRef, tenantRef),
                eq(redemptions.memberId, memberId),
                eq(redemptions.programId, original.programId),
                eq(redemptions.ledgerEntryId, original.id),
                eq(redemptions.status, 'consumed'),
              ),
            )
            .returning({ id: redemptions.id });
          if (!reversedRedemption) return corruptedWallet();
        }

        await tx
          .update(members)
          .set({ lastActivityAt: now })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));

        const currentMember = await this.memberSummary(tx, tenantRef, memberId);
        const result = LoyaltyLedgerReversalResultSchema.parse({
          operationId: dto.operationId,
          replayed: false,
          member: currentMember,
          originalEntry: ledgerView(original),
          entry: ledgerView(reversal),
        });
        await completeOperation(tx, tenantRef, dto.operationId, {
          memberId,
          originalEntryId: original.id,
          reversalEntryId: reversal.id,
          memberSnapshot: memberSnapshot(currentMember),
        });
        return result;
      });
    } catch (error) {
      if (isUniqueConstraint(error, 'ledger_reversed_entry_uq')) {
        throw new ConflictException('Cette écriture fidélité a déjà été compensée');
      }
      throw error;
    }
  }

  async recordConsent(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyConsentEvent,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyConsentMutationResult> {
    if (dto.purpose === 'marketing_sms' && dto.decision === 'granted') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: LOYALTY_SMS_GRANT_DISABLED_CODE,
        message: LOYALTY_SMS_GRANT_DISABLED_MESSAGE,
      });
    }
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'consent',
      payload: { memberId, ...dto, ...actor },
    });
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const claim = await claimOperation(tx, {
        tenantRef,
        operationId: dto.operationId,
        kind: 'consent',
        fingerprint,
      });
      if (claim.replayed) {
        const parsed = LoyaltyConsentMutationResultSchema.safeParse(claim.result);
        if (!parsed.success) throw new Error('Résultat de consentement fidélité illisible');
        return { ...parsed.data, replayed: true };
      }

      const [member] = await tx
        .select({ status: members.status })
        .from(members)
        .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
        .limit(1)
        .for('update');
      if (!member) throw new NotFoundException('Carte fidélité introuvable');
      if (member.status === 'anonymized') {
        throw new ConflictException('Cette carte fidélité est anonymisée');
      }
      if (dto.decision === 'granted' && member.status !== 'active') {
        throw new ConflictException(
          'Seule une carte active peut recevoir un consentement marketing',
        );
      }
      if (dto.decision === 'granted') {
        const [profile] = await tx
          .select({ phoneLookupHash: memberProfiles.phoneLookupHash })
          .from(memberProfiles)
          .where(
            and(
              eq(memberProfiles.tenantRef, tenantRef),
              eq(memberProfiles.memberId, memberId),
            ),
          )
          .limit(1);
        if (dto.purpose === 'marketing_sms' && !profile?.phoneLookupHash) {
          throw new ConflictException('Ajoutez un téléphone avant le consentement SMS');
        }
        if (dto.purpose === 'marketing_email') {
          throw new ConflictException("L'adresse e-mail client n'est pas encore renseignée");
        }
      }

      const event = mustRow(
        (
          await tx
            .insert(consentEvents)
            .values({
              tenantRef,
              memberId,
              operationId: dto.operationId,
              purpose: dto.purpose,
              decision: dto.decision,
              noticeVersion: dto.noticeVersion,
              source: actor.source,
              actorRef: actor.actorRef,
            })
            .returning()
        )[0],
      );
      const state = mustRow(
        (
          await tx
            .insert(consentState)
            .values({
              tenantRef,
              memberId,
              purpose: dto.purpose,
              decision: dto.decision,
              noticeVersion: dto.noticeVersion,
              eventId: event.id,
              updatedAt: event.recordedAt,
            })
            .onConflictDoUpdate({
              target: [consentState.tenantRef, consentState.memberId, consentState.purpose],
              set: {
                decision: dto.decision,
                noticeVersion: dto.noticeVersion,
                eventId: event.id,
                updatedAt: event.recordedAt,
              },
            })
            .returning()
        )[0],
      );
      const consent = LoyaltyConsentStateViewSchema.parse({
        purpose: state.purpose,
        decision: state.decision,
        noticeVersion: state.noticeVersion,
        updatedAt: state.updatedAt.toISOString(),
      });
      const result = LoyaltyConsentMutationResultSchema.parse({
        operationId: dto.operationId,
        replayed: false,
        consent,
      });
      await completeOperation(tx, tenantRef, dto.operationId, result);
      return result;
    });
  }

  /**
   * Bloque, réactive ou anonymise une carte sous verrou transactionnel.
   *
   * Le résultat persistant ne contient volontairement ni alias ni téléphone :
   * une anonymisation ultérieure ne doit pas laisser de PII dans l'inbox
   * d'idempotence. Le registre financier reste intact et pseudonymisé.
   */
  async changeLifecycle(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyMemberLifecycle,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyMemberLifecycleResult> {
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'member_lifecycle',
      payload: { memberId, ...dto, ...actor },
    });
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const claim = await claimOperation(tx, {
        tenantRef,
        operationId: dto.operationId,
        kind: 'member_lifecycle',
        fingerprint,
      });
      if (claim.replayed) {
        const parsed = LoyaltyMemberLifecycleResultSchema.safeParse(claim.result);
        if (!parsed.success || parsed.data.memberId !== memberId) {
          throw new Error('Résultat de cycle de vie fidélité illisible');
        }
        return { ...parsed.data, replayed: true };
      }

      const [member] = await tx
        .select()
        .from(members)
        .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
        .limit(1)
        .for('update');
      if (!member) throw new NotFoundException('Carte fidélité introuvable');

      const now = new Date();
      let nextStatus: 'active' | 'blocked' | 'anonymized';
      let eventKind: 'blocked' | 'unblocked' | 'anonymized';
      let revokedTokens = 0;
      let withdrawnConsents = 0;

      if (dto.action === 'block') {
        if (member.status !== 'active') {
          throw new ConflictException('Seule une carte active peut être bloquée');
        }
        nextStatus = 'blocked';
        eventKind = 'blocked';
        await tx
          .update(members)
          .set({ status: 'blocked', blockedAt: now, anonymizedAt: null })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));
      } else if (dto.action === 'unblock') {
        if (member.status !== 'blocked') {
          throw new ConflictException('Seule une carte bloquée peut être réactivée');
        }
        nextStatus = 'active';
        eventKind = 'unblocked';
        await tx
          .update(members)
          .set({ status: 'active', blockedAt: null, anonymizedAt: null })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));
      } else {
        if (member.status === 'anonymized') {
          throw new ConflictException('Cette carte est déjà anonymisée');
        }
        nextStatus = 'anonymized';
        eventKind = 'anonymized';

        const revoked = await tx
          .update(memberTokens)
          .set({ status: 'revoked', revokedAt: now })
          .where(
            and(
              eq(memberTokens.tenantRef, tenantRef),
              eq(memberTokens.memberId, memberId),
              eq(memberTokens.status, 'active'),
            ),
          )
          .returning({ id: memberTokens.id });
        revokedTokens = revoked.length;

        const grantedConsents = await tx
          .select()
          .from(consentState)
          .where(
            and(
              eq(consentState.tenantRef, tenantRef),
              eq(consentState.memberId, memberId),
              eq(consentState.decision, 'granted'),
            ),
          )
          .for('update');
        for (const state of grantedConsents) {
          const consentOperationId = randomUUID();
          const consentFingerprint = this.crypto.operationFingerprint({
            tenantRef,
            kind: 'consent',
            payload: {
              memberId,
              purpose: state.purpose,
              decision: 'withdrawn',
              noticeVersion: state.noticeVersion,
              source: actor.source,
              actorRef: actor.actorRef,
              deviceRef: actor.deviceRef,
              cause: 'member_anonymized',
            },
          });
          await tx.insert(operations).values({
            tenantRef,
            operationId: consentOperationId,
            kind: 'consent',
            requestFingerprint: consentFingerprint,
          });
          const event = mustRow(
            (
              await tx
                .insert(consentEvents)
                .values({
                  tenantRef,
                  memberId,
                  operationId: consentOperationId,
                  purpose: state.purpose,
                  decision: 'withdrawn',
                  noticeVersion: state.noticeVersion,
                  source: actor.source,
                  actorRef: actor.actorRef,
                })
                .returning()
            )[0],
          );
          const consent = LoyaltyConsentStateViewSchema.parse({
            purpose: event.purpose,
            decision: event.decision,
            noticeVersion: event.noticeVersion,
            updatedAt: event.recordedAt.toISOString(),
          });
          await tx
            .update(consentState)
            .set({
              decision: 'withdrawn',
              noticeVersion: event.noticeVersion,
              eventId: event.id,
              updatedAt: event.recordedAt,
            })
            .where(
              and(
                eq(consentState.tenantRef, tenantRef),
                eq(consentState.memberId, memberId),
                eq(consentState.purpose, state.purpose),
              ),
            );
          await completeOperation(tx, tenantRef, consentOperationId, {
            operationId: consentOperationId,
            replayed: false,
            consent,
          });
          withdrawnConsents += 1;
        }

        await tx
          .delete(memberProfiles)
          .where(
            and(
              eq(memberProfiles.tenantRef, tenantRef),
              eq(memberProfiles.memberId, memberId),
            ),
          );
        await tx
          .update(members)
          .set({ status: 'anonymized', blockedAt: null, anonymizedAt: now })
          .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)));
      }

      await tx.insert(membershipEvents).values({
        tenantRef,
        memberId,
        operationId: dto.operationId,
        kind: eventKind,
        reason: dto.reasonCode,
        source: actor.source,
        actorRef: actor.actorRef,
      });
      const result = LoyaltyMemberLifecycleResultSchema.parse({
        operationId: dto.operationId,
        replayed: false,
        action: dto.action,
        memberId,
        status: nextStatus,
        revokedTokens,
        withdrawnConsents,
      });
      await completeOperation(tx, tenantRef, dto.operationId, result);
      return result;
    });
  }

  /**
   * Révoque le QR courant puis remet un unique secret neuf.
   *
   * `expectedGeneration` rend la rotation optimiste : deux intentions parties
   * de la même fiche ne peuvent pas toutes deux réussir et rendre le premier
   * QR neuf immédiatement obsolète.
   */
  async replaceQr(
    tenantRef: string,
    memberId: string,
    dto: LoyaltyMemberQrReplace,
    actor: LoyaltyActorContext,
  ): Promise<LoyaltyMemberQrReplaceResult> {
    const fingerprint = this.crypto.operationFingerprint({
      tenantRef,
      kind: 'token_replace',
      payload: { memberId, ...dto, ...actor },
    });
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const claim = await claimOperation(tx, {
        tenantRef,
        operationId: dto.operationId,
        kind: 'token_replace',
        fingerprint,
      });
      if (claim.replayed) {
        const stored = storedObject(claim.result, 'de remplacement QR');
        const storedMemberId = assertStoredUuid(stored.memberId, 'membre');
        if (storedMemberId !== memberId) {
          throw new Error('Membre du remplacement QR rejoué incohérent');
        }
        const tokenHash = assertStoredHash(stored.qrTokenHash, 'QR');
        const previousGeneration = assertStoredSafeInteger(
          stored.previousGeneration,
          'previousGeneration',
          true,
        );
        const qrGeneration = assertStoredSafeInteger(
          stored.qrGeneration,
          'qrGeneration',
          true,
        );
        if (
          previousGeneration !== dto.expectedGeneration ||
          qrGeneration !== previousGeneration + 1
        ) {
          throw new Error('Génération du remplacement QR rejoué incohérente');
        }
        return LoyaltyMemberQrReplaceResultSchema.parse({
          operationId: dto.operationId,
          replayed: true,
          memberId,
          status: 'active',
          qrToken: await this.replayEnrollmentToken(
            tx,
            tenantRef,
            memberId,
            dto.operationId,
            tokenHash,
          ),
          revokedTokens: assertStoredSafeInteger(stored.revokedTokens, 'revokedTokens'),
          previousGeneration,
          qrGeneration,
        });
      }

      const member = await this.assertActiveMember(tx, tenantRef, memberId);
      if (member.qrGeneration !== dto.expectedGeneration) {
        throw new ConflictException(
          `Le QR a déjà changé (génération ${member.qrGeneration}). Rechargez la fiche.`,
        );
      }
      const activeTokens = await tx
        .select({ id: memberTokens.id })
        .from(memberTokens)
        .where(
          and(
            eq(memberTokens.tenantRef, tenantRef),
            eq(memberTokens.memberId, memberId),
            eq(memberTokens.status, 'active'),
          ),
        )
        .for('update');
      if (activeTokens.length !== 1) return corruptedWallet();

      const now = new Date();
      const qrGeneration = safeUnitAddition(member.qrGeneration, 1);
      const [advancedMember] = await tx
        .update(members)
        .set({ qrGeneration })
        .where(
          and(
            eq(members.tenantRef, tenantRef),
            eq(members.id, memberId),
            eq(members.qrGeneration, dto.expectedGeneration),
          ),
        )
        .returning({ qrGeneration: members.qrGeneration });
      if (!advancedMember) {
        throw new ConflictException('Le QR a déjà changé. Rechargez la fiche.');
      }
      const revoked = await tx
        .update(memberTokens)
        .set({ status: 'revoked', revokedAt: now })
        .where(
          and(
            eq(memberTokens.tenantRef, tenantRef),
            eq(memberTokens.memberId, memberId),
            eq(memberTokens.id, activeTokens[0]!.id),
            eq(memberTokens.status, 'active'),
          ),
        )
        .returning({ id: memberTokens.id });
      if (revoked.length !== 1) return corruptedWallet();
      const token = await this.issueEnrollmentToken(
        tx,
        tenantRef,
        memberId,
        dto.operationId,
      );
      await tx.insert(membershipEvents).values({
        tenantRef,
        memberId,
        operationId: dto.operationId,
        kind: 'token_replaced',
        reason: dto.reasonCode,
        source: actor.source,
        actorRef: actor.actorRef,
      });
      const result = LoyaltyMemberQrReplaceResultSchema.parse({
        operationId: dto.operationId,
        replayed: false,
        memberId,
        status: 'active',
        qrToken: token.clearToken,
        revokedTokens: revoked.length,
        previousGeneration: member.qrGeneration,
        qrGeneration: advancedMember.qrGeneration,
      });
      await completeOperation(tx, tenantRef, dto.operationId, {
        memberId,
        qrTokenHash: token.tokenHash,
        revokedTokens: revoked.length,
        previousGeneration: member.qrGeneration,
        qrGeneration: advancedMember.qrGeneration,
      });
      return result;
    });
  }

  async listMembers(
    tenantRef: string,
    query: LoyaltyMemberListQuery,
  ): Promise<LoyaltyMemberList> {
    const cursor = query.cursor ? decodeMemberCursor(query.cursor) : null;

    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const rows = await tx
        .select({ member: members, profile: memberProfiles, wallet: wallets })
        .from(members)
        .leftJoin(
          memberProfiles,
          and(
            eq(memberProfiles.tenantRef, members.tenantRef),
            eq(memberProfiles.memberId, members.id),
          ),
        )
        .leftJoin(
          wallets,
          and(eq(wallets.tenantRef, members.tenantRef), eq(wallets.memberId, members.id)),
        )
        .where(
          and(
            eq(members.tenantRef, tenantRef),
            query.status ? eq(members.status, query.status) : undefined,
            query.memberRef ? eq(members.id, query.memberRef) : undefined,
            cursor
              ? or(
                  lt(members.joinedAt, cursor.joinedAt),
                  and(eq(members.joinedAt, cursor.joinedAt), lt(members.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(members.joinedAt), desc(members.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      return LoyaltyMemberListSchema.parse({
        items: page.map((row) =>
          this.summaryFromRows(tenantRef, row.member, row.profile, row.wallet),
        ),
        nextCursor:
          hasMore && page.length > 0
            ? encodeMemberCursor(page[page.length - 1]!.member)
            : null,
      });
    });
  }

  getMemberDetail(tenantRef: string, memberId: string): Promise<LoyaltyMemberDetail> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const member = await this.memberSummary(tx, tenantRef, memberId);
      const [qrState] = await tx
        .select({ qrGeneration: members.qrGeneration })
        .from(members)
        .where(and(eq(members.tenantRef, tenantRef), eq(members.id, memberId)))
        .limit(1);
      if (!qrState) return corruptedWallet();
      // Une transaction Drizzle repose sur UNE connexion pg. Les requêtes
      // sont donc séquentielles : les mettre dans Promise.all ne crée aucun
      // parallélisme utile et certains drivers peuvent entrelacer leur état.
      const states = await tx
        .select()
        .from(consentState)
        .where(
          and(
            eq(consentState.tenantRef, tenantRef),
            eq(consentState.memberId, memberId),
          ),
        )
        .orderBy(consentState.purpose);
      const history = await tx
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.tenantRef, tenantRef),
            eq(ledgerEntries.memberId, memberId),
          ),
        )
        .orderBy(desc(ledgerEntries.recordedAt), desc(ledgerEntries.id))
        .limit(100);
      return LoyaltyMemberDetailSchema.parse({
        member,
        qrGeneration: qrState.qrGeneration,
        consents: states.map((state) => ({
          purpose: state.purpose,
          decision: state.decision,
          noticeVersion: state.noticeVersion,
          updatedAt: state.updatedAt.toISOString(),
        })),
        ledger: history.map(ledgerView),
      });
    });
  }

  dashboard(tenantRef: string): Promise<LoyaltyDashboard> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const since = new Date(Date.now() - THIRTY_DAYS_MS);
      const memberMetrics = await tx
        .select({
          totalMembers: sql<string>`count(*) filter (where ${members.status} <> 'anonymized')`,
          activeMembers30d: sql<string>`count(*) filter (where ${members.status} = 'active' and ${members.lastActivityAt} >= ${since})`,
          newMembers30d: sql<string>`count(*) filter (where ${members.status} <> 'anonymized' and ${members.joinedAt} >= ${since})`,
        })
        .from(members)
        .where(eq(members.tenantRef, tenantRef));
      const walletMetrics = await tx
        .select({
          outstandingUnits: sql<string>`coalesce(sum(${wallets.balanceUnits}), 0)`,
        })
        .from(wallets)
        .innerJoin(
          members,
          and(eq(members.tenantRef, wallets.tenantRef), eq(members.id, wallets.memberId)),
        )
        .where(
          and(eq(wallets.tenantRef, tenantRef), sql`${members.status} <> 'anonymized'`),
        );
      const ledgerMetrics = await tx
        .select({
          earnedUnits30d: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'earn' and ${reversalLedgerEntries.id} is null then ${ledgerEntries.deltaUnits} else 0 end), 0)`,
          redeemedUnits30d: sql<string>`coalesce(sum(case when ${ledgerEntries.kind} = 'redeem' and ${reversalLedgerEntries.id} is null then -${ledgerEntries.deltaUnits} else 0 end), 0)`,
        })
        .from(ledgerEntries)
        .leftJoin(
          reversalLedgerEntries,
          and(
            eq(reversalLedgerEntries.tenantRef, ledgerEntries.tenantRef),
            eq(reversalLedgerEntries.reversedEntryId, ledgerEntries.id),
          ),
        )
        .where(
          and(
            eq(ledgerEntries.tenantRef, tenantRef),
            sql`${ledgerEntries.recordedAt} >= ${since}`,
          ),
        );
      const redemptionMetrics = await tx
        .select({ count: sql<string>`count(*)` })
        .from(redemptions)
        .where(
          and(
            eq(redemptions.tenantRef, tenantRef),
            eq(redemptions.status, 'consumed'),
            sql`${redemptions.consumedAt} >= ${since}`,
          ),
        );
      const recent = await tx
        .select({ entry: ledgerEntries, member: members, profile: memberProfiles })
        .from(ledgerEntries)
        .innerJoin(
          members,
          and(
            eq(members.tenantRef, ledgerEntries.tenantRef),
            eq(members.id, ledgerEntries.memberId),
          ),
        )
        .leftJoin(
          memberProfiles,
          and(
            eq(memberProfiles.tenantRef, members.tenantRef),
            eq(memberProfiles.memberId, members.id),
          ),
        )
        .where(eq(ledgerEntries.tenantRef, tenantRef))
        .orderBy(desc(ledgerEntries.recordedAt), desc(ledgerEntries.id))
        .limit(8);

      const membersRow = memberMetrics[0];
      const walletRow = walletMetrics[0];
      const ledgerRow = ledgerMetrics[0];
      const redemptionsRow = redemptionMetrics[0];
      return LoyaltyDashboardSchema.parse({
        totalMembers: safeMetric(membersRow?.totalMembers, 'totalMembers'),
        activeMembers30d: safeMetric(membersRow?.activeMembers30d, 'activeMembers30d'),
        newMembers30d: safeMetric(membersRow?.newMembers30d, 'newMembers30d'),
        outstandingUnits: safeMetric(walletRow?.outstandingUnits, 'outstandingUnits'),
        earnedUnits30d: safeMetric(ledgerRow?.earnedUnits30d, 'earnedUnits30d'),
        redeemedUnits30d: safeMetric(ledgerRow?.redeemedUnits30d, 'redeemedUnits30d'),
        redemptions30d: safeMetric(redemptionsRow?.count, 'redemptions30d'),
        recentActivity: recent.map((row) => ({
          memberId: row.member.id,
          memberAlias: this.identityFromRows(tenantRef, row.member, row.profile).alias,
          entry: ledgerView(row.entry),
        })),
      });
    });
  }
}
