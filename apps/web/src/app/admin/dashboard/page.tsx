"use client";

/**
 * Vue « Tableau de bord » (spec backoffice-restaurant §5) — 100 % données
 * réelles : /stats/overview, /stats/timeseries, /stats/top-products,
 * /stats/heatmap, /stats/summary-live, /stats/prep-times, /tenants/me,
 * /orders + temps réel WebSocket (order.created / order.updated).
 * Tous les montants circulent en CENTIMES ; conversion € à l'affichage.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  OrderChannel,
  OrderStatus,
  StatsHeatmapCell,
  StatsOverview,
  StatsPeriod,
  StatsPrepTimes,
  StatsSummaryLive,
  StatsTimeseries,
  StatsTopProduct,
} from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro, timeAgo } from "@/lib/format";
import { useTenantSocket } from "@/lib/ws";
import {
  BarChart,
  Btn,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconBtn,
  Kpi,
  Panel,
  Pill,
  Skeleton,
  StatusBadge,
  useToast,
} from "@/components/ui";

// ─── Constantes métier (centimes) ───

/** Objectif par défaut si le tenant n'en a pas : 1 500,00 €. */
const GOAL_DEFAULT = 150_000;
/** Pas des boutons − / + : 100 €. */
const GOAL_STEP = 10_000;
/** Plancher de l'objectif : 300 €. */
const GOAL_FLOOR = 30_000;

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "1d", label: "Aujourd'hui" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
];

const DELTA_REF: Record<StatsPeriod, string> = {
  "1d": "vs hier",
  "7d": "vs sem. passée",
  "30d": "vs mois passé",
};

const CHART_TITLE: Record<StatsPeriod, string> = {
  "1d": "Commandes du jour · par heure",
  "7d": "CA · 7 derniers jours",
  "30d": "CA · 4 dernières semaines",
};

const CHANNEL_FR: Record<OrderChannel, string> = {
  pos: "Caisse",
  online: "En ligne",
  phone: "Téléphone",
};

const DAY_FR = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

// ─── Formatage ───

/** 129000 → « 1 290 € » (arrondi à l'euro, style maquette §5.2/§5.6). */
const euroRound = (cents: number) =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;

const int = (n: number) => n.toLocaleString("fr-FR");

/** Valeur au-dessus des barres : vide si 0, « 1,2k » si ≥ 1000, sinon entier. */
function barValue(v: number): string {
  if (v === 0) return "";
  if (v >= 1000) {
    const k = Math.round(v / 100) / 10;
    return `${(Number.isInteger(k) ? String(k) : k.toFixed(1)).replace(".", ",")}k`;
  }
  return String(v);
}

/** Delta % réel → props du composant Kpi (▲ vert / ▼ rouge). */
function pctDelta(
  p: number | null | undefined,
  ref?: string,
): { dir: "up" | "down"; text: string } | undefined {
  if (p == null) return undefined;
  const abs = Math.abs(p).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return {
    dir: p >= 0 ? "up" : "down",
    text: `${p >= 0 ? "+" : "−"}${abs} %${ref ? ` ${ref}` : ""}`,
  };
}

const fmtHour = (h: number) => `${h}h00`;

// ─── Prévisions : créneau de rush depuis la heatmap 30 j ───

type Rush = {
  /** Heure de début du créneau (incluse). */
  start: number;
  /** Heure de fin du créneau (exclue — affichage `end`h00). */
  end: number;
  /** Commandes attendues sur le créneau (moyenne du même jour de semaine). */
  avgWindow: number;
  /** Commandes attendues sur la journée entière. */
  avgDay: number;
  /** Commandes attendues sur l'heure de pointe. */
  avgPeak: number;
};

/**
 * Créneau de rush du jour : sur les cellules du même jour de semaine
 * (cumul 30 j), pic horaire étendu aux heures contiguës ≥ 60 % du pic.
 * Moyenne ≈ cumul / 4 (4 occurrences complètes du jour dans la fenêtre).
 */
function computeRush(cells: StatsHeatmapCell[], isoDay: number): Rush | null {
  const byHour = new Map<number, number>();
  for (const c of cells) if (c.day === isoDay) byHour.set(c.hour, c.orders);
  let peakHour = 0;
  let peak = 0;
  let dayTotal = 0;
  for (let h = 11; h <= 23; h++) {
    const n = byHour.get(h) ?? 0;
    dayTotal += n;
    if (n > peak) {
      peak = n;
      peakHour = h;
    }
  }
  if (peak === 0) return null;
  const threshold = peak * 0.6;
  let start = peakHour;
  let end = peakHour;
  while (start - 1 >= 11 && (byHour.get(start - 1) ?? 0) >= threshold) start--;
  while (end + 1 <= 23 && (byHour.get(end + 1) ?? 0) >= threshold) end++;
  let windowTotal = 0;
  for (let h = start; h <= end; h++) windowTotal += byHour.get(h) ?? 0;
  return {
    start,
    end: end + 1,
    avgWindow: Math.max(1, Math.round(windowTotal / 4)),
    avgDay: Math.max(1, Math.round(dayTotal / 4)),
    avgPeak: Math.max(1, Math.round(peak / 4)),
  };
}

/** Jour de semaine ISO (1 = lundi … 7 = dimanche) en Europe/Paris. */
function parisIsoDay(d = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(d);
  const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
  return idx === -1 ? 1 : idx + 1;
}

// ─── Hook fetch minimal (données conservées pendant un rechargement) ───

type ApiState<T> = { data: T | null; error: string | null; loading: boolean };

function useApi<T>(path: string) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Le voile de chargement et l'effacement de l'erreur précédente doivent
    // suivre `path` : sans cette écriture, un changement de période laisserait
    // les chiffres de la période précédente affichés comme s'ils étaient à
    // jour, sous une erreur devenue caduque.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- état de chargement posé avant l'appel réseau, il n'est pas calculable au rendu : il dépend de la requête en vol.
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get<T>(path).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (e: unknown) => {
        if (!cancelled)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : "Erreur de chargement",
            loading: false,
          }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** Erreur de section : message + bouton « Réessayer ». */
function LoadError({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-1" role="alert">
      <p className="text-[13px] text-alertt">
        {message || "Erreur de chargement"}
      </p>
      <Btn variant="ghost" size="sm" onClick={onRetry}>
        Réessayer
      </Btn>
    </div>
  );
}

// ─── Commandes en direct ───

type OrderRow = {
  _id: string;
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  createdAt: string;
  totals: { total: number };
  lines: { name: string; qty: number }[];
  pickup?: { customerName?: string | null } | null;
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<StatsPeriod>("1d");

  // ── Requêtes stats ──
  const overview = useApi<StatsOverview>(`/stats/overview?period=${period}`);
  const series = useApi<StatsTimeseries>(`/stats/timeseries?period=${period}`);
  const prep = useApi<StatsPrepTimes>(`/stats/prep-times?period=${period}`);
  /** CA + panier moyen du jour (carte Objectif) — indépendant des chips. */
  const today = useApi<StatsOverview>("/stats/overview?period=1d");
  const live = useApi<StatsSummaryLive>("/stats/summary-live");
  const heatmap = useApi<StatsHeatmapCell[]>("/stats/heatmap");
  const top = useApi<StatsTopProduct[]>("/stats/top-products?period=7d&limit=5");
  const tenant = useApi<TenantMe>("/tenants/me");

  // ── Objectif du jour (settings.dailyGoalCents, optimiste) ──
  // Seul l'ajustement manuel est un état : la valeur du serveur est déjà
  // disponible au rendu, la dériver évite le rendu supplémentaire et la fenêtre
  // pendant laquelle la carte affichait un objectif de repli avant l'arrivée de
  // `tenant.data` — un clic dans cette fenêtre enregistrait un objectif faux.
  // `goalOverride` reste prioritaire pour que les boutons +/− ne soient pas
  // réécrits par la valeur du serveur au rendu suivant.
  const [goalOverride, setGoalOverride] = useState<number | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const goalCents =
    goalOverride ??
    (tenant.data
      ? (tenant.data.settings.dailyGoalCents ?? GOAL_DEFAULT)
      : null);

  async function adjustGoal(dir: -1 | 1) {
    if (goalCents == null || savingGoal) return;
    const next = Math.max(GOAL_FLOOR, goalCents + dir * GOAL_STEP);
    if (next === goalCents) return;
    const prev = goalCents;
    setGoalOverride(next); // optimiste
    setSavingGoal(true);
    try {
      await api.patch("/tenants/me/settings", { dailyGoalCents: next });
    } catch {
      setGoalOverride(prev);
      toast("Impossible d'enregistrer l'objectif — réessayez");
    } finally {
      setSavingGoal(false);
    }
  }

  // ── Commandes en direct (4 dernières + WS) ──
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const loadOrders = useCallback(async () => {
    try {
      setOrdersError(null);
      const res = await api.get<{ rows: OrderRow[] }>("/orders");
      setOrders((res?.rows ?? []).slice(0, 4));
    } catch (e) {
      setOrdersError(
        e instanceof Error ? e.message : "Erreur de chargement",
      );
    }
  }, []);
  useEffect(() => {
    // Amorce la carte « commandes en direct » avant que le WebSocket ne prenne
    // le relais ; sans ce premier appel elle resterait sur son squelette
    // jusqu'à la prochaine commande créée.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : `orders` vient du réseau, aucune valeur calculable au rendu ne peut le remplacer.
    void loadOrders();
  }, [loadOrders]);

  const reloadLive = live.reload;
  const reloadToday = today.reload;
  useTenantSocket({
    "order.created": (payload) => {
      const o = payload as OrderRow;
      if (!o?._id) return;
      setOrders((prev) =>
        prev ? [o, ...prev.filter((x) => x._id !== o._id)].slice(0, 4) : [o],
      );
      reloadLive(); // compteur « à accepter »
    },
    "order.updated": (payload) => {
      const o = payload as OrderRow;
      if (!o?._id) return;
      setOrders((prev) =>
        prev ? prev.map((x) => (x._id === o._id ? { ...x, ...o } : x)) : prev,
      );
      reloadLive();
      reloadToday(); // le CA du jour bouge quand une commande passe « prête »
    },
  });

  // ── Tick 30 s : rafraîchit les « il y a X min » ──
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Prévisions (heatmap → rush du jour de semaine courant) ──
  const isoDay = useMemo(() => parisIsoDay(), []);
  const dayName = DAY_FR[isoDay - 1] ?? "jour";
  const rush = useMemo(
    () => (heatmap.data ? computeRush(heatmap.data, isoDay) : null),
    [heatmap.data, isoDay],
  );

  // ── Dérivés graphique ──
  const buckets = series.data?.buckets ?? [];
  const chartData = buckets.map((b) => ({
    label: b.label,
    value: period === "1d" ? b.orders : Math.round(b.caCents / 100),
  }));
  const chartSub =
    period === "1d"
      ? `Total · ${int(buckets.reduce((s, b) => s + b.orders, 0))} commandes`
      : `Total · ${euroRound(buckets.reduce((s, b) => s + b.caCents, 0))}`;

  // ── Dérivés objectif ──
  const caToday = today.data?.caCents ?? 0;
  const basket = today.data?.avgBasketCents ?? 0;
  const goalReady = goalCents != null && today.data != null;
  const reached = goalCents != null && caToday >= goalCents;
  const goalPct =
    goalCents != null && goalCents > 0
      ? Math.min(100, Math.round((caToday / goalCents) * 100))
      : 0;
  const remaining = goalCents != null ? goalCents - caToday : 0;
  const goalLine = reached
    ? "Objectif atteint — bravo à l'équipe."
    : `${goalPct} % · reste ${fmtEuro(remaining)}${
        basket > 0 ? ` ≈ ${int(Math.ceil(remaining / basket))} commandes` : ""
      }`;

  // ── À faire maintenant ──
  const summary = live.data;
  const todos = summary
    ? [
        summary.newCount > 0 && {
          key: "orders",
          count: summary.newCount,
          pillCls: "bg-accent text-onaccent",
          label:
            summary.newCount > 1
              ? "Commandes en ligne à accepter"
              : "Commande en ligne à accepter",
          href: "/admin/orders",
        },
        summary.reviewsPendingCount > 0 && {
          key: "reviews",
          count: summary.reviewsPendingCount,
          pillCls: "bg-gold text-[#1C1612]",
          label:
            summary.reviewsPendingCount > 1
              ? "Avis clients sans réponse"
              : "Avis client sans réponse",
          href: "/admin/reviews",
        },
        summary.productsOutCount > 0 && {
          key: "menu",
          count: summary.productsOutCount,
          pillCls: "bg-mut text-white",
          label:
            summary.productsOutCount > 1
              ? "Ruptures à réactiver"
              : "Rupture à réactiver",
          href: "/admin/menu",
        },
      ].filter((t): t is Exclude<typeof t, false> => Boolean(t))
    : [];

  // ── Top ventes ──
  const topRows = top.data ?? [];
  const topMax = Math.max(...topRows.map((r) => r.qty), 1);

  return (
    <div className="p-[26px]">
      {/* ── §5.1 Sélecteur de période ── */}
      <div
        role="group"
        aria-label="Période des statistiques"
        className="mb-4 flex flex-wrap gap-2"
      >
        {PERIODS.map((p) => (
          <Chip key={p.key} on={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {/* ── §5.2 Rangée KPI ── */}
      {overview.error ? (
        <Card className="p-[18px]">
          <LoadError
            message={overview.error}
            onRetry={() => {
              overview.reload();
              prep.reload();
            }}
          />
        </Card>
      ) : !overview.data ? (
        <div className="flex flex-col gap-4 md:flex-row">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[122px] flex-1" />
          ))}
        </div>
      ) : (
        <div
          className={cx(
            "flex flex-col gap-4 transition-opacity duration-200 ease-sm md:flex-row",
            overview.loading && "opacity-60",
          )}
        >
          <Kpi
            label="CA"
            value={euroRound(overview.data.caCents)}
            icon="euro"
            delta={pctDelta(overview.data.deltas.caPct, DELTA_REF[period])}
          />
          <Kpi
            label="Commandes"
            value={int(overview.data.orders)}
            icon="ticket"
            delta={pctDelta(overview.data.deltas.ordersPct)}
          />
          <Kpi
            label="Panier moyen"
            value={fmtEuro(overview.data.avgBasketCents)}
            icon="cart"
            delta={pctDelta(overview.data.deltas.avgBasketPct)}
          />
          <Kpi
            label="Temps de prépa"
            value={
              prep.data?.avgMinutes != null
                ? `${prep.data.avgMinutes.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} min`
                : "—"
            }
            icon="clock"
          />
        </div>
      )}

      {/* ── §5.3 / §5.4 / §5.5 ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Objectif du jour */}
        <Card className="p-[18px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
              Objectif du jour
            </h2>
            <div className="flex gap-1.5">
              <IconBtn
                icon="minus"
                label="Réduire l'objectif de 100 €"
                size={26}
                iconSize={13}
                disabled={
                  goalCents == null || savingGoal || goalCents <= GOAL_FLOOR
                }
                onClick={() => void adjustGoal(-1)}
              />
              <IconBtn
                icon="plus"
                label="Augmenter l'objectif de 100 €"
                size={26}
                iconSize={13}
                disabled={goalCents == null || savingGoal}
                onClick={() => void adjustGoal(1)}
              />
            </div>
          </div>
          {tenant.error && goalCents == null ? (
            <LoadError message={tenant.error} onRetry={tenant.reload} />
          ) : today.error && !today.data ? (
            <LoadError message={today.error} onRetry={today.reload} />
          ) : !goalReady ? (
            <div className="mt-3 flex flex-col gap-2.5">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-[10px]" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <>
              <div className="cf-fig mt-2 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[26px] font-extrabold leading-none text-ink">
                  {fmtEuro(caToday)}
                </span>
                <span className="text-sm font-semibold text-mut">
                  / {fmtEuro(goalCents)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Progression vers l'objectif du jour"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={goalPct}
                className="mt-3 h-[10px] overflow-hidden rounded-pill border border-white/6 bg-surface2"
              >
                <div
                  className={cx(
                    "h-full rounded-pill",
                    reached ? "bg-ok" : "bg-accent",
                  )}
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <p
                className={cx(
                  "cf-fig mt-2 text-[13px]",
                  reached ? "font-bold text-okt" : "text-mut",
                )}
              >
                {goalLine}
              </p>
            </>
          )}
        </Card>

        {/* Prévisions du service */}
        <Card className="p-[18px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
              Prévisions du service
            </h2>
            <Pill className="bg-gold text-[#1C1612]">Prédictif</Pill>
          </div>
          {heatmap.error && !heatmap.data ? (
            <LoadError message={heatmap.error} onRetry={heatmap.reload} />
          ) : heatmap.loading && !heatmap.data ? (
            <div className="mt-3 flex flex-col gap-2.5">
              <Skeleton className="h-4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : rush == null ? (
            <p className="mt-3 text-[13.5px] text-mut">
              Pas encore assez d’historique pour estimer le service — les
              prévisions apparaîtront après quelques jours de commandes.
            </p>
          ) : (
            /* Icônes du DS, jamais d'emoji dans le produit (DA — « ce qu'on ne fait jamais »). */
            <ul className="mt-3 flex flex-col gap-[9px]">
              <li className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
                <Icon
                  name="clock"
                  size={15}
                  className="mt-0.5 shrink-0 text-mut"
                />
                <span>
                  Rush attendu{" "}
                  <strong className="cf-fig font-extrabold">
                    {fmtHour(rush.start)} – {fmtHour(rush.end)}
                  </strong>{" "}
                  — {dayName} type : ≈{" "}
                  <span className="cf-fig font-extrabold">
                    {int(rush.avgWindow)}
                  </span>{" "}
                  commandes sur le créneau (moyenne 30 j)
                </span>
              </li>
              <li className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
                <Icon
                  name="chart"
                  size={15}
                  className="mt-0.5 shrink-0 text-mut"
                />
                <span>
                  Volume attendu aujourd’hui : ≈{" "}
                  <span className="cf-fig font-extrabold">
                    {int(rush.avgDay)}
                  </span>{" "}
                  commandes (moyenne des {dayName}s sur 30 j)
                </span>
              </li>
              <li className="flex items-start gap-2.5 text-[13.5px] leading-snug text-ink">
                <Icon
                  name="user"
                  size={15}
                  className="mt-0.5 shrink-0 text-mut"
                />
                <span>
                  {rush.avgPeak >= 25 ? "2 en cuisine" : "1 en cuisine"} + 1
                  comptoir recommandés sur le créneau{" "}
                  <span className="cf-fig font-extrabold">
                    {fmtHour(rush.start)} – {fmtHour(rush.end)}
                  </span>
                </span>
              </li>
            </ul>
          )}
        </Card>

        {/* À faire maintenant */}
        <Card className="p-[18px]">
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
            À faire maintenant
          </h2>
          {live.error && !live.data ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : !summary ? (
            <div className="mt-3 flex flex-col gap-[7px]">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : todos.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-ctrl border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3 py-[9px] text-[13.5px] text-mut">
              <Icon name="check" size={15} className="shrink-0 text-okt" />
              Rien à traiter — tout est à jour.
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-[7px]">
              {todos.map((t) => (
                <Link
                  key={t.key}
                  href={t.href}
                  className="cf-press-row group flex items-center gap-2.5 rounded-ctrl border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3 py-[9px] text-[13.5px] font-semibold text-ink hover:border-white/16 hover:bg-[image:var(--cf-elev-hover)]"
                >
                  <span
                    className={cx(
                      "cf-fig inline-flex min-w-[22px] shrink-0 items-center justify-center rounded-pill px-1.5 py-px text-[11px] font-extrabold",
                      t.pillCls,
                    )}
                  >
                    {int(t.count)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <Icon
                    name="arrow"
                    size={14}
                    className="shrink-0 text-mut transition-colors duration-200 ease-sm group-hover:text-accent"
                  />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── §5.6 Commandes en direct + graphique ── */}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <Panel
          title="Commandes en direct"
          className="min-w-0 lg:flex-[1.3]"
          actions={
            <Link
              href="/admin/orders"
              className="cf-press inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-accent hover:opacity-85"
            >
              Tout voir
              <Icon name="arrow" size={14} />
            </Link>
          }
        >
          {ordersError && orders == null ? (
            <LoadError message={ordersError} onRetry={() => void loadOrders()} />
          ) : orders == null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[58px]" />
              <Skeleton className="h-[58px]" />
              <Skeleton className="h-[58px]" />
              <Skeleton className="h-[58px]" />
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon="ticket"
              title="Aucune commande pour le moment"
              hint="Les nouvelles commandes apparaîtront ici en temps réel."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((o) => {
                const items = o.lines.reduce((s, l) => s + l.qty, 0);
                const name = o.pickup?.customerName || CHANNEL_FR[o.channel];
                return (
                  <li
                    key={o._id}
                    className="flex items-center gap-3 rounded-ctrl border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3 py-2.5"
                  >
                    <span className="cf-fig min-w-[34px] text-xl font-extrabold text-accent">
                      {o.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold text-ink">
                        {name} · {items} article{items > 1 ? "s" : ""}
                      </div>
                      <div className="cf-fig truncate text-[13px] text-mut">
                        #{o._id.slice(-6)} · {CHANNEL_FR[o.channel]} ·{" "}
                        {timeAgo(o.createdAt)}
                      </div>
                    </div>
                    <StatusBadge status={o.status} className="shrink-0" />
                    <span className="cf-fig min-w-[62px] shrink-0 text-right text-[15px] font-extrabold text-ink">
                      {fmtEuro(o.totals.total)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title={CHART_TITLE[period]}
          sub={series.data && !series.error ? chartSub : undefined}
          className="min-w-0 lg:flex-1"
        >
          {series.error ? (
            <LoadError message={series.error} onRetry={series.reload} />
          ) : !series.data ? (
            <Skeleton className="h-[170px]" />
          ) : (
            <div
              className={cx(
                "transition-opacity duration-200 ease-sm",
                series.loading && "opacity-60",
              )}
            >
              <BarChart
                data={chartData}
                height={170}
                formatValue={barValue}
                title={`${CHART_TITLE[period]} — ${chartSub}`}
              />
            </div>
          )}
        </Panel>
      </div>

      {/* ── §5.7 Top ventes de la semaine ── */}
      <Panel title="Top ventes de la semaine" className="mt-4">
        {top.error && !top.data ? (
          <LoadError message={top.error} onRetry={top.reload} />
        ) : top.loading && !top.data ? (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : topRows.length === 0 ? (
          <EmptyState
            icon="chart"
            title="Aucune vente sur les 7 derniers jours"
            hint="Le classement se remplira dès les premières commandes de la semaine."
          />
        ) : (
          <ol className="flex flex-col gap-2.5">
            {topRows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-3">
                <span className="cf-fig min-w-[22px] shrink-0 text-lg font-extrabold text-mut">
                  {i + 1}
                </span>
                <span className="min-w-[160px] max-w-[240px] truncate text-[15px] font-bold text-ink">
                  {r.name}
                </span>
                <div
                  className="h-3 min-w-0 flex-1 overflow-hidden rounded-pill border border-white/6 bg-surface2"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-pill bg-accent"
                    style={{
                      width: `${Math.round((r.qty / topMax) * 100)}%`,
                    }}
                  />
                </div>
                <span className="cf-fig min-w-[70px] shrink-0 text-right text-sm text-mut">
                  {int(r.qty)} vendus
                </span>
                <span className="cf-fig min-w-[70px] shrink-0 text-right text-sm font-extrabold text-ink">
                  {euroRound(r.caCents)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
