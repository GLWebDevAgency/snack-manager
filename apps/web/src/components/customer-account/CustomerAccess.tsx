"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Field, Input } from '../ui/fields';
import { Icon } from '../ui/icons';
import { Tap } from '../order/primitives';
import type { useCustomerEnrollment } from './useCustomerEnrollment';

const primary = 'cf-press flex min-h-12 w-full items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent disabled:cursor-not-allowed disabled:opacity-40';
const secondary = 'cf-press min-h-11 rounded-ctrl border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
type Props = ReturnType<typeof useCustomerEnrollment> & { available: boolean; onSignup?: () => void };

/** No personal account lookup by phone. Secrets are input/display memory only;
 * the parent owns pausing, locking and the public durable flow selection. */
export function CustomerAccess({ state, flow, available, onSignup }: Props) {
  const id = useId(), heading = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState(''), [saved, setSaved] = useState(false), [closing, setClosing] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const access = state.record?.access, phase = access?.phase;
  const protection = access?.method === 'recovery' ? access.protection : undefined;
  const initial = !access || ['completed', 'closed', 'expired'].includes(access.phase);
  const title = initial ? 'Retrouver mon compte' : phase === 'prepared' && access?.method === 'recovery' ? 'Utiliser mon code de secours'
    : phase === 'protecting' ? protection?.stage === 'registration_required' ? 'Créer une nouvelle clé d’accès'
      : protection?.stage === 'assertion_required' ? 'Vérifier la nouvelle clé' : 'Conserver mon nouveau secours'
      : phase === 'failed' ? 'Connexion refusée' : 'Vérifier ma connexion';
  useEffect(() => { queueMicrotask(() => { setCode(''); setSaved(false); setCopyMessage(null); }); }, [state.clearInputs]);
  useEffect(() => { if (state.outcome) heading.current?.focus({ preventScroll: true }); }, [phase, protection?.stage, state.outcome]);
  const online = typeof navigator !== 'undefined' && navigator.onLine;
  const supported = typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.credentials && navigator.locks)
    && typeof PublicKeyCredential !== 'undefined' && typeof indexedDB !== 'undefined';
  const locked = state.busy || !online || state.outcome === 'paused' || state.storageError;
  async function submit(final: boolean) { const input = code; setCode(''); setSaved(false); if (final) await flow?.activate(input); else await flow?.recoverAccess(input); }
  async function copy() {
    if (!state.code) return;
    try { await navigator.clipboard.writeText(state.code); setCopyMessage('Code copié. Conservez-le dans un endroit sûr.'); }
    catch { setCopyMessage('La copie est indisponible. Vous pouvez recopier ce code.'); }
  }
  return <section aria-label="Connexion personnelle" aria-busy={state.busy} className="space-y-4 rounded-panel border border-ink/10 bg-surface2 p-4 sm:p-5">
    <div><p className="mb-1 text-[11px] font-bold uppercase tracking-[.14em] text-accentink">Votre accès personnel</p>
      <h3 ref={heading} tabIndex={-1} className="font-display text-xl font-extrabold leading-tight outline-none">{title}</h3></div>
    {state.message && <p role="status" className="rounded-card border border-prep/25 bg-prep/10 p-3 text-sm leading-6 text-prept">{state.message}</p>}
    {phase === 'preparing' && state.outcome === 'uncertain' && <p className="text-xs leading-5 text-mut">Si la vérification ne permet pas de reprendre, fermez cette démarche puis recommencez. Un accès privé perdu ne sera pas recréé automatiquement.</p>}
    {initial && <>
      <p className="text-sm leading-6 text-mut">Reconnectez-vous avec la clé enregistrée pour ce site du restaurant. Aucun SMS n’est nécessaire.</p>
      {available ? <>
        <Tap className={primary} disabled={locked || !supported} onClick={() => void flow?.beginAccess('passkey')}><Icon name="lock" size={17} />Se connecter avec une clé d’accès</Tap>
        <Tap className={secondary + ' w-full'} disabled={locked || !supported} onClick={() => void flow?.beginAccess('recovery')}>Utiliser mon code de secours</Tap>
      </> : <p role="status" className="text-sm text-mut">La connexion personnelle n’est pas disponible pour le moment.</p>}
      {!supported && <p role="status" className="text-sm leading-6 text-mut">Utilisez un navigateur récent permettant les clés d’accès. La commande en invité reste possible.</p>}
      {!state.record && !state.storageError && <div>
        <Tap className="min-h-11 text-left text-sm font-semibold underline underline-offset-4" disabled={locked || !supported} onClick={() => void flow?.restore()}>Reprendre sur cet appareil</Tap>
        <p className="text-xs leading-5 text-mut">Retrouve seulement cet appareil, jamais un compte sans votre clé ou votre secours.</p>
      </div>}
      {onSignup && <div className="border-t border-ink/10 pt-3"><p className="text-xs leading-5 text-mut">Vous n’avez pas encore de compte ?</p>
        <Tap className="min-h-11 text-left text-sm font-semibold underline underline-offset-4" disabled={locked} onClick={onSignup}>Créer un compte protégé</Tap></div>}
    </>}
    {phase === 'prepared' && access?.method === 'recovery' && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(false); }}>
      <p className="text-sm leading-6 text-mut">Retrouvez le code conservé lors de la protection de votre compte. Vous devrez créer une nouvelle clé et conserver un nouveau secours avant de retrouver votre profil.</p>
      <Field label="Votre code de secours" htmlFor={`${id}-old`} hint="L’ancien code ne sera consommé qu’à la confirmation finale.">
        <Input id={`${id}-old`} autoComplete="off" spellCheck={false} maxLength={128} value={code} disabled={locked} onChange={event => setCode(event.target.value)} className="cf-fig" />
      </Field><Tap type="submit" className={primary} disabled={locked || !code.trim()}>Vérifier mon code de secours</Tap>
    </form>}
    {access?.method === 'passkey' && ['prepared', 'options'].includes(access.phase) && <>
      <p className="text-sm leading-6 text-mut">Choisissez votre clé sur cet appareil ou dans votre gestionnaire de mots de passe.</p>
      <Tap className={primary} disabled={locked} onClick={() => void flow?.login()}>Utiliser ma clé d’accès</Tap>
    </>}
    {phase === 'failed' && <Tap className={primary} disabled={locked} onClick={() => void flow?.retryAccess()}>Préparer une nouvelle tentative</Tap>}
    {phase === 'protecting' && protection?.stage === 'registration_required' && <>
      <p className="text-sm leading-6 text-mut">Le secours a été reconnu. Votre profil reste fermé tant que sa nouvelle protection n’est pas terminée.</p>
      <Tap className={primary} disabled={locked} onClick={() => void flow?.register()}>Créer ma nouvelle clé</Tap>
    </>}
    {phase === 'protecting' && protection?.stage === 'assertion_required' && <>
      <p className="text-sm leading-6 text-mut">Utilisez la nouvelle clé pour confirmer que vous pourrez vous reconnecter.</p>
      <Tap className={primary} disabled={locked} onClick={() => void flow?.assert()}>Vérifier ma nouvelle clé</Tap>
    </>}
    {phase === 'protecting' && protection?.stage === 'recovery_required' && <>
      <p className="text-sm leading-6 text-mut">Conservez un nouveau code personnel à usage unique. L’ancien sera remplacé à la confirmation finale.</p>
      {state.code ? <div className="space-y-3 rounded-card border border-accent/25 bg-surface p-3">
        <code aria-label="Nouveau code de secours personnel" className="cf-fig block break-all text-base font-bold leading-7">{state.code}</code>
        <p className="text-xs leading-5 text-mut">Ce code n’est pas enregistré dans le navigateur. Fermer ce panneau ou quitter cet onglet le masque.</p>
        <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => void copy()}>Copier le nouveau code</Tap>
        {copyMessage && <p role="status" className="text-xs text-mut">{copyMessage}</p>}
        <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => { flow?.hideCode(); setSaved(true); }}>Je l’ai conservé, masquer le code</Tap>
      </div> : <>
        {protection.recoveryVersion < 3 && !protection.pending && !saved && <Tap className={secondary + ' w-full'} disabled={locked} onClick={() => void flow?.recoveryCode()}>
          {protection.recoveryVersion ? 'Remplacer le nouveau code' : 'Afficher mon nouveau secours'}</Tap>}
        {protection.recoveryVersion > 0 && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(true); }}>
          {!saved && <p className="text-xs leading-5 text-mut">Saisissez le dernier code conservé. Le remplacer invalide ce candidat ; trois affichages maximum.</p>}
          <Field label="Ressaisissez le nouveau code de secours" htmlFor={`${id}-new`}>
            <Input id={`${id}-new`} autoComplete="off" spellCheck={false} maxLength={128} value={code} disabled={locked} onChange={event => setCode(event.target.value)} className="cf-fig" />
          </Field><Tap type="submit" className={primary} disabled={locked || !code.trim()}>Confirmer et retrouver mon compte</Tap>
        </form>}
      </>}
    </>}
    {!initial && <>
      <Tap className={secondary + ' w-full'} disabled={state.busy || !online} onClick={() => void flow?.resume()}>{protection?.pending === 'activate' ? 'Vérifier la confirmation' : 'Vérifier la démarche en cours'}</Tap>
      <div className="border-t border-ink/10 pt-3">{closing ? <>
        <p className="text-sm leading-6 text-mut">Fermer cette démarche ? Les réponses en route ne pourront plus la terminer. Votre compte n’est pas supprimé.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Tap className={secondary} disabled={state.busy} onClick={() => setClosing(false)}>Garder en pause</Tap>
          <Tap className={secondary} disabled={locked} onClick={() => { setClosing(false); void flow?.close(); }}>Fermer cette démarche</Tap></div>
      </> : <Tap className="min-h-11 text-left text-xs font-semibold text-mut underline underline-offset-4" disabled={state.busy} onClick={() => setClosing(true)}>Abandonner cette démarche</Tap>}
      <p className="mt-2 text-xs leading-5 text-mut">Revenir au menu met seulement cette démarche en pause. Vous pouvez toujours commander en invité.</p></div>
    </>}
  </section>;
}
