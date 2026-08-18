"use client";

/**
 * Vue « Avis clients » (spec backoffice-restaurant §11) : bandeau résumé
 * (note moyenne + répartition 1-5), filtres Tous / Sans réponse, cartes avis
 * avec réponse publique du gérant — branchée sur l'API /reviews.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TenantMe } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import {
  Btn,
  Card,
  Chip,
  EmptyState,
  Skeleton,
  Stars,
  Textarea,
  useToast,
} from "@/components/ui";

// ─── Types (miroir de l'API /reviews) ───

type Review = {
  _id: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
  reply: { text: string; at: string; by: string } | null;
};

type Summary = {
  total: number;
  avg: number;
  counts: Record<"1" | "2" | "3" | "4" | "5", number>;
  pending: number;
  monthCount: number;
};

type Filter = "all" | "pending";

/** Date relative façon maquette : « Il y a 2 j », « Il y a 1 sem ». */
function relDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) {
    const s = timeAgo(iso); // « à l'instant », « il y a 3 h »…
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (days < 7) return `Il y a ${days} j`;
  return `Il y a ${Math.floor(days / 7)} sem`;
}

const STARS_DESC = [5, 4, 3, 2, 1] as const;

export default function ReviewsPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    try {
      const [sum, list] = await Promise.all([
        api.get<Summary>("/reviews/summary"),
        api.get<Review[]>(`/reviews${f === "pending" ? "?filter=pending" : ""}`),
      ]);
      setSummary(sum);
      setReviews(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  // Nom du tenant pour le label « Réponse de {nom} » (spec §11.2)
  useEffect(() => {
    api
      .get<TenantMe>("/tenants/me")
      .then((t) => setTenantName(t.name))
      .catch(() => {}); // repli générique — non bloquant
  }, []);

  function changeFilter(f: Filter) {
    if (f === filter) return;
    setReviews(null); // squelettes pendant le rechargement
    setFilter(f);
  }

  async function sendReply(review: Review) {
    const text = (drafts[review._id] ?? "").trim();
    if (!text || replyingId) return;
    setReplyingId(review._id);
    try {
      const updated = await api.post<Review>(`/reviews/${review._id}/reply`, { text });
      setReviews((list) =>
        list?.map((r) =>
          r._id === review._id ? { ...r, reply: updated?.reply ?? r.reply } : r,
        ) ?? null,
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[review._id];
        return next;
      });
      setSummary((s) => (s ? { ...s, pending: Math.max(0, s.pending - 1) } : s));
      toast("Réponse publiée", { icon: "check" });
    } catch (e) {
      toast(
        e instanceof ApiError && e.status === 409
          ? "Cet avis a déjà reçu une réponse"
          : "Envoi impossible — réessayez",
      );
    } finally {
      setReplyingId(null);
    }
  }

  // ─── États globaux ───

  if (error)
    return (
      <div className="p-[26px]">
        <div className="flex flex-col items-start gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
          <p className="text-sm text-alertt">{error}</p>
          <Btn variant="ghost" size="sm" onClick={() => void load(filter)}>
            Réessayer
          </Btn>
        </div>
      </div>
    );

  const replyLabel = `Réponse de ${tenantName ?? "l'établissement"}`;

  return (
    <div className="p-[26px]">
      {/* ── Bandeau résumé (spec §11.1) ── */}
      {summary === null ? (
        <div className="mb-4 flex gap-4">
          <Skeleton className="h-[150px] w-[200px] shrink-0" />
          <Skeleton className="h-[150px] flex-1" />
        </div>
      ) : (
        <div className="mb-4 flex flex-col gap-4 sm:flex-row">
          {/* Carte note moyenne */}
          <Card className="flex w-full shrink-0 flex-col items-center justify-center gap-1 p-5 text-center sm:w-[200px]">
            <div className="text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-accent">
              {summary.avg.toLocaleString("fr-FR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </div>
            <Stars value={summary.avg} size={17} />
            <p className="text-[13px] text-mut">
              {summary.monthCount.toLocaleString("fr-FR")} avis ce mois ·{" "}
              {summary.total.toLocaleString("fr-FR")} au total
            </p>
          </Card>

          {/* Carte distribution 5★ → 1★ */}
          <Card className="flex flex-1 flex-col justify-center gap-1.5 p-5">
            {STARS_DESC.map((s) => {
              const n = summary.counts[String(s) as keyof Summary["counts"]] ?? 0;
              const pct = summary.total === 0 ? 0 : (n / summary.total) * 100;
              return (
                <div key={s} className="flex items-center gap-2.5" aria-hidden>
                  <span className="w-5 shrink-0 text-[13px] tabular-nums text-ink">
                    {s}★
                  </span>
                  <div className="h-[9px] min-w-0 flex-1 overflow-hidden rounded-[5px] bg-surface2">
                    <div
                      className="h-full rounded-[5px] bg-gold"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[13px] tabular-nums text-mut">
                    {n}
                  </span>
                </div>
              );
            })}
            {/* Alternative accessible à la barre de répartition */}
            <table className="sr-only">
              <caption>Répartition des notes</caption>
              <thead>
                <tr>
                  <th scope="col">Note</th>
                  <th scope="col">Nombre d&apos;avis</th>
                </tr>
              </thead>
              <tbody>
                {STARS_DESC.map((s) => (
                  <tr key={s}>
                    <th scope="row">{s} étoiles</th>
                    <td>{summary.counts[String(s) as keyof Summary["counts"]] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ── Filtres ── */}
      <div className="mb-4 flex gap-2" role="group" aria-label="Filtrer les avis">
        <Chip on={filter === "all"} onClick={() => changeFilter("all")}>
          Tous
        </Chip>
        <Chip on={filter === "pending"} onClick={() => changeFilter("pending")}>
          Sans réponse
          {summary && summary.pending > 0 && (
            <span className="tabular-nums text-mut">({summary.pending})</span>
          )}
        </Chip>
      </div>

      {/* ── Liste des avis (spec §11.2) ── */}
      {reviews === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[130px]" />
          <Skeleton className="h-[130px]" />
          <Skeleton className="h-[130px]" />
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          {filter === "pending" ? (
            <EmptyState
              icon="check"
              title="Aucun avis en attente"
              hint="Tous les avis ont reçu une réponse — beau travail."
            />
          ) : (
            <EmptyState
              icon="star"
              title="Aucun avis pour le moment"
              hint="Les avis laissés par vos clients après leur commande apparaîtront ici."
            />
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map((r) => (
            <Card key={r._id} className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-surface2 text-base font-bold text-accent"
                  aria-hidden
                >
                  {r.author.trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">{r.author}</div>
                  <Stars value={r.rating} size={13} />
                </div>
                <span className="shrink-0 text-[13px] text-mut">{relDate(r.createdAt)}</span>
              </div>

              <p className="mt-2.5 text-[15px] leading-[1.4] text-ink">{r.text}</p>

              {r.reply ? (
                <div className="ml-5 mt-2.5 rounded-ctrl border-l-[3px] border-l-accent bg-surface2 px-3.5 py-2.5">
                  <div className="text-[13px] font-semibold text-accent">{replyLabel}</div>
                  <p className="mt-0.5 text-sm text-ink">{r.reply.text}</p>
                </div>
              ) : (
                <form
                  className="mt-2.5 flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendReply(r);
                  }}
                >
                  <Textarea
                    rows={1}
                    value={drafts[r._id] ?? ""}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [r._id]: e.target.value }))
                    }
                    placeholder="Répondre publiquement…"
                    aria-label={`Répondre à l'avis de ${r.author}`}
                    className="min-h-0 flex-1 resize-none py-2.5"
                  />
                  <Btn
                    variant="ink"
                    size="sm"
                    type="submit"
                    disabled={!(drafts[r._id] ?? "").trim() || replyingId === r._id}
                    className="py-[11px]"
                  >
                    {replyingId === r._id ? "Envoi…" : "Répondre"}
                  </Btn>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
