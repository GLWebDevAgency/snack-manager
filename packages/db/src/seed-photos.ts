/**
 * Associe les vraies photos du restaurant pilote aux produits Class'Food.
 *
 * Les 27 visuels vivent dans `apps/web/public/photos/` : le site de commande
 * ET les écrans TV (Menu Board) sont servis par la même application Next, donc
 * un chemin PUBLIC ET RELATIF (`/photos/<fichier>`) fonctionne pour les deux.
 * Aucune URL absolue ici : elle casserait au premier changement de domaine.
 *
 * Deux niveaux d'association, du plus précis au plus large :
 *   1. `PAR_PRODUIT` — le visuel montre exactement ce plat (« Le Smash » →
 *      smash-burger.png). C'est le cas qui vend.
 *   2. `PAR_CATEGORIE` — repli pour les produits sans photo propre. Ce sont
 *      surtout les clichés des panneaux muraux du restaurant (sandwichs1.jpeg,
 *      classiques.jpeg…) : génériques, ils n'inventent aucune promesse sur
 *      l'assiette servie, contrairement à un burger gourmet collé sur un hot dog.
 *
 * PRUDENCE — deux garde-fous non négociables :
 *   • On n'écrit QUE `$set: { photoUrl }`, jamais `save()` ni update large :
 *     un document Mongoose ré-enregistré en entier a déjà effacé des prix ici.
 *   • On ne touche QUE les produits sans photo (filtre repris dans le `updateOne`
 *     lui-même, pas seulement dans la requête de lecture) : une photo choisie à
 *     la main dans le back-office survit à toutes les ré-exécutions.
 *
 * Idempotent : relancé, il ne réécrit rien.
 *
 *   pnpm --filter @sm/db photos            # écrit
 *   pnpm --filter @sm/db photos -- --dry   # simule et affiche le plan
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';

dotenv({ path: resolve(__dirname, '../../../.env') });

const TENANT_SLUG = 'classfood';
const PHOTOS_DIR = resolve(__dirname, '../../../apps/web/public/photos');
const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');

// ─────────────────────────────────────────────────────────────
// Association produit → visuel (nom exact du produit dans la carte)
// ─────────────────────────────────────────────────────────────

const PAR_PRODUIT: Record<string, string> = {
  // Sandwichs — le kebab a sa photo, les galettes leur wrap
  Kebab: 'doner-kebab.webp',
  'Kebab Fromage': 'doner-kebab.webp',
  'Maxi Kebab': 'doner-kebab.webp',
  'Galette 4 Fromages': 'wrap-tenders.webp',
  'Galette Burrata': 'wrap-tenders.webp',
  // Les trois clichés du panneau « Sandwichs » ne montrent pas les mêmes
  // références : chacun va sur les produits qu'il affiche réellement.
  Kefta: 'sandwichs2.jpeg',
  '4 Steaks': 'sandwichs2.jpeg',
  'Chèvre Miel': 'sandwichs2.jpeg',
  Spécial: 'sandwichs3.jpeg',
  Radical: 'sandwichs3.jpeg',
  Duo: 'sandwichs3.jpeg',
  Mexicain: 'sandwichs3.jpeg',
  Suprême: 'sandwichs3.jpeg',
  Buffalo: 'sandwichs3.jpeg',
  Royal: 'sandwichs3.jpeg',
  Beldi: 'sandwichs3.jpeg',

  // Burgers
  'Le Black': 'black-burger.webp',
  Fish: 'fish-burger.webp',
  'Le 180': 'mega-burger-long.webp',
  'Le 360': 'mega-burger-long.webp',
  'Le 540': 'mega-burger-long.webp',
  'Le Smash': 'smash-burger.webp',
  'Le Smash Chicken': 'smash-burger.webp',
  'Le Double Kif': 'smash-burger.webp',
  "Bun's": 'mega-burger-long.webp',

  // Plats
  'Compose ton Tacos': 'tacos-hero.webp',
  // Le tacos gratiné n'est aujourd'hui qu'une option de « Compose ton Tacos ».
  // L'entrée reste pour le jour où il devient un produit à part entière.
  'Tacos Gratiné': 'tacos-gratine-hero.webp',
  'Crousty One': 'crousty-riz.webp',
  'Class Bowl': 'bowls-suedois.jpeg',
  'Pain Suédois': 'bowls-suedois.jpeg',
  'Panini au choix': 'panini-menu.webp',
  'Salade César': 'salade-cesar.webp',

  // Tex-Mex & sucré
  Nuggets: 'nuggets.avif',
  'Mozza sticks': 'mozza-stick.webp',
  'Tarte au Daim': 'tarte-daim.webp',
  'Milkshake Oréo ou Bueno': 'milkshake-oreo.webp',
};

// ─────────────────────────────────────────────────────────────
// Repli par catégorie — chaque catégorie de la carte en a un,
// pour qu'aucune section du site ne reste grise.
// ─────────────────────────────────────────────────────────────

const PAR_CATEGORIE: Record<string, string> = {
  Sandwichs: 'sandwichs1.jpeg',
  'Gourmets Burgers': 'black-burger.webp',
  'Les Classiques': 'classiques.jpeg',
  'Class Bowl': 'bowls-suedois.jpeg',
  'Compose ton Tacos': 'tacos.jpeg',
  Assiettes: 'paninis.jpeg', // le panneau « Assiettes » est sur ce cliché
  "Bun's": 'mega-burger-long.webp',
  Paninis: 'paninis.jpeg',
  Hummers: 'hummers-stack.webp',
  Salades: 'salades-barquettes.jpeg',
  Barquettes: 'salades-barquettes.jpeg',
  'Pain Suédois': 'bowls-suedois.jpeg',
  'Menu Enfant': 'enfant-glaces.jpeg',
  // Aucun visuel de hot dog dans le lot : le panneau mural reste le choix
  // honnête — il montre la carte, pas un plat qu'on ne sert pas.
  'Hot Dogs': 'sandwichs3.jpeg',
  'Les Signatures': 'smash-burger.webp',
  'Crousty One': 'crousty-riz.webp',
  'Tex-Mex': 'hummers-texmex.jpeg',
  'Box à Partager': 'hummers-texmex.jpeg',
  Glaces: 'enfant-glaces.jpeg',
  Desserts: 'enfant-glaces.jpeg', // la tarte au Daim garde la sienne
  Milkshakes: 'milkshake-oreo.webp',
  Boissons: 'boissons.webp',
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Clé de comparaison insensible aux accents, à la casse et à la ponctuation :
 * « Salade César » et « salade cesar » désignent le même plat, et un tiret cadratin
 * recopié depuis la carte imprimée ne doit pas faire rater l'association.
 */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const index = (table: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(table).map(([k, v]) => [norm(k), v]));

/**
 * Les fichiers réellement présents. Une table qui pointe vers un visuel absent
 * ne doit pas écrire de chemin mort — mais elle ne doit pas non plus empêcher
 * le script de tourner : les visuels de repli par catégorie sont des clichés
 * de panneaux muraux, non versionnés faute de licence, et leur absence ne
 * justifie pas de priver de photo les produits qui en ont une. Un produit sans
 * photo tombe sur son monogramme, ce que les surfaces savent faire depuis
 * toujours.
 */
const DISPONIBLES: ReadonlySet<string> = existsSync(PHOTOS_DIR)
  ? new Set(readdirSync(PHOTOS_DIR))
  : new Set();

/** Ce que la table demande et que le dossier ne contient pas. */
function absents(table: Record<string, string>): string[] {
  if (DISPONIBLES.size === 0) return [];
  return [...new Set(Object.values(table))].filter((f) => !DISPONIBLES.has(f)).sort();
}

/** La table, privée de ses entrées sans fichier. */
function retenus(table: Record<string, string>): Record<string, string> {
  if (DISPONIBLES.size === 0) return table;
  return Object.fromEntries(Object.entries(table).filter(([, f]) => DISPONIBLES.has(f)));
}

const PRODUIT_IDX = index(retenus(PAR_PRODUIT));
const CATEGORIE_IDX = index(retenus(PAR_CATEGORIE));

const url = (file: string): string => `/photos/${file}`;

/** Produits jamais photographiés : `null`, champ absent ou chaîne vide. */
const SANS_PHOTO = {
  $or: [{ photoUrl: null }, { photoUrl: { $exists: false } }, { photoUrl: '' }],
};

/**
 * UNE PHOTO QUI POINTE VERS UN FICHIER DISPARU VAUT UNE ABSENCE DE PHOTO.
 *
 * Le 03/09/2026, la carte est passée en WebP : les treize `.png` ont été
 * convertis puis supprimés, et les tables de ce script ont suivi. Mais les
 * lignes DÉJÀ écrites en base, elles, pointaient toujours vers les `.png` —
 * trente-huit produits de staging affichaient une image morte, sans que rien
 * ne le signale.
 *
 * Le script applique donc aux photos déjà posées la règle qu'il applique déjà
 * aux tables : les fichiers sont la source de vérité. Une adresse relative
 * `/photos/<fichier>` dont le fichier n'est plus là est réattribuée comme si
 * le produit n'avait jamais eu de photo. Une adresse ABSOLUE, elle, n'est
 * jamais touchée : elle désigne un média déposé, que ce dossier ne connaît pas.
 */
const PREFIXE_PHOTOS = '/photos/';

function fichierHerite(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(PREFIXE_PHOTOS)) return null;
  return url.slice(PREFIXE_PHOTOS.length).split('?')[0] ?? null;
}

/** L'adresse pointe-t-elle vers un visuel que le dossier ne contient plus ? */
function photoMorte(url: unknown): boolean {
  if (DISPONIBLES.size === 0) return false;
  const fichier = fichierHerite(url);
  return fichier !== null && !DISPONIBLES.has(fichier);
}

// ─────────────────────────────────────────────────────────────

async function main() {
  /*
   * LES FICHIERS SONT LA SOURCE DE VÉRITÉ, PAS LES TABLES.
   *
   * Une entrée qui pointe vers un visuel absent est ÉCARTÉE, jamais écrite :
   * un chemin mort donnerait une vignette cassée en production. Mais elle
   * n'interrompt pas le script. Les dix clichés de panneaux muraux (.jpeg) ne
   * sont pas versionnés — leur licence ne le permet pas — et le script refusait
   * de démarrer pour eux, ce qui le rendait tout simplement inexécutable alors
   * que seize visuels parfaitement présents attendaient d'être rattachés.
   *
   * Un produit sans photo tombe sur son monogramme, ce que les surfaces savent
   * faire depuis toujours. Ne rien attacher du tout, en revanche, est le signe
   * d'un dossier vide ou d'un chemin faux : là, on refuse.
   */
  if (DISPONIBLES.size === 0) {
    console.warn(`⚠ ${PHOTOS_DIR} introuvable — vérification des fichiers ignorée.`);
  } else {
    const manquants = [...new Set([...absents(PAR_PRODUIT), ...absents(PAR_CATEGORIE)])].sort();
    if (manquants.length > 0) {
      console.warn(`⚠ ${manquants.length} visuel(s) référencé(s) sans fichier, écarté(s) :`);
      for (const f of manquants) console.warn(`    ${f}`);
      console.warn('  Les produits concernés garderont leur monogramme.');
    }
    if (PRODUIT_IDX.size === 0 && CATEGORIE_IDX.size === 0) {
      throw new Error(
        `Aucun visuel exploitable dans ${PHOTOS_DIR} — dossier vide, ou les tables ne ` +
          'correspondent à aucun fichier.',
      );
    }
  }

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const tenant = await db.collection('tenants').findOne({ slug: TENANT_SLUG }, { projection: { _id: 1 } });
  if (!tenant) throw new Error(`Tenant « ${TENANT_SLUG} » introuvable`);
  const tenantId = tenant._id;

  const categories = await db
    .collection('categories')
    .find({ tenantId }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const nomCategorie = new Map(categories.map((c) => [String(c._id), String(c.name)]));

  const products = db.collection('products');

  /*
   * Deux populations, une seule règle : le produit n'a pas de photo servable.
   * Celui qui n'en a jamais eu, et celui dont le fichier a disparu du dossier.
   * Les seconds sont relevés en mémoire — Mongo ne sait pas juger l'existence
   * d'un fichier — puis traités comme les premiers.
   */
  const avecPhoto = await products
    .find(
      { tenantId, photoUrl: { $exists: true, $nin: [null, ''] } },
      { projection: { _id: 1, name: 1, categoryId: 1, photoUrl: 1 } },
    )
    .toArray();
  const mortes = avecPhoto.filter((p) => photoMorte(p.photoUrl));
  if (mortes.length > 0) {
    console.warn(`⚠ ${mortes.length} produit(s) pointent vers un visuel disparu — réattribué(s) :`);
    for (const p of mortes.slice(0, 10)) console.warn(`    ${String(p.name)} → ${String(p.photoUrl)}`);
    if (mortes.length > 10) console.warn(`    … et ${mortes.length - 10} autre(s)`);
  }

  const produits = [
    ...(await products
      .find({ tenantId, ...SANS_PHOTO }, { projection: { _id: 1, name: 1, categoryId: 1 } })
      .toArray()),
    ...mortes,
  ];

  const dejaServis = await products.countDocuments({
    tenantId,
    photoUrl: { $exists: true, $nin: [null, ''] },
  });
  console.log(
    `Tenant ${TENANT_SLUG} — ${produits.length} produit(s) sans photo, ${dejaServis} déjà pourvu(s).`,
  );

  // `bulkWrite` reçoit un tableau en lecture seule : on extrait le type
  // d'élément pour construire une file mutable sans transtypage (même astuce
  // que dans backfill-tracking.ts).
  const ops: Parameters<typeof products.bulkWrite>[0][number][] = [];
  const orphelins: string[] = [];
  const utilises = new Set<string>();
  const parCategorie = new Map<string, number>();

  for (const p of produits) {
    const cat = p.categoryId ? (nomCategorie.get(String(p.categoryId)) ?? '') : '';
    const fichier = PRODUIT_IDX.get(norm(String(p.name))) ?? CATEGORIE_IDX.get(norm(cat));
    if (!fichier) {
      orphelins.push(`${cat || 'Non rattaché'} › ${String(p.name)}`);
      continue;
    }
    utilises.add(fichier);
    parCategorie.set(cat, (parCategorie.get(cat) ?? 0) + 1);
    ops.push({
      updateOne: {
        // Le filtre RE-VÉRIFIE l'absence de photo : entre la lecture et
        // l'écriture, le gérant a pu en choisir une dans le back-office.
        /*
         * Le filtre voyage AVEC l'écriture — une photo choisie à la main entre
         * la lecture et l'écriture ne doit pas être écrasée. Il accepte les
         * deux populations : jamais photographié, ou pointant vers un fichier
         * que le dossier ne contient plus.
         */
        filter: {
          _id: p._id,
          $or: [...SANS_PHOTO.$or, { photoUrl: { $in: mortes.map((m) => m.photoUrl) } }],
        },
        update: { $set: { photoUrl: url(fichier) } },
      },
    });
  }

  for (const [cat, n] of [...parCategorie.entries()].sort()) {
    console.log(`  ${cat || 'Non rattaché'} : ${n}`);
  }

  if (ops.length === 0) {
    console.log('✓ Rien à faire — toutes les photos sont déjà en place.');
  } else if (DRY) {
    console.log(
      `[--dry] ${ops.length} produit(s) recevraient une photo ` +
        `(${utilises.size} visuel(s) distinct(s)). Aucune écriture.`,
    );
  } else {
    const res = await products.bulkWrite(ops);
    console.log(`✓ ${res.modifiedCount} produit(s) mis à jour (${utilises.size} visuel(s) distinct(s)).`);
  }

  if (orphelins.length > 0) {
    console.log(`\n⚠ ${orphelins.length} produit(s) sans association :`);
    for (const o of orphelins) console.log(`  - ${o}`);
  }

  // Inventaire mesuré sur les TABLES, pas sur les écritures du jour : au
  // deuxième passage plus rien n'est écrit, et un décompte basé sur le run
  // déclarerait à tort les 27 visuels inutilisés.
  const references = new Set([...Object.values(PAR_PRODUIT), ...Object.values(PAR_CATEGORIE)]);
  const inutilises = existsSync(PHOTOS_DIR)
    ? readdirSync(PHOTOS_DIR)
        .filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f) && !references.has(f))
        .sort()
    : [];
  console.log(
    `\nVisuels référencés : ${references.size}` +
      (inutilises.length > 0 ? ` — non employés : ${inutilises.join(', ')}` : ''),
  );

  const apres = await products
    .find(
      { tenantId, photoUrl: { $exists: true, $nin: [null, ''] } },
      { projection: { _id: 1, photoUrl: 1 } },
    )
    .toArray();
  const restants =
    (await products.countDocuments({ tenantId, ...SANS_PHOTO })) +
    apres.filter((p) => photoMorte(p.photoUrl)).length;
  console.log(`\nProduits encore sans photo après passage : ${DRY ? '(simulation)' : restants}`);

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
