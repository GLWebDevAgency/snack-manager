import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  PlannedShiftCreate,
  PlannedShiftUpdate,
  PlanningComparison,
  PlanningCoverage,
  PlanningDuplicate,
  PlanningWeek,
} from '@sm/contracts';
import type { PlannedShift, Shift, Staff } from '@sm/db';
import { StatsService } from '../stats/stats.service';
import {
  addDays,
  compareDays,
  formatDay,
  isoWeekday,
  parisDateString,
  parisWallToUtc,
  parseDay,
  type CalendarDay,
} from '../ordering/paris-time';
import { buildComparison, type ClockedShiftRow } from './planning.compare';
import {
  buildReminders,
  buildWeek,
  shiftsOverlap,
  type PlannedShiftRow,
  type StaffRow,
} from './planning.compute';
import { buildCoverage } from './planning.coverage';

/**
 * Planning des services — le geste que le gérant fait le dimanche soir, sur
 * une tablette, entre deux services.
 *
 * Trois principes tiennent tout le module :
 *  - le tenantId vient du jeton, jamais du corps de requête ;
 *  - un service posé arrive en BROUILLON, et seule une publication explicite
 *    le rend visible à l'équipe ;
 *  - aucun montant ne sort vers une session ouverte au PIN (cf.
 *    `canReadPayroll`) — c'est le contrôleur qui transmet le droit de lecture,
 *    ce service ne le devine jamais.
 */
@Injectable()
export class PlanningService {
  constructor(
    @InjectModel('PlannedShift') private readonly planned: Model<PlannedShift>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('Shift') private readonly shifts: Model<Shift>,
    private readonly stats: StatsService,
  ) {}

  // ─── Semaine ───

  async week(tenantId: string, week: string | undefined, payrollVisible: boolean): Promise<PlanningWeek> {
    const weekStart = this.weekStartOf(week);
    const weekEnd = addDays(weekStart, 6);
    const [team, wide] = await Promise.all([
      this.team(tenantId),
      // Fenêtre ÉLARGIE de six jours de chaque côté : une série de sept jours
      // travaillés à cheval sur deux semaines resterait invisible si l'on ne
      // chargeait que le lundi→dimanche affiché.
      this.loadPlanned(tenantId, addDays(weekStart, -6), addDays(weekEnd, 6)),
    ]);

    const inWeek = wide.filter((s) => this.isBetween(s.date, weekStart, weekEnd));
    return buildWeek({
      weekStart,
      shifts: inWeek,
      staff: team,
      payrollVisible,
      reminders: buildReminders({ shifts: wide, staff: team, weekStart, weekEnd }),
    });
  }

  // ─── Pose, modification, suppression ───

  async create(tenantId: string, dto: PlannedShiftCreate) {
    await this.assertStaffExists(tenantId, dto.staffId);
    const candidate: PlannedShiftRow = { id: 'nouveau', ...dto };
    await this.assertNoOverlap(tenantId, candidate);

    const created = await this.planned.create({
      tenantId,
      staffId: dto.staffId,
      date: dto.date,
      start: dto.start,
      end: dto.end,
      position: dto.position,
      note: dto.note,
      status: dto.status,
      publishedAt: dto.status === 'publie' ? new Date() : null,
    });
    return this.viewOf(created.toObject());
  }

  async update(tenantId: string, id: string, dto: PlannedShiftUpdate) {
    const current = await this.planned.findOne({ _id: this.objectId(id), tenantId }).lean();
    if (!current) throw new NotFoundException('Service prévu introuvable');

    const merged: PlannedShiftRow = {
      id,
      staffId: dto.staffId ?? String(current.staffId),
      date: dto.date ?? current.date,
      start: dto.start ?? current.start,
      end: dto.end ?? current.end,
      position: dto.position ?? current.position,
      note: dto.note ?? current.note,
      status: dto.status ?? current.status,
    };
    // Le contrôle « début ≠ fin » ne peut pas se faire au seul niveau du DTO :
    // un PATCH qui ne change que `end` doit être confronté au `start` DÉJÀ en
    // base, sinon on stocke un service de vingt-quatre heures.
    if (merged.start === merged.end) {
      throw new BadRequestException('Le début et la fin ne peuvent pas être identiques');
    }
    if (dto.staffId) await this.assertStaffExists(tenantId, dto.staffId);
    await this.assertNoOverlap(tenantId, merged);

    const $set: Record<string, unknown> = {
      staffId: merged.staffId,
      date: merged.date,
      start: merged.start,
      end: merged.end,
      position: merged.position,
      note: merged.note,
      status: merged.status,
    };
    // Repasser un service en brouillon efface son horodatage de publication :
    // sinon la fiche prétendrait avoir été communiquée à l'équipe.
    if (merged.status !== current.status) {
      $set.publishedAt = merged.status === 'publie' ? new Date() : null;
    }

    const saved = await this.planned
      .findOneAndUpdate({ _id: this.objectId(id), tenantId }, { $set }, { new: true })
      .lean();
    if (!saved) throw new NotFoundException('Service prévu introuvable');
    return this.viewOf(saved);
  }

  async remove(tenantId: string, id: string) {
    const deleted = await this.planned.findOneAndDelete({ _id: this.objectId(id), tenantId }).lean();
    if (!deleted) throw new NotFoundException('Service prévu introuvable');
    return { deleted: true, id };
  }

  // ─── Duplication de la semaine précédente ───

  /**
   * Le geste le plus fréquent : une semaine ressemble à la précédente.
   *
   * La copie arrive TOUJOURS en brouillon, même si la semaine source était
   * publiée. Dupliquer n'est pas s'engager : le gérant relit, ajuste ses
   * extras du week-end, puis publie. L'inverse enverrait à l'équipe un
   * planning que personne n'a relu.
   */
  async duplicate(tenantId: string, dto: PlanningDuplicate) {
    const from = this.weekStartOf(dto.from);
    const to = this.weekStartOf(dto.to);
    if (compareDays(from, to) === 0) {
      throw new BadRequestException('La semaine source et la semaine cible sont les mêmes');
    }

    const source = await this.loadPlanned(tenantId, from, addDays(from, 6));
    if (source.length === 0) {
      throw new BadRequestException('La semaine source ne contient aucun service à dupliquer');
    }

    const existing = await this.planned.countDocuments({
      tenantId,
      date: { $gte: formatDay(to), $lte: formatDay(addDays(to, 6)) },
    });
    if (existing > 0 && !dto.replace) {
      throw new ConflictException(
        `La semaine du ${formatDay(to)} contient déjà ${existing} service(s) — confirmez le remplacement pour les écraser`,
      );
    }
    if (existing > 0) {
      await this.planned.deleteMany({
        tenantId,
        date: { $gte: formatDay(to), $lte: formatDay(addDays(to, 6)) },
      });
    }

    const offsetDays = Math.round(
      (Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000,
    );
    const copies = source.map((s) => {
      const day = parseDay(s.date);
      return {
        tenantId,
        staffId: s.staffId,
        date: day ? formatDay(addDays(day, offsetDays)) : s.date,
        start: s.start,
        end: s.end,
        position: s.position,
        note: s.note,
        status: 'brouillon' as const,
        publishedAt: null,
      };
    });
    const inserted = await this.planned.insertMany(copies);
    return {
      from: formatDay(from),
      to: formatDay(to),
      copied: inserted.length,
      replaced: existing,
      status: 'brouillon' as const,
      message: `${inserted.length} service(s) copiés en brouillon sur la semaine du ${formatDay(to)} — relisez, puis publiez.`,
    };
  }

  // ─── Publication ───

  async publish(tenantId: string, week: string) {
    const weekStart = this.weekStartOf(week);
    const range = {
      $gte: formatDay(weekStart),
      $lte: formatDay(addDays(weekStart, 6)),
    };
    const result = await this.planned.updateMany(
      { tenantId, date: range, status: 'brouillon' },
      { $set: { status: 'publie', publishedAt: new Date() } },
    );
    const total = await this.planned.countDocuments({ tenantId, date: range });
    return {
      week: formatDay(weekStart),
      published: result.modifiedCount,
      total,
      message:
        result.modifiedCount === 0
          ? 'Aucun brouillon à publier sur cette semaine.'
          : `${result.modifiedCount} service(s) publiés — la semaine est désormais visible par votre équipe.`,
    };
  }

  // ─── Confrontation prévu / pointé ───

  async comparison(tenantId: string, week: string | undefined): Promise<PlanningComparison> {
    const weekStart = this.weekStartOf(week);
    const weekEnd = addDays(weekStart, 6);
    // Bornes en INSTANTS pour interroger les pointages : minuit parisien du
    // lundi, minuit parisien du lundi suivant. Le passage par l'heure murale
    // évite le décalage d'une heure les semaines de changement d'horaire.
    const from = parisWallToUtc(weekStart);
    const until = parisWallToUtc(addDays(weekStart, 7));

    const [team, planned, clocked] = await Promise.all([
      this.team(tenantId),
      this.loadPlanned(tenantId, weekStart, weekEnd),
      this.shifts.find({ tenantId, clockIn: { $gte: from, $lt: until } }).lean(),
    ]);

    const rows: ClockedShiftRow[] = clocked.map((s) => ({
      staffId: String(s.staffId),
      clockIn: new Date(s.clockIn),
      clockOut: s.clockOut ? new Date(s.clockOut) : null,
    }));

    return buildComparison({
      weekStart,
      planned,
      clocked: rows,
      staff: team,
      now: new Date(),
      weekEndsAt: until,
    });
  }

  // ─── Adéquation au volume attendu ───

  /**
   * On ne recalcule AUCUNE prévision : `StatsService.heatmap` est déjà la
   * source du bloc « Rush attendu » du tableau de bord. Le planning se
   * contente de la croiser avec les services posés, pour que les deux écrans
   * annoncent le même volume.
   */
  async coverage(tenantId: string, week: string | undefined): Promise<PlanningCoverage> {
    const weekStart = this.weekStartOf(week);
    const [shifts, heatmap] = await Promise.all([
      this.loadPlanned(tenantId, weekStart, addDays(weekStart, 6)),
      this.stats.heatmap(tenantId),
    ]);
    return buildCoverage({ weekStart, shifts, heatmap });
  }

  // ─── Coût horaire de l'équipe (routes réservées au propriétaire) ───

  async teamCosts(tenantId: string) {
    const members = await this.team(tenantId);
    const priced = members.filter((m) => m.hourlyCostCents != null);
    return {
      members,
      missingCost: members.filter((m) => m.hourlyCostCents == null).length,
      message:
        priced.length === members.length
          ? 'Tous les membres ont un coût horaire — les projections sont complètes.'
          : 'Les membres sans coût horaire ne sont comptés dans aucune projection.',
    };
  }

  async setHourlyCost(tenantId: string, staffId: string, hourlyCostCents: number | null) {
    const member = await this.staff
      .findOneAndUpdate(
        { _id: this.objectId(staffId), tenantId },
        { $set: { hourlyCostCents } },
        { new: true },
      )
      .lean();
    if (!member) throw new NotFoundException('Membre introuvable');
    return {
      staffId: String(member._id),
      staffName: member.name,
      role: member.role,
      hourlyCostCents: member.hourlyCostCents ?? null,
    };
  }

  // ─── Accès base ───

  private async team(tenantId: string): Promise<StaffRow[]> {
    // Les membres désactivés restent chargés : ils portent encore des services
    // passés et des pointages, qu'il ne faut pas faire disparaître d'un total.
    const members = await this.staff
      .find({ tenantId }, { name: 1, role: 1, hourlyCostCents: 1 })
      .sort({ createdAt: 1 })
      .lean();
    return members.map((m) => ({
      id: String(m._id),
      name: m.name,
      role: m.role,
      hourlyCostCents: m.hourlyCostCents ?? null,
    }));
  }

  private async loadPlanned(
    tenantId: string,
    from: CalendarDay,
    to: CalendarDay,
  ): Promise<PlannedShiftRow[]> {
    const rows = await this.planned
      .find({ tenantId, date: { $gte: formatDay(from), $lte: formatDay(to) } })
      .sort({ date: 1, start: 1 })
      .lean();
    return rows.map((r) => this.rowOf(r));
  }

  private rowOf(doc: PlannedShift & { _id?: unknown }): PlannedShiftRow {
    return {
      id: String(doc._id),
      staffId: String(doc.staffId),
      date: doc.date,
      start: doc.start,
      end: doc.end,
      position: doc.position,
      note: doc.note,
      status: doc.status,
    };
  }

  private viewOf(doc: PlannedShift & { _id?: unknown }) {
    const row = this.rowOf(doc);
    return { ...row, publishedAt: doc.publishedAt ?? null };
  }

  private async assertStaffExists(tenantId: string, staffId: string) {
    const exists = await this.staff.exists({ _id: this.objectId(staffId), tenantId });
    if (!exists) throw new NotFoundException('Membre introuvable dans cet établissement');
  }

  /**
   * Personne ne tient deux postes en même temps. On interroge la veille et le
   * lendemain en plus du jour visé : un service de nuit posé la veille peut
   * déborder sur celui qu'on essaie d'ajouter.
   */
  private async assertNoOverlap(tenantId: string, candidate: PlannedShiftRow) {
    const day = parseDay(candidate.date);
    if (!day) throw new BadRequestException('Date invalide');
    const neighbours = await this.planned
      .find({
        tenantId,
        staffId: candidate.staffId,
        date: { $gte: formatDay(addDays(day, -1)), $lte: formatDay(addDays(day, 1)) },
      })
      .lean();

    for (const doc of neighbours) {
      const row = this.rowOf(doc);
      if (row.id === candidate.id) continue;
      if (shiftsOverlap(row, candidate)) {
        throw new ConflictException(
          `Chevauchement : ce membre est déjà prévu le ${row.date} de ${row.start} à ${row.end}`,
        );
      }
    }
  }

  // ─── Dates ───

  /** Lundi de la semaine contenant `week` (ou la semaine courante à Paris). */
  private weekStartOf(week: string | undefined): CalendarDay {
    const day = week ? parseDay(week) : parseDay(parisDateString(new Date()));
    if (!day) throw new BadRequestException('Semaine invalide — format attendu : AAAA-MM-JJ');
    return addDays(day, -(isoWeekday(day) - 1));
  }

  private isBetween(date: string, from: CalendarDay, to: CalendarDay): boolean {
    const day = parseDay(date);
    return !!day && compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
  }

  /** Un identifiant illisible vaut un 404, jamais une CastError en 500. */
  private objectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Identifiant invalide');
    return new Types.ObjectId(id);
  }
}
