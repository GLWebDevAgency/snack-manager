import { InvalidMenuDefinition } from './errors';
import type { OptionChoice } from './option-choice';
import type { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/** `single` = un seul choix (le gratiné), `multi` = plusieurs (les viandes, les sauces). */
export type SelectionMode = 'single' | 'multi';

/**
 * Dérogation d'un groupe pour UNE variante précise.
 *
 * C'est la règle qui fait vivre la carte Class'Food : le même groupe
 * « Viandes » impose 1 choix sur un tacos M, 2 sur un L, 3 sur un XL et 4 sur
 * un XXL ; le même groupe « Gratiné » se facture 1,50 € en M/L et 2,00 € en
 * XL/XXL. Chaque champ omis retombe sur la valeur du groupe : une dérogation
 * qui ne fixe que le prix ne touche pas aux bornes.
 */
export interface VariantOverride {
  readonly min?: number;
  readonly max?: number;
  readonly priceDelta?: Money;
}

/**
 * Groupe d'options d'un produit : « Viandes », « Sauces », « Suppléments +1,00 € ».
 *
 * `max` vaut `Number.POSITIVE_INFINITY` quand le groupe est illimité — un
 * `null` obligerait chaque appelant à retester, l'infini se compare.
 */
export class OptionGroup {
  private constructor(
    readonly key: string,
    readonly name: string,
    readonly mode: SelectionMode,
    readonly min: number,
    readonly max: number,
    readonly choices: readonly OptionChoice[],
    private readonly overrides: ReadonlyMap<string, VariantOverride>,
  ) {}

  static create(input: {
    key: string;
    name: string;
    mode: SelectionMode;
    min?: number;
    max?: number | null;
    choices: readonly OptionChoice[];
    perVariant?: Readonly<Record<string, VariantOverride>>;
  }): Result<OptionGroup, InvalidMenuDefinition> {
    const key = input.key.trim();
    const name = input.name.trim();

    if (!key) {
      return err(new InvalidMenuDefinition("Un groupe d'options doit avoir une clé"));
    }
    if (!name) {
      return err(new InvalidMenuDefinition(`Le groupe « ${key} » doit avoir un libellé`));
    }
    if (input.choices.length === 0) {
      return err(new InvalidMenuDefinition(`Le groupe « ${name} » ne propose aucun choix`));
    }

    const seen = new Set<string>();
    for (const choice of input.choices) {
      if (seen.has(choice.key)) {
        return err(
          new InvalidMenuDefinition(`Le groupe « ${name} » contient deux fois le choix « ${choice.key} »`),
        );
      }
      seen.add(choice.key);
    }

    const min = input.min ?? 0;
    // Un groupe à choix unique est borné à 1 par nature : ne pas le déduire
    // obligerait à répéter `max: 1` sur chaque groupe « single » de la carte.
    const max = input.max ?? (input.mode === 'single' ? 1 : Number.POSITIVE_INFINITY);

    const bounds = OptionGroup.boundsError(name, min, input.max ?? null);
    if (bounds) return err(bounds);

    if (input.mode === 'single' && max > 1) {
      return err(
        new InvalidMenuDefinition(
          `Le groupe « ${name} » est à choix unique mais en accepte ${max}`,
        ),
      );
    }
    if (min > max) {
      return err(
        new InvalidMenuDefinition(`Bornes incohérentes pour « ${name} » : minimum ${min}, maximum ${max}`),
      );
    }

    const overrides = new Map<string, VariantOverride>();
    for (const [variantKey, rule] of Object.entries(input.perVariant ?? {})) {
      const invalid = OptionGroup.boundsError(
        `${name} / ${variantKey}`,
        rule.min ?? 0,
        rule.max ?? null,
      );
      if (invalid) return err(invalid);
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        return err(
          new InvalidMenuDefinition(
            `Bornes incohérentes pour « ${name} » sur le format « ${variantKey} » : minimum ${rule.min}, maximum ${rule.max}`,
          ),
        );
      }
      overrides.set(variantKey, rule);
    }

    return ok(new OptionGroup(key, name, input.mode, min, max, [...input.choices], overrides));
  }

  /** Les bornes viennent d'une saisie back-office : on refuse « 2,5 viandes » ou « -1 sauce ». */
  private static boundsError(
    label: string,
    min: number,
    max: number | null,
  ): InvalidMenuDefinition | null {
    if (!Number.isInteger(min) || min < 0) {
      return new InvalidMenuDefinition(`Minimum invalide pour « ${label} » : ${min}`);
    }
    if (max !== null && (!Number.isInteger(max) || max < 0)) {
      return new InvalidMenuDefinition(`Maximum invalide pour « ${label} » : ${max}`);
    }
    return null;
  }

  choice(key: string): OptionChoice | undefined {
    return this.choices.find((c) => c.key === key);
  }

  /** Dérogation applicable, ou `undefined` si le produit n'a pas de format. */
  overrideFor(variantKey: string | null): VariantOverride | undefined {
    return variantKey === null ? undefined : this.overrides.get(variantKey);
  }

  /** Formats visés par une dérogation — sert au contrôle de cohérence de la fiche produit. */
  overriddenVariants(): readonly string[] {
    return [...this.overrides.keys()];
  }

  /** Vrai si le groupe doit être renseigné quel que soit le format choisi. */
  isMandatory(): boolean {
    return this.min > 0;
  }
}
