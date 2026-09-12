/**
 * Moteur de mise en page de la caisse — « tablette-first, mais multi-supports ».
 *
 * Le parc d'un snack indépendant est hétérogène : tablette 10" posée sur le
 * comptoir (1280 × 800, la RÉFÉRENCE), tablette 12–13" (2000 × 1200), grand
 * écran de comptoir 24" (1920 × 1080) parfois mural, et le téléphone du gérant
 * en dépannage. Les largeurs figées de la maquette (rail 108, ticket 384,
 * canevas 1280 × 830) laissaient l'interface minuscule au centre d'un 24" et
 * étouffaient la grille produits sur une 10".
 *
 * Ce module est le SEUL endroit qui décide d'une dimension. Il est pur (aucune
 * dépendance à react-native) pour rester testable ; le hook `useLayout()` du
 * module voisin l'alimente avec `useWindowDimensions()`.
 *
 * ─── Seuils retenus, et pourquoi ───────────────────────────────────────────
 *
 * • COMPACT_W = 900 px. En dessous, rail + ticket + grille ne cohabitent plus :
 *   même en resserrant le ticket à sa borne basse (340) et le rail à son
 *   minimum, il ne reste que ~440 px de grille, soit deux cartes étriquées.
 *   Sous ce seuil le ticket devient donc un panneau escamotable, avec une barre
 *   d'accès permanente (« Ticket · N articles · total ») et l'encaissement
 *   carte à portée d'un seul geste. 900 correspond aussi à une 10" en portrait
 *   (820) et à toute la famille téléphone, qui basculent ensemble.
 *
 * • Rail : 8,5 % de la largeur, borné 96…148 (76 sous 700 px de large, où
 *   chaque pixel compte). À 1280 la formule redonne exactement 108 px, la
 *   valeur de la maquette : la référence ne bouge pas. Le libellé de catégorie
 *   suit la largeur du rail (12 %), pas l'échelle générale : c'est la place
 *   disponible qui décide si « Classiques » tient sur une ligne.
 *
 * • Ticket : 30 % de la largeur, borné 340…460. À 1280 → 384 px, là encore la
 *   valeur d'origine. La borne haute évite qu'un 24" transforme le ticket en
 *   colonne de journal ; la borne basse garde deux boutons d'encaissement
 *   côte à côte avec des cibles ≥ 44 px.
 *
 * • Colonnes : jamais un nombre fixe, toujours déduit de la largeur UTILE
 *   (après rail et ticket) et d'une carte idéale de ~190 px (la maquette en
 *   fait 180 à 1280). Bornes 2…3 en compact, 2…5 jusqu'à 1500 px, 2…6 au-delà :
 *   sur un 24" on veut plus de produits visibles, pas des cartes étirées.
 *
 * • Échelle typographique : suit la DIAGONALE de l'écran (un 24" se lit de plus
 *   loin), amortie par un exposant 0,35 et bornée 0,94…1,18. La diagonale, et
 *   non la largeur, parce qu'un 1920 × 1080 et un 1920 × 600 ne se lisent pas
 *   de la même distance. Un plafond supplémentaire dépendant de la hauteur
 *   empêche un écran large mais court de grossir jusqu'à se tronquer.
 *   À 1280 × 800 l'échelle vaut exactement 1 : aucune régression sur la cible.
 *
 * • Cibles tactiles : `touch()` ne descend JAMAIS sous TOUCH_MIN (44 px), quelle
 *   que soit l'échelle. Contrainte d'accessibilité et de gants, pas une
 *   préférence — c'est un plancher, l'échelle ne peut que l'augmenter.
 */
import { TOUCH_MIN } from '@sm/client-core';

/** Tablette Android 10" en paysage : la cible de référence du poste. */
export const REFERENCE = { width: 1280, height: 800 } as const;

/**
 * Géométrie de la maquette, à 1280 px de large. Ce ne sont plus des constantes
 * de rendu mais les ANCRES que les formules ci-dessous doivent redonner à
 * l'identique sur la tablette de référence (vérifié par `layout.test.ts`).
 */
export const RAIL_REF = 108;
export const TICKET_REF = 384;
export const TOPBAR_REF = 66;

/** Sous cette largeur, le ticket ne tient plus à côté de la grille. */
export const COMPACT_W = 900;

/**
 * LA BARRE HAUTE PORTE DÉSORMAIS DEUX SÉLECTEURS.
 *
 * Elle en avait un — le mode de service (Sur place / À emporter / Téléphone).
 * La vue du service en ajoute un second (Vendre / Le service), et deux
 * sélecteurs ne tiennent pas partout où un seul tenait. Plutôt que de tronquer
 * l'un des deux — ce qui reviendrait à cacher le mode de service, qui décide du
 * CONTENU de la commande, ou la bascule de vue, qui décide de ce qu'on regarde
 * — la barre se réorganise, en trois compositions et deux seuils.
 *
 * ─── TOPBAR_SPLIT_W = 1180 ───────────────────────────────────────────────
 *
 * Au-dessus, tout tient sur UNE rangée. Le calcul, à l'échelle 1 :
 *
 *   identité (38 + libellé ≈ 200) + bascule de vue (2 × 92 ≈ 190)
 *   + mode de service (3 × 96 ≈ 296) + horloge (≈ 70)
 *   + « Récapitulatif » (≈ 120) + « Verrouiller » (≈ 116) + 6 gouttières de 16
 *   ≈ 1064 px
 *
 * Il reste ~116 px à 1180 : exactement de quoi loger la pastille « N en
 * attente » ou « N refusée(s) » quand le service se dégrade, sans que la barre
 * ne se réorganise sous les yeux du caissier au pire moment. En dessous, les
 * deux sélecteurs descendent ensemble sur une seconde rangée.
 *
 * 1180 et non 1280 : la tablette de RÉFÉRENCE (1280 × 800) garde donc sa barre
 * sur une seule ligne, comme aujourd'hui. C'est la contrainte qui a fixé le
 * seuil, pas l'inverse.
 *
 * ─── TOPBAR_SELECTORS_SPLIT_W = 560 ──────────────────────────────────────
 *
 * Sur la seconde rangée, les deux sélecteurs se partagent la largeur : cinq
 * onglets au total. À 560 px de large, chacun reçoit ≈ 100 px — « À emporter »
 * tient encore. En dessous, il se ferait couper en plein mot, et un mode de
 * service illisible fait envoyer la mauvaise commande. Chaque sélecteur prend
 * alors sa propre rangée : la barre en compte trois.
 *
 * 560 est aussi la largeur sous laquelle l'identité textuelle s'efface déjà
 * (`TopBar.tsx`) : les deux bascules arrivent ensemble, ce qui fait UNE rupture
 * de mise en page à cette largeur au lieu de deux.
 */
export const TOPBAR_SPLIT_W = 1180;
export const TOPBAR_SELECTORS_SPLIT_W = 560;

/** Bornes du panneau ticket (le pied doit garder deux boutons ≥ 44 px). */
export const TICKET_MIN = 340;
export const TICKET_MAX = 460;

/**
 * Bornes du rail de catégories. Le minimum de 96 n'est pas cosmétique : sous
 * cette largeur, « Classiques » ou « Barquettes » se coupent en plein milieu
 * d'un mot, et un rail illisible coûte plus cher que les quelques pixels rendus
 * à la grille.
 */
export const RAIL_MIN = 96;
export const RAIL_MAX = 148;
/** Sous 700 px de large (téléphone), le rail cède quelques pixels à la grille. */
export const RAIL_MIN_TIGHT = 76;

/** Largeur « idéale » d'une carte produit à l'échelle 1 (maquette : 180). */
export const IDEAL_CARD = 190;

/** Bornes de l'échelle typographique. */
export const SCALE_MIN = 0.94;
export const SCALE_MAX = 1.18;

/**
 * LA VIGNETTE PRODUIT — carrée, et une FRACTION de la hauteur de la carte.
 *
 * Elle se pose en tête de la rangée du nom, pas en bandeau pleine largeur : la
 * tuile fait 104 à 120 px de haut, et un bandeau obligerait à rouvrir la
 * formule de `cardH` — donc à réduire le nombre de produits visibles sur une
 * 10", qui est le poste de référence. Ce n'est pas la vignette qui doit dicter
 * la densité de la grille.
 *
 * 40 % de la hauteur de carte, borné 40…56 : à 1280 × 800 cela donne 43 px, et
 * la rangée du nom (deux lignes, 36 px) tient dessous. Le reste de la tuile —
 * la rangée du prix et sa marge — garde alors ses ~35 px, marge comprise. Une
 * fraction plus grande ferait sortir le prix de la tuile, qui est écrêtée
 * (`overflow: hidden`) : on perdrait le seul chiffre dont l'équipier a besoin.
 */
export const VIGNETTE_PART = 0.4;
export const VIGNETTE_MIN = 40;
export const VIGNETTE_MAX = 56;

/**
 * Largeur minimale laissée au NOM à côté d'une vignette.
 *
 * Le nom est l'information de travail : c'est lui qu'on cherche du regard sous
 * la pression du service, la photo ne fait que confirmer. Sur la tablette de
 * référence il reste 105 px au nom, soit deux lignes d'une quinzaine de
 * caractères — largement de quoi lire « Escalope Normande ». Sur le TÉLÉPHONE
 * du gérant, où la tuile ne fait que 136 px de large, il n'en resterait que 47 :
 * six caractères par ligne, un nom haché. La vignette s'efface alors, et la
 * tuile redevient exactement celle d'avant.
 *
 * 80 px, et pas davantage : la largeur des tuiles saute avec le nombre de
 * colonnes, et un seuil plus haut ferait apparaître et disparaître les photos
 * au fil d'un redimensionnement, ce qui se voit bien plus qu'un nom serré.
 */
export const LARGEUR_NOM_MIN = 80;

/**
 * La tuile a-t-elle les moyens de sa vignette ?
 *
 * @param cardW largeur MESURÉE d'une tuile (la grille se mesure elle-même).
 * @param gap   gouttière entre la vignette et le nom, telle que posée au rendu.
 *
 * `sp(13)` est la marge intérieure de la tuile, celle que `Catalog.tsx` lui
 * pose : les deux doivent bouger ensemble, et c'est le seul couplage.
 */
export function vignetteTient(cardW: number, layout: Layout, gap = 6): boolean {
  return cardW - layout.sp(13) * 2 - layout.vignette - gap >= LARGEUR_NOM_MIN;
}

/** Plancher absolu de taille de texte : rien d'utile en service en dessous. */
const FONT_FLOOR = 12;

export type Orientation = 'landscape' | 'portrait';
/** Classe d'écran, pour les rares décisions non métriques. */
export type ScreenClass = 'phone' | 'tablet' | 'large' | 'wall';

export interface Layout {
  width: number;
  height: number;
  orientation: Orientation;
  screen: ScreenClass;
  /** Largeur < 900 px : ticket escamotable, colonnes réduites. */
  compact: boolean;
  /**
   * Les deux sélecteurs de la barre haute (vue, mode de service) descendent
   * sous la rangée d'identité — voir `TOPBAR_SPLIT_W`.
   */
  topbarStacked: boolean;
  /**
   * Les deux sélecteurs ne se partagent plus une rangée : chacun la sienne.
   * N'a de sens que lorsque `topbarStacked` est vrai — voir
   * `TOPBAR_SELECTORS_SPLIT_W`.
   */
  topbarSelectorsSplit: boolean;
  /** Rail des catégories (zone B). */
  railW: number;
  /** Disposition C : rail horizontalement plus généreux. */
  railDenseW: number;
  pinPadW: number;
  pinKeyW: number;
  pinKeyH: number;
  pinMark: number;
  segmentPadX: number;
  catalogWideSearch: boolean;
  catalogCategoryIcons: boolean;
  catalogDescriptions: boolean;
  railIcons: boolean;
  railCompactBrand: boolean;
  /** Configurateur latéral des dispositions B et C. */
  cfgW: number;
  /** Repli modal si deux cartes lisibles ne tiennent plus à côté des panneaux. */
  configInlineFor: (id: 'A' | 'B' | 'C') => boolean;
  listColumnsFor: (gridWidth: number) => 1 | 2;
  /** Taille du libellé de catégorie — calée sur la largeur du rail, pas sur l'échelle. */
  railFs: number;
  /** Ticket (zone D) — largeur du panneau ancré, ou du tiroir en compact. */
  ticketW: number;
  /** Barre haute (zone A) — sa rangée principale. */
  topbarH: number;
  /** Colonnes de la grille produits, estimées sur la largeur utile. */
  cols: number;
  minCols: number;
  maxCols: number;
  gridGap: number;
  gridPad: number;
  /** Hauteur commune des cartes produit (toutes identiques, quelle que soit la ligne). */
  cardH: number;
  /** Côté de la vignette produit — carrée, en tête de la rangée du nom. */
  vignette: number;
  /** Facteur typographique borné. */
  scale: number;
  /** Taille de texte adaptée, jamais sous 12 px. */
  fs: (px: number) => number;
  /** Espacement adapté (amorti : on ne dilate pas autant que le texte). */
  sp: (px: number) => number;
  /** Cible tactile adaptée, jamais sous TOUCH_MIN. */
  touch: (px?: number) => number;
  /** Largeur d'une modale bornée à l'écran. */
  modal: (preferred: number) => number;
}

function clamp(min: number, v: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Interpolation d'une échelle sur la diagonale, amortie puis bornée. */
function diagonalScale(width: number, height: number): number {
  const diag = Math.hypot(width, height);
  const ref = Math.hypot(REFERENCE.width, REFERENCE.height);
  const raw = (diag / ref) ** 0.35;
  // Un écran court (barre haute + grille + pied) ne peut pas grossir autant
  // qu'un écran haut : le plafond suit la hauteur disponible.
  const heightCap = height >= 900 ? SCALE_MAX : height >= 760 ? 1.06 : 1;
  return Math.round(clamp(SCALE_MIN, raw, Math.min(SCALE_MAX, heightCap)) * 100) / 100;
}

/**
 * Nombre de colonnes pour une largeur de grille RÉELLEMENT mesurée (après
 * déduction du rail, du ticket et des marges). La grille se mesure elle-même :
 * c'est la seule valeur qui ne peut pas être devinée.
 */
export function columnsFor(gridWidth: number, layout: Layout): number {
  if (gridWidth <= 0) return layout.cols;
  const ideal = IDEAL_CARD * layout.scale;
  const raw = Math.round((gridWidth + layout.gridGap) / (ideal + layout.gridGap));
  return clamp(layout.minCols, raw, layout.maxCols);
}

/** Grandes cartes du handoff ; la densité historique reste sélectionnable. */
export function catalogColumnsFor(gridWidth: number, layout: Layout, density: 'comfortable' | 'compact'): number {
  if (density === 'compact') return columnsFor(gridWidth, layout);
  if (gridWidth <= 0) return 2;
  // La hauteur du grand écran agrandit déjà les textes et espacements. Ne pas
  // lui faire supprimer une colonne qui tient, notamment avec le rail A.
  const ideal = layout.compact ? 210 * layout.scale : 276;
  return clamp(2, Math.floor((gridWidth + layout.gridGap) / (ideal + layout.gridGap)), 5);
}

/**
 * LA CARTE DE LA VUE DU SERVICE — bien plus large qu'une tuile produit.
 *
 * Une tuile produit vise 190 px : un nom court et un prix. Une carte de service
 * porte un numéro de retrait lisible à un mètre, un statut, un minuteur, un
 * montant et de quoi reconnaître le client — sur 190 px, tout se replierait sur
 * quatre lignes et le numéro perdrait sa taille, c'est-à-dire l'essentiel.
 *
 * 360 px à l'échelle 1 donne, sur la tablette de référence (1280), trois
 * colonnes d'environ 405 px : le numéro tient en 34 px de haut à côté du
 * minuteur, sur une seule rangée. Sur un téléphone, une seule colonne pleine
 * largeur — mieux vaut faire défiler que tronquer.
 */
export const SERVICE_CARD_IDEAL = 360;
export const SERVICE_COLS_MAX = 4;

/**
 * Colonnes de la vue du service, pour une largeur RÉELLEMENT disponible.
 *
 * Même méthode que la grille produits : jamais un nombre fixe, toujours déduit
 * de la place et d'une carte idéale mise à l'échelle de l'écran.
 */
export function serviceColumns(disponible: number, layout: Layout): number {
  if (disponible <= 0) return 1;
  const ideal = SERVICE_CARD_IDEAL * layout.scale;
  const brut = Math.round((disponible + layout.gridGap) / (ideal + layout.gridGap));
  return clamp(1, brut, SERVICE_COLS_MAX);
}

/** Largeur d'une carte pour un nombre de colonnes donné. */
export function cardWidth(gridWidth: number, cols: number, gap: number): number {
  if (gridWidth <= 0 || cols <= 0) return 0;
  return (gridWidth - gap * (cols - 1)) / cols;
}

/**
 * LE RECADRAGE D'UNE PHOTO AUTOUR DE SON POINT D'INTÉRÊT.
 *
 * Le pendant React Native de `cadrageCss` (contrat médiathèque). En CSS, la
 * règle tient en deux mots — `object-fit: cover` plus `object-position` — et le
 * navigateur fait le calcul. React Native n'a pas d'`object-position` : son
 * `resizeMode="cover"` recadre TOUJOURS par le centre. Sur la surface la plus
 * carrée du produit, celle qui coupe le plus, cela revient à ignorer le seul
 * réglage que le restaurateur a posé sur sa photo.
 *
 * On refait donc le calcul à la main : l'image est posée en absolu, à la
 * taille qui couvre exactement le carré, et décalée pour que le point
 * d'intérêt tombe au CENTRE de la vignette — puis bridée aux bords, faute de
 * quoi un point proche d'un coin découvrirait le fond.
 *
 * @param cote    côté du carré, en pixels.
 * @param largeur cote intrinsèque de la photo (`MediaVue.largeur`).
 * @param hauteur cote intrinsèque de la photo (`MediaVue.hauteur`).
 * @param x       point d'intérêt, 0…1, origine en haut à gauche.
 * @param y       idem, vertical.
 * @returns `null` quand le calcul est impossible — cotes absentes de l'en-tête
 *          du fichier, ou média inconnu. L'appelant retombe alors sur le
 *          `resizeMode="cover"` du cadre, c'est-à-dire un recadrage centré :
 *          le comportement du navigateur sans consigne, jamais un trou.
 */
export function cadrageVignette(
  cote: number,
  largeur: number | null | undefined,
  hauteur: number | null | undefined,
  x: number,
  y: number,
): { width: number; height: number; left: number; top: number } | null {
  if (!(cote > 0) || !(largeur && largeur > 0) || !(hauteur && hauteur > 0)) return null;
  const ratio = largeur / hauteur;
  // `ceil` et non `round` : arrondir vers le bas laisserait un liseré de fond
  // sur un bord, visible sur un aplat sombre.
  const w = Math.ceil(ratio >= 1 ? cote * ratio : cote);
  const h = Math.ceil(ratio >= 1 ? cote : cote / ratio);
  const px = clamp(0, x, 1);
  const py = clamp(0, y, 1);
  return {
    width: w,
    height: h,
    left: clamp(cote - w, Math.round(cote / 2 - px * w), 0),
    top: clamp(cote - h, Math.round(cote / 2 - py * h), 0),
  };
}

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const orientation: Orientation = h > w ? 'portrait' : 'landscape';
  const compact = w < COMPACT_W;
  const screen: ScreenClass = w < 700 ? 'phone' : w < 1500 ? 'tablet' : w < 1900 ? 'large' : 'wall';

  const scale = diagonalScale(w, h);
  // L'espacement suit l'échelle de moitié : sur un 24" on veut plus de contenu
  // lisible, pas seulement plus de vide.
  const spaceScale = 1 + (scale - 1) * 0.6;

  const fs = (px: number): number => {
    const v = Math.round(px * scale * 2) / 2;
    // En réduction, on ne descend jamais un texte utile sous 12 px.
    return scale >= 1 ? v : Math.max(v, Math.min(px, FONT_FLOOR));
  };
  const sp = (px: number): number => Math.max(2, Math.round(px * spaceScale));
  const touch = (px: number = TOUCH_MIN): number => Math.max(TOUCH_MIN, px, Math.round(px * spaceScale));

  // `floor` et non `round` : à 1280 la formule doit rendre 108 tout rond, la
  // valeur de la maquette.
  const railW = clamp(w < 700 ? RAIL_MIN_TIGHT : RAIL_MIN, Math.floor(w * 0.085), RAIL_MAX);
  const ticketW = compact
    ? // Tiroir : large mais jamais collé aux bords, sinon on ne voit plus ce
      // qu'on quitte et le geste de fermeture n'a plus de prise.
      clamp(300, w - sp(64), TICKET_MAX)
    : clamp(TICKET_MIN, Math.round(w * 0.3), TICKET_MAX);

  const gridGap = sp(12);
  const gridPad = sp(16);
  const minCols = 2;
  const maxCols = compact ? 3 : w >= 1500 ? 6 : 5;

  const usable = w - railW - (compact ? 0 : ticketW) - gridPad * 2;
  const ideal = IDEAL_CARD * scale;
  const cols = clamp(minCols, Math.round((usable + gridGap) / (ideal + gridGap)), maxCols);

  const cardH = clamp(104, Math.round(108 * spaceScale), 150);

  return {
    width: w,
    height: h,
    orientation,
    screen,
    compact,
    topbarStacked: w < TOPBAR_SPLIT_W,
    topbarSelectorsSplit: w < TOPBAR_SELECTORS_SPLIT_W,
    railW,
    railDenseW: railW + 60,
    pinPadW: Math.min(300, w - sp(48)),
    pinKeyW: (Math.min(300, w - sp(48)) - sp(10) * 2) / 3,
    pinKeyH: Math.max(TOUCH_MIN, Math.round(58 * scale)),
    pinMark: sp(66),
    segmentPadX: sp(w < 480 ? 8 : 16),
    catalogWideSearch: w >= 1100,
    catalogCategoryIcons: w >= 700,
    catalogDescriptions: w >= 700,
    railIcons: railW >= 112,
    railCompactBrand: railW < 96,
    cfgW: clamp(320, Math.round(w * 0.27), 420),
    configInlineFor: (id) => !compact && id !== 'A' &&
      w - ticketW - clamp(320, Math.round(w * 0.27), 420) - (id === 'C' ? railW + 60 : 0) - gridPad * 2 >= 320,
    listColumnsFor: (gridWidth: number): 1 | 2 => gridWidth >= 1040 ? 2 : 1,
    // Le libellé suit la largeur du rail (12 % : 13 px à 108, la valeur de la
    // maquette) et non l'échelle générale : c'est la place disponible, et non
    // la distance de lecture, qui décide ici.
    railFs: clamp(11.5, Math.round(railW * 0.12 * 2) / 2, 15),
    ticketW,
    topbarH: clamp(60, Math.round(TOPBAR_REF * spaceScale), 84),
    cols,
    minCols,
    maxCols,
    gridGap,
    gridPad,
    cardH,
    vignette: clamp(VIGNETTE_MIN, Math.round(cardH * VIGNETTE_PART), VIGNETTE_MAX),
    scale,
    fs,
    sp,
    touch,
    modal: (preferred: number) => Math.max(280, Math.min(Math.round(preferred * spaceScale), w - sp(32))),
  };
}
