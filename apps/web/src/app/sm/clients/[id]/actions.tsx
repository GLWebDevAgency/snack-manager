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
  DEVICE_REVOKE_REASONS,
  INSTALL_FEE_CENTS,
  INVOICE_KIND_LABELS,
  ISSUABLE_INVOICE_KINDS,
  DEVICE_REVOKE_REASON_LABELS,
  proposalCents,
  type AdminPlan,
  type DeviceRevokeReason,
  type LeadServices,
  type ProposalBilling,
  remiseFondateurActive,
  CHURN_CAUSES,
  CHURN_CAUSE_LABELS,
  CHURN_CAUSE_HINTS,
  GESTE_DEROGATION_LABELS,
  ORIGINE_CAPACITE_LABELS,
  ROLES_ATTRIBUABLES,
  ROLE_COMPTE_HINTS,
  ROLE_COMPTE_LABELS,
  type CapaciteEffective,
  type ChurnCause,
  type CompteCree,
  type CompteRestaurant,
  type GesteDerogation,
  type RoleAttribuable,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import {
  Btn,
  Chip,
  Field,
  Icon,
  Input,
  Select,
  Textarea,
  Toggle,
  useToast,
} from "@/components/ui";
// La modale-feuille locale à `/sm` : la modale du design system au-dessus de
// `md`, une feuille plein écran en dessous — un geste grave se confirme aussi
// depuis un téléphone, sans panneau qui déborde.
import { SheetModal } from "../../mobile";
import { OffreFields } from "../../parts";
import { crm, errText, euroRound } from "../../crm";
import { euros } from "../../facturation/data";
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

// ─────────────────────────────────────────────────────────────
// Suspendre
// ─────────────────────────────────────────────────────────────

export function SuspendModal({ tenantId, tenantName, onClose, onDone }: Common) {
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
      await clientsApi.suspend(tenantId, reason.trim());
      toast(`${tenantName} — accès suspendu`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Suspension impossible — réessayez"));
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
            variant="danger"
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
      {refusal && <Refusal message={refusal} />}
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
  const [refusal, setRefusal] = useState<string | null>(null);

  const ok = reason.trim().length >= MIN_REASON;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.reactivate(tenantId, reason.trim());
      toast(`${tenantName} — accès rouvert`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Réactivation impossible — réessayez"));
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
            variant="success"
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
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Changer de formule
// ─────────────────────────────────────────────────────────────

/**
 * CHANGER L'OFFRE D'UN CLIENT — formule, module, engagement, services.
 *
 * Cette modale ne portait que la formule, et son sélecteur ne proposait même
 * pas « sans formule » : le module de commande en ligne et les services de
 * l'Atelier n'étaient ni affichables, ni activables, ni retirables après la
 * signature. Un restaurateur qui prenait les réseaux sociaux six mois plus tard
 * n'avait aucun chemin dans le logiciel — et comme toute la facturation lit ces
 * champs, sa facture ne bougeait pas non plus.
 *
 * Les champs viennent de `OffreFields`, le même composant que le panneau de
 * proposition : ce qu'on sait vendre, on sait le modifier.
 */
export function OffreModal({
  tenantId,
  tenantName,
  onClose,
  onDone,
  current,
}: Common & {
  current: {
    plan: AdminPlan | null;
    onlineOrdering: boolean;
    onlineDelivery?: boolean;
    standaloneLoyalty?: boolean;
    billingCycle: ProposalBilling;
    services: LeadServices;
    /** Fin de la remise fondateur, ou `null` — voir le chiffrage ci-dessous. */
    founderUntil: string | null;
    /** La remise MENSUELLE figée au contrat signé, ou `null`. */
    founderDiscountCents: number | null;
  };
}) {
  const toast = useToast();
  const [plan, setPlan] = useState<AdminPlan | null>(current.plan);
  const [module, setModule] = useState(current.onlineOrdering);
  const [delivery, setDelivery] = useState(current.onlineDelivery ?? false);
  const [loyalty, setLoyalty] = useState(current.standaloneLoyalty ?? false);
  const [billing, setBilling] = useState<ProposalBilling>(current.billingCycle);
  const [services, setServices] = useState<LeadServices>(current.services);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const avant = proposalCents({
    plan: current.plan,
    onlineOrdering: current.onlineOrdering,
    onlineDelivery: current.onlineDelivery,
    standaloneLoyalty: current.standaloneLoyalty,
    services: current.services,
  });
  const apres = proposalCents({ plan, onlineOrdering: module, onlineDelivery: delivery, standaloneLoyalty: loyalty, services });
  const mrrAvant = avant.monthlyCents + avant.servicesMonthlyCents;
  const mrrApres = apres.monthlyCents + apres.servicesMonthlyCents;
  const delta = mrrApres - mrrAvant;

  /**
   * CE QU'IL PAIERA VRAIMENT — la fiche l'affiche deux lignes plus haut.
   *
   * La modale ne chiffrait qu'au tarif public : sur un fondateur, elle
   * annonçait « 159 € → 238 € » à côté d'une fiche disant « 119 € par mois ».
   * L'opérateur au téléphone lisait le mauvais chiffre au client.
   *
   * Le DELTA, lui, est déjà juste au tarif public — et c'est la règle : la
   * remise est un montant figé au contrat signé, ce qui s'ajoute ensuite se
   * paie plein tarif. C'est le total qu'il fallait corriger, pas l'écart.
   */
  const remise = remiseFondateurActive(current.founderUntil)
    ? Math.min(current.founderDiscountCents ?? 0, mrrApres)
    : 0;
  const duApres = mrrApres - remise;
  const duAvant = Math.max(0, mrrAvant - Math.min(current.founderDiscountCents ?? 0, mrrAvant));
  const changed =
    plan !== current.plan ||
    module !== current.onlineOrdering ||
    delivery !== (current.onlineDelivery ?? false) ||
    loyalty !== (current.standaloneLoyalty ?? false) ||
    billing !== current.billingCycle ||
    JSON.stringify(services) !== JSON.stringify(current.services);

  async function run() {
    if (!changed || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.changeOffre(tenantId, {
        plan,
        onlineOrdering: module,
        onlineDelivery: delivery,
        standaloneLoyalty: loyalty,
        billing,
        services,
        reason: reason.trim(),
      });
      toast(`Offre de ${tenantName} mise à jour`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      // Le refus vient des règles de composition (module greffé sans
      // intégration, offre vide…) : on l'affiche mot pour mot plutôt que de
      // le paraphraser — l'API sait mieux que nous ce qu'elle a refusé — et
      // il reste à l'écran le temps d'être relu.
      setRefusal(errText(e, "Changement d’offre impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Offre de ${tenantName}`}
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
            {busy ? "Enregistrement…" : "Appliquer l’offre"}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Formule, module de commande en ligne et services de l&apos;Atelier — tout
        ce que ce client achète. Le statut du compte n&apos;est pas touché :
        passer un client en Boost n&apos;est pas une décision d&apos;accès.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <OffreFields
          plan={plan}
          setPlan={setPlan}
          module={module}
          setModule={setModule}
          delivery={delivery}
          setDelivery={setDelivery}
          loyalty={loyalty}
          setLoyalty={setLoyalty}
          billing={billing}
          setBilling={setBilling}
          services={services}
          setServices={setServices}
          idPrefix="offre"
        />
      </div>
      {changed && (
        <div className="mt-3 flex items-center gap-2 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3 text-[13px]">
          <Icon name="euro" size={16} className="shrink-0 text-accent" />
          <span className="text-mut">
            Récurrent {euroRound(remise > 0 ? duAvant : mrrAvant)} →{" "}
            <span className="cf-fig font-extrabold text-ink">
              {euroRound(remise > 0 ? duApres : mrrApres)}
            </span>{" "}
            par mois
            {delta !== 0 && (
              <>
                {" ("}
                <span className={cx("cf-fig font-extrabold", delta > 0 ? "text-okt" : "text-alertt")}>
                  {delta > 0 ? "+" : "−"}
                  {euroRound(Math.abs(delta))}
                </span>
                {")"}
              </>
            )}{" "}
            — d&apos;après la grille ; la facturation reste la source de vérité.
            {remise > 0 && (
              <>
                {" "}
                <span className="text-gold">
                  Remise fondateur de {euroRound(remise)} déduite ({euroRound(mrrApres)} au tarif
                  public). Elle est figée au contrat signé : ce qui s&apos;ajoute aujourd&apos;hui
                  se paie plein tarif.
                </span>
              </>
            )}
          </span>
        </div>
      )}
      <Field
        className="mt-3"
        label="Motif"
        htmlFor="offre-reason"
        hint="Facultatif — mais « demandé par le gérant au téléphone » vaut mieux que rien."
      >
        <Textarea
          id="offre-reason"
          rows={2}
          placeholder="Le gérant ajoute les réseaux sociaux."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

/**
 * ÉMETTRE UNE FACTURE — le geste qui n'existait nulle part.
 *
 * `POST /crm/tenants/:id/invoices` était écrit, testé, et n'avait AUCUN
 * appelant dans toute l'application. Conséquences : les brouillons posés
 * automatiquement à la signature ne pouvaient jamais partir, et l'abonnement du
 * mois suivant n'était jamais facturé. La file de recouvrement pouvait rester
 * vide non parce que le parc était à jour, mais parce que rien n'avait jamais
 * été facturé.
 *
 * Le montant est FACULTATIF et c'est délibéré : laissé vide, l'API applique
 * l'offre du client — formule, module, services et remise fondateur comprises.
 * Le saisir à la main est l'exception, pas la règle : c'est ainsi qu'on évite
 * de recopier de tête un chiffre que le serveur sait calculer.
 */
export function EmettreFactureModal({
  tenantId,
  tenantName,
  onClose,
  onDone,
  mrrCents,
}: Common & { mrrCents: number }) {
  const toast = useToast();
  const [kind, setKind] = useState<(typeof ISSUABLE_INVOICE_KINDS)[number]>("abonnement");
  const [period, setPeriod] = useState(moisCourant());
  const [montant, setMontant] = useState("");
  const [label, setLabel] = useState("");
  // BROUILLON PAR DÉFAUT, comme la passe mensuelle. Émettre crée une créance
  // qui entre au recouvrement et ne s'efface pas — elle s'annule avec un
  // motif, qui reste au dossier. Le geste sûr est celui qu'on propose ; l'autre
  // reste à un clic, délibérément.
  const [draft, setDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Ce que l'API facturera si le champ reste vide — affiché pour que personne
  // n'ait à le deviner, ni à le ressaisir « pour être sûr ».
  //
  // AU CENTIME, jamais arrondi à l'euro : sur un fondateur à 49,50 €, l'écran
  // annonçait « 50 € » et l'API facturait 49,50 €. Un opérateur qui recopie ce
  // qu'il lit fabrique alors un écart de cinquante centimes, sur une pièce
  // comptable, sans que rien ne le signale.
  const parDefaut = kind === "mise_en_place" ? INSTALL_FEE_CENTS : mrrCents;
  // Un MRR à zéro, c'est aussi la ligne parc qui n'a pas chargé (le parent
  // retombe sur 0) : promettre « 0,00 € » serait mentir — l'API, elle,
  // facturera l'offre réelle. Sans chiffre sûr, on n'en écrit pas.
  const defautConnu = kind === "mise_en_place" || mrrCents > 0;
  const saisi = montant.trim() === "" ? null : Math.round(Number(montant.replace(",", ".")) * 100);
  const montantInvalide = saisi !== null && (!Number.isFinite(saisi) || saisi < 0);

  async function run() {
    if (busy || montantInvalide) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.issueInvoice(tenantId, {
        kind,
        period,
        label: label.trim(),
        draft,
        ...(saisi !== null ? { amountCents: saisi } : {}),
      });
      toast(draft ? `Brouillon posé pour ${tenantName}` : `Facture émise pour ${tenantName}`, {
        icon: "check",
      });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Émission impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Facturer ${tenantName}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={busy || montantInvalide}
            onClick={() => void run()}
          >
            {busy
              ? "Émission…"
              : draft
                ? "Poser le brouillon"
                : saisi !== null || defautConnu
                  ? `Émettre — ${euros(saisi ?? parDefaut)} dus`
                  : "Émettre la facture"}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Une facture émise crée une créance : elle entre dans la file de
        recouvrement et compte dans l&apos;ardoise du client. Un brouillon, non
        — il attend d&apos;être envoyé.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Field label="Nature" htmlFor="fact-kind">
          <Select
            id="fact-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {ISSUABLE_INVOICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {INVOICE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mois facturé" htmlFor="fact-period">
          <Input
            id="fact-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
      </div>
      <Field
        className="mt-3"
        label="Montant HT"
        htmlFor="fact-montant"
        error={montantInvalide ? "Montant invalide — saisissez un nombre, ou laissez vide." : undefined}
        hint={
          kind === "mise_en_place"
            ? // La remise fondateur est figée au contrat signé : une prestation
              // commandée APRÈS se paie plein tarif. Écrit, sinon un opérateur
              // « corrige » la moitié à la main en croyant bien faire.
              `Laissez vide pour le tarif de la mise en place — ${euros(parDefaut)}. Une prestation commandée après la signature n’est pas couverte par la remise fondateur.`
            : defautConnu
              ? `Laissez vide pour appliquer l’offre du client — ${euros(parDefaut)}, remise fondateur comprise.`
              : "Laissez vide pour appliquer l’offre du client — montant calculé par l’API, remise fondateur comprise."
        }
      >
        <Input
          id="fact-montant"
          inputMode="decimal"
          aria-invalid={montantInvalide || undefined}
          placeholder={defautConnu ? (parDefaut / 100).toFixed(2) : undefined}
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
        />
      </Field>
      <Field
        className="mt-3"
        label="Libellé"
        htmlFor="fact-label"
        hint="Facultatif — sinon l’intitulé se déduit de la nature et de la formule."
      >
        <Input
          id="fact-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Abonnement Complet — septembre 2026"
        />
      </Field>
      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs text-mut">
          Poser en brouillon — rien n&apos;est dû tant qu&apos;il n&apos;est pas
          envoyé. Utile pour préparer une pièce avant la fin d&apos;essai.
        </div>
        <Toggle on={draft} label="Brouillon" onChange={setDraft} />
      </div>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

/** Le mois courant en `AAAA-MM` — ce que l'API attend et ce qu'un `<input type="month">` rend. */
function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  // `null` tant que rien n'est révoqué ; ensuite l'écran de fin, avec ou sans
  // code — deux états distincts, sinon un succès sans code laisserait la
  // modale sur « Révoquer maintenant » et l'opérateur re-cliquerait sur un
  // appareil déjà coupé.
  const [fin, setFin] = useState<{ code: string | null } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run() {
    if (!confirmed || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await clientsApi.revokeDevice(tenantId, device, {
        reason,
        note: note.trim(),
      });
      // Le code peut ne pas être renvoyé (écran, API plus ancienne) : la
      // révocation reste un succès, on ne bloque pas là-dessus.
      const pairing = (res as { pairing?: { code?: unknown } })?.pairing?.code;
      setFin({ code: typeof pairing === "string" ? pairing : null });
      toast(`${device.name} révoqué — ${DEVICE_REVOKE_REASON_LABELS[reason]}`, {
        icon: "check",
      });
      onDone();
    } catch (e) {
      setRefusal(errText(e, "Révocation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  // ── Après coup : le code à dicter ──
  if (fin) {
    return (
      <SheetModal
        open
        onClose={onClose}
        // Le CRM n'affiche ce code qu'ici : un Échap réflexe ou un clic à
        // côté du panneau pendant l'appel le perdrait — fermeture explicite.
        destructive
        title={`${device.name} est coupé`}
        footer={
          <Btn variant="primary" size="sm" icon="check" onClick={onClose}>
            Terminé
          </Btn>
        }
      >
        {fin.code !== null ? (
          <>
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
                {fin.code}
              </div>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-mut">
            Le jeton est détruit : cet appareil n&apos;accède plus à rien. Il
            repart en attente d&apos;appairage — aucun code d&apos;appairage
            renvoyé ici : le gérant le retrouve dans son back-office, écran
            Appareils.
          </p>
        )}
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
            variant="danger"
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
      {refusal && <Refusal message={refusal} />}
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

/**
 * LE REFUS DE L'API, AFFICHÉ TEL QUEL — le même motif que `facturation/ui.tsx`.
 *
 * Il reste À L'ÉCRAN, dans la modale, plutôt que de partir avec un toast de
 * 2,2 s : un refus arrive au moment précis où l'on a besoin de relire ce qui
 * a été refusé — et le formulaire reste là, prêt à être corrigé.
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

// ─────────────────────────────────────────────────────────────
// Dérogation de capacité
// ─────────────────────────────────────────────────────────────

/**
 * OUVRIR OU FERMER UNE FONCTION HORS FORMULE — l'exception commerciale, tracée.
 *
 * Le geste est déjà DÉCIDÉ quand cette modale s'ouvre : la ligne du panneau
 * savait laquelle des trois actions elle appelait. Il ne reste donc à saisir
 * que ce qui manque vraiment — le motif —, et à lire ce que ça change.
 *
 * MOTIF OBLIGATOIRE SUR LES TROIS GESTES, levée comprise. Une capacité ouverte
 * hors formule est un manque à gagner, une capacité fermée malgré la formule
 * est un litige : dans les deux cas quelqu'un demandera « pourquoi ? » six mois
 * plus tard. L'API l'exige aussi — cette modale ne fait pas semblant d'être la
 * garde.
 */
export function CapaciteModal({
  tenantId,
  tenantName,
  capacite,
  geste,
  onClose,
  onDone,
}: Common & { capacite: CapaciteEffective; geste: GesteDerogation }) {
  const toast = useToast();
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const ok = motif.trim().length >= MIN_REASON;
  // Ce que la LEVÉE produit dépend de la formule : effacer un octroi ferme la
  // fonction, effacer un retrait la rouvre. Le dire avant le bouton évite le
  // geste qu'on croit neutre et qui coupe un module en plein service.
  const leveeOuvre = capacite.derogation?.sens === "retiree";
  const ferme = geste === "retiree" || (geste === "levee" && !leveeOuvre);

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.changeCapacite(tenantId, {
        capacite: capacite.capacite,
        geste,
        motif: motif.trim(),
      });
      toast(`${capacite.label} — ${geste === "levee" ? "dérogation levée" : geste === "accordee" ? "accordée" : "retirée"}`, {
        icon: "check",
      });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Geste impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      destructive={ferme}
      title={`${GESTE_DEROGATION_LABELS[geste]} — ${capacite.label}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            icon={ferme ? "close" : "check"}
            variant={ferme ? "danger" : "success"}
            disabled={!ok || busy}
            onClick={() => void run()}
          >
            {busy ? "Enregistrement…" : GESTE_DEROGATION_LABELS[geste]}
          </Btn>
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-[1.45] text-mut">
        {tenantName} — aujourd&apos;hui{" "}
        {capacite.acquise ? "ouvert" : "fermé"}
        {capacite.origine ? ` (${ORIGINE_CAPACITE_LABELS[capacite.origine].toLowerCase()})` : ""}.
      </p>

      <Consequences
        tone={ferme ? "alert" : "ok"}
        does={
          geste === "accordee"
            ? [
                `« ${capacite.label} » s'ouvre pour ce restaurant, sans changer sa formule.`,
                "La ligne est datée, signée et motivée : elle se relit dans le journal du client.",
              ]
            : geste === "retiree"
              ? [
                  `« ${capacite.label} » se ferme, même si sa formule la comprend.`,
                  "Le gérant voit l'entrée verrouillée avec la phrase de la grille, jamais une erreur technique.",
                ]
              : leveeOuvre
                ? [
                    "Le retrait est effacé : la fonction revient à ce que dit sa formule.",
                    "La levée est journalisée comme les deux autres gestes, avec son motif.",
                  ]
                : [
                    "L'octroi est effacé : la fonction revient à ce que dit sa formule.",
                    "La levée est journalisée comme les deux autres gestes, avec son motif.",
                  ]
        }
        doesNot={[
          "Sa formule, son engagement et sa facture ne bougent pas — une dérogation est ce qui s'écarte de la grille, pas une vente.",
          "Rien n'est effacé côté restaurant : ses données, son menu et son historique restent en place.",
        ]}
      />

      <Field
        className="mt-4"
        label="Motif de la dérogation"
        htmlFor="capacite-motif"
        hint="Obligatoire — c'est ce qu'on relira quand quelqu'un demandera pourquoi ce client-là l'avait."
      >
        <Textarea
          id="capacite-motif"
          autoFocus
          rows={3}
          placeholder={
            geste === "accordee"
              ? "Pilote fidélité — vendue en Boost, tournée en Complet le temps de l'essai."
              : geste === "retiree"
                ? "Module coupé le temps du litige sur la facture de juillet."
                : "Dérogation posée par erreur sur le mauvais établissement."
          }
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
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
  const [refusal, setRefusal] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      setFait(await crm.resetOwner(tenantId));
      onDone();
    } catch (e) {
      setRefusal(errText(e, "Réinitialisation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      // Une fois le mot de passe affiché, un Échap réflexe ou un clic sur le
      // voile le perdrait — et il ne sera jamais réaffiché. Fermeture
      // explicite uniquement, comme SuspendModal.
      destructive={fait !== null}
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
            À dicter ou copier MAINTENANT pour{" "}
            {/* `break-all` : une adresse longue se replie au lieu de forcer
                le corps de la modale à défiler horizontalement. */}
            <b className="break-all text-ink">{fait.ownerEmail}</b> — il ne
            sera jamais réaffiché.
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
        <>
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
          {refusal && <Refusal message={refusal} />}
        </>
      )}
    </SheetModal>
  );
}

/**
 * ACTER LE DÉPART D'UN CLIENT — et capter POURQUOI.
 *
 * `POST /crm/tenants/:id/churn` était écrite, testée, et n'avait aucun
 * appelant : aucun écran ne permettait de sortir un client du parc. Il restait
 * « actif », comptait dans le MRR, apparaissait dans la file de recouvrement —
 * et sa raison de partir n'était consignée nulle part.
 *
 * ── La CAUSE, avant le détail ─────────────────────────────────────────────
 *
 * Un motif en texte libre ne s'agrège pas : six départs donnent six phrases, et
 * aucun tableau. Or c'est la question qu'un éditeur doit pouvoir se poser au
 * bout d'un an — prix, complexité, fonction manquante ? — et elle ne se répond
 * qu'avec une cause structurée. La liste est courte : un menu de quinze causes
 * se remplit au hasard.
 *
 * Le détail libre reste obligatoire. C'est lui qui porte le cas particulier, et
 * c'est lui qu'on relit avant d'appeler pour tenter de récupérer le client.
 *
 * ── Ce geste ne coupe PAS l'accès ─────────────────────────────────────────
 *
 * Un départ n'est pas une suspension : il constate, il ne sanctionne pas. Le
 * gérant qui part garde ses données le temps de les récupérer — et un client
 * qu'on chasse est un client qui ne revient jamais.
 */
export function ChurnModal({ tenantId, tenantName, onClose, onDone }: Common) {
  const toast = useToast();
  const [cause, setCause] = useState<ChurnCause | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const pret = cause !== null && reason.trim().length >= MIN_REASON;

  async function run() {
    if (!pret || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.churn(tenantId, { cause, reason: reason.trim() });
      toast(`${tenantName} est sorti du parc`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Impossible d’acter le départ — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      // Même verrou que Suspendre : trois lignes de verbatim tapées au
      // téléphone ne doivent pas partir sur un Échap réflexe ou un clic à
      // côté du panneau.
      destructive
      title={`Départ de ${tenantName}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon="check"
            disabled={!pret || busy}
            onClick={() => void run()}
          >
            {busy ? "Enregistrement…" : "Acter le départ"}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-mut">
        Le client sort du parc : il ne compte plus dans le MRR ni dans la file de
        recouvrement. Son accès n&apos;est PAS coupé — un départ se constate, il ne se
        sanctionne pas, et le gérant garde ses données le temps de les récupérer.
      </p>

      <div className="mt-4 flex flex-col gap-1.5">
        <span
          id="churn-cause-label"
          className="block text-xs font-bold uppercase tracking-[0.04em] text-mut"
        >
          Pourquoi part-il ?
        </span>
        {/* `role="group"` relié à la question : au lecteur d'écran, « Prix,
            bouton » n'a de sens que rattaché à « Pourquoi part-il ? ». */}
        <div role="group" aria-labelledby="churn-cause-label" className="flex flex-wrap gap-1.5">
          {CHURN_CAUSES.map((c) => (
            <Chip key={c} on={cause === c} onClick={() => setCause(c)}>
              {CHURN_CAUSE_LABELS[c]}
            </Chip>
          ))}
        </div>
        {cause ? (
          <p className="mt-1 text-[12px] text-mut">{CHURN_CAUSE_HINTS[cause]}</p>
        ) : (
          // Le bouton reste grisé tant qu'une cause manque : sans cette
          // ligne, rien à l'écran ne le dit.
          <p className="mt-1 text-[12px] text-mut">
            Obligatoire — une seule cause, la principale.
          </p>
        )}
      </div>

      <Field
        className="mt-3"
        label="Ce qu’il a dit"
        htmlFor="churn-reason"
        hint="Obligatoire — ses mots, pas les vôtres : c’est ce qu’on relit avant de tenter de le récupérer."
      >
        <Textarea
          id="churn-reason"
          rows={3}
          placeholder="« On a fermé le service du midi, le logiciel ne se rentabilise plus. »"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

// ─────────────────────────────────────────────────────────────
// Comptes du restaurant
// ─────────────────────────────────────────────────────────────

/**
 * OUVRIR UN COMPTE — et remettre son mot de passe UNE fois.
 *
 * ── Pourquoi cette modale ressemble à `ResetOwnerModal` ────────────────────
 *
 * Parce que c'est le MÊME chemin, et qu'il est déjà éprouvé : le serveur
 * fabrique le secret, le rend une fois dans la réponse, et l'opérateur le dicte
 * au téléphone. C'est ce qui dispense le produit d'un courriel transactionnel —
 * donc d'un expéditeur vérifié, d'une file d'envoi, de jetons à durée de vie,
 * d'une page publique de choix de mot de passe et de la surveillance des
 * rebonds. Cinq pièces neuves en moins, chacune capable de tomber en silence.
 *
 * ── Pas de motif, et c'est délibéré ───────────────────────────────────────
 *
 * Suspendre, révoquer et changer un rôle se SUBISSENT : le motif est ce qu'on
 * relit au litige. Ouvrir un compte se demande — c'est le restaurateur qui
 * appelle pour l'obtenir. Le journal porte l'adresse, le rôle et l'auteur, ce
 * qui répond déjà à « qui a ouvert cet accès, quand, pour qui ».
 */
export function CreerCompteModal({
  tenantId,
  tenantName,
  restants,
  onClose,
  onDone,
}: Common & { restants: number }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<RoleAttribuable>("cogerant");
  const [busy, setBusy] = useState(false);
  const [fait, setFait] = useState<CompteCree | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Le formulaire, pas la garde : l'API refuse en français, et c'est ce refus
  // que `Refusal` affiche. Ces deux conditions n'existent que pour ne pas
  // proposer un bouton qui échouerait à coup sûr.
  const ok = /.@./.test(email.trim()) && nom.trim().length >= 2;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      setFait(
        await clientsApi.creerCompte(tenantId, {
          email: email.trim(),
          nom: nom.trim(),
          role,
        }),
      );
      onDone();
    } catch (e) {
      setRefusal(errText(e, "Ouverture impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      // Une fois le mot de passe affiché, un Échap réflexe ou un clic sur le
      // voile le perdrait — et il ne sera jamais réaffiché.
      destructive={fait !== null}
      title={`Ouvrir un compte — ${tenantName}`}
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
            <Btn size="sm" icon="user" disabled={!ok || busy} onClick={() => void run()}>
              {busy ? "Ouverture…" : "Ouvrir le compte"}
            </Btn>
          </>
        )
      }
    >
      {fait ? (
        <div>
          <p className="text-[13px] text-mut">
            À dicter ou copier MAINTENANT pour{" "}
            <b className="break-all text-ink">{fait.email}</b> ({fait.roleLabel.toLowerCase()}) —
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
        <>
          <Consequences
            tone="ok"
            does={[
              "Un mot de passe est fabriqué et remis UNE fois, ici — à dicter au téléphone.",
              "La personne se connecte avec son adresse, sur le même back-office que le gérant.",
              "Le geste s'inscrit au journal de l'établissement, avec l'adresse et le rôle.",
            ]}
            doesNot={[
              "Aucun e-mail n'est envoyé : c'est vous qui remettez l'accès.",
              "Le mot de passe du propriétaire ne bouge pas — les comptes sont indépendants.",
            ]}
          />

          <Field
            className="mt-4"
            label="Adresse e-mail"
            htmlFor="compte-email"
            hint="C'est son identifiant de connexion. Une adresse ne peut appartenir qu'à un seul établissement."
          >
            <Input
              id="compte-email"
              type="email"
              autoFocus
              inputMode="email"
              autoComplete="off"
              placeholder="sarah@classfood.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field
            className="mt-3"
            label="Nom de la personne"
            htmlFor="compte-nom"
            hint="Recopié dans le registre des gestes sensibles à chaque action — il ne s'y réécrit jamais."
          >
            <Input
              id="compte-nom"
              autoComplete="off"
              placeholder="Sarah Benali"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
            />
          </Field>

          <Field className="mt-3" label="Rôle" htmlFor="compte-role">
            <Select
              id="compte-role"
              value={role}
              onChange={(e) => setRole(e.target.value as RoleAttribuable)}
            >
              {ROLES_ATTRIBUABLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_COMPTE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {/* CE QUE LE RÔLE OUVRE, sous le choix : c'est la question que
              l'opérateur se pose au moment de choisir, pas après. */}
          <p className="mt-2 text-[12.5px] leading-[1.45] text-mut">{ROLE_COMPTE_HINTS[role]}</p>

          <p className="mt-3 text-[12.5px] text-mut">
            {restants > 1
              ? `${restants} comptes restent à ouvrir sur l'offre de ce client.`
              : "C'est le dernier compte que l'offre de ce client autorise."}
          </p>
          {refusal && <Refusal message={refusal} />}
        </>
      )}
    </SheetModal>
  );
}

/**
 * CHANGER LE RÔLE D'UN COMPTE — motif obligatoire, sessions coupées.
 *
 * Le geste retire ou accorde des droits sur l'outil de travail de quelqu'un, et
 * le déconnecte dans la seconde. Sans motif au journal, la personne vit une
 * déconnexion inexpliquée et l'équipe n'a rien à lui répondre.
 */
export function CompteRoleModal({
  tenantId,
  compte,
  onClose,
  onDone,
}: Omit<Common, "tenantName"> & { compte: CompteRestaurant }) {
  const toast = useToast();
  // Le rôle proposé par défaut est l'AUTRE : c'est le seul geste qui ait un
  // sens sur deux rôles attribuables, et l'API refuse celui qui ne change rien.
  const autre = ROLES_ATTRIBUABLES.find((r) => r !== compte.role) ?? "cogerant";
  const [role, setRole] = useState<RoleAttribuable>(autre);
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const ok = motif.trim().length >= MIN_REASON && role !== compte.role;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.changerRoleCompte(tenantId, compte.id, { role, motif: motif.trim() });
      toast(`${compte.email} — ${ROLE_COMPTE_LABELS[role].toLowerCase()}`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Changement impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      title={`Changer le rôle — ${compte.nom || compte.email}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn size="sm" icon="check" disabled={!ok || busy} onClick={() => void run()}>
            {busy ? "Enregistrement…" : "Changer le rôle"}
          </Btn>
        </>
      }
    >
      <p className="mb-3 break-all text-[13px] text-mut">
        {compte.email} — aujourd&apos;hui {compte.roleLabel.toLowerCase()}.
      </p>

      <Consequences
        tone="alert"
        does={[
          "Ses sessions ouvertes se ferment immédiatement, back-office et temps réel compris.",
          "Il retrouve l'accès en se reconnectant, avec le même mot de passe.",
          "Le motif s'inscrit au journal de l'établissement.",
        ]}
        doesNot={[
          "Son mot de passe ne change pas — pour le renouveler, il faut le révoquer et le rouvrir.",
          "Les tablettes appairées ne bougent pas : la caisse et la cuisine continuent.",
        ]}
      />

      <Field className="mt-4" label="Nouveau rôle" htmlFor="role-cible">
        <Select
          id="role-cible"
          value={role}
          onChange={(e) => setRole(e.target.value as RoleAttribuable)}
        >
          {ROLES_ATTRIBUABLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_COMPTE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-2 text-[12.5px] leading-[1.45] text-mut">{ROLE_COMPTE_HINTS[role]}</p>

      <Field
        className="mt-3"
        label="Motif du changement"
        htmlFor="role-motif"
        hint="Obligatoire — c'est ce qu'on relira quand quelqu'un demandera pourquoi cet accès a changé."
      >
        <Textarea
          id="role-motif"
          rows={3}
          placeholder="Reprend la comptabilité, ne fait plus le service."
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}

/**
 * RÉVOQUER UN COMPTE — le geste irréversible de cette section.
 *
 * Le document est SUPPRIMÉ, pas désactivé : l'adresse redevient libre pour la
 * personne qui remplace celle qui part, et aucune empreinte de mot de passe ne
 * dort en base. Ce qui survit, ce sont les REGISTRES — le journal porte
 * l'adresse et le rôle, et le registre des gestes sensibles a recopié l'auteur
 * de chaque ligne au moment du geste. « Qui a annulé cette commande en mars »
 * se relit à l'identique après le départ.
 */
export function CompteRevokeModal({
  tenantId,
  compte,
  onClose,
  onDone,
}: Omit<Common, "tenantName"> & { compte: CompteRestaurant }) {
  const toast = useToast();
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const ok = motif.trim().length >= MIN_REASON;

  async function run() {
    if (!ok || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      await clientsApi.revoquerCompte(tenantId, compte.id, motif.trim());
      toast(`${compte.email} — compte révoqué`, { icon: "check" });
      onDone();
      onClose();
    } catch (e) {
      setRefusal(errText(e, "Révocation impossible — réessayez"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal
      open
      onClose={onClose}
      destructive
      title={`Révoquer ${compte.nom || compte.email}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Annuler
          </Btn>
          <Btn
            size="sm"
            icon="trash"
            variant="danger"
            disabled={!ok || busy}
            onClick={() => void run()}
          >
            {busy ? "Révocation…" : "Révoquer le compte"}
          </Btn>
        </>
      }
    >
      <p className="mb-3 break-all text-[13px] text-mut">
        {compte.email} — {compte.roleLabel.toLowerCase()}.
      </p>

      <Consequences
        tone="alert"
        does={[
          "Le compte est supprimé : ses sessions se ferment immédiatement et son mot de passe ne vaut plus rien.",
          "Son adresse redevient libre — elle pourra servir à la personne qui le remplace.",
          "Le motif s'inscrit au journal, avec l'adresse et le rôle du compte fermé.",
        ]}
        doesNot={[
          "Le registre des gestes sensibles ne bouge PAS : ce qu'il a fait reste signé de son nom.",
          "Les tablettes appairées ne bougent pas non plus — un code de comptoir n'est pas un compte.",
          "Ce compte ne se restaure pas : le rouvrir, c'est en fabriquer un nouveau.",
        ]}
      />

      <Field
        className="mt-4"
        label="Motif de la révocation"
        htmlFor="revoke-compte-motif"
        hint="Obligatoire — c'est ce qu'on relira dans le journal."
      >
        <Textarea
          id="revoke-compte-motif"
          autoFocus
          rows={3}
          placeholder="A quitté l'établissement le 30/08, remplacé par Karim."
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
      </Field>
      {refusal && <Refusal message={refusal} />}
    </SheetModal>
  );
}
