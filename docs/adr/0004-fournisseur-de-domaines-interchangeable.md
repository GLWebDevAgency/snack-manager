# ADR 0004 — Fournisseur de domaines interchangeable : port `DomainRegistrar`

| | |
|---|---|
| **Statut** | Acceptée |
| **Date** | 2026-08-19 |
| **Portée** | `packages/domain/src/ports/domain-registrar.ts`, `packages/domain/src/tenancy/public-domain.ts`, `packages/db/src/schemas.ts` (`tenants.domains`), `apps/web/src/proxy.ts` |
| **Documents liés** | [ADR 0001](./0001-architecture-hexagonale-et-ddd.md), [ARCHITECTURE.md §8](../../ARCHITECTURE.md) |

---

## 1 · Contexte

Snack Manager est une suite en **marque grise** : chaque restaurant a son nom, son logo,
sa couleur d'accent — et son adresse. Trois formes d'adresse mènent aujourd'hui au même
site public (cf. l'en-tête de `apps/web/src/proxy.ts`) :

| Forme | Exemple | Qui la fournit |
|---|---|---|
| **URL canonique** | `snackmanager.fr/r/classfood` | nous, toujours disponible |
| **Sous-domaine plateforme** | `classfood.snackmanager.fr` | nous, sans aucune action du restaurateur (`TenantSlug.defaultDomain`) |
| **Domaine personnalisé** | `commander.classfood.fr` | le restaurateur, qui possède déjà son nom de domaine |

Les deux premières ne coûtent rien et ne dépendent que de nous : un enregistrement
wildcard et un certificat wildcard couvrent tout `*.snackmanager.fr`. **La troisième est
le sujet de cette ADR.** Elle dépend d'un tiers — la zone DNS du client — et d'un
fournisseur qui doit accepter le nom, émettre un certificat TLS et router le trafic.

C'est aussi un argument commercial fort. Un restaurateur qui a déjà payé son domaine ne
veut pas envoyer ses clients sur une adresse qui porte le nom de son prestataire. Sur le
plan technique, c'est en revanche la brique la plus volatile de toute l'infrastructure :
elle a une limite de volume, un modèle de tarification, un délai de provisionnement et
une API propriétaire — quatre choses qui changent sans nous prévenir.

Autrement dit : **le métier sait qu'un restaurant peut avoir une adresse à lui ; il n'a
aucune raison de savoir qui l'héberge.** C'est le cas d'école des ports & adaptateurs.

---

## 2 · Décision

**Le domaine déclare un port `DomainRegistrar`. Railway est l'adaptateur d'aujourd'hui ;
Cloudflare for SaaS prendra le relais au-delà d'un parc d'environ 100 domaines
personnalisés, selon les seuils chiffrés du §3.**

### 2.1 · Le port

`packages/domain/src/ports/domain-registrar.ts` — quatre membres, pas un de plus :

```ts
export interface DomainRegistrar {
  readonly providerName: string;                                  // journalisation, écran d'admin
  register(domain: PublicDomain): Promise<DomainRegistration>;    // → { domain, target, status, providerId }
  check(providerId: string): Promise<DomainCheck>;                // DNS posé ? certificat émis ?
  release(providerId: string): Promise<void>;                     // résiliation, changement d'adresse
}
```

Le cycle de vie est exprimé en termes métier, pas en termes de fournisseur :

```
  pending_dns  ──►  issuing_certificate  ──►  active
   (le client       (DNS correct, TLS         (opérationnel)
    n'a pas          en cours d'émission)
    posé son
    CNAME)
       └──────────────────────────────────►  failed  (DNS jamais posé, conflit)
```

Ces quatre états sont ceux que **l'interface du back-office** doit afficher au
restaurateur (« Posez ce CNAME », « Certificat en cours, revenez dans dix minutes »,
« En ligne », « Échec : ce domaine est déjà utilisé ailleurs »). Ils se projettent sur
Railway comme sur Cloudflare, parce qu'ils décrivent le problème du restaurateur, pas
l'API du fournisseur.

Deux éléments rendent la bascule possible :

- **`providerId`** — l'identifiant chez le fournisseur, sans lequel on ne sait plus ni
  interroger l'état, ni détacher. Il est déjà persisté par domaine dans
  `packages/db/src/schemas.ts` (`tenants.domains[].providerId`), avec `status`, `target`,
  `lastCheckedAt` et `detail`.
- **`providerName`** — pour qu'un écran d'administration et le journal puissent dire chez
  qui vit chaque domaine.

> Ce que ces deux champs ne suffisent **pas** à faire, en l'état : une migration domaine
> par domaine. Le choix de l'adaptateur est global à l'instance (cf. §5.3).

### 2.2 · L'adaptateur d'aujourd'hui : Railway

Tout le back-end vit déjà sur Railway (directive fondateur du 2026-08-18, cf.
[ARCHITECTURE.md §8](../../ARCHITECTURE.md)). Rattacher un domaine personnalisé au service
`web` s'y fait par API, avec certificat TLS automatique. Zéro coût marginal, zéro
composant supplémentaire à opérer, zéro compte de plus à gérer.

Pour un pilote et les premières dizaines de clients, c'est le bon choix : **on ne paie pas
la complexité d'un second fournisseur pour un besoin qu'on n'a pas encore.**

### 2.3 · L'adaptateur d'après : Cloudflare for SaaS

Cloudflare for SaaS (« custom hostnames ») est conçu exactement pour ce cas : un
fournisseur SaaS qui doit servir des milliers de domaines appartenant à ses clients, avec
émission et renouvellement de certificats automatiques, et une API de provisionnement
faite pour ça.

**Tarification retenue pour le calcul** : 100 hostnames personnalisés inclus, puis
**0,10 $ par hostname et par mois**.

> ⚠️ Ces chiffres — comme la gratuité et les limites de volume côté Railway — sont ceux
> connus à la date de cette ADR. Ils doivent être **revérifiés chez les deux fournisseurs
> au moment de la décision de bascule** : c'est précisément parce que ce genre de
> paramètre bouge sans nous prévenir que la dépendance est derrière un port.

---

## 3 · Le critère de bascule, chiffré

### 3.1 · Ce que coûte l'attente, en euros

L'unité qui compte n'est pas le nombre de clients mais le **nombre de domaines
personnalisés rattachés** : un restaurant qui se contente de `classfood.snackmanager.fr`
ne consomme aucun hostname.

| Domaines personnalisés | Railway | Cloudflare for SaaS | Surcoût mensuel |
|---:|---:|---:|---:|
| 25 | 0 | 0 $ (inclus) | 0 $ |
| 100 | 0 | 0 $ (inclus) | 0 $ |
| 150 | 0 | 5 $ | 5 $ |
| 300 | 0 | 20 $ | 20 $ |
| 1 000 | 0 | 90 $ | 90 $ |

Mise en regard du modèle : le MRR de référence est de **139 €/mois par client**
(`docs/specs/contraintes-business.md §6`). À 300 clients, le MRR est de l'ordre de
41 700 €/mois ; les 20 $ de hostnames en représentent **0,05 %**. Ramené à l'unité, un
domaine personnalisé coûte **0,10 $/mois pour un abonnement à 139 €/mois**, soit 0,07 %.

**Conclusion : le coût n'est pas, et ne sera jamais, le critère de bascule.** Le critère
est opérationnel.

### 3.2 · Les trois seuils qui déclenchent la bascule

On bascule dès qu'**un seul** de ces seuils est franchi. Les trois se mesurent, sans avis
ni débat.

| # | Seuil | Valeur de déclenchement | Où le mesurer |
|---|---|---|---|
| **1** | **Volume** | **> 80 domaines personnalisés** rattachés et actifs | `db.tenants.aggregate` sur `domains[].status = 'active'` |
| **2** | **Délai / fiabilité** | délai médian « CNAME posé → `active` » **> 15 min**, ou **> 5 %** de `failed` sur un trimestre | `domains[].addedAt` vs `lastCheckedAt`, et le compte des `status = 'failed'` |
| **3** | **Opération** | **> 1 intervention manuelle par mois** pour rattacher, débloquer ou détacher un domaine | journal d'incidents |

**Pourquoi 80 et non 100** : la franchise Cloudflare est de 100 hostnames. Basculer à 80,
c'est migrer *avant* d'avoir un besoin urgent, avec une marge de 20 domaines pour faire la
migration progressivement, domaine par domaine, et sans que la facture démarre pendant la
transition. Migrer à 100 sous contrainte, c'est migrer un vendredi soir — ce qui est
interdit par la règle maison.

**Revue trimestrielle** : les trois indicateurs sont relevés chaque trimestre. Tant
qu'aucun n'est franchi, on ne fait rien, et c'est la bonne décision.

---

## 4 · Options écartées

### 4.1 · Basculer sur Cloudflare for SaaS tout de suite

**Pourquoi c'était tentant** : ne pas avoir à migrer plus tard, et disposer dès le départ
de l'outil conçu pour ce problème.

**Pourquoi non** : cela ajoute un compte, une zone, une origine de repli (*fallback
origin*), une clé d'API, une validation de hostname et un composant de plus à surveiller —
pour **un seul client pilote**, qui n'a même pas encore de domaine personnalisé rattaché.
La complexité se paie tous les jours ; le bénéfice n'arriverait qu'au centième client.

### 4.2 · DNS et certificat wildcard uniquement (pas de domaine personnalisé du tout)

**Pourquoi c'était tentant** : un enregistrement `*.snackmanager.fr`, un certificat
wildcard, plus aucun provisionnement par client. Coût nul, complexité nulle.

**Pourquoi non** : un wildcard ne couvre que **nos** sous-domaines. Il ne peut rien pour
`commander.classfood.fr`, qui appartient au restaurateur. Ce n'est donc pas une
alternative mais un **complément** : c'est exactement ce qu'on fait déjà pour les deux
premières formes d'adresse du §1, et c'est ce qui permet de repousser la question du
registrar aussi longtemps.

### 4.3 · Coupler directement l'API Railway dans le service, sans port

**Pourquoi c'était tentant** : moins de code, et une abstraction écrite avant d'avoir deux
implémentations est un anti-pattern classique.

**Pourquoi non, et à quelle condition** : l'objection est juste et mérite d'être prise au
sérieux — c'est même le cas où [l'ADR 0001](./0001-architecture-hexagonale-et-ddd.md)
mettrait normalement en garde contre l'abstraction prématurée. Ce qui la rend acceptable
ici, c'est que l'interface n'a **pas** été inventée : elle a été dérivée de la forme
commune aux deux fournisseurs déjà étudiés — déclarer un hostname, recevoir une cible
CNAME, interroger un état, détacher. Ce n'est pas une abstraction spéculative, c'est le
plus petit dénominateur de deux modèles réels.

**Le jour où elle serait fausse** : un fournisseur qui exigerait une délégation `NS`
complète ou une validation ACME DNS-01 déléguée n'entrerait pas dans ce moule. Le port
changerait alors — ce qui reste peu coûteux tant qu'il n'a qu'un seul consommateur.

### 4.4 · Laisser le restaurateur gérer son propre reverse proxy

**Pourquoi non** : un gérant de fast-food n'administre pas un proxy. Chaque minute passée
à expliquer un `proxy_pass` est une minute qui aurait dû servir à parler de tacos.

---

## 5 · Conséquences

### 5.1 · Positives

- Le métier ne connaît aucun fournisseur. `PublicDomain` valide un nom, `Restaurant`
  sait en rattacher un (`attachDomain`, qui refuse un doublon) et sait répondre à
  « quelle adresse afficher ? » (`primaryDomain`, qui retombe sur le sous-domaine
  plateforme si aucun domaine personnalisé n'est rattaché). Aucun de ces fichiers ne
  changera lors de la bascule.
- La migration peut être **progressive** : `providerId` est stocké par domaine, donc les
  deux adaptateurs peuvent coexister pendant la transition.
- Le port est testable sans réseau : un `FakeRegistrar` en mémoire permet de tester les
  quatre états du cycle de vie, y compris `failed`, ce qu'aucune API réelle ne rendrait
  simple.

### 5.2 · État réel : la décision est implémentée

Contrairement à ce qu'annonçait la première rédaction de cette ADR, **les deux adaptateurs
existent déjà** :

```
packages/domain/src/ports/domain-registrar.ts      le port
apps/api/src/infrastructure/domains/
    railway-domain-registrar.ts                    adaptateur Railway
    cloudflare-domain-registrar.ts                 adaptateur Cloudflare for SaaS
    disabled-domain-registrar.ts                   « pas de domaine personnalisé »
    domain-registrar.factory.ts                    LE point de bascule
apps/api/src/modules/site/*.usecase.ts             les cas d'usage, qui ne connaissent
                                                   que le port
```

Deux propriétés de la fabrique méritent d'être connues avant d'y toucher :

- **La bascule est une variable d'environnement.** `DOMAIN_PROVIDER=railway | cloudflare |
  null` (absente = `null`). Passer de l'un à l'autre est un redéploiement, pas une
  migration — ce qui rend le §3 d'autant plus utile : la question n'est plus « comment
  basculer ? » mais « **quand** ? ».
- **La fabrique ne lève jamais.** Une configuration incomplète journalise les variables
  manquantes et retombe sur un registrar dégradé qui répond « indisponible ». Une API qui
  refuserait de démarrer parce qu'un jeton Cloudflare a expiré, c'est une caisse morte
  pour une option que personne n'utilise ce soir-là.

### 5.3 · Ce qui manque encore

- **La bascule est globale, pas progressive.** `DOMAIN_PROVIDER` choisit **un** adaptateur
  pour toute l'instance ; le sous-schéma `tenants.domains` porte `providerId` mais aucun
  champ `provider`. Une migration se fera donc en bascule sèche (re-`register` de tous les
  domaines chez le nouveau fournisseur), pas domaine par domaine comme l'envisageait le
  §2.1. **À décider** : ajouter le champ `provider` (trivial aujourd'hui, coûteux une fois
  des domaines en production) ou assumer la bascule sèche et écrire le script de
  re-rattachement.
- **Le rafraîchissement d'état est manuel.** Le cas d'usage `CheckDomainStatus` et la route
  `POST /site/domains/:id/check` existent — c'est le bouton « Vérifier maintenant », qui
  interroge le fournisseur en direct et invalide le cache de résolution. Mais **aucune
  tâche de fond** n'appelle `check()` : un domaine dont le CNAME a été posé pendant la nuit
  restera affiché `pending_dns` jusqu'à ce que quelqu'un clique.
- **Le front n'utilise pas encore la résolution déclarative.** L'API expose désormais
  `GET /public/resolve` (`ResolveTenantByHost`), mais `apps/web/src/proxy.ts` continue de
  déduire le tenant en supposant que l'étiquette du domaine correspond au `slug`
  (`laclassfood.fr` → slug `laclassfood`). Tant que le proxy n'appelle pas cette route, la
  convention de nommage reste imposée aux clients.
- **Le domaine racine de la plateforme n'a pas de source unique.** Le commentaire de
  `packages/db/src/schemas.ts` parle de `<slug>.snackmanager.app`, `apps/web/src/proxy.ts`
  de `snackmanager.fr` (via `NEXT_PUBLIC_PRIMARY_DOMAIN`), et le domaine reçoit
  `rootDomain` en paramètre (`Restaurant.defaultDomain`). Il faut une seule valeur, lue
  d'une seule variable d'environnement, avant d'écrire le premier adaptateur — sans quoi
  les CNAME dictés aux restaurateurs pointeront vers deux cibles différentes selon
  l'écran.
- **Le rattachement est aujourd'hui conventionnel, pas déclaratif.** `apps/web/src/proxy.ts`
  résout un domaine personnalisé en supposant que l'étiquette du domaine correspond au
  `slug` du tenant (`laclassfood.fr` → slug `laclassfood`), et son propre commentaire
  signale la solution : un endpoint `GET /public/domains/:host`. Il faut l'écrire en même
  temps que le premier adaptateur, sinon la convention deviendra une contrainte de nommage
  imposée aux clients.

### 5.4 · Une tension à trancher lors de la bascule : l'apex

`PublicDomain.create` **refuse les domaines racines** (`classfood.fr`) et exige un
sous-domaine, avec un message explicite : un apex ne peut pas porter de CNAME (RFC 1034),
et un restaurateur qui pointerait son domaine racine chez nous casserait sa messagerie.

Or `apps/web/src/proxy.ts` documente le cas apex comme supporté, via un ALIAS/ANAME ou les
enregistrements A de l'hébergeur. Les deux ne disent pas la même chose.

C'est **une contrainte de fournisseur déguisée en règle métier** — et c'est instructif :
elle est aujourd'hui au bon endroit (un seul fichier), mais pour la mauvaise raison. Deux
issues, à trancher au moment d'écrire le premier adaptateur :

1. **Garder le refus** — c'est le comportement le plus sûr, il protège le MX du client, et
   `commander.<domaine>` est de toute façon la recommandation commerciale.
2. **Le déléguer au registrar** — ajouter au port une capacité déclarée
   (`supportsApex: boolean`) et laisser l'adaptateur trancher, puisque Cloudflare for SaaS
   sait servir un apex quand la zone est chez lui.

Tant que la question n'est pas tranchée, la règle reste au §1 et le message d'erreur
propose déjà l'alternative au restaurateur (« Utilisez un sous-domaine, par exemple
`commander.classfood.fr` »).

---

## 6 · Comment on saura qu'on s'est trompé

- **Le port ne colle pas** : un troisième adaptateur exige de tordre l'interface (états
  supplémentaires, appels hors contrat). Les deux premiers, Railway et Cloudflare for SaaS,
  y sont entrés sans modification du port — c'est le meilleur signal qu'on avait de la
  justesse de l'abstraction, et il est acquis.
- **La bascule n'arrive jamais** : trois ans, 400 domaines, et aucun des trois seuils du
  §3.2 n'a été franchi. → tant mieux, et cette ADR aura servi à ne *pas* faire le travail.
  Il faudra alors se demander si le port mérite d'exister, ou si l'adaptateur Railway peut
  redevenir un simple service.
- **On bascule sous contrainte** : la migration est déclenchée par une panne ou une limite
  atteinte, pas par un seuil. → les indicateurs du §3.2 ne sont pas relevés ; c'est le
  processus de revue trimestrielle qu'il faut réparer, pas l'architecture.
