# Encaissement Stripe — configuration des environnements

> Rédigé le 26/08/2026, après la mise en production de l'encaissement en
> charges directes. Les **secrets** ne figurent pas ici : ils vivent dans les
> variables Railway, et nulle part ailleurs.

## Le principe, en une phrase

Chaque restaurant raccorde **son** compte Stripe ; ses commandes en ligne sont
encaissées **sur son compte** (charges directes, en-tête `Stripe-Account`).
Les fonds ne transitent jamais par le compte de la plateforme — encaisser pour
le compte d'autrui est un service de paiement réservé aux établissements
agréés. Aucune commission de plateforme n'est prélevée.

## Les DEUX points d'entrée, et pourquoi il en faut deux

C'est le piège central de Connect, et il est silencieux.

| Point d'entrée | Reçoit | Secret |
|---|---|---|
| **Compte** (`connect: false`) → `/public/stripe/webhook` | les paiements du compte plateforme — l'historique d'avant Connect | `STRIPE_WEBHOOK_SECRET` |
| **Comptes connectés** (`connect: true`) → `/public/stripe/webhook/connect` | **tous les paiements en charges directes**, plus le cycle de vie des comptes | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Les deux secrets sont **différents**. Poser celui de la plateforme sur la route
Connect fait échouer la vérification de signature : le client paie, le
restaurant encaisse, et la commande reste « en attente » — la cuisine ne la
voit jamais. Aucun message d'erreur ne le dit.

## Le prérequis dont dépendent tous les autres : l'inscription à Connect

Connect **s'active**, il ne suffit pas d'avoir un compte Stripe. Tant que
l'inscription n'est pas faite sur <https://dashboard.stripe.com/connect>,
la création d'un compte marchand échoue :

    You can only create new accounts if you've signed up for Connect.

Le piège est que rien ne le laisse deviner avant d'essayer : `GET /v1/accounts`
répond `200` avec une liste vide, comme sur une plateforme parfaitement
configurée. **La lecture est ouverte à tous, seule l'écriture est réservée.**
Un `200` sur cette route ne prouve donc rien, et c'est le contrôle qu'on est
naturellement tenté de faire.

Ce que ça implique dans l'ordre des opérations : inutile de poser les clés, de
configurer les webhooks ou de déboguer l'écran de raccordement tant que ce
formulaire n'est pas rempli. Rien de tout cela ne fonctionnera, et rien ne
dira pourquoi.

## Ce qui est configuré chez Stripe

Deux comptes, et ce n'est pas un accident : **staging vit dans un bac à sable
séparé** (`acct_1S8qJz…`), production sur le compte principal en mode live
(`acct_1S8qJp…`). Une clé de test du compte principal et une clé de bac à
sable se ressemblent — toutes deux en `sk_test_…` — mais leurs événements ne
partent pas au même endroit. Le fragment qui suit `sk_test_51` est
l'identifiant du compte : c'est lui qu'il faut lire pour savoir où l'on est.

| Environnement | Compte | Type | URL |
|---|---|---|---|
| Staging | bac à sable | compte | `https://api-staging-a5e8.up.railway.app/public/stripe/webhook` |
| Staging | bac à sable | comptes connectés | `https://api-staging-a5e8.up.railway.app/public/stripe/webhook/connect` |
| Production | principal, live | compte | `https://api-production-8949.up.railway.app/public/stripe/webhook` |
| Production | principal, live | comptes connectés | `https://api-production-8949.up.railway.app/public/stripe/webhook/connect` |

Deux points d'entrée subsistent sur le compte principal **en mode test**,
créés avant la bascule vers le bac à sable. Ils visent l'API de staging, qui
n'écoute plus leurs secrets : tout ce qu'ils enverraient serait rejeté en
`400`. À désactiver depuis le tableau de bord — une configuration morte qui
pointe vers une URL vivante finit toujours par coûter une heure à quelqu'un.

Événements écoutés côté **comptes connectés** :
`account.updated`, `account.application.deauthorized`,
`payment_intent.succeeded`, `payment_intent.payment_failed`.

`account.application.deauthorized` n'est pas décoratif : c'est le **seul**
événement émis quand un restaurateur nous débranche depuis son tableau de
bord, et plus aucun `account.updated` ne suit. Sans lui, nos drapeaux
resteraient « encaissement actif » pour toujours et chaque client verrait son
paiement échouer au dernier clic.

## Ce qui ne se script pas : l'identité de la plateforme

Pendant le raccordement, le restaurateur quitte notre back-office pour une
page Stripe qui lui demande ses papiers et son IBAN. Cette page porte **notre**
nom et **nos** couleurs — c'est le moment de la relation commerciale où la
confiance se gagne ou se perd, et il se joue sur un écran que nous ne
dessinons pas.

Deux réglages, au tableau de bord Stripe, qu'aucune API publique n'expose :

- **Paramètres → Détails de l'entreprise** : le nom public. Un compte laissé
  à « New business » affiche « New business souhaite accéder à votre
  compte » — la phrase exacte qui fait refermer l'onglet.
- **Paramètres → Marque** : logo, icône et couleurs. La charte donne le
  laiton `#c9a15a` en couleur principale et `#12100d` pour le texte posé
  dessus — jamais du blanc, dont le contraste sur le laiton tombe à 2,2:1.

## Variables par environnement

Toutes sur le service `api` : la clé publiable elle-même transite par l'API
vers le navigateur, si bien que le service `web` n'a aucune variable Stripe.

| Variable | Staging (bac à sable) | Production (principal, live) |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_51S8qJz…` | `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_51S8qJz…` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | point d'entrée **compte** du bac à sable | idem, mode live |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | point d'entrée **comptes connectés** du bac à sable | idem, mode live |
| `WEB_PUBLIC_URL` | `https://staging.snackmanager.fr` | `https://snackmanager.fr` |

`WEB_PUBLIC_URL` sert d'adresse de retour après l'inscription Stripe du
restaurateur. Codée en dur, elle renverrait un restaurateur de production sur
l'environnement de test — avec un compte Stripe bien réel au bout.

## Vérifier la configuration en une commande

La route webhook dit elle-même si son secret est posé, sans qu'on ait à lire
une seule variable :

    curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' \
      https://api-staging-a5e8.up.railway.app/public/stripe/webhook

| Réponse | Ce que ça veut dire |
|---|---|
| `404` | la route n'existe pas — un contrôleur oublié dans son module |
| `503` | le secret n'est pas posé sur ce service, ou le déploiement est antérieur |
| `400` | **tout va bien** — la signature est vérifiée, et elle manque, forcément |

Un `400` sur un corps vide est donc la bonne nouvelle : la vérification tourne.
Poser une variable dans Railway ne suffit pas, il faut **redéployer** le
service pour qu'elle entre dans l'environnement du processus.

Ce `curl` dit que *le secret est là*. Il ne dit pas que c'est **le bon**, ni
que le bon est sur la bonne route — la confusion qui laisse une commande en
« attente » sans le moindre message. Pour cela, il faut signer :

    WHSEC_COMPTE=whsec_… WHSEC_CONNECT=whsec_… \
      node scripts/verifier-webhooks-stripe.mjs production

Six cas, dont le secret croisé et le rejeu d'il y a une heure. Le script
n'envoie aucun identifiant de commande existant : il ne peut rien modifier.

## Les URL, et celle qu'on pourrait leur préférer

Les points d'entrée visent le domaine que Railway génère
(`api-production-8949.up.railway.app`) : un intermédiaire de moins entre
Stripe et l'API. Sa faiblesse est d'être **généré** — recréer le service en
change le nom, et les webhooks tombent dans le vide sans rien casser d'autre,
donc sans qu'on le remarque avant qu'une commande reste impayée.

Le domaine propre `api.snackmanager.fr` sert exactement les mêmes routes :
mesuré, 6 cas sur 6, Cloudflare compris. La bascule est donc disponible et
sans surprise le jour où le domaine généré doit changer — il suffit de
modifier l'URL des deux points d'entrée live, le secret ne change pas.

## Dégradation : rien ne casse sans configuration

Aucune de ces variables n'est obligatoire au démarrage.

- Sans `STRIPE_SECRET_KEY` : l'écran « Encaissement en ligne » affiche
  « bientôt disponible », et les clients règlent au comptoir.
- Sans compte raccordé : le paiement en ligne est indisponible **pour ce
  restaurant-là**, et il n'existe aucun repli sur la clé de la plateforme —
  ce repli serait précisément l'encaissement pour compte de tiers.
- Sans `STRIPE_CONNECT_WEBHOOK_SECRET` : la route répond 503 et Stripe
  rejouera l'événement une fois la variable posée.

## Développement local

    stripe listen --forward-to localhost:3001/public/stripe/webhook
    stripe listen --forward-connect-to localhost:3001/public/stripe/webhook/connect

`--forward-connect-to`, et non `--forward-to` : sans cette option, les
événements des comptes connectés ne sortent jamais, et l'on cherche pendant
une heure un bug qui n'existe pas.

## Rotation d'un secret

Créer un nouveau point d'entrée, poser son secret, vérifier qu'il reçoit, puis
supprimer l'ancien. La vérification accepte plusieurs signatures `v1`
simultanées, donc une rotation ne perd aucun événement.
