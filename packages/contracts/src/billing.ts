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

// ═════════════════════════════════════════════════════════════
// CÔTÉ GÉRANT — « Back-office → Abonnement : toutes vos factures »
//
// Tout ce qui précède décrit la facturation vue par NOTRE équipe. Ce qui suit
// décrit la même facturation vue par CELUI QUI PAIE. La FAQ #17 lui promet
// depuis le premier jour « Back-office → Abonnement : toutes les factures en
// PDF, le détail de votre formule » ; jusqu'ici il n'avait rien, et une
// promesse commerciale non tenue est une dette qui se rembourse en confiance.
//
// TROIS RÈGLES SUPPLÉMENTAIRES, propres à cette lecture-là.
//
// 1. LE TENANT VIENT DU JETON, JAMAIS DE L'URL. Une facture est une donnée
//    financière : un gérant qui lirait celles du voisin serait une fuite grave,
//    pas un bug d'affichage. Il n'existe donc AUCUN paramètre d'établissement
//    sur ces routes — rien à deviner, rien à forger.
//
// 2. UNE FACTURE RENDUE AU CLIENT EST UNE PIÈCE OPPOSABLE. Elle porte les
//    mentions obligatoires du droit français, et celles qui manquent en base
//    s'affichent en EMPLACEMENT VIDE — jamais inventées. Une facture fausse est
//    pire qu'une facture absente : la première expose le client à un redressement,
//    la seconde à un e-mail de relance.
//
// 3. UN COMPTE SUSPENDU GARDE CET ÉCRAN. C'est le seul, et c'est la condition
//    pour qu'il puisse régulariser : couper à un impayé l'accès à ses propres
//    factures, c'est lui retirer le moyen de payer.
// ═════════════════════════════════════════════════════════════

// ─── Conversion d'une facture stockée en facture d'API ───

/**
 * Une facture telle qu'elle sort de la base, avec tout ce que Mongo autorise :
 * champs absents sur les documents anciens, dates rendues en `Date` ou en
 * chaîne selon le chemin de lecture, identifiants qui ne sont pas des chaînes.
 */
export type StoredInvoice = {
  _id: unknown;
  tenantId?: unknown;
  number?: unknown;
  kind?: string | null;
  label?: string | null;
  period?: { start?: Date | string | null; end?: Date | string | null } | null;
  amountCents?: number | null;
  status?: string | null;
  issuedAt?: Date | string | null;
  dueAt?: Date | string | null;
  paidAt?: Date | string | null;
  method?: string | null;
  cancelledAt?: Date | string | null;
  cancelReason?: string | null;
};

const isoOrNull = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/**
 * DOCUMENT STOCKÉ → FACTURE D'API, statut effectif recalculé à l'instant `now`.
 *
 * Cette conversion vivait en privé dans `crm/billing.service.ts`, où elle
 * servait la seule fiche de l'équipe SM. Elle est remontée ici parce qu'un
 * SECOND lecteur existe désormais — le gérant — et que deux conversions
 * parallèles finiraient par diverger sur le seul point qui compte : le statut.
 * Le jour où le client verrait « Payée » là où l'équipe lit « En retard », la
 * conversation ne serait plus rattrapable.
 *
 * Fonction PURE, sans Mongoose ni date implicite : `now` est un argument pour
 * qu'un test puisse se placer la veille d'une échéance.
 */
export function invoiceView(raw: StoredInvoice, now: Date | string = new Date()): CrmInvoice {
  const storedStatus = (raw.status ?? 'brouillon') as InvoiceStatus;
  const dueAt = raw.dueAt ? new Date(raw.dueAt) : new Date(0);
  const status = effectiveInvoiceStatus(storedStatus, dueAt, now);
  const amountCents = Number(raw.amountCents ?? 0);
  const kind = (raw.kind ?? 'abonnement') as InvoiceKind;
  const method = (raw.method ?? null) as InvoicePaymentMethod | null;
  const start = raw.period?.start ? new Date(raw.period.start) : dueAt;
  const end = raw.period?.end ? new Date(raw.period.end) : dueAt;
  const key = monthKey(start);

  return {
    _id: String(raw._id),
    tenantId: String(raw.tenantId ?? ''),
    number: String(raw.number ?? ''),
    kind,
    kindLabel: INVOICE_KIND_LABELS[kind] ?? kind,
    label: String(raw.label ?? ''),
    period: { key, start: start.toISOString(), end: end.toISOString(), label: billingPeriod(key).label },
    amountCents,
    amountLabel: formatEuros(amountCents),
    status,
    statusLabel: INVOICE_STATUS_LABELS[status] ?? status,
    storedStatus,
    issuedAt: isoOrNull(raw.issuedAt),
    dueAt: dueAt.toISOString(),
    paidAt: isoOrNull(raw.paidAt),
    method,
    methodLabel: method ? INVOICE_PAYMENT_METHOD_LABELS[method] : null,
    cancelledAt: isoOrNull(raw.cancelledAt),
    cancelReason: String(raw.cancelReason ?? ''),
    overdueDays: status === 'en_retard' ? daysLate(dueAt, now) : 0,
    dueCents: isDueInvoiceStatus(status) ? amountCents : 0,
  };
}

/**
 * LA PROCHAINE ÉCHÉANCE — même règle des trois cas que la fiche de l'équipe.
 *
 * `due` doit arriver TRIÉ PAR ÉCHÉANCE CROISSANTE : la première ligne est la
 * prochaine à tomber, et une facture déjà échue passe donc devant. C'est
 * volontaire — annoncer au gérant « prochain prélèvement le 1er du mois
 * prochain » alors qu'il doit encore celui du mois dernier serait un écran qui
 * ment par omission.
 */
export function nextInvoiceDue(
  due: readonly CrmInvoice[],
  plan: BillingPlan,
  billable: boolean,
  now: Date = new Date(),
): CrmNextDue | null {
  if (!billable) return null;

  const first = due[0];
  if (first) {
    return {
      at: first.dueAt,
      amountCents: first.dueCents,
      amountLabel: formatEuros(first.dueCents),
      // Un retard compte en NÉGATIF le même nombre de jours qu'`overdueDays` :
      // deux arrondis indépendants afficheraient « −80 jours » à côté de
      // « 79 jours de retard » sur la même pièce.
      daysUntil: first.overdueDays > 0 ? -first.overdueDays : daysBetween(now, first.dueAt),
      invoiceNumber: first.number,
    };
  }

  const at = billingPeriod(shiftMonthKey(monthKey(now), 1)).start;
  const amountCents = planMrrCents(plan);
  return {
    at: at.toISOString(),
    amountCents,
    amountLabel: formatEuros(amountCents),
    daysUntil: daysBetween(now, at),
    invoiceNumber: null,
  };
}

/**
 * CE QUE LE GÉRANT A LE DROIT DE VOIR DANS SON HISTORIQUE.
 *
 * Un BROUILLON n'est jamais parti chez lui : l'afficher annoncerait un
 * prélèvement qui n'existe pas et provoquerait un appel pour rien.
 *
 * Une facture ANNULÉE reste visible dès lors qu'elle a été ÉMISE — il l'a
 * reçue, la faire disparaître ferait un trou dans SON historique au moment où
 * il rapproche ses relevés. Annulée avant d'être envoyée, elle n'a jamais
 * existé pour lui : on ne la ressuscite pas.
 *
 * Le test sur `issuedAt` ne porte QUE sur les annulées : une pièce ancienne
 * réglée sans date d'émission en base ne doit pas s'évaporer de l'historique du
 * client à cause d'un champ que personne n'avait rempli à l'époque.
 */
export function isTenantVisibleInvoice(invoice: {
  storedStatus: InvoiceStatus;
  issuedAt: string | null;
}): boolean {
  if (invoice.storedStatus === 'brouillon') return false;
  if (invoice.storedStatus === 'annulee') return invoice.issuedAt !== null;
  return true;
}

// ─── Mentions légales d'une facture française ───

/**
 * L'EMPLACEMENT D'UNE MENTION QU'ON N'A PAS.
 *
 * Il s'imprime tel quel sur le PDF. C'est laid, et c'est le but : une mention
 * manquante doit se VOIR — sur la facture comme dans le rapport d'exploitation
 * — au lieu d'être comblée par une valeur plausible. Un SIRET inventé sur une
 * pièce comptable est un faux ; un crochet vide est un travail à finir.
 */
export const INVOICE_LEGAL_PLACEHOLDER = '[À COMPLÉTER]';

/** Une mention obligatoire absente, avec ce qu'il faut collecter pour la combler. */
export type InvoiceLegalGap = {
  /** Identifiant machine — `issuer.siret`, `customer.address`… */
  field: string;
  /** Ce qui manque, en français. */
  label: string;
  /** Où le trouver / comment le renseigner. */
  hint: string;
};

/**
 * Une partie de la facture — l'émetteur (nous) ou le client (le restaurant).
 *
 * TOUT est nullable, délibérément : ces informations n'existent nulle part en
 * base aujourd'hui, et un type qui promettrait une chaîne obligerait la couche
 * du dessous à inventer un défaut. `null` circule jusqu'au rendu, qui imprime
 * un emplacement.
 */
export type InvoiceParty = {
  name: string | null;
  /** Forme juridique et capital — « SASU au capital de 1 000 € ». */
  legalForm: string | null;
  address: string | null;
  siret: string | null;
  /** Numéro de TVA intracommunautaire — `FR…`. */
  vatNumber: string | null;
  /** Greffe d'immatriculation — « RCS Rouen 900 000 000 ». */
  rcs: string | null;
  email: string | null;
  phone: string | null;
};

/** Partie entièrement inconnue — le point de départ, jamais un défaut acceptable. */
export const EMPTY_PARTY: InvoiceParty = {
  name: null,
  legalForm: null,
  address: null,
  siret: null,
  vatNumber: null,
  rcs: null,
  email: null,
  phone: null,
};

/**
 * CE QUE `amountCents` REPRÉSENTE, ET À QUEL TAUX.
 *
 * La base ne stocke qu'UN montant, sans dire s'il est hors taxes ou toutes
 * taxes comprises, et aucun taux n'y figure. Une facture française doit
 * pourtant montrer les trois : HT, taux et montant de TVA, TTC.
 *
 * On ne DEVINE donc pas. Tant que l'exploitant n'a pas déclaré son régime, les
 * trois lignes restent des emplacements et le montant réellement facturé est
 * imprimé tel quel, sous son vrai nom. Le jour où le régime est renseigné, la
 * ventilation devient exacte sans qu'une ligne de code change.
 */
export type InvoiceVatConfig = {
  /** Taux en POURCENT (`20`, `10`, `5.5`, `0`). `null` = régime non déclaré. */
  ratePercent: number | null;
  /** Ce que vaut le montant stocké. `null` = non déclaré (sans objet si taux 0). */
  amountsAre: 'ht' | 'ttc' | null;
};

/** Régime inconnu — l'état par défaut tant que rien n'est configuré. */
export const UNKNOWN_VAT: InvoiceVatConfig = { ratePercent: null, amountsAre: null };

export type InvoiceVatBreakdown = {
  /** `false` = régime non déclaré : les trois montants sont `null`. */
  known: boolean;
  ratePercent: number | null;
  /** Base hors taxes, en CENTIMES. */
  baseCents: number | null;
  vatCents: number | null;
  /** Toutes taxes comprises, en CENTIMES. */
  totalCents: number | null;
  /** Ligne à imprimer : « TVA 20 % », la franchise, ou l'emplacement. */
  mention: string;
};

/** Franchise en base : la seule mention qui remplace légalement un taux. */
export const INVOICE_VAT_EXEMPT_MENTION = 'TVA non applicable, article 293 B du CGI.';

/** Taux écrit à la française : `5.5` → « 5,5 % ». */
export const formatVatRate = (rate: number): string =>
  `${String(rate).replace('.', ',')} %`;

/**
 * VENTILATION HT / TVA / TTC à partir du seul montant stocké.
 *
 * L'arrondi porte sur la TVA et se déduit du reste : additionner deux montants
 * arrondis séparément produit un TTC qui ne tombe pas juste, et une facture
 * dont la somme est fausse d'un centime est une facture qu'on refait.
 */
export function invoiceVat(
  amountCents: number,
  config: InvoiceVatConfig = UNKNOWN_VAT,
): InvoiceVatBreakdown {
  const rate = config.ratePercent;
  if (rate === null || !Number.isFinite(rate) || rate < 0) {
    return {
      known: false,
      ratePercent: null,
      baseCents: null,
      vatCents: null,
      totalCents: null,
      mention: `TVA ${INVOICE_LEGAL_PLACEHOLDER}`,
    };
  }

  // Franchise en base : HT = TTC, et `amountsAre` n'a plus d'objet.
  if (rate === 0) {
    return {
      known: true,
      ratePercent: 0,
      baseCents: amountCents,
      vatCents: 0,
      totalCents: amountCents,
      mention: INVOICE_VAT_EXEMPT_MENTION,
    };
  }

  if (config.amountsAre === null) {
    return {
      known: false,
      ratePercent: rate,
      baseCents: null,
      vatCents: null,
      totalCents: null,
      mention: `TVA ${formatVatRate(rate)} — assiette ${INVOICE_LEGAL_PLACEHOLDER}`,
    };
  }

  if (config.amountsAre === 'ht') {
    const vatCents = Math.round((amountCents * rate) / 100);
    return {
      known: true,
      ratePercent: rate,
      baseCents: amountCents,
      vatCents,
      totalCents: amountCents + vatCents,
      mention: `TVA ${formatVatRate(rate)}`,
    };
  }

  const baseCents = Math.round(amountCents / (1 + rate / 100));
  return {
    known: true,
    ratePercent: rate,
    baseCents,
    vatCents: amountCents - baseCents,
    totalCents: amountCents,
    mention: `TVA ${formatVatRate(rate)}`,
  };
}

/**
 * LES MENTIONS DE RÈGLEMENT, obligatoires sur toute facture entre
 * professionnels (art. L. 441-9 et L. 441-10 du Code de commerce).
 *
 * Elles sont écrites ici, en toutes lettres, plutôt que dans le gabarit : ce
 * sont des textes de loi, pas de la mise en page, et le jour où un article
 * change c'est un seul endroit qu'on relit.
 */
export const INVOICE_LATE_PENALTY_MENTION =
  'Pénalités de retard : en cas de règlement après l’échéance, une pénalité égale à trois fois le taux d’intérêt légal en vigueur est exigible, sans qu’un rappel soit nécessaire (art. L. 441-10 du Code de commerce).';

export const INVOICE_RECOVERY_FEE_MENTION =
  'Indemnité forfaitaire pour frais de recouvrement : 40 € (art. D. 441-5 du Code de commerce).';

export const INVOICE_DISCOUNT_MENTION = 'Escompte pour paiement anticipé : néant.';

/** Conditions de règlement — l'échéance de la pièce, en clair. */
export const invoiceTermsMention = (dueAt: Date | string): string =>
  `Conditions de règlement : paiement au plus tard le ${formatFrDate(dueAt)}.`;

// ─── La facture telle qu'elle s'imprime ───

/**
 * TOUT CE QU'UNE FACTURE DOIT DIRE, assemblé et vérifié une seule fois.
 *
 * Le rendu PDF n'est plus qu'une mise en page : il ne décide de rien, ne
 * complète rien, n'arrondit rien. C'est la condition pour qu'un second rendu
 * (courriel, aperçu HTML, archive) dise EXACTEMENT la même chose que le
 * premier — sur une pièce comptable, deux versions qui divergent d'un centime
 * ou d'une mention, c'est un litige.
 */
export type InvoiceDocument = {
  number: string;
  issuer: InvoiceParty;
  customer: InvoiceParty;
  /** Date d'émission — `null` si la pièce n'a jamais été datée en base. */
  issuedAt: string | null;
  dueAt: string;
  /** Période de la prestation — « septembre 2026 ». */
  periodLabel: string;
  designation: string;
  /** Montant STOCKÉ, celui qui a réellement circulé. */
  amountCents: number;
  vat: InvoiceVatBreakdown;
  status: InvoiceStatus;
  statusLabel: string;
  paidAt: string | null;
  methodLabel: string | null;
  cancelReason: string;
  /** Conditions de règlement, pénalités, escompte — dans l'ordre d'impression. */
  settlement: readonly string[];
  /** Mentions obligatoires manquantes : imprimées en emplacement, remontées à l'équipe. */
  gaps: readonly InvoiceLegalGap[];
};

/** Ce qu'on exige d'une partie pour qu'une facture soit opposable. */
const REQUIRED_ISSUER: readonly { key: keyof InvoiceParty; label: string; hint: string }[] = [
  { key: 'name', label: 'Dénomination de l’émetteur', hint: 'Raison sociale exacte de l’éditeur (extrait Kbis).' },
  { key: 'address', label: 'Adresse du siège de l’émetteur', hint: 'Adresse postale complète du siège social.' },
  { key: 'siret', label: 'SIRET de l’émetteur', hint: 'Numéro à 14 chiffres (extrait Kbis / avis de situation INSEE).' },
  { key: 'vatNumber', label: 'TVA intracommunautaire de l’émetteur', hint: 'Numéro FR — obligatoire dès l’assujettissement à la TVA.' },
];

const REQUIRED_CUSTOMER: readonly { key: keyof InvoiceParty; label: string; hint: string }[] = [
  { key: 'name', label: 'Dénomination du client', hint: 'Raison sociale du restaurant facturé.' },
  { key: 'address', label: 'Adresse de facturation du client', hint: 'Adresse de facturation — distincte de l’adresse de l’établissement si le siège diffère.' },
];

function partyGaps(
  party: InvoiceParty,
  required: readonly { key: keyof InvoiceParty; label: string; hint: string }[],
  prefix: string,
): InvoiceLegalGap[] {
  return required
    .filter(({ key }) => {
      const value = party[key];
      return value === null || String(value).trim() === '';
    })
    .map(({ key, label, hint }) => ({ field: `${prefix}.${String(key)}`, label, hint }));
}

/**
 * ASSEMBLE LA PIÈCE, et dit franchement ce qui lui manque.
 *
 * Rien n'est deviné : ce que la base ne porte pas ressort dans `gaps` et
 * s'imprimera en emplacement. La désignation reprend le libellé saisi à
 * l'émission et, à défaut, se reconstruit depuis la nature et la période —
 * une facture sans désignation n'est pas une facture.
 */
export function buildInvoiceDocument(
  invoice: CrmInvoice,
  issuer: InvoiceParty,
  customer: InvoiceParty,
  vatConfig: InvoiceVatConfig = UNKNOWN_VAT,
): InvoiceDocument {
  const vat = invoiceVat(invoice.amountCents, vatConfig);
  const gaps = [
    ...partyGaps(issuer, REQUIRED_ISSUER, 'issuer'),
    ...partyGaps(customer, REQUIRED_CUSTOMER, 'customer'),
    ...(vat.known
      ? []
      : [
          {
            field: 'vat.regime',
            label: 'Régime de TVA de l’émetteur',
            hint: 'Taux applicable, et si les montants en base sont HT ou TTC. Sans lui, la ventilation HT / TVA / TTC ne peut pas être calculée.',
          },
        ]),
  ];

  return {
    number: invoice.number,
    issuer,
    customer,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    periodLabel: invoice.period.label,
    designation: invoice.label || `${invoice.kindLabel} — ${invoice.period.label}`,
    amountCents: invoice.amountCents,
    vat,
    status: invoice.status,
    statusLabel: invoice.statusLabel,
    paidAt: invoice.paidAt,
    methodLabel: invoice.methodLabel,
    cancelReason: invoice.cancelReason,
    settlement: [
      invoiceTermsMention(invoice.dueAt),
      INVOICE_DISCOUNT_MENTION,
      INVOICE_LATE_PENALTY_MENTION,
      INVOICE_RECOVERY_FEE_MENTION,
    ],
    gaps,
  };
}

/** Nom du fichier PDF proposé au gérant — « facture-SM-2026-0004.pdf ». */
export const invoicePdfFilename = (number: string): string =>
  `facture-${(number || 'sans-numero').replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;

// ─── L'écran « Abonnement » du gérant ───

/**
 * CE QUE LE GÉRANT LIT SUR SON PROPRE ABONNEMENT.
 *
 * Volontairement PLUS ÉTROIT que `CrmTenantBilling` : pas d'ardoise du parc,
 * pas de score, pas de place fondateur d'un autre. Et surtout aucun champ qui
 * n'aurait de sens que pour nous — ce qu'il voit, c'est son contrat.
 */
export type MyBilling = {
  tenant: { id: string; name: string; slug: string };
  subscription: CrmSubscription;
  nextDue: CrmNextDue | null;
  outstanding: CrmOutstanding;
  /** Historique ÉMIS, du plus récent au plus ancien — brouillons exclus. */
  invoices: CrmInvoice[];
  /**
   * Mentions obligatoires encore absentes en base.
   *
   * Rendu au gérant, et pas seulement à l'équipe : s'il télécharge une facture
   * qui porte des emplacements vides, il doit savoir pourquoi avant son
   * comptable.
   */
  legalGaps: InvoiceLegalGap[];
  generatedAt: string;
};
