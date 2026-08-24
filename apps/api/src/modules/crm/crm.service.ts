import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  clientHealth,
  daysSince,
  founderSeatsRemaining,
  isOpenLeadStage,
  paiementAxis,
  summarizeOutstanding,
  DEVICE_OFFLINE_AFTER_MS,
  FOUNDER_SEATS_TOTAL,
  LEAD_STAGES,
  LeadServicesSchema,
  PLAN_MRR_CENTS,
  SCREEN_OFFLINE_AFTER_MS,
  type CrmClient,
  type CrmInvoice,
  type CrmLead,
  type CrmOverview,
  type LeadCreate,
  type LeadStage,
  type LeadTouchCreate,
  type LeadUpdate,
  type RevocableDeviceKind,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Device, Lead, Order, Screen, Tenant } from '@sm/db';
import { BillingService } from './billing.service';
// Le JUGEMENT de la fiche de santé, réutilisé tel quel : mêmes bornes de
// fenêtres, même `$group`, mêmes fonctions de notation. C'est ce qui garantit
// que le score lu dans la liste est celui qu'on retrouve en cliquant dessus —
// une liste qui annonce 88 et une fiche qui répond 82 feraient douter des deux.
import {
  DEVICE_FIELDS,
  EMPTY_ACTIVITY,
  SCREEN_FIELDS,
  activityGroup,
  buildFleet,
  buildModules,
  buildWindow,
  compositeScore,
  healthAxis,
  scoreActivite,
  scoreAdoption,
  scoreTechnique,
  toFleetUnit,
  windowBounds,
  type CrmFleetUnit,
  type TenantActivityRow,
} from './health.service';
import { buildSeedLeads } from './crm.seed';
import { buildProspectionOps } from './crm.prospection';
import { demoSeedEnabled } from '../../common/demo-seed';
import { detailErreur } from '../../infrastructure/http-v4';

/** Fenêtre d'activité d'un client : 30 jours glissants. */
const ACTIVITY_WINDOW_DAYS = 30;

@Injectable()
export class CrmService implements OnApplicationBootstrap {
  /**
   * L'import de prospection court AU DÉMARRAGE, plus seulement au premier
   * clic. Les 52 leads réels ont été demandés « en production, en base » —
   * or l'import ne se déclenchait qu'à la première requête CRM, et personne
   * n'avait encore ouvert /sm contre la production (le pipeline se travaille
   * sur staging) : le premier exercice de restauration (24/08/2026) a relu
   * une sauvegarde de production SANS leads, et il a eu raison de la refuser.
   * Fire-and-forget qui ne lève jamais : un import raté n'empêche pas l'API
   * de servir, et le premier appel CRM le retente (la promesse mémorisée
   * repasse à null en cas d'échec).
   */
  onApplicationBootstrap(): void {
    // Une ligne par démarrage, quelle que soit l'issue : trois exercices de
    // restauration ont échoué sans qu'aucun journal ne dise si l'import avait
    // couru, été sauté (démo active) ou échoué. Plus jamais en silence.
    if (demoSeedEnabled()) {
      this.logger.log('Prospection : import sauté — amorçage de démonstration actif (SM_DEMO_SEED).');
      return;
    }
    void this.ensureProspected();
  }

  private readonly logger = new Logger(CrmService.name);

  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Device') private readonly devices: Model<Device>,
    @InjectModel('Screen') private readonly screens: Model<Screen>,
    // Ce qui reste dû, pour tout le parc, en une lecture : l'axe « paiement »
    // du score se lit sur des factures échues, jamais sur un statut de compte.
    private readonly billing: BillingService,
  ) {}

  // ─── Pipeline commercial ───

  async listLeads(stage?: LeadStage): Promise<CrmLead[]> {
    await this.ensureSeeded();
    await this.ensureProspected();
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
    if (body.proposal !== undefined) {
      // Datée ICI et pas par le client : « proposée le … » doit dire quand
      // elle a été posée chez nous, pas l'heure d'un poste mal réglé.
      set.proposal = body.proposal === null ? null : { ...body.proposal, at: new Date() };
    }

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
    await this.ensureProspected();

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
   * LE PARC, LIGNE À LIGNE — identité, activité récente, ET SANTÉ.
   *
   * Le décrochage se lit sur les COMMANDES, pas sur l'abonnement : un client
   * qui n'encaisse plus paie encore, et c'est précisément celui-là qu'il faut
   * rappeler cette semaine.
   *
   * ─── CINQ LECTURES POUR TOUT LE PARC, PAS CINQ PAR CLIENT ───
   *
   * Le score, le statut de compte, la tendance et les appareils muets manquaient
   * à cette route ; l'écran les obtenait en appelant `/crm/tenants/:id/health`
   * CLIENT PAR CLIENT après affichage. Outre le coût (une requête par ligne, qui
   * ne tient pas à cinquante restaurants), chacun de ces appels JOURNALISE une
   * consultation de dossier : afficher la liste « ouvrait » tout le parc.
   *
   * Ici, une agrégation par champ — l'activité en un `$group` (le MÊME que la
   * fiche, importé), le parc en deux projections étroites, l'ardoise en une
   * passe de facturation — puis le jugement, en mémoire, avec les fonctions de
   * `health.service`. Aucune boucle ne rappelle quoi que ce soit.
   *
   * Le score rendu ici est celui de la fiche AU POINT PRÈS : mêmes axes, mêmes
   * poids, même plafonnement par l'activité. Seul le détail rédigé de chaque axe
   * reste à la fiche — une liste n'a pas la place d'une phrase par axe.
   */
  async listClients(now: Date = new Date()): Promise<CrmClient[]> {
    const bounds = windowBounds(now);

    const [tenants, activity, devices, screens, overdue] = await Promise.all([
      this.tenants
        .find({}, { name: 1, slug: 1, plan: 1, founderSeat: 1, createdAt: 1, account: 1 })
        .sort({ createdAt: 1 })
        .lean(),
      this.orders.aggregate<TenantActivityRow>([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: '$tenantId', ...activityGroup(bounds) } },
      ]),
      this.devices.find({}, DEVICE_FIELDS).lean(),
      this.screens.find({}, SCREEN_FIELDS).lean(),
      // La file de recouvrement du parc, déjà écrite et déjà testée. Seules les
      // pièces ÉCHUES y figurent — exactement ce dont l'axe « paiement » a
      // besoin pour noter, une facture envoyée hier n'étant pas un impayé.
      this.billing.overdue(now),
    ]);

    const byTenant = new Map(activity.map((a) => [String(a._id), a]));

    const fleets = new Map<string, CrmFleetUnit[]>();
    const push = (tenantId: string, unit: CrmFleetUnit) => {
      const list = fleets.get(tenantId) ?? [];
      list.push(unit);
      fleets.set(tenantId, list);
    };
    for (const d of devices) {
      push(
        String(d.tenantId),
        toFleetUnit(d, (d.kind ?? 'pos') as RevocableDeviceKind, DEVICE_OFFLINE_AFTER_MS, now),
      );
    }
    for (const s of screens) {
      push(String(s.tenantId), toFleetUnit(s, 'screen', SCREEN_OFFLINE_AFTER_MS, now));
    }

    const invoicesByTenant = new Map<string, CrmInvoice[]>();
    for (const invoice of overdue.invoices) {
      const list = invoicesByTenant.get(invoice.tenantId) ?? [];
      list.push(invoice);
      invoicesByTenant.set(invoice.tenantId, list);
    }

    return tenants.map((t) => {
      const id = String(t._id);
      const a = byTenant.get(id) ?? EMPTY_ACTIVITY;
      const lastOrderAt = a.lastOrderAt ?? null;
      const silence = daysSince(lastOrderAt, now);
      const plan = (t.plan ?? 'essentiel') as CrmClient['plan'];
      const fleet = buildFleet(fleets.get(id) ?? []);
      // L'absence de bloc `account` vaut « essai », jamais « anomalie » : les
      // tenants créés avant ce champ n'en ont pas, et `.lean()` ne matérialise
      // pas les défauts Mongoose. Même lecture que `AdminService`.
      const accountStatus = ((t.account as { status?: string } | undefined)?.status ??
        'trial') as TenantAccountStatus;

      const modules = buildModules({
        posOrders: a.posOrders30,
        posLastOrderAt: a.posLastAt,
        onlineOrders: a.onlineOrders30,
        onlineLastOrderAt: a.onlineLastAt,
        posDevices: fleet.units.filter((u) => u.kind === 'pos'),
        kdsDevices: fleet.units.filter((u) => u.kind === 'kds'),
        screens: fleet.units.filter((u) => u.kind === 'screen'),
        // Pas de volet appro ici, et c'est sans effet sur le score : le suivi
        // des stocks est affiché par la fiche mais reste hors de l'axe adoption
        // (`SCORED_MODULE_KEYS`), justement pour que les deux écrans comptent
        // pareil sans que la liste ait à ouvrir PostgreSQL pour tout le parc.
      });

      // La fenêtre 30 j est construite par la MÊME fonction que la fiche : le
      // plancher sous lequel une variation ne veut rien dire y est déjà.
      const window30 = buildWindow(
        ACTIVITY_WINDOW_DAYS,
        { orders: a.orders30, revenueCents: a.revenue30 },
        { orders: a.ordersPrev30, revenueCents: a.revenuePrev30 },
      );

      const score = compositeScore([
        healthAxis(
          'activite',
          scoreActivite({
            daysSinceLastOrder: silence,
            orders7d: a.orders7,
            previousOrders7d: a.ordersPrev7,
            hasHistory: lastOrderAt !== null,
          }),
        ),
        healthAxis('adoption', scoreAdoption(modules)),
        healthAxis('technique', scoreTechnique(fleet)),
        healthAxis(
          'paiement',
          paiementAxis(accountStatus, summarizeOutstanding(invoicesByTenant.get(id) ?? [], now)),
        ),
      ]);

      return {
        _id: id,
        name: t.name,
        slug: t.slug,
        plan,
        mrrCents: PLAN_MRR_CENTS[plan] ?? 0,
        founderSeat: Boolean(t.founderSeat),
        since: iso((t as { createdAt?: Date }).createdAt) ?? now.toISOString(),
        orders30d: window30.orders,
        revenue30dCents: window30.revenueCents,
        lastOrderAt: iso(lastOrderAt),
        daysSinceLastOrder: silence,
        health: clientHealth(lastOrderAt, now),
        accountStatus,
        score: score.value,
        previousOrders: window30.previousOrders,
        ordersDeltaPct: window30.ordersDeltaPct,
        devicesOffline: fleet.offline,
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
    // Jamais en production : voir `demoSeedEnabled`. Sans ce garde-fou, vider
    // la base pour démarrer proprement se solderait par un pipeline de leads
    // fictifs recréé au premier chargement de page.
    if (!demoSeedEnabled()) return Promise.resolve();
    this.seeding ??= (async () => {
      if ((await this.leads.countDocuments({})) > 0) return;
      await this.leads.insertMany(buildSeedLeads());
    })().catch((cause: unknown) => {
      this.logger.warn(`Amorçage de démonstration : raté — ${detailErreur(cause)}`);
      // Une amorce ratée ne doit jamais faire tomber la vue : au pire le
      // pipeline s'affiche vide. On repasse à null pour retenter au prochain appel.
      this.seeding = null;
    });
    return this.seeding;
  }

  // ─── Import de prospection (les vrais leads) ───

  /**
   * Écrit la liste de prospection RÉELLE (`crm.prospection.ts`) — mais
   * seulement là où le seed de démonstration est COUPÉ, c'est-à-dire en
   * production et sur tout environnement « réel ». Là où la démo est active
   * (staging, postes de travail), le pipeline montre sa fiction : y mélanger
   * de vrais restaurants et de vrais numéros ferait le piège inverse de celui
   * que `demoSeedEnabled` évite déjà.
   *
   * Chaque passage est sans danger : l'écriture est un upsert `$setOnInsert`
   * par nom d'établissement — un lead déjà présent n'est JAMAIS retouché, ni
   * son étape, ni ses relances, ni ses notes. Enrichir la liste plus tard ne
   * réécrit donc que les nouveaux venus. (Revers assumé : renommer un lead
   * importé le fait revenir sous son nom d'origine au prochain démarrage —
   * on le repère à son étape « nouveau » et on le pose « perdu ».)
   */
  private prospecting: Promise<void> | null = null;

  private ensureProspected(): Promise<void> {
    if (demoSeedEnabled()) return Promise.resolve();
    this.prospecting ??= (async () => {
      const ops = buildProspectionOps();
      if (ops.length === 0) return;
      const resultat = await this.leads.bulkWrite(ops, { ordered: false });
      this.logger.log(
        `Prospection : ${resultat.upsertedCount} lead(s) importé(s) sur ${ops.length} (le reste était déjà en base).`,
      );
    })().catch((cause: unknown) => {
      this.logger.warn(`Prospection : import raté — ${detailErreur(cause)}`);
      // Même contrat que l'amorce : un import raté n'abat pas la vue, et se
      // retentera au prochain appel.
      this.prospecting = null;
    });
    return this.prospecting;
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
    proposal: raw.proposal
      ? {
          plan: raw.proposal.plan as 'essentiel' | 'complet' | 'boost',
          onlineOrdering: Boolean(raw.proposal.onlineOrdering),
          billing: (raw.proposal.billing ?? 'mensuel') as 'mensuel' | 'annuel',
          // Les propositions posées avant l'Atelier n'ont pas de services :
          // le schéma remplit les défauts (tout à faux, aucune cadence).
          services: LeadServicesSchema.parse(raw.proposal.services ?? {}),
          note: raw.proposal.note ?? '',
          at: iso(raw.proposal.at) ?? new Date(0).toISOString(),
        }
      : null,
    createdAt: iso(raw.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(raw.updatedAt) ?? new Date(0).toISOString(),
    lastTouchAt: touches[0]?.at ?? null,
  };
}
