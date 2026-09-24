# Vérifications du carnet — 24 septembre 2026

Branche dédiée créée depuis main `02c81e5769307eac35f3050e5dd0c83e12cca486`, après publication de la landing validée. Aucune modification du checkout utilisateur.

## Exécuté localement

- Build Next.js 16.3.1 optimisé et TypeScript : réussite, 60 pages générées.
- ESLint des fichiers modifiés : réussite.
- Tests Vitest : 100/100 (proxy existant, politique SEO, sitemap/robots, vrais articles et schémas, contrats commerciaux existants).
- `node scripts/audit-public-seo.mjs http://localhost:3196 https://snackmanager.fr --noindex` : 183/183 contrôles HTTP réussis, 5 articles, 17 GET uniques.
- HTTP : cinq cartes de partage PNG 1200×630, slug de partage inconnu en 404 ; images de l’index et de la rédaction présentes.
- Chrome : index de blog au format bureau ; lecture du guide menus au format bureau et viewport 390×844. Absence de débordement horizontal observée, contenu visible, tableau contenu dans sa colonne.
- Hydratation en développement : avertissement observé sur l’attribut `kapture-loaded` ajouté au body par une extension. Aucun résultat de navigateur vierge ni Safari/iPhone physique n’est revendiqué.

Les contrôles HTTP lisent le HTML et les en-têtes ; ils ne démontrent ni l’indexation effective ni le classement. La couverture visuelle n’est pas un audit WCAG complet.

## Configuration externe observée

Le compte Google déjà connecté dans Chrome présente des propriétés pour un autre projet, aucune pour Snack Manager. Le DNS TXT public de snackmanager.fr présente SPF, aucun jeton `google-site-verification`. Cela ne permet pas d’exclure une propriété configurée sous un autre compte ou une autre méthode.

Aucune propriété n’a été créée, aucun droit attribué, aucun DNS modifié. La fiche Google Business Profile reste un dossier préparatoire ; mode d’activité, zone, coordonnées professionnelles et fiche existante attendent la réponse du propriétaire.

## Production de la landing, livraison distincte

PR205, merge `02c81e5769307eac35f3050e5dd0c83e12cca486`. Workflow36012130765 réussi ; API/web/POS/KDS SUCCESS. Smoke5 contrôles verts et1 ignoré (carte publique sans slug). HTTP snackmanager.fr : nouveau menu, styles des plis et typographieTV présents ; les3SVG correspondent aux fichiers du dépôt. Chrome : intérieur sélectionné, vuesTV etEnsemble sélectionnées, zéro illustration cassée, pas de débordement ; retour à Papier/Animation.

## Staging de la refonte blog

Publication et contrôle de la révision servie à compléter après CI. La nouvelle refonte blog/SEO ne fait pas partie de l’approbation de production de PR205.
