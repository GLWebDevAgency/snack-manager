# Reprise du parcours compte et fidélité — 12 septembre 2026

**Implémentation et vérifications locales acquises ; livraison suivie dans la [PR #178](https://github.com/GLWebDevAgency/snack-manager/pull/178). Aucun changement d’ouverture du pilote.** La demande a été précisée en une application client commune à la commande, au compte et à la fidélité : réutiliser l'identité vérifiée, éviter une seconde saisie de téléphone et proposer la fidélité uniquement lorsque le restaurant dispose du droit correspondant. Le [suivi unique](SUITE-APRES-COMMERCE.md) reste l'autorité pour les priorités et les preuves de livraison.

## Historique retrouvé

La session de travail `01a04773-f03a-7703-a9e8-d78699cd05c9`, dont le dernier message assistant est daté du 10 septembre 2026 à 20:55:43 UTC, permet de retrouver le fil compte/fidélité, puis la reprise consacrée aux remboursements gérant. Cette trace locale est un repère de continuité, pas une preuve de réception de l'application.

- La [reprise des gains POS après réponse perdue](REPRISE-GAINS-FIDELITE.md) est intégrée par [#169](https://github.com/GLWebDevAgency/snack-manager/pull/169), commit `6109c3c`. Sa réception appartient à ce lot antérieur ; elle ne prouve ni le crédit web ni la consommation de récompenses.
- Le travail sur la reprise des remboursements gérant a ensuite abouti à [#173](https://github.com/GLWebDevAgency/snack-manager/pull/173), commit `2c87989`. Cette correction ne termine pas le parcours compte/fidélité.
- L'audit de reprise compare le code à `origin/develop a01f857` ([#177](https://github.com/GLWebDevAgency/snack-manager/pull/177)). Les fichiers API d'identité/fidélité et leurs contrats examinés n'ont pas changé dans cette refonte visuelle.

Les mentions « en cours » ou « réception à effectuer » dans les notes du 10 septembre sont des états datés. Elles ne doivent pas masquer les PR reçues ensuite, ni permettre de déclarer les autres parcours terminés sans leur preuve propre.

## Socle à réutiliser

Le [contrat d'adhésion du compte](../../packages/contracts/src/customer-loyalty.ts) ne reçoit aucun téléphone. Le serveur reprend le nom et le téléphone vérifié de la session protégée. L'[adhésion](COMPTE-FIDELITE.md) crée dans une même transaction SQL le membre, son profil chiffré, son portefeuille, la preuve et son association au compte. Les références compte/membre sont uniques, immuables et isolées par restaurant et parent fournisseur.

La demande comporte un UUID, le programme et la version des conditions acceptées. Une réponse perdue se reprend sans créer une deuxième carte. Le [rattachement d'une carte existante](RATTACHEMENT-CARTE-EXISTANTE.md) vérifie la session protégée, le QR actif et le téléphone concordant ; il conserve le solde et remplace l'ancien QR. Une correspondance de téléphone seule n'autorise pas l'adoption d'une ancienne carte ou d'anciennes commandes.

L'accès dépend de la capacité serveur `loyalty`, du statut du restaurant et d'un programme actif. La [source des capacités](../../packages/contracts/src/capacites.ts) tient compte de la formule, des options et des dérogations ; l'option de commande en ligne inclut actuellement la fidélité. Ne pas remplacer ce calcul par un nom de formule ou un bouton masqué seulement côté navigateur.

## Parcours retenu pour ce lot

1. Après activation confirmée d'une nouvelle inscription, poursuivre dans la section fidélité lorsque le programme public et le droit du restaurant permettent de la proposer. L'entrée depuis la page fidélité retrouve la même section après connexion au compte.
2. Si le nom manque, le compléter dans cette section via la mise à jour de profil existante, puis revenir automatiquement aux conditions de la carte. Aucun second téléphone, aucune seconde identité ni vérification SMS supplémentaire n'est demandé pour cette adhésion.
3. Conserver l'acceptation explicite des conditions du programme. La création et la liaison de la carte utilisent ensuite le writer transactionnel existant. L'inscription au compte seule ne déclenche pas une adhésion non consentie ; le consentement marketing reste distinct.
4. Retrouver directement la carte déjà associée. Une carte historique non liée conserve le parcours de preuve prévu ; la simplification visuelle ne diminue pas cette exigence.
5. Conserver les reprises, les refus de session périmée et le contrôle du programme avant publication. Une fidélité indisponible ne supprime pas le compte ni le parcours invité.

La sauvegarde du nom masque temporairement la vue privée pour revalider son autorité. L'intention de revenir à la fidélité reste dans le contrôleur du panneau, sans stockage de téléphone, de QR ou de consentement dans le navigateur. Les conditions sont relues ; une nouvelle version exige une nouvelle acceptation.

Le lot ne modifie ni le protocole d'authentification ni les transactions SQL d'adhésion. Il ne livre pas un compte global partagé entre restaurants. Les conditions d'accès et d'ouverture du [pilote d'identité](IDENTITE-CLIENT-VERIFY.md) doivent être revalidées séparément ; aucune autorisation de dépense historique n'est renouvelée par cette reprise.

## Une application web responsive, des destinations communes

La [navigation publique pure](../../packages/client-core/src/customer-app-navigation.ts) définit cinq destinations dans l'ordre **Carte, Rechercher, Commandes, Fidélité, Compte**. Elle fournit les identifiants, libellés et chemins sans dépendance à React, au DOM ou à Next. Ce noyau peut être repris par une future interface Expo ; ce lot ne livre pas d'application native.

Le [Storefront](../../apps/web/src/components/order/Storefront.tsx) conserve les contrôleurs du panier et de la reprise checkout pendant la navigation entre onglets. Les chemins `/r/:slug/carte`, `/recherche`, `/commandes`, `/fidelite` et `/compte` permettent l'entrée directe et le retour navigateur. Les panneaux ont une destination active identifiable, les retours restent explicites et les mutations en cours verrouillent la navigation. Les pages privées sont montées lorsqu'elles sont consultées ; quitter l'historique démonte son lecteur.

Sur un domaine de marque blanche, l'[allowlist du proxy](../../apps/web/src/proxy.ts) autorise désormais la page compte, le BFF fidélité du compte et la reprise de panier à leurs chemins exacts pour le slug résolu. Les sous-chemins non prévus et les chemins d'un autre restaurant restent interdits. Cette correction de routage ne donne aucun droit API supplémentaire et n'élargit pas les sessions à un autre tenant. Les [tests du proxy](../../apps/web/src/proxy.test.ts) couvrent ces autorisations et leurs contre-exemples.

Les destinations suivent les projections publiques disponibles, sans déduire un droit de la présence d'une ancienne carte. **Une vitrine présente dont la commande est volontairement suspendue conserve Carte, Rechercher et Commandes.** L'absence d'option `online` ne signifie donc pas « deux onglets ». Le repli Fidélité/Compte concerne une vitrine réellement absente et un programme fidélité disponible. Une erreur temporaire du service de commande ne doit pas être assimilée à cette absence commerciale. Le même résolveur distingue une projection disponible, une absence explicite et une panne temporaire sur les routes principales. Une surface saine reste utilisable, avec une notice et une relecture via `router.refresh()` ; aucun objet erreur ne traverse les props publiques. Sans surface saine, deux absences donnent une 404 et une panne conserve son erreur. Les métadonnées et le JSON-LD suivent la surface réellement disponible. Les 24 tests de routes et 18 tests de métadonnées passent.

Les [pages compte](../../apps/web/src/components/customer-account/CustomerAccountPage.tsx) et fidélité utilisent le même contrôleur de session protégée. La fidélité conserve un accès explicite à la carte historique et au scanner QR pour les clients déjà équipés ; ce chemin ne transforme pas le QR en autorité de compte et ne rattache rien par téléphone seul. Les droits d'adhésion, de lecture et de rattachement sont recontrôlés côté serveur, même si l'onglet a été proposé par la projection publique.

La [page Commandes](../../apps/web/src/components/customer-account/CustomerOrdersPage.tsx) distingue deux sources lorsqu'un compte est vérifié : **Mon compte**, pour l'historique personnel du restaurant, et **Cet appareil**, pour les reçus invités locaux. Un invité garde ses reçus et un accès à la connexion. Les anciennes commandes invitées ne deviennent pas des commandes du compte par simple concordance d'identité. La reprise d'un panier relit le catalogue et les autorisations, conserve les articles déjà présents et ne crée ni commande ni paiement. Pendant l'ajout, les sources et retours sont bloqués ; après confirmation, le retour au panier n'ajoute pas une navigation concurrente.

L'historique privé n'est pas conservé hors connexion. Changement de publication de session, expiration, perte de réseau ou départ de l'onglet retirent le lecteur et rejettent ses réponses tardives. Les contrôleurs privés ne stockent ni profil ni nouveaux secrets dans les reçus invités. Le mode démonstration et l'intégration embarquée conservent leur périmètre public, sans ouvrir les parcours de compte réels.

## Preuves ciblées acquises

Ces résultats portent sur le code local du lot. Ils ne valent ni vérification globale, ni recette du bundle servi, ni appel réussi à un fournisseur réel.

| Vérification | Résultat acquis | Portée |
| --- | --- | --- |
| [Lien compte/fidélité PostgreSQL](../../apps/api/src/modules/customer-identity/customer-loyalty.store.integration.test.ts) | **61/61**, aucun ignoré | Vraie base PostgreSQL locale jetable, migrations et rôle dédié ; liaison, unicité, isolation, reprises et refus SQL. |
| [Interface fidélité du compte](../../apps/web/src/components/customer-account/CustomerLoyalty.browser.test.ts) | **35/35** | Vrais composants navigateur, profil/adhésion/rattachement et incidents ; fournisseurs isolés. |
| [Inscription](../../apps/web/src/components/customer-account/CustomerEnrollment.browser.test.ts) | **14/14** | Parcours navigateur d'inscription et continuation, notification unique par publication confirmée ; aucune preuve d'OTP réellement envoyé. |
| Commandes et reprise | **46/46** | [14 scénarios de la page commune](../../apps/web/src/components/customer-account/CustomerOrdersPage.browser.test.tsx), [20 du lecteur existant](../../apps/web/src/components/customer-account/CustomerOrders.browser.test.ts) et [12 de reprise](../../apps/web/src/components/customer-account/ReorderFlow.browser.test.tsx). |

Les scénarios Commandes vérifient notamment les sources au clavier à 320/390/820 px, le retour du focus après un détail, la purge privée à expiration ou hors réseau, le rejet d'une réponse A après sélection B au profil identique, les verrous indépendants compte/appareil et le retour au panier après ajout confirmé. Les suites existantes conservent les assertions de pagination, montants, transport, prix actualisés, panier existant et reprise checkout non résolue.

Le harnais [customerTestFixture](../../packages/customer/src/test-fixture.ts) crée une base PostgreSQL et un rôle jetables, applique les migrations fidélité puis identité et nettoie seulement ses ressources. La passe SQL ci-dessus a utilisé `CUSTOMER_TEST_DATABASE_URL` vers une instance locale explicite, avec un seul worker. Ne pas la confondre avec une passe générale où les intégrations peuvent être ignorées faute de cible de test ; ne pas utiliser la base applicative pour cette recette.

## Vérifications locales et réception distante

Le code fonctionnel du lot est enregistré dans `fa4a7ea`. Les résultats de CI, la fusion et le déploiement au SHA exact sont suivis dans la [PR #178](https://github.com/GLWebDevAgency/snack-manager/pull/178) et ses exécutions liées ; cette note ne déduit aucune réception distante des résultats locaux.

- **Web : 2 939 tests passés, zéro ignoré, 189 fichiers**, passe complète du 12 septembre. La garde finale de notification d'inscription ajoute ensuite un scénario : sa suite complète passe **14/14** après avoir démontré cinq notifications pour une seule activation avant correction. Elle ne modifie ni la session ni le protocole.
- **Autres composants : 6 321 tests passés**, 1 072 intégrations ignorées dans cette passe sans leurs bases dédiées. Les **61 tests SQL du lien** ont été exécutés séparément, avec une vraie base locale jetable et aucun ignoré.
- **Typage, analyse statique et builds du monorepo : 41 tâches réussies**, comprenant web, API, POS et KDS. Un build Next de production a aussi servi la recette locale Class'Food avec les données publiques réelles de staging.
- **Recette navigateur du build local : Chromium et WebKit**, largeurs 320/390/820/1440, cinq destinations, panier conservé, retour navigateur, absence de débordement, libellés complets et cibles d'au moins 44 px. Chromium a également rechargé directement les cinq URL en conservant le panier. Aucune erreur JavaScript observée ; aucune commande ni paiement distant créé. Les requêtes mutantes du navigateur de recette ont été bloquées.
- **Visuels inspectés : 16 captures de l'application isolée et 16 captures Class'Food**, plus une capture WebKit. Artefacts locaux : `/private/tmp/customer-loyalty-unified-nav` et `/private/tmp/customer-app-unified-classfood`. Le logo, les polices, les couleurs et les arrondis proviennent du masque du restaurant.
- La création et la connexion au compte restent **fermées lorsque les capacités du pilote le demandent** ; l'écran Commandes emploie alors « Mon compte », sans annoncer une connexion ouverte. La recette OTP réelle et la clé d'accès sur appareil restent distinctes des WebAuthn virtuels des tests.

Critères de réception à conserver :

- Nouveau compte : continuation vers la fidélité autorisée, nom complété une seule fois, téléphone repris du profil serveur et adhésion explicitement acceptée.
- Compte déjà adhérent : même membre et même solde ; carte historique : preuve de rattachement conservée et absence d'adoption sur téléphone seul.
- Nom en conflit, session expirée, changement de compte, fermeture du panneau, réponse perdue et double clic : aucune publication privée périmée ni deuxième adhésion.
- Programme absent, suspendu ou module retiré : UI cohérente avec le refus serveur, compte et achat invité utilisables selon leurs propres droits.
- Tests des vrais composants et des transactions PostgreSQL du lien, puis recette du bundle servi au SHA exact. OTP réel, clé d'accès sur appareil, SMS et ouverture du pilote restent des preuves distinctes des fournisseurs simulés.

## Suite distincte à revalider

Le writer de gains web, la consommation liée à une vente et les compensations après annulation/remboursement restent des lots séparés. L'attribution d'une vente à une carte ne vaut pas crédit de points. La reprise du gain POS reçue en #169 ne clôture pas ces travaux. La recette privée complète compte/fidélité et les conditions d'ouverture du pilote restent à rapprocher de leurs preuves réelles avant tout changement d'état.
