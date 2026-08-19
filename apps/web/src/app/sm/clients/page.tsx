"use client";

/**
 * RESTAURANTS CLIENTS — la liste qu'on balaie avant de décrocher.
 *
 * Le signal qui compte n'est pas l'abonnement (il court encore le jour où le
 * client décroche) mais l'ACTIVITÉ : sept jours sans une seule commande sur un
 * fast-food, ce n'est pas un creux, c'est un client qui part. Trois anomalies
 * doivent se voir SANS un clic et sans lire une valeur (DA §7) :
 *
 *   1. le décrochage — filet rouge en bord de ligne + pastille de score rouge ;
 *   2. l'appareil muet — puce « caisse hors ligne », en rouge sur la ligne ;
 *   3. le compte suspendu — pilule rouge en colonne « Statut ».
 *
 * Chaque ligne ouvre la fiche `/sm/clients/[id]`, l'écran d'appel.
 *
 * Cloisonnement : cette liste traverse TOUS les restaurants du parc. Elle est
 * réservée au rôle `sm_admin` — garde côté API, redirection côté coquille.
 * Aucun consommateur final n'y figure : ce sont des agrégats d'établissement.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CLIENT_RISK_DAYS, type CrmClientHealth } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Card, Chip, EmptyState, Icon, Input, Kpi, Skeleton } from "@/components/ui";
import { euroRound, fmtMonth, int } from "../crm";
import {
  clientsApi,
  fmtSince,
  readClientRows,
  readSignals,
  scoreHealth,
  SEVERITY_RANK,
  type ClientRow,
  type ClientSignal,
} from "./data";
import { AccountPill, PlanPill, ScorePill, Trend, Unavailable } from "./ui";

type Filter = "tous" | CrmClientHealth | "suspendus";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "risque", label: "À rappeler" },
  { key: "attention", label: "À suivre" },
  { key: "ok", label: "Bonne santé" },
  { key: "suspendus", label: "Suspendus" },
];

/** Les décrochages d'abord : cette liste est celle des appels à passer. */
const HEALTH_RANK: Record<CrmClientHealth, number> = {
  risque: 0,
  attention: 1,
  ok: 2,
};

/** Santé effective : le score quand l'API en calcule un, sinon la règle des contrats. */
const toneOf = (c: ClientRow): CrmClientHealth => scoreHealth(c.score) ?? c.health;

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signals, setSignals] = useState<ClientSignal[] | null>(null);
  const [filter, setFilter] = useState<Filter>("tous");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    clientsApi
      .list()
      .then((raw) => {
        if (!cancelled) setClients(readClientRows(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setClients([]);
        setFailed(true);
      });
    // La file de signaux n'est pas indispensable à la liste : elle l'annote.
    // Son absence (route pas encore livrée) ne doit rien empêcher.
    clientsApi
      .signals()
      .then((raw) => {
        if (!cancelled) setSignals(readSignals(raw));
      })
      .catch(() => {
        if (!cancelled) setSignals(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Signaux ouverts par établissement — la gravité la plus haute l'emporte. */
  const signalsByTenant = useMemo(() => {
    const map = new Map<string, ClientSignal[]>();
    for (const s of signals ?? []) {
      if (!s.tenantId) continue;
      const arr = map.get(s.tenantId);
      if (arr) arr.push(s);
      else map.set(s.tenantId, [s]);
    }
    return map;
  }, [signals]);

  const sorted = useMemo(
    () =>
      [...(clients ?? [])].sort(
        (a, b) =>
          HEALTH_RANK[toneOf(a)] - HEALTH_RANK[toneOf(b)] ||
          (a.score ?? 50) - (b.score ?? 50) ||
          b.orders30d - a.orders30d,
      ),
    [clients],
  );

  const needle = q.trim().toLowerCase();
  const shown = sorted.filter((c) => {
    if (needle && !`${c.name} ${c.city} ${c.slug}`.toLowerCase().includes(needle)) {
      return false;
    }
    if (filter === "tous") return true;
    if (filter === "suspendus") return c.accountStatus === "suspended";
    return toneOf(c) === filter;
  });

  const all = clients ?? [];
  const mrr = all.filter((c) => c.orders30d > 0).reduce((n, c) => n + c.mrrCents, 0);
  const atRisk = all.filter((c) => toneOf(c) === "risque").length;
  const suspended = all.filter((c) => c.accountStatus === "suspended").length;
  const mute = all.reduce((n, c) => n + (c.devicesOffline ?? 0), 0);

  if (clients === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <div className="flex gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] flex-1" />
          ))}
        </div>
        <Skeleton className="h-[320px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      {/* ── Les quatre chiffres du parc ── */}
      <div className="flex items-stretch gap-4">
        <Kpi label="Restaurants clients" value={int(all.length)} icon="user" />
        <Kpi
          label="Actifs sur 30 jours"
          value={int(all.filter((c) => c.orders30d > 0).length)}
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

      {failed && (
        <Unavailable
          title="Parc clients indisponible"
          hint="L'API n'a pas répondu à /crm/tenants. Rechargez la page — si le problème persiste, vérifiez que le service tourne."
        />
      )}

      {/* ── Filtres, recherche, accès à la file de travail ── */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count =
            f.key === "risque" ? atRisk : f.key === "suspendus" ? suspended : 0;
          return (
            <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              {count > 0 && (
                <span
                  className={cx(
                    "cf-fig rounded-pill px-1.5 text-[11px] font-extrabold text-white",
                    f.key === "risque" ? "bg-alert" : "bg-alert/70",
                  )}
                >
                  {count}
                </span>
              )}
            </Chip>
          );
        })}

        <div className="relative ml-auto">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
          />
          <Input
            aria-label="Rechercher un restaurant"
            placeholder="Rechercher — nom ou ville…"
            className="w-[260px] !py-[9px] pl-9 text-[13px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Link
          href="/sm/signals"
          className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
        >
          <Icon name="bell" size={15} />
          File de signaux
          {(signals?.length ?? 0) > 0 && (
            <span className="cf-fig rounded-pill bg-alert px-1.5 text-[11px] font-extrabold text-white">
              {signals!.length}
            </span>
          )}
        </Link>
      </div>

      {mute > 0 && (
        <p className="flex items-center gap-2 text-[13px] font-bold text-alertt">
          <Icon name="tv" size={15} />
          {int(mute)} appareil{mute > 1 ? "s" : ""} hors ligne sur le parc — une
          caisse muette, c&apos;est un comptoir qui n&apos;encaisse plus.
        </p>
      )}

      {/* ── Le parc ── */}
      <Card className="p-0">
        {/*
          Huit colonnes calées au pixel, dans un conteneur qui défile
          horizontalement sous 880 px. Une largeur minimale plutôt qu'un
          empilement responsive : cette table SE BALAIE en colonnes, et des
          colonnes qui se réorganisent selon la fenêtre ne se balaient plus.
          Le défilement reste enfermé dans la carte — la page, elle, ne part
          jamais de travers.
        */}
        <div className="cf-scroll overflow-x-auto">
          <div className="min-w-[880px]">
            {/* En-tête de table : niveau « élément » sur la carte (DA §1). */}
            <div className="flex items-center gap-2.5 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-mut">
              <span className="min-w-0 flex-1">Restaurant</span>
              <span className="w-[78px] shrink-0">Formule</span>
              <span className="w-[86px] shrink-0">Statut</span>
              <span className="w-[74px] shrink-0 text-center">Santé</span>
              <span className="w-[104px] shrink-0 text-right">Commandes 30 j</span>
              <span className="w-[92px] shrink-0 text-right">CA 30 j</span>
              <span className="w-[112px] shrink-0 text-right">Dernière activité</span>
              <span className="w-[72px] shrink-0 text-right">MRR</span>
              <span className="w-[16px] shrink-0" aria-hidden />
            </div>

            {shown.length === 0 ? (
              <EmptyState
                icon="user"
                title={
                  all.length === 0
                    ? "Aucun restaurant client"
                    : "Aucun client dans ce filtre"
                }
                hint={
                  all.length === 0
                    ? "Les restaurants apparaissent ici dès leur mise en service."
                    : "Changez de filtre ou videz la recherche pour voir le reste du parc."
                }
              />
            ) : (
              shown.map((c) => (
                <ClientLine
                  key={c._id}
                  client={c}
                  signals={signalsByTenant.get(c._id) ?? []}
                />
              ))
            )}
          </div>
        </div>
      </Card>

      <p className="text-[13px] text-mut">
        Tri par santé décroissante — les appels à passer sont en tête. Le score
        vient de <span className="cf-fig">/crm/tenants/:id/health</span> ; sans
        lui, la santé retombe sur la dernière commande encaissée (bonne sous 2
        jours, à suivre jusqu&apos;à {CLIENT_RISK_DAYS} jours, à risque au-delà).
        MRR estimé d&apos;après la formule.
      </p>
    </div>
  );
}

/**
 * Une ligne du parc.
 *
 * La ligne ENTIÈRE est le lien vers la fiche : au téléphone on vise large, pas
 * un nom de 90 px. Cible tactile ≥ 44 px de haut (DA §7).
 */
function ClientLine({
  client: c,
  signals,
}: {
  client: ClientRow;
  signals: ClientSignal[];
}) {
  const tone = toneOf(c);
  const risk = tone === "risque";
  const suspended = c.accountStatus === "suspended";
  const mute = (c.devicesOffline ?? 0) > 0;
  const worst = signals.reduce<number>(
    (r, s) => Math.min(r, SEVERITY_RANK[s.severity]),
    9,
  );

  return (
    <Link
      href={`/sm/clients/${c._id}`}
      className={cx(
        "cf-press-row relative flex items-center gap-2.5 border-t border-line px-[18px] py-3 hover:bg-white/4",
        (risk || suspended) && "bg-alert/6",
      )}
    >
      {/*
        Filet rouge en bord de ligne : un décrochage ou une coupure se repère au
        balayage de la colonne, sans lire une seule valeur.
      */}
      {(risk || suspended) && (
        <span className="absolute inset-y-0 left-0 w-[3px] bg-alert" aria-hidden />
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
            <span className="truncate text-[14.5px] font-bold text-ink">{c.name}</span>
            {c.founderSeat && (
              <Icon
                name="star"
                size={14}
                className="shrink-0 text-accent"
                aria-label="Client fondateur"
              />
            )}
            {mute && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-alert/60 px-1.5 py-px text-[10px] font-extrabold uppercase tracking-[0.04em] text-alertt"
                title="Appareil sans battement de cœur — caisse, écran cuisine ou téléviseur"
              >
                <Icon name="tv" size={11} />
                {c.devicesOffline} muet{(c.devicesOffline ?? 0) > 1 ? "s" : ""}
              </span>
            )}
            {worst === 0 && (
              <span
                className="shrink-0 rounded-pill bg-alert px-1.5 py-px text-[10px] font-extrabold uppercase tracking-[0.04em] text-white"
                title="Signal critique ouvert sur ce client"
              >
                signal
              </span>
            )}
          </div>
          <div className="truncate text-xs text-mut">
            {c.city ? `${c.city} · ` : ""}client depuis {fmtMonth(c.since)}
          </div>
        </div>
      </div>

      <span className="w-[78px] shrink-0">
        <PlanPill plan={c.plan} />
      </span>

      <span className="w-[86px] shrink-0">
        <AccountPill status={c.accountStatus} />
      </span>

      <span className="flex w-[74px] shrink-0 justify-center">
        <ScorePill score={c.score} health={c.health} />
      </span>

      <span className="w-[104px] shrink-0 text-right">
        <span
          className={cx(
            "cf-fig block text-sm font-extrabold leading-tight",
            c.orders30d === 0 ? "text-alertt" : "text-ink",
          )}
        >
          {int(c.orders30d)}
        </span>
        <Trend pct={c.trendPct} className="justify-end" />
      </span>

      {/* CA agrégé : arrondi à l'euro, les centimes n'apportent rien ici. */}
      <span className="cf-fig w-[92px] shrink-0 text-right text-sm font-bold text-ink">
        {euroRound(c.revenue30dCents)}
      </span>

      <span
        className={cx(
          "w-[112px] shrink-0 truncate text-right text-[13px]",
          risk ? "font-bold text-alertt" : "text-mut",
        )}
        title={
          c.lastActivityAt
            ? new Date(c.lastActivityAt).toLocaleString("fr-FR")
            : "Aucune activité enregistrée"
        }
      >
        {fmtSince(c.lastActivityAt)}
      </span>

      <span className="cf-fig w-[72px] shrink-0 text-right text-sm font-extrabold text-accent">
        {euroRound(c.mrrCents)}
      </span>

      <Icon name="arrow" size={16} className="w-[16px] shrink-0 text-mut" />
    </Link>
  );
}
