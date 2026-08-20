/**
 * Le retour à la vitrine, côté caisse.
 *
 * Ce module ne fait qu'une chose : brancher la décision commune
 * (`@sm/client-core/demo/retour`) sur la CONFIGURATION de cette application.
 *
 * ─── LA DESTINATION EST UN RÉGLAGE D'INSTALLATION, PAS UN PARAMÈTRE D'URL ───
 *
 * Elle se lit dans `EXPO_PUBLIC_SITE_URL`, exactement comme l'URL d'API se lit
 * dans la configuration du poste : Metro remplace l'expression littérale par sa
 * valeur À L'EXPORT, si bien que le bundle part avec l'adresse dedans et que
 * rien, au moment de l'exécution, ne peut la changer. C'est le point : accepter
 * une adresse de retour venue de l'URL publierait une redirection ouverte —
 * un lien portant NOTRE domaine qui dépose le visiteur chez un pirate.
 *
 * `process.env.EXPO_PUBLIC_SITE_URL` est écrit EN TOUTES LETTRES et une seule
 * fois : Metro fait une substitution textuelle, un accès calculé
 * (`process.env[cle]`) rendrait `undefined` dans le bundle exporté.
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
 * Le bandeau à afficher, ou `null` s'il ne doit pas exister.
 *
 * `null` dans trois cas, et le premier est le seul qui compte vraiment : la
 * caisse n'est pas en démonstration. Un poste en service ne montre jamais de
 * porte de sortie vers notre site commercial.
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
