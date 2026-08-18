import { err, ok, type Result } from '../shared/result';
import { IncompatibleUnits, InvalidQuantity } from './errors';

/**
 * Quantités et unités du coût matière.
 *
 * Un ingrédient s'achète dans son unité de BASE (le kilo de viande, le litre
 * d'huile, la pièce de galette) mais se pèse en recette dans l'unité pratique
 * du terrain (150 g de viande, 20 ml de sauce). Toute la difficulté est là :
 * multiplier 150 par un prix au kilo donne un tacos à 1 900 €.
 *
 * D'où deux garde-fous : la conversion vers l'unité de base est systématique,
 * et le passage d'une dimension à une autre est refusé — convertir des grammes
 * en litres exigerait la densité de l'ingrédient, que personne ne saisit.
 */

/** Unité d'achat d'un ingrédient : le coût s'exprime toujours par unité de base. */
export const BASE_UNITS = ['kg', 'l', 'pcs'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

/** Unité de pesée d'une ligne de recette. */
export const MEASURE_UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** Grandeur physique : on ne convertit qu'à l'intérieur d'une même dimension. */
export type Dimension = 'masse' | 'volume' | 'pièce';

const DIMENSIONS: Readonly<Record<MeasureUnit, Dimension>> = {
  g: 'masse',
  kg: 'masse',
  ml: 'volume',
  l: 'volume',
  pcs: 'pièce',
};

const BASE_OF: Readonly<Record<Dimension, BaseUnit>> = {
  masse: 'kg',
  volume: 'l',
  pièce: 'pcs',
};

/** Combien d'unités de mesure dans une unité de base (1 kg = 1000 g). */
const PER_BASE: Readonly<Record<MeasureUnit, number>> = {
  g: 1000,
  kg: 1,
  ml: 1000,
  l: 1,
  pcs: 1,
};

export const UNIT_LABELS: Readonly<Record<MeasureUnit, string>> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  pcs: 'pièce',
};

export const dimensionOf = (unit: MeasureUnit): Dimension => DIMENSIONS[unit];
export const baseUnitOf = (unit: MeasureUnit): BaseUnit => BASE_OF[DIMENSIONS[unit]];

export function isMeasureUnit(value: string): value is MeasureUnit {
  return (MEASURE_UNITS as readonly string[]).includes(value);
}

/**
 * Arrondi au millionième.
 *
 * 150 / 1000 * 1000 vaut 150.00000000000003 en flottant : sans ce rabotage, la
 * fiche recette afficherait « 150,00000000000003 g de viande ». Les montants,
 * eux, restent en centimes entiers (cf. `Money`) — on n'arrondit ici que des
 * grandeurs physiques, où le millionième de gramme n'existe pas.
 */
const trim = (value: number): number => Math.round(value * 1e6) / 1e6;

export class Quantity {
  private constructor(
    readonly value: number,
    readonly unit: MeasureUnit,
  ) {}

  static of(value: number, unit: MeasureUnit): Result<Quantity, InvalidQuantity> {
    if (!Number.isFinite(value)) {
      return err(new InvalidQuantity(`Quantité illisible : « ${String(value)} »`));
    }
    if (value <= 0) {
      // Une ligne à 0 n'est jamais un choix : c'est une ligne qu'on a oublié de
      // supprimer, et elle fausse la lecture de la fiche recette.
      return err(
        new InvalidQuantity(
          `La quantité doit être strictement positive (${value} ${UNIT_LABELS[unit]})`,
        ),
      );
    }
    return ok(new Quantity(trim(value), unit));
  }

  get dimension(): Dimension {
    return dimensionOf(this.unit);
  }

  /** Même grandeur physique ? Condition de toute conversion et de toute somme. */
  isCompatibleWith(unit: MeasureUnit): boolean {
    return this.dimension === dimensionOf(unit);
  }

  /** Ramenée à l'unité d'achat : 150 g → 0,15 kg. */
  toBase(): Quantity {
    const base = baseUnitOf(this.unit);
    return new Quantity(trim(this.value / PER_BASE[this.unit]), base);
  }

  /** Valeur numérique en unité d'achat — ce par quoi on multiplie un coût. */
  baseValue(): number {
    return this.toBase().value;
  }

  in(unit: MeasureUnit): Result<Quantity, IncompatibleUnits> {
    if (!this.isCompatibleWith(unit)) {
      return err(
        new IncompatibleUnits(
          `On ne convertit pas des ${UNIT_LABELS[this.unit]} en ${UNIT_LABELS[unit]} : la densité dépend de l'ingrédient.`,
        ),
      );
    }
    return ok(new Quantity(trim(this.baseValue() * PER_BASE[unit]), unit));
  }

  /** Somme deux quantités — le résultat garde l'unité de la première. */
  plus(other: Quantity): Result<Quantity, IncompatibleUnits> {
    const converted = other.in(this.unit);
    if (!converted.ok) return converted;
    return ok(new Quantity(trim(this.value + converted.value.value), this.unit));
  }

  times(factor: number): Result<Quantity, InvalidQuantity> {
    return Quantity.of(this.value * factor, this.unit);
  }

  equals(other: Quantity): boolean {
    if (!this.isCompatibleWith(other.unit)) return false;
    return this.baseValue() === other.baseValue();
  }

  /** « 150 g », « 1,5 kg », « 2 pièces » — décimale française. */
  format(): string {
    const number = String(this.value).replace('.', ',');
    if (this.unit === 'pcs') return `${number} pièce${this.value > 1 ? 's' : ''}`;
    return `${number} ${this.unit}`;
  }

  toString(): string {
    return this.format();
  }
}
