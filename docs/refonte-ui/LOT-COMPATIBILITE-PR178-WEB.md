# Compatibilité visuelle avec la PR 178 — application client

Branche locale : `refactor/ui-handoff-fidelity`, base `80f2eac` (PR 178 intégrée à develop), checkpoint du lot précédent `4431fcd`. Aucun push, fusion distante ou déploiement dans ce lot. Les autres agents conservent leurs fichiers POS, KDS et métier.

## Périmètre et comparaison

Lecture des nouvelles routes `/r/[slug]`, `/compte`, `/commandes`, `/fidelite`, de la composition Storefront, de la navigation client-core, du compte, de la fidélité privée et de la carte historique. Direction confrontée à `online-account.png`, `loyalty-card.png`, au handoff complet, aux invariants et aux captures réelles PR 178 puis Next local. Les captures du studio donnent une direction ; les contrôleurs existants déterminent le périmètre fonctionnel.

Les captures avant de la version rebased sur PR 178 sont dans [customer-pr178-avant](captures/customer-pr178-avant/resultats.json) : 4 scénarios à 320 px (clair/sombre, session synthétique/pilote fermé), 30 captures. Le seul élément masqué pour cette comparaison est l’inspecteur de développement Next, qui recouvrait le premier onglet à 320 px ; aucune surface du produit n’a été masquée. Les recettes du build n’ajoutent pas ce style.

Écarts corrigés :

- Le profil et l’accès au compte avaient une grande surface secondaire uniforme. Ils utilisent maintenant des cartes opaques, des en-têtes séparés et un regroupement explicite des contrôles et de la session.
- Les cartes invité/adhésion/rattachement utilisaient un dégradé. Elles reprennent la surface opaque du restaurant.
- La fidélité privée mettait le titre avant le solde. Le solde devient dominant, avec une unité séparée, une note de fraîcheur et la paire fond/texte du masque inversée : aucune couleur arbitraire, aucun seuil ou progrès inventé.
- Le sélecteur « Mon compte / Cet appareil » conserve ses rôles clavier dans un groupe visuel cohérent. La carte historique reste dans son élément natif `details`, avec icône QR, chevron et focus visible.
- Les actions d’affichage de carte et de scan utilisent les véritables icônes `qr` et `camera` du kit. Les cinq destinations utilisent déjà les symboles kit via le renderer partagé ; aucune utilisation artificielle des 78 icônes n’est ajoutée.

## Fichiers de présentation

- `apps/web/src/components/customer-account/CustomerAccountPanel.tsx`
- `apps/web/src/components/customer-account/CustomerAccess.tsx`
- `apps/web/src/components/customer-account/CustomerEnrollment.tsx`
- `apps/web/src/components/customer-account/CustomerLoyalty.tsx`
- `apps/web/src/components/customer-account/CustomerOrdersPage.tsx`
- `apps/web/src/components/customer-account/customer-account.css`
- `apps/web/src/components/loyalty/LoyaltyCardApp.tsx`

Harnais locaux : `e2e/local/refonte-customer-fixture.mjs` et `e2e/local/refonte-customer-178.mjs`. Aucun changement de route, hook, contrôleur, contrat, calcul, consentement, journal, droit, API, BFF ou framework. Les instructions AGENTS restent intactes.

## Parité conservée

| Parcours | Limite conservée |
| --- | --- |
| Carte / Rechercher / Commandes / Fidélité / Compte | Destinations et routes PR 178 ; cinq libellés complets à 320 px ; navigation `history`, recherche, état du panier et reprise du tunnel |
| Compte | Accès invité, pilote fermé, session sélectionnée par le journal existant, profil révisionné, confirmation de déconnexion, clé d’accès / secours et reprise |
| Commandes | Lecteur privé du compte distinct des reçus de cet appareil ; filtres, détails, panier à préparer de nouveau et verrous existants |
| Fidélité privée | Solde lu du serveur, QR demandé explicitement, projection supprimée au départ ; adhésion facultative et consentement distinct du rattachement |
| Carte historique | Ancien QR / cookie de carte, solde et lecture hors ligne existants, scan et retrait ; aucun rattachement implicite au compte |
| Identité restaurant | `styleDuMasque`, palette, police, rayons et mode clair/sombre conservés ; aucune préférence visuelle forcée dans le compte |
| Démo / embed | Frontière invitée préservée ; aucun compte nouvellement activé ; parcours démo distinct |

## Vérifications exécutées

Node `24.20.0`, versions du dépôt inchangées. Le serveur Next antérieur a été arrêté proprement avant chaque build. Le serveur public de recette est exclusivement local (`http://localhost:3001`) et ne sert que les fixtures du restaurant fictif déjà présent dans le dépôt. Les mutations inconnues sont refusées. Playwright intercepte les lectures protégées avec des réponses synthétiques respectant les contrats, amorce uniquement le journal de test existant et bloque tout domaine externe. Aucun compte, paiement ou base réel n’est utilisé.

- Tests ciblés compte/fidélité/navigation : **592/592, 33 fichiers**, [journal](preuves/pr178-web-cibles.log).
- Typecheck web : **PASS**, [journal](preuves/pr178-web-typecheck.log).
- ESLint : **43 fichiers TS/TSX/JS modifiés depuis la base PR 178, 0 erreur / 0 avertissement**, [périmètre](preuves/pr178-web-eslint-scope.json), [résultat](preuves/pr178-web-eslint.json). Les 6 CSS sont hors configuration ESLint ; elles sont compilées et soumises aux recettes navigateur.
- Premier build Next : **PASS**, [journal](preuves/pr178-web-build.log). Première recette du build : **18/18**, 132 captures, avant l’ajout de la marge de 6 px entre le solde et l’unité.
- La suite globale a démarré après le gel de tous les TSX. Seule cette marge CSS a été ajoutée pendant son exécution. Le dernier build et les captures finales incluent la marge ; aucune nouvelle logique métier n’a été modifiée entre ces preuves.
- Sources gelées : [49 empreintes web](preuves/pr178-web-source-freeze.json).

Résultats finaux sur les sources gelées :

| Preuve | Résultat exécuté |
| --- | --- |
| Suite web complète `--no-file-parallelism` | **2 994/2 994 tests, 195 fichiers, 0 échec, 0 ignoré, 0 todo** ; [journal](preuves/pr178-web-tests.log), [JSON](preuves/pr178-web-tests.json) |
| Dernier build Next | **PASS**, `BUILD_ID bPzLIBZiO8taFULNJdNVv` ; [journal](preuves/pr178-web-build-final.log), [métadonnées](preuves/pr178-web-build-metadata.json) |
| Cinq destinations PR 178 | **18/18 scénarios, 144 captures**, 320/390/1440 px × clair/sombre × invité/session synthétique/pilote fermé ; [résultats](captures/customer-pr178-build-final/resultats.json), [journal](preuves/pr178-web-client-visuel-final.log) |
| Surfaces existantes du build combiné | **26/26 scénarios, 76 captures** : commande démo, fidélité démo, livreur, BO restaurant et BO Snack Manager ; [résultats](captures/web-pr178-build-final/resultats.json), [journal](preuves/pr178-web-surfaces-visuel-final.log) |
| Réseau et JavaScript | **0 erreur JavaScript / 0 tentative externe** dans les 44 scénarios. Le harnais des surfaces constate seulement 12 avertissements attendus : enregistrement Service Worker désactivé par Playwright. |
| Contraste du nouveau solde | Paire opaque mesurée à **15,05:1** (Brasserie claire) et **15,34:1** (Nuit sombre), nombre et note ; police/rayons du masque conservés. |
| Arrêt des processus de recette | Next PID `8614`, session `22042`, et fixture PID `90414`, session `14633`, identifiés par commande et cwd puis arrêtés par SIGINT. Ports **3001/3092/3093 libres** ; [avant](preuves/pr178-web-processus-avant-arret.json), [après](preuves/pr178-web-processus-apres-arret.json). Aucun autre service touché. |

La recette PR 178 exerce le panier configuré dans les cinq destinations, le retour navigateur, l’ouverture du tunnel avec la ligne initiale, les URL directes Compte/Commandes/Fidélité, le sélecteur des sources de commandes au clavier (End/Home), la disparition des lectures privées au changement de destination, le profil et l’annulation d’une déconnexion, l’affichage explicite du QR privé, les consentements d’adhésion/rattachement et leur remise à zéro quand le code change, puis la carte historique indépendante. Aucune demande d’adhésion ou de rattachement n’est soumise. Chaque onglet dispose d’une cible d’au moins 44 px ; le texte complet tient dans sa cible à 320 px.

Captures finales inspectées : [compte à 320 px](captures/customer-pr178-build-final/320-clair-connecte-compte.png), [solde clair](captures/customer-pr178-build-final/320-clair-connecte-fidelite.png), [solde sombre](captures/customer-pr178-build-final/320-sombre-connecte-fidelite.png), [accès invité](captures/customer-pr178-build-final/320-clair-invite-compte.png), [rattachement](captures/customer-pr178-build-final/320-sombre-connecte-rattachement-explicite.png), [commandes desktop](captures/customer-pr178-build-final/1440-clair-connecte-commandes.png), ainsi que la commande/fidélité démo, le formulaire BO sombre, la navigation restaurant claire et les réglages livreur à 320 px. La marge finale sépare bien le nombre de son unité.

## Continuité

Sources et preuves de ce lot gelées, 49 empreintes web vérifiées identiques après la recette. Aucun blocage fonctionnel identifié dans ce périmètre. La prochaine étape précise est la revue et le checkpoint local coordonnés par l’agent principal, puis une éventuelle recette matérielle séparée si autorisée. Ne pas relancer automatiquement une API fixture sur le port du backend réel. Le studio et les exports POS/KDS gérés par l’agent principal n’ont pas été arrêtés.

## Limites explicites

Les états connectés sont des sessions de recette synthétiques avec vrais contrôleurs et réponses HTTP interceptées. Ils ne constituent pas une preuve d’inscription avec SMS, d’authentification matérielle WebAuthn, d’envoi publicitaire, de paiement ou de QR physique. Aucune adhésion ni rattachement réel n’est soumis. Les suites existantes exécutent les gardes et reprises métier avec leurs propres transports de test. Les captures Chromium n’équivalent pas à une validation physique iOS/Android, ni à une recette Safari/VoiceOver.

Les preuves de fidélité V2 antérieures à PR 178 restent utiles pour les composants historiques, mais ne prouvent pas la nouvelle destination privée ; ce lot apporte cette preuve séparément.
