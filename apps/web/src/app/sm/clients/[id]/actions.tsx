"use client";

/**
 * LES GESTES GRAVES de la fiche client.
 *
 * Chacun agit sur l'OUTIL DE TRAVAIL d'un commerçant : suspendre son accès,
 * couper une tablette en service, changer sa facturation. Trois règles s'y
 * appliquent sans exception.
 *
 * 1. MOTIF OBLIGATOIRE. Y compris pour réactiver, que l'API accepte pourtant
 *    sans motif : six mois plus tard, « pourquoi ce compte a-t-il rouvert le
 *    12 mars ? » doit se lire dans le journal, pas se reconstituer de mémoire.
 *    On est donc volontairement plus strict que le schéma amont.
 *
 * 2. CONSÉQUENCE ÉCRITE AVANT LE BOUTON. Chaque modale dit ce qui va se passer
 *    côté restaurant — et ce qui ne se passera PAS : suspendre ne coupe pas les
 *    tablettes déjà appairées, révoquer ne suspend pas le compte.
 *
 * 3. CONFIRMATION EXPLICITE pour ce qui est irréversible dans l'instant. La
 *    révocation détruit un jeton d'appareil : elle demande un geste dédié, pas
 *    seulement un clic sur le bouton par défaut.
 */

import { useState } from "react";
import {
  ADMIN_PLANS,
  DEVICE_REVOKE_REASONS,
  DEVICE_REVOKE_REASON_LABELS,
  PLAN_LABELS,
  PLAN_MRR_CENTS,
  type AdminPlan,
  type DeviceRevokeReason,
} from "@sm/contracts";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import {
  Btn,
  Field,
  Icon,
  Select,
  Textarea,
  Toggle,
  useToast,
} from "@/components/ui";
// La modale-feuille locale à `/sm` : la modale du design system au-dessus de
// `md`, une feuille plein écran en dessous — un geste grave se confirme aussi
// depuis un téléphone, sans panneau qui déborde.
import { SheetModal } from "../../mobile";
import { crm, euroRound } from "../../crm";
import { clientsApi, type ParkDevice } from "../data";

/** Longueur minimale d'un motif — alignée sur le schéma zod de l'API. */
const MIN_REASON = 3;

/**
 * Ces modales ne portent PAS de prop `open` : la fiche ne les monte que
 * lorsqu'elle les ouvre. Un formulaire vidé par un effet au changement de
 * `open` est un formulaire qui se vide un rendu trop tard — le montage
 * conditionnel donne un brouillon neuf par construction, et évite la cascade
 * de rendus que provoque un `setState` en effet.
 */
type Common = {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
  /** Rechargement de la fiche après une écriture réussie. */
  onDone: () => void;
};

/** Message d'erreur lisible — jamais un code HTTP nu devant un opérateur. */
const errText = (e: unknown, fallback: string): string =>
  e instanceof ApiError && typeof e.message === "string" && e.message.trim()
    ? e.message
    : fallback;

// ─────────────────────────────────────────────────────────────
// Suspendre
// ─────────────────────────────────────────────────────────────

export function SuspendModal({ tenantId, tenantName, onClose, onDone }: Common) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ok = reason.trim().length >= MIN_REASON;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await clientsApi.suspend(tenantId, reason.trim());
      toast(`${tenantName} — accès suspendu`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e, "Suspension impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      destructive
      title={`Suspendre ${tenantName}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            icon="close"
            className="bg-alert text-white hover:opacity-85"
            disabled={!ok || busy}
            onClick={() => void run()}
          >
            {busy ? "Suspension…" : "Suspendre l'accès"}
          </Btn>
        </>
      }
    >
      <Consequences
        tone="alert"
        does={[
          "Le gérant est déconnecté au prochain clic — ses identifiants restent bons, c'est son abonnement qui ne l'est plus.",
          "La commande en ligne se ferme comme une pause de service : le consommateur lit qu'il faut appeler le restaurant, jamais « impayé ».",
        ]}
        doesNot={[
          "Rien n'est effacé : menu, commandes et historique restent en place.",
          "Les tablettes déjà appairées continuent d'encaisser — pour couper une caisse, utilisez « Révoquer » dans le parc d'appareils.",
        ]}
      />
      <Field
        className="mt-4"
        label="Motif de la suspension"
        htmlFor="suspend-reason"
        hint="Obligatoire — c'est ce qu'on relira dans le journal."
      >
        <Textarea
          id="suspend-reason"
          autoFocus
          rows={3}
          placeholder="Facture de juillet impayée après deux relances."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Réactiver
// ─────────────────────────────────────────────────────────────

export function ReactivateModal({ tenantId, tenantName, onClose, onDone }: Common) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ok = reason.trim().length >= MIN_REASON;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await clientsApi.reactivate(tenantId, reason.trim());
      toast(`${tenantName} — accès rouvert`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e, "Réactivation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Réactiver ${tenantName}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            icon="check"
            className="bg-ok text-white hover:opacity-85"
            disabled={!ok || busy}
            onClick={() => void run()}
          >
            {busy ? "Réactivation…" : "Rouvrir l'accès"}
          </Btn>
        </>
      }
    >
      <Consequences
        tone="ok"
        does={[
          "Le compte repart « actif » — pas vers son statut d'avant la coupure.",
          "Le gérant retrouve son back-office et la commande en ligne rouvre immédiatement.",
        ]}
        doesNot={[
          "L'épisode reste inscrit au journal : réactiver n'efface pas la suspension.",
        ]}
      />
      <Field
        className="mt-4"
        label="Motif de la réactivation"
        htmlFor="reactivate-reason"
        hint="Obligatoire ici, même si l'API l'accepte vide : un accès qui rouvre sans raison écrite est un accès qu'on ne saura pas expliquer."
      >
        <Textarea
          id="reactivate-reason"
          autoFocus
          rows={3}
          placeholder="Facture réglée le 12 mars, virement reçu."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Changer de formule
// ─────────────────────────────────────────────────────────────

export function PlanModal({
  tenantId,
  tenantName,
  onClose,
  onDone,
  current,
}: Common & { current: AdminPlan }) {
  const toast = useToast();
  const [plan, setPlan] = useState<AdminPlan>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const changed = plan !== current;
  const delta = PLAN_MRR_CENTS[plan] - PLAN_MRR_CENTS[current];

  async function run() {
    if (!changed || busy) return;
    setBusy(true);
    try {
      await clientsApi.changePlan(tenantId, plan, reason.trim());
      toast(`${tenantName} passe en ${PLAN_LABELS[plan]}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e, "Changement de formule impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Formule de ${tenantName}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={!changed || busy}
            onClick={() => void run()}
          >
            {busy ? "Enregistrement…" : "Appliquer la formule"}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Changer de formule ouvre ou ferme des modules côté restaurant. Le statut
        du compte n&apos;est pas touché : passer un client en Boost n&apos;est
        pas une décision d&apos;accès.
      </p>
      <Field className="mt-4" label="Formule" htmlFor="plan-select">
        <Select
          id="plan-select"
          value={plan}
          onChange={(e) => setPlan(e.target.value as AdminPlan)}
        >
          {ADMIN_PLANS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]} — {euroRound(PLAN_MRR_CENTS[p])} / mois
            </option>
          ))}
        </Select>
      </Field>
      {changed && (
        <div className="mt-3 flex items-center gap-2 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px]">
          <Icon name="euro" size={16} className="shrink-0 text-accent" />
          <span className="text-mut">
            MRR estimé{" "}
            <span className={cx("cf-fig font-extrabold", delta > 0 ? "text-okt" : "text-alertt")}>
              {delta > 0 ? "+" : "−"}
              {euroRound(Math.abs(delta))}
            </span>{" "}
            par mois — estimation d&apos;après la grille, la facturation reste
            la source de vérité.
          </span>
        </div>
      )}
      <Field
        className="mt-3"
        label="Motif"
        htmlFor="plan-reason"
        hint="Facultatif — mais « demandé par le gérant au téléphone » vaut mieux que rien."
      >
        <Textarea
          id="plan-reason"
          rows={2}
          placeholder="Le gérant veut la fidélité et les écrans de salle."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Révoquer un appareil
// ─────────────────────────────────────────────────────────────

/**
 * Le geste le plus grave de l'écran : il DÉTRUIT le jeton d'une tablette qui
 * peut être en train d'encaisser. D'où le double verrou — motif imposé dans
 * une liste fermée (le journal doit rester comptable : « combien de vols ce
 * trimestre ? ») et confirmation dédiée à cocher.
 *
 * Le code d'appairage renvoyé par l'API est affiché À DESSEIN et en grand :
 * l'équipe est au téléphone avec le restaurateur au moment où elle coupe la
 * tablette volée, et c'est ce code qu'elle lui dicte pour remettre la caisse de
 * secours en service dans la minute.
 */
export function RevokeDeviceModal({
  tenantId,
  tenantName,
  device,
  onClose,
  onDone,
}: {
  tenantId: string;
  tenantName: string;
  device: ParkDevice;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<DeviceRevokeReason>("perte");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function run() {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      const res = await clientsApi.revokeDevice(tenantId, device, {
        reason,
        note: note.trim(),
      });
      // Le code peut ne pas être renvoyé (écran, API plus ancienne) : la
      // révocation reste un succès, on ne bloque pas là-dessus.
      const pairing = (res as { pairing?: { code?: unknown } })?.pairing?.code;
      setCode(typeof pairing === "string" ? pairing : null);
      toast(`${device.name} révoqué — ${DEVICE_REVOKE_REASON_LABELS[reason]}`, {
        icon: "check",
      });
      onDone();
    } catch (e) {
      toast(errText(e, "Révocation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  // ── Après coup : le code à dicter ──
  if (code !== null) {
    return (
      <SheetModal
        open
        onClose={onClose}
        title={`${device.name} est coupé`}
        footer={
          <Btn variant="primary" size="sm" icon="check" onClick={onClose}>
            Terminé
          </Btn>
        }
      >
        <p className="text-[13px] text-mut">
          Le jeton est détruit : cet appareil n&apos;accède plus à rien. Il
          repart en attente d&apos;appairage. Dictez ce code au gérant pour
          remettre un appareil en service maintenant.
        </p>
        <div className="mt-4 grid place-items-center rounded-card border border-accent/40 bg-accent/10 py-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent/80">
            Code d&apos;appairage
          </div>
          <div className="cf-fig mt-1 text-[34px] font-extrabold tracking-[0.12em] text-accent">
            {code}
          </div>
        </div>
      </SheetModal>
    );
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      destructive
      width={480}
      title={`Révoquer ${device.name}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            icon="trash"
            className="bg-alert text-white hover:opacity-85"
            disabled={!confirmed || busy}
            onClick={() => void run()}
          >
            {busy ? "Révocation…" : "Révoquer maintenant"}
          </Btn>
        </>
      }
    >
      <Consequences
        tone="alert"
        does={[
          `Le jeton de cet appareil est détruit immédiatement — ${device.kindLabel.toLowerCase()} de ${tenantName} hors service dans la seconde.`,
          "L'appareil repart en attente d'appairage, avec un code frais à dicter au gérant.",
        ]}
        doesNot={[
          "Le compte du restaurant n'est pas suspendu : les autres appareils continuent de travailler.",
          "Aucune commande n'est perdue — ce qui a été encaissé reste encaissé.",
        ]}
      />

      <Field
        className="mt-4"
        label="Motif"
        htmlFor="revoke-reason"
        hint="Liste fermée — le journal doit rester comptable (« combien de vols ce trimestre ? »)."
      >
        <Select
          id="revoke-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as DeviceRevokeReason)}
        >
          {DEVICE_REVOKE_REASONS.map((r) => (
            <option key={r} value={r}>
              {DEVICE_REVOKE_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>

      <Field className="mt-3" label="Précision" htmlFor="revoke-note">
        <Textarea
          id="revoke-note"
          rows={2}
          placeholder="Oubliée dans un taxi samedi soir — dossier assurance n° 4412."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <div className="mt-4 flex items-center gap-3 rounded-card border border-alert/40 bg-alert/8 p-3">
        <div className="min-w-0 flex-1 text-[13px] font-bold text-ink">
          Je confirme couper {device.name} maintenant
          <div className="mt-0.5 text-xs font-semibold text-alertt">
            {device.online
              ? "Cet appareil a donné signe de vie il y a moins de cinq minutes — il est probablement en service."
              : "Cet appareil est déjà hors ligne."}
          </div>
        </div>
        <Toggle
          on={confirmed}
          danger
          label="Confirmer la révocation"
          onChange={setConfirmed}
        />
      </div>
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Conséquences
// ─────────────────────────────────────────────────────────────

/**
 * « Ce que ça fait » / « ce que ça ne fait pas ».
 *
 * La seconde colonne est la plus utile : la moitié des hésitations au
 * téléphone portent sur ce qu'une action NE fait PAS (« si je suspends, est-ce
 * que la caisse s'arrête ? »).
 */
function Consequences({
  tone,
  does,
  doesNot,
}: {
  tone: "alert" | "ok";
  does: string[];
  doesNot: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
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

// ─────────────────────────────────────────────────────────────
// Mot de passe gérant
// ─────────────────────────────────────────────────────────────

/**
 * L'oubli de mot de passe était le dernier geste qui exigeait un terminal :
 * un script CLI contre la base de production, à chaque appel. Ici : un
 * nouveau mot de passe fabriqué côté API (l'ancien cesse à l'instant), REMIS
 * UNE FOIS dans cette modale, et le geste au journal. Fermer sans noter =
 * recommencer — il n'existe aucun moyen de le relire.
 */
export function ResetOwnerModal({ tenantId, tenantName, onClose, onDone }: Common) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fait, setFait] = useState<{ ownerEmail: string; password: string } | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      setFait(await crm.resetOwner(tenantId));
      onDone();
    } catch (e) {
      toast(errText(e, "Réinitialisation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Mot de passe gérant — ${tenantName}`}
      footer={
        fait ? (
          <Btn size="sm" icon="check" onClick={onClose}>
            C&apos;est noté
          </Btn>
        ) : (
          <>
            <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Annuler
            </Btn>
            <Btn size="sm" icon="edit" disabled={busy} onClick={() => void run()}>
              {busy ? "Fabrication…" : "Fabriquer un nouveau mot de passe"}
            </Btn>
          </>
        )
      }
    >
      {fait ? (
        <div>
          <p className="text-[13px] text-mut">
            À dicter ou copier MAINTENANT pour <b className="text-ink">{fait.ownerEmail}</b> —
            il ne sera jamais réaffiché.
          </p>
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
        </div>
      ) : (
        <Consequences
          tone="alert"
          does={[
            "Un nouveau mot de passe est fabriqué et remis UNE fois, ici.",
            "L'ancien cesse de fonctionner à l'instant même.",
            "Le geste s'inscrit au journal de l'établissement.",
          ]}
          doesNot={[
            "Les tablettes appairées ne bougent pas : la caisse et la cuisine continuent.",
            "Personne n'est prévenu automatiquement — c'est vous qui remettez le mot de passe au gérant.",
          ]}
        />
      )}
    </SheetModal>
  );
}
