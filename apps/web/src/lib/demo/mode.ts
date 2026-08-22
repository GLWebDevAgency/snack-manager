"use client";

/**
 * Bascule du mode démonstration du back-office.
 *
 * ─── LA RÈGLE, ET ELLE N'A QU'UNE FORME ───
 *
 * Le mode démonstration s'active PAR LE PARAMÈTRE D'URL `?demo=1`, ET PAR RIEN
 * D'AUTRE. Pas de variable d'environnement, pas de drapeau de build, pas de
 * valeur par défaut, pas de reste dans `localStorage`.
 *
 * La raison n'est pas esthétique. Ce back-office pilote un vrai restaurant :
 * un gérant qui basculerait en démonstration sans le savoir changerait des
 * prix dans le vide, croirait avoir accepté des commandes qui ne partiraient
 * jamais en cuisine, et ne s'en apercevrait qu'au premier client qui réclame.
 * Un défaut d'environnement mal propagé suffirait à provoquer ça ; un
 * paramètre d'URL, non : il faut que quelqu'un l'ait écrit.
 *
 * Corollaire assumé et voulu : RIEN ne mémorise le mode. Pas de `localStorage`,
 * pas de cookie, pas de `sessionStorage`. C'est ce qui garantit qu'un
 * rechargement sans le paramètre rend un poste ordinaire, et qu'un
 * rechargement AVEC le paramètre remet la démonstration à zéro.
 *
 * ─── LE PARAMÈTRE DOIT SURVIVRE À LA NAVIGATION INTERNE ───
 *
 * C'est le piège de cette surface, et il est mortel : le back-office navigue
 * avec le routeur Next (`<Link>`), pas par rechargement. Le routeur réécrit
 * l'URL avec `history.pushState` en n'y remettant que le chemin canonique —
 * la requête est perdue au PREMIER clic. Sans rien faire, le visiteur qui
 * arrive sur `/admin/dashboard?demo=1` et clique « Commandes » atterrit sur
 * `/admin/orders`, sans jeton, et se fait éjecter vers la page de connexion :
 * la démonstration s'arrête au premier clic.
 *
 * Deux filets, indépendants l'un de l'autre :
 *
 *   1. L'ARMEMENT EST EN MÉMOIRE. Il est lu UNE fois, au chargement du module,
 *      depuis l'URL d'entrée. Une navigation client ne recharge pas le module,
 *      donc l'armement traverse toutes les navigations, même si l'URL était
 *      réécrite. C'est ce filet qui fait vivre la démonstration.
 *   2. L'URL EST RECOLLÉE. `history.pushState`/`replaceState` sont enveloppés
 *      pour remettre `?demo=1` sur chaque URL poussée. C'est ce filet qui rend
 *      l'adresse partageable et le rechargement sans surprise.
 *
 * Le second est un confort ; le premier est la garantie. Si l'enveloppe
 * cessait de fonctionner (réécriture interne de Next), la démonstration
 * continuerait de tourner — elle perdrait seulement son adresse.
 *
 * L'enveloppe est volontairement neutre vis-à-vis de Next : elle se contente
 * de réécrire l'argument `url` puis délègue à la fonction précédente, quelle
 * qu'elle soit. Elle fonctionne donc que Next ait déjà posé la sienne ou
 * qu'il la pose ensuite.
 */

/** Le seul déclencheur reconnu, et la seule valeur acceptée. */
export const DEMO_PARAM = "demo";
export const DEMO_VALUE = "1";

/**
 * La seule surface que cette démonstration couvre.
 *
 * `lib/api.ts` sert DEUX back-offices : `/admin` pour le gérant du restaurant
 * et `/sm` pour l'équipe Snack Manager. Sans cette borne, un `?demo=1` collé
 * sur une adresse `/sm` détournerait aussi les appels du back-office
 * d'ÉQUIPE — vers un routeur qui ne connaît aucune de ses routes. L'écran se
 * remplirait de « route absente » au lieu de demander une connexion, et
 * quelqu'un chercherait longtemps.
 *
 * La borne ne peut que RESTREINDRE l'activation : elle s'ajoute au paramètre,
 * elle ne le remplace pas.
 */
const DEMO_PATH_PREFIX = "/admin";

/**
 * L'URL demande-t-elle le mode démonstration ?
 *
 * Le fragment tombe d'abord : `#/ecran?demo=1` n'est pas la requête de la
 * page, c'est du texte après le dièse. La valeur doit être EXACTEMENT `1` —
 * `?demo=0`, `?demo=true`, `?demo` ou `?demo=11` ne sont pas des demandes.
 */
export function isDemoRequested(href: string | null | undefined): boolean {
  if (!href) return false;
  const withoutHash = href.split("#")[0] ?? "";
  const mark = withoutHash.indexOf("?");
  if (mark === -1) return false;
  for (const pair of withoutHash.slice(mark + 1).split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(pair.slice(0, eq));
      value = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      continue; // séquence d'échappement invalide : ce n'est pas notre paramètre
    }
    if (key === DEMO_PARAM && value === DEMO_VALUE) return true;
  }
  return false;
}

/** Ajoute `?demo=1` à une URL qui ne l'a pas déjà. Chemin, requête, fragment. */
export function withDemoParam(href: string): string {
  if (isDemoRequested(href)) return href;
  const hash = href.indexOf("#");
  const base = hash === -1 ? href : href.slice(0, hash);
  const tail = hash === -1 ? "" : href.slice(hash);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${DEMO_PARAM}=${DEMO_VALUE}${tail}`;
}

// ─────────────────────────────────────────────────────────────
// Armement
// ─────────────────────────────────────────────────────────────

/**
 * `null` tant que la question n'a pas été posée. Lu paresseusement pour que
 * `isDemoActive()` donne la même réponse au premier et au millième appel :
 * une bascule à mi-parcours ferait pire que tout — la moitié des écrans sur la
 * fixture, l'autre sur le réseau.
 */
let armed: boolean | null = null;

/** URL du document courant, `null` hors navigateur (rendu serveur). */
function currentHref(): string | null {
  const location = (globalThis as { location?: { href?: unknown } }).location;
  return typeof location?.href === "string" ? location.href : null;
}

/**
 * Le mode démonstration est-il actif pour CE chargement de page ?
 *
 * Hors navigateur, la réponse est toujours `false` : le rendu serveur n'a pas
 * d'URL de visiteur, et une réponse `true` y ferait diverger l'hydratation.
 */
export function isDemoActive(): boolean {
  if (armed !== null) return armed;
  const href = currentHref();
  if (href === null) return false; // sans URL, pas d'armement — et rien de mémorisé
  armed = isDemoRequested(href) && isDemoSurface(href);
  if (armed) keepDemoParam();
  return armed;
}

/** L'URL désigne-t-elle le back-office du gérant, la seule surface couverte ? */
export function isDemoSurface(href: string): boolean {
  const path = href
    .split("#")[0]!
    .split("?")[0]!
    // Retire le schéma et l'hôte s'ils sont là ; une URL relative passe telle quelle.
    .replace(/^[a-z]+:\/\/[^/]*/i, "");
  return path === DEMO_PATH_PREFIX || path.startsWith(`${DEMO_PATH_PREFIX}/`);
}

/**
 * Remet l'état d'armement à zéro. Réservé aux tests : en production, un
 * chargement de page a un seul mode, du début à la fin.
 */
export function resetDemoModeForTests(): void {
  armed = null;
}

// ─────────────────────────────────────────────────────────────
// Recollage du paramètre
// ─────────────────────────────────────────────────────────────

let patched = false;

/**
 * Enveloppe `pushState`/`replaceState` pour que le paramètre reste dans
 * l'adresse à chaque navigation du routeur.
 *
 * On délègue TOUJOURS à la fonction précédemment installée (Next en pose une
 * pour synchroniser son état interne) : l'enveloppe n'a pas à savoir qui est
 * derrière elle, et l'ordre d'installation n'a donc pas d'importance.
 */
function keepDemoParam(): void {
  if (patched) return;
  const history = (globalThis as { history?: History }).history;
  if (!history?.pushState) return;
  patched = true;

  const wrap = (
    original: (data: unknown, unused: string, url?: string | URL | null) => void,
  ) =>
    function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      // `url` absente : le routeur ne change que l'état, pas l'adresse. Rien à
      // recoller — et forcer une URL ici casserait ce cas parfaitement normal.
      if (url === undefined || url === null) return original.call(this, data, unused, url);
      return original.call(this, data, unused, withDemoParam(String(url)));
    };

  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = wrap(push);
  history.replaceState = wrap(replace);
}
