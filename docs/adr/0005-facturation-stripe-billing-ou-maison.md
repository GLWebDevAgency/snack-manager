# ADR 0005 — Ce que Stripe facture, ce que nous facturons

- **Statut** : accepté
- **Date** : 27/08/2026
- **Décideurs** : le fondateur

## Le problème

Nous encaissons déjà par Stripe. Nous avons par ailleurs construit une
facturation maison : séquence de numéros continue, PDF, relances, file de
recouvrement, et depuis aujourd'hui une passe mensuelle et une remise
fondateur. La question s'est posée, à juste titre : **ne refait-on pas ce que
Stripe sait faire ?**

La roadmap prévoyait déjà « facturation abonnements automatisée (Stripe
Billing) » en M9 (`docs/specs/contraintes-business.md` §108). La décision n'est
donc pas *si*, mais *quoi* et *quand*.

## Ce que Stripe Billing sait faire, vérifié dans la documentation

- **Abonnements récurrents** : prix, périodes, changements en cours de période
  avec proration.
- **Numérotation séquentielle au niveau du compte** — et c'est le **défaut pour
  les pays de l'UE**, précisément parce qu'ils l'exigent. Notre
  `formatInvoiceNumber` fait la même chose à la main.
- **Relances automatiques** (dunning) : réessais échelonnés, e-mails, escalade.
- **Coupons et remises** : `duration: repeating, duration_in_months: 12` — la
  durée de notre offre fondateur, telle quelle.

  **Mais `amount_off`, jamais `percent_off`** — et la nuance décide de qui paie.
  Un `percent_off` s'applique à toute la facture, lignes ajoutées comprises :
  un fondateur qui souscrit un service au onzième mois l'obtiendrait à moitié
  prix, alors que la remise a été vendue sur « tout ce qu'on signe aujourd'hui ».
  `amount_off` est un montant figé, exactement ce que porte
  `founderDiscountCents` depuis le 28/08/2026.

  Cette ligne disait `percent_off` dans la première rédaction de l'ADR, et le
  code faisait la même erreur au même moment : la remise y était un pourcentage
  appliqué à l'offre courante. Corriger l'un sans l'autre aurait réintroduit le
  défaut le jour de la bascule — c'est le propre d'une erreur de conception que
  d'être écrite deux fois.
- **Portail client** : le restaurateur voit ses factures et son moyen de
  paiement sans que nous écrivions l'écran.
- **Prélèvement SEPA**, cartes, et les moyens locaux.

## Ce que Stripe ne fait PAS, et qui reste à nous

Deux points, et le second est un piège.

**1. La conformité reste notre responsabilité.** La documentation est explicite :
« *Because you know more about your customers and your business than Stripe
does, make sure your invoices include all of the required information. […]
You're responsible for verifying that the invoices you issue meet local tax
requirements.* » Stripe fournit la mécanique, pas la conformité française.

**2. La facturation électronique n'est pas couverte.** « *Stripe Invoicing
creates invoice records and exposes invoice data through our API and webhooks,
but doesn't generate or transmit legally compliant e-invoice files on its own.* »
Il faut soit une application du marketplace (Billit est le partenaire
privilégié), soit une intégration webhook maison qui transforme la facture en
Factur-X / UBL et la transmet par une plateforme agréée.

**C'est le point qui compte pour nous** : la réforme française de la
facturation électronique arrive, et Stripe Billing ne l'apportera pas. Que la
facture naisse chez Stripe ou chez nous, ce chantier reste entier. Son échéance
exacte est à confirmer avec le comptable — elle ne dépend d'aucune décision
technique prise ici.

## La décision

**Stripe est le moteur, le CRM reste le poste de pilotage.**

C'est la contrainte qui prime sur toutes les autres : le fondateur ne doit
jamais avoir à ouvrir le tableau de bord Stripe pour faire son métier. Un
logiciel qui oblige à jongler entre deux interfaces fait faire deux fois le
travail — et c'est la seconde qu'on oublie de tenir à jour.

Concrètement, quand la bascule sera faite :

- la fiche client du CRM affiche **l'abonnement Stripe** : son état, sa
  prochaine échéance, son moyen de paiement, ses impayés ;
- « changer l'offre » appelle Stripe — mise à jour d'abonnement avec
  proration — au lieu d'écrire dans notre base ;
- « relancer » déclenche la relance Stripe ;
- la file de recouvrement lit les factures impayées **de Stripe** ;
- la passe mensuelle disparaît : Stripe émet tout seul, et le CRM montre ce
  qui a été émis.

Le tableau de bord Stripe reste la source comptable et le recours en cas de
litige. L'usage quotidien, lui, passe par le CRM.

**Et la frontière du contenu reste le CATALOGUE d'un côté, l'ENCAISSEMENT de
l'autre.**

| | Chez nous | Chez Stripe |
|---|---|---|
| Les règles de l'offre — formule optionnelle, module greffé, l'intégration qui comprend la mise en service, Boost qui inclut le module | ✓ | |
| Le chiffrage depuis la grille | ✓ | |
| Le devis et ses conditions | ✓ | |
| Le pipeline, la file de production, les services à rendre | ✓ | |
| Les abonnements récurrents et leur prélèvement | | ✓ (M9) |
| Les relances de paiement | | ✓ (M9) |
| La remise fondateur | | ✓ (M9, coupon `amount_off`) |
| Les factures et leur numérotation | | ✓ (M9) |
| La facturation électronique | ✓ (via un tiers) | |

Nos règles d'offre ne migreront **jamais** chez Stripe : « l'intégration sur
site existant comprend la mise en service » ou « Boost inclut le module » sont
du métier, pas de la facturation. Les traduire en catalogue Stripe reviendrait
à les écrire deux fois — et deux règles qui doivent rester d'accord finissent
par diverger.

## Ce qu'on fait maintenant, et ce qu'on arrête

**On garde le système maison en l'état.** Il fonctionne, il est testé, et
Stripe Billing n'est pas utilisable aujourd'hui : le compte live n'est pas
activé faute d'entreprise créée. Migrer maintenant serait construire sur une
fondation qui n'existe pas.

**On arrête d'y investir au-delà du nécessaire.** Concrètement, ce qui est
construit aujourd'hui suffit et rien de plus ne s'y ajoute :

- la passe mensuelle (`POST /crm/billing/run`) — un geste, pas un planificateur ;
- l'émission à l'unité depuis la fiche client ;
- la file de recouvrement et ses trois gestes.

**Ce qu'on n'écrira PAS**, parce que Stripe le fera mieux : le prélèvement
automatique, les relances par e-mail, l'escalade de recouvrement, le portail
client de gestion du moyen de paiement, la proration d'un changement d'offre en
cours de mois.

**Ce qu'on écrira au moment de la bascule** : les écrans du CRM qui pilotent
tout cela. C'est là que passe l'effort — pas dans la mécanique, qui sera celle
de Stripe, mais dans la façade qui évite d'ouvrir deux logiciels.

Les écrans d'aujourd'hui sont d'ailleurs conçus pour ça sans qu'on l'ait
cherché : la fiche client et la file de recouvrement lisent une *forme* de
facture, un *état* d'abonnement, une *ardoise*. Le jour où ces données viennent
de Stripe plutôt que de Mongo, c'est la couche de lecture qui change — pas les
écrans. C'est la raison de garder `CrmInvoice` et `AdminTenantAccount` comme
formes stables : elles sont déjà l'interface entre le CRM et sa source.

Le jour de la bascule, `PLAN_MRR_CENTS` devient un catalogue Stripe, la remise
fondateur devient un coupon, et `abonnementMensuelCents` sert encore — à dire
au commercial ce que coûte une offre avant de la vendre. Les calculs ne
disparaissent pas : c'est la table qui disparaît, comme le note déjà
`packages/contracts/src/crm.ts`.

## Conséquences

- Le montant d'une facture reste calculé chez nous jusqu'à M9. La source unique
  est `abonnementMensuelCents` — c'est elle qui deviendra le prix du catalogue
  Stripe, sans réécriture des règles.
- La remise fondateur est datée (`founderUntil`) plutôt que gelée, et portée par
  un MONTANT (`founderDiscountCents`) plutôt qu'un taux. Les deux se traduisent
  tels quels en coupon `amount_off` + `duration: repeating` : un gel à vie
  n'aurait pas d'équivalent Stripe propre, et un taux y remiserait ce qui est
  ajouté après la signature.
- La numérotation maison (`SM-2026-0001`) sera remplacée par celle de Stripe.
  Les deux séquences ne devront **jamais** coexister sur un même exercice : la
  bascule se fait au 1er janvier, ou avec un préfixe distinct.
- La facturation électronique est un chantier à part, à mener quelle que soit
  la décision ci-dessus.
