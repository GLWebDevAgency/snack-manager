"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CustomerOrderDetail, CustomerOrderSummary } from '@sm/contracts';
import { Icon } from '../ui/icons';
import { Surface, Tap } from '../order/primitives';
import { euros } from '../order/helpers';
import { customerAccountRequest, type CustomerAccountAccess } from './client';
import { createCustomerOrdersClient } from './orders';

const action = 'cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold hover:border-ink/30 disabled:cursor-wait disabled:opacity-40';
const date = (value: string) => new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const statusLabels = { new: 'Commande reçue', preparing: 'En préparation', ready: 'Prête', delivered: 'Commande remise', cancelled: 'Commande annulée' };
export function customerOrderStatus(order: CustomerOrderSummary, delivery?: CustomerOrderDetail['delivery']) {
  if (order.status === 'cancelled') return statusLabels.cancelled;
  if (order.status === 'delivered') return order.type === 'delivery' ? 'Livrée' : 'Remise au client';
  if (order.payment.status === 'refunded') return 'Paiement remboursé';
  if (order.payment.pendingRefundCents > 0) return 'Remboursement en cours';
  if (order.payment.status !== 'paid' && (order.type === 'delivery' || order.payment.method === 'online')) return 'Paiement à confirmer';
  // The list DTO has no dispatch evidence. Only a detail response may say that
  // a ready delivery has left (or is still waiting to leave) the restaurant.
  if (order.status === 'ready') return order.type === 'delivery' ? !delivery ? 'Prête' : delivery.dispatchedAt ? 'En route' : 'Prête à partir' : 'Prête à retirer';
  return statusLabels[order.status];
}
function Payment({ order }: { order: CustomerOrderSummary }) {
  return <div className="space-y-1 text-xs leading-5 text-mut"><p>{order.payment.status === 'paid' ? 'Paiement confirmé' : order.payment.status === 'refunded' ? 'Paiement remboursé' : order.type === 'pickup' && order.payment.method === 'counter' ? 'À régler au comptoir' : 'À vérifier auprès du restaurant'}</p>
    {order.payment.refundedCents > 0 && <p>Remboursé : {euros(order.payment.refundedCents)}</p>}
    {order.payment.pendingRefundCents > 0 && <p>Remboursement en cours : {euros(order.payment.pendingRefundCents)}</p>}</div>;
}
function ordersRuntime(slug: string, access: CustomerAccountAccess) {
  let alive = false;
  const client = createCustomerOrdersClient({ access, request: customerAccountRequest(slug),
    active: () => alive && document.visibilityState === 'visible' && navigator.onLine !== false,
    lock: typeof navigator !== 'undefined' && navigator.locks ? async job => { await navigator.locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, job); } : undefined,
  });
  return { client, start: () => { alive = true; }, stop: () => { alive = false; client.invalidate(); } };
}

/** Mounted by an explicit account action. The parent drops this component as
 * soon as its displayed publication is invalidated, even for identical profiles. */
export function CustomerOrders({ slug, access, onBack }: { slug: string; access: CustomerAccountAccess; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const runtime = useMemo(() => ordersRuntime(slug, access), [slug, access]);
  const { client } = runtime;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  useEffect(() => {
    runtime.start();
    void client.load();
    const pause = () => { client.invalidate(); };
    const hidden = () => { if (document.visibilityState !== 'visible') pause(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('offline', pause); window.addEventListener('pagehide', pause);
    return () => { runtime.stop(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('offline', pause); window.removeEventListener('pagehide', pause); };
  }, [client, runtime]);
  useEffect(() => {
    const until = state.expiresAt ?? access.expiresAt;
    if (until <= Date.now()) { client.invalidate(); return; }
    const timer = setTimeout(() => client.invalidate(), until - Date.now());
    return () => clearTimeout(timer);
  }, [client, state.expiresAt, access.expiresAt]);
  useEffect(() => { heading.current?.focus(); }, [state.orderId]);
  const busy = state.status === 'loading';
  const backToList = () => { client.back(); if (!client.getSnapshot().orders.length) void client.load(); };
  const retry = () => { if (state.orderId) void client.open(state.orderId); else void client.load(); };
  return <section aria-label="Commandes de votre compte" className="space-y-4">
    <Tap className={action + ' w-full justify-start'} onClick={state.orderId ? backToList : onBack}><Icon name="arrow" size={14} className="rotate-180" />{state.orderId ? 'Revenir à mes commandes' : 'Revenir à mon compte'}</Tap>
    <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-mut">Compte personnel</p><h3 ref={heading} tabIndex={-1} className="mt-1 font-display text-xl font-extrabold tracking-tight outline-none">{state.orderId ? state.detail ? `Commande n° ${state.detail.number}` : 'Détail de la commande' : 'Mes commandes'}</h3>
      <p className="mt-2 text-sm leading-6 text-mut">{state.orderId ? 'État confirmé par le restaurant lors de cette lecture.' : 'Uniquement les commandes liées à ce compte, dans ce restaurant. Les suivis invités restent dans « Sur cet appareil ».'}</p></div>
    {!state.orderId && <div role="group" aria-label="Filtrer mes commandes" className="grid grid-cols-3 gap-1 rounded-ctrl bg-ink/5 p-1">{([['all', 'Toutes'], ['active', 'En cours'], ['past', 'Terminées']] as const).map(([filter, label]) => <Tap key={filter} disabled={busy} aria-pressed={state.filter === filter} onClick={() => void client.load(filter)} className={`min-h-11 rounded-ctrl px-1 text-xs font-bold sm:text-sm ${state.filter === filter ? 'bg-surface text-ink shadow-sm' : 'text-mut'}`}>{label}</Tap>)}</div>}
    {state.message && <p role="alert" className="rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{state.message}</p>}
    {busy && <p role="status" className="rounded-card border border-ink/10 bg-surface2 p-4 text-sm text-mut">Lecture de {state.orderId ? 'votre commande' : 'vos commandes'}…</p>}
    {!state.orderId && state.status === 'ready' && state.orders.length === 0 && <Surface className="p-5 text-center"><Icon name="ticket" size={26} className="mx-auto text-mut" /><h4 className="mt-3 font-bold">{state.filter === 'active' ? 'Aucune commande en cours' : state.filter === 'past' ? 'Aucune commande terminée' : 'Aucune commande liée à ce compte'}</h4><p className="mt-2 text-sm leading-6 text-mut">Les anciennes commandes invitées ne sont pas rattachées automatiquement.</p></Surface>}
    {!state.orderId && <ul className="space-y-3">{state.orders.map(order => <li key={order._id}><Surface className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="font-bold">Commande n° {order.number}</h4><p className="mt-1 text-xs leading-5 text-mut">{date(order.createdAt)} · {order.type === 'delivery' ? 'Livraison' : 'Retrait'}</p></div><span className="shrink-0 font-bold tabular-nums">{euros(order.totalCents)}</span></div><p className="mt-3 text-sm font-semibold">{customerOrderStatus(order)}</p><Payment order={order} />
      {order.pickupSlot && <p className="mt-2 text-xs leading-5 text-mut">Créneau : {date(order.pickupSlot)}</p>}<Tap className={action + ' mt-4 w-full border-accent/25 bg-accentwash text-accentink'} disabled={busy} onClick={() => void client.open(order._id)} aria-label={`Voir la commande n° ${order.number}`}>Voir le détail <Icon name="arrow" size={14} /></Tap></Surface></li>)}</ul>}
    {state.detail && <OrderDetail order={state.detail} />}
    {!state.orderId && state.nextCursor && <Tap className={action + ' w-full'} disabled={busy} onClick={() => void client.more()}>Afficher les commandes précédentes</Tap>}
    <Tap className={action + ' w-full'} disabled={busy} onClick={retry}>{state.status === 'error' || state.status === 'idle' ? 'Réessayer la lecture' : 'Actualiser les états'}</Tap>
    <p className="text-xs leading-5 text-mut">Ces informations ne sont pas conservées hors connexion. Pour une modification ou une question sur le paiement, contactez le restaurant.</p>
  </section>;
}
function OrderDetail({ order }: { order: CustomerOrderDetail }) {
  return <div className="space-y-4"><Surface className="p-4"><p className="text-sm font-bold">{customerOrderStatus(order, order.delivery)}</p><p className="mt-1 text-xs leading-5 text-mut">{order.type === 'delivery' ? 'Livraison' : 'Retrait'} · {date(order.createdAt)}</p>{order.pickupSlot && <p className="mt-1 text-xs text-mut">Créneau : {date(order.pickupSlot)}</p>}<div className="mt-3"><Payment order={order} /></div></Surface>
    <section aria-label="Contenu de la commande"><h4 className="mb-3 text-sm font-bold">Votre commande</h4><ul className="divide-y divide-ink/10">{order.lines.map((line, index) => <li key={index} className="py-3"><div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-bold">{line.qty} × {line.name}{line.variantName ? ` · ${line.variantName}` : ''}</p><span className="shrink-0 text-sm font-semibold tabular-nums">{euros(line.lineTotal)}</span></div>
      {line.options.length > 0 && <p className="mt-1 break-words text-xs leading-5 text-mut">{line.options.map(option => option.name).join(' · ')}</p>}{line.removed.length > 0 && <p className="mt-1 break-words text-xs leading-5 text-mut">Sans : {line.removed.join(', ')}</p>}{line.note && <p className="mt-1 break-words text-xs leading-5 text-mut">{line.note}</p>}</li>)}</ul></section>
    <dl className="space-y-2 rounded-card bg-surface2 p-4 text-sm"><div className="flex justify-between gap-3"><dt>Sous-total</dt><dd className="tabular-nums">{euros(order.totals.subtotal)}</dd></div>{order.totals.deliveryFee > 0 && <div className="flex justify-between gap-3"><dt>Livraison</dt><dd>{euros(order.totals.deliveryFee)}</dd></div>}{order.totals.discount && <div className="flex justify-between gap-3"><dt className="min-w-0 break-words">{order.totals.discount.reason || 'Réduction'}</dt><dd className="shrink-0">−{euros(order.totals.discount.amount)}</dd></div>}<div className="flex justify-between gap-3 border-t border-ink/10 pt-3 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{euros(order.totals.total)}</dd></div></dl>
    {order.note && <section><h4 className="text-sm font-bold">Note de commande</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-mut">{order.note}</p></section>}
    {order.statusHistory.length > 0 && <section aria-label="Étapes de la commande"><h4 className="text-sm font-bold">Étapes confirmées</h4><ol className="mt-2 space-y-2">{order.statusHistory.map((step, index) => <li key={index} className="flex flex-wrap justify-between gap-x-3 text-xs leading-5 text-mut"><span>{step.status === 'delivered' ? order.type === 'delivery' ? 'Livrée' : 'Remise au client' : statusLabels[step.status]}</span><time dateTime={step.at}>{date(step.at)}</time></li>)}</ol></section>}
  </div>;
}
