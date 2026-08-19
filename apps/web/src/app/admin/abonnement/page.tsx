"use client";

/**
 * « ABONNEMENT » — l'écran promis au gérant depuis le premier argumentaire.
 *
 * `docs/specs/contraintes-business.md` §5 (FAQ #17) répond au restaurateur qui
 * demande à voir ses factures : « Back-office → Abonnement : toutes les
 * factures en PDF, le détail de votre formule, et votre statut fondateur
 * (tarif gelé) ». La page n'existait pas. Elle existe.
 *
 * ─── SOBRE, PARCE QU'ON N'Y VIENT PAS SOUVENT ───
 *
 * Deux fois par an : quand le comptable réclame les pièces, et quand un
 * prélèvement interroge. Aucun graphique, aucune animation, aucune couleur
 * décorative — trois chiffres en haut, un tableau en dessous, un bouton par
 * ligne. Un écran de facturation qui cherche à séduire donne l'impression
 * qu'on cherche à distraire.
 *
 * ─── LE CAS SUSPENDU ───
 *
 * C'est le SEUL écran du back-office qui reste accessible à un compte suspendu
 * (`GET /billing/me`, garde dédié côté API). Il porte donc l'explication et le
 * montant à régler : sans lui, un gérant coupé pour impayé n'aurait plus aucun
 * moyen de savoir combien il doit, ni sur quelle référence virer.
 */

import { useCallback, useEffect, useState } from "react";
import {
  invoicePdfFilename,
  type CrmInvoice,
  type InvoiceStatus,
  type MyBilling,
} from "@sm/contracts";
import { api, csvDownload } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { Btn, Card, EmptyState, Panel, Pill, Skeleton, useToast } from "@/components/ui";

/** `2026-09-01T…` → « 01/09/2026 » — en UTC, comme les échéances côté API. */
function fmtJour(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return [
    String(d.getUTCDate()).padStart(2, "0"),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    d.getUTCFullYear(),
  ].join("/");
}

/**
 * Couleurs FONCTIONNELLES, jamais l'accent de marque : « en retard » doit se
 * lire pareil chez tous les restaurants, quelle que soit leur couleur.
 */
const STATUT: Record<InvoiceStatus, string> = {
  payee: "border-ok/50 bg-ok/12 text-okt",
  envoyee: "border-white/12 bg-fill text-onfill",
  en_retard: "border-alert/50 bg-alert/12 text-alertt",
  annulee: "border-line bg-transparent text-mut",
  brouillon: "border-line bg-transparent text-mut",
};

/** Phrase de la prochaine échéance — « dans 12 jours », « en retard de 3 jours ». */
function echeance(daysUntil: number): string {
  if (daysUntil < 0) return `en retard de ${-daysUntil} jour${-daysUntil > 1 ? "s" : ""}`;
  if (daysUntil === 0) return "aujourd’hui";
  if (daysUntil === 1) return "demain";
  return `dans ${daysUntil} jours`;
}

export default function AbonnementPage() {
  const toast = useToast();
  const [data, setData] = useState<MyBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<MyBilling>("/billing/me?limit=200"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Le PDF est servi par une route AUTHENTIFIÉE : un simple `<a href>` partirait
   * sans jeton et reviendrait en 401. On le récupère donc en blob, avec
   * l'en-tête d'autorisation — c'est ce que fait déjà `csvDownload` pour les
   * exports, à ceci près qu'on lui impose le nom de fichier.
   */
  async function telecharger(invoice: CrmInvoice) {
    if (downloading) return;
    setDownloading(invoice._id);
    try {
      await csvDownload(
        `/billing/me/invoices/${invoice._id}/pdf`,
        invoicePdfFilename(invoice.number),
      );
    } catch {
      toast("Téléchargement impossible — réessayez");
    } finally {
      setDownloading(null);
    }
  }

  if (error)
    return (
      <div className="p-[26px]">
        <div className="flex flex-col items-start gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
          <p className="text-sm text-alertt">{error}</p>
          <Btn variant="ghost" size="sm" onClick={() => void load()}>
            Réessayer
          </Btn>
        </div>
      </div>
    );

  if (!data)
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <Skeleton className="h-[104px]" />
        <Skeleton className="h-[320px]" />
      </div>
    );

  const { subscription: sub, nextDue, outstanding, invoices, legalGaps } = data;

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">Abonnement</h1>
        <p className="mt-0.5 text-sm text-mut">
          Votre formule, vos échéances et toutes vos factures — {data.tenant.name}.
        </p>
      </div>

      {/* ── Compte suspendu : l'explication, et le montant qui la lève ── */}
      {sub.accessBlocked && (
        <div className="rounded-panel border border-alert/40 bg-alert/10 px-[18px] py-4">
          <p className="text-sm font-bold text-alertt">
            Accès suspendu — le reste du back-office est fermé.
          </p>
          <p className="mt-1 text-[13px] leading-[1.5] text-ink">
            Cette page reste ouverte pour que vous puissiez récupérer vos factures et
            régulariser.{" "}
            {outstanding.totalDueCents > 0 ? (
              <>
                Il reste <strong>{fmtEuro(outstanding.totalDueCents)}</strong> à régler
                {outstanding.overdueInvoices > 0
                  ? ` sur ${outstanding.overdueInvoices} facture${outstanding.overdueInvoices > 1 ? "s" : ""} échue${outstanding.overdueInvoices > 1 ? "s" : ""}`
                  : ""}
                . Indiquez le numéro de facture en référence de votre virement.
              </>
            ) : (
              <>Contactez Snack Manager pour rouvrir l’accès.</>
            )}
          </p>
        </div>
      )}

      {/* ── Les trois chiffres ── */}
      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="flex-1 p-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Formule en cours
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink">
              {sub.planLabel}
            </span>
            {sub.founderSeat && (
              <Pill className="border-gold/40 bg-gold/15 text-gold" title="Tarif gelé">
                Fondateur
              </Pill>
            )}
          </div>
          <p className="cf-fig mt-1 text-[13px] text-mut">
            {fmtEuro(sub.mrrCents)} par mois · client depuis le {fmtJour(sub.since)}
          </p>
        </Card>

        <Card className="flex-1 p-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Prochaine échéance
          </div>
          <div className="cf-fig mt-2 text-[30px] font-extrabold leading-[1.1] text-ink">
            {nextDue ? fmtEuro(nextDue.amountCents) : "—"}
          </div>
          <p className="cf-fig mt-1 text-[13px] text-mut">
            {nextDue ? (
              <>
                le {fmtJour(nextDue.at)} · {echeance(nextDue.daysUntil)}
                {/* Une échéance sans numéro n'est pas encore une créance : la
                    pièce n'existe pas, inutile de la chercher plus bas. */}
                {nextDue.invoiceNumber ? ` · ${nextDue.invoiceNumber}` : " · à émettre"}
              </>
            ) : (
              "Rien à prélever pour le moment."
            )}
          </p>
        </Card>

        <Card className="flex-1 p-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Reste dû
          </div>
          <div
            className={cx(
              "cf-fig mt-2 text-[30px] font-extrabold leading-[1.1]",
              outstanding.overdueCents > 0 ? "text-alertt" : "text-ink",
            )}
          >
            {fmtEuro(outstanding.totalDueCents)}
          </div>
          <p className="cf-fig mt-1 text-[13px] text-mut">
            {outstanding.overdueInvoices > 0
              ? `${outstanding.overdueLabel} en retard — la plus ancienne depuis ${outstanding.oldestOverdueDays} jour(s)`
              : outstanding.invoices > 0
                ? `${outstanding.invoices} facture(s) en cours, échéance non dépassée`
                : "Tout est réglé."}
          </p>
        </Card>
      </div>

      {/* ── L'historique ── */}
      <Panel
        title="Vos factures"
        sub={
          invoices.length > 0
            ? `${invoices.length} pièce${invoices.length > 1 ? "s" : ""} — cliquez pour obtenir le PDF`
            : undefined
        }
        bodyClassName="-mx-[18px] -mb-[18px]"
      >
        {invoices.length === 0 ? (
          <EmptyState
            icon="euro"
            title="Aucune facture pour le moment"
            hint="Vos factures d’abonnement apparaîtront ici dès la première échéance."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-y border-line text-[11px] uppercase tracking-[0.06em] text-mut">
                  <th scope="col" className="px-[18px] py-2.5 font-semibold">
                    Numéro
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Désignation
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Échéance
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Statut
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Montant
                  </th>
                  <th scope="col" className="px-[18px] py-2.5 text-right font-semibold">
                    <span className="sr-only">Télécharger</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((f) => (
                  <tr key={f._id} className="border-b border-line/60 last:border-0">
                    <td className="cf-fig whitespace-nowrap px-[18px] py-3 text-sm font-bold text-ink">
                      {f.number}
                    </td>
                    <td className="px-3 py-3 text-sm text-ink">
                      {f.label || f.kindLabel}
                      <span className="block text-[12px] text-mut">{f.period.label}</span>
                    </td>
                    <td className="cf-fig whitespace-nowrap px-3 py-3 text-sm text-mut">
                      {fmtJour(f.dueAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={cx(
                          "inline-flex items-center rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]",
                          STATUT[f.status],
                        )}
                      >
                        {f.statusLabel}
                      </span>
                      {f.status === "payee" && f.methodLabel && (
                        <span className="ml-2 text-[12px] text-mut">
                          {fmtJour(f.paidAt)} · {f.methodLabel}
                        </span>
                      )}
                      {f.status === "en_retard" && (
                        <span className="ml-2 text-[12px] text-alertt">
                          {f.overdueDays} jour(s)
                        </span>
                      )}
                    </td>
                    <td className="cf-fig whitespace-nowrap px-3 py-3 text-right text-sm font-bold text-ink">
                      {fmtEuro(f.amountCents)}
                    </td>
                    <td className="whitespace-nowrap px-[18px] py-3 text-right">
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon="print"
                        disabled={downloading === f._id}
                        onClick={() => void telecharger(f)}
                        aria-label={`Télécharger la facture ${f.number} en PDF`}
                      >
                        {downloading === f._id ? "…" : "PDF"}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/*
        Mentions légales incomplètes — dit AU GÉRANT, pas seulement à notre
        équipe. S'il télécharge une facture qui porte des emplacements vides, il
        doit l'apprendre ici et non de la bouche de son comptable.
      */}
      {legalGaps.length > 0 && (
        <p className="text-[12px] leading-[1.5] text-mut">
          {/* Les libellés portent des sigles — SIRET, TVA — qu'un `toLowerCase()`
              rendrait illisibles. Ils s'écrivent tels quels. */}
          Certaines mentions légales de vos factures restent à compléter par Snack
          Manager : {legalGaps.map((g) => g.label).join(" · ")}. Elles apparaissent en
          emplacement vide sur les PDF — nous ne remplissons jamais une mention
          obligatoire par une valeur approchée.
        </p>
      )}
    </div>
  );
}
