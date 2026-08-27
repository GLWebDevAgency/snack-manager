import { describe, expect, it } from 'vitest';
import { SUPPLEMENT_GROUP_KEY } from '@sm/contracts';
import { SupplyService } from '../supply/supply.service';
import { MenuService } from './menu.service';

/**
 * La carte servie au POS et à la commande en ligne porte désormais deux blocs
 * dérivés de la recette : les retraits réellement pertinents et les suppléments
 * payants. Le groupe d'options réservé, lui, reste hors de `optionGroups` — il
 * n'existe que pour faire foi sur le prix côté serveur.
 *
 * Exigence de service : Postgres coupé, la caisse doit continuer à vendre.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const PRODUIT = '665f0d0a1c2b3d4e5f6a7b8c';
const CATEGORIE = '665f0d0a1c2b3d4e5f6a7b70';

const RECETTE = [
  { productRef: PRODUIT, ingredientId: 'i-pain', name: 'Pain sandwich', displayName: null, category: 'pain', removable: false, supplementPriceCents: null, isOut: false },
  { productRef: PRODUIT, ingredientId: 'i-tomate', name: 'Tomate', displayName: null, category: 'legume', removable: true, supplementPriceCents: null, isOut: false },
];
const CATALOGUE = [
  { ingredientId: 'i-cheddar', name: 'Cheddar (tranches)', displayName: 'Cheddar', category: 'fromage', removable: true, supplementPriceCents: 100, isOut: false },
];

/** Compteur de lectures Postgres — la mutualisation se vérifie ici. */
const lectures = { count: 0 };

function supplyDb(options: { fail?: boolean } = {}) {
  let call = 0;
  const chain = (rows: unknown[]) => {
    const self = {
      from: () => self,
      innerJoin: () => self,
      where: async () => {
        if (options.fail) throw new Error('ECONNREFUSED 127.0.0.1:5432');
        return rows;
      },
    };
    return self;
  };
  return {
    select: () => {
      lectures.count += 1;
      return chain(++call === 1 ? RECETTE : CATALOGUE);
    },
  };
}

function menu(options: { fail?: boolean; produits?: number } = {}) {
  lectures.count = 0;
  const produit = (i: number) => ({
    _id: i === 0 ? PRODUIT : `${PRODUIT.slice(0, -1)}${i}`,
    categoryId: CATEGORIE,
    name: i === 0 ? 'Sandwich Merguez' : `Sandwich ${i}`,
    price: 750,
    optionGroups: [
      { key: 'pain', name: 'Pain ou galette', type: 'single', min: 1, max: 1, choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }] },
    ],
    removables: ['crudités'],
    active: true,
  });
  const carte = Array.from({ length: options.produits ?? 1 }, (_, i) => produit(i));
  const products = {
    find: () => ({ sort: () => ({ lean: async () => carte }) }),
    bulkWrite: async (ops: unknown[]) => ({ modifiedCount: (ops as []).length }),
  };
  const categories = {
    find: () => ({ sort: () => ({ lean: async () => [{ _id: CATEGORIE, name: 'Sandwichs' }] }) }),
  };
  const supply = new SupplyService(
    supplyDb(options) as never,
    products as never,
    { publish: () => {} } as never,
  );
  // Le journal NF525 n'est pas le sujet de ces tests : une doublure muette suffit.
  return new MenuService(
    categories as never,
    products as never,
    { publish: () => {} } as never,
    supply,
    { log: async () => {} } as never,
  );
}

/** Premier produit de la première catégorie — son absence est un échec de test. */
function premierProduit(categories: { products: unknown[] }[]) {
  const produit = categories[0]?.products[0];
  if (produit === undefined) throw new Error('aucun produit servi par la carte');
  return produit as {
    name: string;
    price: number;
    optionGroups: { key: string }[];
    removables: { key: string; label: string }[];
    supplements: { key: string; label: string; priceCents: number; category: string }[];
  };
}

describe('menu public enrichi par la recette', () => {
  it('joint à chaque produit ses retraits et ses suppléments', async () => {
    const { categories } = await menu().publicMenu(TENANT);
    const produit = premierProduit(categories);

    expect(produit.removables).toEqual([
      { key: 'tomate', label: 'Tomate' },
      { key: 'crudites', label: 'crudités' },
    ]);
    expect(produit.supplements).toEqual([
      { key: 'cheddar', label: 'Cheddar', priceCents: 100, category: 'fromage' },
    ]);
  });

  it('garde les groupes d’options du gérant et masque le groupe réservé', async () => {
    const { categories } = await menu().publicMenu(TENANT);
    const groupes = premierProduit(categories).optionGroups.map((g) => g.key);

    expect(groupes).toEqual(['pain']);
    expect(groupes).not.toContain(SUPPLEMENT_GROUP_KEY);
  });

  it('lit Postgres une seule fois pour toute la carte, jamais une fois par produit', async () => {
    // Le service tourne à 109 produits : une lecture par produit mettrait la
    // carte à genoux au premier coup de feu.
    await menu({ produits: 40 }).publicMenu(TENANT);
    expect(lectures.count).toBe(2); // recettes + catalogue des suppléments
  });

  it('enrichit aussi le menu du back-office', async () => {
    const { categories } = await menu().fullMenu(TENANT);
    expect(premierProduit(categories).supplements).toHaveLength(1);
  });
});

describe('contexte supply coupé', () => {
  it('sert quand même la carte, avec les anciens modificateurs', async () => {
    const { categories } = await menu({ fail: true }).publicMenu(TENANT);
    const produit = premierProduit(categories);

    expect(produit.name).toBe('Sandwich Merguez');
    expect(produit.price).toBe(750);
    expect(produit.removables).toEqual([{ key: 'crudites', label: 'crudités' }]);
    expect(produit.supplements).toEqual([]);
  });
});

/**
 * LE GROUPE RÉSERVÉ NE DOIT JAMAIS DISPARAÎTRE PAR UN ALLER-RETOUR D'ÉCRAN.
 *
 * `GET /menu` retire `supplements` de `optionGroups` — il n'existe que pour
 * faire foi sur le prix côté serveur, et la carte l'expose déjà dans son propre
 * bloc. Un éditeur qui lit la carte puis renvoie `optionGroups` tel quel
 * SUPPRIME donc ce groupe du document, c'est-à-dire la seule source du prix
 * des suppléments à la création de commande.
 *
 * Ce n'est pas une hypothèse : `packages/db/src/repair-options.ts` documente
 * l'incident. « L'ajout du groupe suppléments a remplacé `optionGroups` au lieu
 * de le compléter : 32 produits ont perdu leur choix de pain et leurs sauces,
 * 19 se sont retrouvés sans aucune option. La caisse refusait alors toute
 * commande de sandwich avec un “Option inconnue”. »
 *
 * Le service réinjecte donc le groupe réservé quand la mise à jour ne le porte
 * pas. La garantie vit ICI, côté serveur, et non dans la discipline de chaque
 * écran qui écrira un jour un produit.
 */
describe('le groupe réservé survit à une mise à jour venue de l’écran', () => {
  const AVEC_SUPPLEMENTS = [
    { key: 'pain', name: 'Pain ou galette', type: 'single', min: 1, max: 1, choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }] },
    { key: SUPPLEMENT_GROUP_KEY, name: 'Suppléments', type: 'multi', min: 0, choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 100 }] },
  ];

  /** Un service dont on peut inspecter le `$set` réellement envoyé à Mongo. */
  function serviceEspion(existant: unknown[]) {
    const vus: Record<string, unknown>[] = [];
    const products = {
      findOne: () => ({ lean: async () => ({ optionGroups: existant }) }),
      findOneAndUpdate: (_f: unknown, u: { $set: Record<string, unknown> }) => {
        vus.push(u.$set);
        return { lean: async () => ({ _id: PRODUIT, name: 'Sandwich' }), then: undefined } as never;
      },
    };
    // `findOneAndUpdate` doit rendre un document : on le simule en promesse.
    const productsAvecRetour = {
      ...products,
      findOneAndUpdate: async (_f: unknown, u: { $set: Record<string, unknown> }) => {
        vus.push(u.$set);
        return { _id: PRODUIT, name: 'Sandwich', price: 750 };
      },
    };
    const service = new MenuService(
      { find: () => ({ sort: () => ({ lean: async () => [] }) }) } as never,
      productsAvecRetour as never,
      { publish: () => {} } as never,
      new SupplyService(supplyDb() as never, productsAvecRetour as never, { publish: () => {} } as never),
      { log: async () => {} } as never,
    );
    return { service, vus };
  }

  it('réinjecte le groupe réservé quand l’écran ne le renvoie pas', async () => {
    const { service, vus } = serviceEspion(AVEC_SUPPLEMENTS);
    await service.updateProduct(TENANT, PRODUIT, {
      optionGroups: [
        { key: 'sauces', name: 'Sauces', type: 'multi', min: 0, max: 2, choices: [{ key: 'ketchup', name: 'Ketchup', priceDelta: 0 }] },
      ],
    } as never);
    const groupes = (vus[0]?.optionGroups ?? []) as { key: string }[];
    expect(groupes.map((g) => g.key)).toContain(SUPPLEMENT_GROUP_KEY);
    expect(groupes.map((g) => g.key)).toContain('sauces');
  });

  it('ne touche à rien quand la mise à jour ne parle pas d’options', async () => {
    const { service, vus } = serviceEspion(AVEC_SUPPLEMENTS);
    await service.updateProduct(TENANT, PRODUIT, { name: 'Sandwich Merguez' } as never);
    expect(vus[0]).not.toHaveProperty('optionGroups');
  });

  it('n’invente pas de groupe réservé sur un produit qui n’en a pas', async () => {
    const { service, vus } = serviceEspion([
      { key: 'pain', name: 'Pain', type: 'single', min: 1, max: 1, choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }] },
    ]);
    await service.updateProduct(TENANT, PRODUIT, { optionGroups: [] } as never);
    expect((vus[0]?.optionGroups ?? []) as unknown[]).toHaveLength(0);
  });
});

/**
 * LE JOURNAL DOIT SUIVRE LE PRIX RÉELLEMENT VENDU.
 *
 * L'obligation de traçabilité porte sur le prix de vente, pas sur le champ qui
 * le porte. Un produit à variantes a un `price` mort — `orders.service.ts`
 * exige une variante dès qu'il y en a — et son prix réel vit dans
 * `variants[].price`. Journaliser l'un sans l'autre laisse un trou :
 * « Compose ton Tacos M » peut passer de 8,90 € à 12,90 € sans qu'une ligne
 * l'écrive, tandis qu'un produit simple à 2 € est tracé.
 */
describe('journal des prix — les variantes aussi', () => {
  function serviceJournal(avant: unknown) {
    const lignes: Record<string, unknown>[] = [];
    const products = {
      findOne: () => ({ lean: async () => avant }),
      findOneAndUpdate: async () => ({ _id: PRODUIT, name: 'Compose ton Tacos', price: 0 }),
    };
    const service = new MenuService(
      { find: () => ({ sort: () => ({ lean: async () => [] }) }) } as never,
      products as never,
      { publish: () => {} } as never,
      new SupplyService(supplyDb() as never, products as never, { publish: () => {} } as never),
      { log: async (l: Record<string, unknown>) => void lignes.push(l) } as never,
    );
    return { service, lignes };
  }

  it('trace un prix de variante qui change, avec l’avant et l’après', async () => {
    const { service, lignes } = serviceJournal({
      price: 0,
      variants: [{ key: 'M', name: 'M', price: 890 }, { key: 'L', name: 'L', price: 990 }],
    });
    await service.updateProduct(TENANT, PRODUIT, {
      variants: [{ key: 'M', name: 'M', price: 1_290 }, { key: 'L', name: 'L', price: 990 }],
    } as never);
    const ligne = lignes.find((l) => l.action === 'price.change');
    expect(ligne, 'un changement de prix de variante doit être journalisé').toBeDefined();
    expect(ligne?.meta).toMatchObject({ variantKey: 'M', fromCents: 890, toCents: 1_290 });
  });

  it('ne trace rien quand les variantes changent sans que le prix bouge', async () => {
    const { service, lignes } = serviceJournal({
      price: 0,
      variants: [{ key: 'M', name: 'M', price: 890 }],
    });
    await service.updateProduct(TENANT, PRODUIT, {
      variants: [{ key: 'M', name: 'Moyen', price: 890 }],
    } as never);
    expect(lignes.filter((l) => l.action === 'price.change')).toHaveLength(0);
  });

  it('trace une variante ajoutée — c’est un prix de vente qui apparaît', async () => {
    const { service, lignes } = serviceJournal({ price: 0, variants: [{ key: 'M', name: 'M', price: 890 }] });
    await service.updateProduct(TENANT, PRODUIT, {
      variants: [{ key: 'M', name: 'M', price: 890 }, { key: 'XL', name: 'XL', price: 1_250 }],
    } as never);
    const ligne = lignes.find((l) => (l.meta as { variantKey?: string })?.variantKey === 'XL');
    expect(ligne?.meta).toMatchObject({ variantKey: 'XL', fromCents: null, toCents: 1_250 });
  });
});
