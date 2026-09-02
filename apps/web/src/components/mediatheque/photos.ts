"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LES PHOTOS D'UN PLAT — la réduction dans le navigateur, et rien d'autre
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ─── POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST OBLIGATOIRE ────────────
 *
 * La médiathèque refuse tout fichier de plus de deux mégaoctets
 * (`MEDIA_MAX_OCTETS`), et le contrat dit pourquoi : RIEN ne redimensionne
 * côté serveur, donc ce qui est stocké est exactement ce que chaque client
 * télécharge, sur son forfait mobile, devant le comptoir.
 *
 * Or un cliché de téléphone pèse trois à huit mégaoctets. Sans ce module,
 * l'écran de dépôt refuserait donc la SEULE source de photos qu'un
 * restaurateur possède — son téléphone, c'est-à-dire là où les photos sont
 * prises. La réduction n'est pas un confort : c'est ce qui rend la fonction
 * utilisable, et c'est la raison pour laquelle `MEDIA_LARGEUR_CIBLE` et
 * `MEDIA_QUALITE_CIBLE` sont au contrat plutôt qu'ici.
 *
 * ─── CE QUI EST PUR, ET POURQUOI C'EST SÉPARÉ ──────────────────────────────
 *
 * Tout ce qui DÉCIDE (le format est-il admis, faut-il réduire, vers quelles
 * cotes, quel nom porte le fichier de sortie, combien de plats n'ont pas de
 * photo, où en est le quota) est écrit en fonctions pures, testées sans
 * navigateur. Seul le geste qui DESSINE — décoder, peindre dans un canevas,
 * ré-encoder — a besoin d'un DOM, et il tient en trois fonctions à la fin du
 * fichier. C'est la frontière qui rend la partie difficile vérifiable.
 */

import {
  MEDIA_FORMATS_ADMIS,
  MEDIA_LARGEUR_CIBLE,
  MEDIA_MAX_OCTETS,
  MEDIA_QUALITE_CIBLE,
  detecterImage,
  dimensionsImage,
  photoUrlDe,
  type Dimensions,
  type FormatImage,
  type MediaVue,
  type QuotaMedias,
} from "@sm/contracts";

// ─────────────────────────────────────────────────────────────
// Les cotes visées
// ─────────────────────────────────────────────────────────────

/**
 * Les cotes de sortie d'une image, à ratio conservé — et JAMAIS d'agrandissement.
 *
 * Une photo déjà plus étroite que la cible est rendue telle quelle : l'étirer
 * à 1600 px n'ajouterait pas un pixel d'information, alourdirait le fichier
 * que tous les clients téléchargent, et rendrait flou ce qui était net.
 * L'inverse de ce qu'on cherche.
 */
export function cotesReduites(
  source: Dimensions,
  largeurCible: number = MEDIA_LARGEUR_CIBLE,
): Dimensions {
  const { largeur, hauteur } = source;
  if (!Number.isFinite(largeur) || !Number.isFinite(hauteur) || largeur <= 0 || hauteur <= 0) {
    return source;
  }
  if (largeur <= largeurCible) return { largeur, hauteur };
  // `max(1, …)` : un panorama de 8000 × 300 tomberait sinon à zéro pixel de
  // haut, et un canevas de hauteur nulle ne rend aucun blob.
  return {
    largeur: largeurCible,
    hauteur: Math.max(1, Math.round((hauteur * largeurCible) / largeur)),
  };
}

// ─────────────────────────────────────────────────────────────
// Le plan de dépôt — ce qu'on sait AVANT d'ouvrir l'image
// ─────────────────────────────────────────────────────────────

export type RefusPhoto = { ok: false; message: string };

export type PlanDeDepot =
  | RefusPhoto
  | {
      ok: true;
      type: FormatImage;
      /** Cotes lues dans l'en-tête — `null` quand le format ne les livre pas. */
      source: Dimensions | null;
      /** Cotes visées — `null` quand la source est inconnue (le décodage tranchera). */
      cible: Dimensions | null;
      /** Faut-il repasser par le canevas, ou les octets partent-ils intacts ? */
      reduire: boolean;
    };

/** Le fichier est-il un HEIC d'iPhone ? On ne le devine que pour mieux refuser. */
const HEIC = /\.(heic|heif)$/i;

/**
 * LE FORMAT SE JUGE SUR LES OCTETS, JAMAIS SUR L'EXTENSION.
 *
 * `detecterImage` est la même fonction que l'API applique à l'entrée : c'est
 * exactement ce qui garantit qu'un fichier admis ici est admis là-bas, et
 * qu'un refus tombe AVANT qu'on ait décodé, redimensionné et envoyé deux
 * mégaoctets pour rien.
 *
 * Le nom du fichier ne sert qu'à une chose, et jamais à décider : choisir la
 * bonne PHRASE de refus. Un HEIC d'iPhone n'est pas « un format non reconnu »
 * pour son propriétaire — c'est le format que son téléphone produit par
 * défaut, et la sortie tient en un réglage qu'on peut lui indiquer.
 */
export function planifierDepot(octets: Uint8Array, nomFichier = ""): PlanDeDepot {
  const type = detecterImage(octets);
  if (!type) {
    return {
      ok: false,
      message: HEIC.test(nomFichier)
        ? "Les photos HEIC de l'iPhone ne sont lisibles par aucun navigateur — dans Réglages ▸ Appareil photo ▸ Formats, choisissez « Plus compatible », ou renvoyez la photo en JPEG."
        : "Format non reconnu — envoyez la photo en PNG, JPEG ou WebP (le SVG est refusé : il peut embarquer du script).",
    };
  }

  const source = dimensionsImage(octets);
  // Deux motifs de repasser par le canevas, et ils sont indépendants : une
  // photo de 4000 px de large qui pèserait 900 Ko reste trop large pour ce
  // qu'on sert, et un fichier de 3 Mio en 1200 px reste trop lourd pour ce
  // qu'on stocke. Aucun des deux n'implique l'autre.
  const tropLarge = source !== null && source.largeur > MEDIA_LARGEUR_CIBLE;
  const tropLourde = octets.length > MEDIA_MAX_OCTETS;

  return {
    ok: true,
    type,
    source,
    cible: source ? cotesReduites(source) : null,
    reduire: tropLarge || tropLourde,
  };
}

/**
 * Le nom du fichier de sortie — l'extension suit le format RÉELLEMENT encodé.
 *
 * Le magasin ignore ce nom (l'adresse d'un média vient de l'empreinte de son
 * contenu, cf. `mediatheque.ts`), mais il voyage dans la partie multipart et
 * s'affiche dans le sélecteur de fichiers du navigateur : `plat.png` pour des
 * octets JPEG serait un mensonge gratuit.
 */
export function nomDeSortie(nom: string, type: FormatImage): string {
  const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  const base = (nom.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").trim();
  return `${(base || "photo").slice(0, 120)}.${extension}`;
}

// ─────────────────────────────────────────────────────────────
// Poids et quota — deux nombres, pas un tableau de bord
// ─────────────────────────────────────────────────────────────

/** 384 000 → « 375 Ko » · 3 400 000 → « 3,2 Mo ». */
export function poids(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return "—";
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} Mo`;
}

export type EtatQuota = {
  /** Part occupée, de 0 à 1 — bornée, une division par zéro ne rend pas NaN. */
  part: number;
  /** Le gérant doit-il en être averti AVANT de heurter la limite ? */
  serre: boolean;
  /** « 42 photos · 18,3 Mo sur 256 Mo » */
  phrase: string;
};

/**
 * L'ÉTAT DU QUOTA, DIT UNE FOIS ET SANS JAUGE.
 *
 * Le seuil est à 80 % et il est là pour une seule raison : un quota qu'on
 * découvre au refus est un quota qui surprend, et un restaurateur qui apprend
 * que sa médiathèque est pleine pendant qu'il photographie son plat du jour
 * abandonne. À l'inverse, une barre de progression permanente demande de
 * surveiller une ressource dont il n'a rien à faire tant qu'il en reste — on
 * ne montre donc le chiffre que là où il sert (au moment de déposer), et on ne
 * l'ALERTE qu'en approchant.
 */
export function etatDuQuota(quota: QuotaMedias): EtatQuota {
  const max = quota.octetsMax > 0 ? quota.octetsMax : 1;
  const part = Math.min(1, Math.max(0, quota.octetsUtilises / max));
  return {
    part,
    serre: part >= 0.8,
    phrase: `${quota.medias} photo${quota.medias > 1 ? "s" : ""} · ${poids(
      quota.octetsUtilises,
    )} sur ${poids(quota.octetsMax)}`,
  };
}

// ─────────────────────────────────────────────────────────────
// L'ordre des photos d'un plat, et le compte de celles qui manquent
// ─────────────────────────────────────────────────────────────

/**
 * Déplace une photo d'un cran — la PREMIÈRE est la principale.
 *
 * Réordonner n'est donc pas cosmétique : c'est le geste qui change la photo
 * affichée sur la caisse, la vitrine et le téléviseur, sans qu'aucune adresse
 * ne change (cf. `photoUrlDe`, qui prend la première référence résolue). Un
 * pas hors des bornes rend la liste INCHANGÉE plutôt qu'une liste tronquée :
 * une flèche grisée peut toujours être atteinte au clavier.
 */
export function deplacer<T>(liste: readonly T[], index: number, pas: number): T[] {
  const vers = index + pas;
  if (index < 0 || index >= liste.length || vers < 0 || vers >= liste.length) {
    return [...liste];
  }
  const suite = [...liste];
  const [element] = suite.splice(index, 1);
  suite.splice(vers, 0, element as T);
  return suite;
}

/**
 * Combien de plats n'ont AUCUNE photo à montrer.
 *
 * Le compte passe par `photoUrlDe`, l'adaptateur de lecture unique, et pas par
 * `medias.length === 0` : les dix-neuf plats du pilote portent encore leur
 * chaîne héritée, ils ont bel et bien une photo à l'écran, et les compter
 * comme manquants enverrait le restaurateur chercher un problème qui n'existe
 * pas. Un média référencé mais disparu, lui, est bien compté comme manquant —
 * c'est ce que le mangeur voit.
 */
export function produitsSansPhoto(
  produits: readonly { medias?: unknown; photoUrl?: unknown }[],
  catalogue: ReadonlyMap<string, MediaVue>,
): number {
  return produits.filter((p) => photoUrlDe(p, catalogue, "vignette") === null).length;
}

// ─────────────────────────────────────────────────────────────
// LA RÉDUCTION — la seule partie qui a besoin d'un navigateur
// ─────────────────────────────────────────────────────────────

export type ResultatReduction =
  | RefusPhoto
  | {
      ok: true;
      /** Le fichier à envoyer : le cliché d'origine, ou sa réduction. */
      fichier: File;
      /** A-t-on repassé par le canevas ? Sert la phrase montrée au gérant. */
      reduit: boolean;
      octetsAvant: number;
      octetsApres: number;
      cotes: Dimensions | null;
    };

/**
 * RÉDUIT UN CLICHÉ POUR L'ENVOI — ou le laisse strictement intact.
 *
 * L'ordre des gestes n'est pas arbitraire :
 *
 *   1. les OCTETS décident du format (`planifierDepot`) — un fichier refusé
 *      l'est en quelques millisecondes, sans décodage ni téléversement ;
 *   2. une image déjà aux cotes et sous la limite repart TELLE QUELLE. La
 *      ré-encoder dégraderait une image que personne n'a demandé de dégrader,
 *      et lui donnerait surtout une empreinte différente — le dédoublonnage
 *      de la médiathèque, qui repose sur le contenu, cesserait de reconnaître
 *      un fichier déjà déposé ;
 *   3. sinon, on décode, on peint aux cotes visées, on ré-encode à la qualité
 *      du contrat, et on vérifie le résultat avant de le rendre.
 */
export async function reduirePourEnvoi(fichier: File): Promise<ResultatReduction> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const plan = planifierDepot(octets, fichier.name);
  if (!plan.ok) return plan;

  if (!plan.reduire) {
    return {
      ok: true,
      fichier,
      reduit: false,
      octetsAvant: fichier.size,
      octetsApres: fichier.size,
      cotes: plan.source,
    };
  }

  const image = await decoder(fichier);
  if (!image) {
    return {
      ok: false,
      message:
        "Cette photo n'a pas pu être ouverte — le fichier est peut-être incomplet. Réessayez, ou choisissez-en une autre.",
    };
  }

  // Les cotes viennent de l'image DÉCODÉE et non de l'en-tête : une photo
  // prise en portrait porte sa rotation dans son Exif, et le décodeur la
  // redresse. L'en-tête, lui, annonce encore les cotes du capteur.
  const cible = cotesReduites({ largeur: image.largeur, hauteur: image.hauteur });
  const canevas = peindre(image, cible);
  if (!canevas) {
    return {
      ok: false,
      message: "Votre navigateur n'a pas pu préparer la photo — réessayez, ou changez de navigateur.",
    };
  }

  let sortie = await encoder(canevas, plan.type);
  /*
   * LE PNG EST SANS PERTE — donc parfois toujours trop lourd.
   *
   * Un cliché de plat enregistré en PNG ne compresse presque rien : réduit à
   * 1600 px il peut encore dépasser deux mégaoctets, et `toBlob` ignore la
   * qualité pour ce format. Le JPEG est alors le dernier recours — il perd la
   * transparence, mais une photo de plat n'en a pas, et le refus sec priverait
   * le gérant d'une photo parfaitement servable.
   *
   * Le même filet rattrape un navigateur qui ne sait pas encoder en WebP :
   * `toBlob` retombe silencieusement sur du PNG, et on le voit à la taille.
   */
  if (sortie && sortie.size > MEDIA_MAX_OCTETS && sortie.type !== "image/jpeg") {
    sortie = (await encoder(canevas, "image/jpeg")) ?? sortie;
  }

  if (!sortie) {
    return {
      ok: false,
      message: "Votre navigateur n'a pas pu enregistrer la photo réduite — réessayez.",
    };
  }
  if (sortie.size > MEDIA_MAX_OCTETS) {
    // Rarissime (1600 px à 82 % pèsent 250 à 500 Ko) : on le dit franchement
    // plutôt que de laisser l'API refuser un fichier qu'on vient de fabriquer.
    return {
      ok: false,
      message: `Même réduite, cette photo pèse ${poids(sortie.size)} — la limite est de ${poids(
        MEDIA_MAX_OCTETS,
      )}. Essayez une photo moins détaillée.`,
    };
  }

  const type = formatAdmis(sortie.type) ?? plan.type;
  return {
    ok: true,
    fichier: new File([sortie], nomDeSortie(fichier.name, type), { type }),
    reduit: true,
    octetsAvant: fichier.size,
    octetsApres: sortie.size,
    cotes: cible,
  };
}

const formatAdmis = (type: string): FormatImage | null =>
  (MEDIA_FORMATS_ADMIS as readonly string[]).includes(type) ? (type as FormatImage) : null;

/** Une image décodée, ramenée à ce dont le canevas a besoin. */
type ImageDecodee = { source: CanvasImageSource; largeur: number; hauteur: number };

/**
 * Décode le fichier, en redressant l'orientation Exif.
 *
 * `createImageBitmap` avec `imageOrientation: 'from-image'` est la seule voie
 * qui garantisse le redressement : sans lui, une photo prise en portrait est
 * peinte couchée dans le canevas — le navigateur n'applique l'Exif qu'à
 * l'affichage, pas au dessin. Le repli par `<img>` existe pour les moteurs qui
 * refusent cette option ; les navigateurs récents y redressent aussi, et un
 * cliché couché resterait de toute façon préférable à un dépôt impossible.
 */
async function decoder(fichier: Blob): Promise<ImageDecodee | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
      return { source: bitmap, largeur: bitmap.width, hauteur: bitmap.height };
    } catch {
      // Option inconnue ou fichier illisible : on tente le chemin historique.
    }
  }
  return await new Promise<ImageDecodee | null>((resolve) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, largeur: img.naturalWidth, hauteur: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Peint l'image aux cotes visées. `null` si le contexte 2D est refusé. */
function peindre(image: ImageDecodee, cible: Dimensions): HTMLCanvasElement | null {
  const canevas = document.createElement("canvas");
  canevas.width = cible.largeur;
  canevas.height = cible.hauteur;
  const ctx = canevas.getContext("2d");
  if (!ctx) return null;
  // Un réglage, pas une astuce : sans lui, réduire d'un facteur deux ou trois
  // en une passe crénelle les arêtes (le bord d'une assiette, un lettrage).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image.source, 0, 0, cible.largeur, cible.hauteur);
  if ("close" in image.source && typeof image.source.close === "function") {
    image.source.close(); // un ImageBitmap garde ses pixels tant qu'on le tient
  }
  return canevas;
}

/** `toBlob`, en promesse. La qualité est ignorée par le PNG, et c'est normal. */
function encoder(canevas: HTMLCanvasElement, type: FormatImage): Promise<Blob | null> {
  return new Promise((resolve) => {
    canevas.toBlob((blob) => resolve(blob), type, MEDIA_QUALITE_CIBLE);
  });
}
