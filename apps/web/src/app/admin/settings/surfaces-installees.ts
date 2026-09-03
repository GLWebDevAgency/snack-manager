import { logoPour, type Brand } from "@sm/contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QU'UNE CARTE INSTALLÉE MONTRE VRAIMENT — POUR QUE L'APERÇU NE MENTE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un aperçu qui mente est pire que pas d'aperçu : le restaurateur déposerait
 * son logo, verrait une belle icône dans le back-office, et trouverait autre
 * chose sur son téléphone. Ce module ne contient donc AUCUNE mise en forme —
 * seulement ce que le manifeste décide réellement, lu au même endroit que lui.
 *
 * ─── La règle qui surprend, et qu'il faut dire ───
 *
 * `manifest.webmanifest/route.ts` déclare DEUX icônes quand un logo est posé :
 * le logo pour le rôle « any » (onglet du navigateur, liste d'applications) et
 * NOTRE DESSIN GÉNÉRÉ pour le rôle « maskable ». Ce n'est pas un oubli : le
 * commentaire de cette route l'assume — le lanceur rogne le masquable dans un
 * cercle, une goutte ou un carré arrondi selon le téléphone, et un logo carré
 * de tiers y perdrait ses bords.
 *
 * Or Chrome sur Android PRÉFÈRE le masquable pour l'écran d'accueil. Déposer
 * son logo ne change donc pas l'icône du lanceur. La seule façon de l'y mettre
 * serait de COMPOSER une icône masquable autour de lui — le placer dans la
 * zone sûre, sur son fond —, ce qui demande de rastériser côté serveur : la
 * bibliothèque de traitement d'images que le produit a délibérément écartée.
 *
 * L'aperçu dit donc où le logo apparaît ET où il n'apparaît pas.
 */

/** Les surfaces qu'une carte installée expose, et rien d'autre. */
export type SurfaceInstallee = "lanceur" | "onglet" | "chargement";

/** Ce qu'une surface affiche : le logo déposé, ou notre dessin généré. */
export type SourceIcone = "logo" | "genere";

/**
 * Longueur maximale du nom sous l'icône.
 *
 * Ce n'est pas un nombre choisi ici : c'est exactement le `slice(0, 30)` que
 * `manifest.webmanifest/route.ts` applique à `short_name`. Le dupliquer serait
 * accepter qu'il dérive — un test l'épingle contre la vraie route.
 */
export const NOM_COURT_MAX = 30;

/** Le nom tel que le lanceur l'affiche sous l'icône. */
export function nomCourt(nom: string): string {
  return nom.slice(0, NOM_COURT_MAX);
}

/** Le nom a-t-il été coupé ? Le dire évite la mauvaise surprise. */
export function nomTronque(nom: string): boolean {
  return nom.length > NOM_COURT_MAX;
}

/**
 * Quelle source chaque surface emploie, pour un masque donné.
 *
 * `lanceur` est toujours `genere` : il lit le rôle masquable, que le logo
 * déposé n'occupe jamais. `onglet` et `chargement` lisent le rôle « any »,
 * donc le logo dès qu'il existe.
 */
export function sourceDe(brand: Brand, surface: SurfaceInstallee): SourceIcone {
  if (surface === "lanceur") return "genere";
  return logoPour(brand, "mark") ? "logo" : "genere";
}

/** Y a-t-il au moins un logo posé, quelle que soit la déclinaison ? */
export function logoPose(brand: Brand): boolean {
  return logoPour(brand, "mark") !== null;
}

/**
 * Ce que déposer un logo change, en une phrase vraie.
 *
 * Rendue à l'écran : c'est la réponse à « et sur mon écran d'accueil ? ».
 */
export function phraseDuLanceur(brand: Brand): string {
  return logoPose(brand)
    ? "Votre logo s’affiche dans l’onglet du navigateur et à l’ouverture. Sur l’écran d’accueil, le lanceur découpe l’icône à sa façon — il garde donc notre dessin, aux couleurs de votre identité."
    : "Aucun logo posé : toutes ces surfaces montrent notre dessin, aux couleurs de votre identité.";
}
