"use client";

import Link from 'next/link';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Icon } from '../ui/icons';
import { Surface, Tap } from '../order/primitives';
import { euros } from '../order/helpers';
import { httpTransport, orderingApi } from '../order/api';
import { CHECKOUT_MAX_LINES, canSubmitCartLines, indexMenu, lineSummary, useCart } from '../order/cart';
import { readCheckoutRecovery } from '../order/checkout-attempt';
import { customerAccountRequest, type CustomerAccountAccess } from './client';
import { createReorderClient, type ReorderState } from './reorder-client';

const secondary = 'cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold hover:border-ink/30 disabled:opacity-40';
type Props = { slug: string; orderId: string; access: CustomerAccountAccess;
  currentAccess: () => CustomerAccountAccess | null; onBack: () => void; onClose: () => void };

function runtime(props: Pick<Props, 'slug' | 'orderId' | 'access' | 'currentAccess'>) {
  let alive = false;
  const client = createReorderClient({ ...props, request: customerAccountRequest(props.slug),
    active: () => alive && document.visibilityState === 'visible' && navigator.onLine !== false,
    // No cached catalogue snapshot authorizes a new selection.
    loadSite: () => orderingApi({ send: request => httpTransport.send({ ...request, revalidate: 0, signal: AbortSignal.timeout(10_000) }) }).loadSite(props.slug),
    hasUnresolvedCheckout: async () => {
      // No account projection is needed: masked attempts expose only whether
      // reconciliation is still required, never their contents or identity.
      const state = await readCheckoutRecovery(props.slug);
      return !!state.hidden?.pending || state.active?.state === 'prepared' || state.active?.state === 'uncertain';
    },
    lock: async job => {
      if (!navigator.locks) throw new Error('Storage coordination unavailable');
      await navigator.locks.request(`sm:customer:${props.slug}`, { signal: AbortSignal.timeout(15_000) }, job);
    },
  });
  return { client, start: () => { alive = true; }, stop: () => { alive = false; client.invalidate(); } };
}

export function ReorderFlow({ slug, orderId, access, currentAccess, onBack, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const run = useMemo(() => runtime({ slug, orderId, access, currentAccess }), [slug, orderId, access, currentAccess]);
  const state = useSyncExternalStore(run.client.subscribe, run.client.getSnapshot, run.client.getServerSnapshot);
  useEffect(() => {
    run.start(); void run.client.load(); heading.current?.focus();
    const pause = () => run.client.invalidate();
    const hidden = () => { if (document.visibilityState !== 'visible') pause(); };
    window.addEventListener('offline', pause); window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', hidden);
    const timeout = setTimeout(pause, Math.max(0, access.expiresAt - Date.now()));
    return () => { run.stop(); clearTimeout(timeout); window.removeEventListener('offline', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', hidden); };
  }, [run, access.expiresAt]);
  useEffect(() => {
    if (!state.snapshot) return;
    const timer = setTimeout(() => run.client.invalidate(), Math.max(0, state.snapshot.response.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [run, state.snapshot]);
  return <section aria-label="Préparer à nouveau ce panier" className="space-y-4">
    <Tap className={secondary + ' w-full justify-start'} onClick={onBack}><Icon name="arrow" size={14} className="rotate-180" />Revenir à ma commande</Tap>
    <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-mut">Vos favoris, à nouveau</p>
      <h3 ref={heading} tabIndex={-1} className="mt-1 font-display text-2xl font-extrabold tracking-tight outline-none">On vous refait ça ?</h3>
      <p className="mt-2 text-sm leading-6 text-mut">Les mêmes choix, s’ils sont toujours proposés. Les prix sont ceux de la carte actuelle.</p></div>
    {state.message && <p role={state.status === 'done' ? 'status' : 'alert'} className="rounded-card border border-ink/15 bg-surface2 p-4 text-sm leading-6">{state.message}</p>}
    {state.status === 'loading' && <p role="status" className="rounded-card bg-surface2 p-5 text-sm text-mut">Vérification de vos articles et de la carte actuelle…</p>}
    {state.snapshot && <Review slug={slug} state={state} client={run.client} />}
    {(state.status === 'idle' || state.status === 'error') && <Tap className={secondary + ' w-full'} onClick={() => void run.client.load()}>Réessayer la vérification</Tap>}
    {state.status === 'done' && <Link prefetch={false} onClick={onClose} href={`/r/${encodeURIComponent(slug)}`} className="cf-press flex min-h-12 items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-bold text-onaccent">Retrouver mon panier<Icon name="arrow" size={16} /></Link>}
  </section>;
}

function Review({ slug, state, client }: { slug: string; state: ReorderState; client: ReturnType<typeof createReorderClient> }) {
  const snapshot = state.snapshot!;
  const index = useMemo(() => indexMenu(snapshot.site.categories), [snapshot.site.categories]);
  const cart = useCart(slug, index);
  const { entries, lines, subtotal } = snapshot.preview;
  const count = lines.reduce((total, line) => total + line.qty, 0);
  const busy = state.status === 'adding';
  const tooManyLines = cart.lines.length + lines.length > CHECKOUT_MAX_LINES;
  const invalidSelection = !canSubmitCartLines([...cart.lines, ...lines]);
  const blocked = busy || !cart.hydrated || !!cart.persistenceError || cart.dropped.length > 0 || !count || invalidSelection;
  return <div className="space-y-4">
    <ul className="space-y-3">{entries.map((entry, position) => <li key={position}>
      <Surface className={'p-4 ' + (entry.line ? '' : 'border-dashed')}><div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="break-words text-sm font-bold">{entry.qty} × {entry.name}</p>
          {entry.line && <p className="mt-1 break-words text-xs leading-5 text-mut">{lineSummary(entry.line)}</p>}</div>
        {entry.line && <span className="shrink-0 text-sm font-bold tabular-nums">{euros(entry.line.unitPrice * entry.qty)}</span>}
      </div>{entry.reason ? <p className="mt-2 text-xs leading-5 text-mut"><span className="font-bold">Non repris. </span>{entry.reason}</p>
        : entry.priceChanged ? <p className="mt-2 text-xs leading-5 text-mut">Prix actualisé : {euros(entry.line!.unitPrice)} l’unité, auparavant {euros(entry.previousUnitPrice)}.</p>
          : <p className="mt-2 text-xs font-semibold text-ok">Choix et prix conservés</p>}</Surface>
    </li>)}</ul>
    <Surface className="border-accent/20 bg-accentwash p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-bold">Articles repris</p><p className="mt-1 text-xs text-mut">{count} article{count > 1 ? 's' : ''} · hors livraison et promotions</p></div><p className="shrink-0 whitespace-nowrap text-xl font-extrabold tabular-nums">{euros(subtotal)}</p></div>
      {cart.count > 0 && <p className="mt-3 border-t border-ink/10 pt-3 text-xs leading-5 text-mut">{cart.count === 1
        ? 'L’article déjà dans votre panier sera conservé.'
        : `Les ${cart.count} articles déjà dans votre panier seront conservés.`}</p>}
    </Surface>
    <p className="text-xs leading-5 text-mut">Après confirmation, ces articles seront enregistrés dans le panier de cet appareil. Les instructions, coordonnées, créneaux et paiements de l’ancienne commande ne sont pas repris.</p>
    {cart.persistenceError && <p role="alert" className="text-sm text-alertt">{cart.persistenceError}</p>}
    {cart.dropped.length > 0 && <p role="alert" className="text-sm text-alertt">Votre panier contient aussi des choix devenus indisponibles. Revenez au menu pour le vérifier d’abord.</p>}
    {count > 0 && invalidSelection && <p role="alert" className="text-sm text-alertt">{tooManyLines
      ? 'Cette reprise dépasserait la limite de 50 lignes par commande. Revenez au menu pour ajuster votre panier.'
      : 'Certains choix ou quantités du panier doivent être ajustés. Revenez au menu avant de reprendre ces articles.'}</p>}
    <Tap disabled={blocked} className="cf-press flex min-h-12 w-full flex-wrap items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent disabled:opacity-40" onClick={() => void client.confirm(cart.appendIfUnchanged)}>
      {busy ? 'Vérification avant ajout…' : count ? `Ajouter ${count} article${count > 1 ? 's' : ''} · ${euros(subtotal)}` : 'Aucun article à reprendre'}
    </Tap>
    <p className="text-center text-xs leading-5 text-mut">Vous vérifierez le panier avant de commander. Aucun paiement ici.</p>
  </div>;
}
