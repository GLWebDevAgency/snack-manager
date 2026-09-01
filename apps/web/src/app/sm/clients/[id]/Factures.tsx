"use client";

/**
 * LES FACTURES DU CLIENT — et la sortie des brouillons.
 *
 * `POST /crm/tenants/:id/invoices/:invoiceId/send` était écrite, testée, gardée
 * par son rôle… et n'avait aucun appelant. La conséquence se voyait mal : un
 * brouillon posé à la signature, ou par la passe mensuelle, n'avait
 * littéralement aucun chemin pour partir. La file de recouvrement ne montre que
 * les impayées — un brouillon n'est pas dû, il n'y figure jamais — et la fiche
 * client, elle, n'affichait aucune pièce du tout.
 *
 * Le geste manquant était donc double : voir les pièces, et envoyer celles qui
 * attendent. L'un sans l'autre ne sert à rien.
 *
 * ── Les brouillons d'abord, et séparés ────────────────────────────────────
 *
 * Ils ne sont pas un statut de plus dans une liste : ce sont les seules pièces
 * qui demandent une DÉCISION. Noyés dans l'historique, ils s'oublient — et un
 * brouillon oublié, c'est un mois non facturé que personne ne réclame.
 *
 * ── Envoyer crée une créance ──────────────────────────────────────────────
 *
 * D'où la confirmation nommée : le numéro, le montant, le client. Une facture
 * partie ne se rattrape pas — elle s'annule avec un motif, et l'annulation
 * reste au dossier.
 */

import { useState } from "react";
import type { CrmInvoice } from "@sm/contracts";
import { Btn, Field, Icon, Input, Panel, Textarea, useToast } from "@/components/ui";
import { cx } from "@/lib/cx";
import { Unavailable } from "../ui";
import { SheetModal } from "../../mobile";
import { clientsApi } from "../data";
import { billingApi } from "../../facturation/data";
import { errText } from "../../crm";

const jour = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

/** Le ton d'un statut — l'œil doit trier avant de lire. */
const TON: Record<string, string> = {
  brouillon: "border-white/20 bg-white/6 text-mut",
  envoyee: "border-accent/35 bg-accent/12 text-accent",
  en_retard: "border-alert/40 bg-alert/12 text-alertt",
  payee: "border-ok/40 bg-ok/12 text-okt",
  // La bordure white/12 et le libellé disent la pièce éteinte ; le texte,
  // lui, reste lisible — c'est une pièce comptable, pas une décoration.
  annulee: "border-white/12 bg-white/4 text-mut",
};

export function FacturesCard({
  tenantId,
  tenantName,
  invoices,
  indisponible,
  onDone,
}: {
  tenantId: string;
  tenantName: string;
  invoices: CrmInvoice[];
  indisponible: boolean;
  onDone: () => void;
}) {
  const [aEnvoyer, setAEnvoyer] = useState<CrmInvoice | null>(null);
  const [aAvoir, setAAvoir] = useState<CrmInvoice | null>(null);
  const [aAnnuler, setAAnnuler] = useState<CrmInvoice | null>(null);

  // Le statut STOCKÉ, jamais l'effectif : « en retard » est calculé à la
  // lecture et ne dit rien de ce qu'on peut faire de la pièce.
  const brouillons = invoices.filter((i) => i.storedStatus === "brouillon");
  const historique = invoices.filter((i) => i.storedStatus !== "brouillon");

  return (
    <Panel
      title="Factures"
      sub={
        indisponible
          ? "Route /crm/tenants/:id/billing indisponible"
          : invoices.length === 0
            ? "Aucune pièce émise pour ce client"
            : `${invoices.length} pièce${invoices.length > 1 ? "s" : ""}${brouillons.length > 0 ? ` · ${brouillons.length} à envoyer` : ""}`
      }
      // Les lignes vont d'un bord à l'autre, comme le parc d'appareils : dans
      // cette colonne étroite, un padding sur chaque ligne mangerait la place
      // du montant.
      bodyClassName="-mx-[18px] -mb-[18px]"
    >
      {indisponible ? (
        <div className="px-[18px] pb-[18px]">
          <Unavailable
            icon="euro"
            title="Facturation indisponible"
            hint="La route /crm/tenants/:id/billing n'a pas répondu : les pièces de ce client ne peuvent pas être lues."
          />
        </div>
      ) : invoices.length === 0 ? (
        <p className="px-[18px] pb-[18px] text-[13px] text-mut">
          Aucune pièce émise. Le bouton <strong className="text-ink">Facturer</strong> en
          pose une, en brouillon ou directement.
        </p>
      ) : (
        <>
          {brouillons.length > 0 && (
            <ul>
              {brouillons.map((f) => (
                <FactureRow
                  key={f._id}
                  facture={f}
                  brouillon
                  onAction={() => setAEnvoyer(f)}
                />
              ))}
            </ul>
          )}
          {historique.length > 0 && (
            <ul>
              {historique.map((f) => (
                <FactureRow
                  key={f._id}
                  facture={f}
                  // Une réglée se corrige par un avoir ; une envoyée non réglée
                  // s'annule avec un motif — sans attendre qu'elle devienne un
                  // impayé pour la retrouver dans la file de recouvrement.
                  onAction={
                    f.storedStatus === "payee"
                      ? () => setAAvoir(f)
                      : f.storedStatus === "envoyee"
                        ? () => setAAnnuler(f)
                        : undefined
                  }
                  actionLabel={f.storedStatus === "payee" ? "Avoir" : "Annuler"}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {aAvoir && (
        <AvoirModal
          tenantId={tenantId}
          tenantName={tenantName}
          invoice={aAvoir}
          onClose={() => setAAvoir(null)}
          onDone={onDone}
        />
      )}
      {aAnnuler && (
        <AnnulerModal
          tenantId={tenantId}
          tenantName={tenantName}
          invoice={aAnnuler}
          onClose={() => setAAnnuler(null)}
          onDone={onDone}
        />
      )}
      {aEnvoyer && (
        <EnvoyerModal
          tenantId={tenantId}
          tenantName={tenantName}
          invoice={aEnvoyer}
          onClose={() => setAEnvoyer(null)}
          onDone={onDone}
        />
      )}
    </Panel>
  );
}

/**
 * UNE LIGNE DE FACTURE — empilée, jamais en colonnes.
 *
 * Cette carte vit dans la colonne ÉTROITE de la fiche client. Une première
 * version alignait numéro, statut, libellé, date, montant et action sur une
 * seule ligne : le libellé se rognait à une largeur différente à chaque ligne
 * (« Abonnement Com… », « Abonneme… », « Mise en pla… »), le montant touchait le
 * bord, et le bouton « Avoir » sortait purement et simplement du cadre — un
 * geste comptable devenu inatteignable.
 *
 * L'information s'empile donc sur trois niveaux, du plus identifiant au plus
 * secondaire : ce qui nomme la pièce, ce qu'elle contient, ce qu'on en fait.
 * Le montant reste en tête à droite, où l'œil le cherche, et l'action garde sa
 * place en bas de ligne — visible sur TOUTES les pièces qui en ont une.
 */
function FactureRow({
  facture: f,
  brouillon = false,
  onAction,
  actionLabel = "Avoir",
}: {
  facture: CrmInvoice;
  brouillon?: boolean;
  onAction?: () => void;
  /** Le geste d'historique — « Avoir » sur une réglée, « Annuler » sur une envoyée. */
  actionLabel?: string;
}) {
  return (
    <li
      className={cx(
        "border-t border-line px-[18px] py-2.5",
        // Un brouillon n'est pas une créance : il attend une décision, et se
        // distingue au premier coup d'œil du reste de l'historique.
        brouillon && "bg-accent/6",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="cf-fig shrink-0 text-[13.5px] font-bold text-ink">{f.number}</span>
        <span
          className={cx(
            // La recette commune des pastilles de statut de la surface
            // (sections.tsx, StatusBadge) — pas une variante locale.
            "shrink-0 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
            TON[f.status] ?? TON.envoyee,
          )}
        >
          {f.statusLabel}
        </span>
        {/* Pousse le montant à droite sans lui disputer sa largeur. */}
        <span className="min-w-0 flex-1" />
        <span className="cf-fig shrink-0 text-[14px] font-extrabold tabular-nums text-ink">
          {f.amountLabel}
        </span>
      </div>

      {/* Le libellé sur SA ligne : c'est lui qui était rogné à six largeurs
          différentes quand il partageait la première. */}
      <div className="mt-0.5 truncate text-[12.5px] text-mut" title={f.label}>
        {f.label}
      </div>

      <div className="mt-1 flex items-center gap-3">
        <span className="cf-fig min-w-0 flex-1 truncate text-[12px] text-mut">
          {f.paidAt ? `réglée le ${jour(f.paidAt)}` : `échue le ${jour(f.dueAt)}`}
        </span>
        {brouillon ? (
          <Btn
            variant="ink"
            size="sm"
            icon="check"
            className="max-md:min-h-11"
            onClick={onAction}
          >
            Envoyer
          </Btn>
        ) : onAction ? (
          // Un vrai Btn, comme « Révoquer » du parc d'appareils : un geste
          // comptable ne se vise pas au doigt sur une pilule de 26 px.
          <Btn
            variant="ghost"
            size="sm"
            className="shrink-0 border-alert/40 text-alertt hover:border-alert hover:bg-alert/12 max-md:min-h-11"
            onClick={onAction}
          >
            {actionLabel}
          </Btn>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Le refus de l'API, affiché tel quel DANS la modale — même patron que la
 * facturation. Un refus comptable (« déjà envoyée », « se corrige par un
 * avoir ») arrive quand deux personnes travaillent la même pièce : c'est le
 * moment où l'on relit, pas celui où un toast de 2,2 s s'efface.
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

/**
 * La confirmation nomme la pièce, le montant et le client.
 *
 * Un « Confirmer ? » anonyme sur un geste irréversible ne fait pas relire :
 * il fait cliquer. Ce qui est écrit ici est exactement ce que le client
 * recevra.
 */
function EnvoyerModal({
  tenantId,
  tenantName,
  invoice,
  onClose,
  onDone,
}: {
  tenantId: string;
  tenantName: string;
  invoice: CrmInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.sendInvoice(tenantId, invoice._id);
      toast(`${invoice.number} envoyée — ${invoice.amountLabel}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      // Le refus reste dans la modale ouverte, pas dans un toast de 2,2 s.
      setRefusal(errText(e, "Envoi impossible — la pièce reste en brouillon."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Envoyer ${invoice.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "Envoi…" : `Envoyer ${invoice.amountLabel}`}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        <strong className="text-ink">{tenantName}</strong> devra{" "}
        <span className="cf-fig font-bold text-ink">{invoice.amountLabel}</span> pour «&nbsp;
        {invoice.label}&nbsp;».
      </p>
      <p className="mt-2 flex items-start gap-2 text-[13px] text-mut">
        <Icon name="bell" size={16} className="mt-[2px] shrink-0 text-prept" />
        <span>
          L&apos;envoi crée la créance et fixe le point de départ de la relance. Une facture
          partie ne s&apos;efface pas : elle s&apos;annule avec un motif, qui reste au dossier.
        </span>
      </p>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

/**
 * L'AVOIR — le seul chemin après encaissement.
 *
 * `POST …/invoices/:id/credit` n'avait, elle non plus, aucun appelant : une
 * facture réglée par erreur n'avait donc aucune sortie dans le logiciel. Le
 * motif est EXIGÉ, et il part au journal : un avoir sans raison est une somme
 * rendue que personne ne saura justifier au bilan.
 */
function AvoirModal({
  tenantId,
  tenantName,
  invoice,
  onClose,
  onDone,
}: {
  tenantId: string;
  tenantName: string;
  invoice: CrmInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const pret = motif.trim().length >= 5;

  async function run() {
    if (busy || !pret) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.creditInvoice(tenantId, invoice._id, motif.trim());
      toast(`Avoir émis sur ${invoice.number}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Avoir impossible — la facture reste réglée."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      // Destructive, comme « Annuler la facture » en facturation : un Échap ou
      // un misclic hors zone n'emporte pas le motif en cours de frappe.
      destructive
      title={`Avoir sur ${invoice.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy || !pret}
            onClick={() => void run()}
          >
            {busy ? "Émission…" : `Émettre l’avoir (${invoice.amountLabel})`}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        <strong className="text-ink">{tenantName}</strong> a réglé{" "}
        <span className="cf-fig font-bold text-ink">{invoice.amountLabel}</span> pour «&nbsp;
        {invoice.label}&nbsp;». L&apos;avoir constate que cette somme lui est due.
      </p>
      <Field
        label="Motif"
        htmlFor="avoir-motif"
        className="mt-3"
        hint="Il reste au dossier et se relit au bilan — « erreur de période », « prestation non rendue »."
      >
        <Input
          id="avoir-motif"
          value={motif}
          placeholder="Facturé deux fois le mois de septembre"
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

/**
 * L'ANNULATION — la sortie d'une pièce envoyée mais non réglée.
 *
 * Émise par erreur — mauvais montant, mauvaise période — une facture envoyée
 * n'avait aucun geste ici : la file de recouvrement ne montre que les échues,
 * et il fallait attendre l'échéance pour corriger la pièce. Le motif est
 * EXIGÉ, comme pour l'avoir : la pièce n'est pas supprimée, son numéro reste
 * consommé dans la séquence, et l'annulation reste au dossier.
 */
function AnnulerModal({
  tenantId,
  tenantName,
  invoice,
  onClose,
  onDone,
}: {
  tenantId: string;
  tenantName: string;
  invoice: CrmInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const pret = motif.trim().length >= 5;

  async function run() {
    if (busy || !pret) return;
    setBusy(true);
    setRefusal(null);
    try {
      await billingApi.cancel(tenantId, invoice._id, motif.trim());
      toast(`${invoice.number} annulée`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      // « Déjà réglée : elle se corrige par un avoir » — le refus de l'API
      // est mieux écrit que tout ce qu'on reformulerait ici.
      setRefusal(errText(e, "Annulation impossible — la facture reste due."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      destructive
      title={`Annuler ${invoice.number}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Fermer
          </Btn>
          <Btn
            size="sm"
            icon="close"
            className="bg-alert text-white hover:opacity-85"
            disabled={busy || !pret}
            onClick={() => void run()}
          >
            {busy ? "Annulation…" : "Annuler la facture"}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        <strong className="text-ink">{tenantName}</strong> doit{" "}
        <span className="cf-fig font-bold text-ink">{invoice.amountLabel}</span> pour «&nbsp;
        {invoice.label}&nbsp;». L&apos;annulation éteint la créance — la pièce n&apos;est pas
        supprimée : son numéro reste consommé dans la séquence.
      </p>
      <Field
        label="Motif"
        htmlFor="annuler-motif"
        className="mt-3"
        hint="Il reste au dossier et se relit au bilan — une facture réglée, elle, se corrige par un avoir."
      >
        <Textarea
          id="annuler-motif"
          autoFocus
          rows={3}
          value={motif}
          placeholder="Période facturée en double — septembre est déjà réglé sur SM-2026-0004."
          disabled={busy}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}
