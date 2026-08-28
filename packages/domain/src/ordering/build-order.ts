import { Order } from './order';
import { OrderLine } from './order-line';
import type { OrderNumber } from './order-number';
import { UnknownProduct } from '../menu/errors';
import type { MenuItem } from '../menu/menu-item';
import { validateSelection } from '../menu/rules';
import type { OptionSelection } from '../menu/selection';
import type { Clock } from '../shared/clock';
import type { DomainError } from '../shared/errors';
import { err, type Result } from '../shared/result';

/**
 * Ce que demande une surface de prise de commande : des clés, jamais des prix.
 * Le panier du téléphone, le POS et le serveur vocal envoient tous cette forme.
 */
export interface OrderLineRequest {
  readonly productId: string;
  readonly variantKey?: string | null;
  readonly options?: readonly OptionSelection[];
  readonly removals?: readonly string[];
  readonly note?: string | null;
  readonly quantity?: number;
}

export interface BuildOrderContext {
  /** Numéro d'appel attribué par la séquence journalière du restaurant. */
  readonly number: OrderNumber;
  /** Qui saisit : identifiant d'un membre de l'équipe, ou « client » en ligne. */
  readonly openedBy: string;
  readonly clock: Clock;
}

/**
 * Construit une commande complète à partir de la carte servie et du panier.
 *
 * SERVICE PUR : mêmes entrées, même sortie, aucune base de données, aucune
 * horloge implicite. C'est le point de passage obligé où toutes les règles
 * s'appliquent d'un coup — disponibilité, format obligatoire, bornes des
 * groupes d'options, retraits autorisés, prix figé, fusion des lignes.
 *
 * Le prix n'est JAMAIS repris du panier : il est recalculé contre la carte
 * fournie. Un client qui modifierait son panier local n'obtient rien.
 *
 * Au premier refus on s'arrête. Un panier à moitié validé n'a aucun sens pour
 * la personne au comptoir : elle veut savoir quoi corriger, pas ce qui est
 * passé.
 */
export function buildOrder(
  items: readonly MenuItem[],
  selections: readonly OrderLineRequest[],
  context: BuildOrderContext,
): Result<Order, DomainError> {
  const carte = new Map(items.map((item) => [item.id.value, item]));
  const lines: OrderLine[] = [];

  for (const request of selections) {
    const item = carte.get(request.productId);
    if (!item) {
      return err(new UnknownProduct(request.productId));
    }

    const config = validateSelection(
      item,
      request.variantKey ?? null,
      request.options ?? [],
      request.removals ?? [],
    );
    if (!config.ok) return config;

    const line = OrderLine.fromConfiguration(config.value, {
      quantity: request.quantity,
      note: request.note,
    });
    if (!line.ok) return line;

    lines.push(line.value);
  }

  return Order.open({
    number: context.number,
    lines,
    openedBy: context.openedBy,
    clock: context.clock,
  });
}
