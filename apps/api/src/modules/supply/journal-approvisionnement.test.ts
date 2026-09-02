import { describe, expect, it } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { journalDeTest } from '../audit/audit.fakes';
import { lignesDeLEditeurDIngredient } from './journal-approvisionnement';
import { SupplyService } from './supply.service';

/**
 * L'APPROVISIONNEMENT N'ÉCRIVAIT RIEN — quinze routes d'écriture, zéro ligne.
 *
 * C'était le plus gros trou du registre : les mouvements de stock, les
 * ruptures d'ingrédient et les corrections de quantité vivent en PostgreSQL,
 * loin du journal Mongo, et personne n'avait fait le pont. Un kilo de viande
 * pouvait disparaître d'un `PATCH` sans que rien ne le dise.
 *
 * Ces tests vérifient le CONTENU des lignes : l'auteur, le stock d'avant et
 * d'après, l'ampleur d'une cascade de rupture.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const GERANT = '665f0d0a1c2b3d4e5f6a7b01';
const INGREDIENT = '3f2b7c7e-6c1a-4c8f-9a1e-2f7b3d4c5e6a';
const PRODUIT = '665f0d0a1c2b3d4e5f6a7b8c';

const SESSION: JwtPayload = { sub: GERANT, tenantId: TENANT, role: 'gerant', kind: 'user' };

// ─────────────────────────────────────────────────────────────
// La décision, sans base : quelles lignes, avec quel contenu
// ─────────────────────────────────────────────────────────────

const AVANT = {
  name: 'Merguez',
  unit: 'kg',
  currentStock: 12,
  supplementPriceCents: 200,
};

describe('l’éditeur d’un ingrédient', () => {
  it('trace une quantité corrigée à la main — c’était le chemin sans trace', async () => {
    // Une perte de trois kilos pouvait s'effacer d'un `PATCH` : l'inventaire
    // redevenait juste, et rien ne disait qu'il avait bougé.
    const [ligne] = lignesDeLEditeurDIngredient(AVANT, { currentStock: 9 });

    expect(ligne).toEqual({
      action: 'stock.adjust',
      meta: { name: 'Merguez', unit: 'kg', de: 12, vers: 9, ecart: -3 },
    });
  });

  it('trace un prix de supplément — c’est le client qui le paie', async () => {
    const [ligne] = lignesDeLEditeurDIngredient(AVANT, { supplementPriceCents: 250 });

    expect(ligne).toEqual({
      action: 'price.change',
      meta: { name: 'Merguez', supplement: true, fromCents: 200, toCents: 250 },
    });
  });

  it('note un supplément devenu gratuit, ou l’inverse — `null` est porteur de sens', () => {
    const [gratuit] = lignesDeLEditeurDIngredient(AVANT, { supplementPriceCents: null });
    expect(gratuit!.meta).toMatchObject({ fromCents: 200, toCents: null });

    const [payant] = lignesDeLEditeurDIngredient(
      { ...AVANT, supplementPriceCents: null },
      { supplementPriceCents: 150 },
    );
    expect(payant!.meta).toMatchObject({ fromCents: null, toCents: 150 });
  });

  it('écrit les deux lignes quand les deux bougent, jamais une ligne fourre-tout', () => {
    const lignes = lignesDeLEditeurDIngredient(AVANT, {
      currentStock: 15,
      supplementPriceCents: 250,
    });
    expect(lignes.map((l) => l.action)).toEqual(['stock.adjust', 'price.change']);
  });

  it('n’écrit rien quand le formulaire est renvoyé sans changement', () => {
    // L'écran renvoie la fiche entière : sans cette comparaison, chaque
    // enregistrement produirait un « 12 → 12 » qui noierait les vrais écarts.
    expect(lignesDeLEditeurDIngredient(AVANT, { currentStock: 12 })).toEqual([]);
    expect(lignesDeLEditeurDIngredient(AVANT, { supplementPriceCents: 200 })).toEqual([]);
  });

  it('ignore les neuf autres champs — ils sont hors périmètre, et c’est décidé', () => {
    // Nom, catégorie, unité, allergènes, coût d'achat, seuil, conservation,
    // retirable, libellé de caisse : aucun ne touche l'argent encaissé ni la
    // disponibilité. Voir la règle de périmètre à côté de `TENANT_AUDIT_ACTIONS`.
    const lignes = lignesDeLEditeurDIngredient(AVANT, {
      name: 'Merguez de bœuf',
      category: 'viande',
      costPerUnitCents: 1290,
      parLevel: 5,
      allergens: [],
    });
    expect(lignes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Les émetteurs, sur des doublures des deux bases
// ─────────────────────────────────────────────────────────────

/** Une chaîne drizzle : toutes les méthodes rendent `self`, l'attente résout. */
function chaine(resultat: unknown[]) {
  const self: Record<string, unknown> = {};
  for (const methode of ['set', 'from', 'innerJoin', 'where', 'limit', 'for', 'values']) {
    self[methode] = () => self;
  }
  self.returning = () => Promise.resolve(resultat);
  self.then = (ok: (v: unknown[]) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve(resultat).then(ok, ko);
  return self;
}

/**
 * PostgreSQL en doublure : chaque opération pioche son résultat dans une file.
 * Le service parle un vocabulaire étroit (`update…returning`, `select…where`,
 * `transaction`, `query.ingredients.findFirst`) — la doublure rejoue celui-là.
 */
function supplyDb(files: {
  updates?: unknown[][];
  selects?: unknown[][];
  inserts?: unknown[][];
  premier?: unknown;
}) {
  const updates = [...(files.updates ?? [])];
  const selects = [...(files.selects ?? [])];
  const inserts = [...(files.inserts ?? [])];
  const tx = {
    select: () => chaine(selects.shift() ?? []),
    insert: () => chaine(inserts.shift() ?? []),
    update: () => chaine(updates.shift() ?? []),
  };
  return {
    update: () => chaine(updates.shift() ?? []),
    select: () => chaine(selects.shift() ?? []),
    insert: () => chaine(inserts.shift() ?? []),
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    query: { ingredients: { findFirst: async () => files.premier } },
  };
}

function atelier(
  db: ReturnType<typeof supplyDb>,
  produits: Record<string, unknown> = {},
) {
  const { audit, lignes } = journalDeTest({ users: [{ _id: GERANT, name: 'Karim Belkacem' }] });
  const products = {
    updateMany: async () => ({ modifiedCount: 0 }),
    find: () => ({ lean: async () => [] }),
    bulkWrite: async () => ({ modifiedCount: 0 }),
    ...produits,
  };
  const service = new SupplyService(
    db as never,
    products as never,
    { publish: () => {} } as never,
    audit,
  );
  return { service, lignes };
}

describe('un mouvement de stock', () => {
  it('porte le solde d’AVANT et d’APRÈS, que la table des mouvements ne garde pas', async () => {
    // `stock_movements` n'a que le delta : reconstituer un solde à une date
    // donnée demanderait de rejouer toute la colonne. Le registre, lui, le dit.
    const db = supplyDb({
      selects: [[{ id: INGREDIENT, name: 'Merguez', unit: 'kg', currentStock: '12', parLevel: '5' }]],
      inserts: [[{ id: 'mv-1', qty: '-3' }]],
      updates: [[]],
    });
    const { service, lignes } = atelier(db);

    await service.createMovement(
      TENANT,
      { ingredientId: INGREDIENT, type: 'waste', qty: 3, note: 'Coupure de courant' },
      SESSION,
    );

    expect(lignes[0]).toMatchObject({
      action: 'stock.movement',
      targetId: INGREDIENT,
      meta: {
        name: 'Merguez',
        unit: 'kg',
        type: 'waste',
        qty: -3,
        de: 12,
        vers: 9,
        note: 'Coupure de courant',
      },
      author: { name: 'Karim Belkacem', role: 'gerant', means: 'password' },
    });
  });

  it('ne rend pas au client les champs qui n’existent que pour le journal', async () => {
    const db = supplyDb({
      selects: [[{ id: INGREDIENT, name: 'Merguez', unit: 'kg', currentStock: '12', parLevel: '5' }]],
      inserts: [[{ id: 'mv-1', qty: '4' }]],
      updates: [[]],
    });
    const { service } = atelier(db);

    const reponse = await service.createMovement(
      TENANT,
      { ingredientId: INGREDIENT, type: 'purchase', qty: 4 },
      SESSION,
    );

    expect(reponse).not.toHaveProperty('journal');
    expect(reponse.currentStock).toBe(16);
  });
});

describe('la rupture d’un ingrédient', () => {
  it('dit COMBIEN de produits elle a coupés d’un seul tap', async () => {
    // C'est l'ampleur qu'un gérant cherche quand sa carte s'est vidée en plein
    // coup de feu : « le cheddar est en rupture » n'explique pas sept plats
    // disparus.
    const db = supplyDb({
      updates: [[{ id: INGREDIENT, name: 'Cheddar', supplementPriceCents: null, currentStock: '4', parLevel: '2' }]],
      selects: [[{ productRef: PRODUIT }], []],
    });
    const { service, lignes } = atelier(db, {
      updateMany: async () => ({ modifiedCount: 7 }),
    });

    await service.setIngredientOut(TENANT, INGREDIENT, true, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'ingredient.out',
      targetId: INGREDIENT,
      meta: { name: 'Cheddar', isOut: true, productsUpdated: 7 },
      author: { name: 'Karim Belkacem', means: 'password' },
    });
  });
});

describe('un ingrédient retiré du catalogue', () => {
  it('emporte au registre le stock qu’il portait et son prix de supplément', async () => {
    // La suppression est douce, mais l'ingrédient sort des alertes et de
    // l'inventaire : sa quantité cesse d'être suivie, et un supplément tarifé
    // quitte la caisse au même instant.
    const db = supplyDb({
      updates: [[{ id: INGREDIENT, name: 'Cheddar', unit: 'kg', currentStock: '4.5', supplementPriceCents: 100 }]],
    });
    const { service, lignes } = atelier(db);

    await service.deleteIngredient(TENANT, INGREDIENT, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'ingredient.delete',
      targetId: INGREDIENT,
      meta: { name: 'Cheddar', unit: 'kg', stock: 4.5, supplementPriceCents: 100 },
    });
  });
});

describe('le stock corrigé depuis l’éditeur', () => {
  it('arrive au registre avec sa transition et son auteur', async () => {
    const db = supplyDb({
      premier: { name: 'Merguez', unit: 'kg', currentStock: '12', supplementPriceCents: 200 },
      updates: [[{ id: INGREDIENT, name: 'Merguez', currentStock: '9', parLevel: '5' }]],
    });
    // `query.ingredientBrands.findMany` est appelé après l'écriture.
    (db.query as Record<string, unknown>).ingredientBrands = { findMany: async () => [] };
    const { service, lignes } = atelier(db);

    await service.updateIngredient(TENANT, INGREDIENT, { currentStock: 9 }, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'stock.adjust',
      targetId: INGREDIENT,
      meta: { name: 'Merguez', de: 12, vers: 9, ecart: -3 },
      author: { name: 'Karim Belkacem', role: 'gerant', means: 'password' },
    });
  });
});
