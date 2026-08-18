import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Statistiques — types partagés API ↔ web.
// Tous les montants sont en CENTIMES (int). Fuseau : Europe/Paris.
// CA = commandes « ready » + « delivered » (les annulées sont exclues).
// ─────────────────────────────────────────────────────────────

export const STATS_PERIODS = ['1d', '7d', '30d'] as const;
export const StatsPeriodSchema = z.enum(STATS_PERIODS);
export type StatsPeriod = z.infer<typeof StatsPeriodSchema>;

/** Query `?period=` commune aux endpoints de stats. */
export const StatsPeriodQuerySchema = z.object({
  period: StatsPeriodSchema.default('7d'),
});
export type StatsPeriodQuery = z.infer<typeof StatsPeriodQuerySchema>;

export const StatsTopProductsQuerySchema = z.object({
  period: StatsPeriodSchema.default('7d'),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});
export type StatsTopProductsQuery = z.infer<typeof StatsTopProductsQuerySchema>;

/** Export CSV : bornes calendaires (jours Paris, incluses). Défaut : 30 derniers jours. */
export const StatsExportOrdersQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')
    .optional(),
});
export type StatsExportOrdersQuery = z.infer<typeof StatsExportOrdersQuerySchema>;

// ─── Réponses ───

/** Vue d'ensemble : CA, commandes, panier moyen + variation vs période précédente équivalente. */
export interface StatsOverview {
  period: StatsPeriod;
  caCents: number;
  orders: number;
  avgBasketCents: number;
  /** Variations en % (1 décimale) — null si la période précédente est vide. */
  deltas: {
    caPct: number | null;
    ordersPct: number | null;
    avgBasketPct: number | null;
  };
}

/** Un point de la courbe CA/commandes (heure, jour ou semaine selon la période). */
export interface StatsTimeseriesBucket {
  label: string;
  caCents: number;
  orders: number;
}

export interface StatsTimeseries {
  period: StatsPeriod;
  buckets: StatsTimeseriesBucket[];
}

export interface StatsTopProduct {
  name: string;
  qty: number;
  caCents: number;
}

export interface StatsChannelBucket {
  /** Canal de commande (mêmes valeurs que ORDER_CHANNELS). */
  channel: 'online' | 'pos' | 'phone';
  orders: number;
  caCents: number;
}

/** Cellule de la heatmap d'affluence (30 derniers jours). */
export interface StatsHeatmapCell {
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  day: number;
  /** Heure locale Europe/Paris, 11 → 23. */
  hour: number;
  orders: number;
}

/** Temps de préparation (délai new → ready d'après statusHistory). */
export interface StatsPrepTimes {
  period: StatsPeriod;
  /** Moyenne en minutes (1 décimale) — null si aucune commande mesurable. */
  avgMinutes: number | null;
  /** 90ᵉ percentile en minutes (1 décimale) — null si aucune commande mesurable. */
  p90Minutes: number | null;
  /** Nombre de commandes mesurées. */
  orders: number;
}

/** Bandeau « À faire maintenant » du dashboard. */
export interface StatsSummaryLive {
  caTodayCents: number;
  ordersToday: number;
  /** Commandes en statut `new` (file d'attente). */
  newCount: number;
  /** Commandes prêtes en attente de remise. */
  readyCount: number;
  /** Avis clients sans réponse. */
  reviewsPendingCount: number;
  /** Produits actifs en rupture. */
  productsOutCount: number;
}
