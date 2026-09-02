/**
 * L'adresse d'une photo de plat, vue de la CAISSE — et son repli.
 *
 * ─── POURQUOI LA CAISSE NE PEUT PAS SE CONTENTER DE `product.photoUrl` ───
 *
 * Le serveur dérive déjà l'adresse (`photoUrlDe`, usage « vignette ») et la
 * pose à plat sur le produit. Elle prend deux formes, et une seule des deux
 * marche telle quelle ici :
 *
 *   · un média de la médiathèque → URL http(s) ABSOLUE, servie par l'API.
 *     Elle traverse n'importe quelle origine, la caisse la pose telle quelle ;
 *   · une photo HÉRITÉE du pilote → chemin RACINE-RELATIF `/photos/…`, servi
 *     par le paquet web. Sur la vitrine, ce chemin se résout tout seul : c'est
 *     la même application. La caisse, elle, est une AUTRE origine — un export
 *     Expo servi depuis son propre hôte, ou une application native qui n'a pas
 *     d'origine du tout. `/photos/doner-kebab.webp` y désigne un fichier qui
 *     n'existe pas, et les dix-neuf photos du pilote seraient mortes.
 *
 * On les résout donc contre le SITE CONFIGURÉ (`EXPO_PUBLIC_SITE_URL`), qui
 * est précisément l'application qui sert `/photos/…`. La destination vient de
 * la CONFIGURATION du poste, jamais de l'URL visitée ni d'une réponse
 * serveur : accepter un hôte venu d'ailleurs ferait charger les photos de la
 * carte par un tiers, qui voit passer l'IP du poste et décide de ce qui
 * s'affiche — exactement ce que la liste blanche d'origines ferme côté API.
 *
 * Configuration absente ou refusée : on rend `null`, c'est-à-dire « pas de
 * photo ». La tuile retombe sur sa forme purement typographique, celle qu'elle
 * avait avant la médiathèque. Un repli sur un hôte de production « au cas où »
 * ferait charger les photos d'un autre environnement.
 */
import { photoHeritee } from '@sm/contracts';
import { siteConfigure } from './demo-retour';

/**
 * Origine (schéma + hôte) d'une adresse absolue, en minuscules — `null` sinon.
 *
 * Expression régulière et non `new URL()` : le module tourne aussi sur le
 * moteur natif, et on n'a besoin que du préfixe. `//ailleurs.fr` n'a pas de
 * schéma et ne passe donc pas — c'est voulu, une URL à protocole relatif
 * ressemble à un chemin et n'en est pas un.
 */
function origineDe(url: string | null | undefined): string | null {
  const trouve = /^https?:\/\/[^/?#]+/i.exec((url ?? '').trim());
  return trouve ? trouve[0].toLowerCase() : null;
}

/**
 * L'adresse à poser dans une balise image, ou `null` s'il n'y en a pas.
 *
 * Pure et testable : le site est un PARAMÈTRE. `photoDuPoste` en dessous est
 * la version branchée sur la configuration réelle.
 */
export function adressePhoto(
  brut: string | null | undefined,
  site: string | null | undefined,
): string | null {
  // Le filtre du contrat, et pas un second écrit ici : c'est lui qui refuse
  // `//hôte-tiers`, `javascript:` et tout ce qui n'est pas servable.
  const url = photoHeritee(brut);
  if (url === null) return null;
  if (!url.startsWith('/')) return url;
  const origine = origineDe(site);
  return origine === null ? null : origine + url;
}

/**
 * La même chose, contre le site que le build a inscrit dans le bundle.
 *
 * `siteConfigure()` vient de `demo-retour.ts` et n'y est pas un détail de la
 * démonstration : c'est le SEUL endroit du poste où
 * `process.env.EXPO_PUBLIC_SITE_URL` est écrit en toutes lettres, ce que Metro
 * exige pour substituer la valeur à l'export. En écrire un second ici
 * marcherait, mais ferait deux lectures d'un même réglage à tenir d'accord.
 */
export function photoDuPoste(brut: string | null | undefined): string | null {
  return adressePhoto(brut, siteConfigure());
}

/**
 * Initiales de repli : deux lettres, articles et prépositions écartés.
 *
 * Même règle que la vitrine (`apps/web/.../primitives.tsx`) : les deux
 * surfaces doivent écrire le MÊME monogramme pour le même plat, sans quoi
 * « Le Boursin » serait « LB » d'un côté et « BO » de l'autre.
 */
const OUTILS = /^(le|la|les|l|de|du|des|d|au|aux|à|et|the)$/i;

export function monogramme(nom: string): string {
  const mots = nom.trim().split(/[\s'’-]+/).filter(Boolean);
  const forts = mots.filter((m) => !OUTILS.test(m));
  const source = forts.length > 0 ? forts : mots;
  // Un seul mot (« Végétarien ») : deux lettres. Une initiale isolée flotte au
  // milieu de la vignette, deux lettres en tiennent la surface.
  const lettres =
    source.length > 1
      ? source
          .slice(0, 2)
          .map((m) => m[0] ?? '')
          .join('')
      : (source[0] ?? nom.trim()).slice(0, 2);
  return (lettres || nom.trim().slice(0, 2)).toUpperCase();
}
