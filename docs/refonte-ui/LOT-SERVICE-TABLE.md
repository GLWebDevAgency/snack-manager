# Service à table — tranche verticale

Branche : `refactor/ui-handoff-fidelity`. Ce lot répond à l’autorisation de compléter les fonctions pertinentes du handoff avec leur véritable persistance. La capture `pos-service.png` est une liste de commandes ; elle ne définissait aucune gestion de salle. L’ancien mode `surplace` et les paniers locaux `ParkedTicket` sont conservés.

## Parcours et périmètre

Le responsable configure les tables (nom, capacité, activation). La caisse ouvre une tablée avec ses convives, lui envoie un ou plusieurs tickets cuisine immuables, peut la transférer, confirme le service des tickets prêts, les encaisse avec les moyens existants puis clôture la tablée. Une table reste occupée jusqu’à une clôture explicite confirmée.

Le service physique avant paiement renseigne `Order.dining.servedAt` sans modifier `payment` ni le statut cuisine `ready`. Lors de la clôture, les tickets prêts, servis et payés passent par la remise existante `OrdersService.updateStatus(..., 'delivered')`. Les tickets annulés, ou déjà remis avec paiement `paid` ou `refunded`, sont terminaux et permettent la clôture sans réécriture financière. Un ticket `ready`, même servi, reste non clôturable s’il est remboursé : aucun nouveau passage à `delivered` ne contourne la règle de paiement existante. Toute panne ou concurrence laisse la tablée ouverte et la même clôture est reprenable. Aucun ticket impayé ou non remis n’est simplement effacé. Les annulations restent celles du produit existant.

Chaque envoi est un ticket distinct : pas de réécriture d’une vente existante, pas de partage arbitraire de lignes ni de nouveau calcul fiscal. Prix, options, suppléments, retraits, ruptures, promotions, notes, fidélité, rendu monnaie, encaissement CB/espèces/TR, annulation/remboursement et journal conservent les services existants. Les opérations d’occupation, transfert, service et clôture exigent une réponse serveur ; elles ne passent pas par la file offline générique.

## Contrats et routes

Les types `DiningTable`, `DiningSession`, `DiningRoom`, `OrderDining` et DTO Zod sont exportés par `@sm/contracts`. `Order.dining` est facultatif pour les commandes historiques. Son nom de table désigne le contexte accepté lors de l’envoi du ticket ; transférer la tablée ne réécrit pas ce contexte historique.

| Route | Résultat | Droits |
| --- | --- | --- |
| `GET /dining/room` | Tables configurées et tablées ouvertes, révisions, admissions à confirmer | Gestion, caisse, cuisine |
| `POST /dining/tables` | Création persistée et auditée ; UUID d’opération = ID table | Owner, gérant, cogérant |
| `PATCH /dining/tables/:id` | Modification avec `expectedRevision` | Owner, gérant, cogérant |
| `POST /dining/sessions` | Ouverture de tablée ; UUID d’opération = ID session | Gestion, caisse |
| `GET /dining/sessions/:id` | Session et vrais tickets ; réparation des admissions déjà engagées | Gestion, caisse, cuisine |
| `POST /dining/sessions/:id/orders` | Commande `pos/surplace/counter`, non encaissée, `clientId = operationId` | Gestion, caisse |
| `POST /dining/sessions/:id/transfer` | Transfert avec révision et table cible | Gestion, caisse |
| `POST /dining/sessions/:id/orders/:orderId/serve` | `{operationId}` ; service physique idempotent du ticket prêt | Gestion, caisse |
| `POST /dining/sessions/:id/close` | Finalisation des tickets admissibles, puis libération atomique | Gestion, caisse |

Le tenant vient exclusivement du jeton. La capacité commerciale `bo` est requise. L’API relit les droits de chaque appel ; un rejeu autorisé depuis une autre session du même restaurant conserve l’auteur du reçu initial dans l’audit. Les clients isolent leurs intentions durables par restaurant et auteur.

## Décisions de concurrence et de reprise

- Un index Mongo unique partiel sur `{tenantId, tableId}` pour les sessions `open` arbitre l’occupation et le transfert. Un autre index interdit qu’un même `clientId` soit engagé dans deux tablées.
- Une attribution reçoit un **grant persistant sur Table**, par CAS de sa révision et de `active/seats`. Le grant fige libellé et capacité acceptés. Il se sérialise avec les changements du responsable. Désactiver interdit les nouvelles attributions ; les tablées ouvertes et attributions déjà acceptées restent reprenables. Le grant est retiré après la décision de session, uniquement avec son identité complète.
- La salle est bornée à 200 tables. Des positions uniques `0..199` rendent ce plafond atomique, y compris en création concurrente. Une tablée accepte au maximum 200 tickets ; une attribution ne peut dépasser la capacité acceptée de sa table.
- Le prix résolu et le choix de promotion, y compris l’absence de promotion, sont figés dans `DiningOrderPricing` avant réservation de quota. Ils utilisent les calculateurs existants. Le quota est réservé une seule fois pour l’opération dans le même CAS que `usageCount` ; les candidats concurrents partagent cette réservation.
- Une réservation de promotion n’est libérée qu’après un rejet durable de la session, avec identité complète (restaurant, session, opération, empreinte du corps). Un marqueur définitif barre les écritures de prix ou réservations retardées. Les reçus de promotion sont bornés à 20 000 par campagne ; atteindre cette limite demande une nouvelle campagne, sans contourner le quota.
- Le CAS de session engage un candidat validé avec son snapshot avant de matérialiser `Order`. Une réponse perdue, un crash ou un prix de menu changé ne créent pas une nouvelle vente. La matérialisation fait uniquement un `setOnInsert` sur l’identité engagée, puis vérifie cette identité.
- La révision de session sérialise envoi, transfert et clôture. Une admission encore à matérialiser bloque la clôture. Les reçus d’opération et décisions refusées sont conservés ; aucun TTL ne libère une opération incertaine.
- Seul `DINING_OPERATION_REJECTED` portant l’UUID attendu prouve qu’une intention peut être retirée. Les 409 génériques, conflits d’identité, lectures introuvables, timeouts et 5xx ne constituent pas cette preuve. Le client rejoue le même corps et le même UUID.
- Le service physique utilise un CAS de version sur `Order`, avec reçu privé et refus durables. Deux opérateurs ne peuvent confirmer deux services différents du même ticket. Le reçu reste reprenable après changement d’état financier et son auteur/date ne sont jamais remplacés.
- Les audits sont ajoutés par `AuditService.logOnce`. Une panne d’audit ou de publication laisse une opération à reprendre ; les lectures de détail réparent aussi les preuves de service déjà commises. Aucun identifiant d’opération privé ni attribution fidélité n’est exposé dans les réponses ou événements publics de commande.

## Préparation des schémas

`DiningSchemaBootstrap` est enregistré dans `OrdersModule`. Au démarrage API, il crée de manière additive les trois collections `dining_tables`, `dining_sessions`, `dining_order_pricing` et leurs index. Il n’appelle jamais `syncIndexes`, ne supprime aucun index et ne réécrit aucune commande historique. La préparation fonctionne aussi quand `autoCreate` et `autoIndex` sont désactivés.

La garantie d’idempotence du pricing repose sur l’index primaire `_id` de son document. La réservation de quota utilise un CAS sur le document Promotion existant ; elle ne dépend pas d’un nouvel index de promotion. Les index requis pour les attributions sont vérifiés avant mutation. Les nouvelles propriétés Order/Promotion sont facultatives ou possèdent leurs valeurs par défaut : aucun backfill des ventes existantes n’est requis.

En staging après autorisation de déploiement : vérifier la ligne « Schémas et index du service à table préparés. », puis effectuer la recette d’une table synthétique. En cas de droits DDL insuffisants, le module indique que la salle est indisponible ; les autres parcours restent disponibles et les mutations de salle refusent de supposer les index présents. Corriger les droits de création des trois collections/index puis redémarrer l’API réexécute cette préparation idempotente. Le workflow de migration PostgreSQL reste distinct et inchangé.

## Fichiers métier

- Contrats : `packages/contracts/src/dining.ts`, `dining.test.ts`, `index.ts`, `ordering.ts` ; extension du type client dans `packages/client-core/src/types.ts`.
- Persistance : `packages/db/src/dining.schema.ts`, `dining-pricing.schema.ts`, `schemas.ts`, `index.ts`.
- API : `apps/api/src/modules/orders/dining.controller.ts`, `dining.service.ts`, `dining-order-commit.ts`, `dining-pricing.ts`, `dining-schema-bootstrap.ts`, raccordements `orders.service.ts` / `orders.module.ts` et extension bornée de `AuditService.logOnce`.
- Preuves : `dining.integration.test.ts`, `dining-pricing.test.ts`. POS, KDS et configuration web sont raccordés dans les lots frontend coordonnés par la racine.

## Validation et limites des preuves

Validations exécutées et vertes sur ce lot :

| Vérification | Résultat |
| --- | --- |
| Contrats `dining.test.ts` | 6 tests |
| Intégration `dining.integration.test.ts` | 33 tests : gardes des URLs de recette, Mongo réel local, HTTP Nest et vrais gardes JWT/session/capacités |
| Helper `dining-pricing.test.ts` | 26 tests, dont 16 avec Mongo réel local ; exécutés par l’agent propriétaire du helper |
| Non-régression des commandes existantes | 162 tests sur 8 fichiers : concurrence, remise, paiements, prix/options/fromages, promotions, journal, périmètre commercial et réconciliation `clientId` |
| Typecheck API | Réussi après les derniers renforcements d’identité |
| ESLint des contrôleurs, services et tests de la tranche | Réussi après les derniers renforcements d’identité |
| Builds `@sm/contracts`, `@sm/db`, `@sm/api` | Réussis |

Le dernier passage d’intégration couvre notamment les deux ordres de course entre attribution/transfert et désactivation, la reprise d’une attribution acceptée avant désactivation, le plafond de 200 tables sous création concurrente, les ouvertures/transferts/clôtures/envois concurrents, le service avant paiement, les réponses perdues, la clôture des tickets remis puis remboursés et le refus des tickets prêts remboursés, ainsi que la protection d’une réservation promo contre une autre session réutilisant le même UUID. La préparation additive des collections/index est exercée avec `autoCreate:false` et `autoIndex:false`, puis réexécutée sans supprimer un index supplémentaire.

La [validation élargie finale](VALIDATION-METIER-V2.md) contient les suites complètes API, DB, contrats et client core, les logs conservés, les cas ignorés et leurs hypothèses. Les 33 tests Salle et 26 tests du helper ont passé dans cette suite API finale ; le typecheck et le build API ont été réexécutés après le dernier correctif de clôture et incluent les tickets imprimables Salle.

Les bases de test portent un nom strict `snackmanager_dining*_test_...` suffixé par un UUID, sur `127.0.0.1:27048`. Les gardes refusent tout hôte externe, toute base métier, tous identifiants et options de connexion. Seules ces bases temporaires sont nettoyées. Le transport Redis des tests est isolé ; il ne démontre pas un broker réel. Les services de paiement utilisés en tests enregistrent des faits de caisse synthétiques, sans TPE ni paiement externe. Aucune base, aucun compte ni paiement de production n’a été utilisé.

Commandes de recette à conserver :

```sh
pnpm --filter @sm/contracts exec vitest run src/dining.test.ts
DINING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_test_local pnpm --filter @sm/api exec vitest run src/modules/orders/dining.integration.test.ts
DINING_PRICING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local pnpm --filter @sm/api exec vitest run src/modules/orders/dining-pricing.test.ts
pnpm --filter @sm/api typecheck
pnpm --filter @sm/api build
```

La recette visuelle POS/KDS/BO, les builds frontend et les preuves de continuité globale sont consignés par leurs agents et dans `REPRISE.md`. Aucun staging ni déploiement n’a été lancé par ce lot. Les essais réels multi-appareils et matériel restaurant restent à effectuer lors de la recette autorisée.
