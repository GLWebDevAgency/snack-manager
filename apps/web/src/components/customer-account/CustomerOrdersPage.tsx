"use client";

import { useCallback, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { BrandMode } from '@sm/contracts';
import type { MenuCategory } from '../order/api';
import { Surface, Tap } from '../order/primitives';
import { Icon } from '../ui/icons';
import { CustomerOrders } from './CustomerOrders';
import { useCustomerAccount } from './useCustomerAccount';
import './customer-account.css';

type Source = 'account' | 'device';
type Props = {
  slug: string; restaurantName: string; mode?: BrandMode; deviceOrders: ReactNode;
  onAccount: () => void; onBack?: () => void; onReordered?: () => void;
  onCatalogVerified?: (categories: MenuCategory[]) => void;
  onNavigationLockedChange?: (locked: boolean) => void;
  /** The independent device-receipt controller owns this lock. */
  navigationLocked?: boolean;
};
const action = 'cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-40';

/** Mount only for the active Orders destination. The session and its private
 * reader are never retained by an inactive tab or copied into device receipts. */
export function CustomerOrdersPage({ slug, restaurantName, deviceOrders, onAccount, onBack, onReordered,
  onCatalogVerified, onNavigationLockedChange, navigationLocked = false }: Props) {
  const { state, currentAccess, refresh } = useCustomerAccount(slug, true);
  const [source, setSource] = useState<Source>('account');
  const [adding, setAdding] = useState(false);
  const id = useId();
  // This reference belongs to the exact authoritative store publication. A
  // different publication mounts a fresh reader even for an identical profile.
  const access = useMemo(() => state.status === 'authenticated' && state.view && !state.busy
    ? currentAccess() : null, [state, currentAccess]);
  const privateKey = access ? JSON.stringify([slug, access.selection, access.expiresAt]) : null;
  const activeSource = access ? source : 'device';
  const locked = adding || navigationLocked;
  const reportAdding = useCallback((value: boolean) => {
    setAdding(value); onNavigationLockedChange?.(value);
  }, [onNavigationLockedChange]);
  const select = (next: Source) => { if (!locked) setSource(next); };
  const keySelect = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); if (locked) return;
    const next = event.key === 'Home' ? 'account' : event.key === 'End' ? 'device' : activeSource === 'account' ? 'device' : 'account';
    select(next); document.getElementById(`${id}-${next}`)?.focus();
  };
  return <section className="sm-account-page" aria-labelledby={`${id}-title`}>
    <header className="sm-account-page-heading"><p>{restaurantName}</p><h2 id={`${id}-title`}>Mes commandes</h2></header>
    <div className="sm-account-page-content space-y-5">
      {access ? <>
        <div role="tablist" aria-label="Source des commandes" className="sm-account-sources">
          {([['account', 'Mon compte'], ['device', 'Cet appareil']] as const).map(([key, label]) => <Tap key={key}
            role="tab" id={`${id}-${key}`} aria-controls={`${id}-orders`} aria-selected={activeSource === key}
            tabIndex={activeSource === key ? 0 : -1} disabled={locked} onKeyDown={keySelect} onClick={() => select(key)}
            className="sm-account-source">{label}</Tap>)}
        </div>
        <div role="tabpanel" id={`${id}-orders`} aria-labelledby={`${id}-${activeSource}`} tabIndex={0} className="min-w-0 outline-none">
          {activeSource === 'account' ? <CustomerOrders key={privateKey} slug={slug} access={access} presentation="page"
            onBack={onAccount} currentAccess={currentAccess} onClose={onReordered ?? onBack}
            onCatalogVerified={onCatalogVerified} onNavigationLockedChange={reportAdding} /> : deviceOrders}
        </div>
      </> : <>
        <Surface className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start gap-3"><span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-card bg-accentwash text-accentink"><Icon name="user" size={20} /></span>
            <div className="min-w-0"><h3 className="text-base font-bold">Vos commandes, sur tous vos appareils</h3>
              <p className="mt-1 text-sm leading-6 text-mut">Connectez-vous pour retrouver les commandes liées à votre compte dans ce restaurant. Les reçus invités restent disponibles ci-dessous.</p></div></div>
          {(state.status === 'loading' || state.status === 'idle') && <p role="status" className="text-sm text-mut">Vérification de votre session…</p>}
          {state.message && <p role={state.status === 'error' ? 'alert' : 'status'} className="text-sm leading-6 text-mut">{state.message}</p>}
          {state.status === 'offline' && !state.message && <p role="status" className="text-sm leading-6 text-mut">Reconnectez-vous pour consulter les commandes de votre compte.</p>}
          <Tap className={action + ' w-full border-accent/25 bg-accentwash text-accentink'} disabled={locked || state.busy} onClick={onAccount}><Icon name="user" size={16} />{state.accessAvailable || state.registrationAvailable ? 'Se connecter à mon compte' : 'Mon compte'}</Tap>
          {['error', 'unavailable', 'offline'].includes(state.status) && <Tap className={action + ' w-full'} disabled={locked || state.busy} onClick={() => void refresh()}>Actualiser ma session</Tap>}
        </Surface>
        {deviceOrders}
      </>}
      {onBack && <Tap className={action + ' w-full'} disabled={locked} onClick={onBack}><Icon name="arrow" size={14} className="rotate-180" />Revenir à la carte</Tap>}
    </div>
  </section>;
}
