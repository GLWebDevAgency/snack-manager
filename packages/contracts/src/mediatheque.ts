import { z } from 'zod';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA MÉDIATHÈQUE — les images d'un restaurant, à lui, et qui lui survivent
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jusqu'ici une photo de plat était une CHAÎNE LIBRE sur le produit
 * (`Product.photoUrl`), sans validation d'URL ni de protocole, écrite par un
 * script de peuplement et par aucun écran. Deux défauts, du même coup :
 *
 *   1. Elle contournait la liste blanche d'origines (`origines-images.ts`) que
 *      les routes de masque appliquent depuis le 01/09/2026 : ce que le logo
 *      n'a pas le droit de faire — pointer vers l'hôte d'un tiers qui voit
 *      passer l'IP de tous les clients et décide de ce qui s'affiche — la
 *      photo d'un plat le pouvait.
 *   2. Une photo n'est PAS un attribut de produit. Le même cliché sert en
 *      vignette carrée à la caisse, en carte 4:3 sur la vitrine et en 16:9 au
 *      téléviseur ; il survit au produit qu'on renomme, qu'on scinde en deux
 *      tailles ou qu'on retire de la carte pour l'hiver. Un attribut de
 *      produit meurt avec lui, et se recopie quand on le duplique.
 *
 * Le média appartient donc au RESTAURANT. Le produit POINTE vers un à trois
 * médias, le premier étant sa photo principale, et `photoUrl` devient un
 * champ PLAT DÉRIVÉ de cette référence — exactement ce que `logoUrl` est à
 * `brand.logo` (`marque.ts`) : une source structurée, un champ plat dérivé,
 * un adaptateur de lecture unique (`photoUrlDe`, plus bas).
 *
 * ─── CE QUE CE MODULE NE FAIT PAS, ET POURQUOI ─────────────────────────────
 *
 * Il ne redimensionne RIEN. Aucune bibliothèque de traitement d'images n'entre
 * dans le dépôt pour cette version : les octets déposés sont servis tels
 * quels, par notre interface, avec un cache immuable d'un an — comme le logo
 * l'est déjà. Ce qui est prévu, en revanche, c'est le POINT D'EXTENSION :
 * `urlMedia(media, usage)` est la SEULE fonction qui construit l'adresse des
 * octets, et `MediaVue.urls` porte les quatre usages pré-calculés. Le jour où
 * un transformateur d'images se branche (Cloudflare Images, un worker maison),
 * ces quatre adresses se mettent à différer et PAS UN SEUL APPELANT ne change.
 * C'est la raison pour laquelle `usage` est OBLIGATOIRE dès aujourd'hui alors
 * que les quatre valeurs sont identiques : un appelant qui l'oublierait ne
 * casserait rien maintenant, et tout plus tard.
 */

// ─────────────────────────────────────────────────────────────
// Bornes et formats — le modèle du logo (`tenant.ts`), à l'échelle d'un plat
// ─────────────────────────────────────────────────────────────

/**
 * Taille maximale d'un média : 2 Mio.
 *
 * Le chiffre découle DIRECTEMENT du refus de redimensionner côté serveur : ce
 * qui est stocké est ce que TOUS les clients téléchargent, sur le forfait
 * mobile du mangeur, devant le comptoir. Une photo de plat en 1600 px de large
 * à qualité 82 pèse 250 à 500 Ko ; 2 Mio laisse donc quatre fois la marge
 * nécessaire tout en interdisant qu'un cliché brut de 8 Mio sorti d'un
 * téléphone parte sur la vitrine de tous ses clients.
 *
 * Corollaire, et c'est le travail de l'écran de dépôt : il RÉDUIT le cliché
 * dans le navigateur (canvas) avant l'envoi, aux cotes ci-dessous. Refuser un
 * fichier de téléphone sans le réduire d'abord serait refuser la seule source
 * de photos qu'un restaurateur possède.
 */
export const MEDIA_MAX_OCTETS = 2 * 1024 * 1024;

/**
 * Les cotes vers lesquelles l'écran de dépôt réduit AVANT d'envoyer.
 *
 * Partagées ici pour la même raison que `LOGO_MAX_OCTETS` : l'écran et l'API
 * doivent dire le même nombre. 1600 px couvre le plus exigeant des usages (le
 * bandeau 16:9 d'un téléviseur 1080p en tient 1920, et un léger étirement y
 * est invisible à trois mètres) sans qu'on serve du 4000 px à une vignette de
 * caisse de 160 px.
 */
export const MEDIA_LARGEUR_CIBLE = 1600;
export const MEDIA_QUALITE_CIBLE = 0.82;

/**
 * Quota d'octets par restaurant : 256 Mio.
 *
 * L'audit du 28/08 l'a nommé — AUCUNE limite métier par établissement
 * n'existait nulle part, et le stockage est le premier poste qui coûte à
 * l'usage (objets R2 + sortie d'octets par notre interface). 256 Mio, c'est
 * plus de cinq cents photos à 500 Ko : aucun restaurant n'y arrive avec une
 * carte de cent produits, et celui qui s'en approche a besoin qu'on lui parle
 * plutôt qu'on le laisse remplir un disque en silence.
 *
 * Ne comptent que les médias dont NOUS stockons les octets (`stockage:
 * 'objet'`). Les photos héritées du pilote vivent dans le paquet web et ne
 * nous coûtent rien de plus — les compter serait facturer un espace que
 * personne n'occupe.
 */
export const QUOTA_MEDIAS_OCTETS = 256 * 1024 * 1024;

/**
 * Formats admis — les MÊMES que le logo, et pas de SVG pour la même raison :
 * un SVG embarque du script, et une photo servie sur la page de commande
 * publique ne doit pas pouvoir en exécuter.
 *
 * Ni AVIF ni GIF : ils ne sont pas reconnus par la détection aux OCTETS
 * (`image-signature.ts`), et un format admis que le portier ne sait pas
 * reconnaître serait un format refusé à l'entrée avec un message faux.
 */
export const MEDIA_FORMATS_ADMIS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MediaFormatSchema = z.enum(MEDIA_FORMATS_ADMIS);
export type MediaFormat = z.infer<typeof MediaFormatSchema>;

/** Un produit porte UNE à TROIS photos. La première est la principale. */
export const MEDIAS_PAR_PRODUIT_MAX = 3;

/** Le texte alternatif est libre et facultatif — voir `texteAlternatif`. */
export const MEDIA_ALT_MAX = 200;

// ─────────────────────────────────────────────────────────────
// Le genre d'un média — c'est LUI qui décide de la garde
// ─────────────────────────────────────────────────────────────

/**
 * UN SEUL COMPARTIMENT DE STOCKAGE, ET LE GENRE DÉCIDE DE LA GARDE.
 *
 * Une photo de plat est PUBLIQUE : elle est faite pour être vue par le
 * mangeur, et la servir sans jeton est la seule façon qu'une vitrine, un
 * téléviseur et une caisse hors ligne l'affichent. Un document — une facture
 * fournisseur photographiée, le jour où l'approvisionnement en aura besoin —
 * ne l'est JAMAIS : il porte des prix d'achat, un SIRET, parfois un RIB.
 *
 * Les deux vivent dans le même bucket R2 et sous le même port `ImageStore` :
 * ce n'est pas le compartiment qui protège, c'est la ROUTE. Seul le genre
 * `photo` a une route publique ; le reste n'en aura jamais, quelle que soit
 * la clé d'objet qu'on lui donne.
 *
 * ─── L'OPTIMISATION D'APRÈS, ET CE QUI NE L'EMPÊCHE PAS ───
 *
 * Le jour où le volume le justifiera, les photos publiques déménageront dans
 * un bucket R2 PUBLIC, servi par son propre domaine, dont la sortie d'octets
 * est gratuite — là où la nôtre passe par Railway et se paie. Rien dans ce
 * modèle ne s'y oppose : l'adresse d'un média est construite en UN endroit
 * (`urlMedia`), le genre dit déjà lequel a le droit d'être public, et
 * l'empreinte du contenu fait que la même clé d'objet vaut dans les deux
 * mondes. Ce sera un changement de fabrique, pas une migration.
 */
export const MEDIA_GENRES = ['photo', 'document'] as const;
export const MediaGenreSchema = z.enum(MEDIA_GENRES);
export type MediaGenre = z.infer<typeof MediaGenreSchema>;

/** Les genres servis sans jeton. La liste est la garde, pas un commentaire. */
export const MEDIA_GENRES_PUBLICS: readonly MediaGenre[] = ['photo'];

export const estPublic = (genre: MediaGenre): boolean => MEDIA_GENRES_PUBLICS.includes(genre);

/**
 * OÙ VIVENT LES OCTETS.
 *
 *  · `objet`   — chez nous, dans le magasin d'images, sous une clé portant
 *                l'empreinte du contenu. C'est le cas de tout ce qui est
 *                déposé depuis le 02/09/2026.
 *  · `heritee` — les dix-neuf visuels du pilote, VERSIONNÉS dans le paquet
 *                web (`apps/web/public/photos/`) et servis par lui depuis le
 *                premier jour. La reprise les inscrit à la médiathèque pour
 *                que le restaurateur les voie, les décrive et les recadre —
 *                mais elle n'en fabrique pas une copie chez nous : ils sont
 *                déjà servis, ils ne coûtent rien de plus, et les dupliquer
 *                créerait deux vérités pour un même cliché.
 */
export const STOCKAGES_MEDIA = ['objet', 'heritee'] as const;
export const StockageMediaSchema = z.enum(STOCKAGES_MEDIA);
export type StockageMedia = z.infer<typeof StockageMediaSchema>;

/** D'où le média vient : déposé par le restaurateur, ou repris par nous. */
export const ORIGINES_MEDIA = ['depot', 'reprise'] as const;
export const OrigineMediaSchema = z.enum(ORIGINES_MEDIA);
export type OrigineMedia = z.infer<typeof OrigineMediaSchema>;

// ─────────────────────────────────────────────────────────────
// L'empreinte — l'adresse est immuable parce qu'elle vient du contenu
// ─────────────────────────────────────────────────────────────

/**
 * SHA-256 tronqué à 128 bits, en hexadécimal minuscule.
 *
 * ─── POURQUOI L'ADRESSE PORTE UNE EMPREINTE DU FICHIER ───
 *
 * La caisse fonctionne HORS LIGNE et garde un cache d'images. Si l'adresse
 * d'une photo changeait à chaque retouche de sa fiche — un texte alternatif
 * corrigé, un point d'intérêt déplacé — la tablette retéléchargerait toute la
 * carte, au comptoir, en plein service. L'adresse ne dépend donc QUE des
 * octets : décrire un média ne la touche pas, et remplacer les octets en
 * fabrique naturellement une autre. Le cache `immutable` d'un an sur la route
 * publique n'est alors pas une promesse en l'air, c'est une déduction.
 *
 * ─── LE COROLLAIRE GRATUIT : LE DÉDOUBLONNAGE ───
 *
 * Deux dépôts du même fichier ont la même empreinte, donc la même clé d'objet,
 * donc UN seul objet stocké et une seule ligne en médiathèque. Le restaurateur
 * qui redépose par erreur le cliché qu'il avait déjà ne paie pas deux fois et
 * ne voit pas deux vignettes identiques dans sa bibliothèque.
 *
 * 128 bits suffisent : l'espace de noms est un restaurant, pas Internet.
 */
export const EMPREINTE_LONGUEUR = 32;
export const EMPREINTE_RE = /^[0-9a-f]{32}$/;
export const EmpreinteSchema = z.string().regex(EMPREINTE_RE, 'Empreinte de média invalide');

// ─────────────────────────────────────────────────────────────
// Le point d'intérêt — sans lui, chaque surface coupe le plat ailleurs
// ─────────────────────────────────────────────────────────────

/**
 * LE POINT D'INTÉRÊT — coordonnées relatives, origine en haut à gauche.
 *
 * La même photo est recadrée en carré à la caisse (1:1), en carte sur la
 * vitrine (4:3) et en seize neuvièmes au téléviseur (16:9). Sans point commun,
 * chaque surface centre son recadrage et coupe le plat À TROIS ENDROITS
 * DIFFÉRENTS : le burger entier sur la fiche, sa moitié basse en vignette, ses
 * frites seules sur l'écran de salle. Le restaurateur ne comprend pas pourquoi,
 * et il a raison de ne pas comprendre.
 *
 * Relatives (0 à 1) et jamais en pixels : elles survivent au jour où l'on
 * servira des dérivés de tailles différentes.
 */
export const PointInteretSchema = z.object({
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
});
export type PointInteret = z.infer<typeof PointInteretSchema>;

/** Le défaut : le centre, c'est-à-dire ce que fait un navigateur sans consigne. */
export const POINT_CENTRE: PointInteret = { x: 0.5, y: 0.5 };

/**
 * Le point, traduit en `object-position` CSS.
 *
 * Écrit ICI et pas dans chaque surface : la vitrine, la caisse et l'écran de
 * salle sont trois applications distinctes, et trois traductions du même point
 * finiraient par arrondir différemment. Se pose tel quel sur une image en
 * `object-fit: cover`, qui est le recadrage de toutes nos surfaces.
 */
export function cadrageCss(point: PointInteret | null | undefined): string {
  const p = point ?? POINT_CENTRE;
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10}%`;
  return `${pct(p.x)} ${pct(p.y)}`;
}

// ─────────────────────────────────────────────────────────────
// Le texte alternatif — il ne bloque rien
// ─────────────────────────────────────────────────────────────

/**
 * LE TEXTE ALTERNATIF NE BLOQUE RIEN, ET C'EST CE QUI LE REND UTILE.
 *
 * Champ libre, vide autorisé, jamais exigé au dépôt. La surface RETOMBE sur le
 * nom du produit — « Kebab Fromage », « Salade César » — qui est le bon texte
 * alternatif dans l'immense majorité des cas, précisément parce que la photo
 * d'un plat sur une carte MONTRE ce plat et rien d'autre.
 *
 * Exiger une saisie aurait deux effets, tous deux mauvais : un restaurateur
 * pressé écrit « photo » ou « image1 » dans le champ obligatoire — un lecteur
 * d'écran y perd par rapport au repli — et le dépôt d'une photo devient une
 * corvée de deux champs au lieu d'un geste. On obtient donc gratuitement la
 * conformité qu'une obligation aurait dégradée, et le champ reste là pour les
 * cas où le nom ne suffit pas (« la salle en terrasse le soir »).
 */
export function texteAlternatif(alt: string | null | undefined, repli: string): string {
  const saisi = (alt ?? '').trim();
  return saisi === '' ? repli.trim() : saisi;
}

// ─────────────────────────────────────────────────────────────
// Les usages nommés, et LA fonction qui construit une adresse
// ─────────────────────────────────────────────────────────────

/**
 * LES QUATRE USAGES D'UNE MÊME PHOTO.
 *
 * Chacun porte son rapport et sa largeur nominale : c'est la SPÉCIFICATION que
 * lira le transformateur d'images le jour où il arrivera, et c'est déjà ce qui
 * permet à une surface de savoir quel recadrage elle applique autour du point
 * d'intérêt.
 */
export const USAGES_MEDIA = {
  /** La grille de la caisse : carré, petit, vu à trente centimètres. */
  vignette: { ratio: 1, largeur: 320 },
  /** La carte de la vitrine et du tunnel de commande. */
  carte: { ratio: 4 / 3, largeur: 640 },
  /** La fiche d'un produit, ouverte en grand sur un téléphone. */
  fiche: { ratio: 3 / 2, largeur: 1080 },
  /** Le téléviseur de salle, lu debout à trois mètres. */
  bandeau: { ratio: 16 / 9, largeur: 1600 },
} as const;

export const UsageMediaSchema = z.enum(
  Object.keys(USAGES_MEDIA) as [keyof typeof USAGES_MEDIA, ...(keyof typeof USAGES_MEDIA)[]],
);
export type UsageMedia = keyof typeof USAGES_MEDIA;
export const USAGES: readonly UsageMedia[] = Object.keys(USAGES_MEDIA) as UsageMedia[];

/**
 * Ce qu'il faut d'un média pour en construire l'adresse — et rien de plus.
 *
 * Un type à part de `MediaVue` : la vue est ce qui SORT vers les écrans, ceci
 * est ce qui vit en base. Les confondre ferait fuiter l'origine HTTP de dépôt
 * et l'identifiant du restaurant dans chaque charge publique.
 */
export type AdresseMedia = {
  stockage: StockageMedia;
  tenantId: string;
  empreinte: string;
  /**
   * L'origine http(s) sous laquelle ce média a été déposé, VALIDÉE contre la
   * liste blanche au moment du dépôt (`origines-images.ts`). Absolue, comme
   * `logoUrl` : la caisse, la cuisine et le téléviseur sont d'autres origines,
   * un chemin relatif y serait un lien mort.
   */
  base: string | null;
  /** Le nom de fichier, pour les seuls médias hérités du pilote. */
  fichier: string | null;
};

/**
 * LA SEULE FONCTION QUI CONSTRUIT L'ADRESSE DES OCTETS D'UN MÉDIA.
 *
 * Aujourd'hui les quatre usages rendent la MÊME adresse — les octets
 * d'origine, servis tels quels — et c'est délibéré : émettre quatre adresses
 * distinctes sans avoir de quoi les servir ferait retélécharger quatre fois le
 * même fichier à une caisse qui en cache un seul. `usage` est néanmoins
 * OBLIGATOIRE dès maintenant, pour que le jour où un transformateur se branche
 * ici, chaque appelant demande déjà la bonne chose.
 *
 * `heritee` : chemin RELATIF `/photos/<fichier>`, exactement ce que le pilote
 * sert depuis le premier jour (le site de commande et l'écran de salle sont la
 * même application Next, cf. `seed-photos.ts`). Le rendre absolu ici casserait
 * ces dix-neuf photos au premier changement de domaine, pour rien.
 */
export function urlMedia(media: AdresseMedia, usage: UsageMedia): string {
  // Le paramètre est le point d'extension : il ne change RIEN aujourd'hui.
  void usage;
  if (media.stockage === 'heritee') {
    return media.fichier ? `/photos/${media.fichier}` : '';
  }
  const base = (media.base ?? '').replace(/\/+$/, '');
  return `${base}/public/medias/${media.tenantId}/${media.empreinte}`;
}

/** Les quatre adresses, pré-calculées — voir `MediaVue.urls`. */
export function urlsMedia(media: AdresseMedia): Record<UsageMedia, string> {
  return {
    vignette: urlMedia(media, 'vignette'),
    carte: urlMedia(media, 'carte'),
    fiche: urlMedia(media, 'fiche'),
    bandeau: urlMedia(media, 'bandeau'),
  };
}

// ─────────────────────────────────────────────────────────────
// La vue projetée — ce que les écrans reçoivent, en liste blanche
// ─────────────────────────────────────────────────────────────

/**
 * UN MÉDIA TEL QU'IL SORT DE L'API.
 *
 * Projection en LISTE BLANCHE, comme partout : ni `base`, ni `tenantId`, ni
 * clé d'objet. Ce qu'un écran doit savoir pour peindre (les adresses, le
 * point, le texte alternatif, les cotes) et pour gérer (le poids, la date,
 * l'auteur, le nombre de produits qui s'en servent).
 *
 * `urls` porte les QUATRE usages : c'est ce qui permet à la caisse de prendre
 * `urls.vignette` et au téléviseur `urls.bandeau` sans jamais connaître la
 * règle qui les fabrique. Elles sont identiques aujourd'hui ; le jour où elles
 * cesseront de l'être, aucun appelant ne bougera.
 */
export type MediaVue = {
  id: string;
  genre: MediaGenre;
  empreinte: string;
  type: MediaFormat;
  octets: number;
  /** Lues DANS LES OCTETS quand l'en-tête du format les donne, `null` sinon. */
  largeur: number | null;
  hauteur: number | null;
  point: PointInteret;
  alt: string;
  stockage: StockageMedia;
  origine: OrigineMedia;
  /** Qui l'a déposé — `null` pour une reprise, qui n'a pas d'auteur humain. */
  auteur: { id: string; nom: string } | null;
  /** ISO 8601. */
  deposeLe: string | null;
  urls: Record<UsageMedia, string>;
  /**
   * Combien de produits s'en servent. Renseigné sur la liste du gérant —
   * c'est ce qui rend le retrait explicable plutôt que silencieux — et laissé
   * à 0 sur les charges publiques, qui n'ont pas à porter ce comptage.
   */
  utilisePar: number;
};

// ─────────────────────────────────────────────────────────────
// L'ADAPTATEUR DE LECTURE UNIQUE — `photoUrl` dérivé
// ─────────────────────────────────────────────────────────────

/**
 * LA CHAÎNE LIBRE HÉRITÉE, ramenée à ce qu'on accepte encore de servir.
 *
 * `Product.photoUrl` reste en base et n'est PLUS ÉCRIVABLE : les schémas de
 * création et de mise à jour ne le portent plus, et c'est ce qui ferme le
 * contournement de la liste blanche d'origines. Mais dix-neuf produits du
 * pilote en portent un aujourd'hui, et le vider d'un coup viderait leur carte
 * en service. On le LIT donc encore, en repli, exactement comme `marqueDeRepli`
 * lit le `logoUrl` d'avant le masque — et avec la même sévérité : ce qui ne
 * ressemble pas à une adresse qu'on servirait n'est pas servi.
 *
 * Deux formes admises, et deux seulement :
 *   · un chemin RACINE-RELATIF (`/photos/…`), servi par le paquet web ;
 *   · une URL http(s) absolue, pour ce qui aurait été posé à la main.
 *
 * `//exemple.fr/x` est refusé : il commence par une barre oblique mais
 * désigne un HÔTE TIERS (URL à protocole relatif) — c'est précisément le
 * contournement qu'on ferme, et il passait une vérification naïve du premier
 * caractère.
 */
export function photoHeritee(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const url = brut.trim();
  if (url === '') return null;
  if (url.startsWith('//')) return null;
  if (url.startsWith('/')) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Les références d'un produit, nettoyées et bornées à trois. */
export function mediasDuProduit(produit: { medias?: unknown }): string[] {
  const brut = Array.isArray(produit.medias) ? produit.medias : [];
  const ids = brut
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')))
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return [...new Set(ids)].slice(0, MEDIAS_PAR_PRODUIT_MAX);
}

/**
 * ═══ LE SEUL ADAPTATEUR DE LECTURE DE `photoUrl` ═══
 *
 * Toutes les charges publiques passent par ici — la vitrine, le tableau de
 * menu, la carte de la caisse, les données structurées. C'est la propriété qui
 * compte : `logoUrl` a mis trois surfaces à diverger avant que `logoUrlDe`
 * n'existe, et la photo d'un plat est lue par une surface de plus.
 *
 * L'ordre : la PREMIÈRE référence résolue gagne (c'est la photo principale),
 * la chaîne héritée ne sert qu'à défaut. Une référence qui ne résout pas —
 * média supprimé entre deux lectures — est ignorée, pas fatale : on descend à
 * la suivante, puis au repli. Un produit ne perd pas sa photo parce qu'une
 * ligne a disparu.
 */
export function photoUrlDe(
  produit: { medias?: unknown; photoUrl?: unknown },
  catalogue: ReadonlyMap<string, MediaVue>,
  usage: UsageMedia,
): string | null {
  for (const id of mediasDuProduit(produit)) {
    const media = catalogue.get(id);
    if (media && estPublic(media.genre)) {
      const url = media.urls[usage];
      if (url) return url;
    }
  }
  return photoHeritee(produit.photoUrl);
}

/**
 * Le texte alternatif effectif d'un produit — le média d'abord, son nom sinon.
 * Le pendant de `photoUrlDe` pour l'accessibilité, et le seul endroit où la
 * règle de repli du §7 est écrite.
 */
export function photoAltDe(
  produit: { medias?: unknown; name?: unknown },
  catalogue: ReadonlyMap<string, MediaVue>,
): string {
  const nom = String(produit.name ?? '');
  for (const id of mediasDuProduit(produit)) {
    const media = catalogue.get(id);
    if (media) return texteAlternatif(media.alt, nom);
  }
  return nom;
}

/** Le point d'intérêt de la photo principale — `null` si elle n'est pas à nous. */
export function photoPointDe(
  produit: { medias?: unknown },
  catalogue: ReadonlyMap<string, MediaVue>,
): PointInteret | null {
  for (const id of mediasDuProduit(produit)) {
    const media = catalogue.get(id);
    if (media) return media.point;
  }
  return null;
}

/** Le catalogue, dans la forme que les adaptateurs ci-dessus attendent. */
export const catalogueMedias = (medias: readonly MediaVue[]): Map<string, MediaVue> =>
  new Map(medias.map((m) => [m.id, m]));

// ─────────────────────────────────────────────────────────────
// Les schémas d'entrée des routes
// ─────────────────────────────────────────────────────────────

/**
 * Décrire un média : texte alternatif et point d'intérêt.
 *
 * Aucun `.default()`, comme `ProductUpdateSchema` — et pour l'incident qu'il
 * raconte : un `.partial()` qui conserve ses défauts réécrit en silence ce que
 * l'appelant n'a pas transmis. Un gérant qui déplace le point d'intérêt ne
 * doit pas perdre le texte alternatif qu'il avait saisi la veille.
 */
export const MediaDescribeSchema = z.object({
  alt: z.string().max(MEDIA_ALT_MAX).optional(),
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});
export type MediaDescribe = z.infer<typeof MediaDescribeSchema>;

/**
 * Rattacher et réorganiser les photos d'un produit — la LISTE COMPLÈTE, dans
 * l'ordre voulu, comme `ReorderSchema` le fait pour les catégories.
 *
 * Un seul geste pour attacher, détacher et réordonner : trois routes
 * distinctes auraient trois occasions de laisser le produit dans un état que
 * personne n'a demandé (deux principales, zéro après un détachement raté).
 * La liste vide est valide : c'est « ce plat n'a plus de photo ».
 */
export const ProduitMediasSchema = z.object({
  medias: z.array(z.string().min(1)).max(MEDIAS_PAR_PRODUIT_MAX),
});
export type ProduitMedias = z.infer<typeof ProduitMediasSchema>;

/** Le dépôt : le texte alternatif peut accompagner le fichier, il n'est jamais exigé. */
export const MediaDepotSchema = z.object({
  alt: z.string().max(MEDIA_ALT_MAX).optional(),
});

/**
 * L'état du quota, tel que l'écran du gérant le montre.
 *
 * Rendu à CHAQUE dépôt et sur la liste : un quota qu'on ne découvre qu'au
 * refus est un quota qui surprend, et une jauge à côté du bouton coûte deux
 * nombres.
 */
export type QuotaMedias = {
  octetsUtilises: number;
  octetsMax: number;
  medias: number;
};
