"use client";

/**
 * FILE DE TRAVAIL HEBDOMADAIRE — ce que l'équipe traite cette semaine.
 *
 * La liste des clients répond à « comment va le parc ? ». Cette page répond à
 * une autre question, plus étroite et plus utile le lundi matin : « qui
 * j'appelle, dans quel ordre, et pour lui dire quoi ? »
 *
 * D'où le groupement par GRAVITÉ plutôt que par client : deux ruptures de
 * stock chez deux restaurants différents se traitent dans le même geste, alors
 * qu'une rupture et une hausse de prix chez le même client ne se traitent pas
 * du tout au même moment. Chaque ligne mène à la fiche concernée en un clic —
 * c'est là que se passe l'appel.
 *
 * Cloisonnement : `/crm/signals` traverse tout le parc, rôle `sm_admin`
 * exigé côté API. Respect des clients de nos clients : un signal porte un
 * ÉTABLISSEMENT et un agrégat, jamais un consommateur.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { Card, Chip, EmptyState, Icon, Kpi, Skeleton } from "@/components/ui";
import { int } from "../crm";
import {
  clientsApi,
  readClientRows,
  readSignals,
  SIGNAL_SEVERITIES,
  SIGNAL_SEVERITY_HINTS,
  SIGNAL_SEVERITY_LABELS,
  SEVERITY_BORDER,
  type ClientRow,
  type ClientSignal,
  type SignalSeverity,
} from "../clients/data";
import { Unavailable } from "../clients/ui";

const SEVERITY_ICON: Record<SignalSeverity, "bell" | "clock" | "star"> = {
  critique: "bell",
  attention: "clock",
  info: "star",
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<ClientSignal[] | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [only, setOnly] = useState<SignalSeverity | "tous">("tous");

  useEffect(() => {
    let cancelled = false;
    clientsApi
      .signals()
      .then((raw) => {
        if (!cancelled) setSignals(readSignals(raw));
      })
      .catch(() => {
        if (cancelled) return;
        setSignals([]);
        setFailed(true);
      });
    // Le parc sert d'annuaire : un signal peut ne porter qu'un `tenantId`, et
    // « 6a84…5ba9 » ne se dit pas au téléphone.
    clientsApi
      .list()
      .then((raw) => {
        if (!cancelled) setClients(readClientRows(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const names = useMemo(
    () => new Map(clients.map((c) => [c._id, c])),
    [clients],
  );

  const grouped = useMemo(() => {
    const map = new Map<SignalSeverity, ClientSignal[]>(
      SIGNAL_SEVERITIES.map((s) => [s, []]),
    );
    for (const s of signals ?? []) map.get(s.severity)!.push(s);
    // À gravité égale, le plus ancien d'abord : un signal qui traîne depuis
    // dix jours est plus urgent que celui de ce matin.
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    }
    return map;
  }, [signals]);

  if (signals === null) {
    return (
      <div className="flex flex-col gap-4 p-[26px]">
        <div className="flex gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[124px] flex-1" />
          ))}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  const total = signals.length;
  const shown = SIGNAL_SEVERITIES.filter((s) => only === "tous" || only === s);

  return (
    <div className="flex flex-col gap-4 p-[26px]">
      {/*
        La coquille `/sm` titre d'après sa propre table de navigation, qui ne
        connaît pas encore cette page : on repose donc un titre ici plutôt que
        de laisser l'en-tête annoncer autre chose.
      */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
            File de travail
          </h2>
          <p className="mt-0.5 text-sm text-mut">
            Les signaux du parc, groupés par gravité — du plus urgent au simple
            prétexte d&apos;appel.
          </p>
        </div>
        <Link
          href="/sm/clients"
          className="cf-press inline-flex items-center gap-[9px] whitespace-nowrap rounded-pill border border-line bg-white/3 px-3.5 py-[9px] text-[13px] font-bold text-white hover:border-white/25 hover:bg-white/8"
        >
          <Icon name="user" size={15} />
          Restaurants clients
        </Link>
      </div>

      <div className="flex items-stretch gap-4">
        {SIGNAL_SEVERITIES.map((s) => (
          <Kpi
            key={s}
            label={SIGNAL_SEVERITY_LABELS[s]}
            value={int(grouped.get(s)!.length)}
            icon={SEVERITY_ICON[s]}
            delta={
              s === "critique" && grouped.get(s)!.length > 0
                ? { dir: "down", text: "à traiter aujourd'hui" }
                : undefined
            }
          />
        ))}
      </div>

      {failed && (
        <Unavailable
          title="File de signaux indisponible"
          hint="La route /crm/signals n'a pas répondu. Elle est en cours de livraison — en attendant, la liste des clients reste la porte d'entrée : elle remonte les décrochages en tête."
        />
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip on={only === "tous"} onClick={() => setOnly("tous")}>
            Tout
            <span className="cf-fig rounded-pill bg-white/12 px-1.5 text-[11px] font-extrabold">
              {total}
            </span>
          </Chip>
          {SIGNAL_SEVERITIES.map((s) => (
            <Chip key={s} on={only === s} onClick={() => setOnly(s)}>
              {SIGNAL_SEVERITY_LABELS[s]}
              <span
                className={cx(
                  "cf-fig rounded-pill px-1.5 text-[11px] font-extrabold",
                  s === "critique"
                    ? "bg-alert text-white"
                    : s === "attention"
                      ? "bg-prep/80 text-black"
                      : "bg-white/12",
                )}
              >
                {grouped.get(s)!.length}
              </span>
            </Chip>
          ))}
        </div>
      )}

      {total === 0 && !failed ? (
        <Card>
          <EmptyState
            icon="check"
            title="Rien à traiter cette semaine"
            hint="Aucun signal ouvert sur le parc : pas de décrochage, pas d'appareil muet, pas de rupture. Profitez-en pour appeler un client qui va bien."
          />
        </Card>
      ) : (
        shown.map((severity) => {
          const rows = grouped.get(severity)!;
          if (rows.length === 0) return null;
          return (
            <SeverityGroup
              key={severity}
              severity={severity}
              signals={rows}
              names={names}
            />
          );
        })
      )}
    </div>
  );
}

function SeverityGroup({
  severity,
  signals,
  names,
}: {
  severity: SignalSeverity;
  signals: ClientSignal[];
  names: Map<string, ClientRow>;
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-3 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3">
        <span
          className={cx(
            "inline-flex items-center gap-1.5 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
            SEVERITY_BORDER[severity],
          )}
        >
          <span
            className={cx(
              "size-[7px] rounded-full",
              severity === "critique"
                ? "bg-alert animate-pulse"
                : severity === "attention"
                  ? "bg-prep"
                  : "bg-white/40",
            )}
            aria-hidden
          />
          {SIGNAL_SEVERITY_LABELS[severity]}
        </span>
        <span className="cf-fig text-[13px] font-extrabold text-ink">
          {int(signals.length)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-mut">
          {SIGNAL_SEVERITY_HINTS[severity]}
        </span>
      </div>

      <ul className="cf-scroll overflow-x-auto [&>li]:min-w-[720px]">
        {signals.map((s) => {
          const client = names.get(s.tenantId);
          const label = s.tenantName || client?.name || "Restaurant inconnu";
          return (
            <li key={s.id}>
              <Link
                href={s.tenantId ? `/sm/clients/${s.tenantId}` : "/sm/clients"}
                className={cx(
                  "cf-press-row flex items-center gap-3 border-t border-line px-[18px] py-3 hover:bg-white/4",
                  severity === "critique" && "bg-alert/6",
                )}
              >
                <div className="min-w-0 flex-[1.2]">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-bold text-ink">
                      {label}
                    </span>
                    {client?.city && (
                      <span className="shrink-0 text-xs text-mut">{client.city}</span>
                    )}
                  </div>
                  {s.kind && (
                    <div className="mt-0.5 truncate text-xs uppercase tracking-[0.06em] text-mut">
                      {s.kind}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-[2]">
                  <div className="truncate text-[13.5px] font-semibold text-ink">
                    {s.title}
                  </div>
                  {s.detail && (
                    <div className="truncate text-xs text-mut">{s.detail}</div>
                  )}
                </div>

                <span
                  className="w-[104px] shrink-0 truncate text-right text-[12.5px] text-mut"
                  title={s.at ? new Date(s.at).toLocaleString("fr-FR") : undefined}
                >
                  {s.at ? timeAgo(s.at) : "—"}
                </span>

                <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-bold text-accent">
                  Ouvrir la fiche
                  <Icon name="arrow" size={15} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
