/**
 * L'état de la démonstration — entièrement en mémoire, entièrement au visiteur.
 *
 * ─── POURQUOI PAS DE BASE DE DONNÉES ───
 *
 * La démonstration ne crée AUCUN restaurant de démonstration côté serveur, et
 * la décision n'est pas une commodité de développement : un tenant de vitrine
 * apparaîtrait dans le CRM comme un client (MRR, compteurs, score de santé),
 * deux visiteurs simultanés se marcheraient dessus, et surtout ses commandes
 * entreraient dans la MÉDIANE RÉSEAU qui alimente le conseil chiffré vendu aux
 * restaurateurs. On vendrait du conseil calculé sur des clics d'inconnus.
 *
 * Chaque visiteur a donc la sienne, neuve. Il peut tout casser : un
 * rechargement remet à zéro, parce qu'il n'y a rien à remettre à zéro.
 */
import { basePrice, ruleFor } from '../pricing';
import { SUPPLEMENT_GROUP, type Menu, type Order, type Product } from '../types';
import { demoMenu, demoSeedOrders, indexProducts, type SnapshotOrder } from './fixture';

/** Refus servi au client avec le statut HTTP qu'aurait rendu l'API. */
export class DemoRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SelectedOptionInput {
  groupKey: string;
  choiceKey: string;
}

export interface LineInput {
  productId: string;
  variantKey?: string | null;
  options: SelectedOptionInput[];
  removed?: string[];
  note?: string | null;
  qty: number;
}

export interface PricedLine {
  name: string;
  variantName: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  unitPrice: number;
}

export interface DemoState {
  menu: Menu;
  products: Map<string, Product>;
  orders: Order[];
  /** Séquence des numéros de retrait, comme le compteur journalier du serveur. */
  nextNumber: number;
}

/**
 * Chiffrage d'une ligne — la transcription fidèle de `OrdersService.create`.
 *
 * Le prix ne vient JAMAIS de ce que la caisse a envoyé : il est résolu depuis
 * la carte, exactement comme le fait le serveur. C'est ce qui rend la
 * démonstration probante — le visiteur voit le prix se recalculer, y compris
 * la dérogation par variante (le tacos gratiné vaut 1,50 € en M/L et 2,00 € en
 * XL/XXL), et non un total recopié de l'écran.
 */
export function priceLine(products: Map<string, Product>, line: LineInput): PricedLine {
  const product = products.get(line.productId);
  if (!product) throw new DemoRefusal(404, `Produit ${line.productId} introuvable`);
  if (product.outOfStock) throw new DemoRefusal(409, `« ${product.name} » est en rupture`);

  let variantName: string | null = null;
  if (product.variants?.length) {
    const variant = product.variants.find((v) => v.key === line.variantKey);
    if (!variant) throw new DemoRefusal(400, `Variante requise pour « ${product.name} »`);
    variantName = variant.name;
  }

  let unitPrice = basePrice(product, line.variantKey ?? null);
  const options = line.options.map((sel) => {
    // Le groupe « supplements » ne figure pas dans `optionGroups` de la carte
    // publique : l'API le retire et expose `supplements` à part (ingrédients
    // tarifés dérivés de la recette). On le résout donc là où il est.
    if (sel.groupKey === SUPPLEMENT_GROUP) {
      const supplement = product.supplements?.find((s) => s.key === sel.choiceKey);
      if (!supplement) throw new DemoRefusal(400, `Option inconnue pour « ${product.name} »`);
      unitPrice += supplement.priceCents;
      return {
        groupKey: SUPPLEMENT_GROUP,
        choiceKey: supplement.key,
        name: supplement.label,
        priceDelta: supplement.priceCents,
      };
    }
    const group = product.optionGroups?.find((g) => g.key === sel.groupKey);
    const choice = group?.choices.find((c) => c.key === sel.choiceKey);
    if (!group || !choice) throw new DemoRefusal(400, `Option inconnue pour « ${product.name} »`);
    const priceDelta = ruleFor(group, line.variantKey ?? null).priceDelta ?? choice.priceDelta;
    unitPrice += priceDelta;
    return { groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta };
  });

  // Groupes obligatoires : le minimum effectif dépend de la variante choisie.
  for (const group of product.optionGroups ?? []) {
    const { min, max } = ruleFor(group, line.variantKey ?? null);
    const count = options.filter((o) => o.groupKey === group.key).length;
    if (count < min || count > max) {
      const expected = min === max ? String(min) : `${min}–${max === Infinity ? '∞' : max}`;
      throw new DemoRefusal(
        400,
        `« ${group.name} » : ${expected} choix attendu(s) pour « ${product.name} »`,
      );
    }
  }

  return { name: product.name, variantName, options, unitPrice };
}

/**
 * Une démonstration neuve : la carte photographiée et un service déjà entamé.
 *
 * Le visiteur ne doit pas tomber sur une cuisine vide — un écran sans ticket ne
 * montre rien de ce que le produit sait faire. Il arrive au milieu d'un coup de
 * feu, avec des commandes à trois statuts différents.
 */
export function createDemoState(now = Date.now()): DemoState {
  const menu = demoMenu();
  const products = indexProducts(menu);
  const price = (line: SnapshotOrder['lines'][number]): PricedLine =>
    priceLine(products, line);
  const orders = demoSeedOrders(price, now, 1);
  return {
    menu,
    products,
    orders,
    nextNumber: orders.reduce((max, o) => Math.max(max, o.number), 0) + 1,
  };
}
