"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { OrderStatusSchema, PaymentMethodSchema, PaymentStatusSchema } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { loadTracking } from "./api";
import { CheckoutAttemptStorageError, forgetDeviceCheckoutReceipt, readDeviceCheckoutReceipts, subscribeCheckoutAttempts, type ReceivedCheckoutAttempt } from "./checkout-attempt";
import { customerTrackingHref } from "./delivery-proof-access";
import { GhostAction, PrimaryAction, Sheet, Surface, Tap } from "./primitives";

const PAGE_SIZE = 8;
const REFRESH_MS = 30_000;
const SummarySchema = z.object({
  _id: z.string(), number: z.number().int().positive(), status: OrderStatusSchema,
  fulfillment: z.enum(["pickup", "delivery", "surplace"]).optional(),
  pickupSlot: z.string().datetime().nullable().optional(),
  delivery: z.object({ dispatchedAt: z.string().datetime().nullable() }).passthrough().nullable().optional(),
  payment: z.object({ method: PaymentMethodSchema, status: PaymentStatusSchema }).passthrough().optional(),
}).passthrough();
export type DeviceOrderSummary = { number: number; section: "active" | "finished"; label: string; slot: string | null };

/** Only a correlated live response determines completion/payment. A stored
 * receipt supplies navigation, never an authoritative "paid" or "delivered".
 */
export function deviceOrderSummary(raw: unknown, orderId: string): DeviceOrderSummary {
  const order = SummarySchema.parse(raw);
  if (order._id !== orderId) throw new Error("Unexpected order");
  const finished = order.status === "cancelled" || order.status === "delivered";
  const delivery = order.fulfillment === "delivery";
  const label = order.status === "cancelled" ? "Commande annulée"
    : order.status === "delivered" ? delivery ? "Livrée" : "Remise au client"
      : order.payment?.status === "refunded" ? "Paiement remboursé · contactez le restaurant"
        : (delivery && order.payment?.status !== "paid") || (order.payment?.status === "pending" && order.payment.method === "online") ? "Paiement à confirmer"
          : order.status === "preparing" ? "En préparation"
            : order.status === "ready" ? delivery ? order.delivery?.dispatchedAt ? "En route" : "Prête à partir" : "Prête à retirer"
              : "Commande reçue";
  return { number: order.number, section: finished ? "finished" : "active", label, slot: order.pickupSlot ?? null };
}

type Row = { saved: ReceivedCheckoutAttempt; summary: DeviceOrderSummary | null; checking: boolean };
type Props = { open: boolean; slug: string; tenantName: string; embed?: boolean; onClose: () => void };
const canRead = () => document.visibilityState === "visible" && navigator.onLine !== false;
const dateLabel = (at: number | string) => new Date(at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** Keyed isolation also protects consumers other than the storefront. */
export function DeviceOrdersSheet(props: Props) {
  return <DeviceOrdersSession key={props.slug} {...props} />;
}

function DeviceOrdersSession({ open, slug, tenantName, embed = false, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const active = useRef(false);
  const mutation = useRef(false);
  const refreshing = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback(() => { generation.current++; controller.current?.abort(); refreshing.current = false; }, []);
  const refresh = useCallback(async () => {
    if (!active.current || mutation.current || !canRead()) return;
    stop();
    const run = generation.current;
    const abort = new AbortController(); controller.current = abort;
    refreshing.current = true;
    const current = () => active.current && run === generation.current && !abort.signal.aborted;
    setLoading(true); setError(null);
    try {
      // This sheet is intentionally the guest-only device list. Account orders
      // are read from the authenticated history, never via a tracking alias.
      const saved = await readDeviceCheckoutReceipts(slug, null);
      if (!current()) return;
      const visible = saved.slice(0, limit);
      setTotal(saved.length); setLoaded(true);
      setRows(previous => visible.map(item => ({ saved: item, checking: true, summary: previous.find(row => row.saved.receipt.orderId === item.receipt.orderId && row.saved.receipt.trackingToken === item.receipt.trackingToken)?.summary ?? null })));
      let index = 0;
      const worker = async () => {
        while (current() && index < visible.length) {
          const item = visible[index++];
          let summary: DeviceOrderSummary | null = null;
          try {
            summary = deviceOrderSummary(await loadTracking(item.receipt.orderId, item.receipt.trackingToken,
              AbortSignal.any([abort.signal, AbortSignal.timeout(8_000)])), item.receipt.orderId);
          } catch { /* Unknown is explicit; never recover status/payment from the receipt. */ }
          if (!current()) return;
          setRows(previous => previous.map(row => row.saved.receipt.orderId === item.receipt.orderId ? { ...row, summary, checking: false } : row));
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, visible.length) }, worker));
    } catch {
      if (current()) { setRows([]); setTotal(0); setError("Les raccourcis enregistrés ne peuvent pas être relus. Autorisez le stockage de ce navigateur puis réessayez. Aucune commande n’a été supprimée."); }
    } finally { if (current()) { refreshing.current = false; setLoading(false); } }
  }, [limit, slug, stop]);

  useEffect(() => {
    active.current = open;
    if (!open) return;
    const changed = () => {
      if (canRead()) void refresh();
      else {
        stop(); setLoading(false);
        setRows(previous => previous.map(row => ({ ...row, summary: null, checking: false })));
        setError("Connexion requise pour vérifier vos commandes. Les raccourcis restent conservés sur cet appareil.");
      }
    };
    // IndexedDB and network state are external, only read after explicit opening.
    changed();
    const unsubscribe = subscribeCheckoutAttempts(tenant => { if (tenant === slug) changed(); });
    // Slow paginated batches must finish. Only a changed scope/journal or an
    // explicit visibility/network transition may supersede an in-flight batch.
    const timer = window.setInterval(() => { if (canRead() && !refreshing.current) void refresh(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { active.current = false; stop(); unsubscribe(); window.clearInterval(timer); document.removeEventListener("visibilitychange", changed); window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, [open, refresh, slug, stop]);

  async function forget(orderId: string) {
    if (mutation.current || !active.current) return;
    mutation.current = true; stop(); setLoading(false); setForgetting(true); setMessage(null); setActionError(null);
    try {
      await forgetDeviceCheckoutReceipt(slug, orderId);
      if (!active.current) return;
      setConfirmId(null);
      setRows(previous => previous.filter(row => row.saved.receipt.orderId !== orderId));
      setMessage("Raccourci oublié sur cet appareil. La commande et son paiement sont inchangés.");
    } catch (cause) {
      if (!active.current) return;
      setActionError(cause instanceof CheckoutAttemptStorageError && cause.code === "conflict"
        ? "Ce raccourci protège encore votre commande en cours. Dans le panier, choisissez « Préparer une nouvelle commande » avant de l’oublier. Cela n’annule pas la commande."
        : "Le raccourci n’a pas pu être oublié. Il reste conservé ; réessayez.");
    } finally {
      mutation.current = false;
      if (active.current) { setForgetting(false); void refresh(); }
    }
  }

  const groups = [
    { key: "active", label: "En cours", matches: (row: Row) => row.summary?.section === "active" },
    { key: "unknown", label: "À vérifier", matches: (row: Row) => !row.summary },
    { key: "finished", label: "Terminées", matches: (row: Row) => row.summary?.section === "finished" },
  ];
  return <Sheet open={open} onClose={() => { setConfirmId(null); setActionError(null); setMessage(null); onClose(); }} navigationLocked={forgetting} title="Mes commandes" maxHeight="92%" headerExtra={<p className="mt-1 truncate text-xs text-mut">Sur cet appareil · {tenantName}</p>}>
    {open && <div className="space-y-5 px-4 py-5">
      <p className="text-sm leading-6 text-mut">Retrouvez les commandes passées en invité depuis ce navigateur, pendant sept jours. Les commandes liées à votre compte se consultent dans Mon compte ; ces raccourcis invités ne sont pas synchronisés avec vos autres appareils.</p>
      {error && <p role="alert" className="rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{error}</p>}
      {actionError && <p role="alert" className="rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{actionError}</p>}
      {message && <p role="status" className="text-sm leading-6 text-okt">{message}</p>}
      {!loaded && loading && <p role="status" className="py-6 text-sm text-mut">Recherche de vos commandes enregistrées…</p>}
      {loaded && !loading && !error && total === 0 && <Surface className="p-5 text-center"><Icon name="ticket" size={26} className="mx-auto text-mut" /><h3 className="mt-3 text-lg font-bold">Aucune commande enregistrée ici</h3><p className="mt-2 text-sm leading-6 text-mut">Vos prochains liens de suivi apparaîtront ici. Si vous avez déjà commandé ailleurs, ouvrez le lien conservé sur cet autre navigateur.</p></Surface>}
      {groups.map(group => {
        const entries = rows.filter(group.matches);
        return entries.length > 0 && <section key={group.key} aria-label={group.label}><h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-mut">{group.label} · {entries.length}</h3><ul className="space-y-3">{entries.map(row => {
          const id = row.saved.receipt.orderId;
          const number = row.summary?.number ?? row.saved.receipt.number;
          return <li key={id}><Surface className="p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="font-bold">{number === undefined ? "Votre commande" : `Commande n° ${number}`}</h4><p className="mt-1 text-xs leading-5 text-mut">Enregistrée le {dateLabel(row.saved.updatedAt)}</p></div><Icon name={row.saved.receipt.type === "delivery" ? "truck" : "ticket"} size={19} className="shrink-0 text-mut" /></div>
            <p className={`mt-3 text-sm font-semibold ${row.summary ? "text-ink" : "text-prept"}`}>{row.summary?.label ?? (row.checking ? "Vérification de l’état…" : "État inconnu — ouvrir le suivi")}</p>
            {row.summary?.slot && <p className="mt-1 text-xs text-mut">Créneau : {dateLabel(row.summary.slot)}</p>}
            {row.checking && row.summary && <p className="mt-1 text-xs text-mut">Dernier état connu · vérification en cours</p>}
            {confirmId === id ? <div className="mt-4 border-t border-line pt-4" role="group" aria-label="Confirmer l’oubli du raccourci"><h5 className="text-sm font-bold">Oublier ce raccourci ?</h5><p className="mt-2 text-sm leading-6 text-mut">Cela ne supprime ni la commande ni le paiement, et ne modifie pas son code de remise. Sans autre lien conservé, vous pourriez perdre l’accès à ce suivi. Une demande encore à vérifier ne sera jamais effacée ici.</p><div className="mt-3 flex flex-col gap-2"><Tap autoFocus className="min-h-12 rounded-pill border border-ink/12 bg-surface2 px-5 text-sm font-bold" disabled={forgetting} onClick={() => { setConfirmId(null); setActionError(null); }}>Garder le raccourci</Tap><PrimaryAction disabled={forgetting} loading={forgetting} onClick={() => void forget(id)}>Oublier le raccourci</PrimaryAction></div></div>
              : <div className="mt-4 flex flex-col gap-2"><Link href={customerTrackingHref(id, row.saved.receipt.trackingToken, null, 0)} prefetch={false} target={embed ? "_blank" : undefined} rel="noreferrer" className="cf-press flex min-h-12 items-center justify-center gap-2 rounded-pill border border-accent/30 bg-accentwash px-4 text-sm font-bold text-accentink" aria-label={`Suivre la commande${number === undefined ? "" : ` n° ${number}`}`}>Ouvrir le suivi <Icon name="arrow" size={15} /></Link><Tap disabled={forgetting} className="min-h-11 rounded-pill px-3 text-xs font-semibold text-mut hover:text-ink" onClick={() => { setMessage(null); setConfirmId(id); }}>Oublier ce raccourci</Tap></div>}
          </Surface></li>;
        })}</ul></section>;
      })}
      {total > rows.length && <GhostAction disabled={loading || forgetting} onClick={() => setLimit(value => value + PAGE_SIZE)}>Afficher plus de commandes ({total - rows.length})</GhostAction>}
      <GhostAction disabled={loading || forgetting} onClick={() => void refresh()}>{loading ? "Vérification…" : "Actualiser les états"}</GhostAction>
      <p className="text-xs leading-5 text-mut">Une demande interrompue se reprend depuis le panier. Effacer les données de ce navigateur supprime ses raccourcis, pas vos commandes auprès du restaurant.</p>
    </div>}
  </Sheet>;
}
