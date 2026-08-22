import type { MetadataRoute } from "next";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFESTE WEB — CONVENTION `app/manifest.ts`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Next sert ce fichier à `/manifest.webmanifest` et pose lui-même le
 * `<link rel="manifest">` : rien à ajouter dans `layout.tsx`.
 *
 * Les icônes ne sont pas dessinées ici. Elles sortent de la fabrique
 * (`scripts/generate-brand-assets.mjs`), qui les dérive de la géométrie du
 * ticket-burger — même signe que la vitrine, le favicon et les applications.
 *
 * ═══ POURQUOI `display: "browser"` ET NON `"standalone"` ═══
 *
 * Deux raisons, et la seconde est la vraie.
 *
 * 1. Ce domaine est une VITRINE. Un site de présentation détaché de sa barre
 *    d'adresse perd son URL, son bouton de retour et son partage — on prive
 *    le visiteur des gestes mêmes par lesquels une vitrine se transmet.
 *
 * 2. LA FRONTIÈRE DE LA MARQUE BLANCHE. Le manifeste d'une application Next
 *    est GLOBAL : le lien part dans toutes les pages du dossier `app/`,
 *    y compris `/r/[slug]`, le site de commande que voit le client final du
 *    restaurant. En `"standalone"`, ces pages rempliraient les critères
 *    d'installabilité de Chrome, et le client d'un snack se verrait proposer
 *    d'installer une application nommée « Snack Manager », à notre icône,
 *    en croyant installer celle du commerce. C'est exactement la confusion
 *    que la marque blanche interdit.
 *
 *    `"browser"` ferme la porte à la source : les navigateurs ne déclenchent
 *    pas d'invite d'installation pour ce mode d'affichage. Nos surfaces
 *    réellement installables — la caisse et la cuisine — sont des
 *    applications natives (`apps/pos`, `apps/kds`) et portent leur propre
 *    manifeste ; elles ne dépendent en rien de celui-ci.
 *
 * Si un jour une surface de ce domaine doit devenir installable (le CRM /sm,
 * par exemple), ce n'est pas ce fichier qu'il faut basculer : il faut un
 * manifeste propre à cette route, laissant celui-ci en `"browser"`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Snack Manager",
    short_name: "Snack Manager",
    description:
      "La suite qui fait tourner votre snack — caisse, cuisine, commande en ligne et back-office.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "browser",
    // Le noir de la charte, identique au `themeColor` du layout vitrine.
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /**
       * La maskable est un fichier DISTINCT, et non la même image redéclarée :
       * Android peut rogner jusqu'au cercle inscrit, et la fabrique n'y pose
       * le signe qu'à 56 % du côté (contre 68 % ailleurs) pour que le bord
       * déchiré du ticket survive au rognage.
       */
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
