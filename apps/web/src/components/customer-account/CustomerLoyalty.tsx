"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CUSTOMER_LOYALTY_NOTICE, type CustomerLoyaltyProgram } from '@sm/contracts';
import { Icon } from '../ui/icons';
import { Tap } from '../order/primitives';
import { customerAccountRequest, type CustomerAccountAccess } from './client';
import { createCustomerLoyaltyClient } from './loyalty';

const secondary = 'cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold hover:border-ink/30 disabled:cursor-wait disabled:opacity-40';
const primary = 'cf-press flex min-h-12 w-full items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent disabled:cursor-not-allowed disabled:opacity-40';
function runtime(slug: string, access: CustomerAccountAccess, currentAccess: () => CustomerAccountAccess | null) {
  let alive = false;
  const client = createCustomerLoyaltyClient({ access, currentAccess, request: customerAccountRequest(slug),
    active: () => alive && document.visibilityState === 'visible' && navigator.onLine !== false,
    lock: typeof navigator !== 'undefined' && navigator.locks
      ? async job => { await navigator.locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, job); } : undefined });
  return { client, start: () => { alive = true; }, stop: () => { alive = false; client.invalidate(); } };
}
function EnrollmentOffer({ program, name, profileReady, changed, onProfile, onJoin }: {
  program: CustomerLoyaltyProgram; name: string | null; profileReady: boolean; changed: boolean;
  onProfile: () => void; onJoin: (accepted: boolean) => void;
}) {
  const id = useId(), termsId = useId();
  const [accepted, setAccepted] = useState(false);
  return <div className="space-y-4">
    {changed && <p role="alert" className="rounded-card border border-prep/30 bg-prep/10 p-3 text-sm leading-6 text-prept">Les conditions ont changé. Relisez-les et confirmez à nouveau votre choix.</p>}
    <div className="rounded-panel border border-accent/20 bg-[image:var(--cf-card-gradient)] p-4 sm:p-5">
      <span className="inline-flex min-h-6 items-center rounded-pill bg-accentwash px-2.5 text-xs font-bold text-accentink">Carte gratuite · adhésion facultative</span>
      <h4 className="mt-4 font-display text-xl font-extrabold leading-tight tracking-tight">{program.name}</h4>
      <p className="mt-2 text-sm leading-6 text-mut">Retrouvez votre carte et votre solde depuis ce compte, pour ce restaurant.</p>
      {profileReady && name && <p className="mt-4 break-words border-t border-ink/10 pt-3 text-sm"><span className="text-mut">Au nom de </span><span className="font-bold">{name}</span></p>}
    </div>
    <section aria-label="Conditions du programme" className="rounded-card border border-ink/10 bg-surface2 p-4">
      <h4 className="text-sm font-bold">Conditions du programme</h4>
      <p id={termsId} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-mut">{program.termsSummary || 'Aucune condition complémentaire publiée.'}</p>
    </section>
    {!profileReady ? <div className="space-y-3 rounded-card border border-ink/15 p-4">
      <p className="text-sm leading-6 text-mut">Ajoutez votre prénom ou nom à votre profil avant de demander votre carte. Votre téléphone vérifié sera utilisé, sans nouvelle saisie.</p>
      <Tap className={secondary + ' w-full'} onClick={onProfile}>Compléter mon profil <Icon name="arrow" size={14} /></Tap>
    </div> : <form onSubmit={event => { event.preventDefault(); onJoin(accepted); }} className="space-y-4">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-ink/15 p-4">
        <input id={id} type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} aria-describedby={termsId}
          className="mt-1 size-5 shrink-0 accent-[var(--cf-accent)]" />
        <span className="text-sm leading-6">{CUSTOMER_LOYALTY_NOTICE}</span>
      </label>
      <Tap type="submit" className={primary} disabled={!accepted}><Icon name="gift" size={18} />Créer ma carte gratuite</Tap>
    </form>}
  </div>;
}
function CardQr({ token }: { token: string }) {
  const [image, setImage] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void import('qrcode').then(qr => qr.toDataURL(token, { width: 320, margin: 4, errorCorrectionLevel: 'M' }))
      .then(value => { if (alive) setImage(value); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [token]);
  return image ? <div className="sm-qr-frame mx-auto aspect-square w-full max-w-80 rounded-wide p-2">
    {/* eslint-disable-next-line @next/next/no-img-element -- locally generated, volatile private QR; never sent to an image optimizer. */}
    <img src={image} alt="QR de votre carte fidélité" width={320} height={320} className="size-full" />
  </div> : <p role="status" className="rounded-card bg-surface2 p-5 text-center text-sm leading-6 text-mut">{failed ? 'Le QR ne peut pas être affiché. Masquez la carte puis réessayez.' : 'Préparation de votre carte…'}</p>;
}

/** No private SSR props or persistent card storage. Removing the authoritative
 * account view unmounts this screen and every private projection it contains. */
export function CustomerLoyalty({ slug, access, currentAccess, restaurantName, profileName, onBack, onProfile }: {
  slug: string; access: CustomerAccountAccess; currentAccess: () => CustomerAccountAccess | null;
  restaurantName: string; profileName: string | null; onBack: () => void; onProfile: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const store = useMemo(() => runtime(slug, access, currentAccess), [slug, access, currentAccess]);
  const { client } = store;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  useEffect(() => {
    store.start(); void client.load(); heading.current?.focus();
    const pause = () => client.invalidate(), hidden = () => { if (document.visibilityState !== 'visible') pause(); };
    window.addEventListener('offline', pause); window.addEventListener('pagehide', pause); document.addEventListener('visibilitychange', hidden);
    return () => { store.stop(); window.removeEventListener('offline', pause); window.removeEventListener('pagehide', pause); document.removeEventListener('visibilitychange', hidden); };
  }, [client, store]);
  useEffect(() => {
    const expiry = state.response?.expiresAt ?? access.expiresAt;
    const timer = setTimeout(() => client.invalidate(), Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [client, state.response?.expiresAt, access.expiresAt]);
  const response = state.response, busy = state.status === 'loading';
  return <section aria-label="Fidélité de votre compte" className="space-y-4">
    <Tap className={secondary + ' w-full justify-start'} onClick={onBack}><Icon name="arrow" size={14} className="rotate-180" />Revenir à mon compte</Tap>
    <header><p className="text-xs font-bold uppercase tracking-[0.12em] text-mut">{restaurantName}</p>
      <h3 ref={heading} tabIndex={-1} className="mt-1 font-display text-2xl font-extrabold tracking-tight outline-none">Ma fidélité</h3>
      <p className="mt-2 text-sm leading-6 text-mut">Votre carte et vos avantages, réunis dans votre compte.</p></header>
    {state.message && <p role="alert" className="rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{state.message}</p>}
    {busy && <p role="status" className="rounded-card border border-ink/10 bg-surface2 p-4 text-sm leading-6 text-mut">{state.pendingJoin ? 'Vérification de votre demande de carte…' : 'Lecture de votre fidélité…'}</p>}
    {response && (response.state === 'available' || response.state === 'terms_changed') && <EnrollmentOffer
      key={`${response.program.id}:${response.program.version}:${response.state}`} program={response.program} name={profileName}
      profileReady={response.profileReady} changed={response.state === 'terms_changed'} onProfile={onProfile} onJoin={accepted => void client.join(accepted)} />}
    {response && (response.state === 'member' || response.state === 'card') && <div className="space-y-4">
      <div className="rounded-panel border border-accent/20 bg-[image:var(--cf-card-gradient)] p-5 text-center">
        <span aria-hidden className="mx-auto grid size-11 place-items-center rounded-card bg-accentwash text-accentink"><Icon name="gift" size={22} /></span>
        <h4 className="mt-3 font-display text-lg font-extrabold">Votre carte est liée à ce compte</h4>
        <p className="cf-fig mt-3 text-2xl font-extrabold tabular-nums">{response.member.balanceUnits} {response.member.balanceUnits === 1 ? response.member.unitLabelSingular : response.member.unitLabelPlural}</p>
        <p className="mt-2 text-xs leading-5 text-mut">Solde confirmé lors de cette lecture.</p>
      </div>
      {response.state === 'card' ? <><CardQr key={response.qrToken} token={response.qrToken} /><p className="text-center text-xs leading-5 text-mut">Présentez ce QR au restaurant. Il ne permet pas de se connecter à votre compte.</p>
        <Tap className={secondary + ' w-full'} onClick={client.hideCard}>Masquer ma carte</Tap></>
        : <Tap className={primary} onClick={() => void client.card()}><Icon name="gift" size={18} />Afficher ma carte</Tap>}
    </div>}
    {response?.state === 'name_required' && <div className="space-y-3"><p role="status" className="text-sm leading-6 text-mut">Votre profil doit comporter un prénom ou nom pour créer une carte.</p><Tap className={secondary + ' w-full'} onClick={onProfile}>Compléter mon profil</Tap></div>}
    {response?.state === 'existing_card' && <p role="status" className="rounded-card border border-ink/15 bg-surface2 p-4 text-sm leading-6 text-mut">La création d’une nouvelle carte n’est pas possible depuis ce compte. Présentez votre carte existante au restaurant ou demandez son aide. Aucun rattachement automatique n’a été effectué.</p>}
    {response?.state === 'unavailable' && <p role="status" className="rounded-card border border-ink/15 bg-surface2 p-4 text-sm leading-6 text-mut">La fidélité n’est pas disponible pour le moment. Votre compte reste accessible indépendamment.</p>}
    {response?.state === 'conflict' && <p role="status" className="rounded-card border border-prep/30 bg-prep/5 p-4 text-sm leading-6 text-prept">Votre carte ne peut pas être vérifiée dans son état actuel. Actualisez ou demandez l’aide du restaurant.</p>}
    {!busy && <Tap className={secondary + ' w-full'} onClick={() => void client.retry()}>{state.pendingJoin ? 'Reprendre ma demande' : state.status === 'error' || state.status === 'idle' ? 'Réessayer la lecture' : 'Actualiser ma fidélité'}</Tap>}
    <p className="text-xs leading-5 text-mut">Aucun gain ni récompense n’est appliqué depuis cet écran. La carte et le solde ne sont pas conservés hors connexion.</p>
  </section>;
}
