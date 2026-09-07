# C15 — capacité durable, protocole et preuves

7 septembre 2026. **Raccordement applicatif en cours de réception sur la PR123.**
Le scénario de survente après expiration Redis passe désormais sur Mongo réel :
une seule commande pour la dernière place. **Ce résultat local n'est pas une
activation métier, une fusion, ni une recette staging.** La diffusion sera
consignée avec le SHA effectivement servi.

## Périmètre

Un seul système de réservation pour les commandes portant un créneau :

- checkout public protégé par preuve de reprise C01 ;
- ancien checkout public, sans preuve de reprise C01 ;
- caisse et téléphone authentifiés, avec canal exact conservé.

Les ventes caisse sans créneau conservent leur parcours. La capacité ne livre
ni l'application livreur, ni l'expiration des impayés, ni les promotions
durables. Ces lots restent séparés dans le [registre](SUITE-APRES-COMMERCE.md).

## Invariant et stockage

MongoDB standalone reste supporté, sans infrastructure payante supplémentaire.
Une admission porte une place cuisine et, pour une livraison, une place
livraison. Les index uniques partiels `(tenantId, slot, seat)` arbitrent les
collisions entre toutes les répliques et tous les canaux.

Un seul CAS `validating + propriétaire + empreintes → committing` écrit
ensemble le snapshot validé, l'identité de commande et les places. La lecture
des places libres ne constitue jamais une réservation. Redis reste un contrôle
de contention/anti-abus : son expiration ne fait pas autorité sur la capacité.

Une réponse perdue ne prouve pas l'échec de l'écriture. Toute décision ambiguë
est relue sur primaire avec readConcern majority. Un résultat « complet » du
noyau ne libère la tentative qu'après CAS terminal `validating → rejected`.
Les inserts de journées/historique doivent transmettre le **writeConcern
imbriqué**, vérifié par command monitoring Mongo ; une assertion sur des
options locales ne suffit pas.

Un snapshot engagé est matérialisable par `$setOnInsert`, sans recalcul des
prix, nouveau numéro ou nouveau paiement. Une Order existante payée, annulée
ou remise n'est jamais remise à son ancien état. La reprise précède les
nouveaux contrôles de pause, fraîcheur, Turnstile et créneau plein.

L'abandon gagne avant committing, ou retrouve la commande gagnante. Une
tentative absente explicitement abandonnée laisse une identité terminale :
un POST retardé ne peut pas la recréer. Une lecture/reprise seule ne crée
pas ce marqueur.

Aucun TTL sur les admissions, les places ou les journées. Les empreintes,
snapshots, propriétaires de validation et places sont privés, retirés des
réponses et des événements publics.

## Restitution et annulation

Une place n'est restituée qu'après lecture primaire de **l'Order exacte**,
même tenant/clientId/orderId, définitivement `cancelled`. Le CAS retire
les numéros de place et inscrit une date de restitution. Il ne rouvre
jamais l'admission.

Un timeout de paiement, un remboursement localement observé, une commande
prête ou remise ne sont pas des preuves d'annulation. Une panne avant
restitution peut laisser une sous-capacité, jamais une place libérée par
supposition. La reprise idempotente répare la restitution confirmée.

## Calendrier, disponibilité et réglages BO

Le contrôle privé `Tenant.capacityControl` est absent par défaut. Les
états absent/seeding/blocked ferment les nouvelles réservations. Aucun
GET, scan ou démarrage de l'API n'active automatiquement un restaurant.

Une journée porte un plan Paris borné et une révision source. Elle commence
seeding, puis ready après vérification. Zéro créneau exige une fermeture
explicite, pas un faux créneau. Les horaires incohérents sont refusés ;
`24:00` n'est permis qu'en fin exclusive. La convention DST reste celle
du calendrier du restaurant.

Le premier vrai writer peut figer une nouvelle journée via une intention
sur le Tenant et sa révision. Des helpers reprennent **le même plan** après
panne. L'historique non rapproché empêche l'ouverture, sans suppression ni
plan alternatif opportuniste.

Horaires/fermetures, capacité/intervalle et réglages livraison passent par
le writer coordonné Tenant. Un PATCH ne remplace pas une intention et ne
réécrit pas une journée déjà figée. Ses effets concernent les journées
encore non initialisées. La pause web, l'identité et l'impression restent
indépendantes. Toute modification urgente d'une journée déjà ouverte exige
une opération dédiée de rapprochement, pas une édition native.

`SlotsService` lit désormais les admissions non restituées, y compris
committing, sans recompter l'Order matérialisée. Les bornes document/jour,
anomalies de sièges ou configurations corrompues ferment la lecture.
La grille n'est pas recalculée depuis les réglages courants quand elle est
déjà figée. Une consultation seule ne précrée pas quatorze journées.

La disponibilité staff ne dépend pas de la pause web. Le serveur doit
néanmoins refuser une nouvelle réservation passée, trop proche ou hors
horizon, et non se contenter des choix affichés par le POS. Une reprise
déjà engagée reste valable indépendamment de ces nouveaux contrôles.

## Bootstrap historique reprenable

Le lecteur natif reste strictement en lecture seule et borné. Il projette
les empreintes utiles, pas les coordonnées ou prix clients. Son rapport
reste `analysis_only`, `canActivate:false`, cohérence `non_atomic` :
un scan favorable n'est pas une autorisation de bascule.

L'application explicite sous exclusion des anciens writers :

1. Vérifie le tenant, la date Paris, les budgets, la génération UUID et le SHA
   du nouveau writer attesté. Aucun ancien binaire ne doit encore écrire.
2. Installe seeding par CAS d'absence, ou reprend exactement sa génération.
   Aucun retour active → seeding, reset, effacement ou rollback legacy.
3. Ferme les anciens validating par décision durable et matérialise les
   committing C01 sans changer preuve, prix, numéro ou jeton.
4. Importe tous les tickets non annulés à créneau depuis le début du jour
   Paris de bascule, **au-delà de l'horizon public si nécessaire**.
5. Crée une admission historical terminale pour un ticket ancien sans corps
   initial : lien exact Order, canal et sièges, sans preuve publique fabriquée.
   Une admission C01 existante conserve ses empreintes.
6. Répare seulement les restitutions appuyées par l'Order annulée exacte ;
   préserve les journées déjà figées, puis vérifie index et rapprochements.
7. Passe les journées ready et le contrôle active seulement après relecture
   complète. Chaque phase est reprenable après perte de réponse.

Surbooking, créneau hors grille, identités contradictoires ou budget dépassé
restent bloquants. Aucune vente n'est supprimée, arrondie, repricée ou
annulée pour obtenir un rapport vert. Les snapshots complets nécessaires
au matérialiseur ont aussi un budget BSON, avec curseur batchSize1.

L'attestation `writersStopped` n'est **pas un verrou distribué**. Vérifier
la révision servie et l'arrêt des anciens déploiements reste une opération
de release. Les anciennes files téléphone, notamment déjà encaissées,
doivent être inventoriées et rapprochées avant ouverture : ne jamais les
purger pour contourner un rejet.

La [procédure opérateur](BOOTSTRAP-CAPACITE-OPERATEUR.md) documente la CLI :
lecture seule par défaut, application réservée au staging avec génération
explicite, reprise après interruption et contrôles avant ouverture. Elle ne
certifie pas elle-même l'arrêt des anciennes répliques ou des files tablettes.

## Outils de maintenance

Le commit `8137037` isole seed, seed-orders, copie cible et purge aux bases
loopback jetables `snackmanager_disposable_<suffix>`, sans authentification
ou options arbitraires. Ils refusent tout contrôle/admission/calendrier C15,
y compris un contrôle null. Une source C15 n'est pas copiée comme une base
redémarrable. Les dumps restent des exports, pas des preuves de restauration.

Le wrapper Railway de reprises accepte une liste positive de backfills.
Le writer tracking exige l'application explicite et n'est pas relancé comme
un faux contrôle en lecture seule. Ces gardes ne constituent pas une
exclusion contre un administrateur Mongo : une restauration cohérente est
une opération séparée, avec rapprochement et anciens writers arrêtés.

## Téléphone : confirmation avant encaissement

Le POS propose les créneaux de l'API staff. Corps, tenant, UUID et version
du brouillon sont persistés avant POST sous vraie exclusion inter-onglets.
Pas de chemin simultané via la file offline. Sans réseau, aucune promesse
de réservation et aucun encaissement anticipé.

Le même corps est repris après timeout/404/4xx ; aucun nouvel UUID automatique.
Les états « à vérifier », rejet terminal et confirmation sont distincts.
Une reprise reçue répare le journal caisse avant archivage. Le ticket ouvert
dans un autre onglet n'est pas effacé sur simple égalité de contenu.

Le premier reçu est lié aux coordonnées/lignes/identité de la tentative,
avec les montants serveur faisant autorité. La confirmation initiale exige
counter/pending, puis l'encaissement utilise la commande existante et la
modale habituelle. Reprise d'un ticket déjà payé : aucun deuxième règlement.

La purge/désappairage ne doit effacer ni tentative incertaine ni encaissement
direct en cours. L'absence de Web Locks ferme ce parcours direct ; elle ne
fait pas passer un verrou mono-process pour une protection entre onglets.
Une recette Chromium ne vaut pas validation Safari, tablette physique ou TPE.

## Preuves de cette passe et diffusion

Preuves locales du raccordement, y compris le durcissement temporel staff :

- dernière place après expiration Redis : 7/7, dont scénario réel renforcé ;
- trois origines, replays, matérialisation et disponibilité : 31/31 ;
- bootstrap : 50/50, dont 42 scénarios Mongo et 8 gardes de cible ;
- passe Mongo consolidée : 405/405 sur dix fichiers, dont les gardes de cible
  et la CLI ; les gardes ne sont pas comptées comme des scénarios métier Mongo ;
- API : 2 472 tests réussis, 470 ignorés dans la passe sans variables de bases
  réelles ; les scénarios Mongo ci-dessus ont leur exécution dédiée explicite ;
- POS : 271 tests + 5 gardes build-terrain ; client-core : 128 ; contrats : 466 ;
- DB : 402 tests réussis, 10 ignorés hors passe Mongo dédiée ; notices BO : 30 ;
- gardes de maintenance : 62 tests DB et 16 exécutions Bash ;
- prix/fromages/promotions/livraison : 63 tests unitaires, sans présenter leur
  faux port de persistance comme une preuve de capacité ;
- huit scénarios navigateur POS et quatre BO, avec vrais composants et API
  simulée : confirmation/encaissement, réponse perdue, stockage indisponible,
  Web Locks absents, reprises inter-onglets et préservation des tickets modifiés ;
- compilation API et chargement CommonJS du module compilé ; aide CLI et refus
  explicite de son application en environnement production.

Les comptes de tests se recoupent entre passes : ne pas les additionner. Le
harnais POS portable est documenté dans [e2e/local](../../e2e/local/README.md) ;
il ne compile pas Expo et ne remplace ni le bundle servi ni un essai physique.
Les derniers changements doivent passer la CI sur leur propre SHA. Les preuves
distantes sont consignées sur la PR123 ; elles ne se déduisent pas de ces tests.

Préflight staging en lecture seule le 7 septembre : Classfood présente 2 115
Orders, quatre admissions, aucun contrôle ni calendrier ; trois occupations à
reprendre depuis le début du jour Paris et aucune anomalie dans le scan borné.
L'API servait encore `247d27a4c2cc0af4ff0194ee461c217b3f3792f1`, contrôlé par
`/health`. Rien n'a été importé ou activé. Ce scan non atomique devra être refait
sous exclusion avant bascule. L'inventaire des anciennes files téléphone des
tablettes et la recette authentifiée staging restent ouverts.

Réception requise : concurrence mixte, anciennes admissions/import hors
horizon, réponses perdues, BO et jours figés, téléphone hors réseau/reprise,
confirmation avant encaissement, annulation/restitution, CI, puis parcours
staging. Le scénario RED d'origine reste bloquant dans la CI ; ni skip,
ni continue-on-error, ni assertion de deux commandes attendues.

PR obligatoire vers develop, staging via le pipeline du dépôt et contrôle
du SHA servi. Avant activation, vérifier indexStats pour l'utilisateur Mongo
et arrêter les anciens writers. Après activation, **ne pas redéployer un
ancien binaire dépourvu d'admission commune**. En incident : fermer les
nouvelles réservations et rapprocher, sans effacer les engagements.

Production uniquement après recette staging et **GO distinct sur le lot exact**.

## Hors de C15

Les réservations de promotion restent compensées en best effort ; une panne
avant snapshot peut laisser un quota orphelin. C15 évite de restituer un quota
gagnant sur la seule base d'un timeout, mais ne livre pas un ledger promotionnel.
L'expiration/réconciliation des paiements et la politique de délai restent
[C05](RESERVATIONS-IMPAYEES.md). Aucune dépense SMS, commission réelle ou
promesse de livraison complète n'est ajoutée par ce lot.
