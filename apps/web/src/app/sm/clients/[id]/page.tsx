"use client";

/**
 * FICHE CLIENT — l'écran que l'équipe ouvre AVANT de décrocher.
 *
 * Tout ce qu'il faut pour tenir un appel de bout en bout : qui c'est, comment
 * il va, ce qu'il paie sans s'en servir, si ses tablettes répondent, ce qui va
 * lui manquer, ce qu'on peut lui apporter, et ce qu'on lui a déjà dit. Les
 * gestes graves (suspendre, révoquer) sont là aussi — c'est le sens de
 * « gérer un client de A à Z ».
 *
 * ─── Cloisonnement ───
 * Cette page lit et ÉCRIT sur n'importe quel établissement du parc. Réservée au
 * rôle `sm_admin` : garde `@Roles('sm_admin')` côté API (403 quoi qu'affiche le
 * navigateur) et redirection côté coquille `/sm`. Un gérant de restaurant ne
 * doit ni y accéder, ni deviner qu'elle existe.
 *
 * ─── Respect des clients de nos clients ───
 * Aucun consommateur final n'apparaît sur cet écran. Tout ce qui touche à
 * l'activité est AGRÉGÉ — commandes, chiffre d'affaires, panier moyen,
 * créneaux. La seule identité nommée est celle du restaurateur : notre
 * interlocuteur. Son fichier client lui appartient, et le détenir nous rendrait
 * responsables de sa protection sans qu'aucune décision d'administration ne
 * l'exige.
 *
 * ─── Dégradation ───
 * `/health`, `/insights` et `/signals` s'écrivent en parallèle. Chaque section
 * absente le dit explicitement : au téléphone, « pas encore branché » et « rien
 * à signaler » ne se confondent pas. La fiche s'ouvre et les boutons d'action
 * marchent même quand toutes ces routes sont muettes.
 */

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_SERVICES,
  DEFAULT_TENANT_ACCOUNT_STATUS,
  planChoiceLabel,
  isAccessBlocked,
  type AdminPlan,
  type CapaciteEffective,
  type CompteRestaurant,
  type GesteDerogation,
} from "@sm/contracts";
import { ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Icon, Skeleton } from "@/components/ui";
import { euroRound, fmtDay, fmtMonth, int } from "../../crm";
import { resumeAtelier } from "../../parts";
import { loadClientFile, type ClientFile, type ParkDevice } from "../data";
import { AccountPill, PlanPill, ScorePill, Unavailable } from "../ui";
import { FacturesCard } from "./Factures";
import {
  CapaciteModal,
  CompteRevokeModal,
  CompteRoleModal,
  CreerCompteModal,
  EmettreFactureModal,
  OffreModal,
  ResetOwnerModal,
  ReactivateModal,
  RevokeDeviceModal,
  SuspendModal,
  ChurnModal,
} from "./actions";
import { BadgeFondateur } from "@/components/brand/BadgeFondateur";
import {
  AccesSection,
  AdoptionSection,
  AdviceSection,
  ComptesSection,
  DevicesSection,
  HealthSection,
  NotesSection,
  SignalsSection,
  SupplySection,
} from "./sections";

export default function ClientFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // `params` est une promesse depuis Next 15 : `use()` la déballe dans un
  // composant client, sans transformer la page en composant serveur (la
  // coquille `/sm` tout entière est cliente — le jeton vit en localStorage).
  const { id } = use(params);

  const [file, setFile] = useState<ClientFile | null>(null);
  // Miroir de `file` lisible depuis l'effet sans figurer dans ses dépendances :
  // c'est lui qui permet de refuser d'écraser une fiche affichée et juste.
  const fileRef = useRef<ClientFile | null>(null);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [tick, setTick] = useState(0);
  // Rechargement alors qu'une fiche est déjà à l'écran : l'état affiché est
  // périmé le temps que les routes répondent — il se voile et se gèle.
  const [rechargement, setRechargement] = useState(false);
  // Le dernier rafraîchissement de fond est revenu entièrement muet : la
  // fiche affichée date d'avant le geste, et un bandeau le dit.
  const [rafraichissementMuet, setRafraichissementMuet] = useState(false);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const [modal, setModal] = useState<
    | "suspend"
    | "reactivate"
    | "plan"
    | "motdepasse"
    | "facturer"
    | "churn"
    | "compte"
    | null
  >(null);
  const [device, setDevice] = useState<ParkDevice | null>(null);
  // Le compte visé par un geste, ET lequel : les deux modales portent des
  // conséquences très différentes, et la fiche ne monte que celle qu'elle
  // ouvre. Comme les autres, elles repartent d'un brouillon vierge — un motif
  // de révocation qui survivrait à la fermeture finirait collé sur le mauvais
  // compte.
  const [compte, setCompte] = useState<{
    compte: CompteRestaurant;
    geste: "role" | "revoquer";
  } | null>(null);
  // La dérogation en cours de saisie — la capacité ET le geste que sa ligne
  // appelait. Comme les autres modales, elle n'est montée qu'à l'ouverture :
  // un motif qui survivrait à la fermeture finirait collé sur la mauvaise
  // fonction du mauvais client.
  const [deroge, setDeroge] = useState<{
    capacite: CapaciteEffective;
    geste: GesteDerogation;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le drapeau de rechargement se lève AVANT le départ de la requête ; un booléen, aucune cascade.
    setRechargement(true);
    loadClientFile(id)
      .then((f) => {
        if (cancelled) return;
        setRechargement(false);
        // ── UN RAFRAÎCHISSEMENT DE FOND NE REMPLACE PAS UNE FICHE JUSTE ──
        // Après un geste, `reload()` relance tout ; si le CRM tousse à ce
        // moment-là, `soft()` rend une fiche entièrement vide (`row` et
        // `account` nuls, tous deux « offline »). L'écraser afficherait
        // « Fiche indisponible » par-dessus une fiche que l'opérateur avait
        // sous les yeux, en plein appel. On garde l'ancienne et on le dit.
        const muet =
          !f.row && !f.account && f.offline.has("row") && f.offline.has("account");
        const avant = fileRef.current;
        if (muet && avant && (avant.row || avant.account)) {
          setRafraichissementMuet(true);
        } else {
          fileRef.current = f;
          setFile(f);
          setRafraichissementMuet(false);
        }
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setRechargement(false);
        // 401/403 : la coquille `/sm` s'occupe de renvoyer l'utilisateur au bon
        // endroit. On affiche quand même un écran propre le temps du saut.
        const forbidden =
          e instanceof ApiError && (e.status === 401 || e.status === 403);
        // Même règle qu'au-dessus : un échec de rafraîchissement ne vaut pas
        // un écran d'erreur tant qu'une fiche est déjà affichée.
        if (!forbidden && fileRef.current) {
          setRafraichissementMuet(true);
          return;
        }
        setError(forbidden ? "forbidden" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  if (error) {
    return (
      <div className="p-[26px] max-md:p-4">
        <Card>
          <EmptyState
            icon="bell"
            title={
              error === "forbidden"
                ? "Accès réservé à l'équipe Snack Manager"
                : "Fiche indisponible"
            }
            hint={
              error === "forbidden"
                ? "Ce dossier traverse les données de tous les restaurants du parc."
                : "L'API n'a pas répondu. Réessayez — si le problème persiste, vérifiez que le service tourne."
            }
            action={
              error === "forbidden" ? (
                <BackLink />
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Btn
                    size="sm"
                    onClick={() => {
                      setError(null);
                      reload();
                    }}
                  >
                    Réessayer
                  </Btn>
                  <BackLink />
                </div>
              )
            }
          />
        </Card>
      </div>
    );
  }

  if (!file) return <FileSkeleton />;

  const { row, account } = file;
  const name = account?.name ?? row?.name ?? "Restaurant";

  // ── « INTROUVABLE » N'EST PAS « ILLISIBLE » ──
  //
  // `loadClientFile` enveloppe chaque route dans `soft()`, qui avale tout sauf
  // 401/403 et rend `null`. Deux causes très différentes arrivaient donc ici
  // sous la même forme : l'identifiant n'existe pas, ou les deux routes ont
  // échoué. L'écran accusait le lien — « copié à la main » — devant une API
  // tombée, et l'équipe cherchait une faute de frappe pendant une panne.
  //
  // `offline` distingue les deux : il ne contient une section que si sa route a
  // RÉPONDU en erreur.
  const injoignable = file.offline.has("row") && file.offline.has("account");

  if (!row && !account) {
    return (
      <div className="p-[26px] max-md:p-4">
        <Card>
          {injoignable ? (
            <EmptyState
              icon="bell"
              title="Fiche indisponible"
              hint="Le CRM n’a pas répondu — ni le parc, ni le compte de cet établissement. Le lien est probablement bon : réessayez dans un instant."
              action={
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Btn size="sm" onClick={reload} disabled={rechargement}>
                    {rechargement ? "Chargement…" : "Réessayer"}
                  </Btn>
                  <BackLink />
                </div>
              }
            />
          ) : (
            <EmptyState
              icon="search"
              title="Restaurant introuvable"
              hint="Aucun établissement ne porte cet identifiant. Le lien a peut-être été copié à la main."
              action={<BackLink />}
            />
          )}
        </Card>
      </div>
    );
  }

  const plan = (account?.plan ?? row?.plan ?? null) as AdminPlan | null;
  const status = account?.account.status ?? row?.accountStatus ?? null;
  const blocked = account?.accessBlocked ?? isAccessBlocked(status);

  return (
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      <BackLink />

      {rafraichissementMuet && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Unavailable
              icon="bell"
              title="Rafraîchissement impossible"
              hint="Le CRM n'a pas répondu : la fiche affichée reste celle d'avant votre dernier geste."
            />
          </div>
          <Btn size="sm" variant="ghost" onClick={reload} disabled={rechargement}>
            {rechargement ? "Chargement…" : "Réessayer"}
          </Btn>
        </div>
      )}

      {/*
        ── Pendant un rechargement post-geste, l'état affiché est périmé ──
        Il se voile et se gèle (`inert` : ni souris, ni clavier) le temps que
        les routes répondent — un brouillon déjà envoyé ne doit pas offrir
        « Envoyer » une seconde fois.
      */}
      <div
        inert={rechargement}
        aria-busy={rechargement || undefined}
        className={cx(
          "flex flex-col gap-4 transition-opacity",
          rechargement && "opacity-60",
        )}
      >
        {/* ── En-tête : qui c'est, où il en est, ce qu'on peut faire ── */}
        <Card className="p-[18px]">
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="grid size-[52px] shrink-0 place-items-center rounded-card bg-accent text-2xl font-extrabold text-onaccent"
              aria-hidden
            >
              {name.trim().charAt(0).toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-2xl font-extrabold tracking-[-0.03em] text-ink">
                  {name}
                </h2>
                {(account?.founderSeat ?? row?.founderSeat) && (
                  <BadgeFondateur size={26} />
                )}
                <PlanPill plan={plan} />
                <AccountPill status={status ?? DEFAULT_TENANT_ACCOUNT_STATUS} />
                <ScorePill score={file.score} health={file.health} />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mut">
                {file.city && (
                  <Meta icon="home">{file.city}</Meta>
                )}
                {row && <Meta icon="clock">client depuis {fmtMonth(row.since)}</Meta>}
                {file.contact.phone && (
                  <Meta icon="phone">
                    {file.contact.phone}
                    {file.contact.name && ` · ${file.contact.name}`}
                  </Meta>
                )}
                {/* Cliquable comme le téléphone : écrire au gérant sans
                    recopier l'adresse à la main. */}
                {file.contact.email && (
                  <Meta icon="mail" href={`mailto:${file.contact.email}`}>
                    {file.contact.email}
                  </Meta>
                )}
                {row && (
                  <Meta icon="euro">{euroRound(row.mrrCents)} / mois estimés</Meta>
                )}
                {/* L'Atelier signé — « qui a quoi ? » se lit ici, pas dans la
                    facturation : c'est le travail dû, présence à tenir comprise.
                    En entier et sur sa propre ligne : deux services signés
                    suffisent à dépasser la largeur, et l'ellipse mangeait la
                    date de signature — affichée nulle part ailleurs. */}
                {account?.atelier && (
                  <Meta icon="gear" wrap>
                    Atelier : {resumeAtelier(account.atelier)} — signé le{" "}
                    {fmtDay(account.atelier.signedAt)}
                  </Meta>
                )}
              </div>

              {blocked && account && (
                <p className="mt-2.5 flex items-start gap-2 rounded-card border border-alert/45 bg-alert/10 p-2.5 text-[13px] font-bold text-alertt">
                  <Icon name="bell" size={15} className="mt-px shrink-0" />
                  <span>
                    Accès suspendu depuis le {fmtDay(account.account.since)}
                    {account.account.reason && ` — ${account.account.reason}`}
                  </span>
                </p>
              )}

              {/* LE MASQUE ILLISIBLE — le seul repli qui soit un incident.
                  `absent` est normal (établissement pas encore repris) et ne
                  s'affiche pas ; `invalide` veut dire que ce restaurant sert
                  l'identité Nuit à TOUS ses clients — vitrine, commande,
                  fidélité, tableau de menu — sans l'avoir choisie. Ça ne se
                  voyait nulle part : le repli était muet, et un Nuit subi est
                  indiscernable d'un Nuit voulu. */}
              {account?.brandRepli === "invalide" && (
                <p className="mt-2.5 flex items-start gap-2 rounded-card border border-alert/45 bg-alert/10 p-2.5 text-[13px] font-bold text-alertt">
                  <Icon name="alert" size={15} className="mt-px shrink-0" />
                  <span>
                    Masque d’identité illisible — ce restaurant s’affiche en
                    Nuit sur toutes ses surfaces clientes. À reprendre depuis
                    l’éditeur de marque.
                  </span>
                </p>
              )}
            </div>

            {/* ── Les actions — pleine largeur sous `md`, « Appeler » en tête et
                à hauteur de pouce : c'est le geste pour lequel la fiche s'ouvre ── */}
            <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:w-full max-md:[&>a]:min-h-11 max-md:[&>a]:flex-1 max-md:[&>a]:justify-center max-md:[&>button]:min-h-11 max-md:[&>button]:flex-1">
              {file.contact.phone && (
                <a
                  href={`tel:${file.contact.phone.replace(/\s/g, "")}`}
                  className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill bg-btn px-3.5 py-[9px] text-[13px] font-bold tracking-[-0.01em] text-white hover:bg-[#333]"
                >
                  <Icon name="phone" size={15} />
                  Appeler
                </a>
              )}
              <Btn
                variant="ghost"
                size="sm"
                icon="tag"
                onClick={() => setModal("plan")}
                disabled={!account}
                title={
                  account
                    ? `Formule actuelle : ${planChoiceLabel(plan)}`
                    : "Route /crm/tenants/:id/account indisponible"
                }
              >
                Offre
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                icon="euro"
                onClick={() => setModal("facturer")}
                disabled={!account}
                title={
                  account
                    ? "Émettre une facture ou poser un brouillon"
                    : "Route /crm/tenants/:id/account indisponible"
                }
              >
                Facturer
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                icon="edit"
                onClick={() => setModal("motdepasse")}
                title="Nouveau mot de passe gérant — remis une fois, jamais relu"
              >
                Mot de passe
              </Btn>
              {blocked ? (
                <Btn
                  size="sm"
                  icon="check"
                  variant="success"
                  onClick={() => setModal("reactivate")}
                  disabled={!account}
                >
                  Réactiver
                </Btn>
              ) : (
                <Btn
                  size="sm"
                  icon="close"
                  variant="danger"
                  onClick={() => setModal("suspend")}
                  disabled={!account}
                  title={
                    account
                      ? "Couper l'accès du gérant — motif obligatoire"
                      : "Route /crm/tenants/:id/account indisponible"
                  }
                >
                  Suspendre
                </Btn>
              )}
              {/*
                ACTER UN DÉPART — le geste qui n'existait nulle part.
                `POST /crm/tenants/:id/churn` était écrite et testée sans aucun
                appelant : un client parti restait « actif » au parc, comptait
                dans le MRR, et sa raison de partir n'était consignée nulle part.
                C'est pourtant la donnée la plus utile qu'un éditeur puisse
                recueillir sur son propre produit.
              */}
              {account?.account.status !== "churned" && (
                <Btn
                  size="sm"
                  variant="ghost"
                  icon="logout"
                  className="border-white/15 text-mut hover:border-white/30 hover:text-ink"
                  onClick={() => setModal("churn")}
                  disabled={!account}
                  title="Acter le départ — cause et détail obligatoires"
                >
                  Départ
                </Btn>
              )}
            </div>
          </div>

          {!account && (
            <Unavailable
              icon="gear"
              title="Administration du compte indisponible"
              hint="La route /crm/tenants/:id/account n'a pas répondu : statut, suspension et changement de formule sont hors de portée pour l'instant. Le reste de la fiche reste lisible."
            />
          )}
        </Card>

        {/*
          ── Deux colonnes : à gauche ce qui s'analyse, à droite ce qui s'agit ──
          Empilées sous 1280 px : deux colonnes de 300 px ne sont plus denses,
          elles sont illisibles.
        */}
        <div className="flex flex-col items-stretch gap-4 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-[1.5] flex-col gap-4">
            <HealthSection file={file} />
            <AdoptionSection file={file} />
            {/*
              ACCÈS ET OPTIONS — sous l'adoption, et c'est la bonne place :
              « il s'en sert de quoi ? » appelle immédiatement « il a le droit
              d'ouvrir quoi ? ». C'est aussi le seul écran d'où une dérogation
              se pose — la route existait, la base la lisait, aucune surface ne
              l'écrivait.
            */}
            <AccesSection file={file} onGeste={setDeroge} />
            {/*
              QUI A UNE CLÉ — juste sous « ce que l'établissement a le droit
              d'ouvrir ». Les deux questions se posent l'une après l'autre au
              téléphone, et la seconde n'avait aucun écran : un restaurant
              n'avait qu'un compte, si bien qu'un cogérant travaillait avec le
              mot de passe du patron — et le registre des gestes sensibles
              nommait le patron pour des gestes qu'il n'avait pas faits.
            */}
            <ComptesSection
              file={file}
              onCreer={() => setModal("compte")}
              onRole={(c) => setCompte({ compte: c, geste: "role" })}
              onRevoquer={(c) => setCompte({ compte: c, geste: "revoquer" })}
            />
            <AdviceSection file={file} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/*
              EN TÊTE DE LA COLONNE DE DROITE, toujours montée — même vide.
              C'est la raison de l'appel : elle se cherche au même endroit qu'on
              ait trois signaux ouverts ou aucun, et « rien à signaler » est une
              réponse, pas une absence de carte.
            */}
            <SignalsSection file={file} />

            {/*
              LES FACTURES, sur la fiche du client et non ailleurs.
              La file de recouvrement ne montre que les impayées : un brouillon
              n'y figure jamais, et n'avait donc aucun écran d'où partir.
            */}
            <FacturesCard
              tenantId={id}
              tenantName={name}
              invoices={file.invoices}
              indisponible={file.offline.has("invoices")}
              onDone={reload}
            />
            <DevicesSection file={file} onRevoke={setDevice} />
            <SupplySection file={file} />
            <NotesSection file={file} onSaved={reload} />
          </div>
        </div>

        {row && (
          <p className="text-[13px] text-mut">
            {int(row.orders30d)} commande{row.orders30d > 1 ? "s" : ""} encaissée
            {row.orders30d > 1 ? "s" : ""} sur 30 jours pour{" "}
            {euroRound(row.revenue30dCents)}. Montants estimés d&apos;après la
            formule — la facturation reste la source de vérité.
          </p>
        )}
      </div>

      {/*
        ── Gestes graves ──
        Montées seulement quand elles s'ouvrent : chaque ouverture repart d'un
        brouillon vierge, sans effet de remise à zéro. Un motif de suspension
        qui survivrait à la fermeture de la modale finirait un jour collé sur
        le mauvais client.
      */}
      {modal === "churn" && (
        <ChurnModal
          tenantId={id}
          tenantName={name}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {modal === "suspend" && (
        <SuspendModal
          tenantId={id}
          tenantName={name}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {modal === "reactivate" && (
        <ReactivateModal
          tenantId={id}
          tenantName={name}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {modal === "motdepasse" && (
        <ResetOwnerModal
          tenantId={id}
          tenantName={name}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {modal === "plan" && (
        <OffreModal
          tenantId={id}
          tenantName={name}
          current={{
            plan,
            onlineOrdering: account?.onlineOrdering ?? false,
            billingCycle: account?.billingCycle ?? "mensuel",
            // La remise, pour que le chiffrage de la modale dise la même chose
            // que la fiche : elle annonçait le tarif public à côté d'un MRR
            // remisé, et l'opérateur lisait le mauvais chiffre au client.
            founderUntil: account?.founderUntil ?? null,
            founderDiscountCents: account?.founderDiscountCents ?? null,
            // Les clients d'avant l'Atelier n'ont rien en base : le formulaire
            // s'ouvre alors sur « aucun service », pas sur un objet de faux.
            services: account?.atelier ?? EMPTY_SERVICES,
          }}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {modal === "facturer" && (
        <EmettreFactureModal
          tenantId={id}
          tenantName={name}
          // Le montant par défaut proposé à l'écran est celui que l'API
          // appliquera si le champ reste vide : offre entière et remise
          // fondateur comprises. Les deux doivent dire la même chose.
          // `0` vaut « parc muet » : la modale n'annonce alors aucun chiffre
          // plutôt qu'un faux « 0,00 € » — cf. `defautConnu` dans actions.tsx.
          mrrCents={row?.mrrCents ?? 0}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {deroge && (
        <CapaciteModal
          tenantId={id}
          tenantName={name}
          capacite={deroge.capacite}
          geste={deroge.geste}
          onClose={() => setDeroge(null)}
          onDone={reload}
        />
      )}
      {modal === "compte" && (
        <CreerCompteModal
          tenantId={id}
          tenantName={name}
          // Ce qu'il reste à ouvrir vient du SERVEUR : le plafond dépend de la
          // formule, et la règle d'or interdit qu'un écran connaisse le nom
          // d'une formule. `0` si la route est muette — le bouton qui ouvre
          // cette modale est alors absent.
          restants={file.comptes?.restants ?? 0}
          onClose={() => setModal(null)}
          onDone={reload}
        />
      )}
      {compte?.geste === "role" && (
        <CompteRoleModal
          tenantId={id}
          compte={compte.compte}
          onClose={() => setCompte(null)}
          onDone={reload}
        />
      )}
      {compte?.geste === "revoquer" && (
        <CompteRevokeModal
          tenantId={id}
          compte={compte.compte}
          onClose={() => setCompte(null)}
          onDone={reload}
        />
      )}
      {device && (
        <RevokeDeviceModal
          tenantId={id}
          tenantName={name}
          device={device}
          onClose={() => setDevice(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

function Meta({
  icon,
  href,
  wrap = false,
  children,
}: {
  icon: "home" | "clock" | "phone" | "edit" | "euro" | "gear" | "mail";
  /** Lien d'action (`mailto:`…) — la méta se clique au lieu de se recopier. */
  href?: string;
  /** Pleine ligne et texte entier, sans ellipse — pour les métas longues. */
  wrap?: boolean;
  children: React.ReactNode;
}) {
  const classes = wrap
    ? "flex w-full items-start gap-1.5"
    : "inline-flex min-w-0 items-center gap-1.5";
  const contenu = (
    <>
      <Icon
        name={icon}
        size={14}
        className={cx("shrink-0 text-mut", wrap && "mt-px")}
      />
      <span className={wrap ? undefined : "truncate"}>{children}</span>
    </>
  );
  return href ? (
    <a href={href} className={cx(classes, "hover:text-white")}>
      {contenu}
    </a>
  ) : (
    <span className={classes}>{contenu}</span>
  );
}

function BackLink() {
  return (
    <Link
      href="/sm/clients"
      className="inline-flex w-fit items-center gap-1.5 text-[13px] font-bold text-mut hover:text-white"
    >
      <Icon name="back" size={15} />
      Tous les restaurants clients
    </Link>
  );
}

function FileSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      <Skeleton className="h-[108px]" />
      {/* Mêmes seuils que la page chargée : empilé jusqu'à xl, deux colonnes
          ensuite — sinon le squelette dessinait entre md et xl une mise en
          page que le contenu réel venait défaire sous les yeux. */}
      <div className="flex flex-col items-stretch gap-4 xl:flex-row xl:items-start">
        <div className="flex flex-[1.5] flex-col gap-4">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[180px]" />
        </div>
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-[200px]" />
          <Skeleton className="h-[160px]" />
        </div>
      </div>
    </div>
  );
}
