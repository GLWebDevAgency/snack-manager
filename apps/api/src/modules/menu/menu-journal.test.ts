import { describe, expect, it } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { journalDeTest } from '../audit/audit.fakes';
import { MenuService } from './menu.service';

/**
 * CE QUE LA CARTE LAISSE AU REGISTRE.
 *
 * Seul le prix d'un produit y entrait. Créer un article, le retirer, le mettre
 * en rupture ou supprimer une catégorie entière ne laissait RIEN — alors que
 * ce sont les gestes qui décident de ce qui est vendable et à quel prix.
 *
 * Ces tests vérifient le CONTENU des lignes : l'auteur, son rôle, le moyen, et
 * les valeurs d'avant et d'après là où elles ont un sens. Qu'un appel ait eu
 * lieu ne prouve rien — un journal qui écrit la mauvaise chose est pire que
 * pas de journal, parce qu'on lui fait confiance.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const GERANT = '665f0d0a1c2b3d4e5f6a7b01';
const CATEGORIE = '665f0d0a1c2b3d4e5f6a7b70';
const PRODUIT = '665f0d0a1c2b3d4e5f6a7b8c';

const SESSION: JwtPayload = { sub: GERANT, tenantId: TENANT, role: 'owner', kind: 'user' };

/** Les fausses collections Mongo — le vocabulaire exact qu'emploie le service. */
function atelier(options: {
  produit?: Record<string, unknown>;
  produitsRattaches?: number;
} = {}) {
  const produit = options.produit ?? { _id: PRODUIT, name: 'Tacos Poulet', price: 950 };
  const categorie = {
    _id: CATEGORIE,
    name: 'Sandwichs',
    deleteOne: async () => ({ deletedCount: 1 }),
  };

  const categories = {
    findOne: async () => categorie,
    create: async (doc: Record<string, unknown>) => ({ _id: 'cat-neuve', ...doc }),
    find: () => ({ sort: () => ({ lean: async () => [] }) }),
  };

  const products = {
    findOne: (_f: unknown, _p?: unknown) => ({
      lean: async () => produit,
      then: (r: (v: unknown) => unknown) => Promise.resolve(r(produit)),
    }),
    create: async (doc: Record<string, unknown>) => ({ _id: 'prod-neuf', ...doc }),
    findOneAndUpdate: async (_f: unknown, u: { $set: Record<string, unknown> }) => ({
      ...produit,
      ...u.$set,
    }),
    deleteOne: async () => ({ deletedCount: 1 }),
    countDocuments: async () => options.produitsRattaches ?? 0,
    updateMany: async () => ({ modifiedCount: options.produitsRattaches ?? 0 }),
    find: () => ({ sort: () => ({ lean: async () => [] }) }),
  };

  const { audit, lignes } = journalDeTest({
    users: [{ _id: GERANT, name: 'Karim Belkacem' }],
  });

  const service = new MenuService(
    categories as never,
    products as never,
    { publish: () => {} } as never,
    // Les modificateurs dérivés des recettes ne sont pas le sujet ici.
    { modifiersForMenu: async () => new Map() } as never,
    audit,
    // La médiathèque n'est pas le sujet : un catalogue vide suffit, et
    // `photoUrlDe` retombe alors sur la chaîne héritée du produit.
    { catalogue: async () => [] } as never,
  );

  return { service, lignes };
}

describe('un produit qui entre à la carte', () => {
  it('inscrit son nom, son prix d’entrée et sa catégorie — avec l’auteur', async () => {
    const { service, lignes } = atelier();

    await service.createProduct(
      TENANT,
      { name: 'Tacos Merguez', price: 890, categoryId: CATEGORIE },
      SESSION,
    );

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      tenantId: TENANT,
      action: 'product.create',
      meta: { name: 'Tacos Merguez', priceCents: 890, categoryName: 'Sandwichs' },
      author: { id: GERANT, name: 'Karim Belkacem', role: 'owner', means: 'password' },
    });
  });
});

describe('un produit qui quitte la carte', () => {
  it('garde son nom et son dernier prix — après la suppression, plus personne ne les connaît', async () => {
    const { service, lignes } = atelier();

    await service.deleteProduct(TENANT, PRODUIT, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'product.delete',
      targetId: PRODUIT,
      meta: { name: 'Tacos Poulet', priceCents: 950 },
    });
  });
});

describe('la rupture d’un produit', () => {
  it('note le passage en rupture, avec qui l’a posée depuis le comptoir', async () => {
    const { service, lignes } = atelier({
      produit: { _id: PRODUIT, name: 'Tacos Poulet', price: 950, outOfStock: false },
    });

    await service.setStock(TENANT, PRODUIT, true, {
      sub: GERANT,
      tenantId: TENANT,
      role: 'owner',
      kind: 'user',
    });

    expect(lignes[0]).toMatchObject({
      action: 'product.stock',
      meta: { name: 'Tacos Poulet', outOfStock: true },
    });
  });

  it('n’écrit rien quand rien ne change — un doigt qui glisse ne fait pas une ligne', async () => {
    // Le bouton est tapé du bout du doigt sur une tablette grasse : sans ce
    // garde-fou, une matinée de service enterrerait les annulations sous des
    // « rupture → rupture » identiques.
    const { service, lignes } = atelier({
      produit: { _id: PRODUIT, name: 'Tacos Poulet', price: 950, outOfStock: true },
    });

    await service.setStock(TENANT, PRODUIT, true, SESSION);

    expect(lignes).toEqual([]);
  });
});

describe('une catégorie supprimée', () => {
  it('dit combien de produits elle emporte hors des écrans', async () => {
    // Avec `force`, les produits ne sont pas détruits : ils passent en « Non
    // rattachés » et disparaissent des surfaces qui présentent la carte par
    // catégorie. C'est une mise hors service en masse, et l'ampleur est ce
    // qu'un gérant cherche quand sa carte s'est vidée.
    const { service, lignes } = atelier({ produitsRattaches: 12 });

    await service.deleteCategory(TENANT, CATEGORIE, true, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'category.delete',
      targetId: CATEGORIE,
      meta: { name: 'Sandwichs', detached: 12 },
      author: { role: 'owner', means: 'password' },
    });
  });
});

describe('un prix qui bouge', () => {
  it('porte la transition ET l’auteur — « 9,50 € → 8,90 € », par qui', async () => {
    const { service, lignes } = atelier();

    await service.updateProduct(TENANT, PRODUIT, { price: 890 }, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'price.change',
      targetId: PRODUIT,
      meta: { name: 'Tacos Poulet', fromCents: 950, toCents: 890 },
      author: { name: 'Karim Belkacem', role: 'owner', means: 'password' },
    });
  });
});
