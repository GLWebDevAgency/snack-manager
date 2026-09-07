import { importRecoveredDeliveryReceipt, readDeliveryCheckoutReceipt } from "./checkout-attempt";
import { deliveryProofAccessForReceipt, readDeliveryProofAccessFragment } from "./delivery-proof-access";
import { networkApi } from "./api";
export class DeliveryPaymentReturnError extends Error {}

/** A Stripe return must never contain a private fragment. Before leaving this
 * origin, require durable restoration instead of silently losing that access.
 */
export async function prepareDeliveryPaymentReturn(tenant: string | null, orderId: string, trackingToken: string): Promise<void> {
  const access = readDeliveryProofAccessFragment(window.location.hash);
  if (!access) return;
  const failure = () => new DeliveryPaymentReturnError("Votre accès privé de livraison doit être sauvegardé avant le paiement. Conservez ce lien et réessayez la vérification, reprenez sur l’appareil utilisé pour commander, ou contactez le restaurant.");
  if (!tenant) throw failure();
  try {
    const receipt = await readDeliveryCheckoutReceipt(tenant, orderId, true);
    let stored = deliveryProofAccessForReceipt(receipt, orderId, Date.now());
    if (!stored) {
      // Only an explicit payment gesture gets here, never a mount/focus effect.
      // Recover may materialize an already admitted order; no new clientId.
      const result = await networkApi.recoverOrder(tenant, access);
      await importRecoveredDeliveryReceipt(tenant, orderId, trackingToken, access, result);
      stored = deliveryProofAccessForReceipt(await readDeliveryCheckoutReceipt(tenant, orderId, true), orderId, Date.now());
    }
    if (!stored || stored.clientId !== access.clientId || stored.recoveryProof !== access.recoveryProof) throw failure();
    if (window.location.hash !== `#remise=v1.${access.clientId}.${access.recoveryProof}`) throw failure();
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  } catch { throw failure(); }
}
