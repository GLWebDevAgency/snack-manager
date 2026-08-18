import type { OrderNumber } from '../ordering/order-number';
import type { OrderStatus } from '../ordering/order-status';
import type { Money } from '../shared/money';
import type { TenantSlug } from '../tenancy/public-domain';

/**
 * PORT — annoncer ce qui vient de se passer.
 *
 * Trois surfaces regardent la même commande en même temps : la caisse, la
 * tablette cuisine, la page de suivi du client. Sans diffusion, chacune
 * interroge l'API en boucle et le KDS affiche « prête » quinze secondes après le
 * comptoir — assez pour crier un numéro dans le vide.
 *
 * Le domaine décrit CE QUI arrive ; il ignore que le transport est un pub/sub
 * Redis relayé en WebSocket. Demain un bus managé, un webhook vers la comptable
 * ou un journal d'audit s'abonneront aux mêmes événements sans qu'une seule
 * règle métier bouge.
 *
 * Les événements sont au PASSÉ et immuables : ce sont des faits constatés, pas
 * des ordres. Rien ne garantit qu'un abonné les reçoive dans l'ordre — c'est
 * `mostAdvanced` qui arbitre côté commande, pas la file.
 */

interface DomainEventBase {
  readonly tenant: TenantSlug;
  /** Instant du fait, issu de la `Clock` injectée — jamais de `Date.now()`. */
  readonly occurredAt: Date;
}

export interface OrderCreated extends DomainEventBase {
  readonly name: 'order.created';
  readonly orderId: string;
  readonly orderNumber: OrderNumber;
  readonly total: Money;
  /** Articles à préparer, quantités comprises : la cuisine jauge sa charge. */
  readonly itemCount: number;
}

export interface OrderStatusChanged extends DomainEventBase {
  readonly name: 'order.status_changed';
  readonly orderId: string;
  readonly orderNumber: OrderNumber;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  /** Qui a fait avancer la commande — exigence de traçabilité NF525. */
  readonly by: string;
}

export interface MenuUpdated extends DomainEventBase {
  readonly name: 'menu.updated';
  /**
   * Produits touchés. Liste vide = la carte entière a changé (réorganisation,
   * import) : l'abonné recharge tout plutôt que de deviner.
   */
  readonly productIds: readonly string[];
}

/**
 * Rupture d'ingrédient — l'événement qui coupe la vente.
 * Le gérant déclare « plus de kefta » une fois, en réserve ; sans diffusion il
 * faudrait le redire à la caisse, au KDS et à la commande en ligne, et c'est
 * toujours la commande en ligne qu'on oublie.
 */
export interface IngredientOutOfStock extends DomainEventBase {
  readonly name: 'stock.ingredient_out';
  readonly ingredientName: string;
  /** Produits devenus invendables — ce que les cartes doivent griser. */
  readonly impactedProductIds: readonly string[];
}

export type DomainEvent =
  | OrderCreated
  | OrderStatusChanged
  | MenuUpdated
  | IngredientOutOfStock;

export type DomainEventName = DomainEvent['name'];

export interface EventPublisher {
  /**
   * Diffuse un fait. Ne lève pas : une panne du bus ne doit pas annuler la
   * commande déjà encaissée — au pire les écrans se rafraîchissent en retard.
   */
  publish(event: DomainEvent): Promise<void>;
}
