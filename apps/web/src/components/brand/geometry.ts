/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GÉOMÉTRIE DU TICKET-BURGER — SOURCE UNIQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Les tracés du logo, et rien d'autre. Aucun JSX, aucun `"use client"` : ce
 * fichier doit rester lisible AUSSI par un script Node, parce que deux
 * consommateurs très différents en dépendent —
 *
 *   · `Logo.tsx`, qui en fait du JSX pour l'écran ;
 *   · `scripts/generate-brand-assets.mjs`, qui en fait des fichiers SVG et PNG
 *     pour le favicon, les icônes d'application et l'image de partage.
 *
 * C'est la raison d'être de la séparation. Si les tracés vivaient dans le
 * composant, le générateur devrait les recopier — et le jour où le dessin
 * bouge, l'écran et le favicon divergeraient sans que rien ne le dise. Un logo
 * qui n'est plus le même selon l'endroit n'est plus un logo.
 *
 * Node 22.18+ et 24 lisent ce fichier directement (effacement de types natif) ;
 * le générateur n'a donc besoin d'aucune étape de compilation.
 *
 * ═══ LE REPÈRE ═══
 *
 * Tout est exprimé dans un carré de 32 × 32. Le signe y occupe x ∈ [5, 27] et
 * y ∈ [1,6 ; 29,8] — il n'est PAS centré verticalement : le ticket descend plus
 * bas qu'il ne monte, parce que son bord déchiré doit pouvoir respirer. Un
 * centrage arithmétique le ferait paraître trop haut.
 */

/** Le cadre : ticket au bord déchiré. Seule l'épaisseur du trait varie. */
export const TICKET =
  "M 8.2 1.6 L 23.8 1.6 C 25.6 1.6 27 3 27 4.8 L 27 29.8 L 24.3 28.1 L 21.6 29.8 " +
  "L 18.9 28.1 L 16.2 29.8 L 13.5 28.1 L 10.8 29.8 L 8.1 28.1 L 5 29.8 L 5 4.8 " +
  "C 5 3 6.4 1.6 8.2 1.6 Z";

/** Pain du haut : le dôme. */
export const PAIN_HAUT =
  "M 8.6 11 C 8.6 7.4 11.9 5 16 5 C 20.1 5 23.4 7.4 23.4 11 L 23.4 11.3 " +
  "C 23.4 11.9 22.9 12.4 22.3 12.4 L 9.7 12.4 C 9.1 12.4 8.6 11.9 8.6 11.3 Z";

/**
 * La garniture — c'est ELLE qui prend le laiton dans la version bichrome.
 *
 * Deux tracés et non un : la gravure micro l'amincit (6,4 au lieu de 7 de haut,
 * recentrée). Sans cet amincissement, le cadre épaissi à 2,4 et la garniture se
 * touchent presque, et à 16 px le filet de fond entre les deux disparaît.
 */
export const GARNITURE =
  "M 10.8 13.5 L 21.2 13.5 C 22.4 13.5 23.4 14.5 23.4 15.7 L 23.4 18.3 " +
  "C 23.4 19.5 22.4 20.5 21.2 20.5 L 10.8 20.5 C 9.6 20.5 8.6 19.5 8.6 18.3 " +
  "L 8.6 15.7 C 8.6 14.5 9.6 13.5 10.8 13.5 Z";
export const GARNITURE_MICRO =
  "M 10.8 13.8 L 21.2 13.8 C 22.4 13.8 23.4 14.8 23.4 16 L 23.4 18 " +
  "C 23.4 19.2 22.4 20.2 21.2 20.2 L 10.8 20.2 C 9.6 20.2 8.6 19.2 8.6 18 " +
  "L 8.6 16 C 8.6 14.8 9.6 13.8 10.8 13.8 Z";

/** Pain du bas : la courbe plate. */
export const PAIN_BAS =
  "M 9.7 21.8 L 22.3 21.8 C 22.9 21.8 23.4 22.3 23.4 22.9 C 23.4 24.3 20.1 25.3 " +
  "16 25.3 C 11.9 25.3 8.6 24.3 8.6 22.9 C 8.6 22.3 9.1 21.8 9.7 21.8 Z";

/** L'éclair. Jamais peint : il ne sert que de découpe dans le masque. */
export const ECLAIR = "M 16.9 8.6 L 12.5 16.4 L 15.5 16.4 L 14.5 22.6 L 19.3 15 L 16.3 15 Z";

/**
 * Le trait de découpe qui creuse l'éclair.
 *
 * L'éclair est rempli ET tracé en noir dans le masque. Ce trait n'est pas une
 * coquetterie : il élargit la découpe de 0,225 de chaque côté, et c'est ce
 * léger surdimensionnement qui crée le FILET DE FOND entre l'éclair et les
 * trois couches. Sans lui, l'éclair affleurerait la garniture et l'œil ne
 * lirait plus deux formes mais une seule, cabossée.
 */
export const DECOUPE_ECLAIR = 0.45;

/** Épaisseur du trait du cadre, par gravure. */
export const TRAIT_STANDARD = 2.1;
export const TRAIT_MICRO = 2.4;

/**
 * Seuil de bascule vers la gravure micro, en pixels de rendu.
 *
 * Sous 20 px, les contre-formes de l'éclair passent sous le pixel et le signe
 * tourne à la tache. La micro garde ticket et burger, ferme l'évidement, et
 * épaissit le cadre pour compenser.
 */
export const SEUIL_MICRO = 20;

/** Le laiton de la marque. Identique à `--cf-gold` (JAMAIS `--cf-accent`). */
export const LAITON = "#c9a15a";

/** Le fond des tuiles d'icône — le noir de carte de la charte. */
export const FOND_TUILE = "#0b0b0c";

/**
 * Assemble le signe en balisage SVG, pour les actifs STATIQUES uniquement
 * (favicon, icônes d'application, image de partage, tampon d'impression).
 *
 * L'écran, lui, passe par `Logo.tsx` : le JSX ne peut pas partager cette
 * fonction, mais il partage les tracés ci-dessus — c'est là qu'est la vérité
 * du dessin, et c'est elle qui ne doit pas diverger.
 *
 * `masqueId` est un paramètre et non une constante : un fichier SVG est son
 * propre document, mais plusieurs signes peuvent être assemblés dans une même
 * planche (l'image de partage en aligne trois), et deux masques homonymes s'y
 * écraseraient.
 */
export function markSvg(options: {
  micro?: boolean;
  /** Couleur du ticket et des deux pains. */
  encre: string;
  /** Couleur de la garniture. Égale à `encre` pour la version monochrome. */
  garniture?: string;
  masqueId?: string;
}): string {
  const { micro = false, encre, garniture = encre, masqueId = "eclair" } = options;

  const cadre =
    `<path d="${TICKET}" fill="none" stroke="${encre}" ` +
    `stroke-width="${micro ? TRAIT_MICRO : TRAIT_STANDARD}" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>`;

  const couches =
    `<path d="${PAIN_HAUT}" fill="${encre}"/>` +
    `<path d="${micro ? GARNITURE_MICRO : GARNITURE}" fill="${garniture}"/>` +
    `<path d="${PAIN_BAS}" fill="${encre}"/>`;

  if (micro) return cadre + couches;

  // Blanc = on garde, noir = on creuse.
  const masque =
    `<mask id="${masqueId}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">` +
    `<rect width="32" height="32" fill="#fff"/>` +
    `<path d="${ECLAIR}" fill="#000" stroke="#000" stroke-width="${DECOUPE_ECLAIR}" ` +
    `stroke-linejoin="round"/>` +
    `</mask>`;

  return `${masque}${cadre}<g mask="url(#${masqueId})">${couches}</g>`;
}
