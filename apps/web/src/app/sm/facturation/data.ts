"use client";

/**
 * DONNÉES DE L'ÉCRAN DE FACTURATION — back-office INTERNE Snack Manager.
 *
 * ─── La question de l'écran ───
 *
 * « Qui paie, qui doit, et depuis combien de jours ? » — dans cet ordre, et
 * avec un seul chiffre qui déclenche un geste : l'ANCIENNETÉ de la plus vieille
 * créance. Un total dû ne se traite pas ; « 65 jours » se traite.
 *
 * ─── Deux routes, et pas une de plus ───
 *
 * `GET /crm/billing/overdue` (la file du parc) et `GET /crm/tenants` (le parc,
 * pour l'abonnement et le statut de chaque compte). On n'appelle DÉLIBÉRÉMENT
 * pas `/crm/tenants/:id/billing` client par client : cette route JOURNALISE une
 * consultation de fiche (`AdminService.recordDetailView`, appelée par
 * `BillingService.tenantBilling`). Balayer le parc pour composer un total
 * écrirait autant de lignes de journal que de clients à chaque ouverture de
 * l'écran — et un journal d'administration qui se remplit tout seul est un
 * journal qu'on cesse de lire. La fiche facturation d'UN client se lit sur sa
 * fiche, où la consultation est un geste voulu.
 *
 * ─── Cloisonnement ───
 *
 * Les deux routes traversent le parc entier et exigent `sm_admin` côté API.
 * La coquille `/sm` renvoie un gérant chez lui avant même l'affichage, mais la
 * garde qui compte reste le 403.
 *
 * ─── Respect des clients de nos clients ───
 *
 * Aucun champ de ce fichier ne porte un CONSOMMATEUR. L'argent dont il est
 * question va du restaurateur VERS nous : abonnement, mise en place, options.
 * Rien ici ne lit une commande.
 *
 * ─── Formes lues ───
 *
 * Les types sont PUBLIÉS (`CrmBillingOverdue`, `CrmOverdueInvoice`,
 * `@sm/contracts`) et la forme réelle a été vérifiée en appelant l'API. On la
 * normalise quand même depuis `unknown` : un écran de recouvrement ne doit pas
 * tomber parce qu'un champ manque, et un total à `NaN` sur cet écran-là serait
 * pire qu'un écran vide. Les LIBELLÉS monétaires viennent de l'API
 * (`formatEuros`) — le journal, la fiche et cet écran écrivent ainsi « 139,00 € »
 * de la même façon, au même endroit du code.
 *
 * Rappel de convention : tous les montants circulent en CENTIMES (int).
 */

import {
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_METHOD_LABELS,
  INVOICE_REMINDER_CHANNELS,
  INVOICE_REMINDER_CHANNEL_LABELS,
  TENANT_ACCOUNT_STATUS_LABELS,
  formatEuros,
  type BillingPlan,
  type InvoicePaymentMethod,
  type InvoiceReminderChannel,
  type TenantAccountStatus,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Lecteurs tolérants
// ─────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const bag = (v: unknown): Bag =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Première clé présente et non vide, sinon `""`. */
function str(source: unknown, ...keys: string[]): string {
  const o = bag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** Première clé numériquement exploitable, sinon `null`. */
function num(source: unknown, ...keys: string[]): number | null {
  const o = bag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

const bool = (source: unknown, ...keys: string[]): boolean | null => {
  const o = bag(source);
  for (const k of keys) if (typeof o[k] === "boolean") return o[k] as boolean;
  return null;
};

/** Date ISO exploitable, sinon `null` — une date invalide vaut une absence. */
function iso(source: unknown, ...keys: string[]): string | null {
  const raw = str(source, ...keys);
  if (!raw) return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

/**
 * Valeur d'énumération inconnue = valeur ABSENTE.
 *
 * Sans ce filtre, un statut inattendu traverserait le cast et finirait en clé
 * de `Record` : la pastille rendrait une classe CSS littérale « undefined »,
 * donc rien du tout — sur l'écran qui sert justement à repérer les comptes déjà
 * suspendus.
 */
function readEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = String(v ?? "").toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

const PLANS: BillingPlan[] = ["essentiel", "complet", "boost"];
const ACCOUNT_STATUSES: TenantAccountStatus[] = [
  "trial",
  "active",
  "suspended",
  "churned",
];

// ─────────────────────────────────────────────────────────────
// L'échelle de recouvrement
// ─────────────────────────────────────────────────────────────

export type Tone = "alert" | "prep" | "mut";

export type RecoveryStep = {
  /** Ancienneté à partir de laquelle ce geste s'impose, en jours pleins. */
  minDays: number;
  tone: Tone;
  /** Le geste, à l'infinitif — c'est ce qui se lit sous le chiffre. */
  geste: string;
};

/**
 * CE QU'ON FAIT, SELON L'ÂGE DE LA CRÉANCE.
 *
 * Les seuils sont ceux de `PAYMENT_SCORE_BANDS` (@sm/contracts) : ils épousent
 * le rythme réel d'un recouvrement — on vérifie le prélèvement dans la semaine,
 * on rappelle à huit jours, on relance par écrit à quinze, on met en demeure à
 * trente, on suspend au-delà de soixante.
 *
 * Recopiés plutôt que dérivés de la constante amont, à dessein : une bande
 * ajoutée là-bas sans libellé ici rendrait `undefined` au milieu d'une ligne de
 * la file. Le lien se maintient à la lecture, pas à l'exécution.
 */
export const RECOVERY_LADDER: readonly RecoveryStep[] = [
  { minDays: 60, tone: "alert", geste: "Suspendre l'accès" },
  { minDays: 30, tone: "alert", geste: "Mettre en demeure" },
  { minDays: 15, tone: "prep", geste: "Relancer par écrit" },
  { minDays: 8, tone: "prep", geste: "Rappeler le gérant" },
  { minDays: 1, tone: "mut", geste: "Vérifier le prélèvement" },
];

/**
 * LE SEUIL QUI CHANGE LA COULEUR DE L'ÉCRAN.
 *
 * Au-delà de trente jours, une créance ne se règle plus par un appel courtois :
 * elle appelle un écrit. C'est le moment où l'ancienneté cesse d'être une
 * information et devient une décision — d'où la mise en évidence en tête.
 */
export const MISE_EN_DEMEURE_DAYS = 30;

export const recoveryStep = (days: number): RecoveryStep | null =>
  RECOVERY_LADDER.find((s) => days >= s.minDays) ?? null;

// ─────────────────────────────────────────────────────────────
// Modèles de vue
// ─────────────────────────────────────────────────────────────

/** Une ligne de la file de recouvrement : une créance échue, et son client. */
export type OverdueRow = {
  /** Identifiant de la FACTURE — les deux gestes s'y adressent. */
  id: string;
  number: string;
  label: string;
  kindLabel: string;
  periodLabel: string;
  amountCents: number;
  /** « 139,00 € », tel que l'API le rédige. */
  amountLabel: string;
  dueAt: string | null;
  /** Jours pleins de retard, recalculés par l'API à chaque lecture. */
  overdueDays: number;

  tenantId: string;
  tenantName: string;
  plan: BillingPlan | null;
  planLabel: string;
  accountStatus: TenantAccountStatus | null;
  accountStatusLabel: string;
  /** Accès DÉJÀ coupé : la relance n'est plus le geste, la réactivation l'est. */
  accessBlocked: boolean;

  /** Dernière relance tracée sur la pièce — `null` si jamais relancée. */
  lastReminderAt: string | null;
  /** Canal de cette dernière relance, en français (« Appel », « Courrier »…). */
  lastReminderChannelLabel: string;
  /** Nombre de relances déjà faites sur cette pièce. */
  reminderCount: number;

  /** Rang de cette créance parmi celles du MÊME client (1 = la plus vieille). */
  rank: number;
  /** Nombre de créances échues de ce client — deux factures font UN appel. */
  tenantInvoices: number;
  /** Total échu de ce client, tous impayés confondus. */
  tenantDueCents: number;
};

/** La file du parc, prête à afficher. */
export type BillingQueue = {
  generatedAt: string | null;
  /** Nombre de factures échues. */
  count: number;
  /** Nombre de CLIENTS concernés — c'est le nombre d'appels à passer. */
  tenants: number;
  totalCents: number;
  totalLabel: string;
  /** Ancienneté de la plus vieille créance du parc, en jours. */
  oldestDays: number;
  rows: OverdueRow[];
};

export const EMPTY_QUEUE: BillingQueue = {
  generatedAt: null,
  count: 0,
  tenants: 0,
  totalCents: 0,
  totalLabel: formatEuros(0),
  oldestDays: 0,
  rows: [],
};

/** Un client du parc, réduit à ce que la facturation regarde. */
export type ParkTenant = {
  id: string;
  name: string;
  plan: BillingPlan | null;
  /** Abonnement mensuel facturé, en CENTIMES. */
  mrrCents: number;
  accountStatus: TenantAccountStatus | null;
};

// ─────────────────────────────────────────────────────────────
// Appels
// ─────────────────────────────────────────────────────────────

export const billingApi = {
  overdue: () => api.get<unknown>("/crm/billing/overdue"),
  park: () => api.get<unknown>("/crm/tenants"),

  /** ENCAISSER : le moyen est obligatoire, la date vaut « maintenant » par défaut. */
  pay: (
    tenantId: string,
    invoiceId: string,
    body: { method: InvoicePaymentMethod; paidAt?: string; note?: string },
  ) =>
    api.post<unknown>(
      `/crm/tenants/${tenantId}/invoices/${invoiceId}/pay`,
      body,
    ),

  /** ANNULER : motif obligatoire. Aucune route de suppression n'existe. */
  cancel: (tenantId: string, invoiceId: string, reason: string) =>
    api.post<unknown>(`/crm/tenants/${tenantId}/invoices/${invoiceId}/cancel`, {
      reason,
    }),

  /**
   * RELANCE FAITE : le canal (défaut « appel ») et une note libre. Le geste
   * s'écrit sur la pièce ET au journal, sous le compte de l'opérateur — c'est
   * ce qui transforme l'échelle affichée en recouvrement réellement tracé.
   */
  remind: (
    tenantId: string,
    invoiceId: string,
    body: { channel: InvoiceReminderChannel; note?: string },
  ) =>
    api.post<unknown>(
      `/crm/tenants/${tenantId}/invoices/${invoiceId}/remind`,
      body,
    ),
};

/**
 * Message d'erreur LISIBLE, jamais un code HTTP nu devant un opérateur.
 *
 * Les refus de cette surface sont déjà bien rédigés côté API (« La facture
 * SM-2026-0002 est réglée : elle se corrige par un avoir, pas par une
 * annulation. ») : on les affiche TELS QUELS. Le cas `Validation failed` est le
 * seul à ne pas se lire — le vrai motif est alors dans `issues[]`, on va le
 * chercher plutôt que d'afficher une phrase en anglais.
 */
export function errText(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const issue = str(list(bag(e.body).issues)[0], "message");
  if (issue) return issue;
  const message = typeof e.message === "string" ? e.message.trim() : "";
  return message && message !== "Validation failed" ? message : fallback;
}

// ─────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────

/** Une facture de la file → une ligne, sans les agrégats par client. */
function readInvoice(raw: unknown): Omit<OverdueRow, "rank" | "tenantInvoices" | "tenantDueCents"> {
  const o = bag(raw);
  const tenant = bag(o.tenant);
  const period = bag(o.period);
  const plan = readEnum(tenant.plan, PLANS);
  const status = readEnum(tenant.accountStatus, ACCOUNT_STATUSES);
  // `dueCents` est le reste dû SUR CETTE PIÈCE ; `amountCents` son montant
  // facial. Les deux sont égaux pour une facture échue, mais c'est le reste dû
  // qui s'additionne — c'est lui que l'API totalise dans `totalCents`.
  const amountCents = num(o, "dueCents", "amountCents") ?? 0;
  // Le résumé des relances tel que l'API le rend : { count, last }. Une pièce
  // jamais relancée — ou une réponse d'avant le champ — vaut simplement
  // « aucune relance », jamais un affichage cassé.
  const reminders = bag(o.reminders);
  const lastReminder = bag(reminders.last);

  return {
    id: str(o, "_id", "id", "invoiceId"),
    number: str(o, "number") || "Sans numéro",
    label: str(o, "label"),
    kindLabel: str(o, "kindLabel") || str(o, "kind"),
    periodLabel: str(period, "label") || str(period, "key"),
    amountCents,
    amountLabel: str(o, "amountLabel") || formatEuros(amountCents),
    dueAt: iso(o, "dueAt"),
    overdueDays: Math.max(0, Math.round(num(o, "overdueDays") ?? 0)),

    tenantId: str(tenant, "id") || str(o, "tenantId"),
    tenantName: str(tenant, "name") || "Client inconnu",
    plan,
    planLabel: str(tenant, "planLabel") || plan || "",
    accountStatus: status,
    accountStatusLabel:
      str(tenant, "accountStatusLabel") ||
      (status ? TENANT_ACCOUNT_STATUS_LABELS[status] : ""),
    // Un compte suspendu l'est TOUJOURS, quoi que renvoie le drapeau : on prend
    // le drapeau de l'API quand il existe, le statut sinon.
    accessBlocked: bool(tenant, "accessBlocked") ?? status === "suspended",

    lastReminderAt: iso(lastReminder, "at"),
    lastReminderChannelLabel:
      str(lastReminder, "channelLabel") || str(lastReminder, "channel"),
    reminderCount: Math.max(0, Math.round(num(reminders, "count") ?? 0)),
  };
}

/**
 * LA FILE, DU PLUS ANCIEN AU PLUS RÉCENT.
 *
 * L'API trie déjà par échéance croissante (`RECOVERY_ORDER`, billing.service),
 * et on retrie quand même : cet ordre EST la règle de travail — on commence
 * toujours par la créance la plus vieille — et il ne doit pas dépendre d'un
 * détail d'implémentation amont. Le tri est stable sur l'ancienneté décroissante
 * pour que deux factures échues le même jour restent groupées par client.
 */
export function readQueue(raw: unknown): BillingQueue {
  const o = bag(raw);
  const invoices = list(o.invoices).map(readInvoice).filter((i) => i.id !== "");

  invoices.sort(
    (a, b) =>
      b.overdueDays - a.overdueDays ||
      (a.dueAt ?? "").localeCompare(b.dueAt ?? "") ||
      a.tenantName.localeCompare(b.tenantName, "fr") ||
      a.number.localeCompare(b.number),
  );

  // Agrégats par client : « 2ᵉ des 3 impayées, 417,00 € au total » se dit au
  // téléphone, « facture SM-2026-0007 » ne se dit pas.
  const byTenant = new Map<string, { count: number; cents: number }>();
  for (const i of invoices) {
    const cur = byTenant.get(i.tenantId) ?? { count: 0, cents: 0 };
    byTenant.set(i.tenantId, {
      count: cur.count + 1,
      cents: cur.cents + i.amountCents,
    });
  }

  const seen = new Map<string, number>();
  const rows: OverdueRow[] = invoices.map((i) => {
    const rank = (seen.get(i.tenantId) ?? 0) + 1;
    seen.set(i.tenantId, rank);
    const agg = byTenant.get(i.tenantId) ?? { count: 1, cents: i.amountCents };
    return {
      ...i,
      rank,
      tenantInvoices: agg.count,
      tenantDueCents: agg.cents,
    };
  });

  const totalCents =
    num(o, "totalCents") ?? rows.reduce((sum, r) => sum + r.amountCents, 0);

  return {
    generatedAt: iso(o, "generatedAt"),
    // Les compteurs de l'API font foi quand ils existent ; sinon on les déduit
    // de la liste plutôt que d'afficher zéro à côté de trois lignes.
    count: num(o, "count") ?? rows.length,
    tenants: num(o, "tenants") ?? byTenant.size,
    totalCents,
    totalLabel: str(o, "totalLabel") || formatEuros(totalCents),
    oldestDays: Math.max(0, Math.round(num(o, "oldestDays") ?? rows[0]?.overdueDays ?? 0)),
    rows,
  };
}

export function readPark(raw: unknown): ParkTenant[] {
  const o = bag(raw);
  return list(Array.isArray(raw) ? raw : (o.items ?? o.tenants ?? o.clients))
    .map((t) => {
      const o = bag(t);
      return {
        id: str(o, "_id", "id", "tenantId"),
        name: str(o, "name") || "Sans nom",
        plan: readEnum(o.plan, PLANS),
        mrrCents: num(o, "mrrCents") ?? 0,
        accountStatus:
          readEnum(o.accountStatus, ACCOUNT_STATUSES) ??
          readEnum(bag(o.account).status, ACCOUNT_STATUSES),
      };
    })
    .filter((t) => t.id !== "");
}

// ─────────────────────────────────────────────────────────────
// Le MRR, coupé en deux
// ─────────────────────────────────────────────────────────────

/**
 * CE QUI RENTRE, CE QUI NE RENTRE PAS.
 *
 * Le bandeau de la coquille affiche le MRR du parc — la somme des abonnements,
 * réglés ou non. Ce n'est pas la question de cet écran-ci. Ici on sépare :
 *
 *  · ENCAISSÉ — les clients ACTIFS sans aucune facture échue. Cet argent tombe
 *    sans que personne ne décroche ;
 *  · À RISQUE — les clients facturables qui traînent un impayé, plus les
 *    comptes SUSPENDUS : un compte suspendu reste facturé (c'est précisément
 *    parce qu'il doit de l'argent qu'il est coupé, `isBillable` côté API), mais
 *    son abonnement n'est pas en train de rentrer ;
 *  · les comptes en ESSAI et les clients PARTIS ne comptent nulle part : il n'y
 *    a rien à leur prélever.
 *
 * C'est une PHOTO DE L'ABONNEMENT, pas un relevé bancaire — l'API n'expose pas
 * de total encaissé à l'échelle du parc, et l'inventer à partir des factures
 * `payee` du mois demanderait une lecture par client (donc autant de lignes de
 * journal). Le libellé de l'écran le dit.
 */
export type MrrSplit = {
  collectedCents: number;
  atRiskCents: number;
  /** Somme des deux : tout ce qui est facturable ce mois-ci. */
  billedCents: number;
  /** Clients facturables, tous statuts confondus. */
  billable: number;
  /** Clients facturables à jour. */
  onTime: number;
  /** Clients facturables en retard ou suspendus. */
  atRisk: number;
  /** Taille du parc, essais et départs compris. */
  clients: number;
};

const EMPTY_SPLIT: MrrSplit = {
  collectedCents: 0,
  atRiskCents: 0,
  billedCents: 0,
  billable: 0,
  onTime: 0,
  atRisk: 0,
  clients: 0,
};

export function splitMrr(park: ParkTenant[], queue: BillingQueue): MrrSplit {
  if (park.length === 0) return { ...EMPTY_SPLIT };
  const late = new Set(queue.rows.map((r) => r.tenantId));

  return park.reduce<MrrSplit>(
    (acc, t) => {
      acc.clients += 1;
      // Un essai ne se facture pas, un client parti non plus.
      const billable =
        t.accountStatus === "active" || t.accountStatus === "suspended";
      if (!billable) return acc;

      acc.billable += 1;
      acc.billedCents += t.mrrCents;
      if (t.accountStatus === "suspended" || late.has(t.id)) {
        acc.atRisk += 1;
        acc.atRiskCents += t.mrrCents;
      } else {
        acc.onTime += 1;
        acc.collectedCents += t.mrrCents;
      }
      return acc;
    },
    { ...EMPTY_SPLIT },
  );
}

// ─────────────────────────────────────────────────────────────
// Moyens de règlement
// ─────────────────────────────────────────────────────────────

/**
 * Liste FERMÉE, reprise du contrat : un champ libre finirait par contenir
 * « cf. mail », et le jour où l'on veut savoir combien de clients sont en
 * prélèvement, la réponse n'existerait plus.
 */
export const PAYMENT_METHODS = INVOICE_PAYMENT_METHODS;
export const PAYMENT_METHOD_LABELS = INVOICE_PAYMENT_METHOD_LABELS;

/**
 * Le prélèvement SEPA est le moyen par défaut de la maison : l'abonnement est
 * annoncé « prélèvement mensuel constant » au client (FAQ #17). Un encaissement
 * saisi à la main est le plus souvent la régularisation d'un prélèvement rejeté.
 */
export const DEFAULT_PAYMENT_METHOD: InvoicePaymentMethod = "prelevement";

// ─────────────────────────────────────────────────────────────
// Canaux de relance
// ─────────────────────────────────────────────────────────────

/** Liste fermée, reprise du contrat — même raison que les moyens de règlement. */
export const REMINDER_CHANNELS = INVOICE_REMINDER_CHANNELS;
export const REMINDER_CHANNEL_LABELS = INVOICE_REMINDER_CHANNEL_LABELS;

/**
 * L'appel est le canal par défaut : c'est le geste réel de l'échelle à J+8
 * (« Rappeler le gérant »), et neuf relances sur dix se font au téléphone.
 */
export const DEFAULT_REMINDER_CHANNEL: InvoiceReminderChannel = "appel";

// ─────────────────────────────────────────────────────────────
// Formatage propre à cette surface
// ─────────────────────────────────────────────────────────────

/** « 65 j » — l'unité colle au chiffre, la file se balaie en colonne. */
export const fmtDays = (days: number): string => `${Math.max(0, Math.round(days))} j`;

/**
 * « relancé il y a 3 j » — ou « relancé aujourd'hui », parce que « il y a 0 j »
 * ne se dit pas. `null` quand la pièce n'a jamais été relancée : la ligne
 * n'affiche alors RIEN — une mention « jamais relancé » sur chaque ligne
 * noierait la seule information qui compte, celle qui existe.
 */
export function fmtReminderAge(at: string | null, now: Date = new Date()): string | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  return days === 0 ? "relancé aujourd'hui" : `relancé il y a ${days} j`;
}

/** `2026-06-15T00:00:00.000Z` → `15/06/2026`, en UTC comme l'API et le journal. */
export function fmtDueDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return [
    String(d.getUTCDate()).padStart(2, "0"),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    d.getUTCFullYear(),
  ].join("/");
}

/** Aujourd'hui au format `AAAA-MM-JJ` — borne haute d'une date de règlement. */
export function todayInput(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * `AAAA-MM-JJ` d'un champ date → instant ISO acceptable par l'API.
 *
 * Deux pièges, tous deux payés par un 400 en pleine conversation téléphonique :
 *
 *  · une date NUE se lit minuit UTC. Un chèque saisi « le 12 » serait antidaté
 *    de quelques heures, et à cheval sur un fuseau, daté de la veille. On vise
 *    donc MIDI, qui tombe le bon jour partout ;
 *  · midi peut être dans le FUTUR quand l'équipe saisit « aujourd'hui » le
 *    matin, et l'API refuse une date de règlement à venir (au-delà de cinq
 *    minutes de tolérance d'horloge). Dans ce cas la valeur juste est
 *    « maintenant » — c'est bien aujourd'hui qu'on encaisse.
 */
export function paidAtIso(value: string, now: Date = new Date()): string | null {
  if (!value) return null;
  const noon = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return null;
  return noon.getTime() > now.getTime() ? now.toISOString() : noon.toISOString();
}

/** Montant en centimes → « 139,00 € », même rédaction que l'API. */
export const euros = (cents: number): string => formatEuros(cents);

/** Réexporté pour que la surface se lise sans remonter aux contrats. */
export type { InvoicePaymentMethod, InvoiceReminderChannel };
