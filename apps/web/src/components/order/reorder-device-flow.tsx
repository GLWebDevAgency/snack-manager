'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { httpTransport, orderingApi, type MenuCategory } from './api';
import { CHECKOUT_MAX_LINES, canSubmitCartLines, indexMenu, lineSummary, useCart } from './cart';
import { readCheckoutRecovery, readDeviceCheckoutReceipts, subscribeCheckoutAttempts, type ReceivedCheckoutAttempt } from './checkout-attempt';
import { createDeviceReorderClient, type DeviceReorderState } from './reorder-device-client';
import { euros } from './helpers';
import { GhostAction, PrimaryAction, Surface, Tap } from './primitives';

type Props = { slug: string; receipt: ReceivedCheckoutAttempt; onBack: () => void; onReordered?: () => void; onBusyChange?: (busy: boolean) => void; onCatalogVerified?: (categories: MenuCategory[]) => void };
function runtime(slug: string, receipt: ReceivedCheckoutAttempt, onCatalogVerified?: Props['onCatalogVerified']) {
  let alive = false;
  const client = createDeviceReorderClient({ slug, receipt, onCatalogVerified,
    active: () => alive && document.visibilityState === 'visible' && navigator.onLine !== false,
    readReceipts: () => readDeviceCheckoutReceipts(slug, null),
    loadSource: async () => {
      const response = await httpTransport.send({ method: 'GET', path: `/public/tenants/${encodeURIComponent(slug)}/orders/${encodeURIComponent(receipt.receipt.orderId)}/reorder?t=${encodeURIComponent(receipt.receipt.trackingToken)}`,
        revalidate: 0, signal: AbortSignal.timeout(10_000) });
      if (response.status !== 200) throw new Error('Reprise indisponible');
      return response.body;
    },
    loadSite: () => orderingApi({ send: request => httpTransport.send({ ...request, revalidate: 0, signal: AbortSignal.timeout(10_000) }) }).loadSite(slug),
    hasUnresolvedCheckout: async () => {
      const recovery = await readCheckoutRecovery(slug);
      return !!recovery.hidden?.pending || recovery.active?.state === 'prepared' || recovery.active?.state === 'uncertain';
    },
  });
  return { client, start: () => { alive = true; }, stop: () => { alive = false; client.invalidate(); } };
}

export function ReorderDeviceFlow({ slug, receipt, onBack, onReordered, onBusyChange, onCatalogVerified }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const run = useMemo(() => runtime(slug, receipt, onCatalogVerified), [slug, receipt, onCatalogVerified]);
  const state = useSyncExternalStore(run.client.subscribe, run.client.getSnapshot, run.client.getServerSnapshot);
  const busy = state.status === 'adding';
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    run.start(); void run.client.load(); heading.current?.focus();
    const pause = () => run.client.invalidate();
    const hidden = () => { if (document.visibilityState !== 'visible') pause(); };
    const unsubscribe = subscribeCheckoutAttempts(tenant => { if (tenant === slug) pause(); });
    window.addEventListener('offline', pause); window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', hidden);
    return () => { run.stop(); unsubscribe(); window.removeEventListener('offline', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', hidden); };
  }, [run, slug]);
  return <section aria-label="Préparer à nouveau ce panier" className="space-y-4">
    <GhostAction disabled={busy} onClick={onBack}>Revenir à mes commandes</GhostAction>
    <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-mut">Votre commande n° {receipt.receipt.number ?? '—'}</p>
      <h3 ref={heading} tabIndex={-1} className="mt-1 font-display text-2xl font-extrabold tracking-tight outline-none">On vous refait ça ?</h3>
      <p className="mt-2 text-sm leading-6 text-mut">Retrouvez vos choix disponibles, aux prix de la carte actuelle. Vérifiez-les avant de les ajouter.</p></div>
    {state.message && <p role={state.status === 'done' ? 'status' : 'alert'} className="rounded-card border border-line bg-surface2 p-4 text-sm leading-6">{state.message}</p>}
    {state.status === 'loading' && <p role="status" className="py-5 text-sm text-mut">Vérification de vos articles et de la carte actuelle…</p>}
    {state.snapshot && <Review slug={slug} state={state} client={run.client} />}
    {(state.status === 'idle' || state.status === 'error') && <GhostAction onClick={() => void run.client.load()}>Réessayer la vérification</GhostAction>}
    {state.status === 'done' && <PrimaryAction onClick={onReordered ?? onBack}>Retrouver mon panier</PrimaryAction>}
  </section>;
}

function Review({ slug, state, client }: { slug: string; state: DeviceReorderState; client: ReturnType<typeof createDeviceReorderClient> }) {
  const snapshot = state.snapshot!;
  const index = useMemo(() => indexMenu(snapshot.site.categories), [snapshot.site.categories]);
  const cart = useCart(slug, index);
  const { entries, lines, subtotal } = snapshot.preview;
  const count = lines.reduce((sum, line) => sum + line.qty, 0);
  const invalid = !canSubmitCartLines([...cart.lines, ...lines]);
  const busy = state.status === 'adding';
  const blocked = busy || !cart.hydrated || !!cart.persistenceError || !!cart.dropped.length || !count || invalid;
  return <div className="space-y-4">
    <ul className="space-y-3">{entries.map((entry, position) => <li key={position}><Surface className="p-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-bold">{entry.qty} × {entry.name}</p>
        {entry.line && <p className="mt-1 break-words text-xs leading-5 text-mut">{lineSummary(entry.line)}</p>}</div>
        {entry.line && <span className="shrink-0 text-sm font-bold tabular-nums">{euros(entry.line.unitPrice * entry.qty)}</span>}</div>
      {entry.reason ? <p className="mt-2 text-xs leading-5 text-mut"><strong>Non repris. </strong>{entry.reason}</p>
        : entry.priceChanged ? <p className="mt-2 text-xs leading-5 text-mut">Prix actualisé : {euros(entry.line!.unitPrice)} l’unité, auparavant {euros(entry.previousUnitPrice)}.</p>
          : <p className="mt-2 text-xs font-semibold text-okt">Choix et prix conservés</p>}
    </Surface></li>)}</ul>
    <Surface className="border-accent/20 bg-accentwash p-4"><div className="flex justify-between gap-3"><p className="text-sm font-bold">{count} article{count > 1 ? 's' : ''} repris</p><strong className="tabular-nums">{euros(subtotal)}</strong></div>
      <p className="mt-2 text-xs leading-5 text-mut">Hors livraison et promotions. {cart.count ? `Les ${cart.count} article(s) déjà au panier seront conservés.` : 'Votre panier est actuellement vide.'}</p></Surface>
    <p className="text-xs leading-5 text-mut">Les instructions, coordonnées, créneaux et paiements de l’ancienne commande ne sont pas repris.</p>
    {cart.persistenceError && <p role="alert" className="text-sm text-alertt">{cart.persistenceError}</p>}
    {!!cart.dropped.length && <p role="alert" className="text-sm text-alertt">Vérifiez d’abord les choix devenus indisponibles dans votre panier.</p>}
    {count > 0 && invalid && <p role="alert" className="text-sm text-alertt">{cart.lines.length + lines.length > CHECKOUT_MAX_LINES ? 'Cette reprise dépasserait la limite de 50 lignes du panier.' : 'Vérifiez les quantités et choix de votre panier avant cet ajout.'}</p>}
    <Tap disabled={blocked} onClick={() => void client.confirm(cart.appendIfUnchanged)} className="flex min-h-13 w-full flex-wrap items-center justify-center rounded-pill bg-accent px-4 py-3 text-sm font-bold text-onaccent disabled:opacity-40">{busy ? 'Vérification et ajout…' : `Ajouter ces articles · ${euros(subtotal)}`}</Tap>
  </div>;
}
