import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  clientHealth,
  daysSince,
  founderSeatsRemaining,
  isOpenLeadStage,
  FOUNDER_SEATS_TOTAL,
  LEAD_STAGES,
  PLAN_MRR_CENTS,
  type CrmClient,
  type CrmLead,
  type CrmOverview,
  type LeadCreate,
  type LeadStage,
  type LeadTouchCreate,
  type LeadUpdate,
} from '@sm/contracts';
import type { Lead, Order, Tenant } from '@sm/db';
import { buildSeedLeads } from './crm.seed';

/** Fenêtre d'activité d'un client : 30 jours glissants. */
const ACTIVITY_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
/** CA = commandes prêtes + remises (même convention que le module Stats). */
const REVENUE_STATUSES = ['ready', 'delivered'];

/** Agrégat d'activité par tenant, calculé côté MongoDB. */
type ActivityRow = {
  _id: Types.ObjectId;
  lastOrderAt: Date | null;
  orders30d: number;
  revenue30dCents: number;
};

@Injectable()
export class CrmService {
  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
  ) {}

  // ─── Pipeline commercial ───

  async listLeads(stage?: LeadStage): Promise<CrmLead[]> {
    await this.ensureSeeded();
    const docs = await this.leads
      .find(stage ? { stage } : {})
      .sort({ updatedAt: -1 })
      .lean();
    return docs.map((d) => toLead(d));
  }

  async getLead(id: string): Promise<CrmLead> {
    const doc = await this.leads.findById(objectId(id)).lean();
    if (!doc) throw new NotFoundException('Lead introuvable');
    return toLead(doc);
  }

  async createLead(body: LeadCreate): Promise<CrmLead> {
    const doc = await this.leads.create({
      restaurantName: body.restaurantName,
      contact: body.contact,
      stage: body.stage,
      sequence: body.sequence,
      notes: body.notes,
      founderSeatReserved: body.founderSeatReserved,
      touches: [],
    });
    return toLead(doc.toObject());
  }

  /**
   * Mise à jour partielle. Le contact est aplati en chemins pointés
   * (`contact.phone`) : passer l'objet entier écraserait les champs absents du
   * corps — un numéro perdu parce qu'on corrigeait un e-mail.
   */
  async updateLead(id: string, body: LeadUpdate): Promise<CrmLead> {
    const set: Record<string, unknown> = {};
    if (body.restaurantName !== undefined) set.restaurantName = body.restaurantName;
    if (body.stage !== undefined) set.stage = body.stage;
    if (body.sequence !== undefined) set.sequence = body.sequence;
    if (body.notes !== undefined) set.notes = body.notes;
    if (body.founderSeatReserved !== undefined) set.founderSeatReserved = body.founderSeatReserved;
    if (body.contact?.name !== undefined) set['contact.name'] = body.contact.name;
    if (body.contact?.phone !== undefined) set['contact.phone'] = body.contact.phone;
    if (body.contact?.email !== undefined) set['contact.email'] = body.contact.email;

    const doc = await this.leads
      .findByIdAndUpdate(objectId(id), { $set: set }, { new: true })
      .lean();
    if (!doc) throw new NotFoundException('Lead introuvable');
    return toLead(doc);
  }

  /**
   * Changement d'étape. Le mouvement est tracé comme une relance de type
   * « autre » : le pipeline d'un commercial se relit à l'historique, pas à la
   * position courante de la carte.
   */
  async changeStage(id: string, stage: LeadStage): Promise<CrmLead> {
    const current = await this.leads.findById(objectId(id));
    if (!current) throw new NotFoundException('Lead introuvable');
    if (current.stage === stage) return toLead(current.toObject());

    const doc = await this.leads
      .findByIdAndUpdate(
        current._id,
        {
          $set: { stage },
          $push: {
            touches: {
              at: new Date(),
              type: 'autre',
              note: `Étape : ${current.stage} → ${stage}`,
            },
          },
        },
        { new: true },
      )
      .lean();
    if (!doc) throw new NotFoundException('Lead introuvable');
    return toLead(doc);
  }

  /** Ajoute une relance tracée (date, canal, message) — spec crm-sm §8.1. */
  async addTouch(id: string, body: LeadTouchCreate): Promise<CrmLead> {
    const doc = await this.leads
      .findByIdAndUpdate(
        objectId(id),
        { $push: { touches: { at: body.at ?? new Date(), type: body.type, note: body.note } } },
        { new: true },
      )
      .lean();
    if (!doc) throw new NotFoundException('Lead introuvable');
    return toLead(doc);
  }

  // ─── Tableau de bord HQ ───

  async overview(now: Date = new Date()): Promise<CrmOverview> {
    await this.ensureSeeded();

    const [stageRows, leadDocs, clients] = await Promise.all([
      this.leads.aggregate<{ _id: LeadStage; n: number }>([
        { $group: { _id: '$stage', n: { $sum: 1 } } },
      ]),
      // Les relances récentes se lisent sur la même passe : le CRM tient dans
      // quelques centaines de leads, une seconde requête ne se justifie pas.
      this.leads.find({}, { restaurantName: 1, touches: 1, founderSeatReserved: 1, stage: 1 }).lean(),
      this.listClients(now),
    ]);

    const stages = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
    let leadsTotal = 0;
    for (const row of stageRows) {
      if (row._id in stages) stages[row._id] = row.n;
      leadsTotal += row.n;
    }
    const leadsOpen = LEAD_STAGES.filter(isOpenLeadStage).reduce((n, s) => n + stages[s], 0);

    // Une place fondateur réservée sur un lead perdu n'est plus réservée :
    // elle doit retourner au compteur, sinon on s'interdit de vendre.
    const reserved = leadDocs.filter(
      (l) => l.founderSeatReserved && (l.stage as LeadStage) !== 'perdu',
    ).length;
    const founderClients = clients.filter((c) => c.founderSeat).length;
    const taken = founderClients + reserved;

    const recentTouches = leadDocs
      .flatMap((l) =>
        (l.touches ?? []).map((t) => ({
          leadId: String(l._id),
          restaurantName: l.restaurantName,
          at: iso(t.at) ?? new Date(0).toISOString(),
          type: t.type ?? 'autre',
          note: t.note ?? '',
        })),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);

    const active = clients.filter((c) => c.orders30d > 0);

    return {
      stages,
      leadsTotal,
      leadsOpen,
      founderSeats: {
        total: FOUNDER_SEATS_TOTAL,
        taken,
        remaining: founderSeatsRemaining(taken),
        clients: founderClients,
        reserved,
      },
      // « MRR estimé depuis les tenants actifs et leur plan » : un restaurant
      // qui n'a pas encaissé une seule commande en 30 jours n'est pas compté —
      // c'est du MRR qu'on ne peut pas considérer comme acquis.
      mrrCents: active.reduce((sum, c) => sum + c.mrrCents, 0),
      clients: clients.length,
      activeClients: active.length,
      atRiskClients: clients.filter((c) => c.health === 'risque').length,
      orders30d: clients.reduce((n, c) => n + c.orders30d, 0),
      recentTouches,
    };
  }

  // ─── Restaurants clients (le parc réel) ───

  /**
   * Les tenants, enrichis de leur activité récente. Le décrochage se lit sur
   * les COMMANDES, pas sur l'abonnement : un client qui n'encaisse plus paie
   * encore, et c'est précisément celui-là qu'il faut rappeler cette semaine.
   */
  async listClients(now: Date = new Date()): Promise<CrmClient[]> {
    const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);

    const [tenants, activity] = await Promise.all([
      this.tenants
        .find({}, { name: 1, slug: 1, plan: 1, founderSeat: 1, createdAt: 1 })
        .sort({ createdAt: 1 })
        .lean(),
      this.orders.aggregate<ActivityRow>([
        { $match: { status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$tenantId',
            lastOrderAt: { $max: '$createdAt' },
            orders30d: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
            revenue30dCents: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$createdAt', since] },
                      { $in: ['$status', REVENUE_STATUSES] },
                    ],
                  },
                  '$totals.total',
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const byTenant = new Map(activity.map((a) => [String(a._id), a]));

    return tenants.map((t) => {
      const a = byTenant.get(String(t._id));
      const lastOrderAt = a?.lastOrderAt ?? null;
      const plan = (t.plan ?? 'essentiel') as CrmClient['plan'];
      return {
        _id: String(t._id),
        name: t.name,
        slug: t.slug,
        plan,
        mrrCents: PLAN_MRR_CENTS[plan] ?? 0,
        founderSeat: Boolean(t.founderSeat),
        since: iso((t as { createdAt?: Date }).createdAt) ?? now.toISOString(),
        orders30d: a?.orders30d ?? 0,
        revenue30dCents: a?.revenue30dCents ?? 0,
        lastOrderAt: iso(lastOrderAt),
        daysSinceLastOrder: daysSince(lastOrderAt, now),
        health: clientHealth(lastOrderAt, now),
      };
    });
  }

  // ─── Amorce du pipeline ───

  /**
   * Écrit les prospects d'amorce si — et seulement si — la collection est
   * vide. La promesse est mémorisée : deux requêtes simultanées au démarrage
   * ne doivent pas insérer la liste deux fois.
   */
  private seeding: Promise<void> | null = null;

  private ensureSeeded(): Promise<void> {
    this.seeding ??= (async () => {
      if ((await this.leads.countDocuments({})) > 0) return;
      await this.leads.insertMany(buildSeedLeads());
    })().catch(() => {
      // Une amorce ratée ne doit jamais faire tomber la vue : au pire le
      // pipeline s'affiche vide. On repasse à null pour retenter au prochain appel.
      this.seeding = null;
    });
    return this.seeding;
  }
}

// ─── Conversions ───

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Lead introuvable');
  return new Types.ObjectId(id);
}

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Document Mongo → forme d'API, relances les plus récentes en tête. */
function toLead(doc: Record<string, unknown>): CrmLead {
  const raw = doc as unknown as Lead & { _id: unknown; createdAt?: Date; updatedAt?: Date };
  const touches = (raw.touches ?? [])
    .map((t) => ({
      at: iso(t.at) ?? new Date(0).toISOString(),
      type: t.type ?? 'autre',
      note: t.note ?? '',
    }))
    .sort((a, b) => b.at.localeCompare(a.at));

  return {
    _id: String(raw._id),
    restaurantName: raw.restaurantName,
    contact: {
      name: raw.contact?.name ?? '',
      phone: raw.contact?.phone ?? '',
      email: raw.contact?.email ?? '',
    },
    stage: (raw.stage ?? 'nouveau') as LeadStage,
    sequence: (raw.sequence ?? null) as CrmLead['sequence'],
    touches,
    founderSeatReserved: Boolean(raw.founderSeatReserved),
    notes: raw.notes ?? '',
    createdAt: iso(raw.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(raw.updatedAt) ?? new Date(0).toISOString(),
    lastTouchAt: touches[0]?.at ?? null,
  };
}
