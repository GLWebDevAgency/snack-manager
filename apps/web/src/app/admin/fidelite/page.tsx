"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LoyaltyDashboard,
  LoyaltyLedgerEntryView,
  LoyaltyProgramView,
  LoyaltyRewardView,
} from "@sm/contracts";
import { Btn, Card, EmptyState, Icon, Kpi, Panel, Pill, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { loyaltyApi } from "./data";

type DashboardState = {
  dashboard: LoyaltyDashboard;
  program: LoyaltyProgramView | null;
  rewards: LoyaltyRewardView[];
};

const STATUS = {
  draft: { label: "Brouillon", className: "border-prep/35 bg-prep/10 text-prept" },
  active: { label: "Actif", className: "border-ok/35 bg-ok/10 text-okt" },
  paused: { label: "En pause", className: "border-alert/35 bg-alert/10 text-alertt" },
} as const;

const ENTRY_LABELS: Record<LoyaltyLedgerEntryView["kind"], string> = {
  earn: "Gain",
  redeem: "Récompense utilisée",
  adjust_credit: "Correction créditrice",
  adjust_debit: "Correction débitrice",
  reverse: "Annulation",
  expire: "Expiration",
};

function loadError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Le tableau de bord fidélité est momentanément indisponible.";
}

export default function LoyaltyDashboardPage() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dashboard, program, rewards] = await Promise.all([
        loyaltyApi.dashboard(),
        loyaltyApi.getProgram(),
        loyaltyApi.listRewards(),
      ]);
      setState({ dashboard, program, rewards });
    } catch (cause) {
      setError(loadError(cause));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement réseau initial, avec réessai explicite via la même fonction.
    void load();
  }, [load]);

  const activeRewards = useMemo(
    () => state?.rewards.filter((reward) => reward.active).length ?? 0,
    [state],
  );

  if (error && !state) {
    return (
      <div className="p-4 md:p-[26px]">
        <div className="rounded-card border border-alert/40 bg-alert/10 p-4">
          <p className="text-sm text-alertt" role="alert">{error}</p>
          <Btn className="mt-3" variant="ghost" size="sm" onClick={() => void load()}>
            Réessayer
          </Btn>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="p-4 md:p-[26px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[126px]" />
          ))}
        </div>
        <Skeleton className="mt-4 h-[360px]" />
      </div>
    );
  }

  const { dashboard, program, rewards } = state;
  const unitPlural = program?.unitLabelPlural ?? "unités";
  const unitSingular = program?.unitLabelSingular ?? "unité";
  const setupSteps = [
    { done: Boolean(program), label: "Règle de gain configurée", href: "/admin/fidelite/programme" },
    { done: program?.status === "active", label: "Programme activé", href: "/admin/fidelite/programme" },
    { done: activeRewards > 0, label: "Au moins une récompense active", href: "/admin/fidelite/recompenses" },
  ];
  const setupDone = setupSteps.filter((step) => step.done).length;

  return (
    <div className="p-4 md:p-[26px]">
      {!program && (
        <Card className="mb-4 overflow-hidden border-accent/25">
          <div className="relative p-5 sm:p-6">
            <div className="absolute -right-12 -top-20 size-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
            <div className="relative max-w-2xl">
              <Pill className="border-accent/30 bg-accent/10 text-accent">Mise en route · 3 minutes</Pill>
              <h2 className="mt-3 text-xl font-extrabold tracking-[-0.035em] text-ink sm:text-2xl">
                Lancez une carte qui fonctionne aussi sans commande en ligne.
              </h2>
              <p className="mt-2 text-sm leading-6 text-mut">
                Choisissez des points ou des tampons, publiez vos avantages et inscrivez le
                premier client directement au comptoir.
              </p>
              <Link
                href="/admin/fidelite/programme"
                className="cf-press mt-5 inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-3 text-sm font-bold text-onaccent shadow-card hover:opacity-85"
              >
                Configurer le programme
                <Icon name="arrow" size={17} />
              </Link>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Clients inscrits" value={dashboard.totalMembers.toLocaleString("fr-FR")} icon="user" />
        <Kpi label="Actifs sur 30 jours" value={dashboard.activeMembers30d.toLocaleString("fr-FR")} icon="star" />
        <Kpi label={`Solde en ${unitPlural}`} value={dashboard.outstandingUnits.toLocaleString("fr-FR")} icon="gift" />
        <Kpi label="Avantages utilisés · 30 j" value={dashboard.redemptions30d.toLocaleString("fr-FR")} icon="check" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.8fr)]">
        <Panel
          title="Activité récente"
          sub="Mouvements réellement enregistrés, du plus récent au plus ancien"
          actions={
            <Link href="/admin/fidelite/clients" className="text-xs font-bold text-accent hover:text-accenthover">
              Voir les clients
            </Link>
          }
          bodyClassName="-mx-[18px] -mb-[18px]"
        >
          {dashboard.recentActivity.length === 0 ? (
            <EmptyState
              icon="gift"
              title="Aucun mouvement pour le moment"
              hint="Les gains, récompenses et corrections apparaîtront ici dès la première utilisation."
            />
          ) : (
            <ul className="divide-y divide-line2">
              {dashboard.recentActivity.map(({ memberId, memberAlias, entry }) => (
                <li key={entry.id} className="flex items-center gap-3 px-[18px] py-3.5">
                  <div
                    className="grid size-9 shrink-0 place-items-center rounded-pill border border-white/8 bg-[image:var(--cf-elev-gradient)] text-sm font-extrabold text-ink"
                    aria-hidden
                  >
                    {memberAlias.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/fidelite/clients?member=${encodeURIComponent(memberId)}`}
                      className="block truncate text-sm font-bold text-ink hover:text-accent"
                    >
                      {memberAlias}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-mut">
                      {ENTRY_LABELS[entry.kind]} · {timeAgo(entry.recordedAt)}
                    </p>
                  </div>
                  <div className={entry.deltaUnits > 0 ? "text-right text-okt" : "text-right text-alertt"}>
                    <div className="cf-fig text-sm font-extrabold">
                      {entry.deltaUnits > 0 ? "+" : ""}{entry.deltaUnits.toLocaleString("fr-FR")}
                    </div>
                    <div className="text-[10px] font-semibold text-mut">
                      {Math.abs(entry.deltaUnits) === 1 ? unitSingular : unitPlural}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            title="État du programme"
            sub={program ? `Version ${program.rulesVersion}` : "Non configuré"}
            actions={
              program ? (
                <Pill className={STATUS[program.status].className}>{STATUS[program.status].label}</Pill>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {setupSteps.map((step) => (
                <Link
                  key={step.label}
                  href={step.href}
                  className="group flex items-center gap-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3 hover:border-white/16"
                >
                  <span
                    className={
                      step.done
                        ? "grid size-6 place-items-center rounded-pill bg-ok text-white"
                        : "grid size-6 place-items-center rounded-pill border border-white/15 text-mut"
                    }
                  >
                    {step.done ? <Icon name="check" size={14} stroke={2.5} /> : setupSteps.indexOf(step) + 1}
                  </span>
                  <span className="flex-1 text-[13px] font-semibold text-ink">{step.label}</span>
                  <Icon name="arrow" size={15} className="text-mut group-hover:text-ink" />
                </Link>
              ))}
            </div>
            <p className="mt-3 text-xs text-mut">{setupDone}/3 étapes terminées · {rewards.length} récompense{rewards.length > 1 ? "s" : ""} au total</p>
          </Panel>

          <Card className="p-[18px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">30 derniers jours</p>
                <p className="mt-2 text-sm font-bold text-ink">
                  +{dashboard.earnedUnits30d.toLocaleString("fr-FR")} gagnés · {dashboard.redeemedUnits30d.toLocaleString("fr-FR")} utilisés
                </p>
                <p className="mt-1 text-xs text-mut">{dashboard.newMembers30d.toLocaleString("fr-FR")} nouvelles inscriptions</p>
              </div>
              <Icon name="chart" size={22} className="text-accent" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
