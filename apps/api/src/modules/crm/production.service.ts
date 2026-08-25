import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  productionTasksFor,
  productionWeekLabel,
  productionWeekOf,
  type CrmProductionClient,
  type CrmProductionTask,
  type CrmProductionWeek,
  type JwtPayload,
  type LeadServices,
  type ProductionTick,
  type ProductionWeek,
} from '@sm/contracts';
import type { AtelierTick, Tenant } from '@sm/db';
import { parisDateString } from '../ordering/paris-time';

/**
 * LA FILE DE PRODUCTION — « qu'est-ce que je dois à mes clients cette
 * semaine ? », le pendant TENUE DE PROMESSE du pipeline commercial.
 *
 * Le DÛ n'est jamais stocké : il se DÉRIVE de ce que chaque client a signé
 * (`tenant.atelier`) et de la semaine regardée — même principe que le retard
 * d'une facture, recalculé à chaque lecture. Seules les COCHES s'écrivent
 * (`atelierticks`, unicité tenant+semaine+tâche) : décocher supprime, le
 * geste est idempotent, et une semaine passée reste juste rétroactivement.
 *
 * La semaine « courante » est PARISIENNE : c'est le lundi du comptoir qui
 * ouvre la file, pas le lundi UTC. Et la semaine PROCHAINE est refusée en
 * lecture comme en coche — un travail pas encore dû ne se coche pas d'avance.
 *
 * Surface TRANS-TENANT réservée à `sm_admin` (garde posée au contrôleur).
 */

/**
 * Les seuls champs de l'Atelier qui produisent du récurrent — lus à la main
 * plutôt que par `LeadServicesSchema.parse` : la file ne doit pas tomber en
 * erreur parce qu'un VIEUX document violerait une règle du schéma d'entrée
 * (site ET refonte cochés, par exemple) qui ne la concerne en rien.
 */
type AtelierStocke =
  | { presenceInternet?: unknown; reseauxSociaux?: unknown; signedAt?: Date | null }
  | null
  | undefined;

function lireRecurrents(atelier: AtelierStocke): Pick<
  LeadServices,
  'presenceInternet' | 'reseauxSociaux'
> {
  const cadence = atelier?.reseauxSociaux;
  return {
    presenceInternet: atelier?.presenceInternet === true,
    reseauxSociaux: cadence === 'hebdo' || cadence === 'bihebdo' ? cadence : null,
  };
}

type RawTenant = Tenant & { _id: unknown };
type RawTick = AtelierTick & { _id: unknown };

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

@Injectable()
export class ProductionService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('AtelierTick') private readonly ticks: Model<AtelierTick>,
  ) {}

  /** La semaine demandée (courante par défaut), validée et jamais future. */
  private resolveWeek(weekKey: string | undefined, now: Date): {
    week: ProductionWeek;
    current: ProductionWeek;
  } {
    const current = productionWeekOf(parisDateString(now));
    if (weekKey === undefined || weekKey === '') return { week: current, current };
    const week = parseWeekKey(weekKey);
    if (!week) throw new BadRequestException('Clef de semaine invalide — attendu AAAA-Wss.');
    if (week.monday > current.monday) {
      throw new BadRequestException('Le travail de la semaine prochaine n’est pas encore dû.');
    }
    return { week, current };
  }

  async week(weekKey?: string, now: Date = new Date()): Promise<CrmProductionWeek> {
    const { week, current } = this.resolveWeek(weekKey, now);

    // Le parc qui a signé du RÉCURRENT — un client parti (churned) sort de la
    // file, un client suspendu y reste : la décision de continuer le travail
    // est humaine, la file ne la prend pas à sa place.
    const rows = (await this.tenants
      .find(
        {
          $or: [
            { 'atelier.presenceInternet': true },
            { 'atelier.reseauxSociaux': { $in: ['hebdo', 'bihebdo'] } },
          ],
          'account.status': { $ne: 'churned' },
        },
        { name: 1, slug: 1, atelier: 1 },
      )
      .sort({ name: 1 })
      .lean()) as RawTenant[];

    const ticks = (await this.ticks.find({ week: week.key }).lean()) as RawTick[];
    const parTache = new Map(ticks.map((t) => [`${String(t.tenantId)}:${t.task}`, t]));

    const clients: CrmProductionClient[] = [];
    for (const row of rows) {
      // Une promesse signée APRÈS la semaine regardée n'y était pas due — les
      // semaines passées d'avant la signature restent vides, pas « en retard ».
      const signedAt = (row.atelier as { signedAt?: Date | null } | null)?.signedAt ?? null;
      if (signedAt && parisDateString(new Date(signedAt)) > week.sunday) continue;

      const dues = productionTasksFor(lireRecurrents(row.atelier), week);
      if (dues.length === 0) continue;

      const id = String(row._id);
      const tasks: CrmProductionTask[] = dues.map((due) => {
        const tick = parTache.get(`${id}:${due.key}`);
        return {
          ...due,
          done: Boolean(tick),
          doneAt: iso(tick?.doneAt),
          note: tick?.note ?? '',
        };
      });
      clients.push({
        tenantId: id,
        name: String(row.name ?? ''),
        slug: String(row.slug ?? ''),
        signedAt: iso(signedAt),
        tasks,
        done: tasks.filter((t) => t.done).length,
        total: tasks.length,
      });
    }

    return {
      week: week.key,
      label: productionWeekLabel(week),
      monday: week.monday,
      sunday: week.sunday,
      previous: previousWeekKey(week),
      next: week.key === current.key ? null : nextWeekKey(week),
      current: current.key,
      clients,
      done: clients.reduce((n, c) => n + c.done, 0),
      total: clients.reduce((n, c) => n + c.total, 0),
    };
  }

  /**
   * Cocher ou décocher — refusé si la tâche n'est pas DUE pour ce client
   * cette semaine-là : une coche sans promesse derrière serait un mensonge
   * que la file répéterait chaque lundi.
   */
  async tick(
    actor: JwtPayload,
    tenantId: string,
    body: ProductionTick,
    now: Date = new Date(),
  ): Promise<{ done: boolean }> {
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const week = parseWeekKey(body.week);
    if (!week) throw new BadRequestException('Clef de semaine invalide — attendu AAAA-Wss.');
    const current = productionWeekOf(parisDateString(now));
    if (week.monday > current.monday) {
      throw new BadRequestException('Le travail de la semaine prochaine n’est pas encore dû.');
    }

    const tenant = (await this.tenants
      .findById(tenantId, { atelier: 1 })
      .lean()) as RawTenant | null;
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    const dues = productionTasksFor(lireRecurrents(tenant.atelier), week);
    if (!dues.some((t) => t.key === body.task)) {
      throw new BadRequestException('Cette tâche n’est pas due pour ce client cette semaine-là.');
    }

    if (body.done) {
      await this.ticks.updateOne(
        { tenantId: tenant._id, week: week.key, task: body.task },
        // Le jeton ne porte pas l'e-mail : `sub` suffit à la trace — même
        // convention que les signaux « traités ».
        { $set: { doneAt: now, doneBy: String(actor.sub), note: body.note } },
        { upsert: true },
      );
    } else {
      await this.ticks.deleteOne({ tenantId: tenant._id, week: week.key, task: body.task });
    }
    return { done: body.done };
  }
}
