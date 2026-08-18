import { InvalidMoney, invariant } from './errors';
import { err, ok, type Result } from './result';

/**
 * Montant monétaire — value object central du domaine.
 *
 * Toujours en CENTIMES entiers : les flottants sont interdits en comptabilité
 * (0.1 + 0.2 ≠ 0.3, et une caisse certifiée NF525 ne peut pas se permettre un
 * centime d'écart). Immuable : toute opération retourne une nouvelle instance.
 *
 *   Money.fromCents(950).plus(Money.fromCents(150)).format() // « 11,00 € »
 */
export class Money {
  private constructor(readonly cents: number) {
    invariant(Number.isInteger(cents), `montant non entier : ${cents}`);
  }

  static readonly ZERO = new Money(0);

  /** Construit depuis des centimes déjà connus valides (base de données). */
  static fromCents(cents: number): Money {
    invariant(Number.isInteger(cents), `montant non entier : ${cents}`);
    return new Money(cents);
  }

  /** Construit depuis une saisie utilisateur (« 9,50 », « 9.5 », 9.5). */
  static parse(input: string | number): Result<Money, InvalidMoney> {
    const raw =
      typeof input === 'number'
        ? input
        : Number(input.replace(/[€\s]/g, '').replace(',', '.'));

    if (!Number.isFinite(raw)) {
      return err(new InvalidMoney(`Montant illisible : « ${String(input)} »`));
    }
    // Arrondi au centime le plus proche : la saisie décimale est une intention
    // humaine, la représentation interne reste entière.
    return ok(new Money(Math.round(raw * 100)));
  }

  /** Somme d'une liste — évite les réductions manuelles éparpillées. */
  static sum(amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((acc, m) => acc.plus(m), Money.ZERO);
  }

  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  minus(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  /** Multiplication par une quantité entière (une ligne de commande). */
  times(quantity: number): Money {
    invariant(Number.isInteger(quantity) && quantity >= 0, `quantité invalide : ${quantity}`);
    return new Money(this.cents * quantity);
  }

  /** Pourcentage (remise) — arrondi au centime, au profit du client. */
  percent(rate: number): Money {
    invariant(rate >= 0 && rate <= 100, `taux hors bornes : ${rate}`);
    return new Money(Math.floor((this.cents * rate) / 100));
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  greaterThan(other: Money): boolean {
    return this.cents > other.cents;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /** Part que représente ce montant dans un autre, en % à une décimale. */
  ratioOf(total: Money): number {
    if (total.isZero()) return 0;
    return Math.round((this.cents / total.cents) * 1000) / 10;
  }

  /** « 9,50 € » — format français, séparateur virgule. */
  format(): string {
    const sign = this.cents < 0 ? '-' : '';
    const abs = Math.abs(this.cents);
    return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')} €`;
  }

  toJSON(): number {
    return this.cents;
  }
}
