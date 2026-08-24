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
import { use, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_TENANT_ACCOUNT_STATUS,
  PLAN_LABELS,
  isAccessBlocked,
  type AdminPlan,
} from "@sm/contracts";
import { ApiError } from "@/lib/api";
import { Btn, Card, EmptyState, Icon, Skeleton } from "@/components/ui";
import { euroRound, fmtDay, fmtMonth, int } from "../../crm";
import { loadClientFile, type ClientFile, type ParkDevice } from "../data";
import { AccountPill, PlanPill, ScorePill, Unavailable } from "../ui";
import {
  PlanModal,
  ResetOwnerModal,
  ReactivateModal,
  RevokeDeviceModal,
  SuspendModal,
} from "./actions";
import {
  AdoptionSection,
  AdviceSection,
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
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const [modal, setModal] = useState<"suspend" | "reactivate" | "plan" | "motdepasse" | null>(null);
  const [device, setDevice] = useState<ParkDevice | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadClientFile(id)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        // 401/403 : la coquille `/sm` s'occupe de renvoyer l'utilisateur au bon
        // endroit. On affiche quand même un écran propre le temps du saut.
        setError(
          e instanceof ApiError && (e.status === 401 || e.status === 403)
            ? "forbidden"
            : "failed",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  if (error) {
    return (
      <div className="p-[26px]">
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
                : "L'API n'a pas répondu. Rechargez la page — si le problème persiste, vérifiez que le service tourne."
            }
            action={<BackLink />}
          />
        </Card>
      </div>
    );
  }

  if (!file) return <FileSkeleton />;

  const { row, account } = file;
  const name = account?.name ?? row?.name ?? "Restaurant";

  // Ni le parc ni le compte ne connaissent cet identifiant : le lien est faux
  // ou le restaurant a disparu du parc.
  if (!row && !account) {
    return (
      <div className="p-[26px]">
        <Card>
          <EmptyState
            icon="search"
            title="Restaurant introuvable"
            hint="Aucun établissement ne porte cet identifiant. Le lien a peut-être été copié à la main."
            action={<BackLink />}
          />
        </Card>
      </div>
    );
  }

  const plan = (account?.plan ?? row?.plan ?? "essentiel") as AdminPlan;
  const status = account?.account.status ?? row?.accountStatus ?? null;
  const blocked = account?.accessBlocked ?? isAccessBlocked(status);

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      <BackLink />

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
                <Icon
                  name="star"
                  size={17}
                  className="shrink-0 text-accent"
                  aria-label="Client fondateur"
                />
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
              {file.contact.email && <Meta icon="edit">{file.contact.email}</Meta>}
              {row && (
                <Meta icon="euro">{euroRound(row.mrrCents)} / mois estimés</Meta>
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
          </div>

          {/* ── Les actions ── */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {file.contact.phone && (
              <a
                href={`tel:${file.contact.phone.replace(/\s/g, "")}`}
                className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill bg-btndark px-3.5 py-[9px] text-[13px] font-bold tracking-[-0.01em] text-white hover:bg-[#333]"
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
                  ? `Formule actuelle : ${PLAN_LABELS[plan]}`
                  : "Route /crm/tenants/:id/account indisponible"
              }
            >
              Formule
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
                className="bg-ok text-white hover:opacity-85"
                onClick={() => setModal("reactivate")}
                disabled={!account}
              >
                Réactiver
              </Btn>
            ) : (
              <Btn
                size="sm"
                icon="close"
                className="bg-alert text-white hover:opacity-85"
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

      {/*
        ── Gestes graves ──
        Montées seulement quand elles s'ouvrent : chaque ouverture repart d'un
        brouillon vierge, sans effet de remise à zéro. Un motif de suspension
        qui survivrait à la fermeture de la modale finirait un jour collé sur
        le mauvais client.
      */}
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
        <PlanModal
          tenantId={id}
          tenantName={name}
          current={plan}
          onClose={() => setModal(null)}
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

function Meta({ icon, children }: { icon: "home" | "clock" | "phone" | "edit" | "euro"; children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon name={icon} size={14} className="shrink-0 text-mut" />
      <span className="truncate">{children}</span>
    </span>
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
    <div className="flex flex-col gap-4 p-[26px]">
      <Skeleton className="h-[108px]" />
      <div className="flex items-start gap-4">
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
