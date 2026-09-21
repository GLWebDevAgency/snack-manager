import { CounterRefundConfirmationSchema, CounterRefundJournalSchema, CounterRefundNoEffectSchema, CounterRefundRequestSchema,
  CounterRefundResultSchema, type CounterRefundRequest } from '@sm/contracts';
import { SmApiError, type SmClient } from '@sm/client-core';

export interface CounterRefundAccess {
  client: Pick<SmClient, 'tenantStore'>;
  request: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;
  ownerId: string;
  role: string;
  /** Pinned to the React session cycle, never a replacement account. */
  sessionKey: string;
  onSessionExpired: () => void;
}
/** Financial credentials must never follow a redirect. This direct transport
 * captures one session and does not share the POS offline queue or cache. */
export function counterRefundHttp(baseUrl: string, token: string): CounterRefundAccess['request'] {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || !token || base.protocol !== 'https:'
    && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('Origine de remboursement invalide.');
  return async (method, path, body) => {
    if (!(method === 'GET' && path === '/orders?status=delivered')
      && !new RegExp(`^/orders/[a-f0-9]{24}/counter-refunds/${method === 'GET' ? 'journal' : '(?:prepare|start|confirm|withdraw|no-effect)'}$`).test(path)) throw new Error('Route de remboursement invalide.');
    const maxBytes = method === 'GET' && path === '/orders?status=delivered' ? 8 * 1024 * 1024 : 262_144;
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, { method, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const announced = response.headers.get('content-length');
    if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > maxBytes)) {
      await response.body?.cancel(); throw new Error('Réponse de remboursement trop volumineuse.');
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new Error('Réponse de remboursement illisible.'); }
    const reader = response.body?.getReader();
    // Native fetch may not expose a stream. Content-Length and the decoded
    // bounded text still guard the payload on that adapter.
    let text = '', size = 0;
    if (reader) {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > maxBytes) throw new Error('Réponse de remboursement trop volumineuse.'); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; } finally { reader.releaseLock(); }
    } else { text = await response.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Réponse de remboursement trop volumineuse.'); }
    const data: unknown = JSON.parse(text);
    if (response.status !== 200 && !(method === 'POST' && response.status === 201)) {
      // Provider bodies/credentials never enter logs. The API's explicit public
      // message may be shown to the operator; malformed bodies stay generic.
      const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' && data.message.length <= 500 ? data.message : 'Le remboursement reste à vérifier.';
      throw new SmApiError(message, response.status, undefined);
    }
    return data;
  };
}
export type CounterRefundStep = 'prepare' | 'start' | 'confirm' | 'withdraw' | 'no-effect';
export async function counterRefundDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('La réponse reste à vérifier. Ne rendez pas d’argent sur la base de cette attente.')), 15_000);
  })]); } finally { clearTimeout(timer); }
}
export function createCounterRefundTransport(access: CounterRefundAccess, current: () => boolean) {
  const guard = () => { if (!current()) throw new Error('La session ou la connexion a changé. Reprenez la vérification avec le même accès.'); };
  const path = (orderId: string) => {
    if (!/^[a-f0-9]{24}$/.test(orderId)) throw new Error('Commande invalide.');
    return `/orders/${orderId}/counter-refunds`;
  };
  async function run<T>(work: () => Promise<T>): Promise<T> {
    guard();
    try { const value = await counterRefundDeadline(work()); guard(); return value; }
    catch (error) { if (current() && error instanceof SmApiError && error.status === 401) access.onSessionExpired(); throw error; }
  }
  return {
    read: async (orderId: string) => {
      const view = CounterRefundJournalSchema.parse(await run(() => access.request('GET', `${path(orderId)}/journal`)));
      if (view.orderId !== orderId) throw new Error('Le reçu ne correspond pas à cette commande.');
      return view;
    },
    send: async (orderId: string, step: CounterRefundStep, raw: unknown) => {
      const body = (step === 'confirm' ? CounterRefundConfirmationSchema : step === 'no-effect' ? CounterRefundNoEffectSchema : CounterRefundRequestSchema).parse(raw);
      const result = CounterRefundResultSchema.parse(await run(() => access.request('POST', `${path(orderId)}/${step}`, body)));
      const operation = result.journal.operations.find(op => op.operationId === body.operationId);
      if (result.journal.orderId !== orderId || !operation || operation.reason !== body.reason || operation.amountCents !== body.amountCents
        || operation.tender !== body.tender || JSON.stringify(operation.allocation) !== JSON.stringify(body.allocation)
        || (result.mayDisburse && (step !== 'start' || operation.state !== 'started' || !operation.canResume))) {
        throw new Error('Le résultat ne confirme pas cette demande. Relisez le journal avant de continuer.');
      }
      return result;
    },
  };
}
export function counterRefundAuthorization(role: string, secret: string): CounterRefundRequest['authorization'] {
  return role === 'owner' ? { kind: 'owner_password', password: secret } : { kind: 'manager_pin', pin: secret };
}
