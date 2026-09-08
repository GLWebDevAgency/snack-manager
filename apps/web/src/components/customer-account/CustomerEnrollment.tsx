"use client";

import { useEffect, useId, useRef, useState } from 'react';
import type { BrandMode } from '@sm/contracts';
import { Field, Input } from '../ui/fields';
import { Icon } from '../ui/icons';
import { Tap } from '../order/primitives';
import { TurnstileCheck } from '../order/TurnstileCheck';
import { useCustomerEnrollment } from './useCustomerEnrollment';

const primary = 'cf-press flex min-h-12 w-full items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'cf-press min-h-11 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
function mobilePhone(raw: string) {
  const compact = raw.replace(/[\s.()-]/g, '');
  const phone = /^0[67]\d{8}$/.test(compact) ? `+33${compact.slice(1)}` : compact;
  return /^\+33[67]\d{8}$/.test(phone) ? phone : null;
}

export function CustomerEnrollment({ slug, mode, registrationAvailable, smsAvailable, onAuthenticated, onActivity }: {
  slug: string; mode: BrandMode; registrationAvailable: boolean; smsAvailable: boolean; onAuthenticated: () => void;
  onActivity: (active: boolean) => void;
}) {
  const { state, flow } = useCustomerEnrollment(slug);
  const inputId = useId(), heading = useRef<HTMLHeadingElement>(null);
  const [phone, setPhone] = useState(''), [otp, setOtp] = useState(''), [human, setHuman] = useState<string | null>(null);
  const [answer, setAnswer] = useState(''), [saved, setSaved] = useState(false), [closeChoice, setCloseChoice] = useState(false);
  const [humanReset, setHumanReset] = useState(0), [copyMessage, setCopyMessage] = useState<string | null>(null);
  const verification = state.record?.verification, protection = verification?.protection;
  const phase = verification?.phase, stage = protection?.stage;
  const terminal = phase && ['closed', 'expired', 'failed'].includes(phase);
  const started = verification && !terminal && phase !== 'completed';
  useEffect(() => { onActivity(Boolean(started) || state.busy); }, [onActivity, started, state.busy]);
  useEffect(() => () => onActivity(false), [onActivity]);
  const title = phase === 'prepared' ? 'Votre numéro de téléphone' : phase === 'code' || phase === 'incorrect' ? 'Le code reçu par SMS'
    : phase === 'protecting' ? stage === 'registration_required' ? 'Créer votre clé d’accès'
      : stage === 'assertion_required' ? 'Vérifier votre clé d’accès' : 'Votre code de secours'
      : phase === 'completed' ? 'Votre compte est prêt' : started ? 'Reprendre votre inscription' : 'Créer un compte protégé';
  useEffect(() => {
    // Pause/hidden/offline must clear every editable secret, including a code
    // typed while a response was still waiting. Never reconstruct it on focus.
    queueMicrotask(() => { setPhone(''); setOtp(''); setHuman(null); setAnswer(''); setSaved(false); setCopyMessage(null); });
  }, [state.clearInputs]);
  useEffect(() => { if (state.outcome === 'authenticated' || state.outcome === 'approved') onAuthenticated(); }, [state.outcome, onAuthenticated]);
  useEffect(() => { if (state.outcome) heading.current?.focus({ preventScroll: true }); }, [phase, stage, state.outcome]);
  // A completed selector is not itself a signed-in session. Let the existing
  // account client own its offline/expired/logout state, without duplicating it.
  if (state.loading || phase === 'completed' || (!registrationAvailable && !verification)) return null;

  async function sendSms() {
    const valid = mobilePhone(phone);
    if (!valid || !human || !registrationAvailable || !smsAvailable || state.busy) return;
    const proof = human; setHuman(null); setPhone(''); setHumanReset(value => value + 1);
    await flow?.start(valid, proof);
  }
  async function check() { const code = otp; setOtp(''); await flow?.check(code); }
  async function activate() { const code = answer; setAnswer(''); setSaved(false); await flow?.activate(code); }
  async function copy() {
    if (!state.code) return;
    try { await navigator.clipboard.writeText(state.code); setCopyMessage('Code copié. Conservez-le dans un endroit sûr.'); }
    catch { setCopyMessage('La copie n’est pas disponible. Vous pouvez recopier le code.'); }
  }
  const suspended = state.outcome === 'paused' || (typeof navigator !== 'undefined' && !navigator.onLine);
  const supported = typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.credentials && navigator.locks)
    && typeof PublicKeyCredential !== 'undefined' && typeof indexedDB !== 'undefined';
  const locked = state.busy || suspended || state.storageError;
  return <section aria-label="Inscription protégée" aria-busy={state.busy} className="space-y-4 rounded-panel border border-ink/10 bg-surface2 p-4 sm:p-5">
    <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-accentink">Votre accès personnel</p>
      <h3 ref={heading} tabIndex={-1} className="font-display text-xl font-extrabold leading-tight outline-none">{title}</h3></div>
    {state.message && <p role="status" className="rounded-card border border-prep/25 bg-prep/10 p-3 text-sm leading-6 text-prept">{state.message}</p>}
    {!started && <>
      <p className="text-sm leading-6 text-mut">Vérifiez votre téléphone, puis protégez votre compte avec une clé d’accès et un code de secours. Votre compte ne sera activé qu’à la fin.</p>
      <p className="text-xs leading-5 text-mut">La clé est liée à ce site du restaurant. Un autre domaine ne partage pas automatiquement cet accès.</p>
      {!supported && <p role="status" className="text-sm leading-6 text-mut">Ce navigateur ne permet pas de protéger cet accès. Utilisez un navigateur récent. Aucun SMS n’a été envoyé.</p>}
      {registrationAvailable ? <Tap className={primary} disabled={locked || !supported} onClick={() => void flow?.begin()}>Commencer mon inscription</Tap>
        : <p className="text-sm text-mut">Les nouvelles inscriptions sont fermées pour le moment.</p>}
      {!state.record && !state.storageError && <div className="border-t border-ink/10 pt-3">
        <Tap className="min-h-11 text-left text-sm font-semibold underline underline-offset-4" disabled={locked || !supported} onClick={() => void flow?.restore()}>Reprendre sur cet appareil</Tap>
        <p className="text-xs leading-5 text-mut">Si vous avez déjà commencé ici. Cela ne reconnecte pas votre compte personnel sans votre clé.</p>
      </div>}
    </>}
    {phase === 'prepared' && verification && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void sendSms(); }}>
      <Field label="Numéro de mobile" htmlFor={`${inputId}-phone`} hint="Mobile français. Aucun SMS ne part sans votre confirmation.">
        <Input id={`${inputId}-phone`} type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={phone} disabled={locked}
          onChange={event => setPhone(event.target.value)} placeholder="06 12 34 56 78" />
      </Field>
      {registrationAvailable && smsAvailable && SITE_KEY && <TurnstileCheck siteKey={SITE_KEY} tenantSlug={slug} customerOperationId={verification.operationId}
        mode={mode} resetKey={humanReset} onToken={setHuman} />}
      {!state.busy && (!registrationAvailable || !smsAvailable || !SITE_KEY) && <p role="status" className="text-sm leading-6 text-mut">L’envoi de SMS n’est pas disponible. Vous pouvez laisser cette démarche en pause et commander en invité.</p>}
      <Tap type="submit" className={primary} disabled={locked || !mobilePhone(phone) || !human || !registrationAvailable || !smsAvailable}>Envoyer mon code SMS</Tap>
    </form>}
    {(phase === 'code' || phase === 'incorrect') && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void check(); }}>
      <p className="text-sm leading-6 text-mut">Saisissez les six chiffres reçus. Cette vérification ne crée pas encore votre compte.</p>
      <Field label="Code SMS à six chiffres" htmlFor={`${inputId}-otp`}>
        <Input id={`${inputId}-otp`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          value={otp} disabled={locked} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} className="cf-fig tracking-[.2em]" />
      </Field>
      <Tap type="submit" className={primary} disabled={locked || !/^\d{6}$/.test(otp)}>Vérifier mon téléphone</Tap>
    </form>}
    {phase === 'protecting' && stage === 'registration_required' && <>
      <p className="text-sm leading-6 text-mut">Votre téléphone est vérifié. Créez maintenant une clé avec votre appareil ou votre gestionnaire de mots de passe.</p>
      <Tap className={primary} disabled={locked} onClick={() => void flow?.register()}><Icon name="lock" size={17} />Créer ma clé d’accès</Tap>
    </>}
    {phase === 'protecting' && stage === 'assertion_required' && <>
      <p className="text-sm leading-6 text-mut">La clé a été enregistrée. Utilisez-la une première fois pour vérifier que vous pourrez vous reconnecter.</p>
      <Tap className={primary} disabled={locked} onClick={() => void flow?.assert()}>Utiliser ma clé d’accès</Tap>
    </>}
    {phase === 'protecting' && stage === 'recovery_required' && <>
      <p className="text-sm leading-6 text-mut">Le secours permet de retrouver votre accès si vous perdez votre clé. Il est personnel et à usage unique.</p>
      {state.code ? <div className="space-y-3 rounded-card border border-accent/25 bg-surface p-3">
        <p className="text-xs font-bold text-accentink">À conserver maintenant</p>
        <code aria-label="Code de secours personnel" className="cf-fig block break-all text-base font-bold leading-7">{state.code}</code>
        <p className="text-xs leading-5 text-mut">Ce code n’est pas enregistré dans le navigateur. Il disparaît si vous fermez ce panneau ou quittez cet onglet.</p>
        <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => void copy()}>Copier le code</Tap>
        {copyMessage && <p role="status" className="text-xs leading-5 text-mut">{copyMessage}</p>}
        <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => { flow?.hideCode(); setSaved(true); }}>Je l’ai conservé, masquer le code</Tap>
      </div> : <>
        {(protection?.recoveryVersion ?? 0) < 3 && !protection?.pending && !saved && <Tap className={secondary + ' w-full'} disabled={locked}
          onClick={() => void flow?.recoveryCode()}>{protection?.recoveryVersion ? 'Créer un nouveau code de secours' : 'Afficher mon code de secours'}</Tap>}
        {(protection?.recoveryVersion ?? 0) > 0 && <>
          {!saved && <p className="text-xs leading-5 text-mut">Si vous avez conservé le dernier code, vous pouvez le saisir ci-dessous. En créer un autre invalide le précédent (trois codes maximum).</p>}
          <form className="space-y-3" onSubmit={event => { event.preventDefault(); void activate(); }}>
            <Field label="Ressaisissez votre code de secours" htmlFor={`${inputId}-recovery`} hint="Cette confirmation active votre compte après vérification côté serveur.">
              <Input id={`${inputId}-recovery`} autoComplete="off" spellCheck={false} maxLength={128} value={answer} disabled={locked}
                onChange={event => setAnswer(event.target.value)} className="cf-fig" />
            </Field>
            <Tap type="submit" className={primary} disabled={locked || !answer.trim()}>Activer mon compte protégé</Tap>
          </form>
        </>}
      </>}
    </>}
    {(started || (state.record && state.record.phase !== 'ready')) && <Tap className={secondary + ' w-full'} disabled={state.busy} onClick={() => void flow?.resume()}>Vérifier l’étape en cours</Tap>}
    {state.outcome === 'expired' && state.record?.phase !== 'ready' && <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => void flow?.restartBrowser()}>Repréparer ce navigateur</Tap>}
    {started && <div className="border-t border-ink/10 pt-3">
      {closeChoice ? <><p className="text-sm leading-6 text-mut">Fermer définitivement cette tentative ? Les réponses encore en route ne pourront plus activer ce compte.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Tap className={secondary} disabled={state.busy} onClick={() => setCloseChoice(false)}>Garder en pause</Tap>
          <Tap className={secondary} disabled={locked} onClick={() => { setCloseChoice(false); void flow?.close(); }}>Fermer cette tentative</Tap></div></>
        : <Tap className="min-h-11 text-left text-xs font-semibold text-mut underline underline-offset-4" disabled={state.busy} onClick={() => setCloseChoice(true)}>Abandonner cette inscription</Tap>}
      <p className="mt-2 text-xs leading-5 text-mut">Revenir au menu met seulement la démarche en pause. La commande en invité reste toujours possible.</p>
    </div>}
  </section>;
}
