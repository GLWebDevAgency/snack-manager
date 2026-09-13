"use client";

/**
 * Vue « Horaires » (spec backoffice-restaurant §9).
 * — Horaires d'ouverture hebdomadaires : 7 jours × créneaux midi/soir,
 *   SlotToggle Ouvert/Fermé + heures éditables, note générée depuis l'état.
 * — Fermetures exceptionnelles : liste + ajout {from, to, reason} + suppression.
 * — Pause commande en ligne : Toggle danger + message personnalisable.
 * API : GET /tenants/me · PATCH /tenants/me/hours · PATCH /tenants/me/settings.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { SlotSettingsPanel } from "./SlotSettingsPanel";
import { AdminSections } from "@/components/admin/AdminSections";
import { useAdminCapabilities } from "../access";
import {
  Btn,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  Panel,
  Skeleton,
  SlotToggle,
  Textarea,
  Toggle,
  useToast,
} from "@/components/ui";

// ─────────────────────────────────────────────────────────────
// Modèle
// ─────────────────────────────────────────────────────────────

type Slot = { open: string; close: string };
/** Forme persistée (tenant.hours) — jour ISO : 1 = lundi … 7 = dimanche. */
type WireDay = { day: number; lunch: Slot | null; dinner: Slot | null };
type Closure = { from?: string; to?: string; reason?: string };

type ServiceKey = "lunch" | "dinner";
type ServiceState = Slot & { on: boolean };
type DayState = { day: number; lunch: ServiceState; dinner: ServiceState };

const DAY_NAMES = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

const SERVICES: { key: ServiceKey; label: string }[] = [
  { key: "lunch", label: "Midi" },
  { key: "dinner", label: "Soir" },
];

/** Heures proposées quand on rouvre un créneau jamais renseigné. */
const DEFAULT_SLOTS: Record<ServiceKey, Slot> = {
  lunch: { open: "11:30", close: "14:30" },
  dinner: { open: "18:00", close: "22:30" },
};

function fromWire(hours: WireDay[] | undefined): DayState[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const entry = hours?.find((h) => h.day === day);
    const svc = (key: ServiceKey): ServiceState => {
      const slot = entry?.[key];
      return slot
        ? { on: true, open: slot.open, close: slot.close }
        : { on: false, ...DEFAULT_SLOTS[key] };
    };
    return { day, lunch: svc("lunch"), dinner: svc("dinner") };
  });
}

const toWire = (days: DayState[]): WireDay[] =>
  days.map((d) => ({
    day: d.day,
    lunch: d.lunch.on ? { open: d.lunch.open, close: d.lunch.close } : null,
    dinner: d.dinner.on ? { open: d.dinner.open, close: d.dinner.close } : null,
  }));

/** Créneau ouvert incohérent (heures manquantes ou ouverture ≥ fermeture). */
const slotInvalid = (s: ServiceState) =>
  s.on && (!s.open || !s.close || s.open >= s.close);

/**
 * Note « Actuellement : … » générée depuis l'état (la maquette l'affichait en
 * dur « fermé le midi lundi & vendredi » — modèle Class'Food, spec §9.1).
 */
function currentNote(days: DayState[]): string {
  const name = (i: number) => DAY_NAMES[i]!.toLowerCase();
  const both: string[] = [];
  const lunchOnly: string[] = [];
  const dinnerOnly: string[] = [];
  days.forEach((d, i) => {
    if (!d.lunch.on && !d.dinner.on) both.push(name(i));
    else if (!d.lunch.on) lunchOnly.push(name(i));
    else if (!d.dinner.on) dinnerOnly.push(name(i));
  });
  const join = (a: string[]) =>
    a.length > 1 ? `${a.slice(0, -1).join(", ")} & ${a[a.length - 1]}` : a[0]!;
  const parts: string[] = [];
  if (both.length) parts.push(`fermé ${join(both)}`);
  if (lunchOnly.length) parts.push(`fermé le midi ${join(lunchOnly)}`);
  if (dinnerOnly.length) parts.push(`fermé le soir ${join(dinnerOnly)}`);
  return parts.length
    ? `Actuellement : ${parts.join(" · ")}.`
    : "Actuellement : ouvert midi et soir, 7 j/7.";
}

// ─── Dates des fermetures ───

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const dayMonthShort = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Colonne date compacte : « 14 juil. », « 15–22 août », « 28 déc. – 2 janv. ». */
function closureDateLabel(c: Closure): string {
  if (!c.from) return "—";
  const from = new Date(c.from);
  if (Number.isNaN(from.getTime())) return "—";
  const to = c.to ? new Date(c.to) : null;
  if (!to || Number.isNaN(to.getTime()) || sameDay(from, to))
    return dayMonthShort(from);
  if (
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth()
  )
    return `${from.getDate()}–${to.getDate()} ${to.toLocaleDateString("fr-FR", { month: "short" })}`;
  return `${dayMonthShort(from)} – ${dayMonthShort(to)}`;
}

/** Sous-texte : « Fermé toute la journée » ou « Réouverture le 23 août ». */
function closureSub(c: Closure): string {
  if (!c.from) return "Dates à préciser";
  const from = new Date(c.from);
  if (Number.isNaN(from.getTime())) return "Dates à préciser";
  const toRaw = c.to ? new Date(c.to) : from;
  const to = Number.isNaN(toRaw.getTime()) ? from : toRaw;
  if (sameDay(from, to)) return "Fermé toute la journée";
  const reopen = new Date(to);
  reopen.setDate(reopen.getDate() + 1);
  return `Réouverture le ${reopen.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

// ─────────────────────────────────────────────────────────────
// Contrôles locaux
// ─────────────────────────────────────────────────────────────

function TimeInput({
  value,
  onChange,
  invalid,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  label: string;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cx(
        // 96 px : à 16 px de corps (anti-zoom iOS), « 06:00 » plus l'horloge
        // native débordaient des 92 px d'origine.
        "cf-fig w-[96px] rounded-ctrl border bg-white/5 px-2 py-1.5 text-center text-[13px] font-bold text-white outline-none transition-colors duration-200 ease-sm [color-scheme:dark]",
        // `focus:border-accent` sur LES DEUX branches : avec `outline-none`,
        // la bordure est le seul indicateur de focus (1.4.11) — un champ en
        // erreur n'en avait aucun.
        invalid
          ? "border-alert bg-alert/10 focus:border-accent"
          : "border-white/8 hover:border-white/16 focus:border-accent focus:bg-white/8",
      )}
    />
  );
}

type ClosureDraft = { from: string; to: string; reason: string };

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function HoursPage() {
  const toast = useToast();
  const online = useAdminCapabilities().includes("online");

  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  // Horaires hebdomadaires
  const [days, setDays] = useState<DayState[]>([]);
  const [savedHours, setSavedHours] = useState<WireDay[]>([]);
  const [savingHours, setSavingHours] = useState(false);
  // Fermetures exceptionnelles
  const [closures, setClosures] = useState<Closure[]>([]);
  const [draft, setDraft] = useState<ClosureDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  const [savingClosure, setSavingClosure] = useState(false);
  // Pause commande en ligne
  const [settings, setSettings] = useState<TenantMe["settings"] | null>(null);
  const [msgDraft, setMsgDraft] = useState("");
  const [togglingPause, setTogglingPause] = useState(false);
  const [savingMsg, setSavingMsg] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const t = await api.get<TenantMe>("/tenants/me");
      const state = fromWire(t.hours);
      setDays(state);
      setSavedHours(toWire(state)); // baseline normalisée (comparaison dirty)
      setClosures(t.closures ?? []);
      setSettings(t.settings);
      setMsgDraft(t.settings?.pauseMessage ?? "");
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : `load` pose d'un seul bloc `days`, `savedHours` (la ligne de base du calcul « modifié »), `closures`, `settings` et `msgDraft`. Dissocier ces écritures désynchroniserait `savedHours` de `days` et fausserait l'état du bouton Enregistrer.
    void load();
  }, [load]);

  // ─── Horaires : édition, validation, sauvegarde ───

  const patchService = (
    day: number,
    key: ServiceKey,
    patch: Partial<ServiceState>,
  ) =>
    setDays((ds) =>
      ds.map((d) => (d.day === day ? { ...d, [key]: { ...d[key], ...patch } } : d)),
    );

  const wire = useMemo(() => toWire(days), [days]);
  const dirty = useMemo(
    () => JSON.stringify(wire) !== JSON.stringify(savedHours),
    [wire, savedHours],
  );
  const valid = useMemo(
    () => days.every((d) => !slotInvalid(d.lunch) && !slotInvalid(d.dinner)),
    [days],
  );

  async function saveHours() {
    if (!dirty || !valid || savingHours) return;
    setSavingHours(true);
    try {
      await api.patch<TenantMe>("/tenants/me/hours", { hours: wire });
      setSavedHours(wire);
      toast("Horaires enregistrés", { icon: "check" });
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Enregistrement impossible — réessayez",
      );
    } finally {
      setSavingHours(false);
    }
  }

  // ─── Fermetures : persistance immédiate (hours = baseline sauvegardée) ───

  async function persistClosures(next: Closure[], msg: string) {
    if (savingClosure) return false;
    setSavingClosure(true);
    try {
      await api.patch<TenantMe>("/tenants/me/hours", {
        hours: savedHours,
        closures: next,
      });
      setClosures(next);
      toast(msg, { icon: "check" });
      return true;
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Enregistrement impossible — réessayez",
      );
      return false;
    } finally {
      setSavingClosure(false);
    }
  }

  async function submitDraft() {
    if (!draft) return;
    if (!draft.from) return setDraftError("Indiquez la date de début.");
    if (draft.to && draft.to < draft.from)
      return setDraftError("La date de fin doit suivre la date de début.");
    if (!draft.reason.trim()) return setDraftError("Indiquez un motif.");
    setDraftError(null);
    const ok = await persistClosures(
      [
        ...closures,
        {
          from: draft.from,
          to: draft.to || draft.from,
          reason: draft.reason.trim(),
        },
      ],
      "Fermeture ajoutée",
    );
    if (ok) setDraft(null);
  }

  async function confirmDelete() {
    if (deleteIdx === null) return;
    const ok = await persistClosures(
      closures.filter((_, i) => i !== deleteIdx),
      "Fermeture supprimée",
    );
    if (ok) setDeleteIdx(null);
  }

  const sortedClosures = useMemo(
    () =>
      closures
        .map((c, idx) => ({ c, idx }))
        .sort(
          (a, b) =>
            new Date(a.c.from ?? 0).getTime() - new Date(b.c.from ?? 0).getTime(),
        ),
    [closures],
  );

  // ─── Pause commande en ligne ───

  const paused = settings?.onlineOrderingPaused ?? false;
  const msgDirty = msgDraft.trim() !== (settings?.pauseMessage ?? "");

  async function togglePause(next: boolean) {
    if (!settings || togglingPause) return;
    setTogglingPause(true);
    try {
      const updated = await api.patch<TenantMe>("/tenants/me/settings", {
        onlineOrderingPaused: next,
      });
      setSettings(
        updated?.settings ?? { ...settings, onlineOrderingPaused: next },
      );
      toast(
        next
          ? "Commande en ligne en pause — établissement « Fermé »"
          : "Commande en ligne réactivée — établissement « Ouvert »",
        { icon: "check" },
      );
    } catch {
      toast("Impossible de changer l'état — réessayez");
    } finally {
      setTogglingPause(false);
    }
  }

  async function saveMessage() {
    if (!settings || !msgDirty || savingMsg) return;
    setSavingMsg(true);
    try {
      const message = msgDraft.trim();
      const updated = await api.patch<TenantMe>("/tenants/me/settings", {
        pauseMessage: message,
      });
      setSettings(updated?.settings ?? { ...settings, pauseMessage: message });
      setMsgDraft(message);
      toast("Message de pause enregistré", { icon: "check" });
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setSavingMsg(false);
    }
  }

  // ─── États chargement / erreur ───

  if (loadState === "loading")
    return (
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:p-[26px] xl:grid-cols-[1.3fr_1fr]">
        <Skeleton className="h-[520px]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[280px]" />
          <Skeleton className="h-[220px]" />
        </div>
      </div>
    );

  if (loadState === "error")
    return (
      <div className="p-4 md:p-[26px]">
        <EmptyState
          icon="clock"
          title="Impossible de charger les horaires"
          hint="Vérifiez votre connexion puis réessayez."
          action={
            <Btn variant="ghost" size="sm" onClick={() => void load()}>
              Réessayer
            </Btn>
          }
        />
      </div>
    );

  return (
    <div className="space-y-4 p-4 md:p-[26px]">
      <div role="status" className="rounded-card border border-line bg-surface2 px-4 py-3 text-sm">
        <p className={cx("font-semibold", paused ? "text-alertt" : "text-ink")}>
          {paused ? "Commande en ligne en pause" : "Commande en ligne sans pause manuelle"}
        </p>
        <p className="mt-1 text-[13px] text-mut">
          {paused ? "Les nouvelles commandes sont suspendues. La reprise se règle dans « Commande en ligne »." : "Les horaires, fermetures et créneaux continuent de déterminer les disponibilités proposées."}
        </p>
      </div>
      <AdminSections label="Sections des horaires et créneaux" defaultSection="ouverture" sections={[
        { id: "ouverture", label: "Ouverture", icon: "clock", modified: dirty, content: (
      <Panel
        title="Horaires d'ouverture"
        sub="Créneaux de retrait proposés au client"
        className="min-w-0"
        actions={
          <>
            {dirty && (
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => setDays(fromWire(savedHours))}
              >
                Annuler
              </Btn>
            )}
            <Btn
              variant="primary"
              size="sm"
              icon="check"
              disabled={!dirty || !valid || savingHours}
              onClick={() => void saveHours()}
            >
              {savingHours ? "Enregistrement…" : "Enregistrer"}
            </Btn>
          </>
        }
      >
        <div className="mb-4 rounded-card border border-line bg-surface2 p-3.5 text-[13px] leading-relaxed text-mut">
          <p className="font-semibold text-ink">Quand vos changements s’appliquent</p>
          <p className="mt-1">Une journée dont les créneaux ont déjà été préparés garde ses horaires, même sans commande. Les modifications d’horaires et les fermetures exceptionnelles s’appliquent aux journées encore non préparées. Les commandes confirmées restent inchangées.</p>
        </div>
        {/* En-tête de grille — dès `md` seulement : en dessous chaque
            service porte sa propre étiquette Midi/Soir dans la ligne */}
        <div className="hidden items-center gap-2 px-1.5 pb-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut md:flex">
          <div className="w-[110px]">Jour</div>
          {SERVICES.map((s) => (
            <div key={s.key} className="flex-1 text-center">
              {s.label}
            </div>
          ))}
        </div>

        {/* 7 lignes Lundi → Dimanche */}
        {days.map((d, i) => (
          <div
            key={d.day}
            className="flex flex-col gap-2 border-t border-line2 px-1.5 py-[9px] md:flex-row md:items-start md:gap-2"
          >
            <div className="text-[15px] font-bold text-ink md:w-[110px] md:pt-1.5">
              {DAY_NAMES[i]}
            </div>
            {SERVICES.map(({ key, label }) => {
              const s = d[key];
              const invalid = slotInvalid(s);
              // onChange sans paramètre : SlotToggle hérite du onChange natif
              // de ButtonHTMLAttributes (non omis), le paramètre serait typé
              // boolean | ChangeEvent — on bascule donc depuis l'état local.
              return (
                /*
                  Sous `md`, le service tient sur SA ligne : étiquette Midi/Soir,
                  bascule, heures à droite — les deux colonnes côte à côte
                  poussaient les heures du soir hors de l'écran.
                */
                <div
                  key={key}
                  className="flex w-full items-center gap-2 max-md:flex-wrap md:w-auto md:flex-1 md:flex-col md:items-center md:gap-1.5"
                >
                  <span
                    className="w-8 shrink-0 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut md:hidden"
                    aria-hidden
                  >
                    {label}
                  </span>
                  <SlotToggle
                    on={s.on}
                    onChange={() => patchService(d.day, key, { on: !s.on })}
                    aria-label={`${DAY_NAMES[i]} ${label.toLowerCase()} : ${s.on ? "ouvert" : "fermé"}`}
                  />
                  {s.on && (
                    <div className="flex items-center gap-1.5 max-md:ml-auto">
                      <TimeInput
                        value={s.open}
                        invalid={invalid}
                        label={`${DAY_NAMES[i]} ${label.toLowerCase()} — ouverture`}
                        onChange={(v) => patchService(d.day, key, { open: v })}
                      />
                      <span className="text-xs text-mut" aria-hidden>
                        –
                      </span>
                      <TimeInput
                        value={s.close}
                        invalid={invalid}
                        label={`${DAY_NAMES[i]} ${label.toLowerCase()} — fermeture`}
                        onChange={(v) => patchService(d.day, key, { close: v })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <p className="mt-3 border-t border-line2 pt-3 text-[13px] text-mut">
          {currentNote(days)}
        </p>
        {!valid && (
          <p role="alert" className="mt-2 text-[13px] font-semibold text-alertt">
            Vérifiez les heures en rouge : l’ouverture doit précéder la
            fermeture.
          </p>
        )}
      </Panel>
        ) },
        { id: "fermetures", label: "Fermetures", icon: "calendar", content: (
        <Panel
          title="Fermetures exceptionnelles"
          actions={
            <Btn
              variant="primary"
              size="sm"
              icon="plus"
              onClick={() => {
                setDraftError(null);
                setDraft({ from: "", to: "", reason: "" });
              }}
            >
              Ajouter
            </Btn>
          }
        >
          {sortedClosures.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Aucune fermeture prévue"
              hint="Ajoutez un jour férié ou des congés pour les journées encore non préparées."
            />
          ) : (
            <ul>
              {sortedClosures.map(({ c, idx }, i) => (
                <li
                  key={idx}
                  className={cx(
                    "flex items-center gap-3 py-[11px]",
                    i > 0 && "border-t border-line2",
                  )}
                >
                  <div className="cf-fig w-[74px] shrink-0 text-center text-[15px] font-extrabold text-accent">
                    {closureDateLabel(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold text-ink">
                      {c.reason?.trim() || "Fermeture exceptionnelle"}
                    </div>
                    <div className="truncate text-[13px] text-mut">
                      {closureSub(c)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteIdx(idx)}
                    aria-label={`Supprimer la fermeture « ${c.reason?.trim() || closureDateLabel(c)} »`}
                    title="Supprimer"
                    className="cf-press grid size-8 shrink-0 place-items-center rounded-ctrl text-mut hover:bg-alert/12 hover:text-alertt"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-mut">Une fermeture ne modifie pas une journée déjà préparée. Pour suspendre immédiatement les nouvelles commandes en ligne, utilisez la pause dans « Commande en ligne ».</p>
        </Panel>
        ) },
        { id: "commande", label: "Commande en ligne", icon: "cart", modified: msgDirty, content: (
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
{online && settings && <SlotSettingsPanel key={`${settings.slotIntervalMin}-${settings.slotCapacity}`} settings={settings} onSaved={setSettings} />}
        <Panel
          title="Pause commande en ligne"
          sub="Message affiché au client pendant la pause"
        >
          <div className="flex items-center justify-between gap-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3.5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink">Commande en ligne</div>
              <div
                className={cx(
                  "text-[13px] font-semibold",
                  paused ? "text-alertt" : "text-okt",
                )}
              >
                {paused
                  ? "En pause — les clients ne peuvent plus commander"
                  : "Active — les clients peuvent commander"}
              </div>
            </div>
            <Toggle
              danger
              on={paused}
              disabled={!settings || togglingPause}
              label="Mettre la commande en ligne en pause"
              onChange={(next) => void togglePause(next)}
            />
          </div>

          <div className="mt-3.5 flex flex-col gap-2.5">
            <Field
              label="Message de pause"
              htmlFor="pause-message"
              hint="Affiché sur la page de commande tant que la pause est active."
            >
              <Textarea
                id="pause-message"
                value={msgDraft}
                onChange={(e) => setMsgDraft(e.target.value)}
                placeholder="Victimes de notre succès — la commande en ligne rouvre très vite !"
              />
            </Field>
            <div className="flex justify-end">
              <Btn
                variant="ink"
                size="sm"
                disabled={!msgDirty || savingMsg}
                onClick={() => void saveMessage()}
              >
                {savingMsg ? "Enregistrement…" : "Enregistrer le message"}
              </Btn>
            </div>
          </div>
        </Panel>
          </div>
        ) },
      ]} />

      {/* ── Modale d'ajout de fermeture ── */}
      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title="Ajouter une fermeture"
          footer={
            <>
              <Btn variant="ghost" onClick={() => setDraft(null)}>
                Annuler
              </Btn>
              <Btn
                variant="primary"
                disabled={savingClosure}
                onClick={() => void submitDraft()}
              >
                {savingClosure ? "Enregistrement…" : "Ajouter la fermeture"}
              </Btn>
            </>
          }
        >
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] leading-relaxed text-mut">Cette fermeture s’appliquera aux journées encore non préparées. Les journées déjà préparées et les commandes confirmées restent inchangées.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Du" htmlFor="closure-from">
                <Input
                  id="closure-from"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  className="[color-scheme:dark]"
                />
              </Field>
              <Field
                label="Au"
                htmlFor="closure-to"
                hint="Laisser vide pour un seul jour"
              >
                <Input
                  id="closure-to"
                  type="date"
                  value={draft.to}
                  min={draft.from || undefined}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  className="[color-scheme:dark]"
                />
              </Field>
            </div>
            <Field label="Motif" htmlFor="closure-reason">
              <Input
                id="closure-reason"
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="Ex. Fête nationale, congés d'été…"
              />
            </Field>
            {draftError && (
              <p role="alert" className="text-[13px] font-semibold text-alertt">
                {draftError}
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* ── Modale de confirmation de suppression (destructive) ── */}
      <Modal
        open={deleteIdx !== null}
        onClose={() => setDeleteIdx(null)}
        title="Supprimer la fermeture"
        destructive
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleteIdx(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={savingClosure}
              onClick={() => void confirmDelete()}
            >
              {savingClosure ? "Suppression…" : "Supprimer"}
            </Btn>
          </>
        }
      >
        {deleteIdx !== null && (
          <p>
            La fermeture «{" "}
            {closures[deleteIdx]?.reason?.trim() ||
              closureDateLabel(closures[deleteIdx] ?? {})}{" "}
            » sera retirée des réglages. Les journées déjà préparées ne seront
            pas rouvertes par cette suppression.
          </p>
        )}
      </Modal>
    </div>
  );
}
