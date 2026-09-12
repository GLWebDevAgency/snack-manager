# Back-offices restaurant et Snack Manager — surfaces et primitives

## Décision

Adapter les deux coques existantes, après la tranche Livreur, avec le même objet de présentation `components/backoffice/visual-style.ts` alimenté par `@sm/design-tokens`. Aucun composant du studio ne remplace une page fonctionnelle. Le mode sombre existant reste le mode de ces applications : canvas `#161916`, carte `#232723`, niveau secondaire `#2e342d`, encre et texte secondaire du kit. Un mode clair du personnel n'est pas inventé dans ce lot.

Les cartes, panneaux, champs et tiroirs existants héritent des variables dans la coque : cartes 20, champs/boutons 12, panneaux larges 28 ; les surfaces deviennent opaques et les ombres plus légères. Le composant partagé `Btn` conserve son API et reçoit une classe dédiée. Le CSS de la coque arrondit ses boutons, garde une cible minimale de 44 px, adoucit l'appui et colore sobrement la navigation active. Les badges de statut restent des badges et les couleurs fonctionnelles ne sont pas réattribuées à la marque.

La revue indépendante a trouvé une baisse de contraste sur le texte « Suspendu » au survol d'une ligne de `/sm/clients` : la carte, le voile blanc à 4 % et le badge rouge à 12 % se composent ; l'ancienne encre rouge atteignait seulement **4,33:1** sur ces nouveaux fonds. L'adaptateur applique désormais les encres `dark.danger`, `dark.success` et `dark.warning` du kit aux seuls `--cf-red-t`, `--cf-green-t` et `--cf-amber-t`. Le cas « Suspendu » atteint **6,97:1** par calcul. Les aplats fonctionnels rouge, vert et ambre, leurs libellés et leurs décisions métier sont inchangés.

L'adaptateur n'est jamais appliqué à `documentElement`. Le layout restaurant conserve sa résolution `tenantAccentPalette` ; le layout Snack Manager conserve son accent fixe et sa remise à l'entrée. Les masques client restent prioritaires dans les sous-arbres qui les portent. Police et identité restent gérées par les sources existantes.

## Fichiers de présentation

- `apps/web/src/components/backoffice/{visual-style.ts,visual-style.test.ts,backoffice.css}`
- `apps/web/src/app/admin/layout.tsx` : style/classe sur la coque, surface de navigation.
- `apps/web/src/app/sm/layout.tsx` : style/classe sur la coque.
- `apps/web/src/components/ui/Btn.tsx` : classe `sm-button`, aucun changement de props ni handler.
- `apps/web/src/components/ui/icons.tsx` : registre d'icônes du kit, repli sur les clés historiques (lot partagé).

## Parité conservée

| Surface | Sources relues et comportements conservés |
| --- | --- |
| Restaurant | `navigation.ts` et `layout.tsx` : groupes, libellés, routes, rôle, capacités, verrou, suspension, reprise des requêtes de comptage, reconnexion WebSocket, pause des commandes en ligne, démonstration, déconnexion, rail et volet Plus. |
| Dashboard restaurant | `dashboard/page.tsx` : endpoints stats/commandes, périodes, montants en centimes, objectif, agrégats et données de démo existants. Aucun chiffre de maquette ajouté. |
| Autres pages restaurant | Les pages ne sont pas remplacées. Les champs, exports, filtres, contrôleurs d'édition, brouillons, journaux et confirmations restent dans les sources existantes ; changement hérité des primitives uniquement. L'ajout d'illustrations dans les deux médiathèques est documenté séparément dans KIT-AUDIT. |
| Snack Manager | `navigation.ts` et `layout.tsx` : rôle sm_admin, session HQ séparée, identité réelle, barre desktop/mobile, accueil, Prospection, Restaurants, File du jour, Facturation, Production, Erreurs, Vitrine Snack Manager. |
| Pages plateforme | `page.tsx`, `pipeline/page.tsx`, `clients/page.tsx`, `signals/page.tsx`, `facturation/page.tsx`, `production/page.tsx`, `erreurs/page.tsx`, `reseaux/page.tsx` : données CRM/agrégats, action détail, étapes prospect, capacités, reprise/relance, facturation et confirmations restent propriétaires de leurs opérations. Aucun formulaire ni schéma de données remplacé. |
| Primitives partagées | `Btn`, `Card`, `Kpi`, `Modal`, tiroirs HQ : props, états disabled, couches de dialogue, focus/Échap/confirmations destructives inchangés. Les handlers de sauvegarde et protections de départ ne sont pas déplacés. |

## Validation exécutée

Validation initiale : `pnpm --filter @sm/web test src/components/backoffice/visual-style.test.ts src/components/ui/icons.test.tsx src/app/admin/navigation.test.ts src/app/sm/navigation.test.ts` : **4 fichiers, 37 tests réussis**. Les trois tests initiaux de l'adaptateur vérifient contraste texte/focus/champs sur les trois surfaces, accent de navigation sur son lavis, et absence de prise de contrôle de la marque/couleurs fonctionnelles.

Après correction des encres : `PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH pnpm --filter @sm/web exec vitest run src/components/backoffice/visual-style.test.ts` : **1 fichier, 6 tests réussis**. Les trois nouveaux cas vérifient chaque encre fonctionnelle sur les trois surfaces, avec/sans survol blanc à 4 % et avec les lavis réellement employés (10–16 %). `git diff --check` réussit. Cette correction ciblée n'a lancé ni typecheck global, ni build, ni nouvelle capture navigateur ; le ratio cité est une preuve de calcul, pas une mesure de capture.

Les parcours et captures Next avant/après, le typecheck, la suite web complète et le build sont centralisés dans `QA-WEB.md` et `REPRISE.md`. Une revue de code n'est pas une preuve d'exécution de chaque opération interne. Aucun compte, contrat, facturation ou paiement réel n'a été utilisé.

## Retour du focus du tiroir HQ

La recette du vrai formulaire Nouveau prospect a révélé un défaut antérieur : `autoFocus` focalisait le champ avant l'effet qui mémorisait le déclencheur ; la fermeture tentait ensuite de focaliser ce champ démonté. `HqDrawer` utilise désormais la couche existante `useDialogLayer`, comme les autres `Modal`/`Drawer`, avec racine initialement inert et zones de contenu/pied identifiées. Elle capture le déclencheur, isole le fond, gère la pile et restaure le focus. Les handlers métier, la garde sur saisie et l'effet d'historique restent en place.

Recette sur les vraies routes `/sm/pipeline` en desktop/mobile : saisir le nom, 16 Tab confinés, Escape conserve la saisie, retour navigateur conserve la saisie, voile conserve la saisie en desktop, Annuler ferme et rend le focus au bouton Nouveau prospect. **PASS** dans les 16 scénarios communs (`QA-WEB.md`).
