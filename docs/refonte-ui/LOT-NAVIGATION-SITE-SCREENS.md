# Site web et écrans de salle : navigation interne

Branche `feat/admin-section-navigation`, base `4d8525615924aa701a4b92b9ae3709bbd0dd6607`. Lot du 13 septembre 2026, limité aux pages existantes et à leur présentation.

## Changements

- Site web : **Commande en ligne / Adresses**, accessibles directement par `?section=commande` et `?section=adresses`. Les quatre sections existantes de l’éditeur restent conservées : Identité, Accueil, Carte et Style avancé. Sur téléphone, elles occupent deux colonnes. Les formats d’aperçu ont des cibles de 44 px.
- Adresses : le site vitrine, le lien public, les domaines, les instructions DNS et les confirmations restent réunis. Les adresses longues et les valeurs DNS restent lisibles à 320 px ; les champs et suggestions n’imposent plus une largeur minimale supérieure à leur conteneur.
- Écrans de salle : **Vos écrans / Installation et services**, accessibles par `?section=ecrans` et `?section=installation`. La grille utilise la largeur réellement disponible. Les actions, dialogues d’installation, apparence et composition restent attachés à leur écran.
- Playlist : à petite largeur, le titre de chaque scène précède sa durée et ses commandes. Déplacer/retirer utilisent des cibles de 44 px ; le pied de sauvegarde peut revenir à la ligne et conserve son message complet.

Les changements de section utilisent la primitive commune `AdminSections`, gardent les panneaux montés et conservent les autres paramètres d’URL. Aucun handler, contrat API, contrôle de droit, chargement métier ou calcul de diffusion n’est remplacé. Les clés de session/établissement, les brouillons de nom/marque/produits, le chargement différé de la carte, l’aperçu réel et le rafraîchissement silencieux des écrans restent conservés. Sans module de commande en ligne, `WebsitePanel` reste disponible seul comme avant ; les droits de marque et de menu restent ceux de `useSitePermissions` et `AdminAccess`.

## Fichiers du lot

`apps/web/src/app/admin/site/{page.tsx,parts.tsx,pilotage.module.css}`, `apps/web/src/app/admin/screens/{page.tsx,screen-card.tsx,playlist-drawer.tsx,navigation.module.css}` et `e2e/local/admin-site-screens-navigation.mjs`. La primitive et les corrections communes du shell et des dialogues appartiennent aux lots coordonnés par l’agent principal.

## Validation exécutée

Tests ciblés : **94/94**, **8 fichiers**, **0 ignoré**, dont **15 tests navigateur** du changement de session/établissement et des réponses tardives. Commande : `pnpm --filter @sm/web exec vitest run src/app/admin/site src/app/admin/screens/apparence src/app/admin/settings/marque.test.ts src/lib/demo/screen-preview.test.ts --no-file-parallelism`. [Journal](preuves/navigation-site-screens-tests.log).

ESLint des cinq fichiers TSX modifiés : succès, sans avertissement. Vérification syntaxique Node du harnais et `git diff --check` : succès. Typecheck, build et suite web complète sont coordonnés par l’agent principal ; ils ne sont pas comptés ici comme des exécutions de ce lot.

La première recette sur le vrai build Next a confirmé la conservation des quatre brouillons du site à 320 px. Elle a aussi révélé deux défauts de la couche commune : un aperçu inline masqué par Retour alors que son isolation restait active, puis le focus perdu après fermeture simultanée de la confirmation et de son tiroir. Les assertions ont été conservées ; les corrections communes sont validées par leurs tests dédiés avant le prochain build. Les préconditions de la recette ont été précisées pour le bouton Fermer présent en tête et en pied, et pour le menu tablette superposé du premier build. Les journaux intermédiaires ne sont pas une preuve de réussite finale.

## Recette finale sur le build combiné

Le harnais `admin-site-screens-navigation.mjs` couvre les deux pages à 320, 768 et 1440 px, en clair et en sombre : **12 scénarios**. Il utilise exclusivement le mode démo du dépôt, autorise les GET de l’origine Next loopback et refuse toute requête externe, API réelle, mutation HTTP ou WebSocket.

Les contrôles portent sur les URLs directes, `demo` et les paramètres voisins, Retour/Avant, Home/End et le focus, les quatre brouillons du site, l’aperçu agrandi lors d’un Retour, l’ordre et les durées des scènes, Reprendre/Abandonner sans publication, la durée enregistrée retrouvée à la réouverture, l’aperçu Midi et la pause. Les cibles de navigation et des scènes doivent mesurer au moins 44 px, sans débordement horizontal du document.

Résultat final sur Next `Kws_-Jw8xTKQB-BO0WFhd`, servi à `http://127.0.0.1:3092` : **12/12 scénarios réussis**, **0 ignoré**, **42 captures**, **0 erreur JavaScript et 0 requête interdite**. [Journal d’exécution](preuves/navigation-site-screens-final.log) et [résultats détaillés](captures/navigation-site-screens-final/results.json).

Les deux régressions de focus révélées pendant la recette passent avec leurs assertions conservées : l’aperçu du site reste visible et fermable après Retour, puis l’onglet actif reprend le focus ; abandonner simultanément la confirmation et la playlist rend le focus à son bouton d’ouverture. La réouverture de la playlist retrouve sa durée enregistrée. Les thèmes, la simulation Midi et la pause de l’aperçu restent opérationnels.

Captures inspectées : [site 320 clair](captures/navigation-site-screens-final/site-320-light-adresses.png), [aperçu du site après Retour, 320 sombre](captures/navigation-site-screens-final/site-320-dark-apercu-retour.png), [playlist 768 clair](captures/navigation-site-screens-final/screens-768-light-playlist-brouillon.png) et [écrans 1440 sombre](captures/navigation-site-screens-final/screens-1440-dark-ecrans.png). Le cadrage des captures du site a été corrigé dans le harnais pour remonter le conteneur `main` du shell, puis la recette a été rejouée sur le même build ; aucune source applicative n’a changé pour cette reprise.

Limites : ces preuves utilisent les vrais composants et les vraies routes Next en **démo locale**. Aucun compte réel, paiement, appareil physique ou déploiement n’est utilisé. La recette n’établit pas une validation des mutations contre une API réelle, ni un audit complet VoiceOver ou WCAG.
