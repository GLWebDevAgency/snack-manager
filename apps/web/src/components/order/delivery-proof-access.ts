import type { DeliveryCheckoutReceipt, ReceivedCheckoutAttempt } from "./checkout-attempt";

/** Private customer access, not the PIN/QR shown to a courier. The API remains
 * authoritative; parsing this fragment does not prove ownership or delivery.
 */
export type DeliveryProofAccess = Readonly<{ clientId: string; recoveryProof: string }>;
export const DELIVERY_PROOF_ACCESS_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const UUID = "[a-f\\d]{8}-[a-f\\d]{4}-4[a-f\\d]{3}-[89ab][a-f\\d]{3}-[a-f\\d]{12}";
const FRAGMENT = new RegExp(`^#remise=v1\\.(${UUID})\\.([a-f\\d]{64})$`);
const ID = new RegExp(`^${UUID}$`);
const PROOF = /^[a-f\d]{64}$/;

/** No arbitrary URL, query, decoding, duplicate fields or other QR payload accepted. */
export function readDeliveryProofAccessFragment(fragment: string): DeliveryProofAccess | null {
  // Fixed format: #remise=v1. (11), UUID (36), dot (1), proof (64).
  if (typeof fragment !== "string" || fragment.length !== 112) return null;
  const match = FRAGMENT.exec(fragment);
  return match ? Object.freeze({ clientId: match[1], recoveryProof: match[2] }) : null;
}

/** The caller must keep this in the hash, never append it to query parameters,
 * logs, analytics, printed receipts or messages sent to the restaurant.
 */
export function deliveryProofAccessFragment(access: DeliveryProofAccess): string {
  if (!access || typeof access !== "object" || Array.isArray(access)
    || Object.getPrototypeOf(access) !== Object.prototype
    || Object.keys(access).sort().join() !== "clientId,recoveryProof"
    || typeof access.clientId !== "string" || !ID.test(access.clientId)
    || typeof access.recoveryProof !== "string" || !PROOF.test(access.recoveryProof)) {
    throw new Error("Accès de remise invalide");
  }
  return `#remise=v1.${access.clientId}.${access.recoveryProof}`;
}

/** Use only a receipt read from the origin/tenant-scoped journal. An old,
 * unrelated or legacy receipt never gains access from its tracking token.
 */
export function deliveryProofAccessForReceipt(attempt: DeliveryCheckoutReceipt | null, orderId: string, now: number): DeliveryProofAccess | null {
  if (!attempt || !["received", "imported"].includes(attempt.state) || attempt.receipt.orderId !== orderId
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(attempt.updatedAt)
    || now < attempt.updatedAt || now - attempt.updatedAt >= DELIVERY_PROOF_ACCESS_RETENTION_MS
    || !attempt.receipt.recoveryProof) return null;
  try {
    return readDeliveryProofAccessFragment(deliveryProofAccessFragment({ clientId: attempt.clientId, recoveryProof: attempt.receipt.recoveryProof }));
  } catch { return null; }
}

/** Guest navigation may carry its independent fragment. Account navigation
 * restores the handoff proof through the session-filtered journal instead of
 * exporting it automatically into the URL. Stripe returns also omit fragments.
 */
export function customerTrackingHref(orderId: string, trackingToken: string, receipt: ReceivedCheckoutAttempt | null, now: number): string {
  const base = `/t/${encodeURIComponent(orderId)}?t=${encodeURIComponent(trackingToken)}`;
  if (receipt?.receipt.trackingToken !== trackingToken || receipt.provenance?.kind === 'account') return base;
  const access = deliveryProofAccessForReceipt(receipt, orderId, now);
  return base + (access ? deliveryProofAccessFragment(access) : "");
}
