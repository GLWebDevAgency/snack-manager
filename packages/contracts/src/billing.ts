import { z } from 'zod';
import {
  TENANT_ACCOUNT_STATUS_LABELS,
  isAccessBlocked,
  type TenantAccountStatus,
} from './admin';
import { PLAN_LABELS, PLAN_MRR_CENTS } from './crm';

// ─────────────────────────────────────────────────────────────
// FACTURATION — qui paie, qui doit, et depuis quand.
//
// C'est la pièce qui manquait sous l'administration client : la suspension
// existait déjà, mais rien ne mesurait ce qui la LÉGITIME. L'axe « paiement »
// du score de santé répondait « abonnement à jour » à tout le monde, faute de
// chiffre à regarder. Ce fichier apporte ce chiffre.
//
// TROIS PRINCIPES.
//
// 1. UNE FACTURE EST UNE PIÈCE COMPTABLE, PAS UNE LIGNE DE LOG. Elle porte un
//    numéro d'une séquence CONTINUE et SANS TROU, et elle ne se supprime
//    jamais : on l'annule, avec un motif, et le numéro reste consommé. C'est
//    l'exigence française de numérotation chronologique ininterrompue, et
//    c'est aussi du simple bon sens — un numéro manquant est une question sans
//    réponse le jour d'un contrôle.
//
// 2. « EN RETARD » NE SE STOCKE PAS, IL SE CALCULE. Un statut figé en base
//    serait faux dès le lendemain matin sans une tâche planifiée pour le
//    rafraîchir, et un impayé qu'on ne voit pas est exactement ce qu'on essaie
//    d'éliminer. Le retard est donc une FONCTION DU TEMPS, recalculée à chaque
//    lecture (`effectiveInvoiceStatus`) : la file des impayés ne peut pas être
//    périmée, même si rien ne tourne la nuit.
//
// 3. RESPECT DES CLIENTS DE NOS CLIENTS. Rien ici ne touche au chiffre
//    d'affaires du restaurant ni à ses consommateurs : on facture un
//    ABONNEMENT à un commerçant. Les montants de ce fichier sont les NÔTRES.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

// ─── Formules facturées ───

/**
 * Les trois formules, réexportées depuis `./crm` plutôt que redéclarées.
 *
 * `admin.ts` et `crm.ts` les redéclarent chacun pour éviter un cycle avec
 * `index.ts` ; ici l'import direct de `./crm` suffit puisque ce module ne fait
 * qu'importer et n'est importé par aucun des deux.
 */
export type BillingPlan = keyof typeof PLAN_MRR_CENTS;

/**
 * Frais de mise en place, en CENTIMES.
 *
 * 290 € one-shot à la signature (docs/specs/contraintes-business.md §6.8) —
 * ils justifient l'onboarding. Ils ne font PAS partie du MRR : les confondre
 * gonflerait le récurrent d'un revenu qui ne se reproduit pas.
 */
export const INSTALL_FEE_CENTS = 29_000;

// ─── Nature d'une facture ───

/**
 * Ce qu'une facture facture. Quatre natures, pas de texte libre.
 *
 * La distinction n'est pas cosmétique : elle porte la règle « un seul
 * abonnement par mois et par client ». Sans elle, la mise en place et le
 * premier mois d'abonnement — émis le même jour, sur la même période —
 * seraient indiscernables, et le garde-fou anti-double-facturation refuserait
 * l'un des deux.
 */
export const INVOICE_KINDS = ['abonnement', 'mise_en_place', 'option', 'autre'] as const;
export const InvoiceKindSchema = z.enum(INVOICE_KINDS);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  abonnement: 'Abonnement',
  mise_en_place: 'Mise en place',
  option: 'Option',
  autre: 'Autre',
};

// ─── Statuts ───

/**
 * Le cycle de vie d'une facture.
 *
 *  - `brouillon` : préparée, pas encore envoyée au client. Rien n'est dû ;
 *  - `envoyee`   : partie chez le client, échéance non dépassée ;
 *  - `en_retard` : envoyée, échéance dépassée, toujours pas réglée ;
 *  - `payee`     : encaissée, avec un moyen et une date ;
 *  - `annulee`   : retirée avec un motif. Le numéro reste consommé.
 *
 * `en_retard` est un statut CALCULÉ (cf. `effectiveInvoiceStatus`) : il figure
 * dans l'énumération parce qu'une facture peut légitimement être marquée
 * telle quelle en base par une future relance automatique, mais l'API ne
 * l'écrit jamais elle-même — elle le déduit de l'échéance et de l'heure.
 */
export const INVOICE_STATUSES = [
  'brouillon',
  'envoyee',
  'en_retard',
  'payee',
  'annulee',
] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  brouillon: 'Brouillon',
  envoyee: 'Envoyée',
  en_retard: 'En retard',
  payee: 'Payée',
  annulee: 'Annulée',
};

/**
 * Statuts qu'un service a le droit d'ÉCRIRE.
 *
 * `en_retard` en est exclu : l'écrire figerait dans le marbre une information
 * qui dépend de l'heure qu'il est.
 */
export const STORED_INVOICE_STATUSES = [
  'brouillon',
  'envoyee',
  'payee',
  'annulee',
] as const satisfies readonly InvoiceStatus[];

/** Une facture réglée ou annulée est SOLDÉE : plus rien ne se joue dessus. */
export const isSettledInvoiceStatus = (status: InvoiceStatus): boolean =>
  status === 'payee' || status === 'annulee';

/**
 * Une facture DUE : émise, ni réglée ni annulée. Le brouillon n'en fait pas
 * partie — on ne réclame pas une somme qu'on n'a pas envoyée.
 */
export const isDueInvoiceStatus = (status: InvoiceStatus): boolean =>
  status === 'envoyee' || status === 'en_retard';

// ─── Moyens de règlement ───

/**
 * Comment l'argent arrive. Liste fermée, pour la même raison que les motifs de
 * révocation : un champ libre finit par contenir « cf. mail » et le jour où
 * l'on veut savoir combien de clients sont en prélèvement, la réponse n'existe
 * plus.
 */
export const INVOICE_PAYMENT_METHODS = ['prelevement', 'virement', 'carte', 'cheque'] as const;
export const InvoicePaymentMethodSchema = z.enum(INVOICE_PAYMENT_METHODS);
export type InvoicePaymentMethod = z.infer<typeof InvoicePaymentMethodSchema>;

export const INVOICE_PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  prelevement: 'Prélèvement SEPA',
  virement: 'Virement',
  carte: 'Carte bancaire',
  cheque: 'Chèque',
};

// ─── Numérotation ───

/**
 * Préfixe du compteur de séquence (collection `counters`).
 *
 * Une séquence PAR ANNÉE et GLOBALE au parc — pas une par client. Le numéro
 * identifie une pièce de NOTRE comptabilité, pas une ligne du dossier d'un
 * restaurant : deux clients ne peuvent pas porter le même « SM-2026-0007 ».
 */
export const INVOICE_COUNTER_PREFIX = 'invoice:';
export const invoiceCounterId = (year: number): string => `${INVOICE_COUNTER_PREFIX}${year}`;

/** `SM-2026-0001` — quatre chiffres, complétés à gauche, jamais réutilisés. */
export const formatInvoiceNumber = (year: number, seq: number): string =>
  `SM-${year}-${String(seq).padStart(4, '0')}`;

export const INVOICE_NUMBER_RE = /^SM-\d{4}-\d{4,}$/;
export const isInvoiceNumberShape = (value: string): boolean => INVOICE_NUMBER_RE.test(value);

// ─── Périodes ───

export const MONTH_LABELS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Une période de facturation s'écrit `AAAA-MM` — un mois calendaire, entier. */
export const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isPeriodKeyShape = (value: string): boolean => PERIOD_KEY_RE.test(value);

/** Mois d'une date, en UTC — la clé de période d'un abonnement mensuel. */
export function monthKey(value: Date | string): string {
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mois décalé de `delta` (négatif = passé). `shiftMonthKey('2026-12', 1)` → `2027-01`. */
export function shiftMonthKey(key: string, delta: number): string {
  const period = billingPeriod(key);
  const d = new Date(period.start);
  return monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
}

/**
 * Bornes d'une période de facturation.
 *
 * TOUT EST EN UTC, délibérément. Un abonnement mensuel n'a pas d'heure : le
 * faire basculer à minuit heure de Paris ferait dépendre le mois facturé du
 * réglage de fuseau du serveur, et un client changerait de mois selon
 * l'endroit d'où l'on ouvre sa fiche. Le décalage de deux heures est sans
 * conséquence sur une échéance qui se compte en jours.
 */
export function billingPeriod(key: string): {
  key: string;
  start: Date;
  end: Date;
  label: string;
} {
  if (!isPeriodKeyShape(key)) {
    throw new Error(`Période de facturation invalide : « ${key} » (attendu AAAA-MM).`);
  }
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return {
    key,
    start: new Date(Date.UTC(year, month - 1, 1)),
    // Dernière milliseconde du mois : la période est fermée des deux côtés,
    // si bien que deux mois consécutifs ne se chevauchent ni ne laissent de trou.
    end: new Date(Date.UTC(year, month, 1) - 1),
    label: `${MONTH_LABELS_FR[month - 1] ?? ''} ${year}`,
  };
}

/** Libellé d'une période à partir de sa date de début. */
export const periodLabel = (start: Date | string): string => billingPeriod(monthKey(start)).label;

// ─── Rédaction (le journal et les écrans lisent du français, pas des centimes) ───

/** `13900` → `139,00 €`. Espace fine des milliers, virgule décimale. */
export function formatEuros(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${units},${String(abs % 100).padStart(2, '0')} €`;
}

/**
 * `01/09/2026`. Écrit en UTC pour la même raison que les périodes : une
 * échéance qui change de jour selon le fuseau du lecteur n'est pas une
 * échéance.
 */
export function formatFrDate(value: Date | string): string {
  const d = new Date(value);
  return [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');
}

/** Jours pleins écoulés entre deux instants — négatif si `to` précède `from`. */
export const daysBetween = (from: Date | string, to: Date | string): number =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);

/** Jours pleins de retard sur une échéance — 0 tant qu'elle n'est pas dépassée. */
export const daysLate = (dueAt: Date | string, now: Date | string = new Date()): number =>
  Math.max(0, daysBetween(dueAt, now));

// ─── La règle qui fait tout marcher ───

/**
 * Statut RÉEL d'une facture à l'instant où on la regarde.
 *
 * Seule fonction à consulter pour savoir où en est une pièce : le statut
 * stocké dit ce qu'on a décidé, celui-ci dit ce qui EST. Un `envoyee` dont
 * l'échéance est passée est `en_retard`, sans qu'aucune tâche de nuit n'ait eu
 * à le réécrire ; et un `en_retard` stocké dont l'échéance aurait été repoussée
 * redevient `envoyee` — la donnée fraîche l'emporte sur la donnée figée.
 */
export function effectiveInvoiceStatus(
  stored: InvoiceStatus,
  dueAt: Date | string,
  now: Date | string = new Date(),
): InvoiceStatus {
  if (stored === 'payee' || stored === 'annulee' || stored === 'brouillon') return stored;
  return new Date(dueAt).getTime() < new Date(now).getTime() ? 'en_retard' : 'envoyee';
}

// ─── Formes rendues par l'API ───

/** Une facture telle qu'elle circule (dates ISO, montants en centimes). */
export type CrmInvoice = {
  _id: string;
  tenantId: string;
  /** Numéro de la séquence continue — `SM-2026-0004`. */
  number: string;
  kind: InvoiceKind;
  kindLabel: string;
  /** Libellé lisible : « Abonnement Complet — septembre 2026 ». */
  label: string;
  period: { key: string; start: string; end: string; label: string };
  amountCents: number;
  amountLabel: string;
  /** Statut EFFECTIF à l'instant de la lecture — « en retard » y est calculé. */
  status: InvoiceStatus;
  statusLabel: string;
  /**
   * Ce qui est réellement écrit en base. Rendu à côté du statut effectif pour
   * qu'un écart (« envoyée » stockée, « en retard » affichée) se lise au lieu
   * de se deviner.
   */
  storedStatus: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string;
  paidAt: string | null;
  method: InvoicePaymentMethod | null;
  methodLabel: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  /** Jours pleins de retard — 0 si l'échéance n'est pas dépassée. */
  overdueDays: number;
  /** Reste dû SUR CETTE PIÈCE : 0 dès qu'elle est réglée, annulée ou au brouillon. */
  dueCents: number;
};

/**
 * L'ardoise d'un client, résumée.
 *
 * `totalDueCents` est le total ÉMIS ET NON RÉGLÉ ; `overdueCents` en est la
 * part déjà échue. Les deux sont rendus séparément parce qu'ils ne déclenchent
 * pas le même geste : une facture envoyée hier n'est pas un impayé, c'est un
 * encaissement à venir. Ce qui justifie un appel — puis une suspension —, c'est
 * `oldestOverdueDays`.
 */
export type CrmOutstanding = {
  totalDueCents: number;
  totalDueLabel: string;
  invoices: number;
  overdueCents: number;
  overdueLabel: string;
  overdueInvoices: number;
  oldestOverdueAt: string | null;
  oldestOverdueDays: number;
};

/** Ardoise vide — l'état d'un client parfaitement à jour. */
export const NO_OUTSTANDING: CrmOutstanding = {
  totalDueCents: 0,
  totalDueLabel: formatEuros(0),
  invoices: 0,
  overdueCents: 0,
  overdueLabel: formatEuros(0),
  overdueInvoices: 0,
  oldestOverdueAt: null,
  oldestOverdueDays: 0,
};

/**
 * Additionne ce qui reste dû sur un jeu de factures déjà converties.
 *
 * Fonction PURE : elle sert à l'API, et elle sert aussi de porte d'entrée à
 * l'axe « paiement » du score de santé sans qu'aucun des deux n'ait à
 * reproduire la règle.
 */
export function summarizeOutstanding(
  invoices: readonly CrmInvoice[],
  now: Date | string = new Date(),
): CrmOutstanding {
  let totalDueCents = 0;
  let count = 0;
  let overdueCents = 0;
  let overdueInvoices = 0;
  let oldest: CrmInvoice | null = null;

  for (const invoice of invoices) {
    if (invoice.dueCents <= 0) continue;
    totalDueCents += invoice.dueCents;
    count += 1;
    if (invoice.status !== 'en_retard') continue;
    overdueCents += invoice.dueCents;
    overdueInvoices += 1;
    // Comparaison lexicographique d'ISO : c'est aussi une comparaison chronologique.
    if (oldest === null || invoice.dueAt < oldest.dueAt) oldest = invoice;
  }

  return {
    totalDueCents,
    totalDueLabel: formatEuros(totalDueCents),
    invoices: count,
    overdueCents,
    overdueLabel: formatEuros(overdueCents),
    overdueInvoices,
    oldestOverdueAt: oldest ? oldest.dueAt : null,
    oldestOverdueDays: oldest ? daysLate(oldest.dueAt, now) : 0,
  };
}

// ─── L'axe « paiement » du score de santé ───

/**
 * Bandes de retard, du plus grave au plus léger. Elles épousent le rythme
 * réel d'un recouvrement : on rappelle dans la semaine, on relance à quinze
 * jours, on met en demeure à trente, on suspend au-delà de soixante.
 */
export const PAYMENT_SCORE_BANDS: readonly { minDays: number; score: number }[] = [
  { minDays: 60, score: 0 },
  { minDays: 30, score: 20 },
  { minDays: 15, score: 40 },
  { minDays: 8, score: 60 },
  { minDays: 1, score: 80 },
];

/**
 * L'AXE « PAIEMENT », enfin alimenté par des chiffres.
 *
 * Il répondait jusqu'ici « Abonnement à jour » à tout le monde parce que rien
 * ne mesurait le paiement : la seule chose qu'il savait lire était le statut de
 * compte, c'est-à-dire la CONSÉQUENCE d'un impayé, jamais sa cause. Un client
 * qui doit trois mois mais qu'on n'a pas encore suspendu ressortait à 100/100.
 *
 * La forme du retour est identique à celle de `scorePaiement` (health.service)
 * pour que le branchement soit un remplacement d'un argument, pas une
 * réécriture : `{ measured, score, detail }`.
 *
 * L'ORDRE DES TESTS EST LA RÈGLE MÉTIER : un compte suspendu note 0 quoi qu'il
 * arrive — même soldé le matin même, l'accès est coupé et le client le vit
 * ainsi. Vient ensuite le retard réel, puis seulement les cas paisibles.
 */
export function paiementAxis(
  accountStatus: TenantAccountStatus,
  outstanding: CrmOutstanding = NO_OUTSTANDING,
): { measured: boolean; score: number | null; detail: string } {
  if (isAccessBlocked(accountStatus)) {
    const ardoise =
      outstanding.totalDueCents > 0 ? ` — ${outstanding.totalDueLabel} dû(s)` : '';
    return { measured: true, score: 0, detail: `Compte suspendu — accès coupé${ardoise}.` };
  }

  if (outstanding.overdueInvoices > 0) {
    const days = outstanding.oldestOverdueDays;
    const score = PAYMENT_SCORE_BANDS.find((b) => days >= b.minDays)?.score ?? 80;
    const pieces =
      outstanding.overdueInvoices > 1 ? `${outstanding.overdueInvoices} factures` : '1 facture';
    return {
      measured: true,
      score,
      detail: `${pieces} en retard, ${outstanding.overdueLabel} — la plus ancienne depuis ${days} jour(s).`,
    };
  }

  if (accountStatus === 'churned') {
    return { measured: true, score: 50, detail: 'Client parti — compte conservé, plus facturé.' };
  }

  if (accountStatus === 'trial') {
    return { measured: true, score: 100, detail: 'Période d’essai — rien à facturer.' };
  }

  if (outstanding.totalDueCents > 0) {
    return {
      measured: true,
      score: 100,
      detail: `Abonnement à jour — ${outstanding.totalDueLabel} en cours, échéance non dépassée.`,
    };
  }

  return { measured: true, score: 100, detail: 'Abonnement à jour.' };
}

// ─── Fiche facturation d'un client ───

/** L'abonnement en cours, tel qu'il se lit sur la fiche. */
export type CrmSubscription = {
  plan: BillingPlan;
  planLabel: string;
  mrrCents: number;
  mrrLabel: string;
  founderSeat: boolean;
  accountStatus: TenantAccountStatus;
  accountStatusLabel: string;
  accessBlocked: boolean;
  /** Client depuis — l'entrée dans le parc, pas le début du statut courant. */
  since: string;
  /** `false` en essai et après un départ : il n'y a rien à prélever. */
  billable: boolean;
};

/**
 * La prochaine échéance.
 *
 * `invoiceNumber` vaut `null` quand la pièce n'est pas encore émise : c'est
 * alors une échéance THÉORIQUE (le prélèvement du 1er du mois prochain), pas
 * une créance. La distinction évite d'annoncer au client un montant dû qui
 * n'existe encore nulle part.
 */
export type CrmNextDue = {
  at: string;
  amountCents: number;
  amountLabel: string;
  daysUntil: number;
  invoiceNumber: string | null;
};

export type CrmTenantBilling = {
  tenantId: string;
  name: string;
  slug: string;
  subscription: CrmSubscription;
  nextDue: CrmNextDue | null;
  outstanding: CrmOutstanding;
  /** Historique, du plus récent au plus ancien. */
  invoices: CrmInvoice[];
  /** Instant du calcul — le retard en dépend, il doit être lisible. */
  generatedAt: string;
};

// ─── File des impayés du parc ───

export type CrmOverdueInvoice = CrmInvoice & {
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: BillingPlan;
    planLabel: string;
    accountStatus: TenantAccountStatus;
    accountStatusLabel: string;
    accessBlocked: boolean;
  };
};

/**
 * Tous les impayés du parc, DU PLUS ANCIEN AU PLUS RÉCENT.
 *
 * L'ordre est le contraire de celui du journal, et c'est délibéré : un journal
 * répond à « que s'est-il passé ? », une file de recouvrement à « par quoi je
 * commence ? ». On commence toujours par la créance la plus vieille.
 */
export type CrmBillingOverdue = {
  generatedAt: string;
  count: number;
  /** Nombre de clients concernés — deux factures d'un même client font un appel. */
  tenants: number;
  totalCents: number;
  totalLabel: string;
  /** Ancienneté de la plus vieille créance du parc, en jours. */
  oldestDays: number;
  invoices: CrmOverdueInvoice[];
};

// ─── Entrées d'API (validées par zod) ───

/**
 * Émettre une facture.
 *
 * Tout est optionnel : le cas courant — « facture le mois en cours au tarif de
 * sa formule » — se déclenche avec un corps vide. Les champs ne servent qu'aux
 * exceptions (régularisation d'un mois passé, geste commercial, option).
 */
export const InvoiceIssueSchema = z.object({
  /** Mois facturé, `AAAA-MM`. Défaut : le mois courant. */
  period: z
    .string()
    .trim()
    .regex(PERIOD_KEY_RE, 'Période attendue au format AAAA-MM')
    .optional(),
  kind: InvoiceKindSchema.default('abonnement'),
  /** Montant en CENTIMES. Défaut : le MRR de la formule en cours. */
  amountCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  /** Échéance. Défaut : le 1er jour de la période facturée. */
  dueAt: z.coerce.date().optional(),
  label: z.string().trim().max(200).default(''),
  /** `true` = pièce préparée mais pas envoyée : rien n'est dû tant qu'elle l'est. */
  draft: z.boolean().default(false),
});
export type InvoiceIssue = z.infer<typeof InvoiceIssueSchema>;

/**
 * Encaisser. Le MOYEN est obligatoire — « payée » sans savoir comment ne se
 * rapproche d'aucun relevé bancaire. La DATE est facultative parce qu'elle vaut
 * « maintenant » neuf fois sur dix, et qu'un chèque encaissé la semaine
 * dernière se saisit en la précisant.
 */
export const InvoicePaySchema = z.object({
  method: InvoicePaymentMethodSchema,
  paidAt: z.coerce.date().optional(),
  /** Précision libre : numéro de chèque, référence du virement… */
  note: z.string().trim().max(500).default(''),
});
export type InvoicePay = z.infer<typeof InvoicePaySchema>;

/**
 * Annuler. Le motif est OBLIGATOIRE, comme pour une suspension : une pièce
 * comptable retirée sans explication est une question sans réponse six mois
 * plus tard. Aucune suppression n'existe — le numéro reste consommé.
 */
export const InvoiceCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez le motif de l’annulation').max(500),
});
export type InvoiceCancel = z.infer<typeof InvoiceCancelSchema>;

export const BillingHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type BillingHistoryQuery = z.infer<typeof BillingHistoryQuerySchema>;

// ─── Rédaction des lignes de journal ───

/**
 * Les phrases écrites au journal d'administration.
 *
 * Elles vivent ici, à côté des règles, et pas dans le service : une ligne de
 * journal se relit six mois plus tard, souvent par quelqu'un d'autre, et son
 * libellé mérite d'être versionné avec la logique qui le produit. Chacune se
 * lit SEULE — numéro, montant, date : jamais « facture mise à jour ».
 */
export const BILLING_JOURNAL = {
  issued: (invoice: {
    number: string;
    amountLabel: string;
    label: string;
    dueAt: string;
    storedStatus: InvoiceStatus;
  }): string =>
    invoice.storedStatus === 'brouillon'
      ? `Facture ${invoice.number} préparée (brouillon) — ${invoice.amountLabel}, ${invoice.label}.`
      : `Facture ${invoice.number} émise — ${invoice.amountLabel}, ${invoice.label}, échéance le ${formatFrDate(invoice.dueAt)}.`,

  paid: (invoice: { number: string; amountLabel: string }, method: InvoicePaymentMethod, paidAt: Date | string, note: string): string =>
    `Facture ${invoice.number} encaissée — ${invoice.amountLabel} par ${INVOICE_PAYMENT_METHOD_LABELS[method].toLowerCase()} le ${formatFrDate(paidAt)}.${note ? ` ${note}` : ''}`,

  cancelled: (invoice: { number: string; amountLabel: string }, reason: string): string =>
    `Facture ${invoice.number} annulée — ${invoice.amountLabel}. Motif : ${reason}`,
} as const;

/** Libellé par défaut d'une facture, quand l'équipe n'en saisit pas. */
export function defaultInvoiceLabel(
  kind: InvoiceKind,
  plan: BillingPlan,
  period: { label: string },
): string {
  if (kind === 'mise_en_place') return `Mise en place — onboarding et formation (${period.label})`;
  if (kind === 'abonnement') return `Abonnement ${PLAN_LABELS[plan]} — ${period.label}`;
  return `${INVOICE_KIND_LABELS[kind]} — ${period.label}`;
}

/** MRR facturé d'une formule, en centimes. */
export const planMrrCents = (plan: BillingPlan): number => PLAN_MRR_CENTS[plan] ?? 0;

/** Libellé d'une formule — réexporté pour que la surface facturation soit autonome. */
export const planLabel = (plan: BillingPlan): string => PLAN_LABELS[plan] ?? plan;

/** Libellé d'un statut de compte — même raison. */
export const accountStatusLabel = (status: TenantAccountStatus): string =>
  TENANT_ACCOUNT_STATUS_LABELS[status];
