# Audit du kit et du studio — 12 septembre 2026

Audit local dans `/Users/limameghassene/development/SnackManager-refonte-ui`, branche `refactor/apple-ui-integration`, base `aefdf974f3c24dfb7d2d7ab484eb297a0502aa1c`. Les premières sections concernent le kit isolé. Les sections finales documentent l'intégration réelle des illustrations dans la médiathèque web et ses preuves distinctes.

## Lecture et portée

Le handoff `REPRENDRE-DANS-CODEX.md` a été lu intégralement. Ont également été lus : README du kit ; AUDIT, SOURCES, INVARIANTS, INTEGRATION, CHARTE, INTERACTIONS, ASSETS ; prompts 00-MASTER, 01-AUDIT et README ; QA RESULTATS et FIDELITE ; manifestes de packages ; sources de tokens, présentation, composants web/native ; manifeste/registre des écrans et sources du studio. Aucun AGENTS.md ou AGENTS.override.md n'a été trouvé dans les dossiers `design`, `docs` ou `_handoff` de ce worktree. Les instructions utilisateur priment sur les suggestions des prompts, notamment aucune PR distante, fusion ou publication sans accord.

Les scripts `tools/build.mjs`, `tools/serve.mjs` et `tests/system.test.mjs` ont été lus avant exécution. `build` régénère uniquement le dossier `dist` du kit. Le serveur sert ce dossier en lecture sur `127.0.0.1`, accepte GET/HEAD, refuse les autres méthodes, et contrôle la racine réelle des chemins. Les fixtures restent locales et éphémères ; aucune API restaurant, compte ou base de production n'a été utilisé.

## Vérifications exécutées

Le Node initial du PATH était v24.5.0, inférieur au minimum racine >=24.12. Les commandes de validation ont donc utilisé `/Users/limameghassene/.nvm/versions/node/v24.20.0/bin`.

| Commande ou contrôle | Résultat actuel |
|---|---|
| `PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH npm run verify` depuis `design/refonte-swiftui` | Réussi : 44 tests, 44 succès, 0 échec. |
| Build lancé par `verify` | Réussi : 57 vues, 24 illustrations, 69 icônes, tokens et briefs. |
| `lsof -nP -iTCP:4173 -sTCP:LISTEN` avant serveur | Aucun listener ; aucun processus existant arrêté. |
| `PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH npm run serve` | Actif sur `http://127.0.0.1:4173`, session exec `23959`. |
| GET `/` avec fetch Node local | 200, `text/html; charset=utf-8`. |
| HEAD `/assets/icons/pos.svg` | 200, `image/svg+xml`. |
| POST `/` sans payload | 405. |
| Ouverture Chrome via CUA | Onglet `1352622428`, titre « Caisse · Snack Manager Design Studio ». |
| Bascule thème clair/sombre | Rendue et inspectée ; défaut de contraste effectif signalé ci-dessous. |
| État POS « Opération incertaine » | Message persistant visible, boutons Carte et Espèces désactivés (`isEnabled() === false`). |
| Vue KDS sombre | Trois colonnes visibles, ticket prêt passif « En attente de prise en charge ». |
| Format POS 390 × 844 | Catalogue deux colonnes, catégories défilantes, accès fixe « Voir le ticket ». Ouverture du ticket contrôlée. |

Un clic Playwright sur la bascule de thème a rencontré `CDP operation exceeded its deadline before command dispatch`. L'état a été relu, puis le contrôle accessible a fonctionné. Le format navigateur temporaire a été réinitialisé. L'onglet final affiche le POS nominal clair et reste ouvert comme référence.

Les 456 rendus et les contrôles Chromium consignés dans `design/refonte-swiftui/qa/RESULTATS.md` sont des preuves historiques livrées avec le kit ; ils n'ont pas été reproduits pendant cet audit. Aucun typecheck TSX du kit React/React Native, build applicatif, appareil iOS/Android, lecteur d'écran ou parcours de paiement n'a été exécuté par ce lot d'audit.

## Références réellement regardées

Images locales ouvertes avec l'outil image :

- `_handoff/snackmanager-ui/references/RestoPilot-POS.png` ;
- `_handoff/snackmanager-ui/references/RestoPilot-KDS.png` ;
- `design/refonte-swiftui/maquettes/captures/pos-sale.png` ;
- `design/refonte-swiftui/maquettes/captures/kds-board.png`.

Captures du navigateur également rendues et inspectées dans la session CUA : POS clair/sombre au viewport normal, KDS sombre, catalogue et ticket POS à 390 × 844. Ces observations CUA n'ont pas été enregistrées comme nouveaux fichiers de captures dans le dépôt. Les fichiers de maquettes listés ci-dessus restent des images fournies par le kit.

La direction visuelle est cohérente entre référence et kit : toile claire légèrement grisée, surfaces blanches opaques, cartes et champs arrondis, bordures peu marquées, chiffres hiérarchisés, médias distincts du texte, catalogue et ticket à défilement indépendant en format large. La maquette Snack Manager agrandit les cibles, adapte les libellés POS aux moyens d'encaissement, remplace les filtres de postes KDS par les canaux, et garde l'étape prête passive. Ces arbitrages doivent survivre à l'intégration. Les illustrations de produits ne sont pas une autorisation de remplacer les photos réelles.

## Constats de compatibilité et recommandations

### 1. Défaut effectif du bouton web primaire sombre — corrigé

Source : `packages/ui-web/styles.css`, règle `.sm-ui button { color: inherit }` plus spécifique que `.sm-button--primary { color: var(--sm-on-accent) }`.

Avant correction, le bouton « Carte » du studio sombre présentait `color: rgb(245,247,242)` et `background-color: rgb(237,97,46)` alors que `--sm-on-accent` valait `#000000`. Le calcul exécuté avec `contrast()` du kit donnait **3,0659:1** pour le texte observé contre **6,3502:1** pour le noir prévu. Les tests purs de tokens passaient donc sans garantir la couleur effectivement appliquée dans le DOM.

Correction ciblée ensuite autorisée dans la source `packages/ui-web/styles.css` : le reset devient `.sm-ui :where(button)`, afin que les couleurs des variantes définies ensuite remportent la cascade. Aucun `!important`, aucune modification applicative. Après `npm run verify` (44/44 et build 57/41/78), la recette Chromium lit effectivement un texte `rgb(0, 0, 0)` sur `rgb(237, 97, 46)` dans les deux thèmes, conforme à `--sm-on-accent`, soit **6,350234:1**. Captures et résultats : `docs/refonte-ui/captures/mediatheque/kit-primaire-{light,dark}.png` et `resultats-browser.json`.

### 2. Adaptateur de thème incomplet pour la palette terrain

`legacyPalette()` couvre seulement `bg`, `surface`, `surface2`, `text`, `mut`, `line`, couleurs fonctionnelles et leurs textes. Les rôles existants `railBg`, `footBg`, `deep`, `field`, `press`, `press2`, `placeholder`, `scrim`, `line2`, etc. conservent les anciennes valeurs. Il n'ajoute pas `accent` ou `onAccent`. Un raccordement brut produit donc une interface mêlant deux systèmes.

Recommandation : adaptateur local complet vers les rôles actuels, à partir de `theme(mode, accent)` et des tokens partagés. Garder les providers et préférences existants. Ne pas modifier globalement `client-core` dans le premier lot POS, car le KDS consomme aussi sa palette. Préserver `TIMER_THRESHOLDS`, `timerColor()`, les valeurs fixes `green/red/amber`, ainsi que l'accent d'établissement. L'orange `brand.preview` appartient à la démonstration.

`theme()` accepte seulement `light`/`dark` et un accent `#RRGGBB`. Il lève sinon ; l'adaptateur doit recevoir un mode résolu et la valeur de marque normalisée par le parcours actuel. Le `ThemeProvider` native du kit retombe sur le thème système si `mode` est omis : il ne doit pas remplacer implicitement une préférence déjà persistée.

### 3. Écart documentaire de palette sombre

`docs/CHARTE.md` annonce canvas `#111310` et surface `#1c1f1b`. La source exécutable et les exports effectivement construits définissent `#161916` et `#232723`. Utiliser la source exécutable comme référence pour éviter deux définitions concurrentes. L'écart reste documenté ici ; aucun fichier du kit n'a été réécrit pour le masquer.

### 4. Frontière web/native et résolution

Les manifestes actuels des applications ont été relus : POS/KDS Expo `~57.0.14`, React `19.2.3`, React Native `0.86.2`, SVG `15.15.4` ; web Next `16.3.1`, React `19.2.8`. Les peers du kit englobent ces versions. Cela ne prouve pas la compilation sémantique du TSX ni le rendu d'un composant natif.

La stratégie retenue par l'intégration est un workspace imbriqué explicitement déclaré, en commençant par `@sm/design-tokens`. Aucun déplacement sous `packages/design-*` ni double copie de primitives. Conserver `@sm/ui-native` existant ; ses contrôles peuvent consommer les nouveaux tokens par adaptateur. Les exports ESM `.mjs`/`.d.mts` demandent validation avec le TypeScript et le bundler de chaque application réellement raccordée. Les versions distinctes de React doivent conserver leur résolution propre.

Les styles web ne doivent pas être importés dans React Native. Le CSS généré `dist/tokens/tokens.css` contient `:root` ; préférer un périmètre de thème explicite pour une tranche Next.js, sans remplacer les variables globales de toutes les routes. Les composants natifs du kit ont un contexte distinct et utilisent `react-native-svg` ; ils ne deviennent pas automatiquement compatibles avec les providers de l'application existante.

### 5. Contrats contrôlés utiles, mais insuffisants pour remplacer un écran

Les composants reçoivent des labels de prix et des callbacks ; `renderMedia` permet de garder la politique de média actuelle. Les fonctions du studio calculent des totaux uniquement sur fixtures et ne doivent jamais être copiées dans les apps.

Les `Button` du kit dérivent `disabled`/`busy` à partir d'un état de présentation ; ils ne rendent pas automatiquement `actionPresentation().announcement`. Conserver un message persistant du contrôleur pour une opération incertaine. Garder les gardes métier même si le bouton semble désactivé. Les compositions `ProductTile`, `KitchenTicket` et `TicketSummary` ne représentent pas toutes les options, annulations, suppressions, notes ou reprises actuelles : l'inventaire applicatif doit guider leur adaptation.

Le `Dialog` web optionnel ne doit pas remplacer les hôtes d'overlay existants. `SheetFrame` fournit seulement un cadre et ne prend pas en charge toute la pile, le retour Android, les safe areas, le clavier ou la restauration de focus applicative. La primitive native `Button` applique le style externe à son `Pressable` et sa propre surface à l'enfant animé ; vérifier les compositions/flex avant substitution.

## Suite précise

Raccorder les tokens à la palette locale du POS et aux primitives existantes, puis moderniser catalogue, catégories et ticket en conservant contrôleurs, médias et handlers. Valider dans les vrais tests/typecheck/build POS et contrôler les rendus clair/sombre/tablette/mobile avant d'élargir. Les autres packages UI du kit restent des sources à adapter, pas des composants déclarés prêts par les 44 tests purs.

## Complément HalalAssets et médiathèque — même session

À la demande supplémentaire de l'utilisateur, l'archive `SnackManager-Codex-Reprise-HalalAssets.zip` a été comparée au premier handoff après extraction séparée sous `_handoff/complement-halal-assets`. Seuls huit fichiers source du kit diffèrent : `README.md`, `docs/ASSETS.md`, `packages/assets/index.mjs`, `packages/icons/index.d.mts`, `packages/icons/index.mjs`, `prompts/11-ASSETS.md`, `qa/RESULTATS.md`, `studio/app.mjs`. Chaque destination a été vérifiée identique au premier handoff avant cette copie ciblée. Aucun patch n'a été appliqué ; tokens, TSX et styles du kit n'ont pas été écrasés.

La nouvelle bibliothèque contient 41 illustrations et 78 icônes. Le contrôle XML initial des 119 exports a révélé `samosa.svg: mismatched tag: line 1, column 2169` : le générateur ajoutait une fermeture `</g>` en trop. La source a été corrigée, puis `npm run verify` relancé : **44/44 tests**, build **57 vues / 41 illustrations / 78 icônes**, analyse XML **119/119 réussie**. La ligne « 93 documents analysés » conservée dans le rapport livré est historique ; elle ne couvre pas cette extension. Le défaut de cascade du bouton sombre a ensuite été corrigé et contrôlé dans le DOM comme décrit plus haut.

La bibliothèque a ensuite été branchée dans les deux sélecteurs de médias existants : `apps/web/src/components/mediatheque/ChoixDeMedia.tsx` et la `ModaleMediatheque` de `apps/web/src/app/admin/menu/PhotosDuPlat.tsx`. Nouveaux fichiers :

- `apps/web/src/components/mediatheque/BibliothequeIllustrations.tsx` : section repliable, 41 aperçus, recherche sans accents, sept familles explicites, icônes du composant web partagé, action d'ajout nommée ;
- `apps/web/src/components/mediatheque/illustrations.ts` : mapping explicite et préparation locale d'un PNG transparent à la largeur du contrat, depuis une clé connue du seul registre versionné ;
- `apps/web/src/components/mediatheque/illustrations.test.ts` : recherche/familles, refus de clés arbitraires, format PNG, dimensions, nettoyage des URL et échecs de préparation.

Le clic « Ajouter » prépare l'image puis appelle le `deposer()` existant du sélecteur. `reduirePourEnvoi`, le contrôle des formats, POST `/medias`, le quota, le dédoublonnage et les callbacks d'attachement/admissibilité restent propriétaires de leurs décisions. Aucun SVG utilisateur n'est admis par ce nouveau parcours ; aucun produit n'est associé automatiquement et aucune photo existante n'est remplacée. Le composant vérifie le montage et, dans le sélecteur de marque, `canAct` après la préparation asynchrone. Les retours de dépôt produit sont également visibles dans la modale de médiathèque.

Instructions `apps/web/AGENTS.md` lues ; guides Next locaux `use-client` et `12-images` lus avant le code (package Next 16.3.1 du dépôt principal, pendant l'installation du worktree). Aucun framework n'a été mis à jour. Les dépendances et le raccordement du composant d'icônes partagé sont gérés par la lane d'intégration.

Validation ciblée exécutée avec Node 24.20.0 : `pnpm --filter @sm/web exec vitest run src/components/mediatheque/illustrations.test.ts src/components/mediatheque/photos.test.ts src/app/admin/menu/photos.test.ts` : **3 fichiers, 39 tests réussis**, dont 10 nouveaux. Ces tests simulent le canevas pour vérifier ses contrats ; ils ne prétendent pas démontrer un import visuel dans le navigateur ni un dépôt effectif. Le typecheck complet, le build Next et la recette navigateur applicative sont coordonnés par la lane principale et doivent être lus dans `REPRISE.md`.

## Recette navigateur exécutée — médiathèque et contraste

La vraie route Next locale `http://127.0.0.1:3092/admin/menu?demo=1` a été inspectée via CUA : modification du Kebab, ouverture de la médiathèque, dépliage des 41 illustrations, recherche Samoussa et clic Ajouter. Le Samoussa corrigé s'affiche. Le PNG atteint bien le transport existant, qui refuse volontairement tout envoi en démonstration : « La démonstration n'envoie pas de fichiers — sur un vrai compte, si. » Le refus est visible dans la modale et aucun faux succès ni attachement n'est produit.

Pour vérifier les imports sans compte ni base, `e2e/local/refonte-mediatheque.mjs` construit les vrais composants `PhotosDuPlat` et `ChoixDeMedia`, leurs primitives et `reduirePourEnvoi`, avec les versions React et React DOM exactes de l'application web. Seul le module API est remplacé par une API en mémoire vérifiant les octets PNG et simulant quota/dédoublonnage ; aucune API réelle n'est contactée. La CSP interdit les accès distants. Le serveur écoute sur `127.0.0.1:4178` (session exec finale `23808`). L'interface de recette est `e2e/local/refonte-mediatheque.tsx` et ne fait pas partie des builds applicatifs.

Recette manuelle CUA exécutée et enregistrée dans `captures/mediatheque/preuves-cua.json`, puis recette reproductible automatisée exécutée :

```sh
PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH node e2e/local/refonte-kit-media-visual.mjs
```

Résultat final **PASS**, zéro erreur navigateur, zéro requête distante. `captures/mediatheque/resultats-browser.json` contient les styles calculés, 41 résultats de fichiers et la liste des callbacks réellement invoqués.

| Contrôle réel dans Chromium | Résultat |
|---|---|
| Raster des 41 illustrations via Image + canvas natifs | PNG 1600 × 1100 reconnus sur les octets par `planifierDepot`, de 81 546 à 620 388 octets en Chromium headless ; aucun ne requiert de réduction. |
| `reduirePourEnvoi` sur les 41 fichiers | Fichier original conservé, `reduit === false`. |
| Ajout produit Samoussa | `deposer()` existant appelé ; ajout après la référence initiale `existing-original`, ordre conservé. |
| Deuxième ajout Samoussa | Même empreinte SHA-256 dans cette session navigateur ; réponse dédupliquée, aucun callback d'attachement supplémentaire, message « déjà sur ce plat ». |
| Brownie puis Cookie | Brownie devient troisième photo ; Cookie rejoint la bibliothèque, le produit reste à trois photos, choix supplémentaire désactivé avec explication. |
| Refus quota sur Cola | Message visible, aucune nouvelle photo attachée. |
| Fermeture pendant préparation | Callback natif `toBlob` retardé de 5 s par le harnais ; bouton d'ajout désactivé, modale fermée pendant ce délai ; après résolution, aucune tentative de dépôt supplémentaire. |
| Choix de marque Pizza végétarienne | Même dépôt existant, callback `onChoisir` reçu, URL de média sélectionnée, vignette `aria-pressed=true`. |
| Autorité `canAct=false` | Clic sans dépôt supplémentaire. |
| Format 390 × 844 | Bibliothèque deux colonnes, filtres lisibles, pied de modale accessible, aucun débordement horizontal. |
| Bouton primaire kit clair/sombre | Couleur effective noire sur accent orange, 6,350234:1 dans les deux thèmes. |

Captures nouvelles conservées et inspectées :

- `captures/mediatheque/bibliotheque-1440.png` et `bibliotheque-390.png` ;
- `captures/mediatheque/samoussa-import-attache.png` ;
- `captures/mediatheque/quota-refuse.png` ;
- `captures/mediatheque/choix-marque.png` ;
- `captures/mediatheque/kit-primaire-light.png` et `kit-primaire-dark.png`.

Une première exécution automatisée a rencontré un sélecteur ambigu entre le message derrière la modale et celui de son `role=status`. Le sélecteur de recette a été limité au message accessible, puis l'intégralité de la recette a été relancée avec succès. Aucun code métier ni test applicatif n'a été modifié pour corriger ce sélecteur.

Limites : le transport de la fixture simule les réponses serveur. Le stockage et la déduplication d'un véritable backend, un PUT d'enregistrement produit, les permissions d'un compte réel, Safari/iOS/Android et le rendu identique d'un PNG entre moteurs n'ont pas été testés. La référence initiale du produit est volontairement un identifiant de fixture ; le contrôle prouve sa conservation et son ordre, pas la restauration d'un média réel. Les builds/typechecks globaux restent consignés par la lane principale dans `REPRISE.md`. Prochaine tranche précise pour cette lane : recette sur backend local dédié avec stockage éphémère, import dans les deux hôtes puis sauvegarde explicite du produit et de l'image de marque, sans compte ni base de production.
