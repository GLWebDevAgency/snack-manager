# Validation — navigation du back-office restaurateur

Date : 13 septembre 2026. Branche `feat/admin-section-navigation`, base `4d8525615924aa701a4b92b9ae3709bbd0dd6607` (identique à develop distant vérifié pendant le lot). Worktree dédié ; aucune fusion ni publication. Node24.20.0, pnpm10.14.0 ; Next16.3.1 et React19.2.8 conservés.

## Résultat exécuté sur la version finale

Build Next **`Kws_-Jw8xTKQB-BO0WFhd`**, lancé avec l’API de recette `http://127.0.0.1:3094` et servi uniquement sur `127.0.0.1:3092`. [Empreintes des sources, tests et recettes](preuves/admin-navigation-source-manifest.json).

| Contrôle | Résultat | Preuve |
| --- | --- | --- |
| Contrats, préalable au web sur la nouvelle base | `pnpm --filter @sm/contracts build` réussi ; aucune source modifiée | Exécution terminal, dist régénéré |
| Suite web complète | **198 fichiers, 3 074 tests réussis, 0 ignoré** ; `pnpm --filter @sm/web test --maxWorkers=4` | [Log final](preuves/admin-navigation-tests-final.log) |
| Typecheck web | `pnpm --filter @sm/web typecheck` réussi | [Log](preuves/admin-navigation-typecheck-final.log) |
| Build web | `NEXT_PUBLIC_API_URL=http://127.0.0.1:3094 pnpm --filter @sm/web build` réussi, TypeScript inclus | [Log](preuves/admin-navigation-build-final.log) |
| ESLint | Tous les TS/TSX modifiés : zéro erreur/avertissement, exécutions par lots ; `git diff --check` propre | [Root](preuves/admin-navigation-lint-final.log), notes des lots |
| Pages Next : Établissement, Équipe, Statistiques, Planning | **26/26**, **82 captures** | [Résultats](captures/navigation-admin/results.json), [log](preuves/admin-navigation-visual-final.log) |
| Pages Next : Site et Écrans | **12/12**, **42 captures** | [Résultats](captures/navigation-site-screens-final/results.json), [lot](LOT-NAVIGATION-SITE-SCREENS.md) |
| Pages Next : Livraison et Encaissement | **19/19**, **45 captures** | [Résultats](preuves/admin-navigation-delivery.json), [log](preuves/admin-navigation-delivery.log) |
| Pages Next : Horaires, Abonnement et menu tablette/bureau | **15/15**, **40 captures** | [Résultats](captures/navigation-hours-billing-shell-final/results.json), [log](preuves/navigation-hours-billing-shell.log) |
| Recette E2E existante des aperçus TV | **3/3**, aucun ignoré ; `node --test e2e/demo/ecran-apparence.test.mjs` ciblé sur le Next local | [Log](preuves/admin-navigation-e2e-tv.log) |

Les scripts Next représentent **72 parcours**, complétés par les **3 recettes E2E**. Aucun des quatre harnais locaux n’autorise de requête vers une origine externe. Les scénarios utilisent les démonstrations du dépôt ou des réponses API en mémoire explicitement simulées. Les 209 captures des quatre harnais ne sont pas toutes des captures d’écran initial : elles couvrent aussi formulaires, dialogues, erreurs et retours.

## Ce qui a été vérifié

- Onglets et titres accessibles, activation clavier, retour/avant, URL directe et paramètres conservés ; ancien lien `#salle`, rôle retiré et section inconnue. Les instances de formulaire restent montées.
- Établissement : deux brouillons indépendants, changements de rubriques, retour/avant, sauvegarde par le PATCH existant. La suite Salle conserve ses assertions de droits, conflits, UUID, stockage refusé et reprise d’opération incertaine.
- Site/Écrans : brouillons de quatre champs, ordre et durée des scènes, abandon explicite, retour au déclencheur, aperçu TV, pause et absence de publication implicite. Retour navigateur pendant l’aperçu puis fermeture avec restauration du focus.
- Livraison : même brouillon et même validation, publication depuis Livreurs, annulation, erreurs et reprise, pas de mutation au simple changement d’onglet. Stripe : quatre états et réponses indisponibles, lien renouvelé à chaque clic, navigation et retour sur pages locales simulées.
- Horaires/Abonnement : brouillons, erreur de sauvegarde puis reprise, fermetures sans publication des autres saisies, identité de facturation, PDF et état suspendu. Les tests de composants avec capacité online couvrent les créneaux ; la démo Next n’expose pas ce panneau car sa fixture omet volontairement les capacités.
- Téléphones **320/390px**, tablettes **768/1024px**, bureau **1440px** ; clair/sombre. Rotation téléphone **844×390** et zoom CSS **200%** sur Établissement ; primitive également testée à 568/1920px. Cibles d’onglets ≥44px, absence de débordement global dans les pages parcourues, tableaux confinés à leur propre défilement. Captures représentatives inspectées visuellement.
- Tablette : rail fermé au départ, ouverture explicite, fermeture au changement de route et après Retour ; préférence du menu bureau conservée au redimensionnement.

## Échecs rencontrés puis résolus

La première suite complète a échoué sur **16 tests de Salle** qui tentaient d’agir sans ouvrir le nouvel onglet, et sur un hook de la recette d’apparence expiré pendant le build parallèle. Les sélecteurs de visite et le second onglet navigateur ont été adaptés ; **aucune assertion métier supprimée**. La suite complète finale utilise quatre workers et passe 3 074/3 074. [Log initial conservé](preuves/admin-navigation-tests-initial.log).

La recette visuelle a également révélé une modale masquée par Retour, une perte de focus lors de la fermeture simultanée de dialogues, le menu tablette ouvert au-dessus du contenu, des textes masqués débordants dans les tableaux et une icône trop serrée à320px. Ces défauts sont corrigés et les recettes ont été rejouées. Les fichiers `*-intermediaire*`, `*-initial*`, `*-baseline*` et la preuve de build `jmPy` sont des traces antérieures, pas la preuve finale.

## Limites et prochaine étape

Pas de compte, base, paiement, déploiement ou matériel de production. Les paiements, comptes Stripe, emails/SMS et le parc réel n’ont pas été exercés ici. La rotation et le zoom sont simulés dans Chromium, sans validation physique Safari/iOS/Android. POS/KDS et API métier ne sont pas modifiés et leurs builds ne sont pas revendiqués pour ce lot. La suite E2E complète du parc/staging n’a pas été relancée ; seul le fichier existant d’aperçu TV concerné a été exécuté, en plus des quatre harnais locaux.

Aucun blocage technique restant dans ce lot. Prochaine tranche : après GO de livraison, PR vers develop, contrôles CI, fusion puis vérification de la révision servie sur staging et recette manuelle du restaurateur. Le serveur local de recette a été arrêté à la fin des vérifications ; il ne constitue pas staging.

## Fichiers applicatifs et recettes modifiés

- `apps/web/src/app/admin/abonnement/page.tsx`
- `apps/web/src/app/admin/encaissement/page.tsx`
- `apps/web/src/app/admin/hours/hours-billing-navigation.browser.test.tsx`
- `apps/web/src/app/admin/hours/page.tsx`
- `apps/web/src/app/admin/layout.tsx`
- `apps/web/src/app/admin/livraison/page.tsx`
- `apps/web/src/app/admin/planning/grid.tsx`
- `apps/web/src/app/admin/planning/page.tsx`
- `apps/web/src/app/admin/screens/navigation.module.css`
- `apps/web/src/app/admin/screens/page.tsx`
- `apps/web/src/app/admin/screens/playlist-drawer.tsx`
- `apps/web/src/app/admin/screens/screen-card.tsx`
- `apps/web/src/app/admin/settings/page.tsx`
- `apps/web/src/app/admin/settings/salle.browser.test.ts`
- `apps/web/src/app/admin/site/page.tsx`
- `apps/web/src/app/admin/site/parts.tsx`
- `apps/web/src/app/admin/site/pilotage.module.css`
- `apps/web/src/app/admin/stats/page.tsx`
- `apps/web/src/app/admin/team/page.tsx`
- `apps/web/src/components/admin/AdminSections.browser.test.tsx`
- `apps/web/src/components/admin/AdminSections.module.css`
- `apps/web/src/components/admin/AdminSections.tsx`
- `apps/web/src/components/ui/BarChart.tsx`
- `apps/web/src/components/ui/useDialogLayer.browser.test.tsx`
- `apps/web/src/components/ui/useDialogLayer.ts`
- `e2e/demo/ecran-apparence.test.mjs`
- `e2e/local/admin-navigation-delivery.mjs`
- `e2e/local/admin-navigation-shell.mjs`
- `e2e/local/admin-navigation.mjs`
- `e2e/local/admin-site-screens-navigation.mjs`
- `e2e/local/refonte-web-visual.mjs`
