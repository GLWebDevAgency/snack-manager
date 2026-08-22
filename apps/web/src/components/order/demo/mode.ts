/**
 * Bascule du mode démonstration de la COMMANDE EN LIGNE.
 *
 * ─── LA RÈGLE, ET ELLE A DEUX VERROUS ───
 *
 * La démonstration s'active si, ET SEULEMENT SI :
 *   1. l'adresse porte le paramètre `?demo=1`, valeur exacte, écrite à la main ;
 *   2. le restaurant demandé est `demo`, le slug réservé à la vitrine.
 *
 * Pas de variable d'environnement, pas de drapeau de build, pas de valeur par
 * défaut, pas de reste dans le stockage local. Le patron vient de
 * `packages/client-core/src/demo/mode.ts` (caisse et écran cuisine) ; il gagne
 * ici un second verrou, et ce n'est pas de la ceinture-bretelles.
 *
 * ─── POURQUOI DEUX VERROUS ICI ───
 *
 * La caisse est une application par restaurant : `?demo=1` n'y engage que la
 * tablette qui l'a écrit. Cette page-ci est différente — un seul déploiement
 * sert TOUS les restaurants, et l'adresse du client est souvent son propre
 * domaine (`maboite.fr`, réécrit vers `/r/<slug>` par `src/proxy.ts`). Un mode
 * démonstration qui ne tiendrait qu'au paramètre suffirait alors à ce que
 * `maboite.fr/?demo=1` serve la carte d'un restaurant fictif AUX CLIENTS DE
 * MABOITE : des prix qui ne sont pas les siens, des plats qu'il ne fait pas,
 * sur son domaine, dans un lien qu'un concurrent ou un plaisantin peut faire
 * circuler. C'est la panne la plus grave que cette page puisse produire.
 *
 * Le second verrou l'interdit par construction : la carte fictive n'existe que
 * sous `/r/demo`, une adresse qui n'appartient à aucun restaurant. Et la route
 * `/r/[slug]`, celle des vrais restaurants, n'importe RIEN de ce dossier.
 *
 * Corollaire assumé : rien ne mémorise le mode. `?demo=1` retiré de l'adresse,
 * `/r/demo` redevient un restaurant inconnu — donc un 404 franc, jamais une
 * carte fictive servie sans qu'on l'ait demandée.
 *
 * `mode.test.ts` épingle chacun de ces points.
 */

/** Le seul déclencheur reconnu. */
export const DEMO_PARAM = "demo";
export const DEMO_VALUE = "1";

/**
 * Slug réservé à la démonstration — aucun restaurant ne le porte.
 *
 * Il vaut `demo` et non `le-comptoir` : « Le Comptoir » est un nom d'enseigne
 * banal, un vrai client pourrait l'obtenir un jour, et son panier partagerait
 * alors la clé de stockage de la démonstration. `demo` reste le nom AFFICHÉ du
 * restaurant fictif — c'est le même établissement que dans la caisse et
 * l'écran cuisine ; seule son adresse d'URL est neutre.
 */
export const DEMO_SLUG = "demo";

/** L'adresse qui ouvre la démonstration, telle qu'on la met dans un lien. */
export const DEMO_PATH = `/r/${DEMO_SLUG}?${DEMO_PARAM}=${DEMO_VALUE}`;

/** Ce que Next.js remet dans `searchParams` (une clé peut être répétée). */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Cette requête demande-t-elle la démonstration ?
 *
 * @param slug   restaurant demandé par l'URL (segment `/r/<slug>`).
 * @param params paramètres de l'adresse — objet de Next, `URLSearchParams`,
 *               chaîne de requête ou URL complète, au choix de l'appelant.
 */
export function isDemoRequested(slug: string, params: unknown): boolean {
  if (slug !== DEMO_SLUG) return false;
  return demoParamOf(params) === DEMO_VALUE;
}

/**
 * La page COURANTE est-elle la démonstration de la commande en ligne ?
 *
 * `isDemoRequested` répond à la question du serveur, qui tient déjà le slug de
 * l'adresse. Celle-ci répond à la question du NAVIGATEUR, qui n'a qu'une URL :
 * elle sert au bandeau de retour, qui se dessine après hydratation et ne doit
 * exister que sur cette page-là.
 *
 * C'est une ceinture par-dessus des bretelles — la route répond déjà 404 sans
 * `?demo=1` — et c'est délibéré : si ce composant se retrouvait un jour monté
 * ailleurs, aucun lien vers notre site commercial n'apparaîtrait sur la page
 * d'un vrai restaurant, servie sur SON domaine.
 */
export function isDemoStorefront(href: string | null | undefined): boolean {
  if (!href) return false;
  // Le fragment tombe d'abord : il n'est pas envoyé au serveur et ne désigne
  // pas la page.
  const sansFragment = href.split("#")[0] ?? "";
  const marque = sansFragment.indexOf("?");
  const chemin = (marque === -1 ? sansFragment : sansFragment.slice(0, marque))
    // Retire le schéma et l'hôte s'ils sont là ; une URL relative passe telle quelle.
    .replace(/^[a-z]+:\/\/[^/]*/i, "");
  const normalise = chemin.replace(/\/+$/, "") || "/";
  if (normalise !== `/r/${DEMO_SLUG}`) return false;
  return demoParamOf(marque === -1 ? "" : sansFragment.slice(marque + 1)) === DEMO_VALUE;
}

/**
 * Valeur du paramètre `demo`, ou `null`.
 *
 * Un paramètre RÉPÉTÉ (`?demo=1&demo=0`) ne vaut rien : on ne devine pas
 * laquelle des deux valeurs comptait.
 */
function demoParamOf(params: unknown): string | null {
  if (params == null) return null;

  if (typeof params === "string") {
    // Le fragment tombe d'abord : `#/carte?demo=1` n'est pas la requête de la
    // page, c'est du texte après le dièse.
    const withoutHash = params.split("#")[0] ?? "";
    const start = withoutHash.indexOf("?");
    const query = start === -1 ? withoutHash : withoutHash.slice(start + 1);
    return demoParamOf(new URLSearchParams(query));
  }

  if (params instanceof URLSearchParams) {
    const all = params.getAll(DEMO_PARAM);
    return all.length === 1 ? (all[0] ?? null) : null;
  }

  if (typeof params === "object") {
    const raw = (params as SearchParams)[DEMO_PARAM];
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) return raw.length === 1 ? (raw[0] ?? null) : null;
  }

  return null;
}
