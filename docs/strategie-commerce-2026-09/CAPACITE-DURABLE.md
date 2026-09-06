# C15 — capacité durable, protocole et preuves

7 septembre 2026. **Socle C15-A et préparation C15-B, réservation durable non activée dans l'application.** Le contrôle de créneau existant présente toujours la course décrite ci-dessous. Cette note ne certifie ni la livraison complète, ni l'expiration des commandes impayées.

## Défaut reproduit et découpage

Le verrou Redis public expire après 15 secondes. A valide la dernière place et reste suspendu avant son CAS `committing`. B acquiert le verrou expiré, ne voit aucune commande/snapshot engagé de A et prend la place. A reprend puis engage aussi sa commande.

Le harnais `apps/api/src/modules/orders/slot-reservation-race.integration.test.ts` reproduit **deux commandes pour une place** : vrais contrôleur, `SlotsService`, `OrdersService`, admissions et deux connexions Mongo ; seule l'horloge Redis est avancée, sans attente réelle ni fournisseur distant. Son assertion doit rester rouge jusqu'au raccordement complet. Ne pas remplacer l'invariant par « deux commandes attendues », `it.fails` ou une recette déclarée réussie.

- **Correctif Engage indépendant** : toggle de promotion atomique, sans réécriture du compteur historique. Ce n'est pas la correction des réservations promotionnelles orphelines.
- **C15-A** : schémas compatibles, primitive de réservation avec snapshots et places atomiques, tests Mongo. Aucun provider Nest, aucune route ni changement du checkout. Branche/PR en brouillon tant que l'invariant runtime reste rouge.
- **C15-B** : calendrier/bootstrap historique, admission commune aux writers public protégé/legacy/staff, disponibilité issue des admissions et UX POS téléphone confirmée serveur. Activation seulement après toutes les preuves et recette staging.
- **Promotions durables** : lot distinct ; ne pas coupler son compteur à ce mécanisme de capacité par une compensation aveugle.

## Décision de stockage

MongoDB standalone reste supporté. Ni réplica set présumé, ni abonnement ou infrastructure supplémentaire.

Une admission porte des places numérotées : `capacity.slot`, `capacity.kitchenSeat`, et `capacity.deliverySeat` pour la livraison. Deux index uniques partiels `(tenantId, slot, seat)` arbitrent les collisions. **Un seul CAS** `validating + propriétaire + empreintes → committing` écrit ensemble snapshot validé, identité de commande et places. Les places ne sont donc pas un effet séparé de la décision irréversible de créer la commande.

La lecture des places libres est une proposition ; seuls le CAS et les index décident. Une collision E11000 provenant précisément de ces index permet de proposer un autre siège. Toute réponse d'écriture ambiguë impose une relecture ; `validating` ne prouve pas qu'un write retardé ne gagnera pas. Le noyau renvoie l'incertitude, jamais un acquittement de libération supposé.

Un résultat `full` du noyau n'est pas un rejet terminal : le futur orchestrateur doit gagner le CAS `validating → rejected` avant de libérer la tentative client. Un autre helper du même candidat peut être en vol. C01 conserve déjà cette frontière ; son intégration ne doit pas la perdre.

Une commande engagée est matérialisable par `$setOnInsert`, sans nouveau prix/numéro ni effet monétaire. L'abandon gagne avant l'engagement, ou observe la commande gagnante. Il ne supprime aucune commande existante.

Après engagement, la capacité n'est libérée qu'après lecture primaire de **l'Order exact, même tenant/clientId/orderId, définitivement cancelled**. Le CAS retire les numéros de place et inscrit une date de libération. Il ne rouvre jamais l'admission. Un helper retardé ne ressuscite pas la commande annulée existante. Une panne avant restitution produit une sous-capacité réparable, jamais une place libérée sans preuve.

Pas de TTL sur l'admission, ses places ou le calendrier. Pas de snapshot de toutes les commandes dans un bucket Mongo qui pourrait atteindre 16 Mo ; chaque admission conserve son propre snapshot comme C01. Les places sont privées : projection et sérialisation les retirent.

### Préparation B réalisée — pas un parcours activé

- **Identité commune** : même clé tenant/clientId pour public protégé, legacy et staff. `kind` et `channel` privés/immuables distinguent les origines ; le canal exact `phone` ne peut devenir `pos` pendant l'engagement. Les anciennes admissions C01 sans ces champs restent publiques/online. L'empreinte interne ne dépend pas d'un JWT renouvelable et ne constitue jamais une preuve de reprise publique. Aucun import historique à corps inconnu n'utilise cette fabrique.
- **Noyau multiwriters** : dernière place testée entre les trois origines ; snapshots staff conservent paiement et outbox fidélité, sans fabriquer `Order.publicRecovery`. Les portes du service public refusent les admissions internes, y compris libération du validateur. Les orchestrateurs de création/matérialisation staff et legacy ne sont **pas encore raccordés** ; `materializeSlot` C01 ne doit pas être pris pour un drainage mixte prêt à activer.
- **Index réellement prêts** : `listIndexes()` exposait `unique:true` avant la fin de construction. Le garde lit désormais `$indexStats` sur primaire, contrôle les trois spécifications et refuse `building:true`, absence, erreur ou résultat incohérent, sans cache positif ni repli moins sûr. Recette réelle : chacun des trois index a été suspendu puis terminé sur Mongo8.0.12. Avant activation, vérifier l'action Mongo `indexStats` pour le compte applicatif ; un refus de privilège entraîne volontairement503. Une suppression administrative d'index pendant les ventes reste interdite, même après cette lecture.
- **Grille brute pure** : `buildOrderCapacityCalendar` ne dépend ni de l'heure courante, ni des ventes, pauses web, abonnements ou Stripe. Horaires/fermetures Paris, capacités et déduplication testés face au service existant. Horaires incohérents/au-delà du jour refusés, `24:00` admis seulement en fin exclusive ; une seule occurrence de l'heure répétée DST reste la convention existante. Journée fermée explicitement distinguée d'une erreur. Depuis le 7 septembre, le modèle accepte zéro créneau **uniquement** avec une raison de fermeture explicite ; le bootstrap historique reste à livrer, aucun faux créneau n'est créé.
- **Journal téléphone pur** : corps/UUID durables avant POST, ISO canonique, reçu staff lié aux coordonnées/lignes/identité de la tentative, prix serveur autoritaire. Reprise sans expiration, sans nouveau clientId sur404/4xx ; aucun faux état rejeté avant contrat staff de clôture durable. Le premier reçu reste immuable et le corps reste présent pour réparer le journal caisse avant archivage. Aucun consommateur UI : il faut encore inscrire la clé dans la purge, exiger une vraie exclusion inter-onglets (pas le fallback mono-process), obtenir la confirmation serveur avant encaissement et remplacer l'ancien envoi en file — ne jamais envoyer par les deux chemins.

Ces modules restent volontairement sans activation. Les fixtures du noyau créent des admissions internes pour éprouver les index : elles ne prouvent pas le fonctionnement des routes staff, ni leur reprise dans le POS.

## Calendrier — prérequis d'activation

Le modèle `OrderCapacityDay` porte une journée Paris unique par restaurant, une grille bornée (1–1000 créneaux, ou zéro avec fermeture explicite) et les capacités cuisine (1–100) et livraison (1–50). Une journée commence `seeding`, jamais `ready` implicitement. Le noyau refuse une journée absente/non prête, un créneau non exact et les index uniques manquants.

**La capacité/grille d'une journée initialisée ne change pas.** Une nouvelle version de clé ne doit jamais oublier les commandes déjà prises. Les modifications BO devront annoncer leur date d'effet sur les journées non initialisées ; un changement urgent d'une journée déjà ouverte exige une opération dédiée de fermeture/reconciliation, pas une édition silencieuse. Les gardes du modèle ne protègent pas contre une écriture native Mongo ou une restauration incohérente : ces opérations restent réservées au bootstrap/migrations audités.

La primitive ne canonise pas encore les créneaux téléphone hors grille. Ce raccordement devra utiliser le même intervalle et le même calendrier que le public, sans regarder une grille différente à chaque requête.

### Coordination calendrier implémentée le 7 septembre — non raccordée

`OrderCapacityCalendarStore` complète désormais la grille pure. Le contrôle privé `Tenant.capacityControl` est absent par défaut ; aucun tenant n'est activé automatiquement. Sa version, son état, la génération de bootstrap, la date de bascule et la révision de réglages sont validés. Une unique intention contient le plan complet borné, sa révision et son empreinte, sans données de vente ou de client.

- `preview` ne fait aucune écriture : grille brute d'un ancien tenant ou plan déjà figé. Une prévisualisation n'est pas une disponibilité promise ; elle ne vérifie pas Stripe, les délais ou les places libres.
- `ensureDay` exige un contrôle actif et les trois index réellement prêts. Un CAS sur **le même Tenant et la même révision** fige le plan. Une modification des réglages gagnante avant le CAS impose un recalcul ; après le CAS elle n'altère plus cette journée.
- Les helpers reprennent ce plan exact : insertion `seeding`, vérification, passage `ready`, puis nettoyage de l'intention exacte. Une réponse perdue impose une relecture, jamais une expiration/remplacement du plan. Les anciennes générations ne peuvent acquitter une nouvelle intention.
- Une journée fermée reste fermée même si les réglages courants ont changé. Grille et révision source sont immuables ; un ancien calendrier sans révision ne peut être adopté implicitement. Les lectures corrompues sont refusées et les prévisualisations projettent uniquement leurs champs publics.
- Une commande historique non annulée, quel que soit son canal ou son état, ou une admission déjà engagée dans le jour Paris empêche l'ouverture d'une **nouvelle** journée. L'intention et le `seeding` restent conservés pour rapprochement : zéro journée `ready`, pas de suppression ni de deuxième plan opportuniste. Cette garde n'importe pas l'historique et peut bloquer l'initialisation des autres jours jusqu'à réconciliation.

**Frontière inchangée :** aucun provider Nest ni route n'appelle ce store. Les trois writers BO n'incrémentent pas encore atomiquement la révision ; bootstrap historique, arrêt/drainage des anciens binaires et raccordement de tous les writers de commandes restent obligatoires. Une relecture de contrôle entre deux documents ne clôt pas un ancien writer en vol. Ce lot ne peut donc pas être activé seul, même avec les tests ci-dessous verts.

## Bootstrap et tous les writers — encore à réaliser

1. Bloquer les nouvelles admissions de créneau et arrêter les anciens writers avant initialisation. Une simple pause de la vitrine ne suffit pas pour POS/legacy.
2. Matérialiser les anciens snapshots C01 `committing` ; préserver les preuves de reprise et les identités.
3. Importer tous les tickets futurs non annulés avec `pickup.slot`, **y compris les tickets staff au-delà de l'horizon public**. Une journée ne s'ouvre qu'après seed complet et vérification des index.
4. Conserver tout surbooking historique ; bloquer son créneau et demander une réconciliation, sans supprimer une vente ou inventer une annulation.
5. Faire partager l'admission et ses places par public protégé, public legacy et staff. Aucune adoption d'une commande privée par une preuve publique neuve ; une même clé tenant/clientId ne réserve pas deux créneaux.
6. Remplacer la disponibilité calculée sur les seuls Orders par l'autorité des admissions, en incluant `committing` sans compter deux fois les Orders matérialisés.
7. Réparer les restitutions après annulation, de façon idempotente et observable. Pas de purge liée à l'âge ni au seul statut bancaire local.

**POS téléphone : frontière opérationnelle.** Le POS peut aujourd'hui mettre la commande en file offline et l'annoncer acceptée avant admission serveur. Refuser ensuite le créneau pourrait laisser un ticket annoncé accepté, voire encaissé, absent côté serveur. C15-B doit obtenir la réservation serveur avant confirmation/encaissement des nouvelles commandes à créneau, distinguer l'état « à confirmer » et rapprocher explicitement les anciennes entrées offline. POS sans créneau reste hors de cette capacité réservée. Ne pas promettre une réservation hors réseau sans mécanisme distinct de places préallouées.

### Ordre du raccordement restant

1. **Calendrier/coordination Tenant** : un contrôle privé de bootstrap et une révision de configuration ; mise à jour atomique des réglages+révision dans les trois writers BO (`TenantsService.updateSettings`, `updateHours`, `DeliveryService.updateSettings`). Une intention de journée bornée dans le même document Tenant arbitre réglage concurrent vs initialisation ; un helper reprend exactement le plan figé. Les journées déjà initialisées ne changent pas. GET affiche une prévisualisation sans figer 14 jours ; la première vraie admission vérifiée initialise. Expliquer dans le BO les journées figées et les dates d'effet.
2. **Tous les writers et reprise** : nouveau binaire sans ancien writer de secours pour `pickup.slot` quand le contrôle est absent/seeding/blocked ; commandes sans créneau inchangées. Authentification staff avant admission ; récupération/rejet durable et matérialiseur commun avant UI. Orchestrer plein/rejet, compensation et annulation sans affirmer qu'un timeout a annulé une écriture. Bootstrap : arrêter/drainer les anciens binaires, arbitrer les anciens validating par CAS, matérialiser committing et reprendre tout l'historique futur, sans horizon arbitraire ni preuve publique inventée. Les lignes non mappables/surchargées restent bloquées pour rapprochement.
3. **Téléphone et activation** : créneaux issus de l'API staff (la pause web ne ferme pas implicitement le téléphone), tentative persistée, confirmation serveur `counter/pending`, puis encaissement de cette même commande via le module existant. Clôture durable avant nouvelle tentative après envoi incertain. Inventorier/vider ou rapprocher explicitement les anciennes files téléphone déjà encaissées avant bascule. Ensuite seulement : RED runtime vert, recette complète et PR vers develop/staging.

## Tests et critères de réception

La suite du noyau utilise MongoDB standalone local isolé. Les URI refusent les bases métier, hôtes distants, identifiants et options ; chaque exécution crée une base suffixée puis ne supprime que cette base.

Relevé local du 6 septembre : noyau39/39 (33 scénarios Mongo et6 gardes), schéma21/21, immuabilité54/54 (dont10 scénarios Mongo). Non-régression C01 réelle23/23, suite API1904 tests verts/192 explicitement ignorés hors passes DB dédiées, suite DB207 verts/10 ignorés hors passe Mongo dédiée. Typage API/DB et lints ciblés verts. Revue indépendante favorable **uniquement pour ce socle non activé** ; le RED contrôleur a été rejoué et reste rouge (1 attendu,2 observés).

Relevé suivant, préparation B : noyau55/55, identité15/15, grille66/66, index49/49 dont5 scénarios Mongo (3 constructions réellement suspendues), journal téléphone48/48 et52 régressions POS vertes. C01 réel23/23, schéma22/22, immuabilité réelle54/54. Suite API2029 verts/213 ignorés hors passes dédiées ; DB208 verts/10 ignorés hors passe dédiée. Typages API/DB/POS et lints vérifiés. Les recettes unitaires ne se substituent pas aux suites Mongo séparées. **RED contrôleur rejoué : toujours2 commandes pour1 place**. Revues croisées favorables au lot préparatoire seulement.

La CI lance les tests de construction d'index dans un conteneur Mongo éphémère **dédié** sur27018, distinct des autres suites : le failpoint utilisé est global au daemon. Le test exige `enableTestCommands`, refuse un failpoint déjà actif et le désarme même si la réponse d'activation est perdue ; le runner arrête ensuite uniquement le conteneur qu'il a créé. Aucun de ces réglages ne concerne Railway ou une base métier.

Relevé local du 7 septembre : schémas de contrôle/fermeture **61/61**, paquet DB **269 verts/10 ignorés** hors passe Mongo dédiée ; immuabilité **54/54** sur Mongo. Nouveau store calendrier **57/57**, dont **49 scénarios Mongo réels** et8 gardes URI. Passe commune calendrier+grille+noyau+C01 **201/201**. Les réponses perdues, les deux connexions, les révisions concurrentes, le nettoyage d'une autre intention, le changement de bootstrap, les index absents et les historiques aux bornes Paris sont exercés. La CI est configurée pour exécuter ce store avec les autres recettes du socle, avant le RED runtime bloquant. **Ce RED a été rejoué localement : toujours2 commandes pour1 place** ; aucune assertion n'a été affaiblie et aucune activation n'est autorisée par les tests du store.

- Dernière place simultanée, collisions réelles sur les index, cuisine et livraison indépendantes sans fuite de place.
- Deux helpers du même candidat ; perte de réponse après write ; timeout avant write réellement retardé.
- Abandon avant CAS retardé, commit gagnant contre abandon, ancienne reprise après annulation/restitution et réattribution de la place.
- Calendrier absent/non prêt, index journée ou siège manquant, preuves/snapshot/créneau invalides, autre tenant.
- Restitution seulement après Order exact annulé, rejeu et réponse perdue, état de libération incohérent refusé.
- Validation des dates Paris, tailles et capacités, confidentialité et absence de TTL.

Commande du noyau (Node24 du dépôt) :

```sh
ORDER_CAPACITY_TEST_MONGO_URL=mongodb://127.0.0.1:27017/snackmanager_capacity_test_ci \
  pnpm --filter @sm/api exec vitest run src/modules/orders/order-capacity-commit.integration.test.ts
```

**Réception C15-B obligatoire avant de déclarer la survente corrigée** : le RED contrôleur devient vert ; mélange des trois writers ; seed ancien/hors horizon ; modification BO différée ; téléphone offline puis reprise ; refus avant encaissement ; annulation/helper tardif et disponibilités ; CI réelle puis recette staging. Les tests du noyau ne sont pas cette réception.

## Promotion et expiration — restent séparées

Le compteur promotionnel est actuellement réservé avant le snapshot puis compensé par décrément best-effort. Une interruption peut laisser un quota orphelin. La piste sans transaction est un intent d'opération dans l'admission **avant** effet, puis compteur et reçu dans une même écriture Promotion ; abandon confirmé ferme le reçu, y compris par tombstone avant une réservation retardée. Il faut gérer bornes/rotation de reçus, archivage au lieu de suppression physique et writers historiques. Cette piste n'est pas livrée par le toggle atomique.

La politique existante ne restitue pas automatiquement le quota d'une promotion lors de l'annulation d'une commande déjà créée ; aucun changement commercial implicite ici. L'expiration d'impayés, la réconciliation Stripe et le budget de paiement dans le créneau restent C05 : [note dédiée](RESERVATIONS-IMPAYEES.md).

## Diffusion

PR obligatoire vers `develop`, staging via le pipeline existant et preuve du SHA servi. C15-A ne change aucun parcours live et ne crée aucun calendrier réel. Avant activation C15-B, écrire le runbook d'arrêt des anciens writers/bootstrap/ouverture et la limite de rollback : un ancien binaire sans admission commune ne doit pas reprendre des commandes sur un calendrier actif. Production uniquement sur GO distinct.
