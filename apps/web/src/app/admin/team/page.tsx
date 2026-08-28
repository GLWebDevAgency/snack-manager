"use client";

/**
 * Vue « Équipe & pointage » (spec backoffice-restaurant §12) :
 * KPI, cartes membres avec badge arrivée/départ 1-clic, ajout/édition
 * (PIN 4-6 chiffres confirmé, désactivation douce), table des pointages
 * de la semaine (heures arrondies 0,5 h PAR SHIFT au départ, côté API)
 * avec navigation semaine précédente/suivante.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Btn,
  Card,
  EmptyState,
  Field,
  Icon,
  IconBtn,
  Input,
  Kpi,
  Modal,
  Panel,
  Pill,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";

// ─── Types (réponses du module API staff — DTO locaux, hors contracts) ───

type StaffRole = "gerant" | "caisse" | "cuisine";

type Member = {
  _id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  /** Shift ouvert → « en poste maintenant ». */
  onDuty: { shiftId: string; clockIn: string } | null;
  /** Dernier départ badgé (pour « Parti à HH:MM »). */
  lastClockOut: string | null;
};

type ShiftRow = {
  _id: string;
  staffId: string;
  clockIn: string;
  clockOut: string | null;
  /** Heures arrondies 0,5 h au départ — null tant que le shift est ouvert. */
  hours: number | null;
};

type WeekData = {
  from: string;
  to: string;
  shifts: ShiftRow[];
  totals: { staffId: string; name: string; role: StaffRole; active: boolean; hours: number }[];
};

// ─── Utilitaires ───

const ROLE_LABEL: Record<StaffRole, string> = {
  gerant: "Gérant",
  caisse: "Caisse",
  cuisine: "Cuisine",
};

const PIN_RE = /^\d{4,6}$/;

/** Lundi 00:00 de la semaine de `d` (convention française). */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** 3.5 → « 3,5 » (heures décimales déjà arrondies 0,5 h par l'API). */
const fmtH = (h: number) =>
  h.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Durée depuis l'arrivée, format spec §12.2 : `Xh` + minutes sur 2 chiffres. */
function sinceLabel(clockIn: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(clockIn).getTime()) / 60_000));
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

/** Heure locale fr-FR sur 2 chiffres — « Parti à 18:05 ». */
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ─── Page ───

export default function TeamPage() {
  const toast = useToast();

  // Équipe
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Semaine affichée (offset 0 = courante, négatif = passée)
  const [offset, setOffset] = useState(0);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekLoading, setWeekLoading] = useState(true);

  // KPI « Heures équipe cette semaine » — indépendant de la navigation
  const [currentTotal, setCurrentTotal] = useState<number | null>(null);

  const [clockingId, setClockingId] = useState<string | null>(null);
  const [modal, setModal] = useState<
    { mode: "add" } | { mode: "edit"; member: Member } | null
  >(null);

  // Tick 1 min : rafraîchit « arrivé il y a XhMM » (recommandation spec §12.2)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // ── Chargements ──

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await api.get<Member[]>("/staff"));
      setMembersError(null);
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  const fetchWeek = useCallback((off: number) => {
    const from = addDays(startOfWeek(new Date()), off * 7);
    const to = addDays(from, 7);
    return api.get<WeekData>(
      `/staff/shifts?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
  }, []);

  const loadWeek = useCallback(
    async (off: number) => {
      setWeekLoading(true);
      try {
        const data = await fetchWeek(off);
        setWeek(data);
        setWeekError(null);
        if (off === 0)
          setCurrentTotal(data.totals.reduce((s, t) => s + t.hours, 0));
      } catch (e) {
        setWeekError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        setWeekLoading(false);
      }
    },
    [fetchWeek],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : sans lui aucun salarié n'est listé, le badgeage et les actions CRUD n'ont plus de cible, et `refresh` rechargerait une liste jamais initialisée.
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone rejoué à chaque navigation de semaine ; `loadWeek` n'actualise le KPI `currentTotal` que si `off === 0`. Perdre cette condition afficherait les heures d'une semaine passée comme total de la semaine EN COURS.
    void loadWeek(offset);
  }, [offset, loadWeek]);

  /** Après badge ou CRUD : équipe + semaine affichée + KPI semaine courante. */
  const refresh = useCallback(async () => {
    await Promise.all([
      loadMembers(),
      loadWeek(offset),
      offset !== 0
        ? fetchWeek(0)
            .then((d) =>
              setCurrentTotal(d.totals.reduce((s, t) => s + t.hours, 0)),
            )
            .catch(() => {}) // KPI non bloquant
        : Promise.resolve(),
    ]);
  }, [loadMembers, loadWeek, fetchWeek, offset]);

  // ── Badge 1-clic ──

  async function clockMember(m: Member, direction: "in" | "out") {
    if (clockingId) return;
    setClockingId(m._id);
    try {
      await api.post(`/staff/${m._id}/clock`, { direction });
      toast(
        direction === "in"
          ? `Arrivée badgée — ${m.name}`
          : `Départ badgé — ${m.name}`,
        { icon: "check" },
      );
      await refresh();
    } catch (e) {
      toast(
        e instanceof ApiError ? e.message : "Badge impossible — réessayez",
      );
    } finally {
      setClockingId(null);
    }
  }

  // ── Dérivés ──

  /**
   * Les membres DÉSACTIVÉS — visibles, et réactivables.
   *
   * L'écran ne rendait que les actifs, et la modale d'édition n'est atteignable
   * que depuis une carte : désactiver quelqu'un le faisait disparaître pour
   * toujours. Son code restait pourtant réservé — deux équipiers ne peuvent pas
   * partager un PIN — et le gérant n'avait aucun moyen de le rendre, ni de
   * reprendre la personne à la saison suivante. `StaffUpdateSchema` accepte
   * `active: true` depuis toujours ; aucun écran ne l'envoyait.
   */
  const inactiveMembers = useMemo(
    () => (members ?? []).filter((m) => !m.active),
    [members],
  );
  const activeMembers = useMemo(
    () => (members ?? []).filter((m) => m.active),
    [members],
  );
  const onDutyCount = activeMembers.filter((m) => m.onDuty).length;

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), offset * 7),
    [offset],
  );
  const days = useMemo(
    () => [...Array(7)].map((_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const dateOpts: Intl.DateTimeFormatOptions =
    weekStart.getFullYear() !== new Date().getFullYear()
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "numeric", month: "long" };
  const weekLabel = `Semaine du ${weekStart.toLocaleDateString("fr-FR", dateOpts)} au ${addDays(weekStart, 6).toLocaleDateString("fr-FR", dateOpts)}`;

  /** Heures closes + présence d'un shift ouvert, par personne et par jour. */
  const dayKey = (staffId: string, d: Date) =>
    `${staffId}:${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const dayHours = useMemo(() => {
    const map = new Map<string, { closed: number; open: boolean }>();
    for (const s of week?.shifts ?? []) {
      const key = dayKey(s.staffId, new Date(s.clockIn));
      const cur = map.get(key) ?? { closed: 0, open: false };
      if (s.hours == null) cur.open = true;
      else cur.closed += s.hours;
      map.set(key, cur);
    }
    return map;
  }, [week]);

  /** Lignes de la table : membres actifs + désactivés ayant pointé cette semaine. */
  const rows = useMemo(
    () => (week?.totals ?? []).filter((t) => t.active || t.hours > 0),
    [week],
  );
  const weekTotal = useMemo(
    () => rows.reduce((s, t) => s + t.hours, 0),
    [rows],
  );

  // ── Rendu ──

  /**
   * Navigation de semaine — rendue DEUX fois : dans l'en-tête du panneau à
   * partir de `md`, sous le titre en dessous. À 390 px, ses ±310 px écrasaient
   * le titre « Pointages de la semaine » à une lettre par ligne.
   */
  const weekNav = (
    <>
      <IconBtn
        icon="back"
        label="Semaine précédente"
        size={34}
        iconSize={15}
        onClick={() => setOffset((o) => o - 1)}
      />
      <span
        className="min-w-[230px] text-center text-[13px] font-semibold text-ink max-md:min-w-0 max-md:flex-1"
        aria-live="polite"
      >
        {weekLabel}
      </span>
      <IconBtn
        icon="arrow"
        label="Semaine suivante"
        size={34}
        iconSize={15}
        disabled={offset >= 0}
        onClick={() => setOffset((o) => o + 1)}
      />
    </>
  );

  return (
    <div className="space-y-4 p-4 md:p-[26px]">
      {/* ── Rangée KPI (spec §12.1 — absences : modèle à définir §12.3) ── */}
      <div className="flex flex-wrap gap-4">
        {members === null && !membersError ? (
          <>
            <Skeleton className="h-[118px] flex-1" />
            <Skeleton className="h-[118px] flex-1" />
          </>
        ) : (
          <>
            <Kpi
              label="En poste maintenant"
              value={`${onDutyCount} / ${activeMembers.length}`}
              icon="user"
            />
            <Kpi
              label="Heures équipe cette semaine"
              value={currentTotal == null ? "—" : `${fmtH(currentTotal)} h`}
              icon="clock"
            />
          </>
        )}
      </div>

      {/* ── Cartes membres ── */}
      <Panel
        title="Équipe"
        sub="Membres, rôles et codes PIN — badge arrivée/départ en 1 clic"
        actions={
          <Btn size="sm" icon="plus" onClick={() => setModal({ mode: "add" })}>
            {/* Libellé court sous `sm` : l'en-tête du panneau ne laisse au
                sous-titre que ce que le bouton ne prend pas. */}
            <span className="max-sm:hidden">Ajouter un membre</span>
            <span className="sm:hidden">Ajouter</span>
          </Btn>
        }
      >
        {members === null ? (
          membersError ? (
            <ErrorBlock msg={membersError} onRetry={loadMembers} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[150px]" />
              ))}
            </div>
          )
        ) : activeMembers.length === 0 ? (
          <EmptyState
            icon="user"
            title={
              members.length === 0
                ? "Aucun membre dans l'équipe"
                : "Aucun membre actif"
            }
            hint="Ajoutez un membre pour badger les arrivées et suivre les heures."
            action={
              <Btn
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={() => setModal({ mode: "add" })}
              >
                Ajouter un membre
              </Btn>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {activeMembers.map((m) => (
              <MemberCard
                key={m._id}
                member={m}
                now={now}
                busy={clockingId === m._id}
                onClock={(dir) => void clockMember(m, dir)}
                onEdit={() => setModal({ mode: "edit", member: m })}
              />
            ))}
          </div>
        )}

        {/*
          LES DÉSACTIVÉS, ET LE CHEMIN DU RETOUR.
          Sans cette section, désactiver était irréversible depuis le
          back-office : la personne sortait de l'écran, son code restait
          réservé, et rien ne permettait de la reprendre.
        */}
        {inactiveMembers.length > 0 && (
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
              Désactivés — {inactiveMembers.length}
            </div>
            <p className="mt-1 text-[13px] text-mut">
              Ils ne pointent plus et n&apos;apparaissent pas au planning. Leur code reste
              réservé : réactivez pour le rendre, ou pour reprendre la personne.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {inactiveMembers.map((m) => (
                <button
                  key={m._id}
                  type="button"
                  onClick={() => setModal({ mode: "edit", member: m })}
                  title={`Ouvrir la fiche de ${m.name} — le bouton « Réactiver » s'y trouve`}
                  className="cf-press inline-flex max-w-full items-center gap-2 rounded-pill border border-line bg-white/3 px-3 py-2 text-[13px] font-bold text-mut hover:border-white/25 hover:text-ink"
                >
                  {/*
                    Le NOM porte le clic, pas un verbe : ce bouton ouvre la
                    fiche, il ne réactive pas. Écrire « Réactiver » ici
                    promettait une action immédiate que le clic ne fait pas —
                    le vrai geste, et sa confirmation, sont dans la fiche.
                  */}
                  <span className="truncate">{m.name}</span>
                  <Icon name="arrow" size={14} className="shrink-0 text-accent" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* ── Pointages de la semaine ── */}
      <Panel
        title="Pointages de la semaine"
        sub="Badge à l'arrivée et au départ — heures cumulées automatiquement"
        // `md:contents` : à partir de `md` le span s'efface et ses enfants
        // deviennent les items flex de l'en-tête ; en dessous, tout disparaît
        // au profit de la copie rendue sous le titre.
        actions={<span className="hidden md:contents">{weekNav}</span>}
      >
        <div className="mb-3 flex items-center gap-2 md:hidden">{weekNav}</div>
        {weekLoading ? (
          <Skeleton className="h-56" />
        ) : weekError ? (
          <ErrorBlock msg={weekError} onRetry={() => void loadWeek(offset)} />
        ) : !week || week.shifts.length === 0 ? (
          <EmptyState
            icon="clock"
            title="Aucun pointage cette semaine"
            hint="Les badges d'arrivée et de départ apparaîtront ici."
          />
        ) : (
          <div className="overflow-x-auto">
            {/* `min-w` : neuf colonnes (employé + 7 jours + total) écrasées à
                390 px devenaient illisibles — la table garde sa largeur de
                lecture et défile dans SON cadre. */}
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Heures pointées par membre et par jour, {weekLabel.toLowerCase()} —
                arrondies à la demi-heure par pointage au départ
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="px-1.5 pb-2.5 text-left text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                  >
                    Employé
                  </th>
                  {days.map((d) => (
                    <th
                      key={+d}
                      scope="col"
                      className="px-1.5 pb-2.5 text-right text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                    >
                      {d.toLocaleDateString("fr-FR", {
                        weekday: "short",
                        day: "numeric",
                      })}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-1.5 pb-2.5 text-right text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                  >
                    Semaine
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.staffId}
                    className="border-b border-line2 transition-colors duration-200 ease-sm last:border-0 hover:bg-white/4"
                  >
                    <th scope="row" className="px-1.5 py-3 text-left">
                      <span className="text-[15px] font-bold text-ink">
                        {t.name}
                      </span>
                      {!t.active && (
                        <Pill variant="out" className="ml-2 align-middle">
                          Désactivé
                        </Pill>
                      )}
                      <span className="block text-xs font-normal text-mut">
                        {ROLE_LABEL[t.role]}
                      </span>
                    </th>
                    {days.map((d) => {
                      const cell = dayHours.get(dayKey(t.staffId, d));
                      return (
                        <td
                          key={+d}
                          className="cf-fig px-1.5 py-3 text-right font-semibold text-ink"
                        >
                          {cell && cell.closed > 0 ? (
                            fmtH(cell.closed)
                          ) : cell?.open ? (
                            <span className="text-xs font-bold text-okt">
                              en cours
                            </span>
                          ) : cell ? (
                            "0"
                          ) : (
                            <span className="text-mut" aria-label="aucun pointage">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="cf-fig px-1.5 py-3 text-right font-extrabold text-ink">
                      {fmtH(t.hours)} h
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th
                    scope="row"
                    className="px-1.5 pt-3 text-left text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                  >
                    Total équipe
                  </th>
                  <td colSpan={7} aria-hidden />
                  <td className="cf-fig px-1.5 pt-3 text-right text-[15px] font-extrabold text-accent">
                    {fmtH(weekTotal)} h
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-4 text-[12.5px] text-mut">
          En production : badge par code PIN sur la caisse · heures exportées
          vers la paie · absences justifiées archivées.
        </p>
      </Panel>

      {modal && (
        <MemberModal
          member={modal.mode === "edit" ? modal.member : null}
          onClose={() => setModal(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}

// ─── Carte membre ───

function MemberCard({
  member: m,
  now,
  busy,
  onClock,
  onEdit,
}: {
  member: Member;
  now: number;
  busy: boolean;
  onClock: (direction: "in" | "out") => void;
  onEdit: () => void;
}) {
  return (
    <Card flat className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div
          className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-lg font-extrabold text-onaccent"
          aria-hidden
        >
          {(m.name.trim()[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink">{m.name}</div>
          <Pill className="mt-1">{ROLE_LABEL[m.role]}</Pill>
        </div>
      </div>

      {m.onDuty ? (
        <p className="flex items-center gap-2 text-[13.5px] font-bold text-okt">
          <span className="relative flex size-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-ok" />
          </span>
          En poste · arrivé il y a {sinceLabel(m.onDuty.clockIn, now)}
        </p>
      ) : (
        <p className="text-[13.5px] text-mut">
          {m.lastClockOut && sameDay(new Date(m.lastClockOut), new Date(now))
            ? `Parti à ${hhmm(m.lastClockOut)}`
            : "Hors service"}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        {m.onDuty ? (
          <Btn
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onClock("out")}
          >
            Badger le départ
          </Btn>
        ) : (
          <Btn
            variant="ink"
            size="sm"
            disabled={busy}
            onClick={() => onClock("in")}
          >
            Badger l&apos;arrivée
          </Btn>
        )}
        <IconBtn
          icon="edit"
          label={`Éditer ${m.name}`}
          size={34}
          iconSize={15}
          onClick={onEdit}
        />
      </div>
    </Card>
  );
}

// ─── Modale ajout / édition ───

function MemberModal({
  member,
  onClose,
  onDone,
}: {
  /** null = ajout. */
  member: Member | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const isEdit = member != null;

  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState<StaffRole>(member?.role ?? "caisse");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    pin?: string;
    pin2?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Nom requis";
    if (!isEdit || pin || pin2) {
      if (!PIN_RE.test(pin)) errs.pin = "PIN : 4 à 6 chiffres";
      else if (pin2 !== pin) errs.pin2 = "Les deux PIN ne correspondent pas";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    try {
      if (isEdit) {
        const body: Record<string, unknown> = { name: name.trim(), role };
        if (pin) body.pin = pin;
        await api.patch(`/staff/${member._id}`, body);
        toast("Modifications enregistrées", { icon: "check" });
      } else {
        await api.post("/staff", { name: name.trim(), role, pin });
        toast("Membre ajouté", { icon: "check" });
      }
      onClose();
      await onDone();
    } catch (err) {
      // 409 : PIN déjà utilisé dans le tenant (unicité vérifiée côté API)
      if (err instanceof ApiError && err.status === 409)
        setErrors({ pin: err.message });
      else
        toast(
          err instanceof Error
            ? err.message
            : "Enregistrement impossible — réessayez",
        );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Rendre un équipier au service — et son code avec lui.
   *
   * `PATCH /staff/:id { active: true }` était accepté par l'API depuis
   * toujours, et aucun écran ne l'appelait : une désactivation était donc
   * définitive côté back-office, et le PIN de la personne restait réservé à un
   * membre devenu invisible.
   */
  async function reactiver() {
    if (!member) return;
    setSaving(true);
    try {
      await api.patch(`/staff/${member._id}`, { active: true });
      toast(`${member.name} est de nouveau au service`, { icon: "check" });
      onClose();
      await onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Réactivation impossible — réessayez");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!member) return;
    setSaving(true);
    try {
      await api.del(`/staff/${member._id}`); // suppression douce (active=false)
      toast(`Membre désactivé — ${member.name}`, { icon: "check" });
      onClose();
      await onDone();
    } catch (err) {
      toast(
        err instanceof Error
          ? err.message
          : "Désactivation impossible — réessayez",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Éditer le membre" : "Ajouter un membre"}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nom" htmlFor="member-name" error={errors.name}>
          <Input
            id="member-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prénom Nom"
            maxLength={80}
            autoFocus
          />
        </Field>

        <Field label="Rôle" htmlFor="member-role">
          <Select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
          >
            <option value="gerant">Gérant</option>
            <option value="caisse">Caisse</option>
            <option value="cuisine">Cuisine</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={isEdit ? "Nouveau PIN" : "Code PIN"}
            htmlFor="member-pin"
            hint={
              isEdit
                ? "Laisser vide pour conserver le PIN actuel"
                : "4 à 6 chiffres — badge caisse"
            }
            error={errors.pin}
          >
            <Input
              id="member-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </Field>
          <Field label="Confirmation" htmlFor="member-pin2" error={errors.pin2}>
            <Input
              id="member-pin2"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
          </Field>
        </div>

        {/*
          RÉACTIVER — le chemin qui n'existait pas.
          `StaffUpdateSchema` accepte `active: true` depuis toujours ; aucun
          écran ne l'envoyait, si bien qu'une désactivation était définitive et
          que le code de la personne restait réservé à un membre invisible.
        */}
        {isEdit && member && !member.active && (
          <div className="rounded-ctrl border border-ok/25 bg-ok/8 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-mut">
                <strong className="text-ink">{member.name}</strong> est désactivé — il ne
                pointe plus et n&apos;apparaît pas au planning.
              </p>
              <Btn
                variant="ink"
                size="sm"
                icon="check"
                disabled={saving}
                onClick={() => void reactiver()}
              >
                Réactiver
              </Btn>
            </div>
          </div>
        )}

        {isEdit && member?.active !== false && (
          <div className="rounded-ctrl border border-white/8 bg-[image:var(--cf-elev-gradient)] p-3">
            {confirmOff ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-bold text-alertt">
                  Désactiver {member.name} ? Son PIN et son badge seront
                  refusés.
                </p>
                <div className="flex gap-2">
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmOff(false)}
                    disabled={saving}
                  >
                    Annuler
                  </Btn>
                  <Btn
                    variant="ink"
                    size="sm"
                    className="text-alertt"
                    onClick={() => void deactivate()}
                    disabled={saving}
                  >
                    Confirmer la désactivation
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-mut">
                  L&apos;historique de pointage est conservé.
                </p>
                <Btn
                  variant="ghost"
                  size="sm"
                  className="border-alert/40 text-alertt hover:bg-alert/10"
                  onClick={() => setConfirmOff(true)}
                  disabled={saving}
                >
                  Désactiver le membre
                </Btn>
              </div>
            )}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Btn>
          <Btn type="submit" size="sm" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// ─── Bloc erreur + retry ───

function ErrorBlock({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-alertt" role="alert">
        {msg}
      </p>
      <Btn variant="ghost" size="sm" onClick={onRetry}>
        Réessayer
      </Btn>
    </div>
  );
}
