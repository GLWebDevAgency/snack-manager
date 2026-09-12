# Reprise de la refonte UI Snack Manager

## État courant — seconde passe et compatibilité PR 178

Worktree actif : `/Users/limameghassene/development/SnackManager-refonte-ui`, branche **`refactor/ui-handoff-fidelity`**. La PR 178 est fusionnée dans `develop` en **`80f2eac593863dfcfc1f9e5962c09db38fe6db24`** ; les commits locaux V2 ont été rebasés dessus sans conflit. Le travail concurrent du checkout principal reste préservé. Aucun nouveau push, fusion distante ou déploiement de ce lot.

La bibliothèque de **41 illustrations** est proposée dès la création d'un produit, ainsi que dans les médiathèques. Les **78 icônes** du kit sont disponibles dans les applications, avec correspondances explicites des anciens noms. Les styles, densités, thèmes et préférences sont affinés dans les sept applications existantes. Le service à table relie les réglages restaurant, le POS, la cuisine, les commandes, les paiements existants et les tickets imprimés.

Les nouvelles destinations de PR 178 — Carte, Rechercher, Commandes, Fidélité, Compte — sont conservées. Leur adaptation visuelle et leur validation finale sont terminées en local ; les preuves ci-dessous portent sur la base combinée. Les sections de première livraison ci-après sont historiques.

| Preuve sur la base combinée | Résultat exécuté |
| --- | --- |
| Kit | 44 tests ; 57 vues, 41 illustrations, 78 icônes compilées |
| POS | Typecheck, 332 tests + 5 Node, export web, 7 parcours de présentation et 7 parcours Salle |
| KDS | Typecheck, 86 tests, export web, 10 parcours navigateur |
| Natif | Exports Hermes iOS et Android POS/KDS réussis ; aucun essai sur appareil |
| API | 3 695 réussis, 803 ignorés lors de la suite complète ; build et typecheck réussis |
| Complément financier Mongo | 172 réussis dont 152 intégrations supplémentaires ; 20 gardes déjà comptées dans l'API. 651 cas API préexistants restent non exécutés |
| DB / contrats / client-core | 556 (10 ignorés) / 688 / 133 réussis ; builds réussis, typecheck core réussi |
| Web final | 2 994 tests / 195 fichiers, aucun ignoré ; typecheck et lint réussis ; build Next `bPzLIBZiO8taFULNJdNVv` ; 18 parcours clients (144 captures) + 26 parcours des surfaces existantes |

Les contrôles utilisent des bases temporaires locales possédées et des fournisseurs simulés. Les recettes navigateur utilisent les vraies applications compilées avec réponses HTTP de recette ; elles ne prouvent pas un paiement physique, une imprimante ou un appareil terrain. Aucun compte, base ni paiement de production. Les contrôles non exécutés et leurs causes restent explicites dans `VALIDATION-COMPATIBILITE-PR178-METIER.md`.

Références détaillées : `LOT-ASSETS-V2.md`, `LOT-ICONES-V2.md`, `LOT-POS-V2.md`, `LOT-KDS-V2.md`, `LOT-SALLE-BO.md`, `LOT-SERVICE-TABLE.md`, `LOT-BACKOFFICES-V2.md`, `LOT-SURFACES-CLIENT-V2.md`, `COMPATIBILITE-PR178-AUDIT.md` et `LOT-COMPATIBILITE-PR178-WEB.md`. Le manifeste complet de cette seconde passe est `FICHIERS-V2.txt`. Les empreintes des sources terrain validées sont dans `preuves/pr178-terrain-source-freeze.json`.

Décisions de compatibilité : garder les cinq onglets lisibles à 320 px, les règles d'accessibilité V2, les routes/history/panier de PR 178 et ses garde-fous compte/fidélité. La réconciliation du journal traite aussi une entrée déjà persistée devenue remboursée sur un autre poste, sans faux dû ni régression sur une réponse ancienne. Aucun framework, handler de paiement ou schéma métier préexistant n'est remplacé ; les extensions Salle sont additives.

Prochaine tranche précise, après accord pour le push, la fusion et son déploiement staging automatique : ouvrir la PR de `refactor/ui-handoff-fidelity` vers `develop`, vérifier la CI et les intégrations configurées, puis livrer le lot. Vérifier ensuite la révision servie et recetter avec les comptes de staging : choix d’illustration lors de création produit, ouverture de table → plusieurs envois cuisine → service avant paiement → encaissement → transfert/clôture, et navigation client avec panier/compte/fidélité. Les essais réels imprimante, tiroir, TPE, appareil et interruptions réseau restent à réaliser. Aucun blocage de code connu sur le périmètre exécuté ; ces essais et les intégrations préexistantes non exécutées ne sont pas déclarés verts.

Les captures finales sont dans `captures/{pos-fidelite-v2-final,pos-salle-v2,kds-fidelite-v2-final,customer-pr178-build-final,web-pr178-build-final}` ; les chemins exacts clients figurent dans `LOT-COMPATIBILITE-PR178-WEB.md`. Les contrôles pré-PR 178 conservés plus bas sont historiques. Les espaces de fin de ligne et lignes vides terminales des journaux ont été normalisés pour le versionnement, sans modifier les résultats. Les seuls ajustements finaux depuis le checkpoint métier concernent le journal/catalogue POS et la présentation des pages clientes ; les empreintes de source des deux lanes permettent de vérifier l’arbre effectivement testé.

---

## Poste et autorisation — 12 septembre 2026

- Worktree : `/Users/limameghassene/development/SnackManager-refonte-ui`.
- Branche locale : **`refactor/apple-ui-integration`**, base `origin/develop` **`aefdf974`**.
- Handoff `_handoff/snackmanager-ui/REPRENDRE-DANS-CODEX.md` lu intégralement. Les documents définissent une direction ; la demande utilisateur et le produit actuel définissent le périmètre autorisé.
- Le checkout principal reste sur `feat/fidelite-design` (`588a0476`), avec l'audit modifié, `bonapps-kit`, `classfood-kit`, images et documents non suivis préservés. `develop` local est ancien et occupé dans un autre worktree ; `git fetch origin develop` a permis de partir de la référence actuelle. Refontes POS/KDS déjà intégrées par squash, puis correctifs de modales/rotation/démarrage/reprise conservés. Aucune branche ancienne réappliquée ni fusionnée.
- Seul AGENTS applicable trouvé : `apps/web/AGENTS.md`, conservé. Guides Next locaux CSS, composants clients et images lus avant éditions. Aucun AGENTS/override dans les ascendants inspectés.
- Aucun push, fusion, déploiement, compte réel, base ou paiement de production. Aucun framework mis à jour, aucun test supprimé. Les données de recette sont les snapshots anonymisés/démos du dépôt et des réponses locales explicites.

## Import et décisions

Destination absente : **copie** du kit vers `design/refonte-swiftui`. Le patch livré n'a jamais été appliqué. `_handoff/` exclu du suivi pour éviter le double versionnement ; les références RestoPilot originales restent dans ce dossier local.

La demande additionnelle `SnackManager-Codex-Reprise-HalalAssets.zip` a été intégrée après comparaison séparée : huit sources du kit complétées, sans écraser les adaptations. Source de vérité finale : **41 illustrations et 78 icônes**. Une fermeture SVG surnuméraire de Samoussa a été corrigée, ainsi que la spécificité CSS du bouton primaire du studio. Voir `KIT-AUDIT.md` pour la provenance et les preuves.

Trois workspaces imbriqués explicitement déclarés : `design/refonte-swiftui/packages/{tokens,assets,icons}`. Aucune copie parallèle sous `packages/design-*`. Les fixtures et calculs du studio ne sont jamais utilisés comme logique applicative. Les adapters et composants existants consomment les sources nécessaires.

`pnpm-lock.yaml` ne contient que **30 lignes ajoutées** pour les importeurs/liens workspace, sans modification des versions ni des snapshots de dépendances externes. Installation finale `--frozen-lockfile --ignore-scripts` réussie. Metro ayant déjà `disableHierarchicalLookup`, le package d'icônes est déclaré explicitement dans POS/KDS, en plus de ui-native, pour la résolution du composant partagé.

Node **24.20.0**, pnpm **10.14.0**. Le PATH initial était sur Node24.5 ; avant les commandes :

```sh
export PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH
```

## Lots réellement intégrés

| Lot | Présentation intégrée | Propriété métier conservée |
| --- | --- | --- |
| POS | Tokens clair/sombre, primitives 12/20/28, focus clavier, recherche large, cartes à grandes photos existantes, descriptifs/prix, catégories et ticket | Dispositions A/B/C, préférences, catalogues/médias/cadrages, configurateur, fidélité, calculs, handlers, trois règlements, contrôleurs, files et reprises inchangés. `PARITE-POS.md` |
| KDS | Palette, surfaces/cartes opaques, titres/badges lisibles, CTA distinct, paramètres, focus, urgence statique | Statuts/couleurs fixes, timers, retraits/options, cumul À lancer, actions new→preparing→ready, remise passive, cache/file intactes. `LOT-KDS.md`, `PARITE-KDS.md` |
| Commande | Carte/menu/variants plus lisibles, surfaces opaques, section/titres, feuille produit, focus | Masque tenant couleur/police/forme, géométrie sticky/mobile étroite, photos/cadrages et tous contrôleurs panier/paiement/reprise inchangés. `LOT-COMMANDE-FIDELITE.md` |
| Fidélité | Solde, récompenses et états sans carte/offline plus sobres, hiérarchie texte, en-tête opaque | Vraie carte et démonstration partagent les pièces visuelles ; solde, QR/scanner, consentements, cookie/session, verdicts et reconnaissance restent existants. `LOT-COMMANDE-FIDELITE.md` |
| Livreur | Palette kit clair/sombre, cartes opaques, filtres, titre, compte, focus, encres contrastées | Accent et rayons tenant, mission/départ/remise, session, journal/reprises, navigation externe et consentements inchangés. `LOT-LIVREUR.md` |
| BO restaurant | Coque et primitives sur tokens sombres, cartes/champs/contrôles/tiroirs, navigation active sobre, icônes | Navigation/rôle/capacité/suspension, pause en ligne, compteurs et reconnexion, formulaires/validations/exports/brouillons conservés. `LOT-BACKOFFICES.md` |
| BO Snack Manager | Même adaptateur de surfaces limité à la coque interne, hiérarchie/navigation, icônes ; retour du focus HqDrawer corrigé avec useDialogLayer existant | Rôle sm_admin, accent maison, routes Prospection/Restaurants/File du jour, données/agrégats CRM, handlers et protection des brouillons intacts. `LOT-BACKOFFICES.md` |
| Médiathèques | Bibliothèque recherchable de 41 illustrations, 7 familles, PNG local depuis SVG versionné, icônes dédiées | Choix explicite seulement ; appelle deposer/envoiFichier existants, formats/quota/dédup/max3 et attachement inchangés. Pas de remplacement automatique des photos ni de qualification alimentaire ajoutée. `KIT-AUDIT.md` |

## Fichiers modifiés

Le manifeste exhaustif de fichiers est `FICHIERS.txt` (généré après le dernier contrôle Git). Groupes principaux :

- `.gitignore`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, manifests POS/KDS/web/ui-native.
- Kit sous `design/refonte-swiftui` ; composants partagés `packages/ui-native/src/Icon.tsx` et `apps/web/src/components/ui/{icons,Btn}`.
- POS : `visual-palette.ts` + tests, `theme.ts`, `ui.tsx`, `Catalog.tsx`, `CategoryTabs.tsx`, `TicketPanel.tsx`.
- KDS : `visual-palette.ts` + tests, `ui.ts`, `Board.tsx`, composants `AllDayPanel`, `OrderCard`, `SettingsSheet`, `StatusColumn`, `Toolbar`, `primitives`.
- Web : `components/backoffice/*`, coques admin/sm et `sm/parts.tsx` (focus du tiroir), `app/livreur/{delivery-access,livreur.css,delivery-brand-shape.browser.test}`, `components/order/{order-v2.css,primitives,ProductSheet}`, `components/loyalty/{LoyaltyCardApp,carte-visuelle,carte-visuelle.module.css}`, `components/mediatheque/*`, `admin/menu/PhotosDuPlat.tsx`.
- Recettes isolées `e2e/local/refonte-*`, docs/inventaires, logs et captures sous `docs/refonte-ui`.

## Preuves exécutées

| Contrôle | Résultat exécuté |
| --- | --- |
| Kit complété | Verify **44/44** ; build **57 vues / 41 illustrations / 78 icônes** ; analyse XML **119/119** |
| POS final | Typecheck + build web réussis ; **22 fichiers / 290 tests Vitest + 5 Node** |
| POS navigateur final | **7/7 parcours**, 29 captures : A/B/C, clair/sombre, desktop/tablette/mobile, config/ticket, note, paramètres, rotation web et focus clavier |
| Reprises POS existantes | **15/15** : règlements simulés, réponse perdue, même operationId après reload, audit/reconciliation, concurrence, offline, droits et journal refusé ; aucun paiement réel |
| KDS après | Typecheck + build web réussis ; **9 fichiers / 81 tests** ; **10/10** parcours navigateur, clair/sombre et 390/768/1024/1440, cache ancien/503, filtres, réglages, avancement/passivité |
| Bundles natifs | Exports Hermes **iOS et Android POS + KDS réussis**, sorties `/tmp/snackmanager-refonte-{pos,kds}-native` ; pas de binaire signé ni d'exécution sur appareil |
| Médiathèque | **39 tests ciblés** ; navigateur réel : 41 PNG1600×1100, doublon SHA identique, max3 photos, quota refusé, fermeture pendant préparation et canAct=false sans dépôt tardif |
| Commande/fidélité | **14 fichiers / 176 tests ciblés** réussis, dont sticky/cartes étroites/masques et flux fidélité |
| Livreur | **25 tests navigateur ciblés** réussis : formes tenant/contrastes, préférences/historique, invitation |
| BO/icônes | **37 tests ciblés** puis **6 tests adaptateur** réussis après ajout des contrastes sémantiques composés ; aplats fonctionnels conservés |
| Web typecheck final | Réussi après annotation CSSProperties explicite de l'adaptateur BO |
| ESLint web modifié | **19 fichiers TypeScript/TSX, 0 erreur et 0 avertissement** |
| Web build | **Next/Turbopack réussi**, TypeScript inclus, 62 pages statiques générées, API configurée localhost |
| Web visuel final | **16/16 sur Next dev puis 16/16 sur le build compilé `next start`**, 42 captures par passe, desktop/mobile, masques client clair/sombre, nav et formulaires BO ; aucune exception JS, aucun débordement horizontal |
| Web global | **185 fichiers / 2 861 tests réussis**, commande `pnpm --filter @sm/web test --no-file-parallelism`, 286,55 s ; aucun test retiré, ignoré ou timeout augmenté |

Les prérequis `@sm/contracts`, `@sm/db` et `@sm/domain` ont été compilés TypeScript localement pour leurs déclarations ; aucun accès base. La première suite web globale a subi 28 délais d'initialisation de navigateurs en parallèle (154 fichiers/2843 tests passent), sans suppression ni allongement des tests. Elle est relancée avec `--no-file-parallelism`. Cette première exécution était après le début des ajouts partagés, ce n'est pas un baseline pristine.

Captures réellement inspectées : références RestoPilot POS/KDS ; POS avant/après/final (dont catalogue clair et configuration mobile sombre) ; KDS après tableau desktop clair/mobile sombre/avancement prêt ; commande, fidélité, livreur et deux BO avant surfaces. Root a aussi regardé les captures finales de médiathèque desktop/mobile/Samoussa, les deux dashboards BO, la commande mobile claire, la fidélité mobile sombre et les missions mobile claires. Les inspections finales web/médiathèque sont consignées dans `QA-WEB.md` et `KIT-AUDIT.md`. Les résultats structurés sont `captures/*/resultats.json` ; logs de commandes `preuves/`.

## Processus locaux

Studio `http://127.0.0.1:4173`, POS `http://127.0.0.1:8092`, KDS `http://127.0.0.1:8093`, Next compilé de recette `http://127.0.0.1:3092` (dev arrêté, `next start` après build), fixture médiathèque `http://127.0.0.1:4178`. Les trois applications peuvent nécessiter leurs fixtures de session pour afficher un écran opérationnel ; ne pas y saisir de compte de production. Le serveur Next dev a été arrêté avant le build dans le même `.next`.

## Limites et prochaine tranche précise

Les preuves du studio ne valent pas des preuves applicatives. La recette navigateur utilise le vrai rendu applicatif avec données locales ; elle ne prouve pas l'intégration serveur ni la production. Aucun essai matériel POS, imprimante, tiroir-caisse, TPE, appareil iOS/Android, caméra/GPS ni lecteur d'écran. Pas de QR de fidélité client réel, de consentement réellement enregistré, de livraison ou de facture réelle. Les contrôleurs existants restent couverts par leurs tests ; tous les scénarios de chaque écran secondaire ne sont pas revendiqués comme exécutés.

Le lot local est intégré et validé dans les limites ci-dessus. Revue indépendante du diff, vérification `git diff --check`, checkout initial préservé et lockfile sans changement de version confirmés. La tranche de recette suivante consiste à parcourir, sur fixtures locales enrichies ou environnement non-production autorisé, les listes CRM chargées/détails/formulaires longs et les états de reprise web, puis à inspecter le POS/KDS sur appareils. Aucun push, merge ni déploiement sans accord utilisateur.

## État final de livraison locale

Les sept familles applicatives ont reçu l'intégration de présentation ; la bibliothèque complète est proposée dans les médiathèques existantes. Les deux défauts repérés pendant la revue (contraste du badge Suspendu et retour du focus HQ) sont corrigés et vérifiés. Revue indépendante de la couche HQ : aucun défaut concret trouvé ; guardes, historique, empilement et déclencheur conservés.

Aucun blocage de compilation, test ou recette locale dans le périmètre exécuté. Les validations backend réelles et appareils restent les limites documentées, et ne sont pas assimilées à des réussites. Aucune action distante effectuée. Les sources, recettes, captures et journaux sont conservés sur la branche dédiée ; le commit de livraison se retrouve par `git log -1`.

## Recette minimale avant fusion — 12 septembre 2026

Suite à la demande « ok testons un minimum puis je testerais sur staging apres le merge complet », poursuite autorisée vers `develop` et son déploiement staging automatique. La livraison concerne tout le lot de présentation de cette branche ; elle ne signifie pas que chaque écran secondaire a déjà reçu une refonte exhaustive. Aucune fusion vers `main` ni intervention en production.

Recette rejouée sur les applications compilées locales, sans changement du code : **33/33 parcours réussis**, soit POS **7/7**, KDS **10/10**, web **16/16**. Commandes `REFONTE_PHASE=pre-merge node e2e/local/refonte-{pos,kds,web}-visual.mjs` exécutées séparément. Résumé conservé dans `preuves/pre-merge-smoke.log` ; captures de cette répétition conservées localement sous `_handoff/pre-merge/`, en complément des captures finales déjà versionnées. Les limites fixtures et appareils de la section précédente restent applicables.

`origin/develop` rafraîchi reste `aefdf974f3c24dfb7d2d7ab484eb297a0502aa1c`. Audit indépendant : packages tokens/assets/icons suivis et résolus par pnpm, sources présentes dans le checkout CI et l'envoi Railway ; aucun changement API, migration ou workflow. Prochaine étape : PR vers `develop`, contrôles CI, fusion du lot puis vérification de la révision servie en staging.

## Fusion et livraison staging — 12 septembre 2026, 19 h 25 Paris

- PR [#177](https://github.com/GLWebDevAgency/snack-manager/pull/177) fusionnée par squash dans `develop` à 17:03:43 UTC, après CI et balayage des secrets réussis. Commit fusionné : **`a01f857c4c0649e85b3b8059fc644ced95602095`**. L'arbre fusionné est identique à celui de la branche livrée `3a63b4b` ; aucun travail concurrent n'a été ajouté à la fusion.
- [CI de la PR](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34706522211) entièrement réussie : typage, analyse statique, tests, intégrations avec services temporaires, compilation et chargements des modules compilés.
- [Pipeline staging](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34707092040) entièrement réussi sur le SHA fusionné : nouvelle vérification complète, contrôle des secrets, préflight Railway, préparation des schémas, mise en service des quatre services et santé publique.
- IDs Railway confirmés en service par ce run : API `1de24e25-fa46-4afb-8725-810352989d80`, web `dd82d8e0-b264-47fb-9420-203c748745d1`, POS `1df80112-2ab2-43d0-b8b8-4531c57849a0`, KDS `4a40e626-9f65-4e28-a522-10ea3330a876`.
- Contrôle public relancé depuis ce poste : `SM_REVISION_ATTENDUE=a01f857c4c0649e85b3b8059fc644ced95602095 node scripts/smoke.mjs staging` : **8/8**, aucun contrôle ignoré. SHA API exact, carte Class'Food (22 catégories, 109 produits), catalogue fidélité, PWA fidélité et trois interfaces valides.
- Empreintes et URLs des fichiers publics relevées avant/après : web, POS et KDS exposent chacun au moins un nouveau fichier JavaScript ou CSS, téléchargé avec HTTP 200 et type MIME attendu. Les fronts ne publient pas de SHA Git : leur liaison au commit provient du workflow réussi et de ses IDs de déploiement, complétés par ces fichiers renouvelés. Aucun SHA de front n'est inventé.
- Preuves : `preuves/{ci-pr-177,pr-177-merge,staging-workflow,staging-fronts-avant,staging-fronts-apres}.json`, `preuves/staging-{smoke,deploiements}.log`. Ces constats postérieurs au déploiement sont ajoutés au suivi local ; ils ne déclenchent pas une seconde livraison.

Le lot de code UI et d'assets est intégralement fusionné et disponible sur staging. Le checkout principal et ses changements initiaux restent préservés. Aucun push vers `main`, aucune fusion en production ni déploiement production.

Prochaine tranche : recette utilisateur sur staging, en priorité POS A/B/C (configurateur, ticket, reprises), KDS (filtres et transitions), commande/fidélité/livreur, deux back-offices et choix d'illustration dans les deux médiathèques. Les formulaires secondaires complets et les essais appareils restent à couvrir ; les 33 parcours visuels locaux utilisent des fixtures et les 8 contrôles staging sont des lectures publiques, pas une recette métier authentifiée.

Accès : [web](https://web-staging-6f5f.up.railway.app), [POS](https://pos-staging-7f92.up.railway.app), [KDS](https://kds-staging-90da.up.railway.app).

## Point initial de la deuxième passe — historique, 12 septembre 2026

Branche dédiée `refactor/ui-handoff-fidelity`, issue de `origin/develop` `a01f857`, suivi de livraison repris par le commit `d90e7f8`. Checkout principal et autres branches préservés. Aucun nouveau push, merge ou déploiement autorisé pour cette passe.

La demande de reprise corrige deux lacunes concrètes : les photos n'étaient proposées qu'après création du produit et trop d'icônes historiques évitaient encore le kit. La bibliothèque est déplacée en tête du formulaire, création comprise. Le premier POST produit est suivi de l'association via le contrat médias existant ; tout échec de cette seconde étape conserve le produit créé et reprend son identité. Les icônes sémantiques sont raccordées aux 78 dessins du kit. Les détails et preuves ciblées sont dans `LOT-ASSETS-V2.md` et `LOT-ICONES-V2.md`.

POS : densité confortable/compacte, carte produit plus ample, hiérarchie typographique, segments, réglages clair/sombre et préférences de réduction des mouvements/transparence. Premier export de cette présentation : typecheck/build réussis et recette 7/7, captures `captures/pos-fidelite-v2`. Ces résultats précèdent l'ajout du service à table et ne valident pas ce dernier.

Service à table : fonctionnalité explicitement autorisée par la nouvelle demande, développée dans les applications existantes. Configuration en BO, occupation exclusive des tables, tablées et plusieurs tickets, transfert, règlements et remise via les contrôleurs existants, libération conditionnée aux commandes terminées. Les admissions conservent les prix/calculs/stock/capacité du serveur. Les intentions directes sont durables avant réseau et se reprennent avec le même UUID ; une réponse incertaine bloque le remplacement de l'intention et le désappairage. Les premières intégrations Mongo locales passent ; l'interface POS, la recette bout en bout et la revue des courses restent en cours. Aucune preuve de production n'est revendiquée.

Prochaine tranche précise : finir l'envoi table → cuisine → règlement → remise → libération avec journal local durable et reprise après rechargement ; vérifier les courses et droits sur base temporaire locale, puis recette navigateur et passe des thèmes BO. Les validations finales et la liste des fichiers seront complétées ici.


### Gel local V2 avant reprise de la PR 178

Le service à table et les sept surfaces sont implémentés ; les preuves détaillées figurent dans `LOT-POS-V2.md`, `LOT-KDS-V2.md`, `LOT-ASSETS-V2.md`, `LOT-ICONES-V2.md`, `LOT-SALLE-BO.md`, `LOT-SERVICE-TABLE.md`, `LOT-BACKOFFICES-V2.md` et `LOT-SURFACES-CLIENT-V2.md`. Le journal distingue un remboursement connu à la reprise tout en conservant sa sémantique historique.

Validations de cet arbre avant PR 178 : POS 331 + 5 Node et 6 parcours salle ; KDS 86 ; web 2 915 ; API 3 686 (803 ignorés), DB 556 (10 ignorés), contrats 678, client-core 131. Typechecks, builds API/Next/exports Expo web et Hermes iOS/Android exécutés. Détails, environnements et causes des contrôles ignorés : `VALIDATION-METIER-V2.md`, `VALIDATION-WEB-V2.md` et les lots POS/KDS. La recette web compilée a réussi 26 parcours / 76 captures. Ces preuves ne valent pas encore validation du nouvel arbre combiné.

Nouvelle demande de compatibilité : PR [#178](https://github.com/GLWebDevAgency/snack-manager/pull/178) fusionnée dans `develop` en `80f2eac593863dfcfc1f9e5962c09db38fe6db24`. Elle ajoute Carte/Rechercher/Commandes/Fidélité/Compte et leur continuité de navigation. Sauvegarde locale du lot V2, puis rebase local de la branche dédiée sur ce commit ; aucune fusion distante, aucun push ni déploiement. Prochaine tranche précise : habiller et tester ces nouvelles destinations, conserver les comportements PR178, puis relancer les validations sur la base combinée.
