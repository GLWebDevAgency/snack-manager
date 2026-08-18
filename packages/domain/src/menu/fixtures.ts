import { MenuItem } from './menu-item';
import { OptionChoice } from './option-choice';
import { OptionGroup, type VariantOverride } from './option-group';
import { ProductId } from './product-id';
import { OptionSelection } from './selection';
import { Variant } from './variant';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';

/**
 * Décor de test : la vraie carte Class'Food, réduite aux produits qui portent
 * une règle. Prix relevés en boutique (juin 2026) — tout le monde dans
 * l'équipe peut vérifier un total de tête contre l'ardoise du comptoir.
 *
 * Fichier de test uniquement : il n'est pas exporté par l'index du paquet.
 */

const cents = (value: number): Money => Money.fromCents(value);

const id = (value: string): ProductId => unwrap(ProductId.create(value));

const variant = (key: string, name: string, price: number): Variant =>
  unwrap(Variant.create({ key, name, price: cents(price) }));

const choice = (key: string, name: string, priceDelta = 0, available = true): OptionChoice =>
  unwrap(OptionChoice.create({ key, name, priceDelta: cents(priceDelta), available }));

const group = (input: {
  key: string;
  name: string;
  mode: 'single' | 'multi';
  min?: number;
  max?: number | null;
  choices: readonly OptionChoice[];
  perVariant?: Record<string, VariantOverride>;
}): OptionGroup => unwrap(OptionGroup.create(input));

/** Raccourci de lecture pour les tests : `pick('viandes', 'kebab')`. */
export const pick = (groupKey: string, choiceKey: string): OptionSelection =>
  unwrap(OptionSelection.create(groupKey, choiceKey));

// ─── Groupes partagés ───

export const viandes = group({
  key: 'viandes',
  name: 'Viandes',
  mode: 'multi',
  min: 1,
  max: 4,
  choices: [
    choice('kebab', 'Kebab'),
    choice('steak', 'Steak'),
    choice('kefta', 'Kefta'),
    choice('poulet', 'Poulet'),
    // Rupture du soir : la carte reste affichée, le choix n'est plus servable.
    choice('cordon-bleu', 'Cordon bleu', 0, false),
  ],
  perVariant: {
    M: { min: 1, max: 1 },
    L: { min: 2, max: 2 },
    XL: { min: 3, max: 3 },
    XXL: { min: 4, max: 4 },
  },
});

/** Deux sauces incluses, la troisième n'est pas prévue par la maison. */
export const sauces = group({
  key: 'sauces',
  name: 'Sauces',
  mode: 'multi',
  min: 0,
  max: 2,
  choices: [
    choice('algerienne', 'Algérienne'),
    choice('blanche', 'Blanche'),
    choice('samourai', 'Samouraï'),
  ],
});

/** Le gratiné : 1,50 € en M/L, 2,00 € en XL/XXL — plus de fromage à couvrir. */
export const gratine = group({
  key: 'gratine',
  name: 'Gratiné',
  mode: 'single',
  min: 0,
  max: 1,
  choices: [choice('gratine', 'Tacos gratiné', 150)],
  perVariant: {
    XL: { priceDelta: cents(200) },
    XXL: { priceDelta: cents(200) },
  },
});

export const supplements = group({
  key: 'supp-1-00',
  name: 'Suppléments +1,00 €',
  mode: 'multi',
  min: 0,
  choices: [choice('cheddar', 'Cheddar', 100), choice('chevre', 'Chèvre', 100)],
});

// ─── Produits ───

export const TACOS_ID = 'tacos';

/** Le produit configurable de référence : quatre formats, quatre règles de viandes. */
export const tacos = unwrap(
  MenuItem.create({
    id: id(TACOS_ID),
    name: 'Compose ton Tacos',
    variants: [
      variant('M', 'M', 890),
      variant('L', 'L', 990),
      variant('XL', 'XL', 1250),
      variant('XXL', 'XXL', 1450),
    ],
    optionGroups: [viandes, gratine, supplements, sauces],
    removables: ['crudités', 'oignons'],
  }),
);

export const TIRAMISU_ID = 'tiramisu';

/** Produit à prix simple, sans format ni option : le cas majoritaire de la carte. */
export const tiramisu = unwrap(
  MenuItem.create({
    id: id(TIRAMISU_ID),
    name: 'Tiramisu',
    price: cents(350),
  }),
);

export const FRITES_ID = 'barquette-frites';

export const frites = unwrap(
  MenuItem.create({
    id: id(FRITES_ID),
    name: 'Barquette de frites',
    variants: [variant('M', 'M', 350), variant('L', 'L', 450)],
  }),
);

export const CROUSTY_ID = 'crousty-one';

/** Plat du jour épuisé : présent en carte, refusé à la commande. */
export const croustyEnRupture = unwrap(
  MenuItem.create({
    id: id(CROUSTY_ID),
    name: 'Crousty One — Riz',
    price: cents(950),
    outOfStock: true,
  }),
);

/** Carte complète telle qu'elle serait servie à `buildOrder`. */
export const carte = [tacos, tiramisu, frites, croustyEnRupture] as const;
