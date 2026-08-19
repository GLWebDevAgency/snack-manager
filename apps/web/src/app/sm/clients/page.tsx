"use client";

/**
 * Restaurants clients — le parc RÉEL (collection `tenants`), enrichi de son
 * activité de service.
 *
 * Le signal qui compte n'est pas l'abonnement (il court encore le jour où le
 * client décroche) mais les COMMANDES : sept jours sans une seule commande sur
 * un fast-food, ce n'est pas un creux, c'est un client qui part. Ces lignes-là
 * remontent en tête et se voient sans être cherchées (DA §7).
 */

import { useEffect, useMemo, useState } from "react";
import {
  CLIENT_RISK_DAYS,
  PLAN_LABELS,
  type CrmClient,
  type CrmClientHealth,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Card, Chip, EmptyState, Icon, Kpi, Skeleton } from "@/components/ui";
import { crm, euroRound, fmtDaysAgo, fmtMonth, int } from "../crm";
import { HealthPill } from "../parts";

type Filter = "tous" | CrmClientHealth;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "risque", label: "À risque" },
  { key: "attention", label: "À suivre" },
  { key: "ok", label: "Bonne santé" },
];

/** Les décrochages d'abord : cette liste est celle des appels à passer. */
const HEALTH_RANK: Record<CrmClientHealth, number> = {
  risque: 0,
  attention: 1,
  ok: 2,
};

export default function ClientsPage() {
  const [clients, setClients] = useState<CrmClient[] | null>(null);
  const [filter, setFilter] = useState<Filter>("tous");

  useEffect(() => {
    let cancelled = false;
    crm
      .clients()
      .then((c) => {
        if (!cancelled) setClients(c);
      })
      .catch(() => {
        if (!cancelled) setClients([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () =>
      [...(clients ?? [])].sort(
        (a, b) =>
          HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || b.orders30d - a.orders30d,
      ),
    [clients],
  );
  const shown = filter === "tous" ? sorted : sorted.filter((c) => c.health === filter);

  const mrr = (clients ?? [])
    .filter((c) => c.orders30d > 0)
    .reduce((n, c) => n + c.mrrCents, 0);
  const atRisk = (clients ?? []).filter((c) => c.health === "risque").length;

  if (clients === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <div className="flex gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] flex-1" />
          ))}
        </div>
        <Skeleton className="h-[280px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      <div className="flex items-stretch gap-4">
        <Kpi label="Restaurants clients" value={int(clients.length)} icon="user" />
        <Kpi
          label="Actifs sur 30 jours"
          value={int(clients.filter((c) => c.orders30d > 0).length)}
          icon="check"
        />
        <Kpi
          label="À rappeler"
          value={int(atRisk)}
          icon="bell"
          delta={
            atRisk > 0
              ? { dir: "down", text: `sans commande depuis ${CLIENT_RISK_DAYS} j` }
              : undefined
          }
        />
        <Kpi label="MRR estimé" value={euroRound(mrr)} icon="euro" />
      </div>

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key === "risque" && atRisk > 0 && (
              <span className="cf-fig rounded-pill bg-alert px-1.5 text-[11px] font-extrabold text-white">
                {atRisk}
              </span>
            )}
          </Chip>
        ))}
      </div>

      <Card className="p-0">
        {/* En-tête de table : niveau « élément » sur la carte (DA §1). */}
        <div className="flex items-center gap-3 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-mut">
          <span className="min-w-0 flex-1">Restaurant</span>
          <span className="w-[92px] shrink-0">Formule</span>
          <span className="w-[104px] shrink-0 text-center">Santé</span>
          {/* Largeurs calées sur l'en-tête en capitales : « COMMANDES 30 J »
              passait à la ligne dans 112 px, ce qui décalait toute la rangée. */}
          <span className="w-[132px] shrink-0 text-right">Commandes 30 j</span>
          <span className="w-[110px] shrink-0 text-right">CA 30 j</span>
          <span className="w-[156px] shrink-0 text-right">Dernière commande</span>
          <span className="w-[84px] shrink-0 text-right">MRR</span>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon="user"
            title={
              clients.length === 0
                ? "Aucun restaurant client"
                : "Aucun client dans ce filtre"
            }
            hint={
              clients.length === 0
                ? "Les restaurants apparaissent ici dès leur mise en service."
                : "Changez de filtre pour voir le reste du parc."
            }
          />
        ) : (
          shown.map((c) => {
            const risk = c.health === "risque";
            return (
              <div
                key={c._id}
                className={cx(
                  "relative flex items-center gap-3 border-t border-line px-[18px] py-3",
                  risk && "bg-alert/6",
                )}
              >
                {/*
                  Filet rouge en bord de ligne : un décrochage se repère au
                  balayage de la colonne, sans lire une seule valeur.
                */}
                {risk && (
                  <span
                    className="absolute inset-y-0 left-0 w-[3px] bg-alert"
                    aria-hidden
                  />
                )}

                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[13px] font-extrabold text-onaccent"
                    aria-hidden
                  >
                    {c.name.trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14.5px] font-bold text-ink">
                        {c.name}
                      </span>
                      {c.founderSeat && (
                        <Icon
                          name="star"
                          size={14}
                          className="shrink-0 text-accent"
                          aria-label="Client fondateur"
                        />
                      )}
                    </div>
                    <div className="truncate text-xs text-mut">
                      client depuis {fmtMonth(c.since)}
                    </div>
                  </div>
                </div>

                <span className="w-[92px] shrink-0">
                  <span
                    className={cx(
                      "inline-flex items-center rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
                      c.plan === "essentiel"
                        ? "border-white/20 bg-white/6 text-mut"
                        : "border-accent/50 bg-accent/12 text-accent",
                    )}
                  >
                    {PLAN_LABELS[c.plan]}
                  </span>
                </span>

                <span className="flex w-[104px] shrink-0 justify-center">
                  <HealthPill health={c.health} />
                </span>

                <span
                  className={cx(
                    "cf-fig w-[132px] shrink-0 text-right text-sm font-extrabold",
                    c.orders30d === 0 ? "text-alertt" : "text-ink",
                  )}
                >
                  {int(c.orders30d)}
                </span>

                {/* CA agrégé : arrondi à l'euro, les centimes n'apportent rien ici. */}
                <span className="cf-fig w-[110px] shrink-0 text-right text-sm font-bold text-ink">
                  {euroRound(c.revenue30dCents)}
                </span>

                <span
                  className={cx(
                    "w-[156px] shrink-0 truncate text-right text-[13px]",
                    risk ? "font-bold text-alertt" : "text-mut",
                  )}
                >
                  {fmtDaysAgo(c.daysSinceLastOrder)}
                </span>

                <span className="cf-fig w-[84px] shrink-0 text-right text-sm font-extrabold text-accent">
                  {euroRound(c.mrrCents)}
                </span>
              </div>
            );
          })
        )}
      </Card>

      <p className="text-[13px] text-mut">
        Santé calculée sur la dernière commande encaissée : bonne sous 2 jours, à
        suivre entre 2 et {CLIENT_RISK_DAYS} jours, à risque au-delà. MRR estimé
        d&apos;après la formule du restaurant.
      </p>
    </div>
  );
}
