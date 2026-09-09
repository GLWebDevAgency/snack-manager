import { CustomerAccountBrowserRefSchema, CustomerAccountPublicationSchema, CustomerCreateOrderRequestSchema,
  CustomerOrderCreateResponseSchema } from '@sm/contracts';
import { CustomerAccountHttpError, type CustomerAccountRequest, type CustomerAccountState } from '../customer-account/client';
import { isPaused, type CreatedOrder, type OrderingApi, type PausedResponse } from './api';
import type { CheckoutAccountAccess, CheckoutProvenance, PendingCheckoutAttempt } from './checkout-attempt';

function validAccess(access: CheckoutAccountAccess | null, now: number): access is CheckoutAccountAccess {
  return !!access && Number.isSafeInteger(access.privacyEpoch) && access.privacyEpoch >= 0
    && Number.isSafeInteger(access.expiresAt) && access.expiresAt > now
    && CustomerAccountBrowserRefSchema.safeParse(access.selection.browserRef).success
    && CustomerAccountPublicationSchema.safeParse(access.selection.publication).success;
}

/** Capture synchronously from the view that owns the gesture, before any
 * fingerprint, lock or IndexedDB await. A previous C01 keeps its own provenance. */
export function captureCheckoutProvenance(status: CustomerAccountState['status'], access: CheckoutAccountAccess | null,
  enabled: boolean, now = Date.now()): CheckoutProvenance {
  if (!enabled || status === 'guest' && access === null) return { kind: 'guest' };
  if (status !== 'authenticated' || !validAccess(access, now)) throw new CustomerAccountHttpError(409);
  return { kind: 'account', ...structuredClone(access) };
}

export function checkoutAccessMatches(provenance: CheckoutProvenance, access: CheckoutAccountAccess | null, now = Date.now()): boolean {
  if (provenance.kind === 'guest') return true;
  return validAccess(access, now) && provenance.expiresAt === access.expiresAt && provenance.privacyEpoch === access.privacyEpoch
    && provenance.selection.browserRef === access.selection.browserRef
    && provenance.selection.publication.expectedOperationId === access.selection.publication.expectedOperationId
    && provenance.selection.publication.expectedCheckId === access.selection.publication.expectedCheckId;
}

type Port = { slug: string; currentAccess: () => CheckoutAccountAccess | null; accountRequest: CustomerAccountRequest;
  guestCreate: OrderingApi['createOrder']; now?: () => number };
type Outcome = { state: 'created'; order: CreatedOrder } | PausedResponse
  | { state: 'rejected'; reason: 'unavailable' | 'slot_unavailable' | 'invalid_order' | 'abandoned'; message: string };

/** One dispatch only. No automatic retry, account-to-guest fallback, or private
 * receipt writes. Only the existing proof-scoped C01 recovery can settle loss. */
export async function createCheckoutAttemptOrder(port: Port, attempt: PendingCheckoutAttempt, turnstileToken: string): Promise<Outcome> {
  if (attempt.tenant !== port.slug || attempt.state !== 'uncertain'
    || (attempt.v !== 1 && attempt.v !== 2) || (attempt.v === 2 && !attempt.provenance)
    || (attempt.v === 1 && attempt.provenance !== undefined)) throw new CustomerAccountHttpError(409);
  const input = { ...attempt.payload, clientId: attempt.clientId, recoveryProof: attempt.recoveryProof, turnstileToken };
  const provenance = attempt.v === 1 ? { kind: 'guest' as const } : attempt.provenance!;
  if (provenance.kind === 'guest') {
    const result = await port.guestCreate(port.slug, input);
    return isPaused(result) ? result : { state: 'created', order: result };
  }
  const now = port.now ?? Date.now;
  if (!checkoutAccessMatches(provenance, port.currentAccess(), now())) throw new CustomerAccountHttpError(409);
  const body = CustomerCreateOrderRequestSchema.parse(input);
  const raw = await port.accountRequest('order-create', body, provenance.selection);
  if (!checkoutAccessMatches(provenance, port.currentAccess(), now())) throw new CustomerAccountHttpError(409);
  const result = CustomerOrderCreateResponseSchema.parse(raw);
  if (result.expiresAt !== provenance.expiresAt || result.expiresAt <= now()) throw new CustomerAccountHttpError(409);
  return result.state === 'created' ? { state: 'created', order: result.order }
    : { state: 'rejected', reason: result.reason, message: result.message };
}
