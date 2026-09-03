/**
 * L'IMAGE D'ACCUEIL D'UN RESTAURANT — la cadrer, la partager.
 *
 * `brand.hero` est stockée, validée par `ImageUrl` et gardée par la liste
 * blanche d'origines depuis la livraison du masque, et AUCUNE surface ne la
 * rendait (le plan de livraison le disait lui-même). Ce module est le seul
 * endroit qui décide ce qu'on en fait, pour que la vitrine (`Storefront`) et
 * la carte de partage (`/r/[slug]`) lisent la MÊME chose : sinon la page
 * afficherait la photo du restaurant pendant que les réseaux sociaux
 * continueraient de recevoir son logo carré.
 *
 * Fonctions PURES, sans React : le web n'a pas de rendu de composants sous
 * vitest, donc tout ce qui peut être décidé hors du JSX l'est ici — et se
 * teste (`hero.test.ts`).
 */

import { cadrageCss, type MediaVue } from "@sm/contracts";

/**
 * Le média de la bibliothèque qui EST l'image d'accueil — s'il en est un.
 *
 * `brand.hero` ne stocke qu'une URL : le masque a été livré avant la
 * médiathèque et rien ne relie les deux en base. Le rapprochement se fait donc
 * ICI, par l'ADRESSE. Quand il aboutit, la bande hérite du cadrage et du texte
 * alternatif que le restaurateur a posés lui-même dans `/admin/menu` ; sinon —
 * une URL collée à la main dans `PATCH …/marque`, qui reste le seul chemin
 * d'écriture de ce champ — on retombe sur les défauts, et rien ne casse.
 *
 * Les quatre usages rendent la même adresse aujourd'hui (`urlMedia` le dit
 * explicitement) ; on les compare TOUS LES QUATRE pour que le jour où un
 * transformateur d'images les fera diverger, une URL d'accueil déjà stockée
 * continue d'être reconnue au lieu de perdre son cadrage en silence.
 */
export function mediaDuHero(
  hero: string | null | undefined,
  medias: readonly MediaVue[],
): MediaVue | null {
  if (!hero) return null;
  return medias.find((m) => Object.values(m.urls).includes(hero)) ?? null;
}

/**
 * Le point d'intérêt traduit en `object-position`, prêt à poser sur la bande.
 *
 * On rend toujours une valeur — `cadrageCss(null)` vaut le centre — plutôt
 * qu'un `undefined` conditionnel : un seul chemin de rendu, donc une seule
 * chose à lire dans `Storefront`, et le HTML servi est le même que l'image
 * vienne ou non de la médiathèque.
 */
export function cadrageDuHero(
  hero: string | null | undefined,
  medias: readonly MediaVue[],
): string {
  return cadrageCss(mediaDuHero(hero, medias)?.point ?? null);
}

/**
 * Le texte alternatif de la bande — celui du média, ou RIEN.
 *
 * `texteAlternatif()` retombe sur le nom du produit parce qu'une photo de plat
 * MONTRE ce plat. Une photo d'établissement, elle, n'est pas le restaurant :
 * son nom est déjà le `h1` juste au-dessus, et le recopier en `alt` ferait
 * annoncer deux fois la même chose à un lecteur d'écran. Sans texte saisi, la
 * bande est donc décorative — ce qu'elle est vraiment tant que le
 * restaurateur n'a rien écrit — et c'est le seul repli honnête ici.
 */
export function altDuHero(
  hero: string | null | undefined,
  medias: readonly MediaVue[],
): string {
  return (mediaDuHero(hero, medias)?.alt ?? "").trim();
}

/** L'image de partage retenue, et si elle remplit un emplacement paysage. */
export type ImageDePartage = { url: string; paysage: boolean };

/**
 * CE QU'ON ENVOIE AUX RÉSEAUX SOCIAUX ET AUX MESSAGERIES.
 *
 * `/r/[slug]` déclarait `twitter.card: "summary_large_image"` — un emplacement
 * de 1200×630, donc du seize neuvièmes — en n'y mettant que `logoUrl`, c'est-à-dire
 * une marque CARRÉE. Facebook, WhatsApp et X y ajoutent alors leurs propres
 * bandes latérales, ou recadrent le logo par le milieu : le premier contact
 * d'un client avec le restaurant est un carré tronqué sur fond gris.
 *
 * L'image d'accueil est faite pour cet emplacement — c'est une photo
 * d'établissement, en paysage. Elle passe donc devant. Le logo reste le repli,
 * parce qu'un logo carré mal cadré vaut encore mieux qu'aucune vignette du
 * tout, mais l'appelant sait alors qu'il ne doit PAS promettre un grand
 * visuel : le drapeau `paysage` existe pour ça.
 */
export function imageDePartage(
  hero: string | null | undefined,
  logoUrl: string | null | undefined,
): ImageDePartage | null {
  if (hero) return { url: hero, paysage: true };
  if (logoUrl) return { url: logoUrl, paysage: false };
  return null;
}
