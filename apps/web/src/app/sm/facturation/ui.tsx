"use client";

/**
 * LES PIÈCES DE L'ÉCRAN DE FACTURATION.
 *
 * Rien ici n'est décoratif. Chaque composant sert à repérer une information
 * SANS LA LIRE (DA §7) : l'ancienneté d'une créance en gros chiffre coloré, un
 * compte déjà suspendu à sa pastille rouge, le geste à poser écrit sous le
 * nombre de jours. Les couleurs fonctionnelles gardent leur sens (rouge =
 * retard, ambre = à surveiller) et l'accent laiton reste réservé aux totaux et
 * aux actions primaires (DA §3).
 *
 * Les pastilles sont REDÉFINIES ici plutôt qu'importées de `../clients/ui` :
 * cette surface et le poste de pilotage client s'écrivent en parallèle, et une
 * dépendance croisée entre deux répertoires en cours d'écriture se paie en
 * ruptures de compilation à chaque itération de l'autre. Le langage visuel, lui,
 * est identique au trait près — mêmes classes, mêmes seuils.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import {
  Btn,
  Card,
  Field,
  Icon,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
  type IconName,
} from "@/components/ui";
import {
  DEFAULT_PAYMENT_METHOD,
  DEFAULT_REMINDER_CHANNEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  REMINDER_CHANNELS,
  REMINDER_CHANNEL_LABELS,
  billingApi,
  errText,
  euros,
  fmtDays,
  fmtDueDate,
  fmtReminderAge,
  paidAtIso,
  recoveryStep,
  todayInput,
  type InvoicePaymentMethod,
  type InvoiceReminderChannel,
  type OverdueRow,
  type Tone,
} from "./data";

// ─────────────────────────────────────────────────────────────
// Tons
// ─────────────────────────────────────────────────────────────

const TONE_TEXT: Record<Tone, string> = {
  alert: "text-alertt",
  prep: "text-prept",
  mut: "text-mut",
};

const TONE_CARD: Record<Tone, string> = {
  alert: "border-alert/45 bg-alert/8",
  prep: "border-prep/40 bg-prep/6",
  mut: "",
};

// ─────────────────────────────────────────────────────────────
// Chiffres de tête
// ─────────────────────────────────────────────────────────────

/**
 * CARTE DE CHIFFRE — même anatomie que le `Kpi` du design system (spec §4.9 :
 * intitulé 11 px capitales, valeur 30 px tabulaire, tuile d'icône 34 px), avec
 * deux choses que celui-ci ne porte pas et dont cet écran a besoin :
 *
 *  · un TON, parce que « 65 jours de retard » doit teinter sa carte — c'est le
 *    seul chiffre de l'écran qui déclenche un geste ;
 *  · une ligne d'appui en gris, à la place du delta fléché du DS. Un ▲ vert à
 *    côté d'une ancienneté serait un contresens : les jours de retard qui
 *    montent ne sont pas une bonne nouvelle, et une flèche détournée de son sens
 *    apprend à ne plus la lire (DA §3).
 */
export function BillingKpi({
  label,
  value,
  hint,
  icon,
  tone = "mut",
  title,
}: {
  label: string;
  value: ReactNode;
  /** Ce que le chiffre veut dire, ou d'où il vient. */
  hint?: ReactNode;
  icon?: IconName;
  tone?: Tone;
  /** Infobulle — la définition exacte du chiffre, pour qui la cherche. */
  title?: string;
}) {
  return (
    // `basis` + `flex-wrap` côté bande : à quatre chiffres, la rangée devient
    // illisible sous ~1100 px (« TOTAL DÛ » se coupe en trois lignes). Deux
    // rangées de deux valent mieux qu'une rangée de quatre écrasés — DA §7,
    // l'information utile ne descend pas sous 13 px.
    <Card
      className={cx("min-w-[184px] flex-1 basis-[184px] p-[18px]", TONE_CARD[tone])}
      title={title}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
          {label}
        </div>
        {icon && (
          <div
            className={cx(
              "grid size-[34px] shrink-0 place-items-center rounded-ctrl border border-white/6 bg-[image:var(--cf-elev-gradient)]",
              tone === "mut" ? "text-accent" : TONE_TEXT[tone],
            )}
            aria-hidden
          >
            <Icon name={icon} size={18} />
          </div>
        )}
      </div>
      <div
        className={cx(
          "cf-fig mt-2 text-[30px] font-extrabold leading-[1.1]",
          tone === "mut" ? "text-ink" : TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {hint && (
        <div
          className={cx(
            "mt-1 text-[13px] font-semibold",
            tone === "mut" ? "text-mut" : TONE_TEXT[tone],
          )}
        >
          {hint}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Pastilles
// ─────────────────────────────────────────────────────────────

const PLAN_STYLE: Record<string, string> = {
  essentiel: "border-white/20 bg-white/6 text-mut",
  complet: "border-accent/50 bg-accent/12 text-accent",
  boost: "border-accent/50 bg-accent/12 text-accent",
};

export function PlanPill({ plan, label }: { plan: string | null; label: string }) {
  if (!label) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        PLAN_STYLE[plan ?? ""] ?? "border-white/20 bg-white/6 text-mut",
      )}
    >
      {label}
    </span>
  );
}

/**
 * Un compte ACTIF est l'état normal : il se lit sans couleur, sinon la couleur
 * ne veut plus rien dire quand elle apparaît (DA §3). Le seul statut qui doit
 * sauter aux yeux dans cette file est « suspendu » — il change le geste : on
 * n'appelle pas pour relancer, on appelle pour rouvrir contre paiement.
 */
const ACCOUNT_STYLE: Record<string, string> = {
  active: "border-white/20 bg-white/6 text-mut",
  trial: "border-prep/50 bg-prep/12 text-prept",
  suspended: "border-alert/70 bg-alert/12 text-alertt",
  churned: "border-white/12 bg-transparent text-mut/70",
};

export function AccountPill({
  status,
  label,
}: {
  status: string | null;
  label: string;
}) {
  if (!label) {
    return (
      <span
        className="text-[11px] text-mut/60"
        title="Statut de compte non renvoyé par l'API"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        ACCOUNT_STYLE[status ?? ""] ?? "border-white/20 bg-white/6 text-mut",
      )}
    >
      {status === "suspended" && (
        <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-alert" aria-hidden />
      )}
      {label}
    </span>
  );
}

/**
 * Section dont la route n'a pas répondu.
 *
 * « Pas encore branché » et « rien à réclamer » ne se confondent pas : annoncer
 * un parc à jour parce que la route des impayés est tombée, c'est rater une
 * suspension. D'où un état explicite, jamais un vide.
 */
export function Unavailable({
  title = "Donnée indisponible",
  hint,
  icon = "bell",
}: {
  title?: string;
  hint?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-card border border-dashed border-white/12 bg-white/3 p-3">
      <Icon name={icon} size={16} className="mt-px shrink-0 text-mut" />
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-mut">{title}</div>
        {hint && <div className="mt-0.5 text-xs text-mut/80">{hint}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Une ligne de la file
// ─────────────────────────────────────────────────────────────

/**
 * UNE LIGNE = UNE CRÉANCE, et le geste qu'elle appelle.
 *
 * Ordre de lecture imposé de gauche à droite : DEPUIS QUAND (le chiffre qui
 * décide), QUI (le client, sa formule, l'état de son compte), QUOI (la pièce),
 * COMBIEN, puis les gestes. La ligne n'est pas un lien — elle porte des
 * boutons, et un lien qui enveloppe des boutons finit par ouvrir une fiche
 * quand on voulait encaisser. Le nom du client, lui, l'est.
 *
 * Sous le geste que l'échelle impose, la ligne dit ce qui a DÉJÀ été fait :
 * « relancé il y a 2 j ». C'est ce qui évite que deux personnes rappellent le
 * même gérant à un jour d'écart — et rien ne s'affiche tant qu'aucune relance
 * n'existe, une mention « jamais relancé » sur chaque ligne ne guiderait plus.
 */
export function OverdueLine({
  row,
  onRemind,
  onPay,
  onCancel,
}: {
  row: OverdueRow;
  onRemind: (row: OverdueRow) => void;
  onPay: (row: OverdueRow) => void;
  onCancel: (row: OverdueRow) => void;
}) {
  const step = recoveryStep(row.overdueDays);
  const tone: Tone = step?.tone ?? "mut";
  const reminded = fmtReminderAge(row.lastReminderAt);

  return (
    <li
      className={cx(
        "flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-line px-[18px] py-3",
        tone === "alert" && "bg-alert/6",
      )}
    >
      {/* ── Depuis quand : le chiffre qui décide — et ce qui a déjà été fait ── */}
      <div className="flex w-[104px] shrink-0 flex-col">
        <span className={cx("cf-fig text-[22px] font-extrabold leading-none", TONE_TEXT[tone])}>
          {fmtDays(row.overdueDays)}
          <span className="sr-only"> de retard</span>
        </span>
        <span className={cx("mt-1 text-[11px] font-bold leading-tight", TONE_TEXT[tone])}>
          {step?.geste ?? "À surveiller"}
        </span>
        {reminded && (
          <span
            className="mt-1 text-[11px] font-semibold leading-tight text-mut"
            title={
              `Dernière relance : ${row.lastReminderChannelLabel || "canal inconnu"}` +
              (row.reminderCount > 1 ? ` — ${row.reminderCount} relances au total` : "")
            }
          >
            {reminded}
          </span>
        )}
      </div>

      {/* ── Qui ── */}
      <div className="min-w-[188px] flex-1 basis-[188px]">
        <Link
          href={`/sm/clients/${row.tenantId}`}
          className="cf-press-row inline-flex max-w-full items-center gap-1.5 truncate text-[14px] font-bold text-ink hover:text-accent"
          title={`Ouvrir la fiche de ${row.tenantName}`}
        >
          <span className="truncate">{row.tenantName}</span>
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PlanPill plan={row.plan} label={row.planLabel} />
          <AccountPill status={row.accountStatus} label={row.accountStatusLabel} />
        </div>
        {row.tenantInvoices > 1 && (
          <div className="mt-1 text-[11.5px] font-semibold text-prept">
            {row.rank}<sup>e</sup> des {row.tenantInvoices} impayées de ce client —{" "}
            <span className="cf-fig">{euros(row.tenantDueCents)}</span> au total
          </div>
        )}
      </div>

      {/* ── Quoi ── */}
      <div className="min-w-[204px] flex-1 basis-[204px]">
        <div className="cf-fig truncate text-[13px] font-bold text-ink" title={row.number}>
          {row.number}
          {/* L'espace est DANS le texte, pas seulement dans la marge : une
              synthèse vocale lit « SM-2026-0007· Autre » d'une traite sinon. */}
          {row.kindLabel && (
            <span className="font-semibold text-mut"> · {row.kindLabel}</span>
          )}
        </div>
        <div className="truncate text-xs text-mut">
          {row.periodLabel && <>{row.periodLabel} · </>}
          échue le <span className="cf-fig">{fmtDueDate(row.dueAt)}</span>
        </div>
        {row.label && (
          <div className="truncate text-xs text-mut/80" title={row.label}>
            {row.label}
          </div>
        )}
      </div>

      {/* ── Combien ── */}
      <div className="cf-fig w-[96px] shrink-0 text-right text-[15px] font-extrabold text-ink">
        {row.amountLabel}
      </div>

      {/* ── Les gestes, et la sortie ── */}
      <div className="flex shrink-0 items-center gap-2">
        {/* La relance d'abord : c'est le geste de l'échelle, celui qu'on vient
            de faire au téléphone — l'encaissement n'arrive qu'après. */}
        <Btn variant="ghost" size="sm" icon="phone" onClick={() => onRemind(row)}>
          Relance faite
        </Btn>
        <Btn variant="ink" size="sm" icon="euro" onClick={() => onPay(row)}>
          Encaisser
        </Btn>
        <Btn
          variant="ghost"
          size="sm"
          icon="close"
          className="border-alert/40 text-alertt hover:border-alert hover:bg-alert/12"
          onClick={() => onCancel(row)}
        >
          Annuler
        </Btn>
        <Link
          href={`/sm/clients/${row.tenantId}`}
          className="cf-press inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-[9px] text-[13px] font-bold text-accent hover:underline"
        >
          Fiche
          <Icon name="arrow" size={15} />
        </Link>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
// Les gestes
// ─────────────────────────────────────────────────────────────

/**
 * Ces modales ne portent pas de prop `open` : la page ne les monte que
 * lorsqu'elle les ouvre. Un formulaire vidé par un effet au changement de
 * `open` est un formulaire qui se vide un rendu trop tard ; le montage
 * conditionnel donne un brouillon neuf par construction.
 */
type GestureProps = {
  row: OverdueRow;
  onClose: () => void;
  /** Rechargement de la file après une écriture réussie. */
  onDone: () => void;
};

/**
 * LE REFUS DE L'API, AFFICHÉ TEL QUEL.
 *
 * « La facture SM-2026-0002 est réglée : elle se corrige par un avoir, pas par
 * une annulation. » — cette phrase est mieux écrite que tout ce qu'on
 * reformulerait ici, et elle apprend le geste juste. Elle reste À L'ÉCRAN, dans
 * la modale, plutôt que de partir avec un toast de 2,2 s : un refus de conflit
 * arrive quand deux personnes travaillent sur la même pièce, c'est-à-dire au
 * moment précis où l'on a besoin de relire.
 */
function Refusal({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2.5 rounded-card border border-alert/50 bg-alert/10 p-3"
    >
      <Icon name="bell" size={16} className="mt-px shrink-0 text-alertt" />
      <p className="min-w-0 text-[13px] font-semibold leading-[1.45] text-alertt">
        {message}
      </p>
    </div>
  );
}

/** Rappel de la pièce sur laquelle on agit — jamais de geste à l'aveugle. */
function InvoiceRecap({ row }: { row: OverdueRow }) {
  return (
    <div className="rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cf-fig min-w-0 truncate text-[13px] font-bold text-ink">
          {row.number}
        </span>
        <span className="cf-fig shrink-0 text-lg font-extrabold text-accent">
          {row.amountLabel}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-mut">
        {row.tenantName}
        {row.periodLabel && ` · ${row.periodLabel}`} · échue le{" "}
        <span className="cf-fig">{fmtDueDate(row.dueAt)}</span> ·{" "}
        <span className="cf-fig font-bold text-alertt">
          {fmtDays(row.overdueDays)} de retard
        </span>
      </div>
      {row.label && <div className="mt-1 text-xs text-mut/80">{row.label}</div>}
    </div>
  );
}

/**
 * RELANCE FAITE.
 *
 * On TRACE un geste déjà accompli — l'appel vient d'être passé, le courrier
 * vient de partir. Rien ne part vers le client depuis cette modale : c'est le
 * registre qu'on met à jour, sur la pièce et au journal, sous le compte de
 * l'opérateur. Sans cette trace, l'échelle affichée à gauche (« rappeler à
 * J+8, relancer par écrit à J+15 ») restait un conseil : personne ne savait où
 * l'on en était, et deux personnes rappelaient le même gérant à un jour
 * d'écart.
 *
 * Le canal par défaut est l'APPEL — le geste réel de l'échelle à J+8. La note
 * est libre et facultative : « promet de régler vendredi » est exactement ce
 * qu'on veut relire avant le prochain coup de fil, mais une relance sans mot
 * vaut mieux qu'une relance non tracée.
 */
export function RemindModal({ row, onClose, onDone }: GestureProps) {
  const toast = useToast();
  const [channel, setChannel] = useState<InvoiceReminderChannel>(DEFAULT_REMINDER_CHANNEL);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await billingApi.remind(row.tenantId, row.id, {
        channel,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast(`${row.number} — relance tracée`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Relance non tracée — réessayez."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Relance faite — ${row.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Fermer
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "Enregistrement…" : "Tracer la relance"}
          </Btn>
        </>
      }
    >
      <InvoiceRecap row={row} />

      <Consequences
        className="mt-4"
        tone="ok"
        does={[
          "La relance s'écrit sur la pièce — la file affichera « relancé il y a N j » — et au journal du client, sous votre compte.",
        ]}
        doesNot={[
          "Rien n'est envoyé au client : on trace un geste déjà fait (l'appel passé, le courrier parti), on ne le déclenche pas.",
          "La facture ne change pas de statut : elle reste due, et reste dans la file jusqu'à l'encaissement.",
        ]}
      />

      <Field
        className="mt-4"
        label="Canal"
        htmlFor="remind-channel"
        hint="Liste fermée — pour savoir, à J+15, si le client a déjà été relancé par écrit."
      >
        <Select
          id="remind-channel"
          autoFocus
          value={channel}
          disabled={busy}
          onChange={(e) => setChannel(e.target.value as InvoiceReminderChannel)}
        >
          {REMINDER_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {REMINDER_CHANNEL_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        className="mt-3"
        label="Note"
        htmlFor="remind-note"
        hint="Facultative — ce que le gérant a répondu, c'est ce qu'on relira avant le prochain appel."
      >
        <Textarea
          id="remind-note"
          rows={3}
          placeholder="Le gérant promet de régler vendredi par virement."
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      {refusal && <Refusal message={refusal} />}
    </Modal>
  );
}

/**
 * ENCAISSER.
 *
 * Le MOYEN est obligatoire — « payée » sans savoir comment ne se rapproche
 * d'aucun relevé bancaire. La DATE est facultative parce qu'elle vaut
 * « aujourd'hui » neuf fois sur dix, et qu'un chèque encaissé la semaine
 * dernière se saisit en la précisant. L'API refuse une date future (au-delà de
 * cinq minutes de tolérance d'horloge) : le champ est borné à aujourd'hui pour
 * que ce refus n'arrive jamais jusqu'à l'opérateur.
 */
export function PayModal({ row, onClose, onDone }: GestureProps) {
  const toast = useToast();
  const [method, setMethod] = useState<InvoicePaymentMethod>(DEFAULT_PAYMENT_METHOD);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const max = todayInput();

  async function run() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      // Une date vide vaut « maintenant » côté API : on n'envoie le champ que
      // lorsque l'équipe l'a saisi (cf. `paidAtIso` pour les deux pièges).
      const at = paidAtIso(paidAt);
      await billingApi.pay(row.tenantId, row.id, {
        method,
        ...(at ? { paidAt: at } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast(`${row.number} encaissée — ${row.amountLabel}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Encaissement impossible — réessayez."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Encaisser ${row.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Fermer
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "Encaissement…" : `Encaisser ${row.amountLabel}`}
          </Btn>
        </>
      }
    >
      <InvoiceRecap row={row} />

      <Consequences
        className="mt-4"
        tone="ok"
        does={[
          "La facture passe « payée », avec son moyen et sa date — c'est ce qu'on rapproche du relevé bancaire.",
          "Elle quitte la file de recouvrement immédiatement, et l'axe « paiement » du score de santé remonte.",
        ]}
        doesNot={[
          row.accessBlocked
            ? "Le compte reste SUSPENDU : encaisser ne rouvre pas l'accès. La réactivation se fait sur la fiche du client, avec son motif."
            : "Le statut du compte n'est pas touché : encaisser n'est pas une décision d'accès.",
          "Rien n'est prélevé : on enregistre un règlement déjà reçu, on ne le déclenche pas.",
        ]}
      />

      <Field
        className="mt-4"
        label="Moyen de règlement"
        htmlFor="pay-method"
        hint="Obligatoire — liste fermée, pour qu'on sache encore dans six mois combien de clients sont en prélèvement."
      >
        <Select
          id="pay-method"
          autoFocus
          value={method}
          disabled={busy}
          onChange={(e) => setMethod(e.target.value as InvoicePaymentMethod)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field
          label="Date du règlement"
          htmlFor="pay-date"
          hint="Vide = aujourd'hui."
        >
          <Input
            id="pay-date"
            type="date"
            max={max}
            value={paidAt}
            disabled={busy}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>
        <Field label="Référence" htmlFor="pay-note" hint="N° de chèque, référence du virement…">
          <Input
            id="pay-note"
            placeholder="VIR-4412"
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      {refusal && <Refusal message={refusal} />}
    </Modal>
  );
}

/** Longueur minimale d'un motif — alignée sur le schéma zod de l'API. */
const MIN_REASON = 3;

/**
 * ANNULER — jamais supprimer.
 *
 * Une facture est une pièce comptable : son numéro appartient à une séquence
 * continue et reste consommé. Le motif est donc obligatoire, comme pour une
 * suspension : une pièce retirée sans explication est une question sans réponse
 * six mois plus tard, le jour d'un contrôle.
 *
 * Et une facture RÉGLÉE ne s'annule pas — elle appelle un avoir. C'est l'API
 * qui tranche, et son refus s'affiche mot pour mot (`Refusal`).
 */
export function CancelModal({ row, onClose, onDone }: GestureProps) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const ok = reason.trim().length >= MIN_REASON;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await billingApi.cancel(row.tenantId, row.id, reason.trim());
      toast(`${row.number} annulée`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Annulation impossible — réessayez."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      destructive
      width={480}
      title={`Annuler ${row.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Fermer
          </Btn>
          <Btn
            size="sm"
            icon="close"
            className="bg-alert text-white hover:opacity-85"
            disabled={!ok || busy}
            onClick={() => void run()}
          >
            {busy ? "Annulation…" : "Annuler la facture"}
          </Btn>
        </>
      }
    >
      <InvoiceRecap row={row} />

      <Consequences
        className="mt-4"
        tone="alert"
        does={[
          "La pièce passe « annulée », avec son motif et sa date — et quitte la file de recouvrement.",
          "Le geste est inscrit au journal du client, sous votre compte.",
        ]}
        doesNot={[
          "La facture n'est PAS supprimée : son numéro reste consommé dans la séquence, sans quoi un « SM-2026-0007 » manquant deviendrait une question sans réponse le jour d'un contrôle.",
          "Une facture déjà réglée ne s'annule pas : elle se corrige par un avoir. L'API refuse le geste et vous le dira.",
        ]}
      />

      <Field
        className="mt-4"
        label="Motif de l'annulation"
        htmlFor="cancel-reason"
        hint="Obligatoire — c'est ce qu'on relira dans le journal, des mois plus tard."
      >
        <Textarea
          id="cancel-reason"
          autoFocus
          rows={3}
          placeholder="Période facturée en double — l'abonnement de juin est déjà réglé sur SM-2026-0004."
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>

      {refusal && <Refusal message={refusal} />}
    </Modal>
  );
}

/**
 * « Ce que ça fait » / « ce que ça ne fait pas ».
 *
 * La seconde liste est la plus utile : la moitié des hésitations au téléphone
 * portent sur ce qu'une action NE fait PAS (« si j'encaisse, est-ce que son
 * accès rouvre ? »).
 */
function Consequences({
  tone,
  does,
  doesNot,
  className,
}: {
  tone: "alert" | "ok";
  does: string[];
  doesNot: string[];
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <ul className="flex flex-col gap-1.5">
        {does.map((d) => (
          <li key={d} className="flex gap-2 text-[13px] leading-[1.45] text-ink">
            <Icon
              name="arrow"
              size={14}
              className={cx("mt-[3px] shrink-0", tone === "alert" ? "text-alertt" : "text-okt")}
            />
            {d}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-1.5 border-t border-line pt-2">
        {doesNot.map((d) => (
          <li key={d} className="flex gap-2 text-[13px] leading-[1.45] text-mut">
            <Icon name="minus" size={14} className="mt-[3px] shrink-0 text-mut" />
            {d}
          </li>
        ))}
      </ul>
    </div>
  );
}
