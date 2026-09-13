"use client";

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BrandMode, CustomerAccountView } from '@sm/contracts';
import { Icon } from '../ui/icons';
import { Field, Input } from '../ui/fields';
import type { MenuCategory } from '../order/api';
import { Sheet, Tap } from '../order/primitives';
import type { useCustomerAccount } from './useCustomerAccount';
import { CustomerEnrollment } from './CustomerEnrollment';
import { CustomerOrders } from './CustomerOrders';
import { CustomerLoyalty } from './CustomerLoyalty';
import { sameOrderAccess } from './orders';
import type { CustomerAccountAccess } from './client';
import './customer-account.css';

type Account = ReturnType<typeof useCustomerAccount>;
const secondary = 'cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold hover:border-ink/30 disabled:cursor-wait disabled:opacity-40';
const primary = 'cf-press flex min-h-12 w-full items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent disabled:cursor-not-allowed disabled:opacity-40';

/** Kept separate so dropping the authoritative view unmounts every personal
 * draft. No profile data, token, OTP or mutation is persisted by this UI. */
function Profile({ account, view, forLoyalty = false }: { account: Account; view: CustomerAccountView; forLoyalty?: boolean }) {
  const inputId = useId();
  const [draft, setDraft] = useState<{ name: string; revision: number } | null>(null);
  const [logoutChoice, setLogoutChoice] = useState<boolean | null>(null);
  const { state, saveName, logout } = account;
  const name = draft?.name ?? view.profile.name ?? '';
  const stale = draft !== null && draft.revision !== view.profile.revision;
  const changed = name.trim() !== (view.profile.name ?? '');
  const invalid = name.trim().length > 120 || /[\p{Cc}\p{Cf}]/u.test(name);
  const locked = state.busy || state.status !== 'authenticated';

  async function save() {
    if (locked || stale || invalid || !changed || (forLoyalty && !name.trim())) return;
    if (await saveName(name.trim() || null)) setDraft(null);
  }
  async function confirmLogout() {
    if (locked || logoutChoice === null) return;
    if (await logout(logoutChoice)) setLogoutChoice(null);
  }
  return <div className="space-y-5">
    <section aria-label="Votre profil" className="sm-account-card">
      <div className="sm-account-card-heading flex items-start gap-3">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-card bg-accentwash text-accentink"><Icon name="user" size={21} /></span>
        <div className="min-w-0"><h3 className="font-display text-lg font-extrabold tracking-tight">Votre profil</h3>
          <p className="mt-1 text-xs leading-5 text-mut">{forLoyalty ? 'Le même profil pour votre compte et votre carte fidélité.' : 'Vos coordonnées personnelles, pour ce restaurant.'}</p></div>
      </div>
      <div className="mb-5 rounded-card border border-ink/10 bg-surface2 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-mut"><Icon name="check" size={14} />Téléphone vérifié</p>
        <p className="cf-fig mt-1 break-all text-base font-bold">{view.profile.phoneE164}</p>
        <p className="mt-1 text-xs leading-5 text-mut">Le changement de numéro n’est pas encore disponible.</p>
      </div>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
        <Field label="Votre prénom ou nom" htmlFor={inputId} hint={forLoyalty ? 'Un nom pour votre carte. Votre téléphone est déjà vérifié.' : 'Facultatif. Ce nom ne modifie pas vos commandes déjà passées.'}>
          <Input id={inputId} value={name} autoComplete="name" maxLength={120} disabled={locked}
            onChange={event => setDraft({ name: event.target.value, revision: draft?.revision ?? view.profile.revision })} />
        </Field>
        {invalid && <p role="alert" className="text-sm text-alertt">Utilisez un nom de 120 caractères maximum, sans caractère invisible.</p>}
        {stale && <div className="rounded-card border border-prep/30 bg-prep/10 p-3 text-sm leading-5 text-prept">
          <p>Le profil a été actualisé depuis votre saisie. Votre brouillon n’a pas été envoyé.</p>
          <Tap className="mt-2 min-h-11 text-left font-bold underline underline-offset-4" disabled={locked} onClick={() => setDraft(null)}>Utiliser le profil actualisé</Tap>
        </div>}
        <Tap type="submit" className={primary} disabled={locked || stale || invalid || !changed || (forLoyalty && !name.trim())}>
          <Icon name="check" size={16} />{forLoyalty ? 'Continuer vers ma carte' : 'Enregistrer mon profil'}
        </Tap>
      </form>
    </section>
    {!forLoyalty && <section aria-label="Votre session" className="sm-account-card space-y-3">
      <h3 className="text-sm font-bold">Votre session</h3>
      {logoutChoice === null ? <div className="grid gap-2 sm:grid-cols-2">
        <Tap className={secondary} disabled={locked} onClick={() => setLogoutChoice(false)}>Déconnecter cet appareil</Tap>
        <Tap className={secondary} disabled={locked} onClick={() => setLogoutChoice(true)}>Déconnecter tous les appareils</Tap>
      </div> : <div className="rounded-card border border-ink/15 bg-surface2 p-4">
        <p className="font-bold">{logoutChoice ? 'Déconnecter tous vos appareils ?' : 'Déconnecter cet appareil ?'}</p>
        <p className="mt-2 text-sm leading-6 text-mut">Votre session personnelle sera fermée. Votre carte fidélité et vos commandes ne seront pas supprimées.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Tap className={secondary} disabled={locked} onClick={() => setLogoutChoice(null)}>Annuler</Tap>
          <Tap className={secondary} disabled={locked} onClick={() => void confirmLogout()}><Icon name="logout" size={16} />Confirmer la déconnexion</Tap>
        </div>
      </div>}
    </section>}
  </div>;
}

function AccountSurface({ presentation, title, restaurantName, open, onClose, locked, footer, children, compact }: {
  presentation: 'sheet' | 'page'; title: string; restaurantName: string; open: boolean;
  onClose: () => void; locked: boolean; footer: ReactNode; children: ReactNode;
  compact?: boolean;
}) {
  const heading = useId();
  if (presentation === 'page') return <section className={`sm-account-page${compact ? ' sm-account-page-compact' : ''}`} aria-labelledby={heading}>
    <header className="sm-account-page-heading"><p>{restaurantName}</p><h2 id={heading}>{title}</h2></header>
    {children}
  </section>;
  return <Sheet open={open} onClose={onClose} title={title} navigationLocked={locked}
    headerExtra={<p className="mt-1 truncate text-xs text-mut">{restaurantName}</p>} footer={footer}>{children}</Sheet>;
}

export function CustomerAccountPanel({ open, onClose, restaurantName, loyaltyHref, onDeviceOrders, onDevicePreferences, onCatalogVerified, account, slug, mode = 'light', returnLabel = 'Revenir au menu', initialSection = 'profile', presentation = 'sheet', onOrders, onLoyalty, onNavigationLockedChange, loyaltyCard }: {
  open: boolean; onClose: () => void; restaurantName: string; loyaltyHref?: string | undefined;
  onDeviceOrders?: (() => void) | undefined; onDevicePreferences?: (() => void) | undefined; account: Account;
  slug?: string; mode?: BrandMode; onCatalogVerified?: (categories: MenuCategory[]) => void;
  returnLabel?: 'Revenir au menu' | 'Revenir à la fidélité' | undefined;
  initialSection?: 'profile' | 'loyalty';
  presentation?: 'sheet' | 'page';
  onOrders?: () => void; onLoyalty?: () => void; onNavigationLockedChange?: (locked: boolean) => void;
  loyaltyCard?: ReactNode;
}) {
  const { state, refresh, currentAccess } = account;
  const [enrollmentActive, setEnrollmentActive] = useState(false);
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [loyaltyBusy, setLoyaltyBusy] = useState(false);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [ordersAccess, setOrdersAccess] = useState<CustomerAccountAccess | null>(null);
  const [loyaltyAccess, setLoyaltyAccess] = useState<CustomerAccountAccess | null>(null);
  const [loyaltyRequested, setLoyaltyRequested] = useState(initialSection === 'loyalty');
  const ordersTrigger = useRef<HTMLButtonElement>(null);
  const loyaltyTrigger = useRef<HTMLButtonElement>(null);
  const profileRegion = useRef<HTMLDivElement>(null);
  const activity = useCallback((active: boolean) => setEnrollmentActive(active), []);
  const loading = state.status === 'loading';
  const needsRetry = ['idle', 'error', 'offline', 'unavailable'].includes(state.status);
  const view = open ? state.view : null;
  const readingOrders = !!view && !!slug && sameOrderAccess(ordersAccess, account.currentAccess?.() ?? null);
  // Public visibility is only a navigation hint. Every private read and write
  // still rechecks the current subscription, programme and protected session.
  const loyaltyEnabled = Boolean(slug && loyaltyHref);
  const loyaltyContext = initialSection === 'loyalty' && loyaltyEnabled;
  const readingLoyalty = !!view && loyaltyEnabled && sameOrderAccess(loyaltyAccess, account.currentAccess?.() ?? null);
  useEffect(() => {
    if (!open || !view || !loyaltyEnabled || !loyaltyRequested || state.busy) return;
    const access = currentAccess?.();
    if (access) {
      // Capture once when the external protected-session store publishes its
      // verified selection; never follow a later identity change implicitly.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoyaltyAccess(access); setLoyaltyRequested(false);
    }
  }, [open, view, loyaltyEnabled, loyaltyRequested, state.busy, currentAccess]);
  const authenticated = useCallback((source?: 'enrollment' | 'access') => {
    if (source === 'enrollment' && loyaltyHref) {
      if (onLoyalty) onLoyalty(); else setLoyaltyRequested(true);
    }
    void refresh();
  }, [refresh, loyaltyHref, onLoyalty]);
  const navigationBusy = state.busy || enrollmentBusy || loyaltyBusy || ordersBusy;
  useEffect(() => { onNavigationLockedChange?.(navigationBusy); return () => onNavigationLockedChange?.(false); }, [navigationBusy, onNavigationLockedChange]);
  const leaveOrders = () => { setOrdersAccess(null); requestAnimationFrame(() => ordersTrigger.current?.focus()); };
  const leaveLoyalty = () => { if (presentation === 'page' && initialSection === 'loyalty') { onClose(); return; }
    setLoyaltyAccess(null); requestAnimationFrame(() => loyaltyTrigger.current?.focus()); };
  const completeProfile = () => { setLoyaltyAccess(null); requestAnimationFrame(() => profileRegion.current?.querySelector('input')?.focus()); };
  const closePanel = () => { if (navigationBusy) return; setOrdersAccess(null); setLoyaltyAccess(null); setLoyaltyRequested(false); onClose(); };
  const title = state.status === 'offline' ? 'Vous êtes hors connexion'
    : state.status === 'unavailable' ? 'Compte indisponible pour le moment'
      : state.status === 'error' ? 'Vérification interrompue'
        : state.status === 'idle' ? 'Compte à actualiser' : loyaltyContext ? 'Votre carte sur vos appareils' : 'Votre compte';
  // Keep the exact authoritative action/quota message. Only its presentation
  // changes; availability is never used to infer a missing or invalid session.
  const message = state.message ?? (state.status === 'guest'
    ? state.accessAvailable ? 'Connectez-vous pour retrouver votre accès personnel.' : state.registrationAvailable ? 'Créez votre accès personnel pour retrouver votre carte et vos commandes.'
      : loyaltyContext && loyaltyCard ? 'La connexion au compte est indisponible pour le moment. Vous pouvez utiliser votre carte avec son QR.' : 'La connexion et la création de compte sont indisponibles pour le moment.'
    : state.status === 'offline' ? 'Reconnectez-vous au réseau pour consulter votre profil personnel.'
      : 'Actualisez votre compte pour consulter votre session. La commande en invité reste disponible.');
  return <AccountSurface presentation={presentation} compact={initialSection === 'loyalty'} open={open} onClose={closePanel}
    title={presentation === 'page' ? initialSection === 'loyalty' ? 'Ma fidélité' : 'Mon compte' : readingLoyalty || loyaltyRequested ? 'Mon compte et ma fidélité' : 'Mon compte'} restaurantName={restaurantName} locked={navigationBusy}
    footer={<Tap className={view || state.registrationAvailable || state.accessAvailable || enrollmentActive ? secondary + ' w-full' : primary} disabled={navigationBusy} onClick={closePanel}>
      {returnLabel}
    </Tap>}>
    <div className={presentation === 'page' ? 'sm-account-page-content space-y-5' : 'space-y-4 p-4 pb-5 sm:p-5'}>
      {readingLoyalty && loyaltyAccess && slug && view && <CustomerLoyalty slug={slug} access={loyaltyAccess} currentAccess={account.currentAccess}
        restaurantName={restaurantName} profileName={view.profile.name} onBack={leaveLoyalty} onProfile={completeProfile} showHeading={presentation !== 'page'} showBack={presentation !== 'page'} onBusyChange={setLoyaltyBusy}
        profileEditor={<Profile key={`${view.profile.phoneE164}:${view.profile.phoneVerifiedAt}`} account={account} view={view} forLoyalty />} />}
      {readingOrders && ordersAccess && slug && <CustomerOrders slug={slug} access={ordersAccess} onBack={leaveOrders} currentAccess={account.currentAccess} onClose={closePanel} onCatalogVerified={onCatalogVerified} onNavigationLockedChange={setOrdersBusy} />}
      {loyaltyContext && loyaltyCard && <details className="sm-account-card-access" open={!view ? true : undefined}>
        <summary hidden={!view} className="cf-press"><Icon name="qr" size={21} /><span>Afficher une carte avec son QR</span><Icon name="down" size={18} className="sm-account-card-chevron" /></summary>
        {loyaltyCard}
      </details>}
      {!readingLoyalty && !readingOrders && <>
      {view && state.message && <p role="status" aria-live="polite" className="rounded-card border border-ink/10 bg-surface2 p-3 text-sm leading-6 text-ink">{state.message}</p>}
      {view ? <><nav aria-label="Votre espace personnel" className="sm-account-destinations">{slug && <Tap ref={ordersTrigger} className="sm-account-destination" disabled={navigationBusy} onClick={() => { if (onOrders) { onOrders(); return; } const access = account.currentAccess?.(); if (access) setOrdersAccess(access); }}><span className="sm-account-destination-icon"><Icon name="ticket" size={21} /></span><span className="min-w-0 flex-1 text-left"><b>Mes commandes</b><small>Historique et suivi</small></span><Icon name="arrow" size={16} /></Tap>}
        {loyaltyEnabled && <Tap ref={loyaltyTrigger} className="sm-account-destination" disabled={navigationBusy} onClick={() => { if (onLoyalty) { onLoyalty(); return; } const access = account.currentAccess?.(); if (access) setLoyaltyAccess(access); }}><span className="sm-account-destination-icon"><Icon name="gift" size={21} /></span><span className="min-w-0 flex-1 text-left"><b>Ma carte fidélité</b><small>Carte, solde et avantages</small></span><Icon name="arrow" size={16} /></Tap>}</nav>
        <div ref={profileRegion}><Profile key={`${view.profile.phoneE164}:${view.profile.phoneVerifiedAt}`} account={account} view={view} /></div></>
        : enrollmentActive ? null : loading ? <div role="status" className="min-h-40 rounded-panel border border-ink/10 bg-surface2 p-5">
          <p className="text-sm font-semibold">Vérification de votre session…</p>
          {state.message && <p className="mt-3 text-sm leading-6 text-mut">{state.message}</p>}
          <div aria-hidden className="mt-5 space-y-3"><div className="h-4 w-1/2 rounded bg-ink/10" /><div className="h-11 rounded-ctrl bg-ink/5" /><div className="h-4 w-3/4 rounded bg-ink/10" /></div>
        </div> : state.status === 'guest' && (state.registrationAvailable || state.accessAvailable)
          ? <p role="status" className="text-sm leading-6 text-mut">{loyaltyContext ? 'Votre compte permet de retrouver votre carte sur vos appareils. Une carte déjà en votre possession peut être rattachée après connexion.' : 'Retrouvez vos commandes et votre profil dans votre compte. Vous pouvez aussi commander sans vous connecter.'}</p>
          : <section role="status" aria-live="polite" aria-atomic="true" className="sm-account-card sm-account-intro">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-card bg-accentwash text-accentink"><Icon name="user" size={21} /></span>
            <h3 className="self-center font-display text-lg font-extrabold leading-tight tracking-tight">{title}</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-mut">{message}</p>
        </section>}
      {!enrollmentActive && !loading && state.status !== 'offline' && (Boolean(view) || needsRetry) && <Tap className={secondary + ' w-full'} disabled={navigationBusy} onClick={() => void refresh()}>{needsRetry ? 'Réessayer' : 'Actualiser mon compte'}</Tap>}
      {/* A mutation clears the private view before releasing its Web Lock and
          notifying other forms. Do not mount a new credential flow in that gap. */}
      {open && !view && !state.busy && slug && <CustomerEnrollment slug={slug} mode={mode} registrationAvailable={state.registrationAvailable === true}
        smsAvailable={state.available} accessAvailable={state.accessAvailable === true} onAuthenticated={authenticated} onActivity={activity} onBusyChange={setEnrollmentBusy} />}
      {!view && !loading && loyaltyEnabled && !loyaltyContext && <p className="text-xs leading-5 text-mut">Votre carte fidélité reste utilisable avec son QR. Vous pourrez la rattacher à ce compte après connexion.</p>}
      {(onDeviceOrders || (loyaltyHref && !view && presentation === 'sheet') || onDevicePreferences) && <nav aria-label="Vos accès au restaurant" className="space-y-2 border-t border-ink/10 pt-4">
        <h3 className="mb-3 text-sm font-bold">Autres accès</h3>
        {onDeviceOrders && <Tap disabled={navigationBusy} onClick={() => { onClose(); onDeviceOrders(); }}
          aria-label="Mes commandes sur cet appareil" className={secondary + ' w-full justify-start text-left'}>
          <Icon name="ticket" size={18} /><span className="min-w-0 flex-1"><span className="block font-bold">Mes commandes</span><span className="block text-xs font-normal text-mut">Sur cet appareil uniquement</span></span><Icon name="arrow" size={15} />
        </Tap>}
        {onDevicePreferences && <Tap disabled={navigationBusy} onClick={() => { closePanel(); onDevicePreferences(); }}
          className={secondary + ' w-full justify-start text-left'}><Icon name="gear" size={18} /><span className="flex-1">Préférences de cet appareil</span><Icon name="arrow" size={15} /></Tap>}
        {loyaltyHref && !view && presentation === 'sheet' && (navigationBusy ? <span aria-disabled="true" className={secondary + ' w-full justify-start opacity-40'}><Icon name="gift" size={18} />Fidélité du restaurant</span>
          : <Link href={loyaltyHref} prefetch={false} onClick={onClose} className={secondary + ' w-full justify-start'}><Icon name="gift" size={18} /><span className="flex-1">Fidélité du restaurant</span><Icon name="arrow" size={15} /></Link>)}
      </nav>}
      </>}
    </div>
  </AccountSurface>;
}
