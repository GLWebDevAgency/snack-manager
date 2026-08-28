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
import { Btn, Card, Field, Icon, Input, useToast } from "@/components/ui";
import { SheetModal } from "../../mobile";
import { clientsApi } from "../data";
import { errText } from "../../crm";

const jour = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

/** Le ton d'un statut — l'œil doit trier avant de lire. */
const TON: Record<string, string> = {
  brouillon: "border-white/20 bg-white/6 text-mut",
  envoyee: "border-accent/35 bg-accent/12 text-accent",
  en_retard: "border-alert/40 bg-alert/12 text-alertt",
  payee: "border-ok/40 bg-ok/12 text-okt",
  annulee: "border-white/12 bg-white/4 text-mut/70",
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

  // Le statut STOCKÉ, jamais l'effectif : « en retard » est calculé à la
  // lecture et ne dit rien de ce qu'on peut faire de la pièce.
  const brouillons = invoices.filter((i) => i.storedStatus === "brouillon");
  const historique = invoices.filter((i) => i.storedStatus !== "brouillon");

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-ink">Factures</h2>
        {invoices.length > 0 && (
          <span className="text-[12px] text-mut">
            {invoices.length} pièce{invoices.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {indisponible ? (
        <p className="mt-3 text-[13px] text-mut">
          Route <span className="cf-fig">/crm/tenants/:id/billing</span> indisponible — les
          pièces de ce client ne peuvent pas être lues.
        </p>
      ) : invoices.length === 0 ? (
        <p className="mt-3 text-[13px] text-mut">
          Aucune pièce émise. Le bouton <strong className="text-ink">Facturer</strong> en pose
          une, en brouillon ou directement.
        </p>
      ) : (
        <>
          {brouillons.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
                En attente d&apos;envoi
              </div>
              {brouillons.map((f) => (
                <div
                  key={f._id}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-white/10 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="cf-fig text-[13px] font-bold text-ink">{f.number}</div>
                    <div className="truncate text-[12px] text-mut" title={f.label}>
                      {f.label}
                    </div>
                  </div>
                  <div className="cf-fig shrink-0 text-[14px] font-extrabold text-ink">
                    {f.amountLabel}
                  </div>
                  <Btn variant="ink" size="sm" icon="check" onClick={() => setAEnvoyer(f)}>
                    Envoyer
                  </Btn>
                </div>
              ))}
              <p className="text-[12px] text-mut">
                Un brouillon ne doit rien : c&apos;est l&apos;envoi qui crée la créance et
                lance le compte à rebours de l&apos;échéance.
              </p>
            </div>
          )}

          {historique.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {historique.map((f) => (
                <li key={f._id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="cf-fig shrink-0 text-[13px] font-bold text-ink">
                    {f.number}
                  </span>
                  <span
                    className={`shrink-0 rounded-pill border px-2 py-[1px] text-[11px] font-semibold ${
                      TON[f.status] ?? TON.envoyee
                    }`}
                  >
                    {f.statusLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-mut" title={f.label}>
                    {f.label}
                  </span>
                  <span className="cf-fig shrink-0 text-[12px] text-mut">
                    {f.paidAt ? `réglée le ${jour(f.paidAt)}` : `échue le ${jour(f.dueAt)}`}
                  </span>
                  <span className="cf-fig shrink-0 text-[13px] font-bold text-ink">
                    {f.amountLabel}
                  </span>
                  {/*
                    L'AVOIR, sur les pièces réglées et elles seules. Le module
                    ne sait pas supprimer une facture, et c'est délibéré : une
                    pièce comptable s'annule avec un motif. Après encaissement,
                    « annuler » n'est plus recevable — l'avoir est alors le seul
                    geste juste, et il n'avait aucun bouton.
                  */}
                  {f.storedStatus === "payee" && (
                    <button
                      type="button"
                      onClick={() => setAAvoir(f)}
                      className="cf-press shrink-0 rounded-pill px-2 py-[2px] text-[12px] font-bold text-mut hover:text-alertt hover:underline"
                    >
                      Avoir
                    </button>
                  )}
                </li>
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
      {aEnvoyer && (
        <EnvoyerModal
          tenantId={tenantId}
          tenantName={tenantName}
          invoice={aEnvoyer}
          onClose={() => setAEnvoyer(null)}
          onDone={onDone}
        />
      )}
    </Card>
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

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await clientsApi.sendInvoice(tenantId, invoice._id);
      toast(`${invoice.number} envoyée — ${invoice.amountLabel}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e, "Envoi impossible — la pièce reste en brouillon."));
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
  const pret = motif.trim().length >= 5;

  async function run() {
    if (busy || !pret) return;
    setBusy(true);
    try {
      await clientsApi.creditInvoice(tenantId, invoice._id, motif.trim());
      toast(`Avoir émis sur ${invoice.number}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      toast(errText(e, "Avoir impossible — la facture reste réglée."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
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
    </SheetModal>
  );
}
