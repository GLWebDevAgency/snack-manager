# Recette locale — paiement de commande

`checkout-payment.mjs` lance le vrai frontend Next et un serveur API de fixtures
en mémoire. Turnstile et Stripe.js sont remplacés dans le navigateur ; le
paiement simulé finit en `processing`, **jamais en encaissement réel**.

Ce harnais autonome ne lance pas `pnpm e2e`, ne lit pas les identifiants du parc
réel et ne vise ni staging ni production. Il n'est pas branché sur la CI.

## Prérequis et lancement

Depuis un checkout déjà installé : Node >=24.12.0, dépendance Playwright et Chromium
déjà présents, `packages/contracts/dist` compilé. Le script n'installe rien.
Il peut être lancé depuis n'importe quel répertoire : les chemins du dépôt
sont résolus depuis `import.meta.url`.

```bash
QA_SCENARIO=pickup node e2e/local/checkout-payment.mjs
QA_SCENARIO=delivery node e2e/local/checkout-payment.mjs
QA_SCENARIO=replay node e2e/local/checkout-payment.mjs
QA_SCENARIO=delivery-pricing node e2e/local/checkout-payment.mjs
QA_SCENARIO=delivery-settings node e2e/local/checkout-payment.mjs
```

Exécuter **en série**, sans autre `next dev` sur `apps/web` : Next partage son
répertoire `.next/dev`, même avec des ports différents. Ne pas arrêter une
session appartenant à un autre développeur pour libérer cette ressource.

| Variable | Défaut | Usage |
|---|---|---|
| `QA_SCENARIO` | `pickup` | `pickup`, `delivery`, `replay`, `delivery-pricing` ou `delivery-settings` |
| `QA_WEB_PORT` | `3218` | Port libre du frontend, lié uniquement à `127.0.0.1` |
| `QA_API_PORT` | `3219` | Port libre de l'API simulée, distinct du frontend |
| `QA_HEADED` | absent | `1` ouvre Chromium visiblement |

Exemple avec une autre paire de ports :

```bash
QA_SCENARIO=delivery QA_WEB_PORT=3228 QA_API_PORT=3229 node e2e/local/checkout-payment.mjs
```

Next est lancé avec `--webpack` pour cette recette uniquement : le démarrage
Turbopack local observé pendant sa préparation ne découvrait pas certaines
routes. Aucune configuration de production n'est changée. Next réutilise son
cache de développement ; prévoir de l'espace disque. Son éventuel téléchargement
de polices au premier démarrage n'est pas un test d'absence totale de réseau.
En revanche, le frontend vise exclusivement l'API locale et toute sortie HTTP
du navigateur autre que les deux origines locales ou les SDK simulés est bloquée
et fait échouer le scénario.

## Ce qui est vérifié

Les cinq scénarios parcourent le panier et le paiement, provoquent une première
réponse PaymentIntent `503`, puis une reprise sur **la même commande et le même
jeton**, avec **deux demandes PaymentIntent et une seule commande** dans la fixture.
Aucune confirmation comptoir ni commande payée ne doit être affichée après
l'incertitude. `processing` désactive le bouton Payer et invite à consulter le suivi.

- `pickup`, téléphone 390 × 844 : le POST de création attend une **barrière**.
  Le test vérifie Fermer et Retour désactivés, puis Échap sans fermeture, avant
  de libérer la réponse. Aucun délai de création arbitraire n'est utilisé.
- `delivery`, desktop 1440 × 1000 : adresse hors zone refusée, adresse corrigée,
  frais inclus (22,50 €), aucun choix comptoir. Le suivi impayé affiche l'attente
  de confirmation et le créneau souhaité, pas une prise en cuisine. Contrôle du
  suivi également sur téléphone 390 × 844, sans débordement horizontal.
- `replay`, téléphone 390 × 844 : première commande online mémorisée mais réponse
  `503`, puis choix local comptoir. Le second POST garde le même `clientId` et
  rejoue le paiement **online** initial ; aucune fausse confirmation comptoir.
- `delivery-pricing`, desktop 1440 × 1000 : devis à 22,50 €, retour au retrait
  sans frais (20 €), puis retour en livraison avec code promo. Un nouveau devis
  est exigé et affiche 20 € − 2 € + 2,50 € = 20,50 €, comme le bouton Payer.
  La navigation et le devis ne créent ni commande ni intention bancaire ; le code
  part avec la commande unique, dont le paiement reprend sur le montant net.
- `delivery-settings`, BO desktop + mobile : ancien tarif chargé sans fausse
  modification, frais fixes à 5 €, toujours offerte, puis offerte dès 25 €.
  Une saisie invalide est bloquée avant le PATCH et les réglages survivent au
  rechargement. Côté client, deux articles à 10 € coûtent 25 € livrés ; un
  troisième article invalide le devis, déclenche la gratuité et donne 30 €.
  L'API et la session gérant sont des fixtures locales, jamais le parc réel.

La page, son titre, l'absence d'écran vide/overlay et les erreurs JavaScript,
console et HTTP sont contrôlés. Seuls les échecs HTTP délibérés des fixtures
sont acceptés : `503` paiement, `503` création pour replay, `400` adresse hors
zone pour delivery, `404` programme fidélité absent.

## Résultat, preuves et limites

Le code de sortie est non nul à la première assertion en échec. Un résultat
`PASS` est imprimé en JSON avec le chemin des preuves, dans un **nouveau dossier
temporaire** `sm-checkout-<scenario>-…` : captures, `result.json`, `server.log`,
`requests.json`, `console.json`, et arbre d'accessibilité en cas d'échec.

Le bloc `finally` ferme le navigateur, l'API locale et **uniquement le processus
Next enfant lancé par ce script**. Aucun `pkill`, aucun nettoyage de worktree,
aucune suppression de cache. Une interruption forcée du processus parent peut
empêcher ce nettoyage : vérifier alors ses processus enfants, sans viser un port
ou une autre session à l'aveugle.

Cette recette prouve le comportement du frontend, **pas** l'intégration Stripe
réelle, le webhook, la concurrence Mongo, l'authentification du serveur ou le
déploiement. Ces preuves restent du ressort des tests API/Mongo et de la recette
sandbox Stripe. La reprise après rafraîchissement/fermeture du navigateur et la
persistance des secrets de suivi restent un chantier distinct.
