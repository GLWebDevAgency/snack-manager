# Back-offices — clair et sombre utilisables

Branche `refactor/ui-handoff-fidelity`, base `develop` `a01f857`. Périmètre : les coquilles restaurant et Snack Manager existantes ; aucun nouveau produit, route ou schéma métier.

## Diagnostic et décisions

L’adaptateur précédent imposait le sombre et `color-scheme: dark`, sans sélecteur. Les anciennes classes `text-white`, `border-white/*`, `bg-white/*` et le texte d’accent conçu pour le sombre rendaient un simple fond clair illisible. La maquette du kit est claire, avec navigation active neutre, cartes opaques, filets légers et hiérarchie du contenu.

Le nouveau bouton soleil/lune du kit, visible dans l’en-tête desktop et mobile, change l’apparence sans remonter la coquille. Le choix est local au navigateur (`sm.backoffice.theme.v1`), partagé par les deux back-offices, persistant et synchronisé entre onglets. Un stockage indisponible laisse le bouton utilisable en mémoire. Le premier usage est clair ; un choix sombre est conservé. L’apparence ne change pas route, session, champs, fichiers, rôle ou capacités.

`visual-style.ts` dérive les deux surfaces du kit. Les couleurs de fond d’accent et les verdicts restent détenus par leurs propriétaires actuels : aucune réécriture de marque ou de masque. Des encres distinctes sont calculées pour l’accent et l’or sur les fonds du personnel ; les encres fonctionnelles sont vérifiées sur leurs vrais lavis et survols. La navigation active utilise un aplat neutre et garde ses vrais noms, groupes, compteurs et droits.

La feuille de compatibilité adapte les seuls anciens utilitaires neutres des pages staff. Les blancs opaques d’une plaque QR ou de logo ne sont pas remplacés. Les verdicts remplis conservent leur paire d’encre. Les racines des aperçus de masque, identifiées par la variable de police qu’elles déclarent, ainsi que leurs descendants, sont explicitement exclus de ces règles. La feuille globale et les contrats de masque ne changent pas.

## Fichiers

- `apps/web/src/components/backoffice/{visual-style.ts,backoffice.css,visual-style.test.ts}`.
- Nouveaux `appearance.tsx` et `appearance.test.tsx` : préférence et bouton, sans API métier.
- `apps/web/src/app/admin/layout.tsx`, `apps/web/src/app/sm/layout.tsx` : branchement du choix et du bouton seulement.
- `e2e/local/refonte-web-visual.mjs` : sélection de surfaces, deux thèmes staff, persistance, changement inter-onglets pendant formulaire et isolation des aperçus.

## Preuves exécutées

- **51 tests PASS** : 17 apparence/contrastes et 34 navigation existante. `preuves/bo-v2-tests.log`.
- Typecheck web **PASS** après intégration des coquilles, puis à nouveau lors du gel client V2 (`preuves/client-v2-typecheck.log`). Le build global reste coordonné avec root après les lots parallèles.
- Avant : **4 scénarios PASS** sur le précédent `next start` local 3092, dans `captures/web-bo-v2-avant`. Ces captures sont prises avant modification des surfaces de ce lot, avec les icônes déjà présentes dans ce build.
- Après : **8 scénarios PASS, 22 captures**, vrais routes Next dev local 3093. `preuves/bo-v2-visuel-final.log`, `captures/web-bo-v2-final/resultats.json`.
- Dans chaque thème : dashboard, navigation desktop/mobile, formulaire membre/prospect, focus, fermeture et protection des modifications du prospect. Le choix survit au rechargement ; un événement de stockage inter-onglets ne ferme pas le formulaire et ne perd aucun caractère. Les aperçus d’identité de l’établissement gardent leurs couleurs, police et rayons calculés lors du changement d’apparence staff.
- Captures inspectées : deux dashboards clairs, formulaire prospect mobile clair, navigation restaurant mobile sombre. La référence `admin-desktop.png` et `captures/sm-dashboard.png` du kit a été inspectée.

Fixtures exclusivement locales, API externes bloquées, mutations HTTP refusées par le harnais. Les formulaires sont annulés sans envoi. Aucun compte réel, base, paiement, déploiement, push ou fusion. Chromium uniquement ; pas d’appareil iOS/Android ni validation matérielle. Le marqueur Next visible sur ces captures provient du serveur de développement ; le build final est une preuve distincte à exécuter après gel.

## Revue finale du stockage

La revue indépendante a détecté le cas où `getItem` lit encore l’ancien thème tandis que `setItem` échoue faute de quota. Le repli en mémoire est maintenant prioritaire après cet échec ; une écriture réussie ou un événement de changement de stockage rétablit la synchronisation habituelle. Un nouveau test navigateur monte deux consommateurs et les vrais boutons, impose une ancienne valeur claire lisible et une exception `QuotaExceededError`, puis vérifie les changements clair/sombre et le retour au stockage. **8/8 tests apparence PASS**, `preuves/bo-v2-stockage-quota.log` ; ce groupe comprend les sept tests de parse existants et un nouveau test navigateur.

Validation compilée du gel avant PR178 : **2 915 tests PASS sans skip, typecheck et lint PASS, build Next PASS, 26 parcours PASS et 76 captures**. Voir [VALIDATION-WEB-V2.md](VALIDATION-WEB-V2.md). Ces preuves ne couvrent pas l’adaptation à PR178 demandée ensuite.
