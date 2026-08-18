import type { Money } from '@sm/domain';
import type {
  PaymentAttempt,
  PaymentGateway,
  PaymentMetadata,
  PaymentReference,
  RefundAttempt,
} from '@sm/domain/src/ports';

/**
 * ADAPTATEUR — pas de paiement en ligne, et c'est dit clairement.
 *
 * Le cas le plus fréquent du parc, pas un cas dégradé : un snack qui ouvre un
 * compte Snack Manager le lundi encaisse au comptoir depuis toujours et n'a
 * aucune envie d'ouvrir un compte Stripe avant d'avoir essayé le produit.
 *
 * L'objet nul explicite évite le `if (gateway)` éparpillé dans les services —
 * celui qu'on oublie une fois, et qui envoie une commande payable nulle part.
 * Ici, la réponse est toujours la même et toujours affichable : « paiement en
 * ligne non configuré », et le parcours continue vers le règlement au comptoir.
 */
export const PAYMENT_NOT_CONFIGURED = 'Paiement en ligne non configuré';

export class NullPaymentGateway implements PaymentGateway {
  readonly providerName = 'aucun';

  async createIntent(
    _reference: PaymentReference,
    _amount: Money,
    _metadata: PaymentMetadata,
  ): Promise<PaymentAttempt> {
    return { available: false, reason: PAYMENT_NOT_CONFIGURED };
  }

  async refund(_providerId: string, _amount: Money, _reason: string): Promise<RefundAttempt> {
    // Rien n'a jamais été encaissé en ligne : un remboursement se fait en
    // espèces au comptoir, et la trace est celle de la caisse.
    return {
      available: false,
      reason: 'Aucun paiement en ligne à rembourser : le règlement a eu lieu au comptoir.',
    };
  }
}
