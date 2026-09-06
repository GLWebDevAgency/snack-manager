# C01 — reprendre une commande sans la dupliquer

Lot de la [suite opérationnelle](SUITE-APRES-COMMERCE.md), distinct du
[protocole de paiement](PAIEMENTS-ANNULATION-DURABLE.md). Une commande enregistrée
n'est pas nécessairement payée. Le navigateur ne déduit jamais un encaissement
d'un reçu local, d'une intention Stripe ou d'une fermeture de tentative.

## 1. Identité et stockage navigateur

Avant tout POST réel, une transaction IndexedDB en durabilité `strict` enregistre
un UUID v4, une preuve CSPRNG de 32 octets, le corps métier figé et un digest SHA-256
du panier. Une ligne active par restaurant et origine arbitre les onglets.
Seule la fin de la transaction autorise l'envoi ; ni `put.onsuccess`, ni une
erreur de stockage n'autorisent un repli en mémoire.

- `prepared`/`uncertain` : même UUID, même preuve et même corps sur chaque rejeu.
  Le challenge Turnstile est renouvelé mais jamais persisté.
- `received` : reçu minimal de navigation, enregistré **avant** de nettoyer le
  panier correspondant. Coordonnées, adresse, note et preuve de tentative sont
  supprimées de cette ligne. L'état financier est relu sur le suivi.
- `rejected` : uniquement après réponse de reprise/fermeture validée côté serveur.
  Le client peut alors corriger son panier et demander une nouvelle tentative.
- « Préparer une nouvelle commande » archive un reçu confirmé ; le dernier lien
  reste accessible même avec un panier vide. Ce n'est pas l'historique client L3.

Le panier v1 conserve son format et son TTL de 12 h. Ses écritures explicites
partagent un Web Lock par restaurant ; la vidange compare l'état mémoire et
persisté sous ce même verrou. Un panier divergent est relu et préservé.
Il n'existe plus d'effet React réécrivant un ancien rendu dans le stockage.

Limites : effacement/éviction des données navigateur, changement d'origine ou
d'appareil et ancien onglet exécutant encore l'ancien code ne sont pas une
garantie de reprise. Le stockage reste accessible au JavaScript de cette origine,
pas chiffré contre une compromission XSS. Sans IndexedDB strict/Web Locks utilisables,
le client reçoit une erreur explicite ; aucun nouvel envoi incertain n'est créé.
Les tentatives incertaines ne sont jamais réinitialisées par un TTL local.

## 2. Admission serveur avant création

Le journal `public_order_admissions` lie tenant, UUID, hash de preuve et empreinte
du corps. La preuve brute n'est pas stockée ; hashes, propriétaire de validation
et snapshot sont privés. Aucun téléphone, identifiant Mongo ou QR fidélité ne
remplace cette preuve.

| État | Transition autorisée | Conséquence |
| --- | --- | --- |
| `validating` | CAS propriétaire vers `committing`, ou CAS vers `rejected` | Un seul validateur réserve les ressources. Une fermeture gagnante interdit toute création retardée. |
| `committing` | Insertion seule du snapshot calculé, puis `created` | Plus de refus métier ni d'abandon : toute reprise aide la même insertion, avec le même ID/numéro/prix. |
| `created` | Lecture de la commande confirmée | Snapshot détaillé purgé ; clé/hash/ID conservés. Aucun rejeu ne remet une commande payée/livrée à son ancien état. |
| `rejected` | Lecture du refus terminal | Clé fermée sans TTL ; une nouvelle demande explicite prend un nouvel UUID. |

Les écritures structurantes utilisent majorité + journal Mongo. Une réponse
perdue n'est pas une preuve d'échec : la lecture primaire/majorité décide.
Les snapshots engagés du créneau sont matérialisés avant le nouveau comptage
sous le verrou de créneau. Une matérialisation impossible ferme l'admission.
Les aides ne rappellent ni tarification, promotion, numérotation ni paiement.

## 3. Frontières publiques

- `POST /public/tenants/:slug/orders` garde sa réponse historique complète.
  Les nouveaux clients fournissent `recoveryProof`. Pour une commande protégée,
  tous les replays exigent preuve **et** corps identiques. Les anciens clients
  sans preuve restent compatibles mais ne récupèrent pas une nouvelle commande
  protégée ; une commande historique n'est jamais adoptée a posteriori.
- `POST …/orders/recovery` reçoit UUID + preuve, retourne `created`, `pending`
  ou `rejected`. `created` porte un reçu minimal, pas les coordonnées ni les lignes.
- `POST …/orders/abandon` reçoit la tentative figée et ferme uniquement une
  admission non engagée. Si la création a gagné, il rend le suivi existant.
  Ce n'est ni une annulation de commande ni un remboursement.

Les routes de reprise sont `no-store`, limitées par quotas partagés source/global
et par tentative, et restent utilisables après pause/retrait d'offre ou expiration
du créneau. Une création véritablement nouvelle conserve les contrôles d'offre,
créneau, disponibilité, prix et Turnstile. Redis indisponible échoue fermé.
Un `404` de reprise est non terminal : il ne prouve pas qu'un ancien POST en vol
n'écrira jamais. Le frontend valide l'union de réponse à l'exécution avant libération.

## 4. Vérification et limites restantes

Tests natifs IndexedDB/Web Locks, harnais Next `e2e/local/checkout-recovery.mjs`,
tests de contrat et suite Mongo dédiée
`public-order-admission.integration.test.ts`. La CI installe Chromium et exécute
explicitement cette suite Mongo ; une exécution générale ignorant Mongo n'est
pas une preuve suffisante. Les prestataires sont simulés dans les recettes locales.

Restent hors garantie C01 : atomicité globale des créneaux face à un ancien verrou
Redis expirant pendant une suspension longue ; rapprochement d'une promotion
réservée avant un crash pré-snapshot ou une issue CAS inconnue suivie d'abandon
sans validateur vivant pour compenser ; worker général de réparation ;
Safari/appareils physiques ; fermeture métier des commandes abandonnées après
acceptation. Ces sujets ne sont ni corrigés ni certifiés par la reprise du navigateur.

Cas de réception C15 à conserver : réserver une promotion, simuler un CAS
`committing` dont l'issue reste inconnue, fermer ensuite la tentative par un rejet
durable sans validateur vivant, puis rapprocher **exactement une fois** cette
réservation. Un simple décrément après lecture `validating` serait incorrect :
le CAS retardé pourrait encore gagner. Cette réparation reste à implémenter.

Livraison par PR vers `develop`, vérification du SHA réellement servi sur staging,
puis recette. Production uniquement après GO distinct. Aucun SMS ou débit bancaire
réel n'est requis pour cette livraison.

## 5. Première bascule C01 et retour arrière

**Une ancienne API ne doit pas coexister avec la nouvelle dès qu'une admission
C01 peut être écrite.** Elle ignore les admissions rejetées et la preuve de
possession. Le seul statut `SUCCESS` de la nouvelle API n'atteste pas le retrait
des anciens processus. La compatibilité des anciens clients avec la nouvelle
API ne rend pas sûr le mélange des deux versions d'API.

Pour la première livraison staging, après CI verte et revue :

1. Vérifier les PR, la tête de `develop`, la cible Railway explicitement
   `staging` et l'inventaire de tous les déploiements API. Relever l'ID actif.
2. Prévoir une interruption de l'API staging, arrêter uniquement l'ancien
   déploiement API, puis constater son état `REMOVED` et l'absence de tout autre
   ancien déploiement actif. Ne supprimer ni service, ni base, ni données.
3. Fusionner le SHA revu par PR vers `develop`. Laisser le workflow habituel
   vérifier, migrer et déployer API puis interfaces ; aucun téléversement manuel
   du worktree. Le préflight ne requiert pas une API vivante : il lit les
   déploiements et la configuration ; les migrations PostgreSQL restent dans
   le runner avec leur identité dédiée.
4. Vérifier le SHA servi, les quatre services, les index
   `public_order_admissions` (`_id`, tenant/client unique, tenant/créneau/état),
   puis le smoke et une recette de reprise. La santé HTTP seule ne prouve pas
   l'existence des index Mongo.

Une fois C01 utilisé, **ne pas restaurer une API ni un checkout pré-C01 en
laissant la commande ouverte**. L'ancien serveur ignore les tombstones ;
l'ancien navigateur ignore le journal et peut générer un autre UUID depuis un
panier incertain. En cas d'incident, fermer les nouvelles opérations et corriger
en avant. Ne pas purger les admissions ou les journaux pour faciliter un retour
arrière. Les anciens onglets encore ouverts restent la limite documentée au § 1.

Cette fenêtre staging n'autorise aucune interruption ou promotion production :
sa première bascule nécessite une recette et un GO dédiés.
