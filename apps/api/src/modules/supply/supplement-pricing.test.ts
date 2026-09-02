import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SUPPLEMENT_GROUP_KEY, type CreateOrder } from '@sm/contracts';
import { OrdersService } from '../orders/orders.service';
import { SupplyService } from './supply.service';

/**
 * Chaîne complète du supplément payant, du stock à l'encaissement :
 *
 *   recette PostgreSQL → groupe d'options réservé « supplements » projeté sur
 *   le produit Mongo → prix relu par la création de commande.
 *
 * Le prix ne transite JAMAIS par l'appareil : la caisse n'envoie qu'une clé de
 * choix. Un supplément inconnu est refusé, un retrait ne coûte rien.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const PRODUIT = '665f0d0a1c2b3d4e5f6a7b8c';

type Row = {
  ingredientId: string;
  name: string;
  displayName: string | null;
  category: string;
  removable: boolean;
  supplementPriceCents: number | null;
  isOut: boolean;
};

const row = (over: Partial<Row> & { ingredientId: string; name: string }): Row => ({
  displayName: null,
  category: 'autre',
  removable: false,
  supplementPriceCents: null,
  isOut: false,
  ...over,
});

/** Recette du sandwich Merguez : pain, merguez, crudités, barquette. */
const RECETTE = [
  row({ ingredientId: 'i-pain', name: 'Pain sandwich', category: 'pain' }),
  row({ ingredientId: 'i-merguez', name: 'Merguez', category: 'viande', supplementPriceCents: 200 }),
  row({ ingredientId: 'i-salade', name: 'Salade iceberg', displayName: 'Salade', category: 'legume', removable: true }),
  row({ ingredientId: 'i-tomate', name: 'Tomate', category: 'legume', removable: true }),
  row({ ingredientId: 'i-oignon', name: 'Oignon rouge', displayName: 'Oignons', category: 'legume', removable: true }),
].map((r) => ({ productRef: PRODUIT, ...r }));

/** Catalogue tarifé du restaurant (menu-data.js : supp100 / supp150 / supp080). */
const CATALOGUE = [
  row({
    ingredientId: 'i-cheddar',
    name: 'Cheddar (tranches)',
    displayName: 'Cheddar',
    category: 'fromage',
    removable: true,
    supplementPriceCents: 100,
  }),
  row({
    ingredientId: 'i-lardons',
    name: 'Lardons de dinde',
    displayName: 'Lardons',
    category: 'volaille',
    supplementPriceCents: 150,
  }),
  row({ ingredientId: 'i-merguez', name: 'Merguez', category: 'viande', supplementPriceCents: 200 }),
];

/** Postgres réduit aux deux lectures que fait `modifiersForMenu`. */
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
  return { select: () => chain(++call === 1 ? RECETTE : CATALOGUE) };
}

interface OptionGroup {
  key: string;
  name?: string;
  choices: { key: string; name: string; priceDelta: number }[];
  min?: number;
  max?: number | null;
  perVariant?: unknown;
}

/** Produit Mongo en mémoire + application réelle des opérations bulkWrite. */
function produitMongo(optionGroups: OptionGroup[] = []) {
  const doc = {
    _id: PRODUIT,
    tenantId: TENANT,
    name: 'Sandwich Merguez',
    price: 750,
    variants: [] as { key: string; name: string; price: number }[],
    optionGroups,
    removables: ['crudités'],
    outOfStock: false,
    active: true,
  };
  const model = {
    bulkWrite: async (ops: any[]) => {
      for (const op of ops) {
        const update = op.updateOne.update;
        if (update.$push?.optionGroups) doc.optionGroups.push(update.$push.optionGroups);
        if (update.$pull?.optionGroups) {
          doc.optionGroups = doc.optionGroups.filter((g) => g.key !== update.$pull.optionGroups.key);
        }
        const replacement = update.$set?.['optionGroups.$[g]'];
        if (replacement) {
          const filtered = op.updateOne.arrayFilters[0]['g.key'];
          doc.optionGroups = doc.optionGroups.map((g) => (g.key === filtered ? replacement : g));
        }
      }
      return { modifiedCount: ops.length };
    },
    find: () => ({ lean: async () => [doc] }),
  };
  return { doc, model };
}

function supply(db: unknown, products: unknown) {
  return new SupplyService(db as never, products as never, { publish: () => {} } as never);
}

/** Commande d'un sandwich, options et retraits au choix. */
function commande(over: Partial<CreateOrder['lines'][number]> = {}): CreateOrder {
  return {
    clientId: '5f2b7c7e-6c1a-4c8f-9a1e-2f7b3d4c5e6a',
    channel: 'pos',
    type: 'emporter',
    lines: [{ productId: PRODUIT, options: [], removed: [], qty: 1, ...over }],
    payment: { method: 'counter', tender: 'card' },
  } as CreateOrder;
}

/** Première entrée attendue — son absence est un échec de test, pas un cas métier. */
function premiere<T>(rows: readonly T[], quoi: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`aucun(e) ${quoi}`);
  return row;
}

/** Commande telle qu'elle part en base, chiffrée par le serveur. */
interface CommandeCreee {
  totals: { subtotal: number; total: number };
  lines: {
    options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
    removed: string[];
    unitPrice: number;
    lineTotal: number;
  }[];
}

function orders(produit: unknown) {
  const created: CommandeCreee[] = [];
  const service = new OrdersService(
    {
      findOne: async () => null,
      create: async (doc: Record<string, unknown>) => {
        created.push(doc as unknown as CommandeCreee);
        return { ...doc, toObject: () => doc };
      },
    } as never,
    { find: () => ({ lean: async () => [produit] }) } as never,
    { findOneAndUpdate: async () => ({ seq: 7 }) } as never,
    // Aucune promotion au parc : ce test mesure le prix des SUPPLÉMENTS, et
    // une remise viendrait fausser le sous-total qu'il vérifie.
    { find: () => ({ lean: async () => [] }) } as never,
    { publish: () => {} } as never,
    {} as never,
  );
  return { service, created };
}

describe('projection du groupe réservé « supplements »', () => {
  it('écrit sur le produit Mongo les suppléments absents de sa recette, prix compris', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const group = doc.optionGroups.find((g) => g.key === SUPPLEMENT_GROUP_KEY);
    expect(group).toBeDefined();
    expect(group?.min).toBe(0);
    expect(group?.choices).toEqual([
      { key: 'cheddar', name: 'Cheddar', priceDelta: 100 },
      { key: 'lardons', name: 'Lardons', priceDelta: 150 },
    ]);
  });

  it('ne réécrit rien quand la carte est déjà à jour', async () => {
    const { doc, model } = produitMongo();
    const service = supply(supplyDb(), model);
    await service.modifiersForMenu(TENANT, [doc]);

    let writes = 0;
    const compteur = { ...model, bulkWrite: async (ops: unknown[]) => (writes += (ops as []).length) };
    await supply(supplyDb(), compteur).modifiersForMenu(TENANT, [doc]);
    expect(writes).toBe(0);
  });

  it('suit la baisse de tarif décidée par le gérant', async () => {
    const { doc, model } = produitMongo([
      {
        key: SUPPLEMENT_GROUP_KEY,
        name: 'Suppléments',
        choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 250 }],
      },
    ]);
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);
    const group = doc.optionGroups.find((g) => g.key === SUPPLEMENT_GROUP_KEY);
    expect(group?.choices).toEqual([
      { key: 'cheddar', name: 'Cheddar', priceDelta: 100 },
      { key: 'lardons', name: 'Lardons', priceDelta: 150 },
    ]);
  });
});

describe('encaissement d’un supplément', () => {
  it('augmente le prix du montant exact venu de PostgreSQL', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const { service, created } = orders(doc);
    await service.create(
      TENANT,
      commande({ options: [{ groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'cheddar' }] }),
      'caisse-1',
    );

    const commandeCreee = premiere(created, 'commande créée');
    expect(commandeCreee.totals.total).toBe(850);
    expect(premiere(commandeCreee.lines, 'ligne de commande').options).toEqual([
      { groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'cheddar', name: 'Cheddar', priceDelta: 100 },
    ]);
  });

  it('facture deux suppléments cumulés, et les multiplie par la quantité', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const { service, created } = orders(doc);
    await service.create(
      TENANT,
      commande({
        options: [
          { groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'cheddar' },
          { groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'lardons' },
        ],
        qty: 2,
      }),
      'caisse-1',
    );

    expect(premiere(created, 'commande créée').totals.total).toBe((750 + 100 + 150) * 2);
  });

  it('refuse un supplément inconnu — pas de prix inventé par l’appareil', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const { service } = orders(doc);
    await expect(
      service.create(
        TENANT,
        commande({ options: [{ groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'foie-gras' }] }),
        'caisse-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse un supplément que la recette contient déjà', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const { service } = orders(doc);
    await expect(
      service.create(
        TENANT,
        commande({ options: [{ groupKey: SUPPLEMENT_GROUP_KEY, choiceKey: 'merguez' }] }),
        'caisse-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ne change pas le prix quand le client retire un ingrédient', async () => {
    const { doc, model } = produitMongo();
    await supply(supplyDb(), model).modifiersForMenu(TENANT, [doc]);

    const { service, created } = orders(doc);
    await service.create(TENANT, commande({ removed: ['tomate', 'oignons'] }), 'caisse-1');

    const commandeCreee = premiere(created, 'commande créée');
    expect(commandeCreee.totals.total).toBe(750);
    expect(premiere(commandeCreee.lines, 'ligne de commande').removed).toEqual(['tomate', 'oignons']);
  });
});

describe('contexte supply indisponible', () => {
  it('ne projette rien et laisse le produit intact', async () => {
    const { doc, model } = produitMongo();
    const modifiers = await supply(supplyDb({ fail: true }), model).modifiersForMenu(TENANT, [doc]);

    expect(doc.optionGroups).toEqual([]);
    expect(modifiers.get(PRODUIT)).toEqual({
      // Repli sur les modificateurs express saisis en dur sur le produit.
      removables: [{ key: 'crudites', label: 'crudités' }],
      supplements: [],
    });
  });
});
