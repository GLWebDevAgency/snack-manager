import { IllegalTransition, invariant } from '../shared/errors';
import type { Clock } from '../shared/clock';
import { err, ok, type Result } from '../shared/result';

/**
 * Cycle de vie d'une commande, du ticket qui tombe à l'assiette servie.
 *
 * Machine à états EXPLICITE plutôt qu'un champ libre : sur le terrain, trois
 * écrans touchent le même statut en même temps (la caisse, la tablette cuisine,
 * le suivi client). Sans transitions déclarées, un double-tap sur « Prête »
 * pendant que la caisse encaisse fait reculer la commande, et le client repart
 * sans son tacos.
 */
export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'delivered', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Transitions autorisées.
 *
 * La chaîne de service est linéaire : on ne saute pas « en préparation », même
 * pour une canette — c'est la seule façon pour la cuisine de savoir ce qui est
 * réellement en cours. L'annulation reste ouverte tant que rien n'est servi.
 */
const ALLOWED: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  // Servie ou annulée : plus rien ne bouge. Une correction passe par un
  // remboursement tracé, pas par un retour en arrière du statut.
  delivered: [],
  cancelled: [],
};

/**
 * Avancement dans le service. `cancelled` n'y figure PAS : ce n'est pas une
 * étape de plus, c'est une sortie de piste. Le ranger « après livrée » ferait
 * gagner l'annulation contre une commande déjà partie.
 */
const PROGRESS: Readonly<Record<Exclude<OrderStatus, 'cancelled'>, number>> = {
  new: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
};

export function isTerminal(status: OrderStatus): boolean {
  return ALLOWED[status].length === 0;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Étape suivante du service, ou `null` si la commande est terminée. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  return status === 'new' ? 'preparing' : status === 'preparing' ? 'ready' : status === 'ready' ? 'delivered' : null;
}

export function transition(from: OrderStatus, to: OrderStatus): Result<OrderStatus, IllegalTransition> {
  if (!canTransition(from, to)) {
    return err(new IllegalTransition(label(from), label(to)));
  }
  return ok(to);
}

/**
 * Réconciliation hors ligne — le statut le plus avancé l'emporte.
 *
 * Le cas réel : la box internet du snack tombe en plein coup de feu. La
 * tablette cuisine continue de marquer « prête », la caisse continue
 * d'encaisser, et chacune rejoue sa file au retour du réseau, dans le
 * désordre. Rejouer bêtement ferait reculer la commande.
 *
 * Deux exceptions à « le plus avancé gagne », toutes deux dictées par le
 * comptoir plutôt que par la théorie :
 *  - une annulation bat n'importe quelle étape en cours (quelqu'un a
 *    physiquement décidé de ne pas servir : c'est une décision humaine, elle
 *    prime sur un automatisme) ;
 *  - mais elle ne bat pas « livrée » : le plat est parti, l'argent est encaissé.
 *    L'effacer du chiffre d'affaires serait un trou de caisse.
 */
export function mostAdvanced(a: OrderStatus, b: OrderStatus): OrderStatus {
  if (a === b) return a;

  if (a === 'cancelled' || b === 'cancelled') {
    return a === 'delivered' || b === 'delivered' ? 'delivered' : 'cancelled';
  }

  return PROGRESS[a] >= PROGRESS[b] ? a : b;
}

/** Libellé utilisateur — les messages d'erreur sortent tels quels à l'écran. */
export function label(status: OrderStatus): string {
  switch (status) {
    case 'new':
      return 'nouvelle';
    case 'preparing':
      return 'en préparation';
    case 'ready':
      return 'prête';
    case 'delivered':
      return 'servie';
    case 'cancelled':
      return 'annulée';
  }
}

/**
 * Une ligne de l'historique de statuts.
 *
 * NF525 impose de savoir QUI a fait QUOI et QUAND : l'historique n'est pas un
 * confort de débogage, c'est la pièce qu'on présente en cas de contrôle.
 * L'instant vient de l'horloge injectée, jamais de `Date.now()`.
 */
export class StatusChange {
  private constructor(
    readonly status: OrderStatus,
    private readonly atMs: number,
    readonly by: string,
  ) {}

  static record(status: OrderStatus, by: string, clock: Clock): StatusChange {
    const actor = by.trim();
    // Un changement de statut sans auteur signale un appelant qui a perdu sa
    // session : c'est un bug de code, pas une saisie utilisateur.
    invariant(actor.length > 0, 'changement de statut sans auteur');

    return new StatusChange(status, clock.now().getTime(), actor);
  }

  /** Copie défensive : une `Date` est mutable, l'historique ne doit pas l'être. */
  get at(): Date {
    return new Date(this.atMs);
  }

  toJSON(): { status: OrderStatus; at: string; by: string } {
    return { status: this.status, at: new Date(this.atMs).toISOString(), by: this.by };
  }
}
