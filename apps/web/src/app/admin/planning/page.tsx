"use client";

/**
 * Planning des services — l'écran où le gérant décide qui travaille quand.
 *
 * ─── CE QUE CET ÉCRAN CHERCHE À CHANGER ───
 *
 * Un patron de snack subit sa masse salariale : il la découvre en fin de mois,
 * quand plus rien n'est modifiable. Ici, le COÛT PROJETÉ de la semaine est
 * épinglé en haut et bouge à chaque service posé — la décision se prend au
 * moment où elle coûte encore quelque chose. En regard, le VOLUME ATTENDU tiré
 * des trente derniers jours de commandes : deux personnes un mardi midi creux,
 * personne un samedi soir chargé. Un constat chiffré, jamais un ordre.
 *
 * L'assemblage ne calcule RIEN. Heures, coûts, rappels et constats arrivent
 * déjà faits par l'API, avec le même code que le tableau de bord ; la page
 * navigue, dispose et formate. Les seuls dérivés sont des index d'affichage,
 * et ils vivent dans `data.ts`.
 *
 * ─── DÉGRADATION QUAND LES MONTANTS SONT FERMÉS ───
 *
 * Une session ouverte au PIN n'a pas le droit de lire les rémunérations :
 * l'API renvoie des `costCents` à `null` et refuse la confrontation
 * prévu/pointé (403). L'écran doit alors rester ENTIER — grille utilisable,
 * services posables, « — » à la place des montants et une phrase qui dit
 * pourquoi. Jamais un « 0,00 € », jamais une carte vide qui passe pour une
 * panne.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PlanningComparison,
  PlanningCoverage,
  PlanningCoverageVerdict,
  PlanningReminderKind,
  PlanningShiftView,
  PlanningWeek,
} from "@sm/contracts";
import { PLANNING_SERVICE_LABELS } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import {
  Btn,
  Card,
  EmptyState,
  Icon,
  IconBtn,
  Panel,
  Pill,
  Skeleton,
  useToast,
} from "@/components/ui";
import {
  addDaysIso,
  buildRows,
  COVERAGE_TONE_TEXT,
  coverageTone,
  fmtHours,
  fmtSignedEuro,
  fmtSignedHours,
  hourlyCostIndex,
  indexCoverage,
  indexShifts,
  loadWeekBundle,
  longDayLabel,
  mondayIso,
  todayIso,
  weekPosition,
  weekTitle,
  type WeekBundle,
} from "./data";
import { GridLegend, WeekGrid, type CellTarget } from "./grid";
import { ShiftEditor, type EditorState } from "./editor";
import { DuplicateModal, PublishShareModal } from "./actions";
import { CoutsHorairesModal } from "./CoutsHoraires";

/** Étiquette courte d'un rappel — le message complet vient de l'API, intact. */
const REMINDER_LABEL: Readonly<Record<PlanningReminderKind, string>> = {
  "journee-longue": "Journée longue",
  "repos-court": "Repos court",
  "jours-consecutifs": "Jours consécutifs",
};

/** Étiquette d'un verdict de couverture — le constat, lui, reste celui de l'API. */
const VERDICT_LABEL: Readonly<Record<PlanningCoverageVerdict, string>> = {
  "sans-volume": "Aucun volume attendu",
  "sans-service": "Personne de prévu",
  "sous-effectif": "Sous-effectif",
  equilibre: "Dans le repère",
  "sur-effectif": "Sur-effectif",
};

const POSITION_LABEL = {
  passee: "Semaine écoulée",
  courante: "Semaine en cours",
  future: "Semaine à venir",
} as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

/**
 * Accent tenant tel qu'il est réellement peint.
 *
 * Le shell l'injecte sur `<html>` à l'arrivée de l'établissement ; le lire ici
 * au moment d'ouvrir le partage évite de le recopier dans un état local qui
 * pourrait retarder d'un rendu — l'image transmise porterait alors le laiton
 * par défaut au lieu de la couleur du client.
 */
function readAccent(): string {
  if (typeof document === "undefined") return "#c9a15a";
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--cf-accent").trim() ||
    "#c9a15a"
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const toast = useToast();

  const today = useMemo(() => todayIso(), []);
  const [anchor, setAnchor] = useState(() => mondayIso(todayIso()));

  const [bundle, setBundle] = useState<WeekBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tenant, setTenant] = useState<TenantMe | null>(null);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [publishStep, setPublishStep] = useState<"publish" | "share" | null>(null);

  // ── Chargement ──
  //
  // Un compteur de requête, et non un simple `cancelled` : la navigation de
  // semaine est rapide (le gérant tapote « suivante » trois fois), et sans lui
  // une réponse en retard écraserait la semaine réellement affichée.
  const reqRef = useRef(0);

  const load = useCallback(async (iso: string) => {
    const ticket = ++reqRef.current;
    setLoading(true);
    try {
      const next = await loadWeekBundle(iso);
      if (ticket !== reqRef.current) return;
      setBundle(next);
      setError(null);
    } catch (e) {
      if (ticket !== reqRef.current) return;
      setError(e instanceof Error ? e.message : "Chargement impossible — réessayez");
    } finally {
      if (ticket === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone rejoué à chaque changement de semaine, protégé par le ticket `reqRef` contre les réponses croisées. Hors de l'effet, l'appariement ticket/réponse serait rompu et une réponse en retard écraserait la semaine réellement affichée.
    void load(anchor);
  }, [anchor, load]);

  const refresh = useCallback(async () => {
    await load(anchor);
  }, [load, anchor]);

  useEffect(() => {
    api
      .get<TenantMe>("/tenants/me")
      .then(setTenant)
      .catch(() => {
        // Le nom de l'établissement n'orne que le planning transmis : son
        // absence ne doit jamais empêcher de poser un service.
      });
  }, []);

  // ── Le chiffre qui bouge ──
  //
  // La variation de masse salariale s'affiche quelques secondes après chaque
  // pose : c'est elle qui relie le geste (« j'ajoute Karim samedi soir ») à sa
  // conséquence (« +79,75 € sur la semaine »).
  const prevRef = useRef<{ week: string; cost: number | null } | null>(null);
  const [costDelta, setCostDelta] = useState<number | null>(null);

  useEffect(() => {
    if (!bundle) return;
    const cost = bundle.week.totals.costCents;
    const prev = prevRef.current;
    prevRef.current = { week: bundle.week.week, cost };
    if (!prev || prev.week !== bundle.week.week) {
      setCostDelta(null);
      return;
    }
    if (prev.cost == null || cost == null || cost === prev.cost) return;
    setCostDelta(cost - prev.cost);
    const t = window.setTimeout(() => setCostDelta(null), 6000);
    return () => window.clearTimeout(t);
  }, [bundle]);

  // ── Dérivés d'affichage ──

  const week = bundle?.week ?? null;
  const payrollVisible = week?.payroll.visible ?? false;
  const [coutsOuverts, setCoutsOuverts] = useState(false);

  const days = useMemo(() => week?.days.map((d) => d.date) ?? [], [week]);
  const rows = useMemo(
    () => (week ? buildRows(week, bundle?.members ?? []) : []),
    [week, bundle],
  );
  const shiftsByCell = useMemo(
    () => (week ? indexShifts(week) : new Map<string, PlanningShiftView[]>()),
    [week],
  );
  const coverageByCell = useMemo(
    () => indexCoverage(bundle?.coverage ?? null),
    [bundle],
  );
  const hourlyCosts = useMemo(
    () => (week ? hourlyCostIndex(week, bundle?.staffCosts ?? null) : new Map()),
    [week, bundle],
  );
  const dayTotals = useMemo(() => {
    const m = new Map<string, { people: number; hours: number; costCents: number | null }>();
    for (const d of week?.days ?? [])
      m.set(d.date, { people: d.people, hours: d.hours, costCents: d.costCents });
    return m;
  }, [week]);

  const expectedOrders = useMemo(
    () => (bundle?.coverage?.blocks ?? []).reduce((s, b) => s + b.expectedOrders, 0),
    [bundle],
  );

  const position = weekPosition(anchor);
  const drafts = week?.counts.brouillon ?? 0;
  const published = week?.counts.publie ?? 0;

  // ── Rendu ──

  if (!week) {
    return (
      <div className="p-4 md:p-[26px]">
        {error ? (
          <Card className="p-[18px]">
            <EmptyState
              icon="close"
              title="Planning indisponible"
              hint={error}
              action={
                <Btn variant="ghost" size="sm" icon="arrow" onClick={() => void refresh()}>
                  Réessayer
                </Btn>
              }
            />
          </Card>
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-[92px]" />
            <Skeleton className="h-[420px]" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-[26px]">
      {/* ── Bandeau épinglé : la semaine, son coût, ses gestes ────────────── */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg px-4 py-3.5 md:px-[26px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex shrink-0 items-center gap-1.5">
            <IconBtn
              icon="back"
              label="Semaine précédente"
              onClick={() => setAnchor((a) => addDaysIso(a, -7))}
            />
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => setAnchor(mondayIso(todayIso()))}
              disabled={position === "courante"}
            >
              Aujourd&apos;hui
            </Btn>
            <IconBtn
              icon="arrow"
              label="Semaine suivante"
              onClick={() => setAnchor((a) => addDaysIso(a, 7))}
            />
          </div>

          {/*
            `min-w-[15rem]` : sur tablette, c'est la rangée de chiffres qui
            passe à la ligne, jamais le titre qui se réduit à « S… ». Un gérant
            qui navigue de semaine en semaine doit lire OÙ il est.
          */}
          <div className="min-w-[15rem] flex-1">
            <h2 className="truncate text-[19px] font-extrabold tracking-[-0.03em] text-ink">
              {capitalize(weekTitle(week.week, week.weekEnd))}
            </h2>
            <p className="truncate text-[12.5px] text-mut">
              {POSITION_LABEL[position]}
              {loading && " · actualisation…"}
            </p>
          </div>

          {/* Les deux chiffres de l'arbitrage, plus celui qui le motive. */}
          <div className="flex w-full flex-wrap items-stretch gap-2 lg:w-auto">
            <MetricTile
              label="Coût projeté"
              value={payrollVisible ? fmtEuro(week.totals.costCents) : "—"}
              // Deux « — » très différents : l'un dit « vous n'avez pas le
              // droit de lire ce chiffre », l'autre « il n'y a rien à
              // chiffrer ». Sans la mention, ils se confondent.
              sub={
                !payrollVisible
                  ? "masqué"
                  : week.totals.shifts === 0
                    ? "rien de posé"
                    : undefined
              }
              tone={payrollVisible ? "accent" : "mut"}
              extra={
                costDelta != null ? (
                  <span
                    className="cf-fig animate-pop text-[12px] font-extrabold text-prept"
                    aria-live="polite"
                  >
                    {fmtSignedEuro(costDelta)}
                  </span>
                ) : null
              }
            />
            <MetricTile label="Heures prévues" value={fmtHours(week.totals.hours)} />
            <MetricTile
              label="Volume attendu"
              value={
                bundle?.coverage?.hasForecast && expectedOrders > 0
                  ? `≈ ${expectedOrders.toLocaleString("fr-FR")}`
                  : "—"
              }
              sub={
                bundle?.coverage?.hasForecast && expectedOrders > 0
                  ? "commandes"
                  : "pas d'historique"
              }
            />
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[12.5px] text-mut">
            <span className="cf-fig font-bold text-ink">{published}</span>{" "}
            {plural(published, "service publié", "services publiés")}
            {drafts > 0 && (
              <>
                {" · "}
                <span className="cf-fig font-bold text-prept">{drafts}</span>{" "}
                <span className="text-prept">
                  {plural(drafts, "en brouillon", "en brouillon")}
                </span>
              </>
            )}
          </p>

          {!payrollVisible && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-mut">
              <Icon name="euro" size={13} className="shrink-0" aria-hidden />
              {week.payroll.message}
            </p>
          )}
          {payrollVisible && week.payroll.missingCost.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-prept">
              <Icon name="euro" size={13} className="shrink-0" aria-hidden />
              {week.payroll.message}
              {/* Le message signalait le manque sans offrir de chemin : la
                  route de saisie existait, aucun écran ne l'appelait. */}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-ink"
                onClick={() => setCoutsOuverts(true)}
              >
                Renseigner les coûts
              </button>
            </p>
          )}

          {/*
            Une seule action primaire, et c'est celle qui reste à faire :
            publier tant qu'il y a du brouillon, transmettre une fois que tout
            est sorti. « Tout est publié » n'est pas un geste — c'est un état,
            et il est déjà écrit à gauche.
          */}
          {/* `max-w-full` : l'item flex vaut sinon sa largeur max-content —
              trois boutons côte à côte débordaient l'écran d'un téléphone au
              lieu de replier grâce à leur propre `flex-wrap`. */}
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
            <Btn
              variant="ghost"
              size="sm"
              icon="grid"
              onClick={() => setDuplicating(true)}
            >
              Dupliquer
            </Btn>
            {drafts > 0 ? (
              <>
                {published > 0 && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="phone"
                    onClick={() => setPublishStep("share")}
                  >
                    Transmettre
                  </Btn>
                )}
                <Btn size="sm" icon="check" onClick={() => setPublishStep("publish")}>
                  Publier {drafts} {plural(drafts, "service")}
                </Btn>
              </>
            ) : (
              <Btn
                size="sm"
                icon="phone"
                disabled={published === 0}
                onClick={() => setPublishStep("share")}
              >
                Transmettre à l&apos;équipe
              </Btn>
            )}
          </div>
        </div>
      </header>

      <div className="space-y-4 px-4 pt-4 md:px-[26px]">
        {error && (
          <Card
            flat
            className="flex flex-wrap items-center justify-between gap-3 p-3.5"
            role="alert"
          >
            <p className="text-[13px] font-semibold text-alertt">{error}</p>
            <Btn variant="ghost" size="sm" icon="arrow" onClick={() => void refresh()}>
              Réessayer
            </Btn>
          </Card>
        )}

        {/* Une semaine finie ne se pose plus : ce qui compte, c'est l'écart. */}
        {position === "passee" && (
          <ComparisonPanel
            comparison={bundle?.comparison ?? null}
            payrollVisible={payrollVisible}
            payrollMessage={week.payroll.message}
            position={position}
          />
        )}

        {/* ── La grille ── */}
        <Panel
          title="Services de la semaine"
          sub="Touchez une case pour poser un service — il arrive en brouillon, votre équipe ne voit rien avant publication."
          actions={
            <span className="hidden text-[12.5px] text-mut sm:block">
              {rows.length} {plural(rows.length, "personne")}
            </span>
          }
        >
          {rows.length === 0 ? (
            <EmptyState
              icon="user"
              title="Aucun membre dans l'équipe"
              hint="Un planning se pose sur des personnes. Ajoutez votre équipe, puis revenez ici."
              action={
                <Link href="/admin/team">
                  <Btn variant="ghost" size="sm" icon="user">
                    Ouvrir Équipe &amp; pointage
                  </Btn>
                </Link>
              }
            />
          ) : (
            <div className={cx("transition-opacity duration-200 ease-sm", loading && "opacity-60")}>
              {week.totals.shifts === 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3">
                  <p className="text-[12.5px] text-mut">
                    Semaine vide — copiez la semaine précédente, puis ajustez.
                  </p>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="grid"
                    onClick={() => setDuplicating(true)}
                  >
                    Dupliquer la semaine précédente
                  </Btn>
                </div>
              )}
              <WeekGrid
                days={days}
                rows={rows}
                shiftsByCell={shiftsByCell}
                coverageByCell={coverageByCell}
                dayTotals={dayTotals}
                todayIso={today}
                payrollVisible={payrollVisible}
                onAdd={(target: CellTarget) => setEditor({ mode: "create", target })}
                onOpen={(shift) => setEditor({ mode: "edit", shift })}
              />
              <GridLegend payrollVisible={payrollVisible} />
            </div>
          )}
        </Panel>

        {/* ── Constats et rappels, côte à côte ── */}
        {/* `items-start` : chacun prend sa hauteur. Étirer le plus court
            creuserait un vide dans une carte, ce qui se lit comme un manque. */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <CoveragePanel coverage={bundle?.coverage ?? null} />
          <RemindersPanel week={week} />
        </div>

        {position !== "passee" && (
          <ComparisonPanel
            comparison={bundle?.comparison ?? null}
            payrollVisible={payrollVisible}
            payrollMessage={week.payroll.message}
            position={position}
          />
        )}
      </div>

      {/* ── Modales ── */}
      {editor && (
        <ShiftEditor
          state={editor}
          rows={rows}
          days={days}
          hourlyCosts={hourlyCosts}
          payrollVisible={payrollVisible}
          weekCostCents={week.totals.costCents}
          weekHours={week.totals.hours}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}

      {/* La saisie des coûts horaires — la route existait, aucun écran ne
          l'appelait, et tout le volet « coût de main-d'œuvre » restait à « — ». */}
      {coutsOuverts && bundle?.staffCosts && (
        <CoutsHorairesModal
          costs={bundle.staffCosts}
          onClose={() => setCoutsOuverts(false)}
          onDone={() => void refresh()}
        />
      )}

      {duplicating && (
        <DuplicateModal
          fromIso={addDaysIso(week.week, -7)}
          fromEndIso={addDaysIso(week.week, -1)}
          toIso={week.week}
          toEndIso={week.weekEnd}
          existing={week.totals.shifts}
          onClose={() => setDuplicating(false)}
          onDone={refresh}
        />
      )}

      {publishStep && (
        <PublishShareModal
          week={week}
          tenantName={tenant?.name ?? "Votre établissement"}
          accent={readAccent()}
          initialStep={publishStep}
          onClose={() => setPublishStep(null)}
          onPublished={async () => {
            await refresh();
            toast("Semaine publiée — l'équipe peut la lire", { icon: "check" });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tuile de chiffre du bandeau épinglé
// ─────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  sub,
  tone = "ink",
  extra,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "accent" | "mut";
  extra?: React.ReactNode;
}) {
  return (
    <div className="min-w-[124px] rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] px-3.5 py-2">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-mut">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cx(
            "cf-fig text-[20px] font-extrabold leading-tight",
            tone === "accent" ? "text-accent" : tone === "mut" ? "text-mut" : "text-ink",
          )}
        >
          {value}
        </span>
        {sub && <span className="text-[11px] text-mut">{sub}</span>}
        {extra}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Volume attendu — un constat, jamais une consigne
// ─────────────────────────────────────────────────────────────

function CoveragePanel({ coverage }: { coverage: PlanningCoverage | null }) {
  const notable = (coverage?.blocks ?? []).filter(
    (b) =>
      b.verdict === "sans-service" ||
      b.verdict === "sous-effectif" ||
      b.verdict === "sur-effectif",
  );
  const balanced = (coverage?.blocks ?? []).filter((b) => b.verdict === "equilibre").length;

  return (
    <Panel
      title="Volume attendu"
      sub="Ce que vos trente derniers jours laissent prévoir, créneau par créneau."
    >
      {!coverage ? (
        <EmptyState
          icon="chart"
          title="Constats indisponibles"
          hint="Le croisement avec vos prévisions n'a pas pu être chargé. La grille reste utilisable."
        />
      ) : !coverage.hasForecast ? (
        <EmptyState
          icon="chart"
          title="Pas encore assez d'historique"
          hint="Il faut des commandes passées pour estimer un volume. Les constats apparaîtront d'eux-mêmes."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {notable.length === 0 ? (
            <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px] text-ink">
              Aucun écart au repère sur les créneaux où du volume est attendu —{" "}
              <span className="cf-fig font-bold">{balanced}</span>{" "}
              {plural(balanced, "créneau", "créneaux")} dans le repère.
            </p>
          ) : (
            <ul className="cf-scroll flex max-h-[280px] flex-col gap-1.5 overflow-y-auto pr-1">
              {notable.map((b) => {
                const tone = coverageTone(b);
                return (
                  <li
                    key={`${b.date}|${b.service}`}
                    className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[12.5px] font-bold text-ink">
                        {capitalize(longDayLabel(b.date))} ·{" "}
                        {PLANNING_SERVICE_LABELS[b.service].toLowerCase()}
                      </span>
                      <Pill className={cx("border-white/12", COVERAGE_TONE_TEXT[tone])}>
                        {VERDICT_LABEL[b.verdict]}
                      </Pill>
                      <span className="cf-fig ml-auto text-[12px] font-bold text-mut">
                        {b.peoplePlanned} / {b.referencePeople} pers. · ≈ {b.expectedOrders}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-snug text-mut">{b.message}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[12px] leading-snug text-mut">{coverage.disclaimer}</p>
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Rappels de durée — des avertissements du gérant à lui-même
// ─────────────────────────────────────────────────────────────

function RemindersPanel({ week }: { week: PlanningWeek }) {
  return (
    <Panel
      title="Rappels de durée"
      sub="Ce que ce planning vous signale à vous-même, avant que l'équipe ne le lise."
    >
      <div className="flex flex-col gap-3">
        {week.reminders.length === 0 ? (
          <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px] text-ink">
            Aucun rappel sur cette semaine : ni journée très longue, ni repos très court,
            ni série de jours d&apos;affilée.
          </p>
        ) : (
          <ul className="cf-scroll flex max-h-[280px] flex-col gap-1.5 overflow-y-auto pr-1">
            {week.reminders.map((r, i) => (
              <li
                key={`${r.kind}|${r.staffId}|${r.date}|${i}`}
                className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-2.5"
              >
                <Pill className="border-white/12 text-prept">{REMINDER_LABEL[r.kind]}</Pill>
                <p className="mt-1.5 text-[12.5px] leading-snug text-ink">{r.message}</p>
              </li>
            ))}
          </ul>
        )}

        {/*
          L'avertissement vient de la charge utile et s'affiche TEL QUEL. Ce
          n'est pas une précaution rédactionnelle : la durée légale du travail
          dépend de la convention collective et du contrat de chaque salarié.
          Laisser croire à un contrôle de conformité exposerait le client.
        */}
        <p className="flex items-start gap-2 rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[12px] leading-snug text-mut">
          <Icon name="bell" size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>{week.remindersDisclaimer}</span>
        </p>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// Prévu contre pointé
// ─────────────────────────────────────────────────────────────

function ComparisonPanel({
  comparison,
  payrollVisible,
  payrollMessage,
  position,
}: {
  comparison: PlanningComparison | null;
  payrollVisible: boolean;
  payrollMessage: string;
  position: "passee" | "courante" | "future";
}) {
  const title = "Prévu contre pointé";
  const sub =
    position === "passee"
      ? "La semaine est finie : voici ce qu'elle a réellement coûté, personne par personne."
      : "L'écart se construit au fil de la semaine — il n'est pas définitif.";

  // Une semaine qui n'a pas commencé n'a rien à confronter. On le dit, plutôt
  // que d'afficher des écarts de −113 h qui n'ont aucun sens.
  if (position === "future") {
    return (
      <Panel title={title} sub="Disponible dès que la semaine est entamée.">
        <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px] text-mut">
          Aucun pointage sur une semaine à venir — il n&apos;y a encore rien à confronter au
          planning.
        </p>
      </Panel>
    );
  }

  // Montants fermés : l'API refuse la route (403). La carte reste, avec sa
  // raison — une carte vide passerait pour une panne.
  if (!comparison) {
    return (
      <Panel title={title} sub="Réservé au compte propriétaire.">
        <p className="flex items-start gap-2 rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px] text-mut">
          <Icon name="euro" size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {payrollVisible
              ? "La confrontation prévu / pointé n'a pas pu être chargée. Le reste de l'écran est à jour."
              : payrollMessage}{" "}
            Cette confrontation chiffre des rémunérations ligne à ligne : elle n&apos;est pas
            ouverte à une session de service.
          </span>
        </p>
      </Panel>
    );
  }

  if (comparison.rows.length === 0) {
    return (
      <Panel title={title} sub={sub}>
        <EmptyState
          icon="clock"
          title="Rien à confronter"
          hint="Aucun service publié ni pointage sur cette semaine."
        />
      </Panel>
    );
  }

  const t = comparison.totals;
  const th =
    "px-2.5 py-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut";
  const td = "px-2.5 py-2.5 text-[13px]";

  return (
    <Panel title={title} sub={sub}>
      <div className="flex flex-col gap-3">
        {comparison.weekInProgress && (
          <p className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-2.5 text-[12.5px] text-prept">
            Semaine en cours — les heures pointées ne couvrent que les jours déjà passés.
          </p>
        )}

        <div className="cf-scroll -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line2">
                <th className={th} />
                <th className={cx(th, "text-center")} colSpan={3} scope="colgroup">
                  Heures
                </th>
                <th
                  className={cx(th, "border-l border-line2 text-center")}
                  colSpan={3}
                  scope="colgroup"
                >
                  Euros
                </th>
              </tr>
              <tr className="border-b border-line">
                <th className={th} scope="col">
                  Personne
                </th>
                <th className={cx(th, "text-right")} scope="col">
                  Prévu
                </th>
                <th className={cx(th, "text-right")} scope="col">
                  Pointé
                </th>
                <th className={cx(th, "text-right")} scope="col">
                  Écart
                </th>
                <th className={cx(th, "border-l border-line2 text-right")} scope="col">
                  Prévu
                </th>
                <th className={cx(th, "text-right")} scope="col">
                  Pointé
                </th>
                <th className={cx(th, "text-right")} scope="col">
                  Écart
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r) => (
                <tr key={r.staffId} className="border-b border-line2">
                  <th scope="row" className={cx(td, "font-bold text-ink")}>
                    {r.staffName}
                    {r.openShifts > 0 && (
                      <span className="ml-1.5 text-[11.5px] font-semibold text-prept">
                        {r.openShifts} {plural(r.openShifts, "pointage")}{" "}
                        {plural(r.openShifts, "ouvert")}
                      </span>
                    )}
                  </th>
                  <td className={cx(td, "cf-fig text-right text-mut")}>
                    {fmtHours(r.plannedHours)}
                  </td>
                  <td className={cx(td, "cf-fig text-right text-ink")}>
                    {fmtHours(r.actualHours)}
                  </td>
                  <td
                    className={cx(
                      td,
                      "cf-fig text-right font-extrabold",
                      r.deltaHours > 0 ? "text-prept" : "text-mut",
                    )}
                  >
                    {fmtSignedHours(r.deltaHours)}
                  </td>
                  <td
                    className={cx(td, "cf-fig border-l border-line2 text-right text-mut")}
                  >
                    {fmtEuro(r.plannedCostCents)}
                  </td>
                  <td className={cx(td, "cf-fig text-right text-ink")}>
                    {fmtEuro(r.actualCostCents)}
                  </td>
                  <td
                    className={cx(
                      td,
                      "cf-fig text-right font-extrabold",
                      r.deltaCostCents != null && r.deltaCostCents > 0
                        ? "text-prept"
                        : "text-mut",
                    )}
                  >
                    {fmtSignedEuro(r.deltaCostCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className={cx(td, "font-extrabold text-ink")}>
                  Total
                </th>
                <td className={cx(td, "cf-fig text-right font-bold text-mut")}>
                  {fmtHours(t.plannedHours)}
                </td>
                <td className={cx(td, "cf-fig text-right font-extrabold text-ink")}>
                  {fmtHours(t.actualHours)}
                </td>
                <td
                  className={cx(
                    td,
                    "cf-fig text-right font-extrabold",
                    t.deltaHours > 0 ? "text-prept" : "text-mut",
                  )}
                >
                  {fmtSignedHours(t.deltaHours)}
                </td>
                <td
                  className={cx(
                    td,
                    "cf-fig border-l border-line2 text-right font-bold text-mut",
                  )}
                >
                  {fmtEuro(t.plannedCostCents)}
                </td>
                <td className={cx(td, "cf-fig text-right font-extrabold text-accent")}>
                  {fmtEuro(t.actualCostCents)}
                </td>
                <td
                  className={cx(
                    td,
                    "cf-fig text-right font-extrabold",
                    t.deltaCostCents != null && t.deltaCostCents > 0
                      ? "text-prept"
                      : "text-mut",
                  )}
                >
                  {fmtSignedEuro(t.deltaCostCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {comparison.draftHoursIgnored > 0 && (
          <p className="text-[12.5px] text-mut">
            {fmtHours(comparison.draftHoursIgnored)} de brouillon écartées du calcul : elles
            n&apos;ont engagé personne.
          </p>
        )}
        <p className="text-[12px] leading-snug text-mut">{comparison.note}</p>
      </div>
    </Panel>
  );
}
