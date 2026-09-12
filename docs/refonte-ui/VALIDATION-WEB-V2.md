# Validation web globale V2

Branche `refactor/ui-handoff-fidelity`. **Ce gel et ces preuves précèdent l’adaptation à la PR 178 demandée pendant la validation. Ils ne valent pas validation de cette adaptation.** Vraies applications Next, dépendances existantes, Node 24.20.0. Aucune installation, mise à niveau ou suppression de test.

## Périmètre et arrêt des serveurs

`Tracking.tsx` et son test ont été relus en entier : le libellé historique de table est affiché dans le récapitulatif, avec les textes de service à table, sans exposer les identifiants internes ni modifier le traitement du paiement. Les derniers types `OrderTicket.dining` ont été compilés par root avant la validation.

Le Next dev 3093 démarré pour la recette précédente a été arrêté. L’ancien `next start` 3092 a été identifié par PID 95370, parent 95303, commande et répertoire `SnackManager-refonte-ui/apps/web`, puis terminé proprement par SIGTERM ; les deux processus ont quitté et le port a été libéré. Aucun autre serveur n’a été interrompu.

## Preuves

- Première suite globale sans parallélisme de fichiers : **190 fichiers, 2 914 tests PASS, zéro ignoré, zéro todo**. `preuves/web-v2-tests-global.{log,json}`.
- Dernier suivi de commande : **36/36 PASS**, `preuves/web-v2-tracking-final.log`.
- Correction de quota local trouvée en revue : **8/8 PASS**, dont un nouveau test navigateur. `preuves/bo-v2-stockage-quota.log`.
- Suite complète rejouée après la correction de quota et le dernier Tracking : **191 fichiers, 2 915 tests PASS, zéro ignoré, zéro todo**, `preuves/web-v2-tests-final.{log,json}`. Le rapport JSON contient 191 résultats de fichiers ; ses compteurs de suites incluent aussi les blocs describe, et ne sont donc pas utilisés comme nombre de fichiers.
- Typecheck final **PASS**, `preuves/web-v2-typecheck-final.log`.
- Lint final **37 fichiers, zéro erreur, zéro avertissement**, `preuves/web-v2-lint-final.{log,json}`.
- Build Next **PASS**, `preuves/web-v2-build-final.log` : compilation, TypeScript et 62/62 pages statiques générées. `BUILD_ID=NOW-B7HpG8-KO3pxCTIsn`. Les empreintes des sources web sont identiques au gel testé ; `preuves/web-v2-build-metadata.json` conserve le HEAD, le build, l’API locale et l’empreinte du harnais.
- Nouveau `next start` sur le seul loopback 3092. **26/26 scénarios PASS, 76 captures**, `preuves/web-v2-visuel-build.log` et `captures/web-build-v2-final/resultats.json` : commande/fidélité/livreur en 1440/390/320 px, deux apparences ; restaurant et Snack Manager en 1440/390 px, clair/sombre.
- Sur le build : sélection de la Galette payante, ajout au panier à 8 €, identité/fidélité démo, lecture de mission livreur et fermeture, préférences persistantes et navigation opaque, dashboards staff, navigation mobile, formulaires, conservation de saisie lors du changement de thème et retour focus. Le prospect entamé résiste à Escape, au fond de modal et au retour navigateur ; 16 Tab restent dans le formulaire. Les aperçus de masque ne changent pas avec le thème staff.
- **Zéro erreur JavaScript**, zéro requête vers un hôte externe tentée. Le harnais bloque de toute façon tous les hôtes externes et toute mutation HTTP de fixture. Les 12 messages console « Service Worker registration blocked by Playwright » sont la conséquence du blocage explicite des service workers pour isoler cette recette ; ils sont conservés dans le JSON.
- Captures compilées inspectées : fiche produit claire 390 px ; fidélité sombre desktop ; apparence livreur sombre 320 px ; dashboard restaurant clair desktop ; formulaire prospect sombre 390 px. Le marqueur du serveur de développement est absent.
- `git diff --check` **PASS**.

Le serveur compilé est laissé disponible pour inspection : session d’exécution 39000, listener PID 75105 au moment du contrôle. Il appartient à ce lot et devra être arrêté avant de remplacer ce build. Aucun serveur de développement n’est actif par cet agent. Aucun compte, paiement, SMS, livraison, base ou déploiement de production utilisé. Les données de démonstration et fixtures ne constituent pas une preuve de fonctionnement contre un backend réel ; aucun appareil iOS/Android ni WebKit n’a été utilisé dans cette recette.

Le périmètre du lint est enregistré dans `preuves/web-v2-lint-scope.json` : fichiers TS/TSX/JS traités par ESLint, feuilles CSS distinguées car le dépôt ne configure pas de linter CSS. Les CSS sont compilées par Next et contrôlées par les parcours visuels. La tentative `pnpm exec eslint` depuis `apps/web` n’a pas trouvé le lien exécutable du package hoisté ; l’exécution directe de `node_modules/eslint/bin/eslint.js` utilise ensuite la même configuration ESLint et les mêmes dépendances, sans installation.

`preuves/web-v2-source-freeze.json` conserve les empreintes SHA-256 des fichiers web modifiés utilisés pour ce gel. Les preuves exécutées sur le build seront distinguées des captures précédentes du serveur dev.
