import type { StaffAuthorization } from './authorization';
import { InvalidOrderLine } from './errors';
import type { ProductId } from '../menu/product-id';
import type { ValidatedConfiguration } from '../menu/rules';
import type { SelectedOption } from '../menu/selection';
import { AuthorizationRequired, type DomainError, invariant } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Trace d'annulation d'une ligne.
 * Une ligne annulée ne DISPARAÎT jamais : elle reste imprimée, barrée, avec son
 * motif et son valideur. C'est la différence entre « le client a changé d'avis »
 * et « il manque un tacos dans la caisse ».
 */
export interface LineCancellation {
  readonly reason: string;
  readonly authorization: StaffAuthorization;
}

/**
 * Une ligne de commande — value object immuable.
 *
 * Elle recopie tout ce dont le ticket a besoin : nom du produit, libellé du
 * format, libellés des options, retraits, et surtout le PRIX UNITAIRE FIGÉ au
 * moment de la commande. La carte peut changer dix minutes plus tard, le tacos
 * de 20 h 14 reste facturé au tarif de 20 h 14. Une ligne qui renverrait vers
 * la carte courante réécrirait l'histoire à chaque changement de prix — et
 * l'archive comptable avec.
 *
 * Toute modification renvoie une NOUVELLE ligne : l'ancienne reste comparable
 * telle quelle dans les tests et dans les journaux.
 */
export class OrderLine {
  private constructor(
    readonly productId: ProductId,
    readonly productName: string,
    readonly variantKey: string | null,
    readonly variantName: string | null,
    readonly options: readonly SelectedOption[],
    readonly removals: readonly string[],
    readonly note: string | null,
    readonly quantity: number,
    readonly unitPrice: Money,
    readonly cancellation: LineCancellation | null,
  ) {}

  /** Au-delà, c'est une faute de frappe au clavier de la caisse, pas une commande. */
  static readonly MAX_QUANTITY = 99;

  /** Une note plus longue ne tient pas sur un ticket 80 mm et personne ne la lit. */
  static readonly MAX_NOTE_LENGTH = 200;

  /**
   * Fabrique de référence — sert aussi bien à la prise de commande qu'à la
   * relecture d'un ticket archivé, d'où le prix passé en paramètre plutôt que
   * recalculé depuis la carte du jour.
   */
  static create(input: {
    productId: ProductId;
    productName: string;
    variantKey?: string | null;
    variantName?: string | null;
    options?: readonly SelectedOption[];
    removals?: readonly string[];
    note?: string | null;
    quantity?: number;
    unitPrice: Money;
    cancellation?: LineCancellation | null;
  }): Result<OrderLine, InvalidOrderLine> {
    const productName = input.productName.trim();
    if (!productName) {
      return err(new InvalidOrderLine('Une ligne de commande doit porter le nom du produit'));
    }

    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return err(new InvalidOrderLine(`Quantité invalide : ${quantity}`));
    }
    if (quantity > OrderLine.MAX_QUANTITY) {
      return err(
        new InvalidOrderLine(
          `Quantité trop élevée : ${quantity} (maximum ${OrderLine.MAX_QUANTITY} par ligne)`,
        ),
      );
    }

    if (input.unitPrice.isNegative()) {
      return err(new InvalidOrderLine(`Prix unitaire négatif : ${input.unitPrice.format()}`));
    }

    const note = (input.note ?? '').trim();
    if (note.length > OrderLine.MAX_NOTE_LENGTH) {
      return err(
        new InvalidOrderLine(
          `Note trop longue (${note.length} caractères, ${OrderLine.MAX_NOTE_LENGTH} au maximum)`,
        ),
      );
    }

    return ok(
      new OrderLine(
        input.productId,
        productName,
        input.variantKey ?? null,
        input.variantName ?? null,
        [...(input.options ?? [])],
        [...(input.removals ?? [])],
        note === '' ? null : note,
        quantity,
        input.unitPrice,
        input.cancellation ?? null,
      ),
    );
  }

  /** Chemin normal : une configuration déjà confrontée à la carte devient une ligne. */
  static fromConfiguration(
    config: ValidatedConfiguration,
    input: { quantity?: number; note?: string | null } = {},
  ): Result<OrderLine, InvalidOrderLine> {
    return OrderLine.create({
      productId: config.item.id,
      productName: config.item.name,
      variantKey: config.variant?.key ?? null,
      variantName: config.variant?.name ?? null,
      options: config.options,
      removals: config.removals,
      note: input.note ?? null,
      quantity: input.quantity ?? 1,
      unitPrice: config.unitPrice,
    });
  }

  isCancelled(): boolean {
    return this.cancellation !== null;
  }

  /** Une ligne annulée ne pèse plus rien dans le total, mais reste sur le ticket. */
  get total(): Money {
    return this.isCancelled() ? Money.ZERO : this.unitPrice.times(this.quantity);
  }

  /**
   * Annule la ligne sans l'effacer.
   * Le PIN est exigé ici comme pour une remise : retirer un article encaissé
   * diminue la recette, NF525 veut savoir qui l'a décidé et pourquoi.
   */
  cancel(reason: string, authorization: StaffAuthorization | null): Result<OrderLine, DomainError> {
    if (this.isCancelled()) {
      return err(new InvalidOrderLine(`« ${this.label()} » est déjà annulée`));
    }
    if (!authorization) {
      return err(new AuthorizationRequired('annulation de ligne'));
    }

    const motive = reason.trim();
    if (!motive) {
      return err(new InvalidOrderLine("Motif d'annulation obligatoire"));
    }

    return ok(this.copyWith({ cancellation: { reason: motive, authorization } }));
  }

  withQuantity(quantity: number): Result<OrderLine, InvalidOrderLine> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      return err(new InvalidOrderLine(`Quantité invalide : ${quantity}`));
    }
    if (quantity > OrderLine.MAX_QUANTITY) {
      return err(
        new InvalidOrderLine(
          `Quantité trop élevée : ${quantity} (maximum ${OrderLine.MAX_QUANTITY} par ligne)`,
        ),
      );
    }

    return ok(this.copyWith({ quantity }));
  }

  /**
   * Empreinte de fusion : produit + format + options + retraits + note.
   *
   * Les options sont triées mais PAS dédoublonnées — « kebab, kebab, steak,
   * kefta » sur un XXL n'est pas la même chose que « kebab, steak, kefta » sur
   * le même XXL, et les deux se facturent différemment. Cliquer deux fois sur
   * « Kebab » puis une fois sur « Steak », ou l'inverse, donne en revanche bien
   * la même ligne.
   */
  fingerprint(): string {
    return [
      this.productId.value,
      this.variantKey ?? '',
      [...this.options.map((o) => o.identity())].sort().join('|'),
      [...this.removals].sort().join('|'),
      this.note ?? '',
    ].join('#');
  }

  /**
   * Deux lignes fusionnables ?
   * Une ligne annulée ne fusionne JAMAIS : l'absorber dans une ligne active
   * ferait disparaître l'annulation du ticket, exactement ce qu'on interdit.
   */
  isSameConfiguration(other: OrderLine): boolean {
    if (this.isCancelled() || other.isCancelled()) return false;
    return this.fingerprint() === other.fingerprint();
  }

  /** Fusionne deux lignes identiques en additionnant les quantités. */
  mergedWith(other: OrderLine): Result<OrderLine, InvalidOrderLine> {
    // Fusionner deux configurations différentes changerait ce que reçoit le
    // client : c'est un bug d'appelant, pas un cas métier.
    invariant(this.isSameConfiguration(other), 'fusion de deux lignes de configurations différentes');

    return this.withQuantity(this.quantity + other.quantity);
  }

  /** « Compose ton Tacos XXL » — ce que la caisse affiche dans la liste. */
  label(): string {
    return this.variantName ? `${this.productName} ${this.variantName}` : this.productName;
  }

  /**
   * Ligne du bon de préparation. Les retraits y figurent au même titre que les
   * options : « sans oignons » qui n'arrive pas jusqu'au plan de travail, c'est
   * une assiette refaite et un client qui attend le double.
   */
  kitchenLabel(): string {
    const parts = [`${this.quantity}× ${this.label()}`];

    if (this.options.length > 0) {
      parts.push(this.options.map((o) => o.choiceName).join(', '));
    }
    if (this.removals.length > 0) {
      parts.push(this.removals.map((r) => `sans ${r}`).join(', '));
    }
    if (this.note) {
      parts.push(`« ${this.note} »`);
    }
    if (this.cancellation) {
      parts.push(`ANNULÉE — ${this.cancellation.reason}`);
    }

    return parts.join(' · ');
  }

  private copyWith(changes: { quantity?: number; cancellation?: LineCancellation | null }): OrderLine {
    return new OrderLine(
      this.productId,
      this.productName,
      this.variantKey,
      this.variantName,
      this.options,
      this.removals,
      this.note,
      changes.quantity ?? this.quantity,
      this.unitPrice,
      changes.cancellation ?? this.cancellation,
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      productId: this.productId.value,
      name: this.productName,
      variantKey: this.variantKey,
      variantName: this.variantName,
      options: this.options.map((o) => o.toJSON()),
      removed: this.removals,
      note: this.note,
      qty: this.quantity,
      unitPrice: this.unitPrice.cents,
      lineTotal: this.total.cents,
      cancelled: this.isCancelled() ? this.cancellation?.reason : null,
    };
  }
}
