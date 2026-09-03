/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ÉDITEUR DE MARQUE — tout ce qui se décide sans navigateur
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le masque d'identité est livré et durci depuis deux jours : cinq rôles de
 * couleur stockés, une cinquantaine de variables dérivées, six directions,
 * dix-neuf couples de contraste jugés — et AUCUN écran pour en changer quoi
 * que ce soit. `PATCH /tenants/me/marque` n'avait aucun appelant dans le web.
 *
 * Ce module porte les décisions de cet écran, séparées du rendu pour qu'elles
 * se prouvent : quel rôle une correction de contraste réécrit, quelle
 * direction un masque porte encore, quel emplacement d'image accepte quel
 * média, et comment un refus du serveur se dit à un restaurateur.
 *
 * ─── CE QU'IL NE FAIT PAS ──────────────────────────────────────────────────
 *
 * Il ne recalcule RIEN de ce que le contrat calcule déjà. Le contraste, les
 * nuances de correction, les variables du masque et les directions viennent
 * de `@sm/contracts` — la même fonction que l'API rejoue à l'écriture. Un
 * second jugement écrit ici finirait par diverger du sien, et l'écran
 * promettrait un enregistrement que le serveur refuserait.
 */

import {
  BRAND_MOTIONS,
  BRAND_SHAPES,
  DIRECTIONS,
  HEX,
  IMAGE_URL,
  PRESET_KEYS,
  USAGES_MEDIA,
  type Brand,
  type BrandMotion,
  type BrandPalette,
  type BrandShape,
  type CoupleContraste,
  type MediaVue,
  type PresetKey,
  type TypePairKey,
  type UsageMedia,
  type Verdict,
} from "@sm/contracts";

// ─────────────────────────────────────────────────────────────
// Les cinq rôles stockés — et rien d'autre
// ─────────────────────────────────────────────────────────────

export type CleRole = keyof BrandPalette;

/**
 * Les cinq couleurs que le restaurateur POSE. Tout le reste — l'encre
 * atténuée, le filet ferme, l'anneau de focus, les lavis, les sémantiques —
 * en découle (`resoudreMarque`), et n'a donc pas de champ ici.
 *
 * `role` dit à quoi la couleur sert dans SA vitrine, pas ce qu'elle est : un
 * restaurateur ne choisit pas « ink », il choisit la couleur de son texte.
 */
export const ROLES: readonly { cle: CleRole; nom: string; role: string }[] = [
  { cle: "ground", nom: "Le fond", role: "La page entière — c'est la couleur qu'on voit le plus." },
  { cle: "surface", nom: "Les cartes", role: "Les blocs posés sur le fond : un plat, un bloc de la commande." },
  { cle: "ink", nom: "Le texte", role: "Les titres et les mots. Il doit se lire sur le fond ET sur les cartes." },
  { cle: "accent", nom: "L'accent", role: "Le bouton « Commander », le prix mis en avant. Rare, donc fort." },
  { cle: "onAccent", nom: "Le texte sur l'accent", role: "Ce qui s'écrit DANS le bouton d'accent." },
];

// ─────────────────────────────────────────────────────────────
// Les six directions, les dix accords, les formes, les mouvements
// ─────────────────────────────────────────────────────────────

/**
 * Un nom et une phrase par direction.
 *
 * Le contrat ne porte que les clés (`PRESET_KEYS`) : nommer une direction est
 * une décision d'ÉCRAN, et elle n'a rien à faire dans un module que l'API
 * importe. La phrase dit la SALLE, jamais la couleur — « crème et bordeaux »
 * ne dit rien à qui n'a pas déjà l'image ; la vignette, elle, montre.
 */
export const DIRECTIONS_LABELS: Record<PresetKey, { nom: string; phrase: string }> = {
  brasserie: { nom: "Brasserie", phrase: "Nappe crème, bordeaux, ardoise du jour." },
  neon: { nom: "Néon", phrase: "Comptoir de nuit, enseigne acide, service rapide." },
  atelier: { nom: "Atelier", phrase: "Papier kraft, terre cuite, prix à la craie." },
  marche: { nom: "Marché", phrase: "Étal du matin, vert franc, tout est frais." },
  nuit: { nom: "Nuit", phrase: "Laiton sur noir — la peau de Snack Manager." },
  soleil: { nom: "Soleil", phrase: "Sable, safran, terrasse plein sud." },
};

/** Le caractère de chaque accord typographique — la vignette montre le reste. */
export const PAIRES_LABELS: Record<TypePairKey, string> = {
  brasserie: "Empattements chaleureux",
  neon: "Grotesque affirmé",
  atelier: "Une seule famille, prix en chasse fixe",
  marche: "Rondeurs lisibles",
  nuit: "Classique élancé",
  soleil: "Généreux et ouvert",
  editorial: "Magazine, contraste marqué",
  moderne: "Neutre et net",
  classique: "Livre imprimé",
  brut: "Massif, prix en chasse fixe",
};

export const FORMES: Record<BrandShape, { nom: string; phrase: string }> = {
  net: { nom: "Net", phrase: "Angles francs" },
  doux: { nom: "Doux", phrase: "Coins adoucis" },
  rond: { nom: "Rond", phrase: "Tout en galets" },
};

export const MOUVEMENTS: Record<BrandMotion, { nom: string; phrase: string }> = {
  pose: { nom: "Posé", phrase: "Les transitions prennent leur temps" },
  vif: { nom: "Vif", phrase: "Tout répond au quart de tour" },
};

/** L'ordre d'affichage vient du contrat — pas d'une liste recopiée qui dérive. */
export const CLES_DIRECTIONS = PRESET_KEYS;
export const CLES_FORMES = BRAND_SHAPES;
export const CLES_MOUVEMENTS = BRAND_MOTIONS;

// ─────────────────────────────────────────────────────────────
// Les verdicts de contraste, dits à un restaurateur
// ─────────────────────────────────────────────────────────────

/**
 * CE QUE CHAQUE COUPLE VEUT DIRE POUR CELUI QUI TIENT LE COMPTOIR.
 *
 * `contraste()` rend `ink/surface` ou `gaugeTrack/accent` : des noms de
 * jetons, écrits pour du code. Les afficher tels quels ferait de l'unique
 * écran d'accessibilité du produit une liste d'identifiants — et le
 * restaurateur, faute de comprendre ce qui échoue, garderait un masque
 * illisible plutôt que de le corriger.
 *
 * Les trois premiers sont les couples STOCKÉS : ce sont les seuls qu'il pose
 * lui-même, et les seuls qui portent une `proposition`. Les autres sont
 * DÉRIVÉS — il ne les choisit pas, mais quand l'un d'eux tombe, c'est sa
 * palette qui rend la dérivation impossible, et il doit savoir laquelle.
 */
export const COUPLES_LABELS: Record<CoupleContraste, string> = {
  "ink/ground": "Le texte sur le fond",
  "ink/surface": "Le texte sur les cartes",
  "onAccent/accent": "Le texte dans le bouton d'accent",
  "accentInk/ground": "Un titre d'accent sur le fond",
  "accentInk/surface": "Un titre d'accent sur une carte",
  "accentInk/accentWash": "Un titre d'accent sur son propre lavis",
  "inkMut/ground": "Le texte secondaire sur le fond",
  "inkMut/surface": "Le texte secondaire sur une carte",
  "inkMut/elevation": "Le texte secondaire sur une tuile",
  "onMut/mut": "Le libellé d'une pastille grise",
  "greenInk/greenWash": "Le vert « prêt »",
  "redInk/redWash": "Le rouge « rupture »",
  "amberInk/amberWash": "L'ambre « en préparation »",
  "focus/ground": "L'anneau de sélection au clavier, sur le fond",
  "focus/surface": "L'anneau de sélection au clavier, sur une carte",
  "lineFirm/ground": "Le contour d'un champ, sur le fond",
  "lineFirm/surface": "Le contour d'un champ, sur une carte",
  "lineFirm/elevation": "Le contour d'un champ, sur une tuile",
  "gaugeTrack/accent": "La piste d'une jauge sous son remplissage",
};

/**
 * QUEL RÔLE UNE CORRECTION RÉÉCRIT.
 *
 * Un verdict en échec porte `proposition` : la nuance la plus proche qui
 * passe. Elle remplace la couleur d'AVANT-PLAN du couple — mais l'écran doit
 * savoir DANS QUEL CHAMP la poser, et ce lien n'est écrit nulle part au
 * contrat. Il l'est ici, et il est prouvé : le test confronte cette table à
 * `contraste()` lui-même, en vérifiant que la nuance proposée, posée dans le
 * rôle rendu, fait bien repasser le couple.
 *
 * `null` pour tous les couples DÉRIVÉS : ils ne portent jamais de
 * proposition, et il n'existe aucun champ où l'écrire.
 */
export function roleCorrige(couple: CoupleContraste): CleRole | null {
  switch (couple) {
    case "ink/ground":
    case "ink/surface":
      return "ink";
    case "onAccent/accent":
      return "onAccent";
    default:
      return null;
  }
}

/**
 * Ce qu'un couple dérivé en échec dit VRAIMENT au restaurateur.
 *
 * Il n'a aucun bouton à presser : la nuance qui échoue est calculée, pas
 * posée. Ce qu'il peut faire, en revanche, c'est écarter les deux couleurs
 * dont elle découle — et c'est ce que la phrase nomme.
 */
export const REMEDE_DERIVE =
  "Cette nuance est calculée à partir de vos couleurs : aucune ne convient. Écartez votre fond de vos cartes, ou votre accent de votre fond.";

/** Les couples que le restaurateur POSE — les seuls corrigeables en un geste. */
export const verdictsPosables = (verdicts: readonly Verdict[]): Verdict[] =>
  verdicts.filter((v) => !v.derive);

/** Les couples DÉRIVÉS en échec — les seuls qui méritent d'être montrés. */
export const verdictsDerivesEnEchec = (verdicts: readonly Verdict[]): Verdict[] =>
  verdicts.filter((v) => v.derive && !v.ok);

/** « 3,12:1 » — deux décimales, virgule française, comme partout ailleurs. */
export const ratioDit = (ratio: number): string =>
  `${ratio.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}:1`;

// ─────────────────────────────────────────────────────────────
// Poser une direction, et savoir laquelle on porte encore
// ─────────────────────────────────────────────────────────────

/**
 * LA DIRECTION QUE CE MASQUE PORTE ENCORE — recalculée, jamais crue sur parole.
 *
 * `brand.preset` est un champ STOCKÉ : il reste « brasserie » après que le
 * gérant a changé son accent, et la vignette resterait cochée sur une
 * direction que le masque ne porte plus. On ne lit donc jamais le champ pour
 * décider de la coche — on compare ce qui est peint (palette, accord,
 * forme, mouvement, mode) aux six directions.
 *
 * Les IMAGES ne comptent pas dans la comparaison, et c'est la raison d'être
 * de cette fonction : les six directions du contrat sont livrées SANS logo
 * (`sansLogos`), alors qu'un restaurateur qui choisit « Brasserie » garde le
 * sien. Un masque « Brasserie avec logo » est bien une Brasserie.
 */
export function directionPortee(brand: Brand): PresetKey | null {
  const memePalette = (a: BrandPalette, b: BrandPalette) =>
    ROLES.every(({ cle }) => a[cle] === b[cle]);
  return (
    PRESET_KEYS.find((cle) => {
      const d = DIRECTIONS[cle];
      return (
        d.mode === brand.mode &&
        d.shape === brand.shape &&
        d.motion === brand.motion &&
        d.type.pair === brand.type.pair &&
        memePalette(d.palette, brand.palette)
      );
    }) ?? null
  );
}

/**
 * Poser une direction REMPLACE le masque — sauf les images.
 *
 * Les six directions sont livrées sans logo ni photo d'accueil. Les appliquer
 * telles quelles effacerait, d'un clic sur une vignette, les cinq images que
 * le restaurateur vient de choisir — un geste de mise en page ne détruit pas
 * un fichier. Le `preset` stocké est reposé au passage : c'est le seul moment
 * où il redevient vrai.
 */
export function appliquerDirection(brand: Brand, cle: PresetKey): Brand {
  const d = DIRECTIONS[cle];
  return { ...d, logo: brand.logo, hero: brand.hero, preset: cle };
}

/**
 * Toute retouche manuelle REPOSE le champ `preset` sur ce qui est vraiment
 * peint — sinon un masque stocké prétendrait être une Brasserie avec un accent
 * qu'aucune Brasserie n'a jamais eu, et la fiche CRM le répéterait.
 */
export const retouche = (brand: Brand): Brand => ({ ...brand, preset: directionPortee(brand) });

/** Sans dièse ni casse imposée à la saisie — on normalise à la frappe. */
export function normaliserHex(saisie: string): string {
  const hex = saisie.trim().replace(/^#?/, "#").toLowerCase();
  return HEX.test(hex) ? hex : saisie.trim();
}

export const hexValide = (valeur: string): boolean => HEX.test(valeur);

// ─────────────────────────────────────────────────────────────
// Les cinq emplacements d'image
// ─────────────────────────────────────────────────────────────

export type CleEmplacement =
  | "mark.light"
  | "mark.dark"
  | "lockup.light"
  | "lockup.dark"
  | "hero";

export type Emplacement = {
  cle: CleEmplacement;
  nom: string;
  aide: string;
  /**
   * Le fond sur lequel cette déclinaison est RÉELLEMENT posée — c'est ce que
   * l'aperçu de la vignette doit peindre. Un logo dessiné pour fond sombre
   * présenté sur du blanc a l'air cassé, et inversement : montrer les deux
   * déclinaisons sur le même fond ferait choisir à l'aveugle.
   * `masque` : l'image d'accueil, qui vit sur le fond du masque en cours.
   */
  fond: "clair" | "sombre" | "masque";
  /**
   * L'usage sous lequel l'adresse du média est prise. Les quatre usages
   * rendent aujourd'hui la MÊME adresse (`urlMedia` : « le paramètre est le
   * point d'extension, il ne change rien aujourd'hui ») — le jour où un
   * transformateur se branchera, l'accueil voudra son 16:9 et les logos, eux,
   * voudront un usage à eux : un logo ne se recadre pas.
   */
  usage: UsageMedia;
  /** Côté minimal (spec §7, « marque ≥ 256 px »). */
  coteMin: number | null;
  /** Largeur minimale (spec §7, « horizontale ≥ 512 px de large »). */
  largeurMin: number | null;
};

export const EMPLACEMENTS: readonly Emplacement[] = [
  {
    cle: "mark.dark",
    nom: "Marque, version sombre",
    aide: "Votre symbole seul, dessiné pour être posé sur un fond sombre.",
    fond: "sombre",
    usage: "fiche",
    coteMin: 256,
    largeurMin: null,
  },
  {
    cle: "mark.light",
    nom: "Marque, version claire",
    aide: "Le même symbole, dessiné pour un fond clair.",
    fond: "clair",
    usage: "fiche",
    coteMin: 256,
    largeurMin: null,
  },
  {
    cle: "lockup.dark",
    nom: "Horizontale, version sombre",
    aide: "Symbole et nom côte à côte — l'en-tête d'un large écran.",
    fond: "sombre",
    usage: "fiche",
    coteMin: null,
    largeurMin: 512,
  },
  {
    cle: "lockup.light",
    nom: "Horizontale, version claire",
    aide: "La même, pour un fond clair.",
    fond: "clair",
    usage: "fiche",
    coteMin: null,
    largeurMin: 512,
  },
  {
    cle: "hero",
    nom: "Image d'accueil",
    aide: "La photo qui ouvre votre page de commande — une salle, un plat, votre devanture.",
    fond: "masque",
    usage: "bandeau",
    coteMin: null,
    // Pas un nombre inventé : c'est la largeur nominale de l'usage « bandeau »
    // au contrat, et c'est aussi celle à laquelle le dépôt réduit.
    largeurMin: USAGES_MEDIA.bandeau.largeur,
  },
];

export function lireEmplacement(brand: Brand, cle: CleEmplacement): string | null {
  switch (cle) {
    case "mark.light":
      return brand.logo.mark.light;
    case "mark.dark":
      return brand.logo.mark.dark;
    case "lockup.light":
      return brand.logo.lockup.light;
    case "lockup.dark":
      return brand.logo.lockup.dark;
    case "hero":
      return brand.hero;
  }
}

export function poserEmplacement(brand: Brand, cle: CleEmplacement, url: string | null): Brand {
  const { logo } = brand;
  switch (cle) {
    case "mark.light":
      return { ...brand, logo: { ...logo, mark: { ...logo.mark, light: url } } };
    case "mark.dark":
      return { ...brand, logo: { ...logo, mark: { ...logo.mark, dark: url } } };
    case "lockup.light":
      return { ...brand, logo: { ...logo, lockup: { ...logo.lockup, light: url } } };
    case "lockup.dark":
      return { ...brand, logo: { ...logo, lockup: { ...logo.lockup, dark: url } } };
    case "hero":
      return { ...brand, hero: url };
  }
}

/**
 * UN MÉDIA PEUT-IL SERVIR D'IMAGE DE MARQUE ?
 *
 * Les dix-neuf photos du pilote (`stockage: 'heritee'`) rendent un chemin
 * RELATIF — `/photos/kebab.webp`, servi par le paquet web. Il convient à une
 * carte affichée par cette même application, et à rien d'autre : le masque
 * part vers la caisse, la cuisine, le téléviseur et l'icône du manifeste, qui
 * sont d'autres origines. `ImageUrl` (contrat) exige donc `http(s)://`, et un
 * masque portant un chemin relatif serait refusé en 400 par l'API — ou pire,
 * accepté à la lecture et rendu en lien mort sur quatre écrans.
 *
 * On juge l'ADRESSE et non le champ `stockage` : c'est la valeur qui partira
 * dans le corps de la requête, et c'est elle que le serveur regardera.
 */
export const servableCommeImageDeMarque = (media: MediaVue, usage: UsageMedia): boolean =>
  IMAGE_URL.test(media.urls[usage] ?? "");

/**
 * L'AVERTISSEMENT DE COTES — un avertissement, et pas un refus. Pourquoi.
 *
 * La spécification pose des minimas (marque ≥ 256 px, horizontale ≥ 512 px de
 * large) et les confie au dépôt d'images « étendu aux quatre déclinaisons » —
 * une extension qui n'a jamais été livrée. AUCUN serveur ne les applique
 * aujourd'hui : ni `POST /medias`, ni `PATCH …/marque`.
 *
 * Bloquer ici en ferait donc l'unique garde, et une garde qui ne vit que dans
 * un navigateur n'en est pas une — la même requête passe à la main. On
 * n'obtiendrait pas une règle, seulement un restaurateur empêché.
 *
 * Deux autres raisons, et elles tiennent seules :
 *
 *  · les cotes sont LUES DANS L'EN-TÊTE des octets, et valent `null` quand le
 *    format ne les livre pas. Refuser sur une mesure absente, c'est refuser un
 *    fichier parfaitement bon faute d'avoir su le mesurer ;
 *  · un logo trop petit ne CASSE rien. Il s'affiche, et il est mou une fois
 *    agrandi. C'est un jugement esthétique, et il appartient au restaurateur.
 *    Ce que l'écran bloque, il le bloque pour ce que le serveur refuse
 *    vraiment : un contraste illisible et une origine d'image non autorisée.
 */
export function avertissementDeCotes(emplacement: Emplacement, media: MediaVue): string | null {
  const { largeur, hauteur } = media;
  if (largeur === null || hauteur === null) {
    return "Les dimensions de ce fichier ne se lisent pas dans son en-tête — impossible de vérifier qu'il est assez grand.";
  }
  if (emplacement.coteMin !== null && Math.min(largeur, hauteur) < emplacement.coteMin) {
    return `${largeur} × ${hauteur} px — en dessous de ${emplacement.coteMin} px, votre marque sera molle sur un grand écran. Ça s'enregistre quand même.`;
  }
  if (emplacement.largeurMin !== null && largeur < emplacement.largeurMin) {
    return `${largeur} px de large — il en faudrait ${emplacement.largeurMin} pour rester net. Ça s'enregistre quand même.`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Le refus du serveur, dit en français
// ─────────────────────────────────────────────────────────────

type CorpsRefus = {
  message?: unknown;
  verdicts?: unknown;
  refusees?: unknown;
  hotesAutorises?: unknown;
  issues?: unknown;
};

const listeDeChaines = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * LE REFUS DU SERVEUR NE DOIT JAMAIS RESSEMBLER À UNE PANNE.
 *
 * L'API rejoue le contraste (`exigerAA`) et la liste blanche d'origines
 * (`exigerOriginesImages`) sur le masque tel qu'il sera VRAIMENT stocké, et
 * elle a raison de ne pas se fier à l'écran. Ses deux 400 portent de quoi
 * s'expliquer — les couples en échec, les adresses refusées avec les hôtes
 * admis — et les afficher en « Enregistrement impossible » jetterait
 * précisément ce qui rend le refus actionnable.
 *
 * Le cas du CONTRASTE mérite d'être dit franchement quand il arrive : l'écran
 * a juré le contraire trois lignes plus haut, avec la même fonction. Un tel
 * écart n'est pas une faute du restaurateur, et la phrase ne le lui reproche
 * pas — elle nomme les couples et lui demande de nous appeler.
 */
export function messageDuRefus(status: number, corps: unknown): string {
  const c = (corps ?? {}) as CorpsRefus;
  const message = typeof c.message === "string" ? c.message : "";

  if (Array.isArray(c.verdicts) && c.verdicts.length > 0) {
    const couples = c.verdicts
      .map((v) => (v as { couple?: unknown }).couple)
      .filter((x): x is CoupleContraste => typeof x === "string" && x in COUPLES_LABELS)
      .map((couple) => COUPLES_LABELS[couple]);
    const dits = couples.length > 0 ? couples.join(", ") : "certains éléments";
    return `Le serveur a refusé ce masque : ${dits} ne se lisent pas. Corrigez les verdicts ci-dessus — et si l'écran ne les signalait pas, appelez-nous, c'est chez nous que ça cloche.`;
  }

  const refusees = listeDeChaines(c.refusees);
  if (refusees.length > 0) {
    const hotes = listeDeChaines(c.hotesAutorises);
    return `Nous n'hébergeons pas les images des autres : ${refusees.join(", ")} ${
      refusees.length > 1 ? "ne viennent pas" : "ne vient pas"
    } de chez nous. Choisissez vos images dans votre médiathèque${
      hotes.length > 0 ? ` (${hotes.join(", ")})` : ""
    }.`;
  }

  if (Array.isArray(c.issues) && c.issues.length > 0) {
    return "Une valeur de ce masque n'a pas la forme attendue. Rechargez la page et reprenez — si ça recommence, appelez-nous.";
  }

  if (status === 401 || status === 403) {
    return "Votre session ne permet pas de changer l'identité visuelle — reconnectez-vous, ou demandez au titulaire du compte.";
  }
  if (status === 503) {
    return message || "Le service est momentanément indisponible — réessayez dans un instant.";
  }
  return message || "Enregistrement impossible — réessayez.";
}
