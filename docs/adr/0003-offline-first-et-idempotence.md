# ADR 0003 — Offline-first : file de mutations persistée et idempotence

| | |
|---|---|
| **Statut** | Acceptée |
| **Date** | 2026-08-19 |
| **Portée** | `packages/client-core`, `apps/pos`, `apps/kds`, `apps/api/src/modules/orders`, `packages/db` |
| **Documents liés** | [ARCHITECTURE.md §6](../../ARCHITECTURE.md), [ADR 0001](./0001-architecture-hexagonale-et-ddd.md) |

---

## 1 · Contexte : pourquoi c'est la contrainte numéro un

Un snack indépendant fait une part majeure de son chiffre d'affaires le vendredi et le
samedi soir, sur trois heures. Pendant ces trois heures, la caisse encaisse, la cuisine
sort les sacs, et le téléphone sonne. Si la box internet tombe — et elle tombe : ADSL de
zone rurale, box partagée avec la borne wifi client, coupure d'alimentation — deux
scénarios sont possibles.

**Le mauvais** : la caisse affiche une roue qui tourne, l'équipe passe au carnet papier,
et à la reconnexion il manque des commandes dans la caisse. Ce n'est pas une gêne
technique, c'est un trou de recette, un contrôle NF525 qui tourne mal, et un gérant qui
résilie.

**Celui qu'on veut** : personne ne remarque rien. La caisse continue d'encaisser, le KDS
continue d'afficher, l'imprimante continue de sortir des tickets. Au retour du réseau,
tout remonte, dans le bon ordre, sans doublon.

C'est **la** contrainte n° 1 du produit, avant la beauté des écrans, avant la richesse
fonctionnelle, avant le temps réel. Elle est écrite comme telle dans le README (« un
service du vendredi soir complet sans internet, zéro commande perdue ») et elle a déjà
dicté deux décisions structurantes en amont : le choix de REST plutôt que tRPC (une file
de requêtes HTTP se rejoue trivialement) et le stockage des prix en centimes côté serveur.

Une conséquence importante : **le réseau n'est pas un cas d'erreur, c'est l'état par
défaut**. Le code ne demande pas « ai-je du réseau ? » ; il écrit localement, puis tente.

---

## 2 · Décision

**Toute mutation passe par une file persistée sur l'appareil, portant une clé
d'idempotence `clientId`. Le serveur est idempotent sur cette clé. En cas de conflit de
statut, le statut le plus avancé gagne.**

Trois mécanismes complémentaires, chacun couvrant une classe de panne.

### 2.1 · La file de mutations — `packages/client-core/src/sync-queue.ts`

Toute écriture est **d'abord persistée**, ensuite tentée sur le réseau. L'appelant
n'attend jamais le réseau : `enqueue()` rend la main dès que l'entrée est écrite sur
disque, et l'interface fait sa mise à jour optimiste.

```
POS : envoi en cuisine
  → uuid()                            clientId, généré sur l'appareil
  → client.post('/orders', body,      persistée sous 'sm.sync.queue.v1'
                `order:${clientId}`)  ← le "sujet" de l'entrée
  → l'écran repart sur un ticket vide immédiatement
  ...
  → flush() toutes les 15 s et à chaque événement 'online' (useAutoSync)
```

Quatre invariants tiennent cette file :

1. **L'ordre d'émission est préservé.** Une commande est créée avant que son statut
   n'avance.
2. **Une entrée ne sort de la file qu'après confirmation du serveur** ou après un refus
   définitif — jamais sur une simple coupure.
3. **Un échec bloque les mutations suivantes du même sujet.** Le champ `subject`
   (`order:<clientId>`) regroupe les mutations d'un même objet : inutile d'envoyer
   « passer en préparation » pour une commande dont la création n'est pas encore passée.
   Les autres sujets continuent de partir.
4. **Une file corrompue ne bloque pas le service.** Si le JSON est illisible au
   chargement, on repart à vide plutôt que de planter la caisse en plein coup de feu.

Le stockage est abstrait (`KeyValueStore` dans `storage.ts`) : `AsyncStorage` sur
tablette, `localStorage` sur navigateur, mémoire en test. Le repli mémoire **avertit
explicitement** en console plutôt que d'échouer en silence — une file en mémoire ne
survit pas à un redémarrage, et c'est exactement le scénario qu'on refuse.

### 2.2 · La taxonomie des échecs — `packages/client-core/src/api.ts`

Rejouer aveuglément est aussi dangereux que ne pas rejouer. `sendQueued` classe :

| Situation | Décision | Pourquoi |
|---|---|---|
| `fetch` lève (réseau injoignable) | **on garde**, on rejouera | c'est le cas nominal du vendredi soir |
| 5xx, 429 | **on garde**, on rejouera | incident serveur temporaire |
| 401 | **on garde**, on rejouera après ré-authentification | le jeton staff a expiré, pas la commande |
| Autres 4xx | **on retire** (`PermanentError`) | produit supprimé, commande déjà servie : rejouer ne changera rien et bloquerait toute la file du sujet |

### 2.3 · L'idempotence côté serveur — `clientId`

Le `clientId` est un UUID v4 généré **sur l'appareil**, à la seconde où l'équipier touche
« Envoyer en cuisine » (`uuid()` dans `apps/pos/src/PosScreen.tsx`). Il voyage dans le
corps de la requête (`clientId: z.uuid()` dans `packages/contracts`) et il est la clé
d'idempotence de la création de commande.

Deux protections, à deux niveaux :

1. **Applicative** — `OrdersService.create` commence par
   `this.orders.findOne({ tenantId, clientId })` et **renvoie la commande existante** si
   elle est là. Un rejeu ne crée rien.
2. **Base** — `OrderSchema.index({ tenantId: 1, clientId: 1 }, { unique: true })` dans
   `packages/db/src/schemas.ts`. Si deux rejeux simultanés passent la vérification
   applicative en même temps, MongoDB en refuse un avec le code 11000, que le service
   rattrape pour renvoyer la commande gagnante.

La ceinture **et** les bretelles : la vérification applicative couvre le cas courant sans
coût, l'index unique couvre la course, qui arrive réellement quand une tablette et un pont
réseau rejouent la même file.

### 2.4 · La règle de réconciliation : le statut le plus avancé gagne

Le cas réel : la box tombe en plein coup de feu. La tablette cuisine continue de marquer
« prête », la caisse continue d'encaisser, et chacune rejoue sa file au retour du réseau,
**dans le désordre**. Rejouer bêtement ferait reculer la commande sous les yeux de
l'équipe.

L'avancement est donc un ordre total : `new (0) < preparing (1) < ready (2) < delivered (3)`.
En cas de conflit, on garde le maximum.

**Deux exceptions, dictées par le comptoir et non par la théorie** — elles sont codées et
testées dans `packages/domain/src/ordering/order-status.ts::mostAdvanced` :

- **Une annulation bat n'importe quelle étape en cours.** Quelqu'un a physiquement décidé
  de ne pas servir : une décision humaine prime sur un automatisme.
- **Mais elle ne bat pas `delivered`.** Le plat est parti, l'argent est encaissé. Effacer
  la commande du chiffre d'affaires serait un trou de caisse. Une correction passe par un
  remboursement tracé, pas par un retour en arrière.

C'est pour cette raison que `cancelled` **ne figure pas** dans la table d'avancement
`PROGRESS` du domaine : ce n'est pas une étape de plus, c'est une sortie de piste. La
ranger « après livrée » ferait gagner l'annulation contre une commande déjà partie.

Deux méthodes distinctes exposent cette règle sur l'entité `Order` :

- `advanceTo(status)` — chemin nominal, respecte la machine à états
  (`new → preparing → ready → delivered`, annulation possible tant que rien n'est servi).
  Rejouer le statut courant ne fait rien et **ne double pas l'historique** : la file
  renvoie régulièrement deux fois le même événement.
- `reconcile(observed)` — retour de réseau. On ne rejoue pas la chaîne : la tablette
  cuisine hors ligne a réellement servi la commande, on **constate le fait** au lieu de le
  refuser au motif qu'on n'a pas vu passer l'étape intermédiaire.

---

## 3 · Options écartées

### 3.1 · Attendre le réseau (comportement par défaut d'un client HTTP)

**Pourquoi non** : c'est exactement le scénario « mauvais » du §1. Aucune discussion.

### 3.2 · Idempotence par hash du contenu de la commande

**Pourquoi c'était tentant** : pas de clé à générer, pas de champ à transporter.

**Pourquoi non** : deux clients peuvent légitimement commander exactement la même chose à
deux secondes d'intervalle (deux tacos M kebab au comptoir, un vendredi). Un hash de
contenu fusionnerait ces deux commandes en une seule. Le `clientId` distingue l'**acte de
commander**, pas le contenu — c'est la bonne granularité.

### 3.3 · CRDT ou base répliquée (PouchDB/CouchDB, Yjs, Automerge)

**Pourquoi c'était tentant** : la réconciliation devient un problème résolu par la
bibliothèque, y compris en multi-appareils.

**Pourquoi non** : les conflits qu'on doit résoudre ne sont pas structurels, ils sont
**métier**. « L'annulation bat `preparing` mais pas `delivered` » n'est dérivable d'aucune
sémantique de fusion générique — c'est une décision de gestion, prise avec le gérant. Une
règle de six lignes, testée, lisible par n'importe qui, vaut mieux qu'un moteur de fusion
qu'il faudrait de toute façon configurer pour obtenir le même résultat. S'ajoute le coût
d'un second système de persistance sur des tablettes d'entrée de gamme.

### 3.4 · Horloge vectorielle / `updatedAt` du dernier écrivain (last-write-wins)

**Pourquoi non** : les horloges des tablettes dérivent, et surtout la dernière écriture
n'est pas la bonne. Une caisse qui rejoue « nouvelle commande » après que la cuisine a
marqué « prête » ferait reculer le ticket. C'est **l'avancement métier** qui arbitre, pas
le temps.

### 3.5 · Une file par appareil côté serveur (inbox pattern)

**Pourquoi non** : ça déplace le problème sans le résoudre — il faudrait toujours une clé
d'idempotence pour dédoublonner à l'entrée de l'inbox, et on aurait en plus une collection
et un worker à opérer.

---

## 4 · Conséquences

### 4.1 · Ce que ça impose au reste du système

- **Le prix n'est jamais celui du client.** `packages/client-core/src/pricing.ts` calcule
  un prix **d'affichage** pour que le POS fonctionne hors ligne ; le serveur recalcule
  tout à la création (`OrdersService.create`) et fait autorité. Un panier local modifié
  n'obtient rien. Le commentaire en tête de `pricing.ts` le dit explicitement, et il doit
  y rester.
- **Le numéro d'appel est attribué par le serveur.** La séquence journalière par tenant
  (`counters`, `_id: '<tenantId>:<yyyymmdd>'`, `$inc` atomique) ne peut pas être générée
  hors ligne sans risque de collision. Le POS affiche donc un **numéro local provisoire**
  (`nextLocalNumber` dans `PosScreen.tsx`) jusqu'à ce que le serveur réponde, et
  réconcilie ensuite par `clientId`.
- **Les lectures ont un cache de repli.** `SmClient.get` écrit chaque réponse sous
  `sm.cache.*` et sert le cache si le réseau échoue : la carte reste consultable, donc la
  caisse reste utilisable.
- **Toute route de mutation doit être rejouable.** Une nouvelle route `POST` ou `PATCH`
  appelée depuis le POS ou le KDS **doit** être idempotente, sans quoi elle produira des
  doublons au premier vendredi soir agité. C'est un point de revue de code obligatoire.

### 4.2 · Écarts connus entre l'intention et le code (à corriger)

Ce document ne sert à rien s'il décrit un système idéal. Voici l'état réel.

**a) Deux tables de rang qui ne classent pas `cancelled` pareil.**
Trois implémentations de la règle « le plus avancé gagne » coexistent :

| Où | Table | `cancelled` |
|---|---|---|
| `packages/domain/src/ordering/order-status.ts` | `PROGRESS` + `mostAdvanced` | **exclu** de l'avancement, arbitré par deux règles explicites |
| `packages/contracts/src/index.ts` | `ORDER_STATUS_RANK` | rang **4**, au-dessus de `delivered` (3) |
| `packages/client-core/src/types.ts` | `STATUS_RANK` | rang **4**, au-dessus de `delivered` (3) |

Côté serveur, `OrdersService.updateStatus` est protégé par un garde explicite
(`if (current === 'delivered' || current === 'cancelled') return order`), donc le
comportement est correct. Côté client, `mergeOrder` (`client-core/src/hooks.ts`) n'a pas
ce garde : une annulation en retard peut faire afficher « annulée » une commande déjà
servie. L'effet est un affichage faux, pas une perte de recette — mais c'est exactement le
type de divergence que [l'ADR 0001](./0001-architecture-hexagonale-et-ddd.md) cherche à
supprimer. **Correctif** : faire consommer `mostAdvanced` du domaine par `mergeOrder` et
par `updateStatus`, et supprimer les deux tables dupliquées.

**b) L'impression hors ligne n'est pas encore hors ligne.**
L'encodeur ESC/POS (`apps/api/src/modules/ordering/escpos.ts`) est **pur** — il produit un
`Buffer`, il ne fait aucune I/O — mais il vit côté API et n'est exposé que par une route
HTTP (`GET /public/orders/:id/escpos`). Une tablette sans réseau ne peut donc pas
imprimer, alors que l'impression locale est précisément ce qui fait tenir un service.

Le port `packages/domain/src/ports/ticket-printer.ts` existe désormais et décrit **ce qui
doit figurer** sur un ticket (la ligne annulée visible avec son motif pour NF525, le numéro
de retrait en gros, le « sans oignons » lisible du plan de travail) indépendamment de
l'imprimante. **Correctif restant** : écrire l'adaptateur ESC/POS de ce port dans un
paquet partagé consommable par `apps/pos`, l'API n'en devenant qu'un appelant parmi
d'autres.

**c) La file n'a ni plafond ni péremption.**
`sync-queue.ts` réécrit l'intégralité du JSON à chaque `persist()`. À l'échelle réelle
(quelques dizaines d'entrées sur un service coupé), c'est sans conséquence. À 500 entrées
— tablette oubliée hors ligne une semaine — l'écriture devient coûteuse et rien ne purge
les entrées anciennes. **Correctif** : un plafond de taille et un âge maximal, avec une
alerte visible dans la barre haute plutôt qu'un abandon silencieux.

**d) Un refus 4xx retire l'entrée sans autre trace que `lastError`.**
C'est le comportement voulu (ne pas bloquer le service pour une commande que le serveur
refusera toujours), mais l'information ne remonte aujourd'hui que dans l'état de la file.
Le journal local du POS (`dayLog`) conserve la trace de l'encaissement, donc rien n'est
perdu comptablement. **Correctif** : une liste « refusées » consultable, avec le motif.

### 4.3 · Bénéfices

- Un service complet sans internet, sans que l'équipe ait à changer quoi que ce soit à sa
  façon de travailler.
- Le rejeu est trivialement testable : une file de requêtes HTTP est du JSON, on peut
  l'inspecter, la rejouer à la main, la reproduire dans un test.
- L'idempotence protège aussi des cas non-offline : double-tap sur un bouton, retry d'un
  proxy, redémarrage d'un pod pendant une requête.

### 4.4 · Coûts

- Chaque nouvelle mutation doit être pensée idempotente. Ce n'est pas gratuit et ça se
  vérifie en revue.
- L'interface doit assumer deux vérités temporaires (numéro local vs numéro serveur, état
  optimiste vs état confirmé) et les montrer honnêtement à l'équipe (badge « N en
  attente », alimenté par `useSyncState`).
- Les tests de bout en bout doivent inclure des scénarios de coupure, sinon la régression
  passe.

---

## 5 · Ce qu'un développeur doit retenir

1. **On écrit sur disque, puis on tente le réseau.** Jamais l'inverse. Passez par
   `client.post/patch/...`, jamais par `fetch` directement pour une mutation.
2. **Une mutation depuis le POS ou le KDS porte une clé d'idempotence** et la route
   serveur correspondante doit être rejouable sans effet de bord.
3. **Le statut le plus avancé gagne** — sauf `delivered`, que rien ne bat, pas même une
   annulation.
4. **Le prix affiché hors ligne est une estimation.** Le montant qui compte est celui que
   le serveur recalcule.

---

## 6 · Comment on saura qu'on s'est trompé

- **Un doublon de commande observé en production** → l'idempotence a une faille ; vérifier
  d'abord que la route incriminée passe bien par la file et porte bien un `clientId`.
- **Une commande servie qui repasse en « annulée »** ou un ticket qui recule à l'écran →
  la règle de réconciliation a été contournée quelque part (cf. §4.2 a).
- **Une file qui ne se vide plus** sur une tablette → un sujet bloqué par une entrée dont
  l'erreur n'est pas classée correctement ; revoir la taxonomie du §2.2.
- **Un équipier qui ressort le carnet papier** → le seul indicateur qui compte vraiment.
