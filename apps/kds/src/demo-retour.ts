/**
 * Le retour à la vitrine, côté écran cuisine.
 *
 * Jumeau de `apps/pos/src/demo-retour.ts` : même décision, même vocabulaire,
 * même variable d'environnement. La duplication est assumée — les deux
 * applications Expo ne partagent que `@sm/client-core`, qui porte la règle, et
 * la règle est justement ce qui ne doit pas diverger.
 *
 * ─── LA DESTINATION EST UN RÉGLAGE D'INSTALLATION, PAS UN PARAMÈTRE D'URL ───
 *
 * Elle se lit dans `EXPO_PUBLIC_SITE_URL`, comme l'URL d'API se lit dans
 * `config.ts`. Metro remplace l'expression littérale par sa valeur À L'EXPORT :
 * le bundle part avec l'adresse dedans, et rien à l'exécution ne peut la
 * changer. Accepter une adresse venue de l'URL publierait une redirection
 * ouverte — un lien portant NOTRE domaine qui dépose le visiteur chez un
 * pirate.
 *
 * ⚠️ `process.env.EXPO_PUBLIC_SITE_URL` est écrit EN TOUTES LETTRES : Metro
 * fait une substitution textuelle, un accès calculé rendrait `undefined`.
 */
import {
  estEncadre,
  isDemoRequested,
  origineCourante,
  referrerCourant,
  retourDemo,
  type RetourDemo,
} from '@sm/client-core';

/** Ce que la configuration dit, ou rien. Jamais l'URL courante. */
export function siteConfigure(): string | null {
  return process.env.EXPO_PUBLIC_SITE_URL ?? null;
}

/**
 * Le bandeau à afficher, ou `null`.
 *
 * `null` sur un écran de cuisine en service — et c'est le point : un mural lu
 * de loin, touché avec des gants, ne doit pas porter de lien qui vide l'écran
 * des tickets en cours.
 */
export function retourVitrine(): RetourDemo | null {
  return retourDemo({
    demo: isDemoRequested(),
    encadre: estEncadre(),
    referrer: referrerCourant(),
    site: siteConfigure(),
    origine: origineCourante(),
  });
}
