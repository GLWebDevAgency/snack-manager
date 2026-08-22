import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ADMIN_LOG_ACTION_LABELS,
  DEVICE_REVOKE_REASON_LABELS,
  PAIRING_CODE_TTL_MS,
  REVOCABLE_DEVICE_KIND_LABELS,
  TENANT_ACCOUNT_STATUS_LABELS,
  isAccessBlocked,
  type AdminInvoiceGesture,
  type AdminLogAction,
  type AdminLogEntry,
  type AdminLogQuery,
  type AdminPlan,
  type AdminRevokedDevice,
  type AdminTenantAccount,
  type DeviceRevoke,
  type JwtPayload,
  type PlatformLogAction,
  type RevocableDeviceKind,
  type TenantAccount,
  type TenantAccountStatus,
  type TenantNote,
  type TenantPlanChange,
  type TenantReactivate,
  type TenantSuspend,
} from '@sm/contracts';
import type { AdminLog, Device, Screen, Tenant, User } from '@sm/db';
import { generatePairingCode } from '../screens/pairing-code';

/**
 * Le journal se lit du plus récent au plus ancien.
 *
 * `_id` départage les ex æquo : deux gestes peuvent tomber dans la même
 * milliseconde (une suspension suivie d'une note, un script de reprise), et
 * `at` seul laisserait alors l'ordre d'affichage au hasard du moteur. Un
 * ObjectId croît avec le temps : c'est exactement le départage qu'on veut.
 */
const JOURNAL_ORDER = { at: -1, _id: -1 } as const;

/**
 * Fenêtre de regroupement des consultations de fiche.
 *
 * Trente minutes : la durée d'un appel de support pendant lequel on ouvre,
 * ferme et rouvre le même dossier. Au-delà, c'est une nouvelle consultation et
 * elle mérite sa ligne. Ne s'applique QU'aux consultations — jamais à une
 * action qui modifie l'état d'un compte.
 */
const DETAIL_VIEW_WINDOW_MS = 30 * 60_000;

/**
 * ADMINISTRATION CLIENT — le socle du back-office interne « /sm ».
 *
 * Ce service porte les gestes par lesquels Snack Manager agit sur l'outil de
 * travail d'un commerçant : suspendre son accès, le rouvrir, changer sa
 * formule, couper une tablette volée. Trois principes le structurent.
 *
 * 1. SUSPENDRE N'EST PAS SUPPRIMER. Aucune méthode ici n'efface quoi que ce
 *    soit. Un restaurant suspendu garde son menu, ses commandes, son
 *    historique : on ferme une porte, on ne vide pas les lieux. Le jour où la
 *    facture est réglée, une seule écriture rouvre tout.
 *
 * 2. TOUT PASSE PAR LE JOURNAL. Chaque méthode publique qui modifie l'état
 *    écrit dans `adminLogs`, sans exception — la consultation d'une fiche
 *    détaillée comprise. Le journal est append-only (garanti par le schéma).
 *
 * 3. RESPECT DES CLIENTS DE NOS CLIENTS. Rien ici ne lit la collection des
 *    commandes ni ne remonte un consommateur nominativement. Nous administrons
 *    des COMPTES, pas des carnets d'adresses ; le fichier client d'un
 *    restaurateur lui appartient.
 *
 * Le cloisonnement (`@Roles('sm_admin')`) est posé sur le contrôleur : ce
 * service est TRANS-TENANT par construction et n'a aucun garde-fou interne
 * contre un appelant mal cadré. Il n'est appelé que depuis `AdminController`.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Device') private readonly devices: Model<Device>,
    @InjectModel('Screen') private readonly screens: Model<Screen>,
    @InjectModel('AdminLog') private readonly logs: Model<AdminLog>,
    @InjectModel('User') private readonly users: Model<User>,
  ) {}

  // ─── Statut de compte ───

  /**
   * Fiche « compte » d'un établissement.
   *
   * La consultation elle-même est journalisée : ouvrir le dossier d'un client
   * est un accès à ses données, pas un geste neutre. C'est la contrepartie
   * assumée d'un outil qui voit tous les restaurants.
   */
  async account(actor: JwtPayload, tenantId: string): Promise<AdminTenantAccount> {
    const tenant = await this.requireTenant(tenantId);
    await this.recordDetailView(actor, String(tenant._id));
    return toAccountView(tenant);
  }

  /**
   * Coupe l'accès d'un établissement (impayé, litige).
   *
   * Effet immédiat : le guard relit ce statut à chaque requête, si bien qu'une
   * session déjà ouverte se referme au prochain clic. Les jetons d'APPAREIL
   * (caisse, écran cuisine, téléviseur) ne passent pas par le guard — pour
   * couper une tablette, c'est `revokeDevice` qu'il faut.
   */
  async suspend(
    actor: JwtPayload,
    tenantId: string,
    body: TenantSuspend,
  ): Promise<AdminTenantAccount> {
    const at = new Date();
    const tenant = await this.setAccount(tenantId, {
      status: 'suspended',
      since: at,
      reason: body.reason,
      suspendedAt: at,
    });
    await this.record(actor, {
      action: 'tenant.suspend',
      tenantId: String(tenant._id),
      reason: body.reason,
      at,
    });
    return toAccountView(tenant);
  }

  /**
   * Rouvre l'accès.
   *
   * Le compte repart `active` et non vers son statut d'avant : un
   * établissement qu'on réactive est un client qui travaille, quelle qu'ait
   * été sa situation avant la coupure. `suspendedAt` est effacé — la trace de
   * l'épisode reste dans le journal, qui, lui, ne s'efface pas.
   */
  async reactivate(
    actor: JwtPayload,
    tenantId: string,
    body: TenantReactivate,
  ): Promise<AdminTenantAccount> {
    const at = new Date();
    const tenant = await this.setAccount(tenantId, {
      status: 'active',
      since: at,
      reason: body.reason,
      suspendedAt: null,
    });
    await this.record(actor, {
      action: 'tenant.reactivate',
      tenantId: String(tenant._id),
      reason: body.reason,
      at,
    });
    return toAccountView(tenant);
  }

  /**
   * Change la formule. Le statut de compte n'est PAS touché : passer un client
   * de « Essentiel » à « Boost » n'est pas une décision d'accès.
   */
  async changePlan(
    actor: JwtPayload,
    tenantId: string,
    body: TenantPlanChange,
  ): Promise<AdminTenantAccount> {
    const before = await this.requireTenant(tenantId);
    const previous = (before.plan ?? 'essentiel') as AdminPlan;

    const tenant = await this.updateTenant(tenantId, { plan: body.plan });
    await this.record(actor, {
      action: 'tenant.plan_change',
      tenantId: String(tenant._id),
      reason: body.reason,
      // Une ligne de journal doit se lire seule : sans l'ancienne formule, on
      // ne sait pas si le client a monté ou descendu en gamme.
      meta: { from: previous, to: body.plan },
    });
    return toAccountView(tenant);
  }

  /**
   * Note interne sur un client.
   *
   * Elle n'a pas de collection à elle : une note EST une entrée du journal.
   * Un fil unique, daté, non modifiable, où « rappelé le gérant, promet de
   * régler vendredi » se lit à côté de « suspension pour impayé » — deux
   * fils séparés se contrediraient au premier litige.
   */
  async addNote(actor: JwtPayload, tenantId: string, body: TenantNote): Promise<AdminLogEntry> {
    const tenant = await this.requireTenant(tenantId);
    return this.record(actor, {
      action: 'tenant.note',
      tenantId: String(tenant._id),
      reason: body.note,
    });
  }

  // ─── Facturation ───

  /**
   * Trace un GESTE DE FACTURATION — émission, encaissement, annulation.
   *
   * Point d'entrée réservé à `BillingService`, qui rédige la phrase (via
   * `BILLING_JOURNAL`) et connaît la pièce ; ce service, lui, tient le registre.
   * La séparation est celle du reste du fichier : la facturation décide, le
   * journal enregistre.
   *
   * POURQUOI CE POINT D'ENTRÉE EXISTE. Ces trois gestes passaient par
   * `addNote`, donc sous l'action `tenant.note`, intitulée « Note interne » à
   * l'écran. Un encaissement de 139 € qui s'affiche comme un commentaire libre
   * est un journal qui se trompe sur la NATURE de ce qui s'est produit — et
   * c'est précisément ce registre qu'on ouvre en cas de litige. Trois actions
   * dédiées le rendent exact, filtrable, et rattaché à la PIÈCE (`targetId`)
   * plutôt qu'au seul établissement.
   *
   * L'écriture reste une INSERTION, comme toutes les autres : le journal est
   * append-only (garanti par le schéma), une correction s'y fait en ajoutant
   * une ligne, jamais en retouchant la précédente.
   */
  async recordInvoiceGesture(
    actor: JwtPayload,
    tenantId: string,
    gesture: AdminInvoiceGesture,
  ): Promise<AdminLogEntry> {
    const tenant = await this.requireTenant(tenantId);
    return this.record(actor, {
      action: gesture.action,
      tenantId: String(tenant._id),
      // La pièce, pas seulement le client : c'est ce qui permet de relire
      // l'histoire d'une facture précise six mois plus tard.
      targetId: gesture.invoiceId,
      reason: gesture.summary,
      meta: { ...gesture.meta },
    });
  }

  // ─── Révocation d'appareil ───

  /**
   * Coupe une tablette de terrain (caisse ou écran cuisine).
   *
   * Le jeton d'appareil est DÉTRUIT, pas désactivé : `deviceToken` repasse à
   * `null`, si bien que `requirePairedDevice` ne retrouve plus rien. Une
   * tablette volée cesse d'ouvrir la caisse à la seconde même, définitivement
   * — elle ne redeviendra jamais valide, même si l'appareil est réappairé
   * plus tard (un appairage tire un jeton neuf).
   *
   * L'appareil repart en attente d'appairage AVEC un code frais : l'équipe SM
   * est au téléphone avec le restaurateur quand elle coupe, et c'est ce code
   * qu'elle lui dicte pour remettre la caisse de secours en service.
   */
  revokeDevice(
    actor: JwtPayload,
    tenantId: string,
    deviceId: string,
    body: DeviceRevoke,
  ): Promise<AdminRevokedDevice> {
    return this.revoke(actor, 'device', tenantId, deviceId, body);
  }

  /** Même geste pour un téléviseur de salle — clé HDMI volée ou remplacée. */
  revokeScreen(
    actor: JwtPayload,
    tenantId: string,
    screenId: string,
    body: DeviceRevoke,
  ): Promise<AdminRevokedDevice> {
    return this.revoke(actor, 'screen', tenantId, screenId, body);
  }

  private async revoke(
    actor: JwtPayload,
    target: 'device' | 'screen',
    tenantId: string,
    id: string,
    body: DeviceRevoke,
  ): Promise<AdminRevokedDevice> {
    const tenantOid = toObjectId(tenantId, 'Établissement introuvable');
    const label = target === 'device' ? 'Appareil introuvable' : 'Écran introuvable';
    const targetOid = toObjectId(id, label);

    const at = new Date();
    const code = generatePairingCode();
    const expiresAt = new Date(at.getTime() + PAIRING_CODE_TTL_MS);

    // Le filtre porte AUSSI le tenant : un identifiant deviné ne suffit pas à
    // couper la caisse d'un autre restaurant, même depuis un compte d'équipe.
    const filter = { _id: targetOid, tenantId: tenantOid };
    const $set = {
      deviceToken: null,
      paired: false,
      lastSeenAt: null,
      pairingCode: code,
      pairingCodeExpiresAt: expiresAt,
      revokedAt: at,
      revokedReason: body.reason,
    };

    const collection: Model<Device> | Model<Screen> =
      target === 'device' ? this.devices : this.screens;
    const raw = await (collection as Model<Device>)
      .findOneAndUpdate(filter, { $set }, { new: true })
      .lean();
    if (!raw) throw new NotFoundException(label);

    const kind: RevocableDeviceKind =
      target === 'screen' ? 'screen' : ((raw.kind ?? 'pos') as RevocableDeviceKind);

    await this.record(actor, {
      action: target === 'device' ? 'device.revoke' : 'screen.revoke',
      tenantId,
      targetId: String(raw._id),
      reason: body.note,
      meta: { reason: body.reason, kind, name: String(raw.name ?? '') },
      at,
    });

    return {
      id: String(raw._id),
      tenantId: String(raw.tenantId),
      name: String(raw.name ?? ''),
      kind,
      kindLabel: REVOCABLE_DEVICE_KIND_LABELS[kind],
      paired: false,
      revokedAt: at.toISOString(),
      revokedReason: body.reason,
      revokedReasonLabel: DEVICE_REVOKE_REASON_LABELS[body.reason],
      pairing: { code, expiresAt: expiresAt.toISOString() },
    };
  }

  // ─── Journal ───

  /**
   * Trace une action de PLATEFORME — un réglage de Snack Manager elle-même.
   *
   * Point d'entrée réservé aux surfaces qui n'agissent sur AUCUN client :
   * aujourd'hui les liens de réseaux sociaux affichés sur notre vitrine
   * (`PlatformService`), demain le nom affiché ou l'adresse de contact. La
   * séparation est la même qu'avec `recordInvoiceGesture` : l'appelant rédige
   * la phrase et connaît la rubrique, ce service tient le registre.
   *
   * POURQUOI CETTE LIGNE EXISTE. Ce qui est enregistré depuis cet écran part
   * sur la page d'accueil de l'entreprise, sans relecture et sans validation
   * d'un tiers. C'est exactement le geste qu'on veut pouvoir dater et
   * attribuer six mois plus tard — « depuis quand ce lien LinkedIn pointe-t-il
   * là, et qui l'a mis ? ». Le journal est append-only, la réponse ne se
   * réécrit pas.
   *
   * Aucun `tenantId` : cette action ne vise pas un restaurant, et lui en
   * attribuer un au hasard fausserait le journal de ce restaurant.
   */
  recordPlatformAction(
    actor: JwtPayload,
    entry: {
      action: PlatformLogAction;
      reason: string;
      meta?: Record<string, unknown> | null;
    },
  ): Promise<AdminLogEntry> {
    return this.record(actor, { ...entry, tenantId: null });
  }

  /** Journal d'un établissement, du plus récent au plus ancien. */
  async journal(tenantId: string, query: AdminLogQuery): Promise<AdminLogEntry[]> {
    const oid = toObjectId(tenantId, 'Établissement introuvable');
    const filter: Record<string, unknown> = { tenantId: oid };
    if (query.action) filter.action = query.action;
    const rows = await this.logs.find(filter).sort(JOURNAL_ORDER).limit(query.limit).lean();
    return rows.map(toLogEntry);
  }

  /** Journal complet du parc — la vue « qu'a fait l'équipe cette semaine ». */
  async allLogs(query: AdminLogQuery): Promise<AdminLogEntry[]> {
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    const rows = await this.logs.find(filter).sort(JOURNAL_ORDER).limit(query.limit).lean();
    return rows.map(toLogEntry);
  }

  /**
   * Trace la consultation d'une fiche détaillée — depuis cette surface ou
   * depuis une autre vue du CRM (fiche client 360, page de support…).
   *
   * Exposée publiquement pour que toute vue qui ouvre le dossier d'un client
   * passe par le même journal : une consultation non tracée serait un angle
   * mort dans le seul registre qui dit ce que nous voyons de nos clients.
   *
   * REGROUPÉE PAR FENÊTRE, contrairement aux actions qui modifient l'état.
   * Une fiche se recharge à chaque navigation, à chaque rafraîchissement, deux
   * fois en développement : sans regroupement, une matinée de support noie les
   * suspensions sous des centaines de lignes identiques, et un journal
   * illisible ne protège plus personne. Ce qu'on veut savoir — « qui a ouvert
   * ce dossier, et quand » — reste intact à la demi-heure près.
   */
  async recordDetailView(actor: JwtPayload, tenantId: string): Promise<void> {
    if (await this.viewedRecently(actor.sub, tenantId)) return;
    await this.record(actor, { action: 'tenant.detail_view', tenantId });
  }

  /** Dernière consultation de CE dossier par CET auteur, dans la fenêtre. */
  private async viewedRecently(actorId: string, tenantId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(actorId) || !Types.ObjectId.isValid(tenantId)) return false;
    const [last] = await this.logs
      .find({
        tenantId: new Types.ObjectId(tenantId),
        actorId: new Types.ObjectId(actorId),
        action: 'tenant.detail_view',
      })
      .sort(JOURNAL_ORDER)
      .limit(1)
      .lean();
    if (!last?.at) return false;
    return Date.now() - new Date(last.at).getTime() < DETAIL_VIEW_WINDOW_MS;
  }

  // ─── Écritures ───

  /**
   * Écrit une ligne de journal.
   *
   * Passage OBLIGÉ de toute action d'administration : une méthode publique qui
   * ne l'appelle pas est un bug, pas une optimisation.
   *
   * L'ordre est délibéré — la mutation d'abord, le journal ensuite. Journaliser
   * avant d'agir produirait, sur une écriture ratée, une ligne affirmant une
   * suspension qui n'a pas eu lieu : un registre qui ment est pire qu'un
   * registre incomplet. Si l'insertion échoue, la requête remonte l'erreur au
   * lieu de rendre un succès silencieux.
   */
  private async record(
    actor: JwtPayload,
    entry: {
      action: AdminLogAction;
      /** `null` UNIQUEMENT pour une action de plateforme — voir ci-dessous. */
      tenantId: string | null;
      targetId?: string | null;
      reason?: string;
      meta?: Record<string, unknown> | null;
      at?: Date;
    },
  ): Promise<AdminLogEntry> {
    const created = await this.logs.create({
      at: entry.at ?? new Date(),
      actorId: toObjectId(actor.sub, 'Auteur inconnu'),
      // Dénormalisé : le journal ne doit pas changer de contenu le jour où un
      // compte d'équipe est renommé ou supprimé.
      actorEmail: await this.actorEmail(actor.sub),
      action: entry.action,
      // `null` traverse tel quel : le modèle n'exige un établissement que pour
      // les actions qui en visent un (`required` conditionnel, @sm/db). Une
      // suspension sans tenant reste donc refusée à l'écriture.
      tenantId:
        entry.tenantId === null
          ? null
          : toObjectId(entry.tenantId, 'Établissement introuvable'),
      targetId: entry.targetId ?? null,
      reason: entry.reason ?? '',
      meta: entry.meta ?? null,
    });
    return toLogEntry(created.toObject() as RawLog);
  }

  private async actorEmail(userId: string): Promise<string> {
    if (!Types.ObjectId.isValid(userId)) return '';
    const user = await this.users.findById(userId, { email: 1 }).lean<{ email?: string } | null>();
    return user?.email ?? '';
  }

  /** Réécrit le bloc `account` en entier : ses quatre champs bougent ensemble. */
  private setAccount(
    tenantId: string,
    account: { status: TenantAccountStatus; since: Date; reason: string; suspendedAt: Date | null },
  ): Promise<RawTenant> {
    return this.updateTenant(tenantId, { account });
  }

  private async updateTenant(tenantId: string, $set: Record<string, unknown>): Promise<RawTenant> {
    const oid = toObjectId(tenantId, 'Établissement introuvable');
    const raw = await this.tenants.findOneAndUpdate({ _id: oid }, { $set }, { new: true }).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as RawTenant;
  }

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    const oid = toObjectId(tenantId, 'Établissement introuvable');
    const raw = await this.tenants.findById(oid).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as RawTenant;
  }
}

// ─── Conversions ───

type RawTenant = Tenant & { _id: unknown; createdAt?: Date };
type RawLog = AdminLog & { _id: unknown };

/**
 * Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou, Mongoose
 * lève une CastError et l'équipe reçoit un 500 au lieu d'un 404.
 */
function toObjectId(id: string, message: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException(message);
  return new Types.ObjectId(id);
}

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/**
 * Bloc `account` d'un tenant, absence comprise.
 *
 * Les établissements créés avant ce champ n'en ont pas en base, et `.lean()`
 * ne matérialise pas les défauts Mongoose : la fiche doit les afficher comme
 * des comptes d'essai ordinaires, jamais comme une anomalie ni un blocage.
 */
function toAccount(raw: RawTenant): TenantAccount {
  const account = raw.account as
    | { status?: string; since?: Date; reason?: string; suspendedAt?: Date | null }
    | undefined;
  return {
    status: (account?.status ?? 'trial') as TenantAccountStatus,
    since: iso(account?.since) ?? iso(raw.createdAt) ?? new Date(0).toISOString(),
    reason: account?.reason ?? '',
    suspendedAt: iso(account?.suspendedAt),
  };
}

function toAccountView(raw: RawTenant): AdminTenantAccount {
  const account = toAccount(raw);
  return {
    tenantId: String(raw._id),
    name: String(raw.name ?? ''),
    slug: String(raw.slug ?? ''),
    plan: (raw.plan ?? 'essentiel') as AdminPlan,
    founderSeat: raw.founderSeat === true,
    account,
    accessBlocked: isAccessBlocked(account.status),
    statusLabel: TENANT_ACCOUNT_STATUS_LABELS[account.status],
  };
}

function toLogEntry(raw: RawLog): AdminLogEntry {
  const action = raw.action as AdminLogAction;
  return {
    _id: String(raw._id),
    at: iso(raw.at) ?? new Date(0).toISOString(),
    actor: { id: String(raw.actorId ?? ''), email: raw.actorEmail ?? '' },
    action,
    actionLabel: ADMIN_LOG_ACTION_LABELS[action] ?? action,
    // `null` et non `''` : une action de plateforme ne vise aucun
    // établissement, ce qui n'est pas la même chose qu'un identifiant perdu.
    tenantId: raw.tenantId ? String(raw.tenantId) : null,
    targetId: raw.targetId ?? null,
    reason: raw.reason ?? '',
    meta: (raw.meta as Record<string, unknown> | null) ?? null,
  };
}
