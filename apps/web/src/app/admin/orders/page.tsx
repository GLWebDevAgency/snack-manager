"use client";

/**
 * Vue « Commandes live » — /admin/orders (spec backoffice §6).
 * GET /orders (depuis minuit) + temps réel socket.io :
 * `order.created` → insertion en tête (+ signal sonore best-effort),
 * `order.updated` → mise à jour en place.
 * Chips compteurs vivants, recherche client-side, drawer fiche §6.4,
 * annulation PIN (NF525), impression ticket, « charger plus » au-delà de 50.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { OrderStatus } from "@sm/contracts";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { useTenantSocket } from "@/lib/ws";
import {
  Btn,
  Card,
  Chip,
  EmptyState,
  IconBtn,
  Input,
  Pill,
  Skeleton,
  StatusBadge,
  useToast,
} from "@/components/ui";
import {
  ADVANCE_LABELS,
  CHANNEL_LABELS,
  NEXT_STATUS,
  customerName,
  isPaid,
  linesSummary,
  searchKey,
  shortId,
  slotHHMM,
  type Order,
} from "./types";
import { OrderDrawer } from "./OrderDrawer";
import { CancelModal } from "./CancelModal";
import { PrintTicket } from "./PrintTicket";

const PAGE_SIZE = 50;

const CHIP_DEFS: { key: "all" | OrderStatus; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "new", label: "Nouvelles" },
  { key: "preparing", label: "En prépa" },
  { key: "ready", label: "Prêtes" },
  { key: "delivered", label: "Remises" },
];

/** Largeurs de colonnes exactes de la spec §6.2 (le reste en flex). */
const COLS = {
  num: "w-[50px] shrink-0",
  channel: "w-[120px] shrink-0",
  slot: "w-[100px] shrink-0",
  status: "w-[110px] shrink-0",
  total: "w-[90px] shrink-0 text-right",
  actions: "w-[190px] shrink-0 text-right",
} as const;

/**
 * Signal sonore léger à l'arrivée d'une commande — best-effort, jamais
 * bloquant (contexte audio possiblement suspendu avant le 1er geste).
 */
function ding() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    void ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close().catch(() => {});
  } catch {
    // le son est optionnel — aucune erreur ne doit remonter
  }
}

export default function OrdersPage() {
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  // ── Chargement initial : commandes du jour (depuis minuit local) ──
  const load = useCallback(async () => {
    setError(null);
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const res = await api.get<{ rows: Order[]; total: number } | Order[]>(
        `/orders?since=${encodeURIComponent(since.toISOString())}`,
      );
      setOrders(Array.isArray(res) ? res : (res?.rows ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    // Amorce la liste que les événements temps réel viendront compléter :
    // sans cet appel, l'écran s'ouvre vide en plein service et ne se remplit
    // qu'à la commande suivante.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : les commandes du jour viennent du réseau, aucun rendu ne peut les produire.
    void load();
  }, [load]);

  // ── Mutations locales ──
  const patchOrder = useCallback((id: string, patch: Partial<Order>) => {
    setOrders((prev) =>
      prev ? prev.map((o) => (o._id === id ? { ...o, ...patch } : o)) : prev,
    );
  }, []);

  const replaceOrder = useCallback((o: Order) => {
    setOrders((prev) =>
      prev ? prev.map((x) => (x._id === o._id ? o : x)) : prev,
    );
  }, []);

  // ── Temps réel : created → tête de liste + son ; updated → en place ──
  useTenantSocket({
    "order.created": (payload) => {
      const o = payload as Order;
      if (!o?._id) return;
      setOrders((prev) => {
        if (!prev) return prev;
        if (prev.some((x) => x._id === o._id)) return prev; // déduplication
        return [o, ...prev];
      });
      ding();
    },
    "order.updated": (payload) => {
      const o = payload as Order;
      if (o?._id) replaceOrder(o);
    },
  });
  const { connected } = useTenantSocket();

  // ── Filtre statut → recherche client-side (§6.1), puis pagination ──
  const counts = useMemo(() => {
    const c: Record<"all" | OrderStatus, number> = {
      all: orders?.length ?? 0,
      new: 0,
      preparing: 0,
      ready: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of orders ?? []) c[o.status] += 1;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    let rows = orders ?? [];
    if (filter !== "all") rows = rows.filter((o) => o.status === filter);
    const needle = q.trim().toLowerCase();
    if (needle) rows = rows.filter((o) => searchKey(o).includes(needle));
    return rows;
  }, [orders, filter, q]);

  // Le retour à PAGE_SIZE ne dépend que de `filter` et `q`, tous deux connus au
  // rendu : l'ajustement se fait ici plutôt que dans un effet, pour qu'aucune
  // image intermédiaire n'affiche la liste précédente encore dépliée sous le
  // nouveau filtre. `pagedFor` mémorise le couple pour lequel `limit` a été
  // remis à zéro — les deux valeurs sont comparées séparément, aucune
  // concaténation ne peut donc confondre deux filtres différents.
  const [pagedFor, setPagedFor] = useState({ filter, q });
  if (pagedFor.filter !== filter || pagedFor.q !== q) {
    setPagedFor({ filter, q });
    setLimit(PAGE_SIZE);
  }
  const visible = filtered.slice(0, limit);

  const selected = useMemo(
    () => orders?.find((o) => o._id === selectedId) ?? null,
    [orders, selectedId],
  );

  // ── Actions ──
  function openDrawer(o: Order) {
    setSelectedId(o._id);
    // Le drawer se positionne en absolu dans <main> : on remonte la zone
    // de contenu pour qu'il soit toujours visible à l'ouverture.
    rootRef.current?.closest("main")?.scrollTo({ top: 0 });
  }

  async function advance(o: Order) {
    const next = NEXT_STATUS[o.status];
    if (!next || pending.has(o._id)) return;
    setPending((s) => new Set(s).add(o._id));
    const prevStatus = o.status;
    patchOrder(o._id, { status: next }); // optimiste — le WS confirmera
    try {
      const updated = await api.patch<Order>(`/orders/${o._id}/status`, {
        status: next,
      });
      if (updated?._id) replaceOrder(updated);
    } catch (e) {
      patchOrder(o._id, { status: prevStatus }); // rollback
      toast(e instanceof Error ? e.message : "Échec de la mise à jour du statut");
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(o._id);
        return n;
      });
    }
  }

  /** Rend le ticket de façon synchrone puis ouvre le dialogue d'impression. */
  function printTicket(o: Order) {
    flushSync(() => setPrintOrder(o));
    window.print();
  }

  // ── Rendu ──
  return (
    <div ref={rootRef} className="p-[26px]">
      {/* ── Filtres & recherche (§6.1) ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CHIP_DEFS.map((c) => (
          <Chip key={c.key} on={filter === c.key} onClick={() => setFilter(c.key)}>
            {c.label} ·{" "}
            <span className="cf-fig">
              {orders === null ? "—" : counts[c.key]}
            </span>
          </Chip>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span
            title={
              connected ? "Temps réel actif" : "Temps réel interrompu — reconnexion…"
            }
            className="flex items-center"
          >
            <span
              className={cx("size-2 rounded-full", connected ? "bg-ok" : "bg-alert")}
              aria-hidden
            />
            <span className="sr-only">
              {connected ? "Temps réel actif" : "Temps réel interrompu"}
            </span>
          </span>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Client, n° commande, n° retrait…"
            aria-label="Rechercher une commande"
            className="w-[250px] px-3 py-2"
          />
        </div>
      </div>

      {/* ── Table des commandes (§6.2) ── */}
      <Card>
        <div className="flex items-center gap-3 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-mut">
          <span className={COLS.num}>N°</span>
          <span className="min-w-0 flex-1">Client</span>
          <span className={COLS.channel}>Canal</span>
          <span className={COLS.slot}>Retrait</span>
          <span className={COLS.status}>Statut</span>
          <span className={COLS.total}>Total</span>
          <span className={COLS.actions}>Actions</span>
        </div>

        {error ? (
          <EmptyState
            icon="close"
            title="Impossible de charger les commandes"
            hint={error}
            action={
              <Btn variant="ghost" size="sm" onClick={() => void load()}>
                Réessayer
              </Btn>
            }
          />
        ) : orders === null ? (
          <div aria-busy="true" aria-label="Chargement des commandes">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="border-t border-line2 px-[18px] py-3">
                <Skeleton className="h-10" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          orders.length === 0 ? (
            <EmptyState
              icon="ticket"
              title="Aucune commande aujourd'hui"
              hint="Les nouvelles commandes apparaîtront ici en temps réel."
            />
          ) : (
            <EmptyState
              icon="search"
              title="Aucun résultat"
              hint="Modifiez la recherche ou le filtre sélectionné."
              action={
                q ? (
                  <Btn variant="ghost" size="sm" onClick={() => setQ("")}>
                    Effacer la recherche
                  </Btn>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {visible.map((o) => (
              <div
                key={o._id}
                role="button"
                tabIndex={0}
                aria-label={`Commande n°${o.number} de ${customerName(o)} — ouvrir la fiche`}
                onClick={() => openDrawer(o)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDrawer(o);
                  }
                }}
                className="cf-press-row flex cursor-pointer items-center gap-3 border-t border-line2 px-[18px] py-3 hover:bg-white/4"
              >
                {/* N° retrait */}
                <span
                  className={cx(
                    COLS.num,
                    "cf-fig text-xl font-extrabold text-accent",
                  )}
                >
                  {o.number}
                </span>

                {/* Client + résumé articles */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">
                    {customerName(o)}
                  </div>
                  <div className="truncate text-[13px] text-mut">
                    {shortId(o)} · {linesSummary(o)}
                  </div>
                </div>

                {/* Canal (+ « à payer » si non payée) */}
                {/*
                  Canal : plein (niveau élément) pour « En ligne », contour pour
                  les autres. L'accent est réservé au n° et au total (DA §3) ;
                  l'ancien fond #999 + texte blanc tombait sous le seuil de
                  contraste.
                */}
                <div className={cx(COLS.channel, "flex flex-col items-start gap-0.5")}>
                  <Pill variant={o.channel === "online" ? "solid" : "out"}>
                    {CHANNEL_LABELS[o.channel]}
                  </Pill>
                  {!isPaid(o) && o.payment.status !== "refunded" && (
                    <span className="text-xs font-bold text-prept">· à payer</span>
                  )}
                </div>

                {/* Créneau de retrait */}
                <span className={cx(COLS.slot, "cf-fig text-sm font-semibold text-ink")}>
                  {slotHHMM(o) ?? "—"}
                </span>

                {/* Statut */}
                <div className={COLS.status}>
                  <StatusBadge status={o.status} />
                </div>

                {/* Total */}
                <span
                  className={cx(COLS.total, "cf-fig text-[15px] font-extrabold text-ink")}
                >
                  {fmtEuro(o.totals.total)}
                </span>

                {/* Actions */}
                <div
                  className={cx(COLS.actions, "flex items-center justify-end gap-1.5")}
                >
                  <IconBtn
                    icon="print"
                    label={`Imprimer le ticket n°${o.number}`}
                    size={34}
                    iconSize={16}
                    onClick={(e) => {
                      e.stopPropagation();
                      printTicket(o);
                    }}
                  />
                  {NEXT_STATUS[o.status] ? (
                    <Btn
                      variant="ink"
                      size="sm"
                      disabled={pending.has(o._id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void advance(o);
                      }}
                    >
                      {ADVANCE_LABELS[o.status]}
                    </Btn>
                  ) : (
                    <span className="text-[13px] text-mut">
                      {o.status === "delivered" ? "Terminée" : "Annulée"}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* ── Pagination « charger plus » au-delà de 50 (§6) ── */}
            {filtered.length > limit && (
              <div className="border-t border-line2 bg-black/20 p-3 text-center">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                >
                  Charger plus (
                  <span className="cf-fig">{filtered.length - limit}</span>
                  {" restantes)"}
                </Btn>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Drawer fiche commande (§6.4) — relit l'état courant en direct ── */}
      {selected && (
        <OrderDrawer
          order={selected}
          onClose={() => setSelectedId(null)}
          onPrint={printTicket}
          onCancel={setCancelTarget}
        />
      )}

      {/* ── Modale d'annulation PIN (ajout production) ── */}
      <CancelModal
        order={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={(updated) => {
          replaceOrder(updated);
          setCancelTarget(null);
        }}
      />

      {/* ── Zone d'impression (masquée à l'écran) ── */}
      <PrintTicket order={printOrder} />
    </div>
  );
}
