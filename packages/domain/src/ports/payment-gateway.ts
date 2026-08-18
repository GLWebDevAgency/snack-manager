import type { OrderNumber } from '../ordering/order-number';
import type { Money } from '../shared/money';
import type { TenantSlug } from '../tenancy/public-domain';

/**
 * PORT — encaisser à distance.
 *
 * Le domaine sait qu'une commande peut être réglée avant le retrait ; il ignore
 * que Stripe existe, ce qu'est un `client_secret` et qu'un montant y voyage en
 * centimes par coïncidence.
 *
 * Contrainte du terrain qui dicte toute la forme de ce port : le paiement en
 * ligne est un CONFORT, jamais un passage obligé. Un snack ouvre sans compte
 * Stripe, la clé peut expirer, l'API peut tomber un vendredi soir — et pendant
 * ce temps la file au comptoir continue d'avancer. C'est pourquoi aucune
 * méthode ne lève : l'indisponibilité est une réponse normale (`available:
 * false`), que l'interface traduit par « à régler au comptoir ». Un port qui
 * jetterait une exception obligerait chaque appelant à savoir rattraper le
 * paiement pour ne pas perdre la commande.
 */

/** Ce que le fournisseur doit pouvoir rapprocher de nos propres écritures. */
export interface PaymentReference {
  readonly tenant: TenantSlug;
  /** Identifiant technique de la commande (opaque, propre à notre stockage). */
  readonly orderId: string;
  /** Numéro crié au comptoir — le seul repère commun au client et à la caisse. */
  readonly orderNumber: OrderNumber;
}

/**
 * Étiquettes libres recopiées chez le fournisseur.
 * Sert au rapprochement bancaire : sans elles, un virement Stripe de 1 240,50 €
 * en fin de semaine est impossible à ventiler entre restaurants.
 */
export type PaymentMetadata = Readonly<Record<string, string>>;

/**
 * États d'une intention de paiement, réduits à ce que le métier décide.
 * On ne recopie pas la dizaine d'états d'un fournisseur : seuls comptent
 * « le client doit encore payer », « on attend la banque », « c'est réglé »,
 * « c'est mort ».
 */
export type PaymentIntentStatus =
  | 'requires_payment'
  | 'processing'
  | 'succeeded'
  | 'cancelled';

export interface PaymentIntent {
  /** Identifiant chez le fournisseur — permet le remboursement ultérieur. */
  readonly providerId: string;
  /** Jeton remis au navigateur pour finir le paiement. Ne transite jamais en clair côté serveur. */
  readonly clientSecret: string;
  readonly amount: Money;
  readonly status: PaymentIntentStatus;
}

/**
 * Résultat d'une demande de paiement.
 *
 * Volontairement distinct de `Result` : ce n'est pas une règle métier violée
 * mais un service absent. La commande reste valide dans les deux cas, et le
 * `reason` est un texte affichable au client (« Paiement en ligne non
 * configuré »), pas un code technique.
 */
export type PaymentAttempt =
  | { readonly available: true; readonly intent: PaymentIntent }
  | { readonly available: false; readonly reason: string };

export type RefundAttempt =
  | { readonly available: true; readonly providerId: string; readonly amount: Money }
  | { readonly available: false; readonly reason: string };

export interface PaymentGateway {
  /** Nom lisible de l'implémentation (journalisation, écran d'administration). */
  readonly providerName: string;

  /**
   * Prépare l'encaissement d'une commande.
   * Appelable plusieurs fois pour la même commande : le client qui revient sur
   * l'onglet resté ouvert ne doit pas payer deux fois.
   */
  createIntent(
    reference: PaymentReference,
    amount: Money,
    metadata: PaymentMetadata,
  ): Promise<PaymentAttempt>;

  /**
   * Rembourse tout ou partie d'un paiement déjà encaissé.
   * Le remboursement partiel existe parce que le geste commercial le plus
   * fréquent n'est pas « on annule tout » mais « on vous rend la boisson ».
   */
  refund(providerId: string, amount: Money, reason: string): Promise<RefundAttempt>;
}
