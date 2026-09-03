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
 * ─── LES DEUX RÔLES, ET CE QUE CHACUN MONTRE ───
 *
 * `manifest.webmanifest/route.ts` déclare DEUX icônes quand un logo est posé :
 * le logo LUI-MÊME pour le rôle « any » (onglet du navigateur, liste
 * d'applications, écran d'ouverture), et le rôle « maskable » — celui que
 * Chrome sur Android préfère pour l'écran d'accueil — servi par `icon.svg`.
 *
 * Ce second rôle a longtemps rendu notre seul dessin généré, et c'était la
 * règle qui surprenait : déposer son logo ne changeait pas l'icône du lanceur.
 * Ce n'est plus vrai. La route COMPOSE désormais l'icône masquable autour du
 * logo — le fond du masque sur tout le canevas, le logo ajusté dans la zone
 * sûre —, sans rastériser quoi que ce soit : les octets du logo sont incorporés
 * en `data:` dans le SVG. Les trois surfaces montrent donc le même logo.
 *
 * ─── CE QUI PEUT ENCORE RAMENER NOTRE DESSIN ───
 *
 * La composition va CHERCHER les octets du logo, et cette étape peut échouer :
 * fichier trop lourd (plafond dans `logo-incorpore.ts`), hôte hors liste
 * blanche, réseau lent, octets qui ne sont pas une image raster. La route
 * retombe alors sur le dessin généré. `sourceDe` décrit le cas NORMAL, celui
 * qui vaut pour un logo déposé par l'écran d'à côté ; la phrase du lanceur, elle,
 * dit le repli, parce qu'un aperçu qui promettrait sans réserve mentirait à
 * celui dont le fichier fait deux mégaoctets.
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
 * Les TROIS répondent maintenant la même chose, et c'est le fait nouveau :
 * `onglet` et `chargement` lisent le rôle « any », qui pointe sur le fichier du
 * logo ; `lanceur` lit le rôle masquable, que la route compose AUTOUR du même
 * logo. La fonction garde son paramètre `surface` — l'aperçu s'en sert pour
 * légender chaque vignette, et le jour où une surface redivergera (une icône
 * Windows, une tuile iOS), c'est ici que ça s'écrira, pas dans le rendu.
 */
export function sourceDe(brand: Brand, surface: SurfaceInstallee): SourceIcone {
  // Le paramètre est le point d'extension : il ne change RIEN aujourd'hui.
  void surface;
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
    ? "Votre logo s’affiche sur l’écran d’accueil, dans l’onglet du navigateur et à l’ouverture. Sur l’écran d’accueil, il est posé entier sur le fond de votre identité — jamais recadré — parce que le lanceur y découpe l’icône à sa façon. Si le fichier est trop lourd ou illisible, nous retombons sur notre dessin, aux couleurs de votre identité."
    : "Aucun logo posé : toutes ces surfaces montrent notre dessin, aux couleurs de votre identité.";
}
