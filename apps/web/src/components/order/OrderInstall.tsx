'use client';

import { useEffect, useRef, useState } from 'react';
import { contexteInstallation, modeInstallation, type ContexteInstallation } from '@/components/loyalty/installation';
import { registerOrderWorker } from './order-worker';
import styles from './order-notifications.module.css';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function OrderInstall({ slug, name, disabled = false, eligible = true }: { slug: string; name: string; disabled?: boolean; eligible?: boolean }) {
  const prompt = useRef<InstallEvent | null>(null);
  const [native, setNative] = useState(false);
  const [context, setContext] = useState<ContexteInstallation>('rien');
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [inScope, setInScope] = useState(false);
  useEffect(() => {
    if (disabled) return;
    const standalone = window.matchMedia('(display-mode: standalone)');
    const update = () => {
      setContext(contexteInstallation({ ua: navigator.userAgent, tactile: 'ontouchend' in window,
        affichageAutonome: standalone.matches, standaloneIOS: (navigator as Navigator & { standalone?: boolean }).standalone }));
      setInScope(window.location.pathname.startsWith(`/r/${slug}/`));
    };
    update();
    const capture = (event: Event) => { event.preventDefault(); prompt.current = event as InstallEvent; setNative(true); };
    const installed = () => { prompt.current = null; setNative(false); setContext('autonome'); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    standalone.addEventListener('change', update);
    if (window.isSecureContext && 'serviceWorker' in navigator) void registerOrderWorker(slug).catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed); standalone.removeEventListener('change', update); };
  }, [disabled, slug]);
  const mode = modeInstallation({ contexte: context, inviteNative: native, ecartee: dismissed });
  if (disabled || !eligible || dismissed || context === 'autonome') return null;
  if (!inScope) return <section className={styles.panel} aria-label="Installer l’application de commande">
    <strong>Gardez {name} à portée de main</strong>
    <p className={styles.hint}>Ouvrez la carte pour installer l’application du restaurant et retrouver vos commandes.</p>
    <a className={styles.button} href={`/r/${encodeURIComponent(slug)}/carte?installer=1`}>Ouvrir la carte pour installer</a>
  </section>;
  if (mode === 'aucune') return null;
  async function install() {
    const event = prompt.current;
    if (!event || busy) return;
    setBusy(true); setError(false);
    try { await event.prompt(); const result = await event.userChoice; if (result.outcome === 'accepted') setDismissed(true); }
    catch { setError(true); }
    finally { prompt.current = null; setNative(false); setBusy(false); }
  }
  return <section className={styles.panel} aria-label="Installer l’application de commande">
    <strong>Gardez {name} à portée de main</strong>
    {mode === 'ios' ? <p className={styles.hint}>Dans Safari, ouvrez Partager, puis « Sur l’écran d’accueil ». Vous retrouverez vos commandes depuis cette icône.</p> :
      <p className={styles.hint}>Installez l’application pour retrouver la carte et le suivi de vos commandes.</p>}
    {error && <p role="alert" className={styles.hint}>Installation non confirmée. Vous pouvez utiliser le menu de votre navigateur.</p>}
    <div className={styles.actions}>{mode === 'invite' && <button type="button" className={styles.button} disabled={busy} onClick={() => { void install(); }}>Installer</button>}
      <button type="button" className={styles.plain} onClick={() => setDismissed(true)}>Pas maintenant</button></div>
  </section>;
}
