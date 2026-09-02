"use client";

/**
 * JOURNAL D'ERREURS — ce qui a cassé, où, et combien de fois.
 *
 * Alimenté par trois sources qui ne se voient pas : le filtre d'exceptions de
 * l'API (source « API »), le guichet public des interfaces (web, caisse,
 * cuisine), et les services qui constatent une dégradation sans exception.
 * Regroupé par empreinte côté serveur : une avalanche fait UNE ligne avec un
 * compteur, pas mille lignes.
 *
 * « Vu » ne supprime rien : le groupe redescend sous les jamais-vus, son
 * histoire reste — et s'il refrappe, `lastAt` le fait remonter au tri suivant.
 *
 * L'écran affiche aussi l'état du CANAL D'ALERTE, avec un envoi d'essai réel :
 * un veilleur dont on croit qu'il sonne alors qu'aucun canal n'est configuré
 * serait pire que pas de veilleur (voir `AlertsService`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ERROR_SOURCE_LABELS, type ErrorSource, type OpsErrorGroup } from "@sm/contracts";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Card, Chip, Icon, Kpi, Skeleton } from "@/components/ui";

type Canal = { providerName: string; enabled: boolean };

const SOURCES: readonly (ErrorSource | "toutes")[] = ["toutes", "api", "web", "pos", "kds"];

/** « il y a 3 min / 2 h / 4 j » — la précision d'un journal, pas d'une horloge. */
function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export default function ErreursPage() {
  const [groups, setGroups] = useState<OpsErrorGroup[] | null>(null);
  const [canal, setCanal] = useState<Canal | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [filtre, setFiltre] = useState<(typeof SOURCES)[number]>("toutes");
  const [essai, setEssai] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ groups: OpsErrorGroup[] }>("/crm/ops/errors")
      .then((r) => setGroups(r.groups))
      .catch(() => setIndisponible(true));
    api
      .get<Canal>("/crm/ops/alerts")
      .then(setCanal)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const visibles = useMemo(
    () => (groups ?? []).filter((g) => filtre === "toutes" || g.source === filtre),
    [groups, filtre],
  );
  const jamaisVues = (groups ?? []).filter((g) => g.seenAt === null).length;
  const occurrences = (groups ?? []).reduce((n, g) => n + g.count, 0);

  const marquerVue = async (id: string) => {
    // Optimiste : la ligne se grise au clic, rollback par rechargement si l'API refuse.
    setGroups((prev) =>
      prev
        ? prev.map((g) => (g._id === id ? { ...g, seenAt: new Date().toISOString() } : g))
        : prev,
    );
    try {
      await api.post(`/crm/ops/errors/${id}/seen`);
    } catch {
      load();
    }
  };

  const testerCanal = async () => {
    setEssai("Envoi…");
    try {
      const r = await api.post<{ providerName: string; sent: boolean; reason?: string }>(
        "/crm/ops/alerts/test",
      );
      setEssai(r.sent ? `Parti sur « ${r.providerName} » — vérifiez la réception.` : r.reason ?? "Échec d’envoi.");
    } catch {
      setEssai("Échec d’envoi.");
    }
  };

  return (
    // `p-[26px]` : le rembourrage de page commun à toutes les vues /sm — son
    // absence collait les cartes aux bords (seule page du back-office sans lui).
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      {/* ── KPI — 2 × 2 sous `md`, la carte du canal sur sa propre rangée ── */}
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4">
        <Kpi label="Jamais vues" value={groups ? jamaisVues : "—"} icon="bell" />
        <Kpi label="Groupes au journal" value={groups ? groups.length : "—"} icon="grid" />
        <Kpi label="Occurrences cumulées" value={groups ? occurrences : "—"} icon="chart" />
        <Card className="min-w-[260px] flex-1 p-[18px] max-md:col-span-2 max-md:min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Canal d’alerte
          </div>
          <div className="mt-1.5 text-[15px] font-bold text-ink">
            {canal ? (canal.enabled ? canal.providerName : "Aucun canal configuré") : "…"}
          </div>
          {canal?.enabled ? (
            <button
              type="button"
              onClick={() => void testerCanal()}
              className="cf-press mt-2 inline-flex items-center gap-1.5 rounded-pill border border-white/12 bg-white/6 px-3 py-1.5 text-[12px] font-semibold text-mut hover:text-white max-md:min-h-10 max-md:px-3.5"
            >
              <Icon name="arrow" size={13} />
              Tester le canal
            </button>
          ) : (
            <div className="mt-1 text-xs text-mut">
              Poser SM_ALERT_WEBHOOK ou BREVO_API_KEY + SM_ALERT_EMAIL_TO sur Railway — en deux
              minutes via GitHub → Actions → « Variable Railway », téléphone compris. Le veilleur
              dort tant qu’aucun canal n’existe.
            </div>
          )}
          {essai && <div className="mt-1.5 text-xs text-mut">{essai}</div>}
        </Card>
      </div>

      {/* ── Filtre par source ── */}
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => (
          <Chip key={s} on={filtre === s} onClick={() => setFiltre(s)}>
            {s === "toutes" ? "Toutes" : ERROR_SOURCE_LABELS[s]}
          </Chip>
        ))}
      </div>

      {/* ── Le journal ── */}
      {indisponible ? (
        <Card className="p-5 text-[13px] text-mut">
          Journal indisponible — la route /crm/ops/errors n’a pas répondu. Recharger la page ;
          si ça persiste, c’est l’API elle-même qu’il faut regarder.
        </Card>
      ) : groups === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : visibles.length === 0 ? (
        <Card className="p-6 text-center">
          <div className="text-[15px] font-bold text-ink">Rien à signaler</div>
          <div className="mt-1 text-[13px] text-mut">
            Aucune erreur {filtre === "toutes" ? "au journal" : `côté ${ERROR_SOURCE_LABELS[filtre as ErrorSource]}`} —
            le filtre d’API, le guichet des tablettes et le rapporteur web sont pourtant à l’écoute.
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visibles.map((g) => (
            <Card
              key={g._id}
              className={cx("p-4", g.seenAt === null ? "border-alert/40" : "opacity-75")}
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <span
                  className={cx(
                    // Base commune des pastilles d'état (cf. StagePill/HealthPill de parts.tsx) —
                    // même bord 1,5 px, même corps 10px : une seule famille d'un écran à l'autre.
                    "mt-0.5 inline-flex shrink-0 items-center whitespace-nowrap rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
                    g.seenAt === null
                      ? "border-alert/60 text-alertt"
                      : "border-white/12 text-mut",
                  )}
                >
                  {ERROR_SOURCE_LABELS[g.source]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[14px] font-bold text-ink">{g.message}</div>
                  <div className="mt-0.5 text-xs text-mut">
                    ×{g.count} · dernière {fmtAge(g.lastAt)} · première {fmtAge(g.firstAt)}
                    {g.url && <> · {g.url}</>}
                    {g.appVersion && <> · v{g.appVersion}</>}
                  </div>
                  {g.stack && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-semibold text-mut hover:text-white">
                        Pile d’appels
                      </summary>
                      <pre className="mt-1.5 max-h-56 overflow-auto rounded-card bg-white/4 p-3 text-[11px] leading-relaxed text-mut">
                        {g.stack}
                      </pre>
                    </details>
                  )}
                </div>
                {g.seenAt === null && (
                  <button
                    type="button"
                    onClick={() => void marquerVue(g._id)}
                    className="cf-press inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-white/12 bg-white/6 px-3 py-1.5 text-[12px] font-semibold text-mut hover:text-white max-md:min-h-10 max-md:px-3.5"
                  >
                    <Icon name="check" size={13} />
                    Vu
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
