import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  nextWeekKey,
  parseWeekKey,
  premierDuMoisDans,
  previousWeekKey,
  productionTasksFor,
  productionWeekLabel,
  productionWeekOf,
  type CrmProductionClient,
  type CrmProductionTask,
  type CrmProductionWeek,
  type JwtPayload,
  type LeadServices,
  type ProductionDueTask,
  type ProductionTick,
  type ProductionWeek,
  type TenantAccountStatus,
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
 * geste est idempotent.
 *
 * LIMITE ASSUMÉE : `tenant.atelier` ne porte pas d'historique — le dû des
 * semaines passées est dérivé de ce qui est signé AUJOURD'HUI. Le premier
 * avenant (un client qui passe d'hebdo à bihebdo) réécrira donc l'histoire
 * affichée. Le jour où les avenants se signeront dans l'outil, c'est le
 * champ `atelier` qui s'historisera — pas cette dérivation qui se stockera.
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

const statusOf = (raw: RawTenant): TenantAccountStatus =>
  ((raw.account as { status?: string } | undefined)?.status ?? 'trial') as TenantAccountStatus;

const signedAtOf = (raw: RawTenant): Date | null =>
  (raw.atelier as { signedAt?: Date | null } | null)?.signedAt ?? null;

/**
 * Ce qui est DÛ à ce client cette semaine-là — la SEULE définition, partagée
 * par la lecture (`week`) et la coche (`tick`) : deux dérivations divergeraient
 * un jour, et ce jour-là on pourrait cocher ce que la file n'affiche pas.
 *
 * Le rapport mensuel porte sur le mois CLOS : un client signé après le 1er
 * contenu dans la semaine n'a jamais promis ce mois — pas de rapport fantôme
 * sa semaine d'entrée.
 */
function duesPour(raw: RawTenant, week: ProductionWeek): ProductionDueTask[] {
  const dues = productionTasksFor(lireRecurrents(raw.atelier), week);
  const premier = premierDuMoisDans(week);
  const signedAt = signedAtOf(raw);
  if (premier && signedAt && parisDateString(new Date(signedAt)) >= premier) {
    return dues.filter((t) => t.key !== 'presence_rapport');
  }
  return dues;
}

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

    // Le parc qui a signé du RÉCURRENT. Un client suspendu RESTE dans la
    // file, statut affiché : continuer ou suspendre le travail est une
    // décision humaine, et elle se prend là où le travail se lit.
    const rows = (await this.tenants
      .find(
        {
          $or: [
            { 'atelier.presenceInternet': true },
            { 'atelier.reseauxSociaux': { $in: ['hebdo', 'bihebdo'] } },
          ],
        },
        { name: 1, slug: 1, atelier: 1, 'account.status': 1 },
      )
      .sort({ name: 1 })
      .lean()) as RawTenant[];

    const ticks = (await this.ticks.find({ week: week.key }).lean()) as RawTick[];
    const parTache = new Map(ticks.map((t) => [`${String(t.tenantId)}:${t.task}`, t]));

    const clients: CrmProductionClient[] = [];
    for (const row of rows) {
      // Un client parti (churned) sort de la semaine COURANTE — plus rien ne
      // lui est dû — mais reste dans les semaines passées : son historique de
      // promesses tenues ne s'évapore pas avec son départ.
      const accountStatus = statusOf(row);
      if (accountStatus === 'churned' && week.key === current.key) continue;

      // Une promesse signée APRÈS la semaine regardée n'y était pas due — les
      // semaines passées d'avant la signature restent vides, pas « en retard ».
      const signedAt = signedAtOf(row);
      if (signedAt && parisDateString(new Date(signedAt)) > week.sunday) continue;

      const dues = duesPour(row, week);
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
        accountStatus,
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
    const { week } = this.resolveWeek(body.week, now);

    const tenant = (await this.tenants
      .findById(tenantId, { atelier: 1, 'account.status': 1 })
      .lean()) as RawTenant | null;
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    // Les MÊMES règles de dû que la lecture (`duesPour` + les deux gardes de
    // la file) : ce qui ne s'affiche pas ne se coche pas.
    if (statusOf(tenant) === 'churned') {
      throw new BadRequestException('Ce client a quitté le parc — plus rien ne lui est dû.');
    }
    const signedAt = signedAtOf(tenant);
    if (signedAt && parisDateString(new Date(signedAt)) > week.sunday) {
      throw new BadRequestException('La promesse ne courait pas encore cette semaine-là.');
    }
    if (!duesPour(tenant, week).some((t) => t.key === body.task)) {
      throw new BadRequestException('Cette tâche n’est pas due pour ce client cette semaine-là.');
    }

    if (body.done) {
      // Le jeton ne porte pas l'e-mail : `sub` suffit à la trace — même
      // convention que les signaux « traités ». La note ne s'écrit que
      // FOURNIE : l'écran qui coche sans note ne doit pas effacer celle
      // qu'une coche précédente portait.
      const set: { doneAt: Date; doneBy: string; note?: string } = {
        doneAt: now,
        doneBy: String(actor.sub),
      };
      if (body.note) set.note = body.note;
      await this.ticks.updateOne(
        { tenantId: tenant._id, week: week.key, task: body.task },
        { $set: set },
        { upsert: true },
      );
    } else {
      await this.ticks.deleteOne({ tenantId: tenant._id, week: week.key, task: body.task });
    }
    return { done: body.done };
  }
}
