import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoyaltyRewardCreateSchema,
  type LoyaltyProgramPut,
  type LoyaltyProgramView,
  type LoyaltyRewardCreate,
  type LoyaltyRewardUpdate,
  type LoyaltyRewardView,
} from '@sm/contracts';
import {
  programVersions,
  programs,
  rewards,
  and,
  eq,
  withLoyaltyTenant,
  type LoyaltyDb,
  type LoyaltyTx,
} from '@sm/loyalty';
import { LOYALTY_DB } from '../../loyalty-db.module';

type ProgramRow = typeof programs.$inferSelect;
type ProgramVersionRow = typeof programVersions.$inferSelect;
type RewardRow = typeof rewards.$inferSelect;

function mustRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('RETURNING fidélité sans ligne');
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

function earnOf(row: ProgramVersionRow): LoyaltyProgramPut['earn'] {
  return row.mechanism === 'points'
    ? {
        mechanism: 'points',
        minimumPurchaseCents: row.minimumPurchaseCents,
        maximumUnitsPerPurchase: row.maximumUnitsPerPurchase,
        spendStepCents: row.spendStepCents!,
        unitsPerStep: row.unitsPerStep!,
      }
    : {
        mechanism: 'stamps',
        minimumPurchaseCents: row.minimumPurchaseCents,
        maximumUnitsPerPurchase: row.maximumUnitsPerPurchase,
        unitsPerVisit: row.unitsPerVisit!,
      };
}

export function loyaltyProgramView(
  program: ProgramRow,
  version: ProgramVersionRow,
): LoyaltyProgramView {
  return {
    id: program.id,
    name: version.name,
    status: program.status,
    earn: earnOf(version),
    unitLabelSingular: version.unitLabelSingular,
    unitLabelPlural: version.unitLabelPlural,
    termsSummary: version.termsSummary,
    rulesVersion: version.version,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
  };
}

function rewardView(row: RewardRow): LoyaltyRewardView {
  return {
    id: row.id,
    programId: row.programId,
    name: row.name,
    description: row.description,
    costUnits: row.costUnits,
    kind: row.kind,
    valueCents: row.valueCents,
    productRef: row.productRef,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function samePublishedProgram(current: LoyaltyProgramView, next: LoyaltyProgramPut): boolean {
  return (
    current.name === next.name &&
    current.status === next.status &&
    current.unitLabelSingular === next.unitLabelSingular &&
    current.unitLabelPlural === next.unitLabelPlural &&
    current.termsSummary === next.termsSummary &&
    JSON.stringify(current.earn) === JSON.stringify(next.earn)
  );
}

async function currentProgram(
  tx: LoyaltyTx,
  tenantRef: string,
  lock = false,
): Promise<{ program: ProgramRow; version: ProgramVersionRow } | null> {
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
  const rows = lock ? await query.for('update') : await query;
  return rows[0] ?? null;
}

function versionValues(
  tenantRef: string,
  programId: string,
  version: number,
  dto: LoyaltyProgramPut,
): typeof programVersions.$inferInsert {
  return {
    tenantRef,
    programId,
    version,
    name: dto.name,
    mechanism: dto.earn.mechanism,
    minimumPurchaseCents: dto.earn.minimumPurchaseCents,
    maximumUnitsPerPurchase: dto.earn.maximumUnitsPerPurchase,
    spendStepCents: dto.earn.mechanism === 'points' ? dto.earn.spendStepCents : null,
    unitsPerStep: dto.earn.mechanism === 'points' ? dto.earn.unitsPerStep : null,
    unitsPerVisit: dto.earn.mechanism === 'stamps' ? dto.earn.unitsPerVisit : null,
    unitLabelSingular: dto.unitLabelSingular,
    unitLabelPlural: dto.unitLabelPlural,
    termsSummary: dto.termsSummary,
  };
}

@Injectable()
export class LoyaltyAdminService {
  constructor(@Inject(LOYALTY_DB) private readonly db: LoyaltyDb) {}

  getProgram(tenantRef: string): Promise<LoyaltyProgramView | null> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const current = await currentProgram(tx, tenantRef);
      return current ? loyaltyProgramView(current.program, current.version) : null;
    });
  }

  async putProgram(tenantRef: string, dto: LoyaltyProgramPut): Promise<LoyaltyProgramView> {
    try {
      return await withLoyaltyTenant(this.db, tenantRef, async (tx) => {
        const current = await currentProgram(tx, tenantRef, true);
        if (current) {
          const view = loyaltyProgramView(current.program, current.version);
          if (samePublishedProgram(view, dto)) return view;

          const nextVersion = current.program.currentVersion + 1;
          const version = mustRow(
            (
              await tx
                .insert(programVersions)
                .values(versionValues(tenantRef, current.program.id, nextVersion, dto))
                .returning()
            )[0],
          );
          const program = mustRow(
            (
              await tx
                .update(programs)
                .set({ status: dto.status, currentVersion: nextVersion, updatedAt: new Date() })
                .where(and(eq(programs.tenantRef, tenantRef), eq(programs.id, current.program.id)))
                .returning()
            )[0],
          );
          return loyaltyProgramView(program, version);
        }

        const program = mustRow(
          (
            await tx
              .insert(programs)
              .values({ tenantRef, status: dto.status, currentVersion: 1 })
              .returning()
          )[0],
        );
        const version = mustRow(
          (
            await tx
              .insert(programVersions)
              .values(versionValues(tenantRef, program.id, 1, dto))
              .returning()
          )[0],
        );
        return loyaltyProgramView(program, version);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Le programme a été modifié en parallèle, réessayez');
      }
      throw error;
    }
  }

  listRewards(tenantRef: string): Promise<LoyaltyRewardView[]> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const rows = await tx
        .select()
        .from(rewards)
        .where(eq(rewards.tenantRef, tenantRef))
        .orderBy(rewards.costUnits, rewards.createdAt);
      return rows.map(rewardView);
    });
  }

  createReward(tenantRef: string, dto: LoyaltyRewardCreate): Promise<LoyaltyRewardView> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const current = await currentProgram(tx, tenantRef);
      if (!current) {
        throw new ConflictException('Configurez le programme avant de créer une récompense');
      }
      const row = mustRow(
        (
          await tx
            .insert(rewards)
            .values({ tenantRef, programId: current.program.id, ...dto })
            .returning()
        )[0],
      );
      return rewardView(row);
    });
  }

  updateReward(
    tenantRef: string,
    rewardId: string,
    patch: LoyaltyRewardUpdate,
  ): Promise<LoyaltyRewardView> {
    return withLoyaltyTenant(this.db, tenantRef, async (tx) => {
      const [current] = await tx
        .select()
        .from(rewards)
        .where(and(eq(rewards.tenantRef, tenantRef), eq(rewards.id, rewardId)))
        .limit(1)
        .for('update');
      if (!current) throw new NotFoundException('Récompense introuvable');

      const merged = LoyaltyRewardCreateSchema.safeParse({
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        costUnits: patch.costUnits ?? current.costUnits,
        kind: patch.kind ?? current.kind,
        valueCents: patch.valueCents !== undefined ? patch.valueCents : current.valueCents,
        productRef: patch.productRef !== undefined ? patch.productRef : current.productRef,
        active: patch.active ?? current.active,
      });
      if (!merged.success) {
        throw new BadRequestException(merged.error.issues.map((issue) => issue.message).join('. '));
      }

      const row = mustRow(
        (
          await tx
            .update(rewards)
            .set({ ...merged.data, updatedAt: new Date() })
            .where(and(eq(rewards.tenantRef, tenantRef), eq(rewards.id, rewardId)))
            .returning()
        )[0],
      );
      return rewardView(row);
    });
  }
}
