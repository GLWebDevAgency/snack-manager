/**
 * Bascule du mode démonstration.
 *
 * ─── LA RÈGLE, ET ELLE N'A QU'UNE FORME ───
 *
 * Le mode démonstration s'active PAR LE PARAMÈTRE D'URL `?demo=1`, ET PAR RIEN
 * D'AUTRE. Pas de variable d'environnement, pas de drapeau de build, pas de
 * valeur par défaut, pas de reste dans le stockage local.
 *
 * La raison n'est pas esthétique : ces applications tournent sur des tablettes
 * en plein service. Une caisse qui basculerait en démonstration par accident
 * encaisserait dans le vide — le ticket part vers une fixture, la cuisine ne
 * voit rien, et personne ne s'en aperçoit avant le premier client qui réclame
 * sa commande. Un défaut d'environnement mal propagé suffirait ; un paramètre
 * d'URL, non : il faut que quelqu'un l'ait écrit.
 *
 * Corollaire assumé : rien ne mémorise le mode. `?demo=1` retiré de l'URL, le
 * poste redevient un poste. C'est aussi ce qui garantit qu'un rechargement
 * remet la démonstration à zéro.
 *
 * `demo.test.ts` épingle chacun de ces points.
 */

/** Le seul déclencheur reconnu. */
export const DEMO_PARAM = 'demo';
export const DEMO_VALUE = '1';

/**
 * L'URL courante demande-t-elle le mode démonstration ?
 *
 * Hors navigateur (tablette native : aucune `location`), la réponse est
 * toujours `false` — une application native n'a pas d'URL, donc pas de moyen
 * de le demander, donc pas de moyen de l'obtenir.
 *
 * @param href URL à examiner. Par défaut celle du document courant.
 */
export function isDemoRequested(href: string | null = currentHref()): boolean {
  if (!href) return false;
  // Le fragment tombe d'abord : `#/ecran?demo=1` n'est pas la requête de la
  // page, c'est du texte après le dièse.
  const withoutHash = href.split('#')[0] ?? '';
  const query = withoutHash.indexOf('?');
  if (query === -1) return false;
  for (const pair of withoutHash.slice(query + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (decodeURIComponent(pair.slice(0, eq)) !== DEMO_PARAM) continue;
    if (decodeURIComponent(pair.slice(eq + 1)) === DEMO_VALUE) return true;
  }
  return false;
}

/** URL du document courant, `null` hors navigateur. */
function currentHref(): string | null {
  const location = (globalThis as { location?: { href?: unknown } }).location;
  return typeof location?.href === 'string' ? location.href : null;
}
