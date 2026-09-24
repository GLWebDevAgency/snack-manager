# Vérifications du carnet — 24 septembre 2026

Branche dédiée créée depuis main `02c81e5769307eac35f3050e5dd0c83e12cca486`, après publication de la landing validée. Aucune modification du checkout utilisateur.

## Exécuté localement

- Build Next.js 16.3.1 optimisé et TypeScript : réussite, 60 pages générées.
- ESLint des fichiers modifiés : réussite.
- Tests Vitest : 100/100 (proxy existant, politique SEO, sitemap/robots, vrais articles et schémas, contrats commerciaux existants).
- `node scripts/audit-public-seo.mjs http://localhost:3196 https://snackmanager.fr --noindex` : 183/183 contrôles HTTP réussis, 5 articles, 17 GET uniques.
- HTTP : cinq cartes de partage PNG 1200×630, slug de partage inconnu en 404 ; images de l’index et de la rédaction présentes.
- Chrome : index et guide menus au format bureau et viewport 390×844. Absence de débordement horizontal observée, contenu visible, tableau contenu dans sa colonne. Catégories et illustration de l’index vérifiées sur mobile ; viewport rétabli après les contrôles.
- Carte Open Graph du guide menus : contrôle visuel du PNG 1200×630, titre lisible sans troncature.
- Hydratation en développement : avertissement observé sur l’attribut `kapture-loaded` ajouté au body par une extension. Aucun résultat de navigateur vierge ni Safari/iPhone physique n’est revendiqué.

Les contrôles HTTP lisent le HTML et les en-têtes ; ils ne démontrent ni l’indexation effective ni le classement. La couverture visuelle n’est pas un audit WCAG complet.

## Configuration externe observée

Le compte Google déjà connecté dans Chrome présente des propriétés pour un autre projet, aucune pour Snack Manager. Le DNS TXT public de snackmanager.fr présente SPF, aucun jeton `google-site-verification`. Cela ne permet pas d’exclure une propriété configurée sous un autre compte ou une autre méthode.

Aucune propriété n’a été créée, aucun droit attribué, aucun DNS modifié. La fiche Google Business Profile reste un dossier préparatoire ; mode d’activité, zone, coordonnées professionnelles et fiche existante attendent la réponse du propriétaire.

Le gestionnaire Google Business du compte ouvert présente une fiche « gl.dev », mais aucune fiche Snack Manager. Le lien réel entre les deux activités doit être confirmé avant une création. Bing Webmaster Tools présente l’écran de connexion ; aucune propriété Bing n’a pu être consultée.

## Mesure de performance

Un essai PageSpeed Insights mobile, le 24 septembre 2026 à 15:12:28 UTC, sur la landing de production a reçu HTTP 429 (`RESOURCE_EXHAUSTED / rateLimitExceeded`). Aucun score Lighthouse ni indicateur terrain LCP, CLS ou INP n’a été retourné. Ce refus de quota ne constitue pas une mesure de performance. Aucune relance n’a été faite.

## Production de la landing, livraison distincte

PR #205, merge `02c81e5769307eac35f3050e5dd0c83e12cca486`. Workflow 36012130765 réussi ; API/web/POS/KDS SUCCESS. Smoke : 5 contrôles verts et 1 ignoré (carte publique sans slug). HTTP snackmanager.fr : nouveau menu, styles des plis et typographie TV présents ; les 3 SVG correspondent aux fichiers du dépôt. Chrome : intérieur sélectionné, vues TV et Ensemble sélectionnées, zéro illustration cassée, pas de débordement ; retour à Papier/Animation.

## Staging de la refonte blog

PR #212 fusionnée dans develop : `f677246d450e0f84bc9220afed0a34890556a615`.

- [Workflow de déploiement 36018311436](https://github.com/GLWebDevAgency/snack-manager/actions/runs/36018311436) : SUCCESS le 24 septembre à 15:42:50 UTC.
- API, web, POS et KDS : SUCCESS. Déploiement web `06b9dcd8-4a2e-4c4b-8f1d-1100d24a71e7`.
- Smoke du workflow avec la révision attendue : 8/8 contrôles verts, aucun contrôle ignoré ; révision API confirmée.
- Audit HTTP sur `https://staging.snackmanager.fr` : 183/183 contrôles, cinq articles, 17 GET uniques. Les images de partage, schémas, canonicals, sommaires, sitemap et consignes d’indexation passent.
- L’alias Railway `/blog` et les routes `/admin`, `/sm` sur staging renvoient `X-Robots-Tag: noindex, nofollow`.
- Chrome : index publié contrôlé sur bureau et mobile, sans débordement horizontal ni image cassée. Aucun avertissement ou erreur navigateur observé sur l’index de staging.

La publication du blog en production attend la validation de staging ; PR #213 reste en brouillon. Elle ne fait pas partie de l’approbation de production de PR #205. Les compléments au dossier Google Business et à ce reçu sont documentaires ; ils ne modifient pas le code testé sur staging.
