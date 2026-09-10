"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { CUSTOMER_LOYALTY_NOTICE, CUSTOMER_LOYALTY_ATTACHMENT_NOTICE, loyaltyTokenFromQrPayload, type CustomerLoyaltyProgram } from '@sm/contracts';
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
function EnrollmentOffer({ program, name, profileReady, changed, onProfile, onJoin, onAttach }: {
  program: CustomerLoyaltyProgram; name: string | null; profileReady: boolean; changed: boolean;
  onProfile: () => void; onJoin: (accepted: boolean) => void; onAttach: () => void;
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
      <p className="text-sm leading-6 text-mut">Ajoutez votre prénom ou nom à votre profil pour créer une nouvelle carte. Si vous avez déjà une carte, vous pouvez la rattacher sans compléter ce champ.</p>
      <Tap className={secondary + ' w-full'} onClick={onProfile}>Compléter mon profil <Icon name="arrow" size={14} /></Tap>
    </div> : <form onSubmit={event => { event.preventDefault(); onJoin(accepted); }} className="space-y-4">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-ink/15 p-4">
        <input id={id} type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} aria-describedby={termsId}
          className="mt-1 size-5 shrink-0 accent-[var(--cf-accent)]" />
        <span className="text-sm leading-6">{CUSTOMER_LOYALTY_NOTICE}</span>
      </label>
      <Tap type="submit" className={primary} disabled={!accepted}><Icon name="gift" size={18} />Créer ma carte gratuite</Tap>
    </form>}
    <Tap className={secondary + ' w-full'} onClick={onAttach}>J’ai déjà une carte <Icon name="arrow" size={14} /></Tap>
  </div>;
}
function attachmentToken(value: string, slug: string): string | null {
  // Parse only: a pasted URL never becomes a navigation or network request.
  const token = loyaltyTokenFromQrPayload(value, slug);
  return token && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token) ? token : null;
}
function AttachmentScanner({ slug, onRead, onClose }: { slug: string; onRead: (token: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false, seen = false; let controls: IScannerControls | undefined, stream: MediaStream | undefined;
    const preview = video.current;
    const release = () => { stream?.getTracks().forEach(track => track.stop()); if (preview) { preview.pause(); preview.srcObject = null; } };
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (stopped || !preview) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
        // Permission can resolve after cancel/unmount. Never attach that stream
        // to a detached video or start a decoder for a disposed screen.
        if (stopped || !preview.isConnected) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        preview.srcObject = stream;
        // Own the native play promise so deliberate disposal is handled here,
        // before ZXing starts decoding. Preserve its usual five-second bound.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([preview.play(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Camera playback unavailable')), 5000); })]); }
        finally { if (timer) clearTimeout(timer); }
        if (stopped || !preview.isConnected) { release(); return; }
        controls = reader.scan(preview, result => {
          if (!result || stopped || seen) return;
          const token = attachmentToken(result.getText(), slug);
          if (!token) { setError('Ce QR n’est pas un code de carte valide pour ce restaurant. Vous pouvez saisir votre code ci-dessous.'); return; }
          seen = true; controls?.stop(); onRead(token);
        }, release);
        if (stopped || seen) controls.stop();
      } catch { release(); if (!stopped) setError('La caméra n’est pas disponible. Saisissez ou collez le code de votre carte ci-dessous.'); }
    })();
    return () => { stopped = true; controls?.stop(); release(); };
  }, [slug, onRead]);
  return <div className="space-y-3 rounded-card border border-ink/15 bg-surface2 p-3">
    <video ref={video} muted playsInline className="aspect-square max-h-64 w-full rounded-card object-cover" aria-label="Caméra de lecture de votre carte" />
    {error && <p role="alert" className="text-sm leading-6 text-prept">{error}</p>}
    <Tap className={secondary + ' w-full'} onClick={onClose}>Annuler le scan</Tap>
  </div>;
}
function AttachmentOffer({ slug, program, changed, onAttach, onCancel }: {
  slug: string; program: CustomerLoyaltyProgram; changed: boolean; onAttach: (token: string, accepted: boolean) => void; onCancel: () => void;
}) {
  const id = useId(), termsId = useId(), codeId = useId();
  const [code, setCode] = useState(''), [accepted, setAccepted] = useState(false), [scanning, setScanning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), input = useRef<HTMLInputElement>(null), scan = useRef<HTMLButtonElement>(null);
  const restoreScanFocus = useRef(false);
  const token = attachmentToken(code, slug);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { if (!scanning && restoreScanFocus.current) { restoreScanFocus.current = false; scan.current?.focus(); } }, [scanning]);
  const read = useCallback((value: string) => { setCode(value); setAccepted(false); setScanning(false); input.current?.focus(); }, []);
  return <div className="space-y-4">
    <div className="rounded-panel border border-accent/20 bg-[image:var(--cf-card-gradient)] p-4 sm:p-5">
      <p className="text-xs font-bold text-accentink">Votre carte existante</p>
      <h4 ref={heading} tabIndex={-1} className="mt-2 font-display text-xl font-extrabold tracking-tight outline-none">Rattacher ma carte</h4>
      <p className="mt-2 text-sm leading-6 text-mut">Scannez ou collez le code de votre carte pour la retrouver dans ce compte. Rien n’est envoyé avant votre confirmation.</p>
    </div>
    {changed && <p role="alert" className="rounded-card border border-prep/30 bg-prep/10 p-3 text-sm leading-6 text-prept">Les conditions ont changé. Relisez-les, saisissez à nouveau votre carte et confirmez votre choix.</p>}
    <Tap ref={scan} className={secondary + ' w-full'} onClick={() => setScanning(true)} disabled={scanning}>Scanner ma carte</Tap>
    {scanning && <AttachmentScanner slug={slug} onRead={read} onClose={() => { restoreScanFocus.current = true; setScanning(false); }} />}
    <form onSubmit={event => { event.preventDefault(); if (!token || !accepted) return; setCode(''); setAccepted(false); setScanning(false); onAttach(token, true); }} className="space-y-4">
      <div><label htmlFor={codeId} className="text-sm font-bold">Code de votre carte</label>
        <input ref={input} id={codeId} type="password" autoComplete="off" spellCheck={false} maxLength={2048} value={code}
          onChange={event => { setCode(event.target.value); setAccepted(false); }} aria-describedby={`${codeId}-help`}
          className="mt-2 min-h-12 w-full rounded-ctrl border border-ink/20 bg-surface px-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
        <p id={`${codeId}-help`} className="mt-2 text-xs leading-5 text-mut">Collez le code ou le lien de votre carte pour ce restaurant. Il restera uniquement sur cet écran.</p>
        {code && !token && <p role="status" className="mt-2 text-sm leading-6 text-prept">Ce code ne peut pas être utilisé. Vérifiez votre carte ou demandez l’aide du restaurant.</p>}
      </div>
      <section aria-label="Conditions du programme" className="rounded-card border border-ink/10 bg-surface2 p-4">
        <h4 className="text-sm font-bold">{program.name}</h4>
        <p id={termsId} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-mut">{program.termsSummary || 'Aucune condition complémentaire publiée.'}</p>
      </section>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-ink/15 p-4">
        <input id={id} type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} aria-describedby={termsId} className="mt-1 size-5 shrink-0 accent-[var(--cf-accent)]" />
        <span className="text-sm leading-6">{CUSTOMER_LOYALTY_ATTACHMENT_NOTICE}</span>
      </label>
      <Tap type="submit" className={primary} disabled={!token || !accepted}>Rattacher cette carte <Icon name="arrow" size={16} /></Tap>
    </form>
    <Tap className={secondary + ' w-full'} onClick={onCancel}>Annuler le rattachement</Tap>
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
  const [attachment, setAttachment] = useState(false);
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
    {busy && <p role="status" className="rounded-card border border-ink/10 bg-surface2 p-4 text-sm leading-6 text-mut">{state.pendingAttachment ? 'Vérification de votre rattachement…' : state.pendingJoin ? 'Vérification de votre demande de carte…' : 'Lecture de votre fidélité…'}</p>}
    {response && (response.state === 'available' || response.state === 'terms_changed') && (attachment ? <AttachmentOffer
      key={`${response.program.id}:${response.program.version}:${response.state}`} slug={slug} program={response.program} changed={response.state === 'terms_changed'}
      onAttach={(token, accepted) => void client.attach(token, accepted)} onCancel={() => { setAttachment(false); heading.current?.focus(); }} /> : <EnrollmentOffer
      key={`${response.program.id}:${response.program.version}:${response.state}`} program={response.program} name={profileName}
      profileReady={response.profileReady} changed={response.state === 'terms_changed'} onProfile={onProfile} onJoin={accepted => void client.join(accepted)} onAttach={() => setAttachment(true)} />)}
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
    {(response?.state === 'existing_card' || response?.state === 'attachment_refused') && <div className="space-y-3"><p role="status" className="rounded-card border border-ink/15 bg-surface2 p-4 text-sm leading-6 text-mut">{response.state === 'existing_card' ? 'La création d’une nouvelle carte n’est pas possible depuis ce compte. Présentez votre carte existante au restaurant ou demandez son aide. Aucun rattachement automatique n’a été effectué.' : 'Cette carte ne peut pas être rattachée à ce compte. Vérifiez votre carte ou demandez l’aide du restaurant. Aucun rattachement n’a été effectué.'}</p>
      <Tap className={secondary + ' w-full'} onClick={() => { setAttachment(true); void client.load(); }}>Relire les conditions pour rattacher ma carte</Tap></div>}
    {response?.state === 'unavailable' && <p role="status" className="rounded-card border border-ink/15 bg-surface2 p-4 text-sm leading-6 text-mut">La fidélité n’est pas disponible pour le moment. Votre compte reste accessible indépendamment.</p>}
    {response?.state === 'conflict' && <p role="status" className="rounded-card border border-prep/30 bg-prep/5 p-4 text-sm leading-6 text-prept">Votre carte ne peut pas être vérifiée dans son état actuel. Actualisez ou demandez l’aide du restaurant.</p>}
    {!busy && <Tap className={secondary + ' w-full'} onClick={() => void client.retry()}>{state.pendingAttachment ? 'Reprendre mon rattachement' : state.pendingJoin ? 'Reprendre ma demande' : state.status === 'error' || state.status === 'idle' ? 'Réessayer la lecture' : 'Actualiser ma fidélité'}</Tap>}
    <p className="text-xs leading-5 text-mut">Aucun gain ni récompense n’est appliqué depuis cet écran. La carte et le solde ne sont pas conservés hors connexion.</p>
  </section>;
}
