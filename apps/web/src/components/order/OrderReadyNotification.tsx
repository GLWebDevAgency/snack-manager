'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OrderPushSubscriptionSchema, type OrderPushConfigView, type OrderReadyPreferenceView } from '@sm/contracts';
import { Icon } from '@/components/ui/icons';
import { OrderNotificationChanged, orderNotificationConfig, orderNotificationPreference } from './order-notifications-api';
import { registerOrderWorker, vapidBytes } from './order-worker';
import styles from './order-notifications.module.css';
import { estIOS } from '@/components/loyalty/installation';

type Props = {
  slug: string; orderId: string; trackingToken: string; disabled?: boolean;
};
export function OrderReadyNotification(props: Props) {
  if (props.disabled || !props.trackingToken) return null;
  return <OrderNotificationPreference key={`${props.slug}:${props.orderId}:${props.trackingToken}`} {...props} />;
}

function OrderNotificationPreference({ slug, orderId, trackingToken, disabled = false }: Props) {
  const [config, setConfig] = useState<OrderPushConfigView | null>(null);
  const [preference, setPreference] = useState<OrderReadyPreferenceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [ios, setIos] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scope = `${slug}:${orderId}:${trackingToken}`;
  const latest = useRef(scope);
  useLayoutEffect(() => { latest.current = disabled ? '' : scope; return () => { latest.current = ''; }; }, [disabled, scope]);
  useEffect(() => {
    if (disabled || !trackingToken) return;
    const abort = new AbortController();
    const isCurrent = () => !abort.signal.aborted && latest.current === scope;
    void (async () => {
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (isCurrent()) { setUnsupported(true); setIos(estIOS(navigator.userAgent, 'ontouchend' in window)); } return;
      }
      const settings = await orderNotificationConfig(slug, abort.signal);
      if (!isCurrent()) return;
      setConfig(settings);
      if (!settings.available) return;
      const registration = await registerOrderWorker(slug);
      if (!isCurrent()) return;
      const subscription = await registration.pushManager.getSubscription();
      if (!isCurrent()) return;
      const state = subscription ? await orderNotificationPreference({ slug, orderId, trackingToken, endpoint: subscription.endpoint, action: 'status', signal: abort.signal }) : { state: 'off' as const, expiresAt: null, revision: 0 };
      if (isCurrent()) { setPreference(state); setError(null); }
    })().catch(() => { if (isCurrent()) setError('Impossible de vérifier la notification. Vous pouvez réessayer.'); });
    return () => abort.abort();
  }, [disabled, slug, orderId, trackingToken, attempt, scope]);

  async function activate() {
    if (busy || disabled || !config?.available || !config.publicKey) return;
    const generation = scope;
    setBusy(true); setError(null);
    try {
      // Safari exige que la permission soit demandée dans le geste lui-même.
      const permission = await Notification.requestPermission();
      if (latest.current !== generation) return;
      if (permission !== 'granted') throw new Error('Les notifications ne sont pas autorisées. Vous pouvez suivre votre commande sur cette page.');
      const registration = await registerOrderWorker(slug);
      if (latest.current !== generation) return;
      const existing = await registration.pushManager.getSubscription();
      if (latest.current !== generation) return;
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(config.publicKey) });
      if (latest.current !== generation) return;
      const parsed = OrderPushSubscriptionSchema.parse(subscription.toJSON());
      if (latest.current !== generation) return;
      const observed = existing && preference ? preference : await orderNotificationPreference({ slug, orderId, trackingToken, endpoint: parsed.endpoint, action: 'status' });
      if (latest.current !== generation) return;
      const result = await orderNotificationPreference({ slug, orderId, trackingToken, endpoint: parsed.endpoint, subscription: parsed, expectedRevision: observed.revision, action: 'subscribe' });
      if (latest.current === generation) setPreference(result);
    } catch (failure) { if (latest.current === generation) { if (failure instanceof OrderNotificationChanged) setPreference(failure.current); setError(failure instanceof Error ? failure.message : 'Activation non confirmée. Réessayez.'); } }
    finally { if (latest.current === generation) setBusy(false); }
  }

  async function revoke() {
    if (busy || disabled) return;
    const generation = scope;
    setBusy(true); setError(null);
    try {
      const registration = await registerOrderWorker(slug);
      if (latest.current !== generation) return;
      const subscription = await registration.pushManager.getSubscription();
      if (latest.current !== generation) return;
      if (!subscription) throw new Error('Abonnement introuvable sur cet appareil. La désactivation serveur n’est pas confirmée.');
      const result = await orderNotificationPreference({ slug, orderId, trackingToken, endpoint: subscription.endpoint, action: 'revoke' });
      // L'abonnement navigateur peut servir d'autres commandes : on ne le supprime pas.
      if (latest.current === generation) setPreference(result);
    } catch (failure) { if (latest.current === generation) setError(failure instanceof Error ? failure.message : 'Désactivation non confirmée. Réessayez.'); }
    finally { if (latest.current === generation) setBusy(false); }
  }

  if (disabled || !trackingToken) return null;
  if (unsupported) return <p className={styles.hint}>{ios ? <>Pour recevoir une alerte sur iPhone, <a href={`/r/${encodeURIComponent(slug)}/carte?installer=1`}>ouvrez la carte et installez l’application</a>, puis retrouvez cette commande depuis son icône.</> : 'Ce navigateur ne permet pas les notifications. Le suivi reste accessible sur cette page.'}</p>;
  if (config && !config.available) return <p className={styles.hint}>Les notifications sont indisponibles pour le moment. Le suivi reste accessible sur cette page.</p>;
  const enabled = preference?.state === 'active';
  return <section className={styles.panel} aria-label="Notification de commande">
    <div className={styles.row}><Icon name="bell" size={23} /><div><strong>Être averti quand c’est prêt</strong>
      <p className={styles.hint}>Une alerte pour cette commande uniquement.</p></div></div>
    <p role="status" className={styles.hint}>{busy ? 'Enregistrement…' : enabled ? 'Notification activée sur cet appareil.' : preference?.state === 'sent' ? 'Notification envoyée.' : !config ? 'Vérification…' : 'Les alertes restent facultatives.'}</p>
    {error && <p role="alert" className={styles.hint}>{error}</p>}
    {preference?.state !== 'sent' && <button type="button" className={styles.button} disabled={busy || (!config?.available && !error)} onClick={() => { if (!config?.available) setAttempt(attempt + 1); else void (enabled ? revoke() : activate()); }}>
      {enabled ? 'Désactiver l’alerte' : error ? 'Réessayer' : 'Activer la notification'}
    </button>}
  </section>;
}
