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

## Ce qui est configuré chez Stripe

Quatre points d'entrée, créés le 26/08/2026 sur le compte `acct_1S8qJp…` :

| Mode | Type | URL |
|---|---|---|
| Test | compte | `https://api-staging-a5e8.up.railway.app/public/stripe/webhook` |
| Test | comptes connectés | `https://api-staging-a5e8.up.railway.app/public/stripe/webhook/connect` |
| Live | compte | `https://api-production-8949.up.railway.app/public/stripe/webhook` |
| Live | comptes connectés | `https://api-production-8949.up.railway.app/public/stripe/webhook/connect` |

Événements écoutés côté **comptes connectés** :
`account.updated`, `account.application.deauthorized`,
`payment_intent.succeeded`, `payment_intent.payment_failed`.

`account.application.deauthorized` n'est pas décoratif : c'est le **seul**
événement émis quand un restaurateur nous débranche depuis son tableau de
bord, et plus aucun `account.updated` ne suit. Sans lui, nos drapeaux
resteraient « encaissement actif » pour toujours et chaque client verrait son
paiement échouer au dernier clic.

## Variables par environnement

| Variable | Staging | Production |
|---|---|---|
| `STRIPE_SECRET_KEY` | clé **test** (`sk_test_…`) | clé **live** (`sk_live_…`) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | secret du point d'entrée **compte**, mode test | idem, mode live |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | secret du point d'entrée **comptes connectés**, mode test | idem, mode live |
| `WEB_PUBLIC_URL` | URL du back-office de staging | URL du back-office de production |

`WEB_PUBLIC_URL` sert d'adresse de retour après l'inscription Stripe du
restaurateur. Codée en dur, elle renverrait un restaurateur de production sur
l'environnement de test — avec un compte Stripe bien réel au bout.

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
