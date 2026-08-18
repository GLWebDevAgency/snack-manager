import type { StaffAuthorization } from './authorization';
import { Discount } from './discount';
import { EmptyOrder, LineNotFound, InvalidDiscount, OrderClosed } from './errors';
import type { OrderLine } from './order-line';
import type { OrderNumber } from './order-number';
import {
  isTerminal,
  mostAdvanced,
  StatusChange,
  transition,
  type OrderStatus,
} from './order-status';
import type { Clock } from '../shared/clock';
import { AuthorizationRequired, type DomainError, IllegalTransition } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * La commande — entité racine du sous-domaine.
 *
 * Elle est la seule à pouvoir répondre à « combien doit le client ? », parce
 * qu'elle seule connaît ses lignes actives ET sa remise. Aucun appelant ne
 * recalcule un total à sa place : c'est exactement l'erreur qui fait qu'un
 * ticket, un écran de caisse et un rapport de fin de journée finissent par
 * afficher trois chiffres différents.
 *
 * Immuable, comme le reste du domaine : chaque opération renvoie une nouvelle
 * commande. Trois surfaces temps réel (caisse, cuisine, suivi client) partagent
 * la même instance en mémoire ; une mutation en place ferait diverger celle qui
 * n'a pas encore rafraîchi.
 */
export class Order {
  private constructor(
    readonly number: OrderNumber,
    readonly lines: readonly OrderLine[],
    readonly status: OrderStatus,
    readonly discount: Discount | null,
    readonly history: readonly StatusChange[],
    private readonly placedAtMs: number,
  ) {}

  /**
   * Ouvre une commande. Les lignes sont fusionnées ici aussi, et pas seulement
   * dans `buildOrder` : quel que soit le chemin d'entrée, l'invariant « deux
   * lignes identiques n'existent jamais côte à côte » tient.
   */
  static open(input: {
    number: OrderNumber;
    lines: readonly OrderLine[];
    openedBy: string;
    clock: Clock;
  }): Result<Order, EmptyOrder> {
    const lines = Order.mergeAll(input.lines);
    if (lines.length === 0) {
      return err(new EmptyOrder());
    }
    if (lines.every((l) => l.isCancelled())) {
      return err(new EmptyOrder('Toutes les lignes de cette commande sont annulées'));
    }

    const opened = StatusChange.record('new', input.openedBy, input.clock);

    return ok(new Order(input.number, lines, 'new', null, [opened], opened.at.getTime()));
  }

  get placedAt(): Date {
    return new Date(this.placedAtMs);
  }

  /** Lignes réellement dues — les annulées restent dans `lines`, jamais dans les totaux. */
  get activeLines(): readonly OrderLine[] {
    return this.lines.filter((l) => !l.isCancelled());
  }

  get subtotal(): Money {
    return Money.sum(this.activeLines.map((l) => l.total));
  }

  /**
   * Remise réellement appliquée, PLAFONNÉE au sous-total.
   *
   * Le cas qui arrive : 5 € de geste commercial sur un ticket à 22 €, puis on
   * annule le tacos à 18 € parce qu'il est tombé. Sans plafond, la caisse
   * devrait 1 € au client.
   */
  get discountAmount(): Money {
    if (!this.discount) return Money.ZERO;

    const subtotal = this.subtotal;
    return this.discount.amount.greaterThan(subtotal) ? subtotal : this.discount.amount;
  }

  get total(): Money {
    return this.subtotal.minus(this.discountAmount);
  }

  /** Nombre d'articles réellement à préparer (quantités comprises). */
  get itemCount(): number {
    return this.activeLines.reduce((sum, l) => sum + l.quantity, 0);
  }

  isClosed(): boolean {
    return isTerminal(this.status);
  }

  /**
   * Ajoute un article. La boisson demandée pendant que la cuisine prépare est
   * un cas courant : on accepte tant que la commande n'est pas clôturée.
   */
  addLine(line: OrderLine): Result<Order, OrderClosed> {
    if (this.isClosed()) {
      return err(new OrderClosed("ajout d'un article"));
    }

    return ok(this.copyWith({ lines: Order.mergeAll([...this.lines, line]) }));
  }

  /**
   * Annule une ligne — elle reste sur le ticket, barrée et motivée.
   * Annuler le dernier article encore dû annule la commande entière : laisser
   * une commande à 0 € en préparation enverrait la cuisine travailler pour rien.
   */
  cancelLine(
    position: number,
    reason: string,
    authorization: StaffAuthorization | null,
    clock: Clock,
  ): Result<Order, DomainError> {
    if (this.isClosed()) {
      return err(new OrderClosed("annulation d'un article"));
    }
    if (!authorization) {
      return err(new AuthorizationRequired('annulation de ligne'));
    }

    const line = this.lines[position];
    if (!line) {
      return err(new LineNotFound(position));
    }

    const cancelled = line.cancel(reason, authorization);
    if (!cancelled.ok) return cancelled;

    const lines = this.lines.map((l, i) => (i === position ? cancelled.value : l));
    const next = this.copyWith({ lines });

    if (next.activeLines.length > 0) return ok(next);

    const change = StatusChange.record('cancelled', authorization.staffId, clock);
    return ok(next.copyWith({ status: 'cancelled', history: [...this.history, change] }));
  }

  /**
   * Applique une remise. Sans PIN vérifié, rien ne passe (`AuthorizationRequired`).
   * Une remise déjà posée est remplacée : le journal d'audit garde les deux, le
   * ticket n'en montre qu'une.
   */
  applyDiscount(input: {
    amount: Money;
    reason: string;
    authorization: StaffAuthorization | null;
    clock: Clock;
  }): Result<Order, DomainError> {
    if (this.isClosed()) {
      return err(new OrderClosed('remise'));
    }

    // Un code tapé il y a un quart d'heure ne vaut plus autorisation : le
    // responsable est reparti en cuisine entre-temps.
    if (input.authorization?.isStale(input.clock)) {
      return err(new AuthorizationRequired('remise'));
    }

    const discount = Discount.create(input);
    if (!discount.ok) return discount;

    const subtotal = this.subtotal;
    if (discount.value.amount.greaterThan(subtotal)) {
      return err(
        new InvalidDiscount(
          `Remise de ${discount.value.amount.format()} supérieure au total de ${subtotal.format()}`,
        ),
      );
    }

    return ok(this.copyWith({ discount: discount.value }));
  }

  /**
   * Avance la commande dans le service.
   * Rejouer le statut courant ne fait rien et ne double pas l'historique : la
   * file hors ligne renvoie régulièrement deux fois le même événement.
   */
  advanceTo(status: OrderStatus, by: string, clock: Clock): Result<Order, IllegalTransition> {
    if (status === this.status) return ok(this);

    const next = transition(this.status, status);
    if (!next.ok) return next;

    return ok(
      this.copyWith({
        status: next.value,
        history: [...this.history, StatusChange.record(next.value, by, clock)],
      }),
    );
  }

  /**
   * Réconcilie avec l'état vu par un autre appareil au retour du réseau.
   *
   * Contrairement à `advanceTo`, on ne rejoue pas la chaîne : la tablette
   * cuisine hors ligne a réellement servi la commande, on constate le fait au
   * lieu de le refuser. C'est `mostAdvanced` qui arbitre.
   */
  reconcile(observed: OrderStatus, by: string, clock: Clock): Order {
    const winner = mostAdvanced(this.status, observed);
    if (winner === this.status) return this;

    return this.copyWith({
      status: winner,
      history: [...this.history, StatusChange.record(winner, by, clock)],
    });
  }

  /** Bon de préparation complet, lignes annulées comprises (elles restent visibles). */
  kitchenTicket(): readonly string[] {
    return this.lines.map((l) => l.kitchenLabel());
  }

  toJSON(): Record<string, unknown> {
    return {
      number: this.number.value,
      status: this.status,
      lines: this.lines.map((l) => l.toJSON()),
      totals: {
        subtotal: this.subtotal.cents,
        discount: this.discount ? this.discount.toJSON() : null,
        total: this.total.cents,
      },
      statusHistory: this.history.map((h) => h.toJSON()),
      placedAt: this.placedAt.toISOString(),
    };
  }

  /**
   * Fusionne les lignes identiques en conservant l'ordre de première apparition.
   * Le client qui ajoute un tacos, puis une boisson, puis le même tacos doit
   * voir « 2× Tacos XXL » en tête de ticket, pas deux lignes séparées : la
   * cuisine en préparerait deux à des moments différents.
   */
  private static mergeAll(lines: readonly OrderLine[]): readonly OrderLine[] {
    const merged: OrderLine[] = [];

    for (const line of lines) {
      const twinIndex = merged.findIndex((l) => l.isSameConfiguration(line));
      const twin = twinIndex >= 0 ? merged[twinIndex] : undefined;

      if (!twin) {
        merged.push(line);
        continue;
      }

      const fused = twin.mergedWith(line);
      // Un dépassement de quantité maximale ne doit pas faire disparaître
      // l'article : on garde deux lignes distinctes plutôt que d'échouer.
      if (fused.ok) merged[twinIndex] = fused.value;
      else merged.push(line);
    }

    return merged;
  }

  private copyWith(changes: {
    lines?: readonly OrderLine[];
    status?: OrderStatus;
    discount?: Discount | null;
    history?: readonly StatusChange[];
  }): Order {
    return new Order(
      this.number,
      changes.lines ?? this.lines,
      changes.status ?? this.status,
      changes.discount !== undefined ? changes.discount : this.discount,
      changes.history ?? this.history,
      this.placedAtMs,
    );
  }
}
