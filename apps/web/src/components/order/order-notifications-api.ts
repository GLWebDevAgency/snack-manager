import type { OrderPushConfigView, OrderPushSubscription, OrderReadyPreferenceView } from '@sm/contracts';
import { API_URL } from './api';

export async function orderNotificationConfig(slug: string, signal?: AbortSignal): Promise<OrderPushConfigView> {
  const response = await fetch(`${API_URL}/public/tenants/${encodeURIComponent(slug)}/order-notifications/config`, { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal });
  if (!response.ok) throw new Error('Vérification des notifications indisponible.');
  const body = await response.json() as OrderPushConfigView;
  return { available: body.available === true && typeof body.publicKey === 'string', publicKey: typeof body.publicKey === 'string' ? body.publicKey : null };
}

export class OrderNotificationChanged extends Error {
  constructor(readonly current: OrderReadyPreferenceView) { super('La préférence a changé sur un autre écran. Vérifiez-la, puis réessayez si nécessaire.'); }
}
function validPreference(body: OrderReadyPreferenceView): boolean {
  return ['active', 'sent', 'off'].includes(body.state) && Number.isSafeInteger(body.revision) && body.revision >= 0
    && (body.expiresAt === null || (typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt))));
}
export async function orderNotificationPreference({ slug, orderId, trackingToken, endpoint, subscription, expectedRevision, action, signal }: {
  slug: string; orderId: string; trackingToken: string; endpoint: string; subscription?: OrderPushSubscription; expectedRevision?: number;
  action: 'subscribe' | 'status' | 'revoke'; signal?: AbortSignal;
}): Promise<OrderReadyPreferenceView> {
  const path = `/public/tenants/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/ready-notification${action === 'status' ? '/status' : ''}`;
  const response = await fetch(`${API_URL}${path}`, {
    method: action === 'revoke' ? 'DELETE' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify(action === 'subscribe' ? { trackingToken, subscription, expectedRevision } : { trackingToken, endpoint }),
  });
  if (response.status === 409 && action === 'subscribe') {
    const conflict = await response.json().catch(() => null) as { code?: string; current?: OrderReadyPreferenceView } | null;
    if (conflict?.code === 'ORDER_NOTIFICATION_CHANGED' && conflict.current && validPreference(conflict.current)) throw new OrderNotificationChanged(conflict.current);
  }
  if (!response.ok) throw new Error(action === 'revoke'
    ? 'Désactivation non confirmée. La notification peut encore être envoyée. Réessayez.'
    : 'Enregistrement non confirmé. Réessayez pour vérifier cette notification.');
  const body = await response.json() as OrderReadyPreferenceView;
  if (!validPreference(body)) throw new Error('Confirmation illisible. Réessayez.');
  return body;
}
