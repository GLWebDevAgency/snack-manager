/**
 * Répare les groupes d'options écrasés sur les produits.
 *
 * INCIDENT — l'ajout du groupe « suppléments » (dérivé des ingrédients) a
 * remplacé `optionGroups` au lieu de le compléter : 32 produits ont perdu
 * leur choix de pain et leurs sauces, 19 se sont retrouvés sans aucune
 * option. La caisse refusait alors toute commande de sandwich avec un
 * « Option inconnue », puisque le groupe demandé n'existait plus.
 *
 * Ce script reconstruit les groupes MÉTIER depuis la carte de référence
 * (`design_handoff_snack_manager/menu-data.js`) et les fusionne avec le
 * groupe « supplements » déjà présent, qu'il préserve.
 *
 * Garanties : écriture par `$set` ciblé sur les seuls champs concernés, donc
 * ni les identifiants, ni les prix, ni les photos, ni les recettes liées ne
 * sont touchés. Idempotent.
 *
 *   pnpm --filter @sm/db repair:options
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { SUPPLEMENT_GROUP_KEY } from '@sm/contracts';

dotenv({ path: resolve(__dirname, '../../../.env') });

const menuPath = resolve(__dirname, '../../../design_handoff_snack_manager/menu-data.js');
const win: { MENU?: any } = {};
new Function('window', readFileSync(menuPath, 'utf8'))(win);
const MENU = win.MENU;
if (!MENU) throw new Error('menu-data.js : window.MENU introuvable');

const key = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const choices = (names: string[], priceDelta = 0) =>
  names.map((n) => ({ key: key(n), name: n, priceDelta }));

// ─── Groupes de référence, tels que définis par la carte ───

const SAUCES = {
  key: 'sauces',
  name: 'Sauces',
  type: 'multi' as const,
  min: 0,
  max: 2,
  choices: choices(MENU.sauces),
};

const PAIN = {
  key: 'pain',
  name: 'Pain',
  type: 'single' as const,
  min: 1,
  max: 1,
  choices: [
    { key: 'pain', name: 'Pain', priceDelta: 0 },
    { key: 'galette', name: 'Galette', priceDelta: 50 },
  ],
};

const VIANDES = MENU.tacos.viandes as string[];

/** Groupes attendus par catégorie — reflète la construction du seed d'origine. */
const BY_CATEGORY: Record<string, unknown[]> = {
  [MENU.sandwichs.title]: [PAIN, SAUCES],
  [MENU.burgers.title]: [SAUCES],
  [MENU.classiques.title]: [SAUCES],
  [MENU.hummers.title]: [SAUCES],
  [MENU.suedois.title]: [
    {
      key: 'base',
      name: 'Base',
      type: 'single',
      min: 1,
      max: 1,
      choices: choices(['3 steaks', 'Escalope de poulet']),
    },
    SAUCES,
  ],
  [MENU.enfant.title]: [
    {
      key: 'plat',
      name: 'Plat',
      type: 'single',
      min: 1,
      max: 1,
      choices: choices(['Cheeseburger', '5 nuggets', 'Kebab', 'Mini tacos']),
    },
    {
      key: 'douceur',
      name: 'Boisson / dessert',
      type: 'single',
      min: 1,
      max: 1,
      choices: choices(['Capri-Sun', 'Compote']),
    },
  ],
  [MENU.crousty.title]: [
    {
      key: 'base',
      name: 'Base',
      type: 'single',
      min: 1,
      max: 1,
      choices: choices(['Riz (sauce crème)', 'Pâtes (sauce cheddar)', 'Nouilles (sauce cheddar)']),
    },
  ],
};

/** Produits dont les groupes dépendent du produit lui-même, pas de sa catégorie. */
const BY_PRODUCT: Record<string, unknown[]> = {
  'Class Bowl': [
    {
      key: 'viandes',
      name: 'Viandes',
      type: 'multi',
      min: 0,
      max: 3,
      choices: choices(VIANDES),
      perVariant: {
        [key('Veggi')]: { min: 0, max: 0 },
        [key('1 viande')]: { min: 1, max: 1 },
        [key('2 ou 3 viandes')]: { min: 2, max: 3 },
      },
    },
    SAUCES,
  ],
  Assiette: [
    {
      key: 'viandes',
      name: 'Viandes',
      type: 'multi',
      min: 1,
      max: 3,
      choices: choices(VIANDES),
      perVariant: { M: { min: 1, max: 1 }, L: { min: 2, max: 2 }, XL: { min: 3, max: 3 } },
    },
    SAUCES,
  ],
  [MENU.assiettes.special.n]: [
    {
      key: 'viandes',
      name: 'Viandes (2 au choix)',
      type: 'multi',
      min: 2,
      max: 2,
      choices: choices(VIANDES),
    },
    SAUCES,
  ],
  "Bun's": [
    {
      key: 'viandes',
      name: 'Viandes',
      type: 'multi',
      min: 1,
      max: 2,
      choices: choices(VIANDES),
      perVariant: { M: { min: 1, max: 1 }, L: { min: 2, max: 2 } },
    },
    SAUCES,
  ],
  'Panini au choix': [
    {
      key: 'garniture',
      name: 'Garniture',
      type: 'single',
      min: 1,
      max: 1,
      choices: choices((MENU.paninis.base as string).split(' · ')),
    },
    { key: 'extras', name: 'Extras', type: 'multi', min: 0, max: 1, choices: [{ key: 'frites', name: 'Supplément frites', priceDelta: 150 }] },
  ],
  'Panini 3 fromages': [
    { key: 'extras', name: 'Extras', type: 'multi', min: 0, max: 1, choices: [{ key: 'frites', name: 'Supplément frites', priceDelta: 150 }] },
  ],
  'Box Menu Solo': [
    { key: 'choix', name: 'Choix', type: 'single', min: 1, max: 1, choices: choices(['5 tenders', '5 wings']) },
  ],
};

/** Retraits express d'origine, par catégorie. */
const REMOVABLES: Record<string, string[]> = {
  [MENU.sandwichs.title]: ['crudités'],
  [MENU.burgers.title]: ['salade', 'tomates', 'oignons rouges', 'cornichons'],
  [MENU.classiques.title]: ['crudités'],
  [MENU.hummers.title]: ['crudités'],
};

async function main() {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const tenant = await db.collection('tenants').findOne({ slug: 'classfood' });
  if (!tenant) throw new Error('Tenant classfood introuvable');

  const categories = await db
    .collection('categories')
    .find({ tenantId: tenant._id })
    .toArray();
  const catName = new Map(categories.map((c) => [String(c._id), c.name as string]));

  const products = await db.collection('products').find({ tenantId: tenant._id }).toArray();

  let repaired = 0;
  let untouched = 0;

  for (const p of products) {
    const existing = (p.optionGroups ?? []) as { key?: string }[];
    // Le groupe des suppléments est dérivé des ingrédients : on le conserve.
    const supplement = existing.find((g) => g.key === SUPPLEMENT_GROUP_KEY);
    const business = existing.filter((g) => g.key !== SUPPLEMENT_GROUP_KEY);

    const expected =
      BY_PRODUCT[p.name as string] ?? BY_CATEGORY[catName.get(String(p.categoryId)) ?? ''] ?? null;

    // Rien d'attendu, ou les groupes métier sont déjà là : on ne touche pas.
    if (!expected || business.length > 0) {
      untouched++;
      continue;
    }

    const $set: Record<string, unknown> = {
      optionGroups: supplement ? [...expected, supplement] : expected,
    };

    const rem = REMOVABLES[catName.get(String(p.categoryId)) ?? ''];
    if (rem && (!Array.isArray(p.removables) || p.removables.length === 0)) {
      $set.removables = rem;
    }

    await db.collection('products').updateOne({ _id: p._id }, { $set });
    repaired++;
    console.log(`  ↻ ${p.name} — ${(expected as { key: string }[]).map((g) => g.key).join(', ')}`);
  }

  console.log(`\n✓ ${repaired} produit(s) réparé(s), ${untouched} intact(s)`);

  const stillBroken = await db.collection('products').countDocuments({
    tenantId: tenant._id,
    $or: [{ optionGroups: { $size: 0 } }, { optionGroups: { $exists: false } }],
  });
  console.log(`  produits sans aucune option : ${stillBroken}`);

  await mongoose.disconnect();
}

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier — pour tester une de ses fonctions, ou
 * par une chaîne d'imports involontaire — ouvre une connexion à la base pointée
 * par l'environnement et LANCE le traitement. Sur un poste dont le `.env` vise
 * la production, c'est un script d'administration qui part tout seul.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
