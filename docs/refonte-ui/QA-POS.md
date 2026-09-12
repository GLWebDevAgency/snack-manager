# Recette visuelle du POS — tranche initiale

## Environnement et isolement

- Worktree : `/Users/limameghassene/development/SnackManager-refonte-ui`.
- Application réellement rendue : export web Expo de `apps/pos`, servi avec son serveur statique existant sur `http://127.0.0.1:8092`.
- Navigateur : Chromium de Playwright 1.62.1, déjà installé. Le skill `browser`/Browser plugin n'est pas disponible dans la session ; validation avec Playwright standard.
- Node : 24.20.0, sans installation ni mise à jour.
- Données : instantané anonymisé déjà présent dans `packages/client-core/src/demo/snapshot.ts` (Le Comptoir, 109 produits, 22 catégories), hydraté selon la fixture existante. Aucun serveur API n'est utilisé.
- Les photos du snapshot sont lues depuis `apps/web/public/photos` par interception Playwright. Les appels API reçoivent uniquement des fixtures locales. Les WebSockets sont interceptés et fermés. Toute autre origine HTTP est bloquée ; les service workers sont bloqués.
- Sessions et appairages : valeurs factices locales injectées dans un contexte navigateur jetable. Aucun compte, identifiant privé, paiement, SMS ni base de production.
- Parcours : ouverture du POS → catégorie Burgers → configuration du produit réel « Le Classic » → ajout à 9,50 € → ticket. En desktop : édition de note, paramètres, Escape, disposition C persistée, rotation de viewport.

## Commande reproductible

Le script `apps/pos/server.js`, les scripts du manifeste POS et le scénario existant `e2e/local/pos-counter-payment.mjs` ont été lus avant exécution.

```sh
# Depuis le worktree, après un build POS avec API/site configurés en local.
/Users/limameghassene/.nvm/versions/node/v24.20.0/bin/node -e "require('./apps/pos/server').createStaticServer().listen(8092,'127.0.0.1')"
REFONTE_PHASE=avant /Users/limameghassene/.nvm/versions/node/v24.20.0/bin/node e2e/local/refonte-pos-visual.mjs
# Après intégration/build : même commande avec REFONTE_PHASE=apres.
```

## État initial exécuté

Build de référence terminé : `preuves/pos-build-avant.log` indique `Exported: dist`.

| Contrôle | Résultat initial |
| --- | --- |
| Identité de page, contenu significatif | 7/7 scénarios réussis |
| Desktop 1512 × 982, clair et sombre | Catalogue, configurateur, ticket capturés |
| Tablette 820 × 1180, clair et sombre | Catalogue, configurateur, tiroir ticket capturés |
| Mobile 390 × 844, clair et sombre | Catalogue, configurateur, tiroir ticket capturés |
| Disposition A / rail, desktop clair | Catalogue, configurateur modal, ticket capturés |
| Préférence C / liste dense | Mutation persistée via les paramètres vérifiée en desktop clair/sombre |
| Édition de note | Note conservée dans le ticket en desktop clair/sombre |
| Paramètres et clavier Escape | Ouverture et fermeture vérifiées en desktop clair/sombre |
| Réduction des animations | Activée sur les sept contextes |
| Rotation web | 982 × 1512 capturé après changement de disposition |
| Débordement horizontal de page | Aucun sur les sept scénarios |
| Erreurs runtime / avertissements console | Aucun sur les sept scénarios |
| Nouveaux POST `/orders` | Aucun |

Preuve structurée : `captures/pos-avant/resultats.json`, 27 captures réussies. Le premier essai du harnais a rencontré deux boutons « Fermer » dans les paramètres ; le sélecteur a été précisé sur le bouton de pied du dialogue. Il ne s'agissait pas d'un échec du produit.

Captures réellement regardées avec l'outil image : référence `_handoff/snackmanager-ui/references/RestoPilot-POS.png`, `desktop-light-catalogue`, `desktop-light-ticket`, `desktop-dark-catalogue`, `mobile-light-catalogue`, `mobile-dark-configuration`, `tablette-dark-ticket`, `desktop-rail-light-catalogue` dans `captures/pos-avant/`.

## Écarts visuels observés avant intégration

| Référence RestoPilot regardée | POS initial regardé | Direction / conservation |
| --- | --- | --- |
| Surfaces chaudes, bordures légères, angles arrondis | Surfaces plus grises/noires, ombres de tuiles présentes | Rapprocher les tokens, conserver la séparation des couleurs métier et de marque |
| Images de carte grandes, descriptifs et prix hiérarchisés | Carte surtout typographique, photo miniature près du prix | Première tranche catalogue ; conserver les photos choisies et leur cadrage |
| Ticket à droite | B par défaut : ticket à gauche ; A propose déjà le ticket à droite | Préserver les préférences A/B/C et la capacité du tiroir sur écrans étroits |
| Carte de démo courte, commandes limitées | 109 produits, options, fidélité et trois moyens de règlement | Maintenir le périmètre actuel ; ne pas reproduire les omissions de la maquette |

## Limites de cette preuve

Cette recette ne prouve pas le rendu natif iOS/Android, les safe areas natives, le clavier logiciel, la rotation sur appareil, ni la fiabilité d'un périphérique de caisse. Elle ne constitue pas une recette de paiement, reprise d'opération incertaine, transport offline, service réel, disponibilité serveur, droits complets ou consentements. Les seules mutations métier exécutées ici sont locales au ticket et aux préférences ; aucun règlement ni commande n'est envoyé.

## État après première intégration

Le root a exécuté le build POS puis le même harnais : 7/7 scénarios passent, 27 captures dans `captures/pos-apres/` et résultat structuré dans `captures/pos-apres/resultats.json`. Il a aussi rejoué le scénario existant `e2e/local/pos-counter-payment.mjs` : 15/15 parcours de règlement/reprise passent, journal `preuves/pos-reprises-apres.log`.

Le root a regardé réellement le catalogue desktop clair, le ticket desktop sombre, le ticket mobile clair et le configurateur mobile sombre. Ces preuves concernent ce premier export après intégration. Une correction ultérieure du focus-visible et des icônes partagées nécessite encore le build et la recette finale ; ces captures ne doivent pas être présentées comme preuve de cette révision finale.

Inspection indépendante supplémentaire : catalogue desktop A/rail clair, configurateur tablette clair, catalogue mobile clair. Les cartes à grands médias, les descriptions et la hiérarchie des prix sont branchées ; les options, retraits, suppléments et le CTA du configurateur restent visibles/défilables. Le focus très présent dans ce premier export est précisément le point que la correction ultérieure vise.

## Export final vérifié

Le build final inclut les icônes et la correction de focus (`preuves/pos-build-final.log`). `REFONTE_PHASE=final node e2e/local/refonte-pos-visual.mjs` a été rejoué : **7/7**, **29 captures** dans `captures/pos-final`, sans exception JS. Deux preuves supplémentaires vérifient réellement le focus clavier de la carte produit (pseudo-classe focus-visible et contour 3 px en clair/sombre). La capture de catalogue après un clic souris n'a plus l'anneau parasite.

Le root a inspecté le catalogue desktop clair et le configurateur mobile sombre de cet export final. Typecheck POS et ui-native réussis ; suite POS finale **22 fichiers, 290 tests Vitest + 5 tests Node** réussie. Les **15 parcours de paiement/reprise** précédemment réussis concernent le code métier resté inchangé ; ils ne sont pas rebaptisés recette de périphérique ou de paiement réel.

Export Expo Hermes iOS **et** Android final réussi : `preuves/pos-export-natif.log`, fichiers locaux `/tmp/snackmanager-refonte-pos-native`. Il s'agit d'une compilation des bundles natifs, pas d'un binaire signé ni d'un essai sur simulateur/appareil.
