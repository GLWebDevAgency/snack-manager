"use client";

/**
 * La grille hebdomadaire.
 *
 * Parti pris de lecture : les jours en colonnes, l'équipe en lignes, et chaque
 * ligne SCINDÉE EN DEUX SOUS-LIGNES — midi en haut, soir en bas, toujours.
 * La distinction des deux services est donc STRUCTURELLE, pas chromatique :
 * elle tient à la position dans la grille, pas à une nuance qu'il faudrait
 * apprendre. Le gérant descend la colonne du samedi et voit d'un trait qui
 * tient le soir.
 *
 * La première ligne du corps n'est pas une personne : c'est le VOLUME ATTENDU,
 * aligné sur les mêmes sous-lignes. Le constat et l'effectif se lisent donc
 * dans la même colonne, à la même hauteur.
 */

import type { PlanningCoverageBlock, PlanningService, PlanningShiftView } from "@sm/contracts";
import { PLANNING_POSITION_LABELS, PLANNING_SERVICE_LABELS } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { Icon, Pill } from "@/components/ui";
import {
  cellKey,
  COVERAGE_TONE_TEXT,
  coverageTone,
  dayNumber,
  fmtHours,
  fmtRange,
  longDayLabel,
  ROLE_LABEL,
  SERVICES,
  shortDayLabel,
  type GridRow,
} from "./data";

/** Largeurs des deux colonnes épinglées — reprises telles quelles par le `left` collant. */
const COL_STAFF = 128;
const COL_SERVICE = 44;
const COL_DAY_MIN = 104;

export type CellTarget = {
  staffId: string;
  staffName: string;
  date: string;
  service: PlanningService;
};

type WeekGridProps = {
  days: string[];
  rows: GridRow[];
  shiftsByCell: Map<string, PlanningShiftView[]>;
  coverageByCell: Map<string, PlanningCoverageBlock>;
  dayTotals: Map<string, { people: number; hours: number; costCents: number | null }>;
  /** Aujourd'hui, pour souligner la colonne du jour. */
  todayIso: string;
  payrollVisible: boolean;
  onAdd: (target: CellTarget) => void;
  onOpen: (shift: PlanningShiftView) => void;
};

export function WeekGrid({
  days,
  rows,
  shiftsByCell,
  coverageByCell,
  dayTotals,
  todayIso,
  payrollVisible,
  onAdd,
  onOpen,
}: WeekGridProps) {
  const template = `${COL_STAFF}px ${COL_SERVICE}px repeat(7, minmax(${COL_DAY_MIN}px, 1fr))`;
  const minWidth = COL_STAFF + COL_SERVICE + 7 * COL_DAY_MIN;

  return (
    <div className="cf-scroll relative -mx-1 overflow-x-auto px-1 pb-1" tabIndex={0} role="region" aria-label="Planning hebdomadaire — défilement horizontal">
      <div
        role="table"
        aria-label="Planning de la semaine — équipe en lignes, jours en colonnes"
        className="grid"
        style={{ gridTemplateColumns: template, minWidth }}
      >
        {/* ── En-tête : les sept jours ── */}
        <div role="row" className="contents">
          <div
            role="columnheader"
            className="sticky left-0 top-0 z-30 border-b border-line bg-[image:var(--cf-elev-gradient)] px-2.5 py-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
            style={{ width: COL_STAFF }}
          >
            Équipe
          </div>
          <div
            role="columnheader"
            aria-label="Service"
            className="sticky top-0 z-30 border-b border-line bg-[image:var(--cf-elev-gradient)]"
            style={{ left: COL_STAFF, width: COL_SERVICE }}
          />
          {days.map((iso) => {
            const isToday = iso === todayIso;
            return (
              <div
                key={iso}
                role="columnheader"
                className={cx(
                  "border-b border-l border-line px-2 py-2 text-center",
                  isToday ? "bg-white/6" : "bg-[image:var(--cf-elev-gradient)]",
                )}
              >
                <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
                  {shortDayLabel(iso)}
                </div>
                <div
                  className={cx(
                    "cf-fig text-[17px] font-extrabold leading-tight",
                    isToday ? "text-accent" : "text-ink",
                  )}
                >
                  {dayNumber(iso)}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Volume attendu — un constat, pas une consigne ── */}
        {SERVICES.map((service, i) => (
          <div role="row" className="contents" key={`vol-${service}`}>
            {i === 0 ? (
              <div
                role="rowheader"
                aria-rowspan={2}
                className="sticky left-0 z-20 row-span-2 flex flex-col justify-center border-b border-line bg-[image:var(--cf-elev-gradient)] px-2.5 py-2"
                style={{ width: COL_STAFF }}
              >
                <span className="text-[12.5px] font-bold leading-tight text-ink">
                  Volume attendu
                </span>
                <Pill className="mt-1 self-start bg-gold text-[#1C1612]">Prédictif</Pill>
              </div>
            ) : null}
            <ServiceTag service={service} last={i === SERVICES.length - 1} />
            {days.map((iso) => {
              const block = coverageByCell.get(`${iso}|${service}`);
              const tone = coverageTone(block);
              return (
                <div
                  key={iso}
                  role="cell"
                  className={cx(
                    "flex min-h-[44px] flex-col justify-center border-l border-line2 px-2 py-1.5 text-center",
                    i === SERVICES.length - 1 && "border-b border-b-line",
                    iso === todayIso && "bg-white/4",
                  )}
                >
                  {!block || block.expectedOrders === 0 ? (
                    <span className="text-[12px] text-mut" aria-label="aucun volume attendu">
                      —
                    </span>
                  ) : (
                    <>
                      <span
                        className={cx(
                          "cf-fig text-[14px] font-extrabold leading-none",
                          COVERAGE_TONE_TEXT[tone],
                        )}
                      >
                        ≈ {block.expectedOrders}
                      </span>
                      <span className="mt-0.5 text-[10.5px] font-semibold text-mut">
                        {block.peoplePlanned} / {block.referencePeople} pers.
                      </span>
                      <span className="sr-only">{block.message}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* ── Une personne, deux sous-lignes ── */}
        {rows.map((row) => (
          <StaffRows
            key={row.staffId}
            row={row}
            days={days}
            shiftsByCell={shiftsByCell}
            todayIso={todayIso}
            payrollVisible={payrollVisible}
            onAdd={onAdd}
            onOpen={onOpen}
          />
        ))}

        {/* ── Pied : ce que coûte chaque journée ── */}
        <div role="row" className="contents">
          <div
            role="rowheader"
            className="sticky left-0 z-20 flex flex-col justify-center bg-[image:var(--cf-elev-gradient)] px-2.5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
            style={{ width: COL_STAFF }}
          >
            {payrollVisible ? "Coût du jour" : "Heures du jour"}
          </div>
          <div
            className="sticky z-20 bg-[image:var(--cf-elev-gradient)]"
            style={{ left: COL_STAFF, width: COL_SERVICE }}
            aria-hidden
          />
          {days.map((iso) => {
            const t = dayTotals.get(iso);
            return (
              <div
                key={iso}
                role="cell"
                className={cx(
                  "border-l border-line2 px-2 py-2.5 text-center",
                  iso === todayIso && "bg-white/4",
                )}
              >
                <div className="cf-fig text-[13.5px] font-extrabold text-ink">
                  {payrollVisible
                    ? t && t.costCents != null
                      ? fmtEuro(t.costCents)
                      : "—"
                    : t && t.hours > 0
                      ? fmtHours(t.hours)
                      : "—"}
                </div>
                {payrollVisible && t && t.hours > 0 && (
                  <div className="text-[10.5px] font-semibold text-mut">
                    {fmtHours(t.hours)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Les deux sous-lignes d'une personne ───

function StaffRows({
  row,
  days,
  shiftsByCell,
  todayIso,
  payrollVisible,
  onAdd,
  onOpen,
}: {
  row: GridRow;
  days: string[];
  shiftsByCell: Map<string, PlanningShiftView[]>;
  todayIso: string;
  payrollVisible: boolean;
  onAdd: (t: CellTarget) => void;
  onOpen: (s: PlanningShiftView) => void;
}) {
  return (
    <>
      {SERVICES.map((service, i) => (
        <div role="row" className="contents" key={service}>
          {i === 0 ? (
            <div
              role="rowheader"
              aria-rowspan={2}
              className="sticky left-0 z-20 row-span-2 flex flex-col justify-center gap-0.5 border-b border-line2 bg-[image:var(--cf-elev-gradient)] px-2.5 py-2"
              style={{ width: COL_STAFF }}
            >
              <span
                className="truncate text-[13.5px] font-bold leading-tight text-ink"
                title={row.name}
              >
                {row.name}
              </span>
              <span className="text-[11px] text-mut">
                {ROLE_LABEL[row.role]}
                {row.inactive && " · désactivé"}
              </span>
              <span className="cf-fig mt-0.5 text-[11.5px] font-bold text-mut">
                {fmtHours(row.hours)}
                {payrollVisible && row.costCents != null && ` · ${fmtEuro(row.costCents)}`}
              </span>
            </div>
          ) : null}
          <ServiceTag service={service} last={i === SERVICES.length - 1} />
          {days.map((iso) => (
            <ServiceBand
              key={iso}
              shifts={shiftsByCell.get(cellKey(row.staffId, iso, service)) ?? []}
              isToday={iso === todayIso}
              lastBand={i === SERVICES.length - 1}
              onAdd={() =>
                onAdd({ staffId: row.staffId, staffName: row.name, date: iso, service })
              }
              addLabel={`Ajouter un service du ${PLANNING_SERVICE_LABELS[service].toLowerCase()} — ${row.name}, ${longDayLabel(iso)}`}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/** Colonne épinglée qui nomme le service — « Midi » en haut, « Soir » en bas. */
function ServiceTag({ service, last }: { service: PlanningService; last: boolean }) {
  return (
    <div
      role="rowheader"
      className={cx(
        "sticky z-20 grid place-items-center bg-[image:var(--cf-elev-gradient)]",
        last ? "border-b border-line2" : "",
      )}
      style={{ left: COL_STAFF, width: COL_SERVICE }}
    >
      <span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-mut">
        {PLANNING_SERVICE_LABELS[service]}
      </span>
    </div>
  );
}

// ─── Une case : le service d'une personne, un jour, un créneau ───

function ServiceBand({
  shifts,
  isToday,
  lastBand,
  addLabel,
  onAdd,
  onOpen,
}: {
  shifts: PlanningShiftView[];
  isToday: boolean;
  lastBand: boolean;
  addLabel: string;
  onAdd: () => void;
  onOpen: (s: PlanningShiftView) => void;
}) {
  return (
    <div
      role="cell"
      className={cx(
        "group/band flex min-h-[52px] flex-col gap-1.5 border-l border-line2 p-1",
        lastBand && "border-b border-b-line2",
        isToday && "bg-white/4",
      )}
    >
      {shifts.map((s) => (
        <ShiftChip key={s.id} shift={s} onOpen={() => onOpen(s)} />
      ))}
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        className={cx(
          "cf-press flex flex-1 items-center justify-center rounded-ctrl border border-dashed border-white/14 text-mut",
          "transition-[opacity,border-color,background-color] duration-200 ease-sm",
          "hover:border-white/30 hover:bg-white/6 hover:text-ink focus-visible:border-accent focus-visible:text-ink",
          // Un doigt ne survole pas : sur tablette la cible reste visible en
          // permanence (et garde 36 px de haut sous un service existant),
          // sur souris elle s'efface pour ne pas bruiter la grille.
          shifts.length > 0 && "min-h-[26px] [@media(pointer:coarse)]:min-h-[36px]",
          shifts.length === 0
            ? "min-h-[44px]"
            : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/band:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
        )}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  );
}

function ShiftChip({ shift, onOpen }: { shift: PlanningShiftView; onOpen: () => void }) {
  const draft = shift.status === "brouillon";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "cf-press w-full rounded-ctrl border px-1.5 py-1 text-left transition-colors duration-200 ease-sm",
        "focus-visible:border-accent",
        draft
          ? "border-dashed border-white/28 bg-white/4 hover:bg-white/8"
          : "border-white/12 bg-[image:var(--cf-elev-gradient)] hover:bg-[image:var(--cf-elev-hover)]",
      )}
    >
      <span className="cf-fig block text-[12.5px] font-bold leading-tight text-ink">
        {fmtRange(shift.start, shift.end)}
      </span>
      <span className="flex items-center gap-1 text-[10.5px] font-semibold leading-tight text-mut">
        <span className="truncate">{PLANNING_POSITION_LABELS[shift.position]}</span>
        {shift.note && (
          <>
            <Icon name="edit" size={10} className="shrink-0" aria-hidden />
            <span className="sr-only">Note : {shift.note}</span>
          </>
        )}
      </span>
      <span className="sr-only">
        {draft ? "Brouillon" : "Publié"} — {fmtHours(shift.hours)}. Modifier ce service.
      </span>
    </button>
  );
}

/** Légende : ce que veut dire un contour pointillé, une couleur, un « ≈ ». */
export function GridLegend({ payrollVisible }: { payrollVisible: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-mut">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3.5 w-6 rounded-[5px] border border-dashed border-white/28 bg-white/4"
          aria-hidden
        />
        Brouillon
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-3.5 w-6 rounded-[5px] border border-white/12 bg-[image:var(--cf-elev-gradient)]"
          aria-hidden
        />
        Publié
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-okt" aria-hidden>
          ≈
        </span>
        Effectif dans le repère
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-prept" aria-hidden>
          ≈
        </span>
        Écart au repère
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-alertt" aria-hidden>
          ≈
        </span>
        Volume attendu, personne de prévu
      </span>
      {!payrollVisible && (
        <span className="text-mut">Montants masqués sur cette session</span>
      )}
    </div>
  );
}
