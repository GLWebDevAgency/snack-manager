import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { AUDIT_ACTION_LABELS, type AuditEntryView } from '@sm/contracts';
import type { AuditLog, Staff } from '@sm/db';
import { Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';

/**
 * Journal append-only des actions sensibles (annulation, remise,
 * remboursement, changement de prix) — socle de la traçabilité NF525.
 *
 * ÉCRIT depuis le premier jour, LISIBLE depuis le 24/08/2026 seulement : un
 * journal qu'aucun écran ne sait montrer ne protège personne au contrôle
 * (diagnostic quatre casquettes, P3). La lecture vit ici même, dans le module
 * du journal — la règle « qui écrit sait relire » évite un lecteur qui
 * réinterprète les entrées à sa façon.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectModel('AuditLog') private readonly logs: Model<AuditLog>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
  ) {}

  async log(entry: {
    tenantId: string;
    staffId?: string | null;
    action: string;
    targetId?: string;
    meta?: unknown;
    pinVerifiedAt?: Date;
  }) {
    await this.logs.create({ ...entry, at: new Date() });
  }

  /**
   * Le journal d'un établissement, du plus récent au plus ancien, avec les
   * NOMS d'équipiers résolus en une seule lecture : « Sarah » se défend en
   * contrôle, un ObjectId non. Un équipier supprimé s'affiche « équipier
   * supprimé » — le geste reste, c'est le principe même du registre.
   */
  async list(tenantId: string, limit = 100): Promise<AuditEntryView[]> {
    const docs = await this.logs
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ at: -1, _id: -1 })
      .limit(limit)
      .lean();

    const staffIds = [...new Set(docs.map((d) => String(d.staffId ?? '')).filter(Boolean))];
    const names = new Map(
      (
        await this.staff
          .find({ _id: { $in: staffIds.map((id) => new Types.ObjectId(id)) } }, { name: 1 })
          .lean()
      ).map((s) => [String(s._id), String(s.name ?? '')]),
    );

    return docs.map((d) => ({
      _id: String(d._id),
      at: (d.at ?? new Date(0)).toISOString(),
      action: d.action ?? '',
      actionLabel: AUDIT_ACTION_LABELS[d.action ?? ''] ?? d.action ?? '',
      staffName: d.staffId ? (names.get(String(d.staffId)) ?? 'équipier supprimé') : '',
      meta: (d.meta ?? {}) as Record<string, unknown>,
    }));
  }
}

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Lecture du journal par LE GÉRANT — c'est SON registre : la conformité de
 * caisse protège son établissement, il doit pouvoir le montrer sans nous.
 * Tenant-scoped par le jeton, comme toutes ses routes.
 */
@Roles('owner', 'gerant')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query(zod(AuditQuerySchema)) query: { limit: number },
  ) {
    return { entries: await this.audit.list(tenantId, query.limit) };
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
