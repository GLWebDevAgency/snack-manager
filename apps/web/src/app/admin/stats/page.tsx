"use client";

/**
 * Vue « Statistiques » (spec backoffice-restaurant §10) — /admin/stats.
 * Toutes les agrégations viennent de l'API (/stats/*) : aucun calcul métier
 * côté client. Les montants circulent en CENTIMES (int) et ne deviennent
 * des euros qu'à l'affichage (fmtEuro / helpers locaux).
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type {
  StatsChannelBucket,
  StatsHeatmapCell,
  StatsOverview,
  StatsPeriod,
  StatsPrepTimes,
  StatsTimeseries,
  StatsTopProduct,
} from "@sm/contracts";
import { api, csvDownload } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import {
  BarChart,
  Btn,
  Chip,
  EmptyState,
  Kpi,
  Panel,
  Skeleton,
  useToast,
} from "@/components/ui";

// ─── Libellés & constantes ───────────────────────────────────────────

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "1d", label: "Aujourd'hui" },
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
];

/** Libellé long de la période (sous-titres de panels). */
const PERIOD_LABEL: Record<StatsPeriod, string> = {
  "1d": "aujourd'hui",
  "7d": "7 derniers jours",
  "30d": "30 derniers jours",
};

/** Granularité du graphique CA (alignée sur /stats/timeseries). */
const CHART_SUB: Record<StatsPeriod, string> = {
  "1d": "Aujourd'hui, par heure",
  "7d": "7 derniers jours",
  "30d": "4 dernières semaines",
};

/** Référence des deltas (fenêtre précédente équivalente côté API). */
const DELTA_REF: Record<StatsPeriod, string> = {
  "1d": "vs hier",
  "7d": "vs 7 j précédents",
  "30d": "vs 30 j précédents",
};

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Heures de la heatmap : 11 h → 23 h (13 colonnes, cf. contrat). */
const HEAT_HOURS = Array.from({ length: 13 }, (_, i) => 11 + i);

/**
 * Canaux §10.2 — couleurs de SÉRIE, jamais de statut.
 * Accent pour le canal en ligne, puis deux neutres dégressifs : la trilogie
 * d'origine (accent / blanc / gold) rendait « En ligne » et « Téléphone »
 * indiscernables chez tout tenant dont l'accent est le laiton, et posait un
 * aplat blanc pur au milieu du panneau.
 */
const CHANNELS: {
  key: StatsChannelBucket["channel"];
  label: string;
  fill: string;
}[] = [
  { key: "online", label: "En ligne (Click & Collect)", fill: "bg-accent" },
  { key: "pos", label: "Sur place / comptoir", fill: "bg-white/60" },
  { key: "phone", label: "Téléphone", fill: "bg-white/25" },
];

// ─── Formatage fr-FR ─────────────────────────────────────────────────

const int = (n: number) => n.toLocaleString("fr-FR");

/** Montant arrondi à l'euro : 620045 → « 6 200 € ». */
const euroInt = (cents: number) =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;

/** Valeur au-dessus des barres : vide si 0, « 810€ », « 6,2k€ » dès 1 000 €. */
function barValue(cents: number): string {
  if (cents <= 0) return "";
  const e = Math.round(cents / 100);
  return e >= 1000
    ? `${(e / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}k€`
    : `${e}€`;
}

const minutes = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("fr-FR")} min`;

/** Delta Kpi : ▲ vert si ≥ 0, ▼ rouge sinon (couleurs fonctionnelles). */
function kpiDelta(pct: number | null, period: StatsPeriod) {
  if (pct == null) return undefined;
  return {
    dir: pct >= 0 ? ("up" as const) : ("down" as const),
    text: `${pct >= 0 ? "+" : ""}${pct.toLocaleString("fr-FR")} % ${DELTA_REF[period]}`,
  };
}

/** Fond d'une cellule de heatmap : intensité accent ∝ n/max (0 = piste). */
const heatBg = (mixPct: number) =>
  `color-mix(in srgb, var(--cf-accent) ${mixPct}%, var(--cf-surface-2))`;
const heatMix = (n: number, max: number) =>
  n <= 0 || max <= 0 ? 0 : Math.round(18 + (n / max) * 82);

/** Jour Paris (AAAA-MM-JJ) il y a `minusDays` jours — borne `from` des exports. */
const parisYmd = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function exportFrom(period: StatsPeriod): string {
  const days = period === "1d" ? 0 : period === "7d" ? 6 : 29;
  return parisYmd.format(new Date(Date.now() - days * 86_400_000));
}

type PeriodData = {
  overview: StatsOverview;
  timeseries: StatsTimeseries;
  top: StatsTopProduct[];
  channels: StatsChannelBucket[];
  prep: StatsPrepTimes;
};

// ─── Page ────────────────────────────────────────────────────────────

export default function StatsPage() {
  const toast = useToast();
  const [period, setPeriod] = useState<StatsPeriod>("7d");
  const [data, setData] = useState<PeriodData | null>(null);
  const [heatmap, setHeatmap] = useState<StatsHeatmapCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<"orders" | "menu" | null>(null);
  /** Garde anti-course : seule la dernière requête écrit l'état. */
  const seq = useRef(0);

  const load = useCallback(async (p: StatsPeriod) => {
    const id = ++seq.current;
    try {
      const q = `?period=${p}`;
      const [overview, timeseries, top, channels, prep, heat] =
        await Promise.all([
          api.get<StatsOverview>(`/stats/overview${q}`),
          api.get<StatsTimeseries>(`/stats/timeseries${q}`),
          api.get<StatsTopProduct[]>(`/stats/top-products${q}&limit=5`),
          api.get<StatsChannelBucket[]>(`/stats/channels${q}`),
          api.get<StatsPrepTimes>(`/stats/prep-times${q}`),
          api.get<StatsHeatmapCell[]>("/stats/heatmap"),
        ]);
      if (id !== seq.current) return;
      setData({ overview, timeseries, top, channels, prep });
      setHeatmap(heat);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      if (id === seq.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone porteur de la garde `seq.current` contre les réponses croisées. Le voile « refreshing » est volontairement posé dans `changePeriod` et non ici : déplacer l'appel romprait cet équilibre et laisserait une réponse lente écraser la période réellement sélectionnée.
    void load(period);
  }, [load, period]);

  /**
   * Changement de période : le voile « refreshing » se pose dans le handler
   * (pas dans l'effet) — les données périmées restent visibles pendant
   * le rechargement, la garde `seq` évite les réponses croisées.
   */
  function changePeriod(p: StatsPeriod) {
    if (p === period) return;
    setRefreshing(true);
    setPeriod(p);
  }

  function retry() {
    setRefreshing(true);
    void load(period);
  }

  async function runExport(kind: "orders" | "menu") {
    if (exporting) return;
    setExporting(kind);
    try {
      if (kind === "orders") {
        await csvDownload(`/stats/export/orders.csv?from=${exportFrom(period)}`);
      } else {
        await csvDownload("/stats/export/menu.csv");
      }
      toast("Export CSV téléchargé", { icon: "check" });
    } catch {
      toast("Échec de l'export — réessayez");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="p-4 md:p-[26px]">
      {/* ── Sélecteur de période (état local, non persisté — spec §5.1) ── */}
      <div
        className="mb-4 flex gap-2"
        role="group"
        aria-label="Période des statistiques"
      >
        {PERIODS.map((p) => (
          <Chip
            key={p.value}
            on={period === p.value}
            onClick={() => changePeriod(p.value)}
          >
            {p.label}
          </Chip>
        ))}
      </div>

      {/* ── Erreur (chargement initial ou rafraîchissement) ── */}
      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
          <p className="text-sm font-semibold text-alertt" role="alert">
            {error}
          </p>
          <Btn variant="ghost" size="sm" onClick={retry}>
            Réessayer
          </Btn>
        </div>
      )}

      {/* ── Chargement initial : squelettes calqués sur la mise en page ── */}
      {!data && !error && (
        <div className="space-y-4" aria-hidden>
          <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
            <Skeleton className="h-[118px] md:flex-1" />
            <Skeleton className="h-[118px] md:flex-1" />
            <Skeleton className="h-[118px] max-md:col-span-2 md:flex-1" />
          </div>
          <div className="flex flex-col gap-4 xl:flex-row">
            <Skeleton className="h-[290px] min-w-0 xl:flex-[1.4]" />
            <Skeleton className="h-[290px] min-w-0 xl:flex-1" />
          </div>
          <div className="flex flex-col gap-4 xl:flex-row">
            <Skeleton className="h-[290px] min-w-0 xl:flex-[1.4]" />
            <Skeleton className="h-[290px] min-w-0 xl:flex-1" />
          </div>
          <div className="flex flex-col gap-4 xl:flex-row">
            <Skeleton className="h-[170px] min-w-0 xl:flex-1" />
            <Skeleton className="h-[170px] min-w-0 xl:flex-1" />
          </div>
        </div>
      )}

      {data && (
        <div
          className={cx(
            "space-y-4 transition-opacity duration-200 ease-sm",
            refreshing && "opacity-60",
          )}
          aria-busy={refreshing}
        >
          <KpiRow overview={data.overview} period={period} />

          {/* ── Rangée 1 : CA (flex 1.4) + canaux (flex 1) — spec §10 ── */}
          <div className="flex flex-col gap-4 xl:flex-row">
            <Panel
              className="min-w-0 xl:flex-[1.4]"
              title="Chiffre d'affaires"
              sub={`${CHART_SUB[period]} · ${euroInt(
                data.timeseries.buckets.reduce((s, b) => s + b.caCents, 0),
              )}`}
              actions={
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => void runExport("orders")}
                  disabled={exporting !== null}
                >
                  {exporting === "orders" ? "Export…" : "Exporter CSV"}
                </Btn>
              }
            >
              <BarChart
                data={data.timeseries.buckets.map((b) => ({
                  label: b.label,
                  value: b.caCents,
                }))}
                height={190}
                formatValue={barValue}
                title={`Chiffre d'affaires — ${CHART_SUB[period]}`}
              />
            </Panel>

            <Panel
              className="min-w-0 xl:flex-1"
              title="Répartition des canaux"
              sub={`Part des commandes · ${PERIOD_LABEL[period]}`}
            >
              <ChannelBars channels={data.channels} />
            </Panel>
          </div>

          {/* ── Rangée 2 : affluence (flex 1.4) + top ventes (flex 1) ── */}
          <div className="flex flex-col gap-4 xl:flex-row">
            <Panel
              className="min-w-0 xl:flex-[1.4]"
              title="Affluence par créneau"
              sub="Commandes par heure · 30 derniers jours"
            >
              <Heatmap cells={heatmap ?? []} />
            </Panel>

            <Panel
              className="min-w-0 xl:flex-1"
              title="Top ventes"
              sub={`Par quantité vendue · ${PERIOD_LABEL[period]}`}
            >
              <TopProducts top={data.top} />
            </Panel>
          </div>

          {/* ── Rangée 3 : temps de préparation + exports CSV ── */}
          <div className="flex flex-col gap-4 xl:flex-row">
            <Panel
              className="min-w-0 xl:flex-1"
              title="Temps de préparation"
              sub={`Délai « nouvelle » → « prête » · ${PERIOD_LABEL[period]}`}
            >
              <PrepTimes prep={data.prep} />
            </Panel>

            <Panel
              className="min-w-0 xl:flex-1"
              title="Exports CSV"
              sub="Fichiers compatibles Excel (UTF-8, séparateur « ; »)"
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="ticket"
                    onClick={() => void runExport("orders")}
                    disabled={exporting !== null}
                  >
                    {exporting === "orders"
                      ? "Export en cours…"
                      : "Exporter les commandes"}
                  </Btn>
                  <span className="text-xs text-mut">
                    Une ligne par commande de la période sélectionnée.
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="grid"
                    onClick={() => void runExport("menu")}
                    disabled={exporting !== null}
                  >
                    {exporting === "menu"
                      ? "Export en cours…"
                      : "Exporter le menu"}
                  </Btn>
                  <span className="text-xs text-mut">
                    Catégories, produits, variantes et prix actuels.
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sous-vues ───────────────────────────────────────────────────────

function KpiRow({
  overview,
  period,
}: {
  overview: StatsOverview;
  period: StatsPeriod;
}) {
  return (
    /* Grille 2 colonnes sous `md` (le CA, chiffre roi, s'étale en pleine
       largeur) : trois cartes empilées repoussaient les graphiques hors vue. */
    <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
      <Kpi
        className="max-md:col-span-2"
        label="Chiffre d'affaires"
        value={fmtEuro(overview.caCents)}
        icon="euro"
        delta={kpiDelta(overview.deltas.caPct, period)}
      />
      <Kpi
        label="Commandes"
        value={int(overview.orders)}
        icon="ticket"
        delta={kpiDelta(overview.deltas.ordersPct, period)}
      />
      <Kpi
        label="Panier moyen"
        value={fmtEuro(overview.avgBasketCents)}
        icon="cart"
        delta={kpiDelta(overview.deltas.avgBasketPct, period)}
      />
    </div>
  );
}

/** §10.2 — trois barres horizontales : accent / blanc / gold. */
function ChannelBars({ channels }: { channels: StatsChannelBucket[] }) {
  const total = channels.reduce((s, c) => s + c.orders, 0);
  if (total === 0) {
    return (
      <EmptyState
        icon="chart"
        title="Aucune commande sur la période"
        hint="Les parts par canal apparaîtront dès la première commande encaissée."
        className="p-6"
      />
    );
  }
  return (
    <>
      <div className="flex flex-col gap-3.5" aria-hidden>
        {CHANNELS.map((ch) => {
          const bucket = channels.find((c) => c.channel === ch.key);
          const orders = bucket?.orders ?? 0;
          const pct = Math.round((orders / total) * 100);
          return (
            <div
              key={ch.key}
              title={`${ch.label} : ${int(orders)} commande(s) · ${fmtEuro(bucket?.caCents ?? 0)}`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-ink">
                  {ch.label}
                </span>
                <span className="cf-fig shrink-0 text-sm">
                  <span className="text-mut">{int(orders)} cmd · </span>
                  <span className="font-extrabold text-ink">{pct} %</span>
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-pill border border-white/6 bg-surface2">
                <div
                  className={cx("h-full rounded-pill", ch.fill)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Données brutes pour lecteurs d'écran */}
      <table className="sr-only">
        <caption>Répartition des commandes par canal</caption>
        <thead>
          <tr>
            <th scope="col">Canal</th>
            <th scope="col">Commandes</th>
            <th scope="col">Part</th>
            <th scope="col">{"Chiffre d'affaires"}</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((ch) => {
            const bucket = channels.find((c) => c.channel === ch.key);
            const orders = bucket?.orders ?? 0;
            return (
              <tr key={ch.key}>
                <th scope="row">{ch.label}</th>
                <td>{int(orders)}</td>
                <td>{Math.round((orders / total) * 100)} %</td>
                <td>{fmtEuro(bucket?.caCents ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** Heatmap 7 jours × 13 heures (11 h → 23 h), intensité accent, échelle. */
function Heatmap({ cells }: { cells: StatsHeatmapCell[] }) {
  const max = Math.max(0, ...cells.map((c) => c.orders));
  if (cells.length === 0 || max === 0) {
    return (
      <EmptyState
        icon="clock"
        title="Pas encore d'affluence mesurée"
        hint="La grille se remplit avec les commandes des 30 derniers jours."
        className="p-6"
      />
    );
  }
  const byKey = new Map(cells.map((c) => [`${c.day}:${c.hour}`, c.orders]));

  return (
    <>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label="Affluence par créneau : commandes par heure sur les 30 derniers jours — détail dans le tableau qui suit"
          className="grid min-w-[560px] gap-1"
          style={{ gridTemplateColumns: "36px repeat(13, minmax(0, 1fr))" }}
        >
          <div />
          {HEAT_HOURS.map((h) => (
            <div
              key={h}
              className="cf-fig text-center text-[10px] font-semibold text-mut"
            >
              {h}h
            </div>
          ))}
          {WEEKDAYS.map((day, di) => (
            <Fragment key={day}>
              <div className="flex items-center text-[11px] font-semibold text-mut">
                {day}
              </div>
              {HEAT_HOURS.map((h) => {
                const n = byKey.get(`${di + 1}:${h}`) ?? 0;
                return (
                  <div
                    key={h}
                    title={`${day} ${h}h · ${int(n)} commande${n === 1 ? "" : "s"}`}
                    className="aspect-square min-h-[18px] rounded-[4px]"
                    style={{ background: heatBg(heatMix(n, max)) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Échelle d'intensité */}
      <div
        className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-mut"
        aria-hidden
      >
        <span>Moins</span>
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <span
            key={r}
            className="size-3 rounded-[3px]"
            style={{ background: heatBg(r === 0 ? 0 : Math.round(18 + r * 82)) }}
          />
        ))}
        <span>Plus</span>
      </div>

      {/* Données brutes pour lecteurs d'écran */}
      <table className="sr-only">
        <caption>
          Affluence par créneau — commandes par heure, 30 derniers jours
        </caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            {HEAT_HOURS.map((h) => (
              <th key={h} scope="col">
                {h}h
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((day, di) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {HEAT_HOURS.map((h) => (
                <td key={h}>{byKey.get(`${di + 1}:${h}`) ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** §10.4 — top 5 : rang, nom, barre ∝ quantité, « n vendus », CA. */
function TopProducts({ top }: { top: StatsTopProduct[] }) {
  if (top.length === 0) {
    return (
      <EmptyState
        icon="star"
        title="Aucune vente sur la période"
        hint="Le classement apparaîtra dès les premières commandes prêtes ou remises."
        className="p-6"
      />
    );
  }
  const maxQty = Math.max(...top.map((t) => t.qty), 1);
  return (
    <ol className="flex flex-col">
      {top.map((t, i) => (
        <li
          key={`${t.name}-${i}`}
          /*
            Sous `sm`, quantité et CA s'empilent à droite : côte à côte, leurs
            158 px ne laissaient au nom du produit qu'une dizaine de lettres.
            Placement explicite : l'auto-placement pousserait le CA au 2e rang.
          */
          className={cx(
            "grid grid-cols-[22px_1fr_auto] items-center gap-x-3 gap-y-0.5 py-2 sm:flex",
            i > 0 && "border-t border-line2",
          )}
        >
          <span
            className="cf-fig w-[22px] shrink-0 text-[15px] font-extrabold text-mut max-sm:row-span-2"
            aria-hidden
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-ink">
              {t.name}
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface2"
              aria-hidden
            >
              <div
                className="h-full rounded-pill bg-accent"
                style={{ width: `${Math.round((t.qty / maxQty) * 100)}%` }}
              />
            </div>
          </div>
          <span className="cf-fig shrink-0 text-right text-sm text-mut max-sm:col-start-3 max-sm:row-start-2 sm:w-[74px]">
            {int(t.qty)} vendus
          </span>
          <span className="cf-fig shrink-0 text-right text-sm font-extrabold text-ink max-sm:col-start-3 max-sm:row-start-1 sm:w-[84px]">
            {fmtEuro(t.caCents)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Moyenne + P90 du délai de préparation (null → « — »). */
function PrepTimes({ prep }: { prep: StatsPrepTimes }) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Temps moyen
          </div>
          <div className="cf-fig mt-1.5 text-[28px] font-extrabold leading-[1.1] text-ink">
            {minutes(prep.avgMinutes)}
          </div>
        </div>
        <div className="flex-1 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            P90 · 9 commandes sur 10
          </div>
          <div className="cf-fig mt-1.5 text-[28px] font-extrabold leading-[1.1] text-ink">
            {minutes(prep.p90Minutes)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-mut">
        {prep.orders > 0
          ? `${int(prep.orders)} commande${prep.orders === 1 ? "" : "s"} mesurée${prep.orders === 1 ? "" : "s"} sur la période.`
          : "Aucune commande mesurable sur la période."}
      </p>
    </>
  );
}
