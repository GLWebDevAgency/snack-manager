import { forgetRememberedCustomer } from './customer-memory';
import { forgetDevicePreferences } from './device-preferences';
import { CheckoutAttemptStorageError, forgetDeviceCheckoutReceipt, readDeviceCheckoutReceipts } from './checkout-attempt';
import { forgetCustomerLoyaltyCard } from '../loyalty/customer-api';

/** Clears convenience data for this restaurant only. Pending checkout, private
 * account access, delivery proof and the current basket are never erased. */
export async function clearDeviceConvenienceData(slug: string, loyalty = false) {
  const failed: string[] = [];
  let forgottenReceipts = 0, retainedReceipts = 0;
  const attempt = async (label: string, work: () => Promise<void>) => { try { await work(); } catch { failed.push(label); } };
  await attempt('coordonnées', () => forgetRememberedCustomer(slug));
  await attempt('préférences', () => forgetDevicePreferences(slug));
  try {
    for (const row of await readDeviceCheckoutReceipts(slug, null)) {
      try { await forgetDeviceCheckoutReceipt(slug, row.receipt.orderId); forgottenReceipts++; }
      catch (cause) { if (cause instanceof CheckoutAttemptStorageError && cause.code === 'conflict') retainedReceipts++;
        else failed.push('raccourcis de commande'); }
    }
  } catch { failed.push('raccourcis de commande'); }
  if (loyalty) await attempt('carte fidélité sur cet appareil', () => forgetCustomerLoyaltyCard(slug, AbortSignal.timeout(10_000)));
  return { forgottenReceipts, retainedReceipts, failed: [...new Set(failed)] };
}
