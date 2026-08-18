import { InvalidMenuDefinition, RemovalNotAllowed, UnknownOption } from './errors';
import type { MenuItem } from './menu-item';
import type { OptionGroup } from './option-group';
import { SelectedOption, type OptionSelection } from './selection';
import type { Variant } from './variant';
import type { DomainError } from '../shared/errors';
import { OptionRuleViolated, ProductUnavailable } from '../shared/errors';
import { Money } from '../shared/money';
import { err, map, ok, type Result } from '../shared/result';

/**
 * Règles de configuration et de prix d'un produit.
 *
 * Fonctions PURES, hors des entités : ce sont des politiques tarifaires, elles
 * changent pour d'autres raisons que la structure de la carte (une promotion,
 * une TVA, un happy hour). `MenuItem` décrit ce qui existe, ce module décide ce
 * qui est permis et ce que ça coûte.
 */

/** Bornes et supplément réellement applicables à un groupe, format compris. */
export interface EffectiveRule {
  readonly min: number;
  /** `Number.POSITIVE_INFINITY` quand le groupe est illimité. */
  readonly max: number;
  /** `null` = pas de dérogation, chaque choix garde son propre supplément. */
  readonly priceDelta: Money | null;
}

/**
 * Configuration validée : tout ce qu'il faut pour facturer ET pour cuisiner.
 * C'est le seul objet dont une ligne de commande a besoin.
 */
export interface ValidatedConfiguration {
  readonly item: MenuItem;
  readonly variant: Variant | null;
  readonly options: readonly SelectedOption[];
  /** Libellés canoniques des retraits, dans l'ordre de saisie. */
  readonly removals: readonly string[];
  readonly unitPrice: Money;
}

/**
 * Règle effective d'un groupe pour un format donné.
 *
 * La dérogation de variante prime champ par champ : le groupe « Gratiné » ne
 * fixe qu'un prix sur XL/XXL, ses bornes (0 à 1) restent celles du groupe.
 * `??` et non `||` : une dérogation `{ min: 0, max: 0 }` (le Class Bowl
 * « Veggi », sans viande) doit bien interdire toute viande, pas retomber sur
 * les bornes générales.
 */
export function resolveRule(group: OptionGroup, variantKey: string | null): EffectiveRule {
  const override = group.overrideFor(variantKey);

  return {
    min: override?.min ?? group.min,
    max: override?.max ?? group.max,
    priceDelta: override?.priceDelta ?? null,
  };
}

/**
 * Confronte une configuration à la carte et renvoie de quoi facturer.
 *
 * Ordre des contrôles choisi pour l'utilisateur : on annonce la rupture avant
 * de reprocher un format manquant, et le format avant les options — inutile de
 * dire « 4 viandes attendues » à quelqu'un qui n'a pas encore choisi sa taille.
 */
export function validateSelection(
  item: MenuItem,
  variantKey: string | null,
  selections: readonly OptionSelection[],
  removals: readonly string[] = [],
): Result<ValidatedConfiguration, DomainError> {
  if (!item.isAvailable()) {
    return err(new ProductUnavailable(item.name));
  }

  const base = item.basePriceFor(variantKey);
  if (!base.ok) return base;

  const resolved = resolveOptions(item, variantKey, selections);
  if (!resolved.ok) return resolved;

  const bounds = checkBounds(item, variantKey, resolved.value);
  if (bounds) return err(bounds);

  const canonicalRemovals = resolveRemovals(item, removals);
  if (!canonicalRemovals.ok) return canonicalRemovals;

  const unitPrice = base.value.plus(Money.sum(resolved.value.map((o) => o.priceDelta)));
  if (unitPrice.isNegative()) {
    // Des suppléments négatifs mal saisis peuvent rendre un produit « payant à
    // l'envers ». On refuse d'encaisser un montant négatif : la caisse ne rend
    // pas la monnaie d'un plat.
    return err(
      new InvalidMenuDefinition(
        `Le prix calculé de « ${item.name} » est négatif : ${unitPrice.format()}`,
      ),
    );
  }

  return ok({
    item,
    variant: item.variant(variantKey) ?? null,
    options: resolved.value,
    removals: canonicalRemovals.value,
    unitPrice,
  });
}

/**
 * Prix unitaire d'une configuration : prix du format + suppléments effectifs.
 *
 * Un tacos XXL gratiné avec un cheddar : 14,50 € + 2,00 € (dérogation XXL,
 * pas les 1,50 € du choix) + 1,00 € = 17,50 €.
 */
export function priceOf(
  item: MenuItem,
  variantKey: string | null,
  selections: readonly OptionSelection[],
): Result<Money, DomainError> {
  return map(validateSelection(item, variantKey, selections), (config) => config.unitPrice);
}

// ─── Détail des contrôles ───

/** Existence, disponibilité et supplément réel de chaque option cochée. */
function resolveOptions(
  item: MenuItem,
  variantKey: string | null,
  selections: readonly OptionSelection[],
): Result<readonly SelectedOption[], DomainError> {
  const resolved: SelectedOption[] = [];

  for (const selection of selections) {
    const group = item.group(selection.groupKey);
    if (!group) {
      return err(new UnknownOption(item.name, `groupe « ${selection.groupKey} »`));
    }

    const choice = group.choice(selection.choiceKey);
    if (!choice) {
      return err(new UnknownOption(item.name, `« ${selection.choiceKey} » dans « ${group.name} »`));
    }
    if (!choice.isAvailable()) {
      return err(new ProductUnavailable(choice.name));
    }

    // La dérogation de format écrase le supplément du choix : c'est elle qui
    // porte le « gratiné à 2,00 € sur les grands formats ».
    const delta = resolveRule(group, variantKey).priceDelta ?? choice.priceDelta;
    resolved.push(SelectedOption.resolve(group, choice, delta));
  }

  return ok(resolved);
}

/**
 * Bornes de CHAQUE groupe du produit, pas seulement de ceux qui ont été
 * cochés : c'est ainsi qu'un tacos commandé sans viande est refusé.
 *
 * On compte les occurrences sans dédoublonner : un XXL à quatre viandes peut
 * légitimement être « kebab, kebab, steak, kefta ». Deux fois le même
 * ingrédient est une commande courante, pas une erreur de saisie.
 */
function checkBounds(
  item: MenuItem,
  variantKey: string | null,
  resolved: readonly SelectedOption[],
): OptionRuleViolated | null {
  for (const group of item.optionGroups) {
    const rule = resolveRule(group, variantKey);
    const count = resolved.filter((o) => o.groupKey === group.key).length;

    if (count < rule.min || count > rule.max) {
      return new OptionRuleViolated(group.name, rule.min, rule.max, count);
    }
  }

  return null;
}

/** Chaque retrait doit être prévu par la fiche produit, et n'être compté qu'une fois. */
function resolveRemovals(
  item: MenuItem,
  removals: readonly string[],
): Result<readonly string[], RemovalNotAllowed> {
  const canonical: string[] = [];

  for (const raw of removals) {
    const label = item.canonicalRemoval(raw);
    if (!label) {
      return err(new RemovalNotAllowed(item.name, raw.trim()));
    }
    if (!canonical.includes(label)) canonical.push(label);
  }

  return ok(canonical);
}
