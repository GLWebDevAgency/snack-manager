/**
 * L'ADRESSE PUBLIQUE DU SITE VITRINE — ÉCRITE UNE FOIS.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * Le repli `process.env.NEXT_PUBLIC_SITE_URL ?? "https://snackmanager.fr"` était
 * saisi à la main dans TROIS fichiers : `app/(marketing)/layout.tsx`,
 * `app/(marketing)/offres/page.tsx` et `app/(marketing)/blog/_articles/
 * registre.ts` — trois surfaces écrites par trois mains, chacune signalant dans
 * son propre commentaire qu'elle recopiait. C'est exactement la faute que
 * `PRICE_RANGE` (content.ts) existe pour empêcher, avec la même conséquence :
 * le jour où le domaine change, deux des trois suivent et la troisième publie
 * des URL canoniques et des données structurées qui désignent l'ancien nom.
 * Rien ne le signale — ni le typecheck, ni le rendu, qui affiche des liens
 * parfaitement normaux vers un domaine mort.
 *
 * ═══ POURQUOI SOUS `lib/` ET PAS SOUS `(marketing)` ═══
 *
 * `app/sitemap.ts` et `app/robots.ts` en ont besoin, et ces deux fichiers
 * doivent vivre à la RACINE de `app/` (convention Next : c'est cet emplacement,
 * et lui seul, qui sert `/sitemap.xml` et `/robots.txt`). Un module posé dans le
 * groupe `(marketing)` leur serait importable, mais il dirait le contraire de ce
 * qu'il est : cette adresse n'appartient pas à la vitrine, elle appartient au
 * site.
 *
 * ═══ CE QUE CE MODULE NE COUVRE PAS ═══
 *
 * `app/r/[slug]/page.tsx` lit la même variable d'environnement mais avec un
 * repli DIFFÉRENT (`http://localhost:3000`) et un autre contrat : cette route
 * sert les vitrines de restaurant, réécrites depuis le domaine du client par
 * `src/proxy.ts`. Lui imposer le repli de la vitrine changerait son
 * comportement en développement. Les deux ne sont pas la même adresse ; elles
 * ne partagent que le nom de la variable.
 */

/**
 * L'origine publique, SANS barre oblique finale.
 *
 * Le nettoyage n'est pas cosmétique : une variable d'environnement renseignée
 * « https://snackmanager.fr/ » — ce que fait n'importe quel copier-coller
 * depuis une barre d'adresse — produit `https://snackmanager.fr//offres` à la
 * première concaténation, c'est-à-dire une URL canonique que les moteurs
 * traitent comme une page distincte de la vraie.
 */
export const SITE_URL: string = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://snackmanager.fr").replace(/\/+$/, "");

/**
 * Chemin de l'application → URL absolue.
 *
 * Les métadonnées Next (`alternates.canonical`, `openGraph.url`) se résolvent
 * toutes seules contre le `metadataBase` du layout : on leur donne des chemins
 * relatifs, jamais une origine. Cette fonction est là pour les deux usages qui
 * n'ont PAS ce luxe — le JSON-LD, où schema.org veut des URL absolues et où un
 * `@id` relatif ne référence rien, et le plan de site, dont le format exige des
 * `<loc>` complètes.
 *
 * `new URL` plutôt qu'une concaténation : elle normalise, et elle lève sur une
 * base invalide au lieu de produire une adresse fausse en silence.
 */
export const urlAbsolue = (chemin: string): string => new URL(chemin, SITE_URL).toString();
