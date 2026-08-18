"use client";

/**
 * Onglet Mouvements : journal des entrées/sorties de stock
 * (GET /supply/movements?ingredientId=&limit=). Filtre ingrédient (serveur)
 * et filtre type (client — l'API ne l'expose pas), quantité SIGNÉE colorée
 * (vert entrée / rouge sortie) et pagination « charger plus ».
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STOCK_MOVEMENT_TYPES,
  type StockMovementRow,
  type StockMovementType,
  type SupplyIngredient,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Icon, Select, Skeleton } from "@/components/ui";
import {
  ErrorState,
  MOVEMENT_META,
  MovementBadge,
  Th,
  UNIT_LABELS,
  fmtDateTimeFr,
  fmtQty,
} from "./shared";

/** Pas de pagination ; l'API plafonne `limit` à 200. */
const PAGE = 50;
const MAX = 200;

export function MovementsTab({
  ingredients,
}: {
  ingredients: SupplyIngredient[];
}) {
  const [ingredientId, setIngredientId] = useState("");
  const [type, setType] = useState<StockMovementType | "">("");
  const [limit, setLimit] = useState(PAGE);
  const [rows, setRows] = useState<StockMovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (ingredientId) qs.set("ingredientId", ingredientId);
      setRows(
        await api.get<StockMovementRow[]>(`/supply/movements?${qs.toString()}`),
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Chargement du journal impossible",
      );
    } finally {
      setBusy(false);
    }
  }, [ingredientId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Le type est filtré côté client : le lot chargé peut en contenir d'autres.
  const visible = useMemo(
    () => (rows ?? []).filter((m) => !type || m.type === type),
    [rows, type],
  );

  const hasFilter = Boolean(ingredientId || type);
  const loaded = rows?.length ?? 0;
  const canLoadMore = rows !== null && loaded >= limit && limit < MAX;

  function reset() {
    setIngredientId("");
    setType("");
    setLimit(PAGE);
  }

  return (
    <div>
      {/* ── Barre d'outils ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Select
          value={ingredientId}
          onChange={(e) => {
            setIngredientId(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Filtrer par ingrédient"
          className="w-[240px]"
        >
          <option value="">Tous les ingrédients</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as StockMovementType | "")}
          aria-label="Filtrer par type de mouvement"
          className="w-[180px]"
        >
          <option value="">Tous les types</option>
          {STOCK_MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_META[t].label}
            </option>
          ))}
        </Select>
        {hasFilter && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white/6 px-3 py-[7px] text-[13px] font-semibold text-ink transition-colors duration-200 ease-sm hover:bg-white/10"
          >
            Réinitialiser les filtres
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {/* ── Journal ── */}
      {rows === null ? (
        error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-11" />
            <Skeleton className="h-[320px]" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          <Card>
            {visible.length === 0 ? (
              <EmptyState
                icon="clock"
                title={
                  hasFilter
                    ? "Aucun mouvement pour ce filtre"
                    : "Aucun mouvement"
                }
                hint={
                  hasFilter
                    ? "Changez d'ingrédient ou de type — ou chargez plus d'historique."
                    : "Les réceptions, pertes et inventaires enregistrés apparaîtront ici."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <Th>Date</Th>
                      <Th>Ingrédient</Th>
                      <Th>Type</Th>
                      <Th className="text-right">Quantité</Th>
                      <Th>Référence</Th>
                      <Th>Note</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-line2 transition-colors duration-200 last:border-b-0 hover:bg-white/3"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-mut tabular-nums">
                          {fmtDateTimeFr(m.at)}
                        </td>
                        <td className="px-4 py-3 font-bold text-ink">
                          {m.ingredientName}
                        </td>
                        <td className="px-4 py-3">
                          <MovementBadge type={m.type} />
                        </td>
                        <td
                          className={cx(
                            "whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums",
                            m.qty > 0
                              ? "text-okt"
                              : m.qty < 0
                                ? "text-alertt"
                                : "text-mut",
                          )}
                        >
                          {m.qty > 0 ? "+" : m.qty < 0 ? "−" : ""}
                          {fmtQty(Math.abs(m.qty))} {UNIT_LABELS[m.unit]}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[13px] text-mut">
                          {m.ref ?? "—"}
                        </td>
                        <td className="max-w-[280px] px-4 py-3 text-[13px] text-mut">
                          <span
                            className="block truncate"
                            title={m.note ?? undefined}
                          >
                            {m.note ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-mut tabular-nums">
              <span>
                {visible.length} mouvement{visible.length > 1 ? "s" : ""}
                {type &&
                  loaded !== visible.length &&
                  ` sur ${loaded} chargé${loaded > 1 ? "s" : ""}`}
              </span>
              {canLoadMore ? (
                <Btn
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setLimit((l) => Math.min(l + PAGE, MAX))}
                >
                  {busy ? "Chargement…" : "Charger plus"}
                </Btn>
              ) : (
                loaded >= MAX && (
                  <span className="text-[12px]">
                    Journal limité aux {MAX} derniers mouvements — filtrez par
                    ingrédient pour remonter plus loin.
                  </span>
                )
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
