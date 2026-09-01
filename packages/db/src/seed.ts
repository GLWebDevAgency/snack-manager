/**
 * Seed de développement — convertit la vraie carte Class'Food
 * (design_handoff_snack_manager/menu-data.js, prix relevés en boutique juin 2026)
 * en documents MongoDB. Idempotent : ré-exécutable, il remplace le tenant `classfood`.
 *
 *   pnpm --filter @sm/db seed
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import argon2 from 'argon2';
import mongoose from 'mongoose';
import { MODELS } from './schemas';
import { hashPassword } from './password-hash';

dotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * MOT DE PASSE D'AMORÇAGE — jamais écrit dans le code.
 *
 * Ce fichier a porté les mots de passe des deux comptes EN DUR. Celui de
 * l'équipe Snack Manager est le plus sensible : c'est le compte
 * concerné est celui qui voit le chiffre d'affaires de TOUS les restaurants du
 * parc et peut en suspendre un : son mot de passe committé serait lisible par
 * quiconque obtient le dépôt, aujourd'hui ou dans dix ans, et l'effacer plus
 * tard ne l'effacerait pas des commits passés.
 *
 * Deux voies, aucune ne laisse de trace dans le code :
 *  · la variable d'environnement, quand on veut un mot de passe choisi ;
 *  · à défaut, un tirage aléatoire IMPRIMÉ UNE FOIS à la fin du seed. Le seed
 *    reste donc utilisable sans configuration, ce qui compte : une amorce
 *    pénible finit contournée, et c'est comme ça qu'un secret revient en dur.
 *
 * Pour changer un mot de passe ensuite, sans passer par le code :
 *   pnpm --filter @sm/db exec tsx src/set-password.ts <email>
 */
function seedPassword(variable: string): string {
  const provided = process.env[variable]?.trim();
  if (provided) return provided;
  // 18 octets en base64url ≈ 144 bits : hors de portée d'une attaque par
  // dictionnaire, et encore copiable à la main depuis un terminal.
  return randomBytes(18).toString('base64url');
}

// ─── Chargement de menu-data.js (script navigateur : window.MENU = …) ───
const menuPath = resolve(__dirname, '../../../design_handoff_snack_manager/menu-data.js');
const win: { MENU?: any } = {};
new Function('window', readFileSync(menuPath, 'utf8'))(win);
const MENU = win.MENU;
if (!MENU) throw new Error('menu-data.js : window.MENU introuvable');

// ─── Helpers ───
const cents = (v: string | number): number =>
  Math.round(parseFloat(String(v).replace(/[+€\s]/g, '').replace(',', '.')) * 100);

const key = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

type Group = {
  key: string;
  name: string;
  type: 'single' | 'multi';
  min: number;
  max?: number | null;
  choices: { key: string; name: string; priceDelta: number }[];
  perVariant?: Record<string, { min?: number; max?: number; priceDelta?: number }> | null;
};

const choices = (names: string[], priceDelta = 0) =>
  names.map((n) => ({ key: key(n), name: n, priceDelta }));

const saucesGroup: Group = {
  key: 'sauces',
  name: 'Sauces',
  type: 'multi',
  min: 0,
  max: 2,
  choices: choices(MENU.sauces),
};

const viandesChoices = choices(MENU.tacos.viandes);

type ProductSeed = {
  name: string;
  description?: string;
  price?: number;
  variants?: { key: string; name: string; price: number }[];
  optionGroups?: Group[];
  removables?: string[];
  tags?: string[];
  isNew?: boolean;
};

type CategorySeed = { name: string; products: ProductSeed[] };

// ─── Construction des catégories depuis MENU ───
const categories: CategorySeed[] = [];

// Sandwichs — pain/galette +0,50, crudités retirables, sauces
categories.push({
  name: MENU.sandwichs.title,
  products: MENU.sandwichs.items.map((i: any) => ({
    name: i.n,
    description: i.d ?? '',
    price: cents(i.p),
    isNew: !!i.isNew,
    removables: ['crudités'],
    optionGroups: [
      {
        key: 'pain',
        name: 'Pain',
        type: 'single' as const,
        min: 1,
        max: 1,
        choices: [
          { key: 'pain', name: 'Pain', priceDelta: 0 },
          { key: 'galette', name: 'Galette', priceDelta: 50 },
        ],
      },
      saucesGroup,
    ],
  })),
});

categories.push({
  name: MENU.burgers.title,
  products: MENU.burgers.items.map((i: any) => ({
    name: i.n,
    description: i.d ?? '',
    price: cents(i.p),
    isNew: !!i.isNew,
    removables: ['salade', 'tomates', 'oignons rouges', 'cornichons'],
    optionGroups: [saucesGroup],
  })),
});

categories.push({
  name: MENU.classiques.title,
  products: MENU.classiques.items.map((i: any) => ({
    name: i.n,
    description: i.d ?? '',
    price: cents(i.p),
    tags: i.tag ? [i.tag] : [],
    removables: ['crudités'],
    optionGroups: [saucesGroup],
  })),
});

categories.push({
  name: MENU.bowl.title,
  products: [
    {
      name: 'Class Bowl',
      description: MENU.bowl.d,
      isNew: true,
      variants: MENU.bowl.prices.map((p: any) => ({ key: key(p.n), name: p.n, price: cents(p.p) })),
      optionGroups: [
        {
          key: 'viandes',
          name: 'Viandes',
          type: 'multi' as const,
          min: 0,
          max: 3,
          choices: viandesChoices,
          perVariant: {
            [key('Veggi')]: { min: 0, max: 0 },
            [key('1 viande')]: { min: 1, max: 1 },
            [key('2 ou 3 viandes')]: { min: 2, max: 3 },
          },
        },
        saucesGroup,
      ],
    },
  ],
});

// Tacos — le produit configurable de référence
categories.push({
  name: MENU.tacos.title,
  products: [
    {
      name: 'Compose ton Tacos',
      description: 'Taille, viandes, suppléments, sauces — servi avec frites',
      variants: MENU.tacos.sizes.map((s: any) => ({
        key: s.n,
        name: `${s.n} — ${s.d}`,
        price: cents(s.p),
      })),
      optionGroups: [
        {
          key: 'viandes',
          name: 'Viandes',
          type: 'multi' as const,
          min: 1,
          max: 4,
          choices: viandesChoices,
          perVariant: {
            M: { min: 1, max: 1 },
            L: { min: 2, max: 2 },
            XL: { min: 3, max: 3 },
            XXL: { min: 4, max: 4 },
          },
        },
        {
          key: 'supp-1-00',
          name: 'Suppléments +1,00 €',
          type: 'multi' as const,
          min: 0,
          choices: choices(MENU.tacos.supp100, 100),
        },
        {
          key: 'supp-1-50',
          name: 'Suppléments +1,50 €',
          type: 'multi' as const,
          min: 0,
          choices: choices(MENU.tacos.supp150, 150),
        },
        {
          key: 'supp-0-80',
          name: 'Suppléments +0,80 €',
          type: 'multi' as const,
          min: 0,
          choices: choices(MENU.tacos.supp080, 80),
        },
        {
          key: 'gratine',
          name: 'Gratiné',
          type: 'single' as const,
          min: 0,
          max: 1,
          choices: [{ key: 'gratine', name: 'Tacos gratiné', priceDelta: cents(MENU.tacos.gratine.ml) }],
          perVariant: {
            XL: { priceDelta: cents(MENU.tacos.gratine.xl) },
            XXL: { priceDelta: cents(MENU.tacos.gratine.xl) },
          },
        },
        saucesGroup,
      ],
    },
  ],
});

categories.push({
  name: MENU.assiettes.title,
  products: [
    {
      name: 'Assiette',
      description: 'Viandes au choix, crudités & frites',
      variants: MENU.assiettes.rows.map((r: any) => ({
        key: r.n,
        name: `${r.n} — ${r.d}`,
        price: cents(r.p),
      })),
      optionGroups: [
        {
          key: 'viandes',
          name: 'Viandes',
          type: 'multi' as const,
          min: 1,
          max: 3,
          choices: viandesChoices,
          perVariant: { M: { min: 1, max: 1 }, L: { min: 2, max: 2 }, XL: { min: 3, max: 3 } },
        },
        saucesGroup,
      ],
    },
    {
      name: MENU.assiettes.special.n,
      description: MENU.assiettes.special.d,
      price: cents(MENU.assiettes.special.p),
      optionGroups: [
        {
          key: 'viandes',
          name: 'Viandes (2 au choix)',
          type: 'multi' as const,
          min: 2,
          max: 2,
          choices: viandesChoices,
        },
        saucesGroup,
      ],
    },
  ],
});

categories.push({
  name: MENU.buns.title,
  products: [
    {
      name: "Bun's",
      description: 'Pain bun toasté, viandes au choix',
      variants: MENU.buns.rows.map((r: any) => ({
        key: r.n,
        name: `${r.n} — ${r.d}`,
        price: cents(r.p),
      })),
      optionGroups: [
        {
          key: 'viandes',
          name: 'Viandes',
          type: 'multi' as const,
          min: 1,
          max: 2,
          choices: viandesChoices,
          perVariant: { M: { min: 1, max: 1 }, L: { min: 2, max: 2 } },
        },
        saucesGroup,
      ],
    },
  ],
});

// Paninis
{
  const fritesExtra: Group = {
    key: 'extras',
    name: 'Extras',
    type: 'multi',
    min: 0,
    max: 1,
    choices: [{ key: 'frites', name: 'Supplément frites', priceDelta: 150 }],
  };
  categories.push({
    name: MENU.paninis.title,
    products: [
      {
        name: 'Panini au choix',
        description: MENU.paninis.base,
        price: cents(MENU.paninis.rows[0].p),
        optionGroups: [
          {
            key: 'garniture',
            name: 'Garniture',
            type: 'single' as const,
            min: 1,
            max: 1,
            choices: choices(MENU.paninis.base.split(' · ')),
          },
          fritesExtra,
        ],
      },
      {
        name: 'Panini 3 fromages',
        price: cents(MENU.paninis.rows[1].p),
        optionGroups: [fritesExtra],
      },
      {
        name: 'Panini Nutella',
        price: cents(MENU.paninis.rows[2].p),
        isNew: true,
      },
    ],
  });
}

categories.push({
  name: MENU.hummers.title,
  products: MENU.hummers.rows.map((r: any) => ({
    name: `${r.n} — ${r.d}`,
    description: MENU.hummers.note,
    price: cents(r.p),
    isNew: !!r.isNew,
    removables: ['crudités'],
    optionGroups: [saucesGroup],
  })),
});

categories.push({
  name: MENU.salades.title,
  products: MENU.salades.items.map((i: any) => ({
    name: `Salade ${i.n}`,
    description: i.d ?? '',
    price: cents(MENU.salades.price),
    isNew: !!i.isNew,
  })),
});

categories.push({
  name: MENU.barquettes.title,
  products: MENU.barquettes.rows.map((r: any) => ({
    name: r.n,
    variants: [
      { key: 'M', name: 'M', price: cents(r.m) },
      { key: 'L', name: 'L', price: cents(r.l) },
    ],
  })),
});

categories.push({
  name: MENU.suedois.title,
  products: [
    {
      name: 'Pain Suédois',
      description: MENU.suedois.d,
      price: cents(MENU.suedois.p),
      optionGroups: [
        {
          key: 'base',
          name: 'Base',
          type: 'single' as const,
          min: 1,
          max: 1,
          choices: choices(['3 steaks', 'Escalope de poulet']),
        },
        saucesGroup,
      ],
    },
  ],
});

categories.push({
  name: MENU.enfant.title,
  products: [
    {
      name: 'Menu Enfant',
      description: MENU.enfant.d,
      price: cents(MENU.enfant.p),
      optionGroups: [
        {
          key: 'plat',
          name: 'Plat',
          type: 'single' as const,
          min: 1,
          max: 1,
          choices: choices(['Cheeseburger', '5 nuggets', 'Kebab', 'Mini tacos']),
        },
        {
          key: 'douceur',
          name: 'Boisson / dessert',
          type: 'single' as const,
          min: 1,
          max: 1,
          choices: choices(['Capri-Sun', 'Compote']),
        },
      ],
    },
  ],
});

categories.push({
  name: MENU.hotdogs.title,
  products: MENU.hotdogs.items.map((i: any) => ({
    name: i.n,
    description: i.d ?? '',
    price: cents(i.p),
  })),
});

// Signatures — mélange produits simples + Le Smash à tailles
categories.push({
  name: MENU.signatures.title,
  products: MENU.signatures.items.map((i: any) => {
    if (i.sizes) {
      return {
        name: i.n,
        description: i.d ?? '',
        variants: i.sizes.map((s: any) => ({ key: key(s.label), name: s.label, price: cents(s.p) })),
      };
    }
    return {
      name: i.n,
      description: i.d ?? '',
      price: cents(i.p),
      tags: [i.bread, i.tag].filter(Boolean),
    };
  }),
});

categories.push({
  name: MENU.crousty.title,
  products: [
    {
      name: 'Crousty One',
      description: `${MENU.crousty.note} — ${MENU.crousty.compo}`,
      price: cents(MENU.crousty.price),
      optionGroups: [
        {
          key: 'base',
          name: 'Base',
          type: 'single' as const,
          min: 1,
          max: 1,
          choices: choices(['Riz (sauce crème)', 'Pâtes (sauce cheddar)', 'Nouilles (sauce cheddar)']),
        },
      ],
    },
  ],
});

// Tex-Mex — formats 5/10 pcs (ou 10/20 pour les solo)
{
  const texmex: ProductSeed[] = MENU.texmex.rows.map((r: any) => ({
    name: r.n,
    description: r.sub ?? '',
    isNew: !!r.isNew,
    variants: [
      { key: '5', name: '5 pcs', price: cents(r.m) },
      { key: '10', name: '10 pcs', price: cents(r.l) },
    ],
    optionGroups: r.sub
      ? [
          {
            key: 'garniture',
            name: 'Garniture',
            type: 'single' as const,
            min: 1,
            max: 1,
            choices: choices(r.sub.split(' · ')),
          },
        ]
      : [],
  }));
  for (const r of MENU.texmex.soloRows) {
    texmex.push({
      name: r.n,
      isNew: !!r.isNew,
      variants: [
        { key: '10', name: r.q1, price: cents(r.p1) },
        { key: '20', name: r.q2, price: cents(r.p2) },
      ],
    });
  }
  categories.push({ name: MENU.texmex.title, products: texmex });
}

categories.push({
  name: MENU.boxes.title,
  products: [
    {
      name: MENU.boxes.solo.n,
      description: MENU.boxes.solo.d,
      price: cents(MENU.boxes.solo.p),
      optionGroups: [
        {
          key: 'choix',
          name: 'Choix',
          type: 'single' as const,
          min: 1,
          max: 1,
          choices: choices(['5 tenders', '5 wings']),
        },
      ],
    },
    ...MENU.boxes.mix.map((b: any) => ({ name: b.n, description: b.d, price: cents(b.p) })),
    { name: MENU.boxes.family.n, description: MENU.boxes.family.d, price: cents(MENU.boxes.family.p) },
    {
      name: MENU.boxes.bigbox.n,
      description: MENU.boxes.bigbox.lines.join(' · '),
      price: cents(MENU.boxes.bigbox.p),
      tags: [MENU.boxes.bigbox.tag],
    },
  ],
});

categories.push({
  name: MENU.glaces.title,
  products: MENU.glaces.rows.map((r: any) => ({ name: r.n, price: cents(r.p) })),
});

categories.push({
  name: MENU.desserts.title,
  products: MENU.desserts.items.map((n: string) => ({ name: n, price: cents(MENU.desserts.price) })),
});

categories.push({
  name: MENU.milkshakes.title,
  products: MENU.milkshakes.rows.map((r: any) => ({
    name: `Milkshake ${r.n}`,
    description: MENU.milkshakes.note,
    variants: [
      { key: 'classique', name: 'Classique', price: cents(r.p) },
      { key: 'xl', name: 'XL', price: cents(r.xl) },
    ],
  })),
});

categories.push({
  name: MENU.boissons.title,
  products: MENU.boissons.rows.map((r: any) => ({ name: r.n, price: cents(r.p) })),
});

// ─── Écriture en base ───
async function main() {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant (racine .env)');
  await mongoose.connect(uri);

  const Tenant = mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
  const User = mongoose.model(MODELS.User.name, MODELS.User.schema, MODELS.User.collection);
  const Staff = mongoose.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection);
  const Category = mongoose.model(MODELS.Category.name, MODELS.Category.schema, MODELS.Category.collection);
  const Product = mongoose.model(MODELS.Product.name, MODELS.Product.schema, MODELS.Product.collection);
  const Order = mongoose.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
  const AuditLog = mongoose.model(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection);

  // Idempotence : on remplace intégralement le tenant classfood
  const existing = await Tenant.findOne({ slug: 'classfood' });
  if (existing) {
    const tid = existing._id;
    await Promise.all([
      Category.deleteMany({ tenantId: tid }),
      Product.deleteMany({ tenantId: tid }),
      Staff.deleteMany({ tenantId: tid }),
      Order.deleteMany({ tenantId: tid }),
      AuditLog.deleteMany({ tenantId: tid }),
      User.deleteMany({ tenantId: tid }),
      Tenant.deleteOne({ _id: tid }),
    ]);
    console.log('↻ Tenant classfood existant remplacé');
  }

  // Horaires réels : 7j/7, 11h30–14h30 & 18h00–22h30, lundi & vendredi soir uniquement
  const hours = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    lunch: day === 1 || day === 5 ? null : { open: '11:30', close: '14:30' },
    dinner: { open: '18:00', close: '22:30' },
  }));

  const tenant = await Tenant.create({
    slug: 'classfood',
    name: MENU.brand.name,
    brandColor: '#c9a15a',
    address: MENU.brand.address,
    phones: MENU.brand.phones,
    hours,
    plan: 'complet',
    founderSeat: true, // le pilote est la place fondateur n°1
  });

  // Mots de passe d'amorçage — voir `seedPassword` : jamais écrits dans le code.
  const ownerPassword = seedPassword('SEED_OWNER_PASSWORD');
  const adminPassword = seedPassword('SEED_ADMIN_PASSWORD');
  const [ownerHash, adminHash] = await Promise.all([
    hashPassword(ownerPassword),
    hashPassword(adminPassword),
  ]);
  await User.create([
    { email: 'limame19@gmail.com', passwordHash: ownerHash, role: 'owner', tenantId: tenant._id, name: 'Gérant Class\'Food' },
    { email: 'admin@snackmanager.fr', passwordHash: adminHash, role: 'sm_admin', tenantId: null, name: 'Équipe Snack Manager' },
  ]);

  const pins: [string, string, 'gerant' | 'caisse' | 'cuisine'][] = [
    ['Gérant', '1234', 'gerant'],
    ['Caisse', '1111', 'caisse'],
    ['Cuisine', '2222', 'cuisine'],
  ];
  await Staff.create(
    await Promise.all(
      pins.map(async ([name, pin, role]) => ({
        tenantId: tenant._id,
        name,
        role,
        pinHash: await argon2.hash(pin),
      })),
    ),
  );

  let nCats = 0;
  let nProds = 0;
  for (const [ci, cat] of categories.entries()) {
    const c = await Category.create({ tenantId: tenant._id, name: cat.name, order: ci });
    nCats++;
    await Product.create(
      cat.products.map((p, pi) => ({
        tenantId: tenant._id,
        categoryId: c._id,
        name: p.name,
        description: p.description ?? '',
        price: p.price ?? 0,
        variants: p.variants ?? [],
        optionGroups: p.optionGroups ?? [],
        removables: p.removables ?? [],
        tags: p.tags ?? [],
        isNew: p.isNew ?? false,
        order: pi,
      })),
    );
    nProds += cat.products.length;
  }

  console.log(`✓ Tenant « ${tenant.name} » (${tenant.slug}) — ${nCats} catégories, ${nProds} produits`);
  console.log('  Comptes : limame19@gmail.com (gérant) · admin@snackmanager.fr (équipe SM)');
  console.log(`    gérant    : ${ownerPassword}`);
  console.log(`    équipe SM : ${adminPassword}`);
  console.log('  Notez-les : ils ne sont stockés que hachés, personne ne pourra les relire.');
  console.log('  PIN staff : Gérant 1234 · Caisse 1111 · Cuisine 2222');
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
