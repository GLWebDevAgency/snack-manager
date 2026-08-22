"use client";

/**
 * Poser ou corriger un service.
 *
 * Contrainte de conception : le gérant fait ça DEBOUT, sur une tablette, entre
 * deux coups de feu. La modale s'ouvre donc DÉJÀ REMPLIE — la case touchée
 * porte la personne, le jour et le créneau, et les horaires du service arrivent
 * proposés. Poser un service tient en deux gestes : toucher la case, valider.
 *
 * Tout le reste est un AJUSTEMENT facultatif : les deux créneaux types se
 * posent d'un doigt, les horaires se déplacent par quarts d'heure avec des
 * cibles larges (pas de glisser-déposer au pixel près), et l'on peut changer de
 * personne ou de jour sans refermer.
 */

import { useMemo, useState } from "react";
import type { PlanningPosition, PlanningService, PlanningShiftView } from "@sm/contracts";
import { PLANNING_POSITIONS, PLANNING_POSITION_LABELS, PLANNING_SERVICE_LABELS } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { cx } from "@/lib/cx";
import { Btn, Field, IconBtn, Input, Modal, Select, useToast } from "@/components/ui";
import {
  fmtHours,
  fmtRange,
  hmToMinutes,
  longDayLabel,
  minutesToHm,
  POSITION_FOR_ROLE,
  SERVICES,
  SHIFT_PRESETS,
  shiftHours,
  type GridRow,
  type StaffRole,
} from "./data";
import type { CellTarget } from "./grid";

/** Pas d'ajustement : le quart d'heure, l'unité dans laquelle un patron raisonne. */
const STEP_MINUTES = 15;

export type EditorState =
  | { mode: "create"; target: CellTarget }
  | { mode: "edit"; shift: PlanningShiftView };

type ShiftEditorProps = {
  state: EditorState;
  rows: GridRow[];
  days: string[];
  /** `staffId` → coût horaire en centimes. Vide si la session ne lit pas les montants. */
  hourlyCosts: Map<string, number>;
  payrollVisible: boolean;
  /** Masse salariale de la semaine avant ce service — pour annoncer l'après. */
  weekCostCents: number | null;
  weekHours: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

export function ShiftEditor({
  state,
  rows,
  days,
  hourlyCosts,
  payrollVisible,
  weekCostCents,
  weekHours,
  onClose,
  onSaved,
}: ShiftEditorProps) {
  const toast = useToast();
  const isEdit = state.mode === "edit";

  const initialService: PlanningService =
    state.mode === "create" ? state.target.service : state.shift.service;

  const [staffId, setStaffId] = useState(
    state.mode === "create" ? state.target.staffId : state.shift.staffId,
  );
  const [date, setDate] = useState(
    state.mode === "create" ? state.target.date : state.shift.date,
  );
  const [start, setStart] = useState(
    state.mode === "create" ? SHIFT_PRESETS[initialService].start : state.shift.start,
  );
  const [end, setEnd] = useState(
    state.mode === "create" ? SHIFT_PRESETS[initialService].end : state.shift.end,
  );
  const [position, setPosition] = useState<PlanningPosition>(() => {
    if (state.mode === "edit") return state.shift.position;
    const role = rows.find((r) => r.staffId === state.target.staffId)?.role;
    return role ? POSITION_FOR_ROLE[role as StaffRole] : "polyvalent";
  });
  const [note, setNote] = useState(state.mode === "edit" ? state.shift.note : "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Le poste suit le rôle tant que le gérant ne l'a pas décidé lui-même. */
  const [positionTouched, setPositionTouched] = useState(false);
  // Le poste par défaut ne dépend que de `rows` et du salarié sélectionné, tous
  // deux disponibles au rendu : l'ajuster ici plutôt que dans un effet évite le
  // rendu intermédiaire pendant lequel le panneau affichait — et un
  // enregistrement immédiat aurait retenu — le poste du salarié précédent.
  // Les trois gardes reproduisent exactement celles de l'effet : un choix
  // manuel prime, le mode édition ne dérive jamais, et un rôle introuvable
  // laisse le poste inchangé au lieu de le rabattre sur un repli.
  const roleDefault =
    positionTouched || isEdit
      ? undefined
      : rows.find((r) => r.staffId === staffId)?.role;
  if (roleDefault && POSITION_FOR_ROLE[roleDefault as StaffRole] !== position) {
    setPosition(POSITION_FOR_ROLE[roleDefault as StaffRole]);
  }

  const hours = useMemo(() => shiftHours(start, end), [start, end]);
  const rate = hourlyCosts.get(staffId) ?? null;
  const costCents = rate == null ? null : Math.round(hours * rate);
  const overnight = hmToMinutes(end) <= hmToMinutes(start);
  const sameTime = start === end;

  /** Le créneau type dont les horaires sont exactement ceux affichés. */
  const activePreset = SERVICES.find(
    (s) => SHIFT_PRESETS[s].start === start && SHIFT_PRESETS[s].end === end,
  );

  function applyPreset(service: PlanningService) {
    setStart(SHIFT_PRESETS[service].start);
    setEnd(SHIFT_PRESETS[service].end);
  }

  async function submit() {
    if (sameTime) {
      setError("Le début et la fin ne peuvent pas être identiques");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await api.patch(`/planning/shifts/${state.shift.id}`, {
          staffId,
          date,
          start,
          end,
          position,
          note: note.trim(),
        });
        toast("Service modifié", { icon: "check" });
      } else {
        // Pas de `status` : l'API pose un BROUILLON par défaut, et c'est la
        // règle — poser un service ne le rend jamais visible à l'équipe.
        await api.post("/planning/shifts", {
          staffId,
          date,
          start,
          end,
          position,
          note: note.trim(),
        });
        toast("Service ajouté au brouillon", { icon: "check" });
      }
      onClose();
      await onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Enregistrement impossible — réessayez",
      );
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEdit) return;
    setSaving(true);
    try {
      await api.del(`/planning/shifts/${state.shift.id}`);
      toast("Service retiré du planning", { icon: "check" });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible — réessayez");
      setSaving(false);
    }
  }

  const staffName = rows.find((r) => r.staffId === staffId)?.name ?? "";

  return (
    <Modal
      open
      onClose={onClose}
      width={540}
      title={isEdit ? "Modifier le service" : "Poser un service"}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Btn>
          <Btn size="sm" onClick={() => void submit()} disabled={saving || sameTime}>
            {saving ? "Enregistrement…" : isEdit ? "Enregistrer" : "Ajouter au planning"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Qui, quel jour — modifiables sans refermer, à la place du glisser-déposer. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Personne" htmlFor="shift-staff">
            <Select
              id="shift-staff"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              {rows.map((r) => (
                <option key={r.staffId} value={r.staffId}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Jour" htmlFor="shift-day">
            <Select id="shift-day" value={date} onChange={(e) => setDate(e.target.value)}>
              {days.map((iso) => (
                <option key={iso} value={iso}>
                  {capitalize(longDayLabel(iso))}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Créneaux proposés d'avance — le geste par défaut. */}
        <div>
          <span className="block text-xs font-bold uppercase tracking-[0.04em] text-mut">
            Créneau type
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {SERVICES.map((service) => {
              const preset = SHIFT_PRESETS[service];
              const active = activePreset === service;
              return (
                <button
                  key={service}
                  type="button"
                  onClick={() => applyPreset(service)}
                  aria-pressed={active}
                  className={cx(
                    "cf-press min-h-[56px] rounded-ctrl border px-3 py-2 text-left transition-colors duration-200 ease-sm",
                    active
                      ? "border-accent bg-white/8"
                      : "border-white/8 bg-white/5 hover:border-white/20 hover:bg-white/8",
                  )}
                >
                  <span className="block text-[13px] font-bold text-ink">
                    {PLANNING_SERVICE_LABELS[service]}
                  </span>
                  <span className="cf-fig block text-[12.5px] font-semibold text-mut">
                    {fmtRange(preset.start, preset.end)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Ajustement au quart d'heure — cibles larges, pas de précision au pixel. */}
        <div className="grid grid-cols-2 gap-3">
          <TimeStepper label="Début" id="shift-start" value={start} onChange={setStart} />
          <TimeStepper label="Fin" id="shift-end" value={end} onChange={setEnd} />
        </div>

        {/* Ce que ce service dure et coûte — la décision se prend ici, pas en fin de mois. */}
        <div className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="cf-fig text-[17px] font-extrabold text-ink">
              {sameTime ? "—" : fmtHours(hours)}
              {payrollVisible && costCents != null && (
                <span className="text-accent"> · {fmtEuro(costCents)}</span>
              )}
            </span>
            <span className="text-[12px] text-mut">
              {overnight && !sameTime && "Fin après minuit · "}
              {payrollVisible && costCents == null
                ? `Coût horaire non renseigné pour ${staffName || "cette personne"}`
                : "Ce service"}
            </span>
          </div>
          {payrollVisible && costCents != null && !sameTime && (
            <p className="mt-1.5 text-[12.5px] text-mut">
              {isEdit ? "Semaine actuelle" : "Portera la semaine à"}{" "}
              <span className="cf-fig font-bold text-ink">
                {fmtHours(isEdit ? weekHours : weekHours + hours)}
                {weekCostCents != null &&
                  ` · ${fmtEuro(isEdit ? weekCostCents : weekCostCents + costCents)}`}
              </span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Poste" htmlFor="shift-position">
            <Select
              id="shift-position"
              value={position}
              onChange={(e) => {
                setPositionTouched(true);
                setPosition(e.target.value as PlanningPosition);
              }}
            >
              {PLANNING_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {PLANNING_POSITION_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="shift-note" hint="Visible sur le planning partagé">
            <Input
              id="shift-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ouverture, livraison…"
              maxLength={200}
            />
          </Field>
        </div>

        {error && (
          <p className="text-[13px] font-semibold text-alertt" role="alert">
            {error}
          </p>
        )}

        {isEdit && (
          <div className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-alertt">
                  Retirer ce service du planning ?
                </p>
                <div className="flex gap-2">
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={saving}
                  >
                    Annuler
                  </Btn>
                  <Btn
                    variant="ink"
                    size="sm"
                    className="text-alertt"
                    onClick={() => void remove()}
                    disabled={saving}
                  >
                    Confirmer le retrait
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-mut">
                  {state.mode === "edit" && state.shift.status === "publie"
                    ? "Ce service est publié — le retirer modifie ce que l'équipe a déjà lu."
                    : "Ce service est encore en brouillon."}
                </p>
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  className="border-alert/40 text-alertt hover:bg-alert/10"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  Retirer
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Heure murale : deux cibles larges au quart d'heure + saisie directe au besoin. */
function TimeStepper({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const shift = (delta: number) => onChange(minutesToHm(hmToMinutes(value) + delta));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-xs font-bold uppercase tracking-[0.04em] text-mut">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <IconBtn
          icon="minus"
          label={`${label} — reculer de 15 minutes`}
          size={44}
          iconSize={16}
          onClick={() => shift(-STEP_MINUTES)}
        />
        <Input
          id={id}
          type="time"
          step={STEP_MINUTES * 60}
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="cf-fig !w-full min-w-0 text-center !text-[16px] !font-extrabold [&::-webkit-calendar-picker-indicator]:invert"
        />
        <IconBtn
          icon="plus"
          label={`${label} — avancer de 15 minutes`}
          size={44}
          iconSize={16}
          onClick={() => shift(STEP_MINUTES)}
        />
      </div>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
