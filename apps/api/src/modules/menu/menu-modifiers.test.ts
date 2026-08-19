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
  return new MenuService(categories as never, products as never, { publish: () => {} } as never, supply);
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
