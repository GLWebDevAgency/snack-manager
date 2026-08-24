"use client";

/**
 * Pièces communes au back-office interne : pastilles d'étape et de santé,
 * tiroir latéral de la surface, fiche lead, création de lead.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  CLIENT_HEALTH_LABELS,
  LEAD_PIPELINE,
  LEAD_SEQUENCE_LABELS,
  LEAD_SEQUENCE_STEPS,
  LEAD_SEQUENCES,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
  LEAD_TOUCH_LABELS,
  LEAD_TOUCH_TYPES,
  PLAN_LABELS,
  PLANS,
  PROPOSAL_BILLINGS,
  PROPOSAL_BILLING_LABELS,
  nextLeadStage,
  previousLeadStage,
  proposalCents,
  yearlyCents,
  type CrmClientHealth,
  type CrmLead,
  type LeadConversion,
  type LeadSequence,
  type LeadStage,
  type LeadTouchType,
  type LeadUpdate,
  type ProposalBilling,
} from "@sm/contracts";
import { csvDownload } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro, timeAgo } from "@/lib/format";
import {
  Btn,
  Field,
  Icon,
  IconBtn,
  Input,
  Select,
  Textarea,
  Toggle,
  useToast,
} from "@/components/ui";
import { crm, fmtDay, useHq } from "./crm";

// ─── Pastilles ───

/**
 * Couleur d'étape : une PROGRESSION, pas six couleurs sémantiques.
 * Neutre au départ, ambre quand ça attend une action datée, laiton au moment
 * qui compte (la proposition), vert quand c'est signé, rouge quand c'est
 * perdu — les fonctionnelles gardent leur sens habituel (DA §3).
 */
const STAGE_STYLE: Record<LeadStage, string> = {
  nouveau: "border-white/20 bg-white/6 text-mut",
  contacte: "border-white/35 bg-white/10 text-white",
  demo: "border-prep/50 bg-prep/12 text-prept",
  proposition: "border-accent/50 bg-accent/12 text-accent",
  signe: "border-ok/50 bg-ok/14 text-okt",
  perdu: "border-alert/45 bg-alert/10 text-alertt",
};

export function StagePill({
  stage,
  className,
}: {
  stage: LeadStage;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        STAGE_STYLE[stage],
        className,
      )}
    >
      {LEAD_STAGE_LABELS[stage]}
    </span>
  );
}

const HEALTH_STYLE: Record<CrmClientHealth, string> = {
  ok: "border-ok/55 text-okt",
  attention: "border-prep/55 text-prept",
  risque: "border-alert/70 text-alertt",
};

const HEALTH_DOT: Record<CrmClientHealth, string> = {
  ok: "bg-ok",
  attention: "bg-prep",
  risque: "bg-alert",
};

export function HealthPill({
  health,
  className,
}: {
  health: CrmClientHealth;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border-[1.5px] bg-transparent px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        HEALTH_STYLE[health],
        className,
      )}
    >
      <span
        className={cx(
          "size-[7px] rounded-full",
          HEALTH_DOT[health],
          // Un client qui décroche doit se voir sans être cherché (DA §7).
          health === "risque" && "animate-pulse",
        )}
        aria-hidden
      />
      {CLIENT_HEALTH_LABELS[health]}
    </span>
  );
}

/** Intitulé de section : 11px, 600, capitales, .06em (DA §2). */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-mut",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Tiroir de la surface ───

/**
 * Tiroir latéral local plutôt que celui du design system : ce dernier laisse
 * volontairement dépasser le rail de 66px du back-office restaurant, alors que
 * la colonne interne en fait 232 — le voile aurait couvert la moitié de la
 * navigation, ce qui se lit comme un défaut d'alignement. Mêmes animations,
 * mêmes surfaces, même ombre.
 */
export function HqDrawer({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Fiche"}
    >
      <div
        className="absolute inset-0 animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-y-0 right-0 flex max-w-full animate-[cf-slide-in_.28s_var(--sm-ease)_both] flex-col rounded-l-panel bg-[image:var(--cf-card-gradient)] shadow-[var(--cf-shadow-drawer)]"
        style={{ width }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line2 px-[18px] py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-[-0.03em] text-ink">
              {title}
            </h2>
            {sub && <p className="mt-0.5 truncate text-[13px] text-mut">{sub}</p>}
          </div>
          <IconBtn
            icon="close"
            label="Fermer"
            size={32}
            iconSize={16}
            onClick={onClose}
          />
        </div>
        <div className="cf-scroll min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line2 bg-black/25 px-[18px] py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fiche lead ───

export function LeadDrawer({
  lead,
  onClose,
  onChanged,
}: {
  lead: CrmLead | null;
  onClose: () => void;
  /** Remonte le lead à jour : la colonne et les compteurs suivent sans rechargement. */
  onChanged: (lead: CrmLead) => void;
}) {
  const toast = useToast();
  const { reload } = useHq();
  const [busy, setBusy] = useState(false);

  // Brouillon d'édition, re-synchronisé à chaque lead ouvert.
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [touchType, setTouchType] = useState<LeadTouchType>("sms");
  const [touchNote, setTouchNote] = useState("");

  useEffect(() => {
    if (!lead) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- brouillon d'édition : dès que le commercial tape, ces six champs divergent volontairement de `lead` et ne sont plus calculables au rendu. Sans cette resynchronisation à l'ouverture, le tiroir afficherait les coordonnées du lead précédent et un enregistrement écraserait la fiche du nouveau.
    setName(lead.restaurantName);
    setContactName(lead.contact.name);
    setPhone(lead.contact.phone);
    setEmail(lead.contact.email);
    setNotes(lead.notes);
    setTouchNote("");
  }, [lead]);

  if (!lead) return null;

  /**
   * Applique une mutation, remonte le résultat et rafraîchit les compteurs HQ.
   * Renvoie `true` si l'écriture a abouti — le formulaire de relance ne vide
   * son champ que dans ce cas, sinon la saisie serait perdue sur un échec.
   */
  async function run(
    action: () => Promise<CrmLead>,
    message: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const updated = await action();
      onChanged(updated);
      reload();
      toast(message, { icon: "check" });
      return true;
    } catch {
      toast("Enregistrement impossible — réessayez");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    name.trim() !== lead.restaurantName ||
    contactName !== lead.contact.name ||
    phone !== lead.contact.phone ||
    email !== lead.contact.email ||
    notes !== lead.notes;

  function save() {
    const body: LeadUpdate = {};
    if (name.trim() && name.trim() !== lead!.restaurantName) body.restaurantName = name.trim();
    const contact: NonNullable<LeadUpdate["contact"]> = {};
    if (contactName !== lead!.contact.name) contact.name = contactName;
    if (phone !== lead!.contact.phone) contact.phone = phone;
    if (email !== lead!.contact.email) contact.email = email;
    if (Object.keys(contact).length > 0) body.contact = contact;
    if (notes !== lead!.notes) body.notes = notes;
    if (Object.keys(body).length === 0) return;
    void run(() => crm.updateLead(lead!._id, body), "Fiche enregistrée");
  }

  const forward = nextLeadStage(lead.stage);
  const back = previousLeadStage(lead.stage);

  return (
    <HqDrawer
      open
      onClose={onClose}
      title={lead.restaurantName}
      sub={`Créé le ${fmtDay(lead.createdAt)} · ${lead.touches.length} relance${lead.touches.length > 1 ? "s" : ""}`}
      footer={
        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={!dirty || busy}
            onClick={save}
          >
            Enregistrer
          </Btn>
          {lead.contact.phone && (
            <a
              href={`tel:${lead.contact.phone.replace(/\s/g, "")}`}
              className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill bg-btndark px-3.5 py-[9px] text-[13px] font-bold tracking-[-0.01em] text-white hover:bg-[#333]"
            >
              <Icon name="phone" size={15} />
              Appeler
            </a>
          )}
          {lead.contact.email && (
            <a
              href={`mailto:${lead.contact.email}`}
              className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold tracking-[-0.01em] text-white hover:border-white/25 hover:bg-white/8"
            >
              <Icon name="edit" size={15} />
              E-mail
            </a>
          )}
        </div>
      }
    >
      {/* ── Étape ── */}
      <Eyebrow>Étape du pipeline</Eyebrow>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LEAD_STAGES.map((stage) => {
          const on = stage === lead.stage;
          return (
            <button
              key={stage}
              type="button"
              disabled={busy || on}
              aria-pressed={on}
              onClick={() =>
                void run(
                  () => crm.changeStage(lead._id, stage),
                  `${lead.restaurantName} → ${LEAD_STAGE_LABELS[stage]}`,
                )
              }
              className={cx(
                "cf-press rounded-pill border-[1.5px] px-[11px] py-[5px] text-[11px] font-extrabold uppercase tracking-[0.06em] disabled:cursor-default",
                on
                  ? STAGE_STYLE[stage]
                  : "border-transparent bg-white/6 text-mut hover:bg-white/12 hover:text-white",
              )}
            >
              {LEAD_STAGE_LABELS[stage]}
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-2">
        {back && (
          <Btn
            variant="ghost"
            size="sm"
            icon="back"
            disabled={busy}
            onClick={() =>
              void run(
                () => crm.changeStage(lead._id, back),
                `Reculé sur « ${LEAD_STAGE_LABELS[back]} »`,
              )
            }
          >
            {LEAD_STAGE_LABELS[back]}
          </Btn>
        )}
        {forward && (
          <Btn
            variant="ink"
            size="sm"
            iconRight="arrow"
            disabled={busy}
            onClick={() =>
              void run(
                () => crm.changeStage(lead._id, forward),
                `Avancé sur « ${LEAD_STAGE_LABELS[forward]} »`,
              )
            }
          >
            Avancer — {LEAD_STAGE_LABELS[forward]}
          </Btn>
        )}
      </div>

      {lead.stage !== "perdu" && (
        <>
          <Rule />
          <ProposalPanel lead={lead} onChanged={onChanged} />
          <Rule />
          <ConvertPanel lead={lead} onConverted={(updated) => onChanged(updated)} />
        </>
      )}

      <Rule />

      {/* ── Place fondateur ── */}
      <div className="flex items-center gap-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
        <Icon name="star" size={18} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">Place fondateur</div>
          <div className="text-xs text-mut">
            Tarif gelé à vie — 10 places au total
          </div>
        </div>
        <Toggle
          on={lead.founderSeatReserved}
          disabled={busy}
          label="Réserver une place fondateur"
          onChange={(on) =>
            void run(
              () => crm.updateLead(lead._id, { founderSeatReserved: on }),
              on ? "Place fondateur réservée" : "Place fondateur libérée",
            )
          }
        />
      </div>

      <Rule />

      {/* ── Contact ── */}
      <Eyebrow>Contact</Eyebrow>
      <div className="mt-2 flex flex-col gap-3">
        <Field label="Restaurant" htmlFor="lead-name">
          <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Interlocuteur" htmlFor="lead-contact">
            <Input
              id="lead-contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="S. Diallo"
            />
          </Field>
          <Field label="Téléphone" htmlFor="lead-phone">
            <Input
              id="lead-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="06 …"
            />
          </Field>
        </div>
        <Field label="E-mail" htmlFor="lead-email">
          <Input
            id="lead-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@restaurant.fr"
          />
        </Field>
        <Field label="Notes" htmlFor="lead-notes">
          <Textarea
            id="lead-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </Field>
      </div>

      <Rule />

      {/* ── Séquence de relance ── */}
      <Eyebrow>Séquence de relance</Eyebrow>
      <Select
        aria-label="Séquence de relance"
        className="mt-2"
        value={lead.sequence ?? ""}
        disabled={busy}
        onChange={(e) => {
          const value = e.target.value === "" ? null : (e.target.value as LeadSequence);
          void run(
            () => crm.updateLead(lead._id, { sequence: value }),
            value ? `Séquence ${value} activée` : "Séquence retirée",
          );
        }}
      >
        <option value="">Aucune séquence</option>
        {LEAD_SEQUENCES.map((s) => (
          <option key={s} value={s}>
            {LEAD_SEQUENCE_LABELS[s]}
          </option>
        ))}
      </Select>
      {lead.sequence && (
        <ul className="mt-2 flex flex-col gap-1">
          {LEAD_SEQUENCE_STEPS[lead.sequence].map((step) => (
            <li key={step} className="flex gap-2 text-[13px] text-mut">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" aria-hidden />
              {step}
            </li>
          ))}
        </ul>
      )}

      <Rule />

      {/* ── Relances tracées ── */}
      <Eyebrow>Historique des relances</Eyebrow>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          void run(
            () => crm.addTouch(lead._id, { type: touchType, note: touchNote.trim() }),
            "Relance tracée",
          ).then((ok) => {
            if (ok) setTouchNote("");
          });
        }}
      >
        <Select
          aria-label="Canal de la relance"
          className="w-[112px]"
          value={touchType}
          onChange={(e) => setTouchType(e.target.value as LeadTouchType)}
        >
          {LEAD_TOUCH_TYPES.map((t) => (
            <option key={t} value={t}>
              {LEAD_TOUCH_LABELS[t]}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Message de la relance"
          className="min-w-0 flex-1"
          placeholder="A1 — SMS du soir même…"
          value={touchNote}
          onChange={(e) => setTouchNote(e.target.value)}
        />
        <Btn type="submit" variant="ink" size="sm" icon="plus" disabled={busy}>
          Tracer
        </Btn>
      </form>

      {lead.touches.length === 0 ? (
        <p className="mt-3 text-[13px] text-mut">
          Aucune relance tracée. Chaque envoi se note ici : date, canal, message.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col">
          {lead.touches.map((t, i) => (
            <li key={`${t.at}-${i}`} className="flex gap-3">
              {/* Fil vertical : la relance la plus récente en tête. */}
              <div className="flex flex-col items-center">
                <span
                  className={cx(
                    "mt-[6px] size-2 shrink-0 rounded-full",
                    i === 0 ? "bg-accent" : "bg-white/25",
                  )}
                  aria-hidden
                />
                {i < lead.touches.length - 1 && (
                  <span className="w-px flex-1 bg-white/10" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-bold text-ink">
                    {LEAD_TOUCH_LABELS[t.type as LeadTouchType] ?? t.type}
                  </span>
                  <span className="shrink-0 text-xs text-mut" title={fmtDay(t.at)}>
                    {timeAgo(t.at)}
                  </span>
                </div>
                {t.note && (
                  <p className="mt-0.5 text-[13px] leading-[1.4] text-mut">{t.note}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </HqDrawer>
  );
}

function Rule() {
  return <div className="my-4 h-px bg-line" aria-hidden />;
}

// ─── Création de lead ───

export function NewLeadDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: CrmLead) => void;
}) {
  const toast = useToast();
  const { reload } = useHq();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<LeadStage>("nouveau");
  const [founder, setFounder] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remise à zéro d'un formulaire de saisie : les champs viennent de la frappe, rien ne les recalcule. Sans elle, rouvrir « Nouveau lead » après une création réafficherait les valeurs précédentes et créerait un doublon du restaurant qu'on vient d'enregistrer.
    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setStage("nouveau");
    setFounder(false);
  }, [open]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const lead = await crm.createLead({
        restaurantName: name.trim(),
        contact: { name: contactName.trim(), phone: phone.trim(), email: email.trim() },
        stage,
        notes: notes.trim(),
        founderSeatReserved: founder,
      });
      onCreated(lead);
      reload();
      toast(`${lead.restaurantName} entre au pipeline`, { icon: "check" });
      onClose();
    } catch {
      toast("Création impossible — vérifiez l'e-mail saisi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <HqDrawer
      open={open}
      onClose={onClose}
      title="Nouveau lead"
      sub="Un prospect entre au pipeline"
      footer={
        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={!name.trim() || busy}
            onClick={() => void create()}
          >
            {busy ? "Création…" : "Créer le lead"}
          </Btn>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Btn>
        </div>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Restaurant" htmlFor="new-name">
          <Input
            id="new-name"
            required
            autoFocus
            placeholder="Chick & Go"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Interlocuteur" htmlFor="new-contact">
            <Input
              id="new-contact"
              placeholder="S. Diallo"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </Field>
          <Field label="Téléphone" htmlFor="new-phone">
            <Input
              id="new-phone"
              placeholder="06 …"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <Field label="E-mail" htmlFor="new-email">
          <Input
            id="new-email"
            type="email"
            placeholder="contact@restaurant.fr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Étape de départ" htmlFor="new-stage">
          <Select
            id="new-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as LeadStage)}
          >
            {LEAD_PIPELINE.map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Notes"
          htmlFor="new-notes"
          hint="Ville, contexte, ce qui a été dit — c'est ce qu'on relit avant de rappeler."
        >
          <Textarea
            id="new-notes"
            rows={3}
            placeholder="Louviers — vu l'Instagram, veut une démo rapide."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
          <Icon name="star" size={18} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1 text-sm font-bold text-ink">
            Réserver une place fondateur
          </div>
          <Toggle
            on={founder}
            label="Réserver une place fondateur"
            onChange={setFounder}
          />
        </div>
        {/* Soumission au clavier (Entrée) sans bouton visible en double. */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Créer le lead
        </button>
      </form>
    </HqDrawer>
  );
}

/* ── Signer : le lead devient un restaurant ─────────────────── */

/** « chez-nicolas » depuis « Chez Nicolas » — proposition, jamais imposition. */
function slugifie(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Le geste qui remplaçait des écritures Mongo à la main : tenant, compte
 * gérant, place fondateur, échéance d'essai — et un mot de passe affiché UNE
 * fois, à noter pendant qu'il est à l'écran. Fermer le panneau ne le
 * réaffichera pas : c'est le contrat de `LeadConversion`.
 */
/** Le chiffrage d'une proposition, en une phrase — toujours dérivé de la grille. */
function phrasePrix(p: { plan: (typeof PLANS)[number]; onlineOrdering: boolean; billing: ProposalBilling }): string {
  const { monthlyCents, setupOnceCents } = proposalCents(p);
  const mois = `${fmtEuro(monthlyCents)}/mois`;
  const setup = setupOnceCents > 0 ? ` · mise en service ${fmtEuro(setupOnceCents)} (une fois)` : "";
  const annee = p.billing === "annuel" ? ` · soit ${fmtEuro(yearlyCents(monthlyCents))} l'année (deux mois offerts)` : "";
  return mois + setup + annee;
}

/**
 * LA PROPOSITION SUR LA TABLE — le maillon qui manquait entre « Proposition »
 * et « Signé » : l'étape disait qu'une offre existait, jamais laquelle. Posée
 * ici, elle s'affiche sur la carte du pipeline, se relit à chaque appel, et
 * pré-remplit le panneau de signature.
 */
function ProposalPanel({
  lead,
  onChanged,
}: {
  lead: CrmLead;
  onChanged: (lead: CrmLead) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [plan, setPlan] = useState<(typeof PLANS)[number]>("essentiel");
  const [module, setModule] = useState(false);
  const [billing, setBilling] = useState<ProposalBilling>("mensuel");
  const [note, setNote] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- brouillon de formulaire, re-synchronisé à chaque lead ouvert : mêmes raisons que le brouillon d'édition du tiroir.
    setPlan(lead.proposal?.plan ?? "complet");
    setModule(lead.proposal?.onlineOrdering ?? false);
    setBilling(lead.proposal?.billing ?? "mensuel");
    setNote(lead.proposal?.note ?? "");
    setEdit(false);
  }, [lead]);

  async function poser() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await crm.updateLead(lead._id, {
        proposal: { plan, onlineOrdering: module, billing, note: note.trim() },
      });
      onChanged(updated);
      setEdit(false);
      toast("Proposition posée — elle pré-remplira la signature", { icon: "check" });
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setBusy(false);
    }
  }

  if (lead.proposal && !edit) {
    const p = lead.proposal;
    return (
      <div className="rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Eyebrow>Proposition</Eyebrow>
          <span className="cf-fig shrink-0 text-[11px] text-mut">
            posée le {new Date(p.at).toLocaleDateString("fr-FR")}
          </span>
        </div>
        <div className="mt-1 text-sm font-bold text-ink">
          {PLAN_LABELS[p.plan]}
          {p.plan === "boost"
            ? " — commande en ligne comprise"
            : p.onlineOrdering
              ? " + commande en ligne"
              : ""}
          {" · "}
          {PROPOSAL_BILLING_LABELS[p.billing]}
        </div>
        <div className="mt-0.5 text-xs text-mut">{phrasePrix(p)}</div>
        {p.note && <p className="mt-1.5 text-xs italic text-mut">« {p.note} »</p>}
        <div className="mt-2 flex items-center gap-2">
          <Btn
            variant="ink"
            size="sm"
            icon="print"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // La note interne ne s'imprime pas — le PDF ne porte que l'offre.
              // Le nom est FORCÉ en .pdf : le repli de `csvDownload` (deviner
              // depuis l'URL) fabriquait un « devis.csv » avec des octets PDF
              // dedans quand Content-Disposition n'était pas exposé.
              csvDownload(`/crm/leads/${lead._id}/devis`, `devis-${slugifie(lead.restaurantName)}.pdf`)
                .then(() => toast("Devis téléchargé — à envoyer au prospect", { icon: "check" }))
                .catch(() => toast("Devis indisponible — réessayez"))
                .finally(() => setBusy(false));
            }}
          >
            Devis PDF
          </Btn>
          <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setEdit(true)}>
            Modifier
          </Btn>
        </div>
      </div>
    );
  }

  if (!lead.proposal && !edit) {
    return (
      <Btn variant="ghost" size="sm" icon="euro" onClick={() => setEdit(true)}>
        Poser la proposition — plan, module, engagement
      </Btn>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-white/12 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void poser();
      }}
    >
      <Eyebrow>La proposition</Eyebrow>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Formule" htmlFor="prop-plan">
          <Select
            id="prop-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as (typeof PLANS)[number])}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Engagement" htmlFor="prop-billing">
          <Select
            id="prop-billing"
            value={billing}
            onChange={(e) => setBilling(e.target.value as ProposalBilling)}
          >
            {PROPOSAL_BILLINGS.map((b) => (
              <option key={b} value={b}>
                {PROPOSAL_BILLING_LABELS[b]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs text-mut">
          {plan === "boost"
            ? "Commande en ligne comprise dans Boost — rien à ajouter."
            : "Module commande en ligne — 79 €/mois, mise en service 55 €."}
        </div>
        {plan !== "boost" && (
          <Toggle on={module} label="Module commande en ligne" onChange={setModule} />
        )}
      </div>
      <Field label="Note (ce qui s'est dit)" htmlFor="prop-note">
        <Input
          id="prop-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="attend son associé, veut démarrer en septembre…"
        />
      </Field>
      <div className="text-xs font-semibold text-accent">
        {phrasePrix({ plan, onlineOrdering: module, billing })}
      </div>
      <div className="flex gap-2">
        <Btn type="submit" variant="ink" size="sm" disabled={busy}>
          {busy ? "Enregistrement…" : lead.proposal ? "Mettre à jour" : "Poser la proposition"}
        </Btn>
        <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setEdit(false)}>
          Annuler
        </Btn>
      </div>
    </form>
  );
}

function ConvertPanel({
  lead,
  onConverted,
}: {
  lead: CrmLead;
  onConverted: (lead: CrmLead) => void;
}) {
  const toast = useToast();
  const { reload } = useHq();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<LeadConversion | null>(null);

  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [plan, setPlan] = useState<(typeof PLANS)[number]>("essentiel");
  const [founderSeat, setFounderSeat] = useState(false);
  const [onlineOrdering, setOnlineOrdering] = useState(false);
  const [billing, setBilling] = useState<ProposalBilling>("mensuel");

  // Re-proposé à chaque lead ouvert — un tiroir réutilisé ne doit pas garder
  // le slug du restaurant précédent. Les termes partent de la PROPOSITION :
  // ce qui a été négocié n'a pas à se re-saisir, seulement à se confirmer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- brouillon de formulaire : mêmes raisons que le brouillon d'édition du tiroir.
    setSlug(slugifie(lead.restaurantName));
    setOwnerEmail(lead.contact.email);
    setOwnerName(lead.contact.name);
    setFounderSeat(lead.founderSeatReserved);
    setPlan(lead.proposal?.plan ?? "essentiel");
    setOnlineOrdering(lead.proposal?.onlineOrdering ?? false);
    setBilling(lead.proposal?.billing ?? "mensuel");
    setFait(null);
    setErreur(null);
    setOpen(false);
  }, [lead]);

  async function signer() {
    setBusy(true);
    setErreur(null);
    try {
      const done = await crm.convertLead(lead._id, {
        slug,
        ownerEmail,
        ownerName,
        plan,
        founderSeat,
        onlineOrdering,
        billing,
      });
      setFait(done);
      // Le lead local suit ce que l'API vient d'écrire : signé, réservation
      // éteinte (la place vit désormais sur le restaurant).
      onConverted({ ...lead, stage: "signe", founderSeatReserved: false });
      reload();
      toast(`« ${done.name} » est né — notez le mot de passe`, { icon: "check" });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Création impossible — réessayez");
    } finally {
      setBusy(false);
    }
  }

  if (fait) {
    return (
      <div className="rounded-card border border-accent/40 bg-[image:var(--cf-elev-gradient)] p-4">
        <div className="text-sm font-bold text-ink">Restaurant créé — notez le mot de passe</div>
        <div className="mt-1 text-xs text-mut">
          Il ne sera JAMAIS réaffiché. Compte gérant : {fait.ownerEmail} · essai jusqu&apos;au{" "}
          {new Date(fait.trialEndsAt).toLocaleDateString("fr-FR")}.
        </div>
        <div className="mt-1 text-xs text-mut">
          {fait.draftInvoices > 0
            ? `${fait.draftInvoices} brouillon${fait.draftInvoices > 1 ? "s" : ""} de facture posé${fait.draftInvoices > 1 ? "s" : ""} dans Facturation — à émettre à la fin de l'essai.`
            : "Aucun brouillon de facture posé — préparez-les dans Facturation."}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <code className="rounded-ctrl border border-white/12 bg-white/6 px-3 py-2 text-[17px] font-bold tracking-[0.08em] text-accent">
            {fait.password}
          </code>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(fait.password)
                .then(() => toast("Mot de passe copié", { icon: "check" }));
            }}
          >
            Copier
          </Btn>
        </div>
        <div className="mt-3">
          <a
            className="text-xs font-semibold text-mut underline-offset-2 hover:text-white hover:underline"
            href={`/sm/clients/${fait.tenantId}`}
          >
            Ouvrir la fiche client →
          </a>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <Btn variant="ink" size="sm" icon="star" onClick={() => setOpen(true)}>
        Signé ? Créer le restaurant
      </Btn>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-white/12 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void signer();
      }}
    >
      <Eyebrow>Créer le restaurant</Eyebrow>
      <Field label="Slug (l'adresse publique)" htmlFor="convert-slug">
        <Input
          id="convert-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="chez-nicolas"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="E-mail du gérant" htmlFor="convert-email">
          <Input
            id="convert-email"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Nom du gérant" htmlFor="convert-name">
          <Input
            id="convert-name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Formule" htmlFor="convert-plan">
        <Select
          id="convert-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as (typeof PLANS)[number])}
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs text-mut">
          Place fondateur — le tarif gelé suit le restaurant, plus le pipeline.
        </div>
        <Toggle on={founderSeat} label="Place fondateur" onChange={setFounderSeat} />
      </div>
      {erreur && <div className="text-xs font-semibold text-alertt">{erreur}</div>}
      <div className="flex gap-2">
        <Btn type="submit" variant="ink" size="sm" disabled={busy || !slug || !ownerEmail}>
          {busy ? "Création…" : "Créer — mot de passe remis une fois"}
        </Btn>
        <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </Btn>
      </div>
    </form>
  );
}
