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
  EMPTY_BILLING_IDENTITY,
  TenantBillingIdentitySchema,
  billingIdentityMismatch,
  invoicePdfFilename,
  type CrmInvoice,
  type InvoiceStatus,
  type MyBilling,
  type TenantBillingIdentity,
} from "@sm/contracts";
import { api, csvDownload } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import {
  Btn,
  Card,
  EmptyState,
  Field,
  Input,
  Panel,
  Pill,
  Skeleton,
  useToast,
} from "@/components/ui";

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

/**
 * MONTANT TTC D'UNE PIÈCE, avec repli sur le montant stocké.
 *
 * Le repli n'est pas de la superstition : la démonstration hors ligne rejoue un
 * instantané figé AVANT que la ventilation existe (`lib/demo`), et un « NaN € »
 * sur un écran de facturation est la pire chose qu'on puisse afficher à
 * quelqu'un qui essaie de savoir ce qu'il doit.
 */
const ttc = (f: CrmInvoice): number => f.totals?.ttcCents ?? f.amountCents;
const ht = (f: CrmInvoice): number => f.totals?.htCents ?? f.amountCents;

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

  /*
   * TOUT CE QUI S'AFFICHE ICI EST TTC, ET C'EST DÉLIBÉRÉ.
   *
   * Nos tarifs sont annoncés hors taxes — c'est le prix qui coûte réellement à
   * un professionnel, qui récupère la TVA — mais ce que le gérant PRÉLÈVE sur
   * son compte, lui, est TTC. Afficher 139 € là où 166,80 € partent du compte
   * en banque, c'est le rendez-vous téléphonique assuré. La formule reste donc
   * annoncée en HT (c'est le prix du contrat) et les ÉCHÉANCES en TTC (c'est le
   * mouvement bancaire), chacune disant laquelle elle est.
   *
   * Le repli sur les champs hors taxes couvre l'instantané de démonstration,
   * figé avant que la ventilation existe.
   */
  const totalDuTtc = outstanding.totalDueTtcCents ?? outstanding.totalDueCents;
  const enRetardTtc = outstanding.overdueTtcCents ?? outstanding.overdueCents;

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
                {/* TTC : c'est la somme à virer, pas celle du chiffre d'affaires. */}
                Il reste <strong>{fmtEuro(totalDuTtc)}</strong> à régler
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
            {fmtEuro(sub.mrrCents)} HT par mois · client depuis le {fmtJour(sub.since)}
          </p>
        </Card>

        <Card className="flex-1 p-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Prochaine échéance
          </div>
          <div className="cf-fig mt-2 text-[30px] font-extrabold leading-[1.1] text-ink">
            {nextDue ? fmtEuro(nextDue.amountTtcCents ?? nextDue.amountCents) : "—"}
          </div>
          <p className="cf-fig mt-1 text-[13px] text-mut">
            {nextDue ? (
              <>
                {/* Le montant du dessus est celui qui part du compte. Le HT est
                    rappelé dessous : c'est celui du contrat, et celui que son
                    comptable réintègre. */}
                TTC ({fmtEuro(nextDue.amountCents)} HT) · le {fmtJour(nextDue.at)} ·{" "}
                {echeance(nextDue.daysUntil)}
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
            {fmtEuro(totalDuTtc)}
          </div>
          <p className="cf-fig mt-1 text-[13px] text-mut">
            {outstanding.overdueInvoices > 0
              ? `${fmtEuro(enRetardTtc)} TTC en retard — la plus ancienne depuis ${outstanding.oldestOverdueDays} jour(s)`
              : outstanding.invoices > 0
                ? `TTC · ${outstanding.invoices} facture(s) en cours, échéance non dépassée`
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
            <table className="w-full min-w-[900px] border-collapse text-left">
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
                    Montant HT
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    TVA
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Total TTC
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
                    <td className="cf-fig whitespace-nowrap px-3 py-3 text-right text-sm text-mut">
                      {fmtEuro(ht(f))}
                    </td>
                    <td className="cf-fig whitespace-nowrap px-3 py-3 text-right text-sm text-mut">
                      {fmtEuro(f.totals?.vatCents ?? 0)}
                      {f.totals && (
                        <span className="ml-1 text-[11px]">({f.totals.rateLabel})</span>
                      )}
                    </td>
                    {/* Le TTC en gras : c'est le montant du relevé bancaire,
                        celui que le gérant cherche quand il rapproche. */}
                    <td className="cf-fig whitespace-nowrap px-3 py-3 text-right text-sm font-bold text-ink">
                      {fmtEuro(ttc(f))}
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

      <PanelIdentite
        identity={data.identity ?? EMPTY_BILLING_IDENTITY}
        editable={data.identityEditable !== false}
        onSaved={() => void load()}
      />

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

/**
 * « VOS INFORMATIONS DE FACTURATION » — ce que le gérant, et lui seul, sait.
 *
 * Sa raison sociale, sa forme juridique, son SIRET, son numéro de TVA et
 * l'adresse de son siège ne figurent nulle part chez nous : on ne les a jamais
 * demandés à l'inscription, et les chercher à sa place reviendrait à se tromper
 * à sa place sur une pièce qu'il présentera à son comptable. Il les saisit ici,
 * et elles s'impriment sur toutes ses factures — les prochaines comme les
 * anciennes, puisque le PDF est rendu à la demande.
 *
 * ─── LA VALIDATION EST CELLE DU SERVEUR, PAS UNE COPIE ───
 *
 * `TenantBillingIdentitySchema` et `billingIdentityMismatch` viennent de
 * @sm/contracts : ce sont EXACTEMENT les règles que l'API appliquera. Une
 * validation de formulaire réécrite à la main finit toujours par diverger, et
 * le jour où elle diverge, le gérant voit un champ vert refusé par le serveur
 * sans comprendre pourquoi. Ici, ce qui passe ici passe là-bas.
 *
 * La vérification reste FORMELLE : on contrôle la clé de Luhn d'un SIRET et la
 * clé d'un numéro de TVA — ce qui attrape la faute de frappe — mais jamais
 * l'existence de l'entreprise, qui demanderait d'interroger l'INSEE et de faire
 * attendre une saisie derrière un appel réseau.
 */
function PanelIdentite({
  identity,
  editable,
  onSaved,
}: {
  identity: TenantBillingIdentity;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<TenantBillingIdentity>(identity);
  const [errors, setErrors] = useState<Partial<Record<keyof TenantBillingIdentity, string>>>({});
  const [global, setGlobal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof TenantBillingIdentity) => (e: { target: { value: string } }) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setGlobal(null);
  };

  // Rien à enregistrer tant que rien n'a bougé : un bouton actif sur un
  // formulaire intact invite à cliquer pour rien.
  const modifie = JSON.stringify(form) !== JSON.stringify(identity);

  async function enregistrer() {
    if (saving) return;

    const parsed = TenantBillingIdentitySchema.safeParse(form);
    if (!parsed.success) {
      const champs: Partial<Record<keyof TenantBillingIdentity, string>> = {};
      for (const issue of parsed.error.issues) {
        const champ = issue.path[0] as keyof TenantBillingIdentity | undefined;
        if (champ && !champs[champ]) champs[champ] = issue.message;
      }
      setErrors(champs);
      return;
    }

    // La cohérence SIRET ↔ TVA porte sur DEUX champs : elle ne s'affiche donc
    // sous aucun des deux, mais au-dessus du bouton.
    const coherence = billingIdentityMismatch(parsed.data);
    if (coherence) {
      setGlobal(coherence);
      return;
    }

    setSaving(true);
    try {
      const enregistre = await api.put<TenantBillingIdentity>(
        "/billing/me/identity",
        parsed.data,
      );
      // On repart de ce que le SERVEUR a retenu, espaces du SIRET normalisés
      // compris : afficher la saisie brute laisserait croire qu'elle a été
      // stockée telle quelle.
      setForm(enregistre ?? parsed.data);
      setErrors({});
      toast("Informations de facturation enregistrées");
      onSaved();
    } catch (e) {
      setGlobal(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Vos informations de facturation"
      sub="Ce que nous imprimons sur vos factures. Vous seul les connaissez — nous ne les devinons jamais."
      actions={
        editable ? (
          <Btn
            variant="primary"
            size="sm"
            disabled={!modifie || saving}
            onClick={() => void enregistrer()}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Btn>
        ) : undefined
      }
    >
      {!editable && (
        <p className="mb-3.5 text-[13px] leading-[1.5] text-mut">
          Votre compte est suspendu : ces informations restent consultables mais ne
          peuvent pas être modifiées tant que l’accès n’est pas rétabli.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Field
          label="Raison sociale"
          htmlFor="fact-nom"
          hint="Le nom juridique, s’il diffère de l’enseigne. Vide = nous gardons votre enseigne."
          error={errors.legalName}
        >
          <Input
            id="fact-nom"
            value={form.legalName}
            onChange={set("legalName")}
            disabled={!editable}
            placeholder="CLASS’FOOD SARL"
            autoComplete="organization"
          />
        </Field>

        <Field
          label="Forme juridique et capital"
          htmlFor="fact-forme"
          error={errors.legalForm}
        >
          <Input
            id="fact-forme"
            value={form.legalForm}
            onChange={set("legalForm")}
            disabled={!editable}
            placeholder="SARL au capital de 10 000 €"
          />
        </Field>

        <Field
          label="SIRET"
          htmlFor="fact-siret"
          hint="14 chiffres, tels qu’ils figurent sur votre Kbis."
          error={errors.siret}
        >
          <Input
            id="fact-siret"
            value={form.siret}
            onChange={set("siret")}
            disabled={!editable}
            placeholder="732 829 320 00074"
            inputMode="numeric"
          />
        </Field>

        <Field
          label="TVA intracommunautaire"
          htmlFor="fact-tva"
          hint="Format FR + clé + les 9 chiffres de votre SIREN."
          error={errors.vatNumber}
        >
          <Input
            id="fact-tva"
            value={form.vatNumber}
            onChange={set("vatNumber")}
            disabled={!editable}
            placeholder="FR44732829320"
          />
        </Field>

        <Field
          label="Adresse de facturation"
          htmlFor="fact-adresse"
          hint="Votre siège, s’il diffère de l’adresse de l’établissement."
          error={errors.address}
          className="md:col-span-2"
        >
          <Input
            id="fact-adresse"
            value={form.address}
            onChange={set("address")}
            disabled={!editable}
            placeholder="12 rue du Siège — 27000 Évreux"
          />
        </Field>

        <Field
          label="E-mail de facturation"
          htmlFor="fact-email"
          hint="Où envoyer vos factures, si ce n’est pas l’adresse de votre compte."
          error={errors.email}
          className="md:col-span-2"
        >
          <Input
            id="fact-email"
            type="email"
            value={form.email}
            onChange={set("email")}
            disabled={!editable}
            placeholder="compta@votre-restaurant.fr"
            autoComplete="email"
          />
        </Field>
      </div>

      {global && (
        <p className="mt-3.5 text-[13px] text-alertt" role="alert">
          {global}
        </p>
      )}
    </Panel>
  );
}
