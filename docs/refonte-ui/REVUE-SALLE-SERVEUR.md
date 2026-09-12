# Revue indépendante — service à table

Revue de la lane UI/settings, sur les sources concurrentes de `refactor/ui-handoff-fidelity`. La relecture couvre `dining.service.ts`, le port `dining-order-commit.ts`, le diff `OrdersService.createWithOutcome`, les schémas Mongo/contrats et les gardes financières existantes. Après les constats initiaux, cette lane a réalisé le helper de prix et quotas ci-dessous et exécuté ses propres tests Mongo isolés ; la lane API porte les preuves d’intégration du service complet.

## Points transmis à la lane API

### Réservation de promotion après CAS incertain — correction réalisée, intégration coordonnée

Au moment de la première lecture, `candidateLost` préservait à juste titre une réservation si aucun reçu n’était visible et que la révision demeurait inchangée. Toutefois, le candidat et sa réservation n’étaient pas conservés avant le CAS. Le rejeu recalculait et réservait une deuxième fois.

Reproduction proposée : promotion automatique `maxUsage=1` ; intercepter l’écriture d’admission et lever avant son exécution ; rejouer exactement le même `DiningAddOrder`. La première demande laisse une réservation non rattachée. La seconde peut créer au plein tarif, le quota paraissant épuisé, ou compter deux utilisations pour une commande avec un quota plus grand.

L’agent API a confirmé le constat. Le nouveau `DiningPricingStore` écrit et relit un snapshot immuable, lié au restaurant, à la tablée, à l’opération et à l’empreinte du corps, avant toute réservation. Il fige aussi l’absence de promotion. La sélection utilise les calculateurs métier existants. Le reçu de réservation est ajouté à Promotion dans le même CAS que `usageCount` ; six helpers concurrents au dernier usage ne comptent qu’une utilisation. Une offre épuisée ne transforme jamais silencieusement le prix déjà figé en ticket au plein tarif.

La compensation suit uniquement un rejet durable de Session. Un marqueur de libération barre les insertions de prix retardées ; un reçu `released` barre les réservations retardées. Les candidats perdants ne libèrent pas la réservation partagée. Les écritures incertaines sont décidées par une relecture primaire avec `readConcern: majority`, après des écritures journalisées à majorité. Le journal de campagne est borné à 20 000 reçus : une campagne pleine refuse toute nouvelle réservation et demande une nouvelle campagne, sans effacer l’historique de reprise.

Une seconde faille a été détectée pendant le raccordement : le refus d’une tablée B fermée ou de révision périmée pouvait arriver avant `resolve`, puis libérer la réservation de A partageant le même UUID. `release` exige désormais l’identité complète et la filtre dans son écriture atomique, y compris lors de la création du marqueur. `DINING_PRICING_IDENTITY_CONFLICT` est vérifié avant l’état `released`, et le service n’en fait pas un rejet de commande. Les tests du helper couvrent le conflit direct et l’insertion concurrente d’une autre identité avant une libération retardée.

### Activation d’une table et ouverture/transfert concurrents — arbitrage ajouté

`finishOpening` et `transfer` lisaient `active`/`seats` dans Table, puis écrivaient Session par CAS. La révision du document Table n’était pas arbitrée avec cette admission. Une désactivation confirmée entre cette lecture et l’écriture Session peut encore laisser entrer une nouvelle tablée.

La lane API a ajouté une attribution persistante (`grant`) sur Table, acceptée par CAS de sa révision, de son activation et de sa capacité. Elle partage la révision utilisée par PATCH. Si la désactivation gagne, l’attribution est refusée ; si l’attribution gagne, sa capacité et son libellé restent figés et elle peut finir après la désactivation. La décision de Session consomme ce grant avec son identité complète. La formulation des réglages Salle a été alignée sur cette règle ; ses 17 tests navigateur ont été rejoués avec succès. Les tests serveur des deux ordres d’ouverture/transfert relèvent de la lane API.

## Éléments favorables vérifiés dans les sources

- Les prix et promotions passent par le pipeline `OrdersService` existant. Le DTO force `pos`, `surplace`, paiement comptoir encore en attente, sans espèces reçues ni montant de rendu fourni.
- L’admission fige un document Mongoose validé dans le document de tablée. La matérialisation utilise `$setOnInsert`, sans mise à jour des timestamps d’une commande existante. Elle vérifie tenant, identité client, admission, tablée, canal et type ; elle n’écrase pas une commande payée ou modifiée.
- Les rejets durables de configuration et de session ajoutent un reçu et incrémentent la même révision que l’écriture retardée. La création de table et l’ouverture passent par un état intermédiaire monotone avant succès/rejet. Un 409 ordinaire n’est pas assimilé à une preuve de rejet.
- Les indexes uniques contrôlent nom/position de table, occupation active et admission d’un client dans une tablée. Les chemins qui en dépendent vérifient leur présence ; ils échouent explicitement si l’arbitrage manque.
- Chaque service vérifie rôle, genre d’identité, tenant et capacité avant action. Le garde HTTP applique la subsomption existante `cogerant → gerant`. La cuisine lit mais n’ouvre, ne transfère, ne sert et ne clôture pas de tablée.
- Le fait « servi à table » est distinct du paiement : il écrit `dining.servedAt` et une preuve privée, sans encaisser. Sa mutation emploie `Order.__v`, également utilisé par les fermetures de paiement, l’encaissement et les remboursements existants. Les reçus privés sont retirés des projections publiques.
- La clôture exige que les admissions soient matérialisées et les tickets payés/remis ou annulés. La finalisation d’un ticket servi et payé appelle la transition de remise existante ; la révision de Session arbitre contre un nouvel envoi concurrent.

## État de validation

Exécuté par cette lane le 12 septembre 2026, sur Node 24.20.0 :

- `DINING_PRICING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local pnpm --filter @sm/api exec vitest run src/modules/orders/dining-pricing.test.ts --no-file-parallelism` : **26/26**, à 21:17:25. Parmi eux, **16 scénarios utilisent Mongo réel** dans une base dédiée suffixée par UUID ; les 10 autres couvrent les snapshots et le refus d’URLs non locales ou non dédiées. Pas de base métier ni de compte de production.
- `pnpm --filter @sm/api typecheck` : **PASS**, après raccordement de `release(tenant, identity)`.
- `pnpm exec eslint --config eslint.serveur.mjs apps/api/src/modules/orders/dining-pricing.ts apps/api/src/modules/orders/dining-pricing.test.ts packages/db/src/dining-pricing.schema.ts` : **PASS**, sans avertissement. La première invocation sans `--config` avait échoué faute de configuration ESLint racine ; aucune règle n’a été changée.

Les scénarios Mongo comprennent les pertes d’ACK de prix/réservation/libération, une écriture de prix non exécutée, la concurrence au dernier quota, les libérations concurrentes, les écritures de prix et de quota retardées après rejet, les collisions d’identité, les snapshots corrompus et la borne du journal. La recette UI/settings est documentée dans `LOT-SALLE-BO.md`, celle des médias dans `LOT-ASSETS-V2.md`.

Fichiers de correction détenus par cette lane : `apps/api/src/modules/orders/dining-pricing.ts`, `dining-pricing.test.ts`, `packages/db/src/dining-pricing.schema.ts`. Le service, son injection, les champs privés de Promotion et les tests HTTP/Mongo complets appartiennent à la lane API ; leur validation finale et le build API restent à reporter dans `LOT-SERVICE-TABLE.md`.

## Relecture POS complémentaire

Le contrôle de la caisse a relevé une absence initiale de verrou `saleInFlight` autour des opérations Salle hors envoi de commande. La racine a ajouté ce verrou, ainsi qu’une revérification de l’auteur actif après la persistance et avant HTTP. La relecture ciblée confirme l’usage de `cartDiningId` distinct de la tablée consultée, sa conservation lors du parcage, l’acquittement après journal durable et l’absence d’écrasement d’un ticket déjà payé dans le journal.

La reprise entre onglets utilise désormais le `draftId` local : B ne vide pas son brouillon lorsqu’il reprend A, et `observeDiningOperation` garde l’intention de A bloquante jusqu’à sa propre confirmation du même UUID. Les sources de ces corrections ont été relues sans nouveau défaut démontré ; le scénario navigateur à deux onglets est porté par la racine et n’est pas revendiqué comme exécuté par cette lane.
