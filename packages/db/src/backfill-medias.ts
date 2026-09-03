/**
 * Inscrit à la MÉDIATHÈQUE les photos que les produits portaient en chaîne libre.
 *
 * Jusqu'au 02/09/2026, la photo d'un plat était un `photoUrl` — une chaîne sans
 * validation d'URL ni de protocole, posée par `seed-photos.ts` et par aucun
 * écran. Elle n'est plus écrivable (`ProductCreateSchema`, `ProductUpdateSchema`)
 * et n'est plus que le REPLI de lecture de `photoUrlDe`. Rien ne casse sans
 * cette reprise : les dix-neuf visuels du pilote continuent d'être servis par
 * le paquet web. Mais tant qu'ils ne sont pas des médias, le restaurateur ne
 * peut ni les voir dans sa bibliothèque, ni leur donner un texte alternatif, ni
 * déplacer leur point d'intérêt — c'est-à-dire rien faire de ce pour quoi la
 * médiathèque existe.
 *
 * ── CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT PAS ────────────────────────────
 *
 * Elle crée un média `stockage: 'heritee'` par FICHIER distinct, avec son
 * empreinte réelle (lue dans les octets), son type réel (idem) et ses cotes,
 * puis pose la référence sur les produits qui le désignaient. Elle ne COPIE
 * PAS les octets chez nous : ces fichiers sont versionnés dans
 * `apps/web/public/photos/` et servis par la même application Next que la
 * vitrine et l'écran de salle. Les dupliquer sur R2 créerait deux vérités pour
 * un même cliché, en ferait payer le stockage, et casserait le chemin relatif
 * `/photos/…` qui fonctionne pour les deux surfaces depuis le premier jour.
 * Le jour où le restaurateur redépose l'une de ces photos par l'écran, elle
 * devient un média `objet` comme les autres — et c'est le bon moment pour ça,
 * pas maintenant.
 *
 * Le DÉDOUBLONNAGE tombe tout seul : `doner-kebab.webp` sert trois produits et
 * ne donne qu'UNE ligne, parce que la clé est `(tenantId, empreinte)` et que
 * l'empreinte vient du contenu.
 *
 * ── GARANTIES ─────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer`. `$set` ciblé, jamais de `save()` sur un
 * document entier — un document Mongoose ré-enregistré a déjà effacé des prix
 * ici (`seed-photos.ts`). Chaque écriture porte son invariant dans son filtre :
 * elle ne s'applique qu'à un produit qui n'a TOUJOURS pas de média et dont le
 * `photoUrl` n'a pas changé depuis la lecture. Idempotente par construction :
 * un produit qui a déjà une référence est hors du lot.
 *
 *   pnpm --filter @sm/db backfill:medias                # montre
 *   pnpm --filter @sm/db backfill:medias --appliquer    # écrit
 *   pnpm --filter @sm/db backfill:medias --exiger-zero  # échoue s'il reste du travail
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { detecterImage, dimensionsImage, photoHeritee, type FormatImage } from '@sm/contracts';
import { exigerZero, lireDrapeaux } from './backfill-flags';
import { empreinteDe } from './media-empreinte';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

const PHOTOS_DIR = resolve(__dirname, '../../../apps/web/public/photos');

/** Le préfixe que `seed-photos.ts` a posé — la seule forme qu'on sait reprendre. */
const PREFIXE = '/photos/';

/** Le nom de fichier derrière un `photoUrl` hérité, ou `null`. */
export function fichierDe(photoUrl: unknown): string | null {
  const url = photoHeritee(photoUrl);
  if (url === null || !url.startsWith(PREFIXE)) return null;
  const nom = url.slice(PREFIXE.length);
  // Ni chemin, ni remontée : ces valeurs finissent en lecture de fichier.
  if (nom === '' || nom.includes('/') || nom.includes('..')) return null;
  return nom;
}

/** Ce qu'on sait d'un fichier après l'avoir lu — `null` s'il n'est pas lisible. */
export type FichierLu = {
  fichier: string;
  empreinte: string;
  type: FormatImage;
  octets: number;
  largeur: number | null;
  hauteur: number | null;
};

/**
 * LES OCTETS FONT FOI, ICI AUSSI.
 *
 * Le type vient de la signature et jamais de l'extension — un `.jpeg` qui
 * serait un AVIF entrerait sinon en base avec un type que la route publique
 * démentirait au premier service. Un fichier absent ou non reconnu est ÉCARTÉ
 * et nommé dans le compte rendu : son produit garde sa chaîne héritée, que le
 * repli sert toujours, et personne ne perd de photo.
 */
export function lireFichier(dossier: string, fichier: string): FichierLu | null {
  const chemin = resolve(dossier, fichier);
  if (!chemin.startsWith(dossier) || !existsSync(chemin)) return null;
  const corps = readFileSync(chemin);
  const type = detecterImage(corps);
  if (!type) return null;
  const cotes = dimensionsImage(corps);
  return {
    fichier,
    empreinte: empreinteDe(corps),
    type,
    octets: corps.length,
    largeur: cotes?.largeur ?? null,
    hauteur: cotes?.hauteur ?? null,
  };
}

/** Produits jamais repris : aucune référence de média, une chaîne héritée. */
const A_REPRENDRE = {
  photoUrl: { $exists: true, $nin: [null, ''] },
  $or: [{ medias: { $exists: false } }, { medias: { $size: 0 } }],
};

async function main(): Promise<void> {
  const drapeaux = lireDrapeaux();
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquante');

  if (!existsSync(PHOTOS_DIR)) {
    // Sans les fichiers, on ne peut ni empreinter ni typer : refuser tout de
    // suite vaut mieux qu'inscrire des médias dont on ignore le contenu.
    throw new Error(`${PHOTOS_DIR} introuvable — la reprise a besoin des octets.`);
  }

  await mongoose.connect(uri);
  const Product = mongoose.model(
    MODELS.Product.name,
    MODELS.Product.schema,
    MODELS.Product.collection,
  );
  const Media = mongoose.model(MODELS.Media.name, MODELS.Media.schema, MODELS.Media.collection);

  type Doc = { _id: unknown; tenantId?: unknown; name?: unknown; photoUrl?: unknown };
  const produits = (await Product.find(A_REPRENDRE, {
    tenantId: 1,
    name: 1,
    photoUrl: 1,
  }).lean()) as unknown as Doc[];

  // Regroupés par (restaurant, fichier) : c'est l'unité d'un média. Un même
  // cliché sert plusieurs plats et ne doit donner qu'une ligne.
  type Lot = { tenantId: string; fichier: string; produits: Doc[] };
  const lots = new Map<string, Lot>();
  const inconnus: string[] = [];

  for (const p of produits) {
    const fichier = fichierDe(p.photoUrl);
    const tenantId = String(p.tenantId ?? '');
    if (!fichier || !tenantId) {
      inconnus.push(`${String(p.name ?? p._id)} → ${String(p.photoUrl ?? '')}`);
      continue;
    }
    const cle = `${tenantId}:${fichier}`;
    const lot = lots.get(cle) ?? { tenantId, fichier, produits: [] };
    lot.produits.push(p);
    lots.set(cle, lot);
  }

  const lisibles: { lot: Lot; lu: FichierLu }[] = [];
  const illisibles: string[] = [];
  for (const lot of lots.values()) {
    const lu = lireFichier(PHOTOS_DIR, lot.fichier);
    if (lu) lisibles.push({ lot, lu });
    else illisibles.push(lot.fichier);
  }

  const dejaMedias = await Media.countDocuments({});
  console.log(
    `\n${produits.length} produit(s) à reprendre — base « ${mongoose.connection.name} »\n` +
      `  ${lots.size} couple(s) restaurant/fichier distinct(s)\n` +
      `  ${lisibles.length} fichier(s) lisible(s), ${illisibles.length} écarté(s)\n` +
      `  ${dejaMedias} média(s) déjà en médiathèque\n`,
  );

  for (const { lot, lu } of lisibles) {
    const cotes = lu.largeur ? `${lu.largeur}×${lu.hauteur}` : 'cotes inconnues';
    console.log(
      `  ${lot.fichier} · ${lu.type} · ${Math.round(lu.octets / 1024)} Ko · ${cotes} → ${lot.produits.length} plat(s)`,
    );
  }

  if (illisibles.length > 0) {
    console.log(
      `\n⚠  ${illisibles.length} fichier(s) absent(s) ou non reconnu(s) aux octets — écarté(s) :`,
    );
    for (const f of [...new Set(illisibles)].sort()) console.log(`   · ${f}`);
    console.log(
      '   Les plats concernés gardent leur chaîne héritée : le repli de lecture\n' +
        '   la sert toujours, personne ne perd de photo.',
    );
  }

  if (inconnus.length > 0) {
    console.log(`\n⚠  ${inconnus.length} produit(s) à la photo hors « /photos/… », non repris :`);
    for (const u of inconnus) console.log(`   · ${u}`);
  }

  /*
   * CE QUE `--exiger-zero` COMPTE : LE TRAVAIL QUE CETTE REPRISE SAIT FAIRE.
   *
   * `scripts/reprise-mongo.sh` relance chaque reprise après l'avoir appliquée
   * et exige qu'elle ne trouve plus rien. Compter TOUS les produits encore
   * porteurs d'une chaîne héritée ferait échouer cette relance pour toujours
   * dès qu'un fichier manque au dossier ou qu'une photo pointe ailleurs que
   * `/photos/…` — deux situations que ce script ne peut PAS résoudre et qu'il
   * ne prétend pas résoudre. Un code de sortie doit dire « il reste à faire ce
   * que je sais faire », sinon il ne dit plus rien et on cesse de le lire.
   *
   * Les écartés ne disparaissent pas pour autant : ils sont NOMMÉS juste
   * au-dessus, à chaque passage, jusqu'à ce qu'on s'en occupe à la main.
   */
  const aEcrire = lisibles.reduce((n, { lot }) => n + lot.produits.length, 0);
  const horsPortee = illisibles.length + inconnus.length;
  if (horsPortee > 0) {
    console.log(
      `\n   ${horsPortee} cas hors de portée de cette reprise — ils ne comptent pas dans\n` +
        "   --exiger-zero : le script ne sait pas les traiter, il les montre.",
    );
  }

  if (!drapeaux.appliquer || aEcrire === 0) {
    console.log(
      drapeaux.appliquer
        ? '\nRien à écrire.\n'
        : `\n[simulation] ${aEcrire} produit(s) recevraient une référence. Rien écrit — relancer avec --appliquer.\n`,
    );
    exigerZero(drapeaux, aEcrire, 'produit(s) restent à reprendre');
    await mongoose.disconnect();
    return;
  }

  let medias = 0;
  let rattaches = 0;
  for (const { lot, lu } of lisibles) {
    /*
     * `upsert` sur `(tenantId, empreinte)` — l'index unique de la collection.
     *
     * C'est ce qui rend la reprise idempotente ET compatible avec une photo
     * déjà déposée par l'écran : si le restaurateur a envoyé ce cliché avant
     * qu'on passe ici, la ligne existe et on la retrouve au lieu d'en créer une
     * seconde. `$setOnInsert` : on ne réécrit JAMAIS un média existant — son
     * texte alternatif et son point d'intérêt ont pu être posés à la main, et
     * une reprise qui les écraserait serait une reprise qui détruit.
     */
    const res = await Media.findOneAndUpdate(
      { tenantId: new mongoose.Types.ObjectId(lot.tenantId), empreinte: lu.empreinte },
      {
        $setOnInsert: {
          genre: 'photo',
          type: lu.type,
          octets: lu.octets,
          largeur: lu.largeur,
          hauteur: lu.hauteur,
          point: { x: 0.5, y: 0.5 },
          alt: '',
          stockage: 'heritee',
          origine: 'reprise',
          base: null,
          fichier: lu.fichier,
          auteurId: null,
          auteurNom: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (!res) continue;
    medias += 1;

    for (const p of lot.produits) {
      // L'INVARIANT DANS LE FILTRE : le produit n'a toujours pas de média et
      // porte toujours la même chaîne. Entre la lecture et ici, le gérant a pu
      // choisir une photo dans le back-office — on ne l'écrase pas.
      const r = await Product.updateOne(
        {
          _id: p._id,
          photoUrl: p.photoUrl,
          $or: [{ medias: { $exists: false } }, { medias: { $size: 0 } }],
        },
        { $set: { medias: [res._id] } },
      );
      rattaches += r.modifiedCount;
    }
  }

  const ignores = aEcrire - rattaches;
  console.log(`\n✓ ${medias} média(s) en médiathèque · ${rattaches} plat(s) rattaché(s).`);
  if (ignores > 0) {
    console.log(
      `⚠  ${ignores} écriture(s) sans effet : ces produits ont changé entre la lecture et\n` +
        "   l'écriture, ils n'ont pas été écrasés. La relance de contrôle les reprendra.",
    );
  }
  console.log('');

  // Même règle qu'au-dessus : ce qui restait à faire, moins ce qui a été fait.
  exigerZero(drapeaux, aEcrire - rattaches, 'produit(s) restent à reprendre');
  await mongoose.disconnect();
}

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier pour tester ses règles ouvre une
 * connexion à la base pointée par l'environnement et lance le traitement.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
