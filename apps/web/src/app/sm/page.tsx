"use client";

/**
 * Tableau de bord HQ — ce que l'équipe regarde en arrivant le matin.
 *
 * En TÊTE, les gestes du jour : trois à cinq appels tirés de la file de
 * signaux, dans l'ordre où on décroche. Le reste répond à « où en est la
 * société ? » — places fondateur restantes, MRR estimé, clients actifs, leads
 * en cours, pipeline, santé du parc, dernières relances.
 *
 * L'ordre n'est pas cosmétique : un tableau de bord qui ouvre sur des totaux
 * se regarde, un tableau de bord qui ouvre sur des appels se traite.
 *
 * Aucune donnée n'est inventée : tout vient de `/crm/overview`, `/crm/tenants`
 * et `/crm/signals` (montants en CENTIMES, convertis à l'affichage).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  FOUNDER_SEATS_TOTAL,
  LEAD_PIPELINE,
  LEAD_STAGE_LABELS,
  LEAD_SEQUENCE_LABELS,
  relanceDue,
  type CrmClient,
  type CrmLead,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { Card, EmptyState, Icon, Kpi, Panel, Skeleton } from "@/components/ui";
import { crm, euroRound, fmtDaysAgo, int, useHq } from "./crm";
import { clientsApi } from "./clients/data";
import { SeverityPill } from "./clients/ui";
import { readWorkSignals, todaysMoves, type WorkSignal } from "./signals/data";
import { Eyebrow, HealthPill } from "./parts";

export default function HqDashboard() {
  const { overview, loading } = useHq();
  const [clients, setClients] = useState<CrmClient[] | null>(null);
  const [signals, setSignals] = useState<WorkSignal[] | null>(null);
  const [leads, setLeads] = useState<CrmLead[] | null>(null);

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
    // Le pipeline entier, pour la file « à relancer » : la cadence se calcule
    // au rendu (`relanceDue`), l'API n'a rien à savoir de l'heure qu'il est.
    crm
      .leads()
      .then((l) => {
        if (!cancelled) setLeads(l);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      });
    // La file de travail annote le tableau de bord ; son absence ne doit pas
    // l'empêcher de s'afficher. Une liste vide se lit « rien à traiter », et
    // c'est une information juste tant que la route répond.
    clientsApi
      .signals()
      .then((raw) => {
        if (!cancelled) setSignals(readWorkSignals(raw));
      })
      .catch(() => {
        if (!cancelled) setSignals([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Un client, un geste : voir `todaysMoves`. */
  const moves = useMemo(() => todaysMoves(signals ?? [], 5), [signals]);

  /** Les leads dont la cadence de relance est dépassée, les plus en retard d'abord. */
  const aRelancer = useMemo(() => {
    const now = new Date();
    return (leads ?? [])
      .map((lead) => ({ lead, ...relanceDue(lead, now) }))
      .filter((x) => x.due)
      .sort((a, b) => b.retardJours - a.retardJours);
  }, [leads]);

  if (loading && !overview) {
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <div className="flex gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] flex-1" />
          ))}
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-[280px] flex-[1.4]" />
          <Skeleton className="h-[280px] flex-1" />
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-[26px]">
        <Card>
          <EmptyState
            icon="bell"
            title="Données HQ indisponibles"
            hint="L'API n'a pas répondu. Rechargez la page — si le problème persiste, vérifiez que le service tourne."
          />
        </Card>
      </div>
    );
  }

  const seats = overview.founderSeats;
  const maxStage = Math.max(1, ...LEAD_PIPELINE.map((s) => overview.stages[s]));
  const atRisk = (clients ?? []).filter((c) => c.health === "risque");

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      {/* ── Les gestes du jour ── */}
      <Panel
        title="Les gestes du jour"
        sub={
          signals === null
            ? "Lecture de la file de travail…"
            : moves.length === 0
              ? "Aucun signal ouvert sur le parc"
              : `${moves.length} appel${moves.length > 1 ? "s" : ""} à passer, du plus urgent au moins urgent`
        }
        actions={
          <Link
            href="/sm/signals"
            className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
          >
            File de travail
            {(signals?.length ?? 0) > moves.length && (
              <span className="cf-fig rounded-pill bg-white/15 px-1.5 text-[11px] font-extrabold">
                {signals!.length}
              </span>
            )}
            <Icon name="arrow" size={15} />
          </Link>
        }
        bodyClassName="flex flex-col gap-1.5"
      >
        {signals === null ? (
          <Skeleton className="h-[52px]" />
        ) : moves.length === 0 ? (
          <p className="text-[13px] text-mut">
            Rien à traiter ce matin : pas d&apos;impayé, pas de décrochage, pas
            d&apos;appareil muet. Le bon moment pour appeler un client qui va bien.
          </p>
        ) : (
          moves.map((m, i) => <MoveRow key={m.key} move={m} rank={i + 1} />)
        )}
      </Panel>

      {/* ── À relancer aujourd'hui ── */}
      <Panel
        title="À relancer aujourd'hui"
        sub={
          leads === null
            ? "Lecture du pipeline…"
            : aRelancer.length === 0
              ? "Toutes les cadences de relance sont tenues"
              : `${aRelancer.length} lead${aRelancer.length > 1 ? "s" : ""} au-delà de sa cadence — le plus en retard d'abord`
        }
        actions={
          <Link
            href="/sm/pipeline"
            className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
          >
            Pipeline
            <Icon name="arrow" size={15} />
          </Link>
        }
        bodyClassName="flex flex-col gap-1.5"
      >
        {leads === null ? (
          <Skeleton className="h-[52px]" />
        ) : aRelancer.length === 0 ? (
          <p className="text-[13px] text-mut">
            Personne n&apos;attend : chaque lead ouvert a été touché dans les délais de sa
            séquence (A à J+3, B à J+7, C au mois, une semaine sans séquence).
          </p>
        ) : (
          aRelancer.slice(0, 8).map(({ lead, retardJours }) => (
            <div
              key={lead._id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-white/6 bg-white/3 px-3.5 py-2.5"
            >
              <span
                className={cx(
                  "cf-fig w-[64px] shrink-0 text-[13px] font-extrabold",
                  retardJours >= 3 ? "text-alertt" : "text-prept",
                )}
              >
                {retardJours === 0 ? "ce jour" : `+${retardJours} j`}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[14px] font-bold text-ink">{lead.restaurantName}</span>
                <span className="ml-2 text-xs text-mut">
                  {lead.sequence
                    ? LEAD_SEQUENCE_LABELS[lead.sequence]
                    : "sans séquence"}
                  {" · "}
                  {lead.lastTouchAt
                    ? `relancé ${timeAgo(lead.lastTouchAt)}`
                    : "jamais relancé"}
                </span>
              </div>
              {lead.contact.phone && (
                <a
                  href={`tel:${lead.contact.phone.replace(/\s/g, "")}`}
                  className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-white/12 bg-white/6 px-3 py-1.5 text-[12px] font-semibold text-mut hover:text-white"
                >
                  <Icon name="phone" size={13} />
                  {lead.contact.phone}
                </a>
              )}
            </div>
          ))
        )}
        {aRelancer.length > 8 && (
          <p className="text-xs text-mut">
            … et {aRelancer.length - 8} de plus — le pipeline les liste tous.
          </p>
        )}
      </Panel>

      {/* ── Les quatre chiffres ── */}
      <div className="flex items-stretch gap-4">
        <Kpi
          label="Places fondateur"
          value={`${seats.remaining} / ${seats.total}`}
          icon="star"
        />
        <Kpi label="MRR estimé" value={euroRound(overview.mrrCents)} icon="euro" />
        <Kpi
          label="Clients actifs"
          value={int(overview.activeClients)}
          icon="user"
          delta={
            overview.atRiskClients > 0
              ? {
                  dir: "down",
                  text: `${overview.atRiskClients} à rappeler`,
                }
              : undefined
          }
        />
        <Kpi label="Leads en cours" value={int(overview.leadsOpen)} icon="grid" />
      </div>

      {/* ── Pipeline + places fondateur ── */}
      <div className="flex items-start gap-4">
        <Panel
          className="flex-[1.4]"
          title="Pipeline en un coup d'œil"
          sub={`${int(overview.leadsTotal)} leads au total · ${int(overview.stages.signe)} signé${overview.stages.signe > 1 ? "s" : ""}`}
          actions={
            <Link
              href="/sm/pipeline"
              className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
            >
              Ouvrir
              <Icon name="arrow" size={15} />
            </Link>
          }
        >
          <div className="flex flex-col gap-2.5">
            {LEAD_PIPELINE.map((stage) => {
              const n = overview.stages[stage];
              return (
                <Link
                  key={stage}
                  href="/sm/pipeline"
                  className="cf-press-row group flex items-center gap-3 rounded-ctrl px-2 py-1.5 hover:bg-white/5"
                >
                  <span className="w-[120px] shrink-0 truncate text-[13px] font-semibold text-mut group-hover:text-white">
                    {LEAD_STAGE_LABELS[stage]}
                  </span>
                  {/*
                    Entonnoir à baseline zéro : la largeur est proportionnelle
                    au nombre de leads de l'étape la plus fournie. La crête
                    laiton porte l'accent, la masse n'est qu'un voile (DA §3).
                  */}
                  <span className="relative h-[22px] min-w-0 flex-1 overflow-hidden rounded-xs bg-white/4">
                    <span
                      className="absolute inset-y-0 left-0 rounded-xs"
                      style={{
                        width: `${Math.max(n > 0 ? 3 : 0, (n / maxStage) * 100)}%`,
                        background:
                          "linear-gradient(90deg, color-mix(in srgb, var(--cf-accent) 24%, transparent), color-mix(in srgb, var(--cf-accent) 7%, transparent))",
                        boxShadow: "inset -3px 0 0 0 var(--cf-accent)",
                        transition: "width .45s var(--sm-ease)",
                      }}
                      aria-hidden
                    />
                  </span>
                  <span className="cf-fig w-8 shrink-0 text-right text-sm font-extrabold text-ink">
                    {n}
                  </span>
                </Link>
              );
            })}
            {overview.stages.perdu > 0 && (
              <div className="mt-1 border-t border-line2 pt-2.5 text-[13px] text-mut">
                {int(overview.stages.perdu)} lead
                {overview.stages.perdu > 1 ? "s" : ""} perdu
                {overview.stages.perdu > 1 ? "s" : ""} — à reprendre en séquence C
              </div>
            )}
          </div>
        </Panel>

        <Panel
          className="flex-1"
          title="Programme fondateur"
          sub="10 places à tarif gelé à vie"
        >
          <div className="flex items-baseline gap-2">
            <span className="cf-fig text-[44px] font-extrabold leading-none text-accent">
              {seats.remaining}
            </span>
            <span className="text-sm font-semibold text-mut">
              place{seats.remaining > 1 ? "s" : ""} encore libre
              {seats.remaining > 1 ? "s" : ""}
            </span>
          </div>

          {/* Dix cases : le compteur se lit sans lire le chiffre (DA §7). */}
          <div className="mt-4 grid grid-cols-5 gap-1.5" aria-hidden>
            {Array.from({ length: FOUNDER_SEATS_TOTAL }, (_, i) => {
              const signed = i < seats.clients;
              const held = !signed && i < seats.taken;
              return (
                <span
                  key={i}
                  className={cx(
                    "grid h-9 place-items-center rounded-xs border text-[11px] font-extrabold",
                    signed && "border-accent bg-accent text-onaccent",
                    held && "border-accent/45 bg-accent/12 text-accent",
                    !signed && !held && "border-white/10 bg-white/4 text-white/25",
                  )}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>

          <dl className="mt-4 flex flex-col gap-2 border-t border-line2 pt-3 text-[13px]">
            <Row label="Clients signés" value={int(seats.clients)} strong />
            <Row label="Réservées au pipeline" value={int(seats.reserved)} />
            <Row label="Restantes" value={int(seats.remaining)} />
          </dl>
        </Panel>
      </div>

      {/* ── Parc client + relances ── */}
      <div className="flex items-start gap-4">
        <Panel
          className="flex-[1.4]"
          title="Santé du parc"
          sub={`${int(overview.clients)} restaurant${overview.clients > 1 ? "s" : ""} client${overview.clients > 1 ? "s" : ""} · ${int(overview.orders30d)} commandes sur 30 jours`}
          actions={
            <Link
              href="/sm/clients"
              className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
            >
              Détail
              <Icon name="arrow" size={15} />
            </Link>
          }
          bodyClassName="flex flex-col gap-2"
        >
          {clients === null ? (
            <Skeleton className="h-16" />
          ) : clients.length === 0 ? (
            <p className="text-[13px] text-mut">Aucun restaurant client pour l&apos;instant.</p>
          ) : (
            clients.slice(0, 5).map((c) => (
              <div
                key={c._id}
                className={cx(
                  "flex items-center gap-3 rounded-card border p-3",
                  c.health === "risque"
                    ? "border-alert/35 bg-alert/6"
                    : "border-white/6 bg-[image:var(--cf-elev-gradient)]",
                )}
              >
                <div
                  className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[13px] font-extrabold text-onaccent"
                  aria-hidden
                >
                  {c.name.trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-ink">{c.name}</div>
                  <div className="truncate text-xs text-mut">
                    {int(c.orders30d)} commandes / 30 j · dernière{" "}
                    {fmtDaysAgo(c.daysSinceLastOrder)}
                  </div>
                </div>
                <HealthPill health={c.health} />
              </div>
            ))
          )}
          {atRisk.length > 0 && (
            <p className="mt-1 text-[13px] font-bold text-alertt">
              {atRisk.map((c) => c.name).join(", ")} — plus une seule commande depuis 7
              jours. À rappeler cette semaine.
            </p>
          )}
        </Panel>

        <Panel
          className="flex-1"
          title="Dernières relances"
          sub="Chaque envoi tracé : date, canal, message"
          bodyClassName="flex flex-col gap-2"
        >
          {overview.recentTouches.length === 0 ? (
            <p className="text-[13px] text-mut">
              Aucune relance tracée pour l&apos;instant.
            </p>
          ) : (
            overview.recentTouches.map((t, i) => (
              <div
                key={`${t.leadId}-${t.at}-${i}`}
                className="flex items-start gap-2.5 rounded-ctrl bg-white/4 px-3 py-2"
              >
                <span
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-ink">
                    {t.restaurantName}
                  </div>
                  {t.note && (
                    <div className="line-clamp-2 text-xs text-mut">{t.note}</div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-mut">{timeAgo(t.at)}</span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <Eyebrow className="pt-1">
        MRR estimé d&apos;après le plan de chaque restaurant actif · source de vérité
        facturation : Stripe
      </Eyebrow>
    </div>
  );
}

/**
 * Un geste du jour = un appel à passer.
 *
 * Numéroté, parce que c'est un ORDRE de travail et pas une liste de faits : le
 * 1 se traite avant le 2. La ligne entière ouvre la fiche du restaurant, d'où
 * part l'appel. La dernière ligne est la consigne rédigée par l'API — ce qu'on
 * fait de ce signal, pas seulement ce qu'on constate.
 */
function MoveRow({ move: m, rank }: { move: WorkSignal; rank: number }) {
  return (
    <Link
      href={m.href}
      className={cx(
        "cf-press-row flex items-start gap-3 rounded-card border p-3 hover:bg-white/5",
        m.severity === "critique"
          ? "border-alert/35 bg-alert/6"
          : "border-white/6 bg-[image:var(--cf-elev-gradient)]",
      )}
    >
      <span
        className="cf-fig mt-px grid size-[26px] shrink-0 place-items-center rounded-xs border border-white/10 bg-white/5 text-[13px] font-extrabold text-mut"
        aria-hidden
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-bold text-ink">
            {m.tenantName || "Restaurant inconnu"}
          </span>
          <SeverityPill severity={m.severity} label={m.kindLabel} />
        </div>
        <div className="mt-0.5 truncate text-xs text-mut">{m.title}</div>
        <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-[1.4] text-ink/90">
          {m.action}
        </p>
      </div>
      <Icon name="arrow" size={16} className="mt-1 shrink-0 text-mut" />
    </Link>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-mut">{label}</dt>
      <dd
        className={cx(
          "cf-fig font-extrabold",
          strong ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
