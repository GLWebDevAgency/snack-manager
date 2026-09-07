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
node e2e/local/counter-payment.mjs
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
  `503`, puis récupération `404` volontairement incertaine. Le second POST garde
  le même `clientId`, la même preuve et tout le corps métier **online** initial ;
  aucun choix comptoir local ne peut modifier une tentative déjà envoyée.
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
sandbox Stripe. La reprise après rafraîchissement/fermeture et les courses entre
onglets ont leur harnais distinct `checkout-recovery.mjs` (C01).

## Reprise durable du checkout

`node e2e/local/checkout-recovery.mjs` utilise les mêmes prérequis et ports, en
série avec les autres recettes Next. Il teste le vrai frontend avec les routes
de création, récupération et fermeture de tentative simulées. Aucun compte,
prestataire SMS, paiement réel ni environnement distant n'est sollicité.

Le journal IndexedDB natif a aussi ses tests `checkout-attempt.test.ts` dans la
suite web ; Chromium doit être installé (`pnpm exec playwright install chromium`).
La CI installe explicitement ce navigateur avant les tests, et exécute séparément
`public-order-admission.integration.test.ts` contre le MongoDB local de CI.
Les captures restent dans un dossier temporaire annoncé par le harnais.

## Bascule sécurisée vers le comptoir

`counter-payment.mjs` utilise les mêmes prérequis, variables de ports et règle
d'exécution en série. Il parcourt **10 scénarios** sur le vrai frontend Next,
avec une API locale et des SDK Stripe/Turnstile simulés :

- Checkout : paiement non configuré, échec de chargement Stripe.js, carte
  disponible. Le choix comptoir demande une confirmation et transforme la
  commande existante, sans second POST de création.
- Suivi : conversion réussie, conflit `409`, paiement déjà confirmé, ancien GET
  retardé. La réponse serveur fait autorité ; aucun ancien suivi ne doit rétablir
  un paiement en ligne après confirmation du choix comptoir.
- Confirmation bancaire `processing` ou `succeeded` côté SDK : pas de nouvelle
  tentative comptoir ni d'affichage « payé » sans état serveur correspondant.
- Livraison : aucune alternative comptoir, le prépaiement reste obligatoire.

Les barrières de réponse vérifient les doubles clics, la confirmation au clavier,
le verrouillage de Stripe pendant la bascule et l'absence de débordement en
390 × 844 / 1440 × 1000. Un suivi `online/pending` ne doit jamais afficher
« Payé en ligne », même si un ancien libellé du ticket le suggère.

Les captures et journaux sont conservés dans un nouveau dossier temporaire
`sm-counter-payment-…`, indiqué à la fin du test. Les mêmes limites s'appliquent :
ces tests n'encaissent rien et ne prouvent ni Stripe réel ni le backend Mongo.

## Encaissement d'une commande existante dans le POS

`pos-counter-payment.mjs` parcourt le **vrai POS Expo web**, avec toutes les
requêtes API interceptées dans le navigateur. Contrairement aux recettes Next,
il attend qu'un serveur POS **local** soit déjà démarré :

```bash
# Terminal 1, depuis le dépôt installé (aucun serveur API à démarrer).
EXPO_PUBLIC_API_URL=http://localhost:3001 EXPO_PUBLIC_ALLOW_LOCAL_API=1 pnpm --filter @sm/pos exec expo start --web --port 8084
# Terminal 2
POS_COUNTER_WEB_URL=http://localhost:8084 node e2e/local/pos-counter-payment.mjs
```

Le harnais refuse les origines non locales. L'API `http://localhost:3001` est
simulée, les autres sorties HTTP sont bloquées ; aucun SMS, Stripe, TPE ou ordre
réel n'est appelé. Le serveur Expo appartient à son terminal de lancement et
doit être arrêté là, pas par recherche/arrêt global de processus.

Les **15 scénarios** couvrent espèces et rendu, carte/TPE et titre-restaurant
avec confirmation manuelle, panier déjà rempli conservé, remise séparée,
montant changé, encaissement concurrent, droits, livraison/paiement en ligne
exclus, hors ligne, silence réseau de 15 s, réponse perdue/rechargement avec le
même UUID, audit incomplet malgré GET `paid`, panne d'écriture du journal puis
réconciliation. Une vente locale de la veille hors des 200 résultats est
retrouvée exactement ; une lecture `404` ne déclare jamais une vente payée.

Captures mobile/tablette/bureau et résumé sont produits dans un nouveau dossier
temporaire `sm-pos-counter-…`. Aucun POST de création de commande n'est permis.
Ces preuves portent sur l'interface et ses reprises, pas sur l'API Mongo réelle
ou l'encaissement physique : ces derniers ont leur recette distincte.

## Réservation téléphone avant encaissement dans le POS

```bash
node e2e/local/pos-phone-order.mjs
```

Ce harnais autonome rend les vrais composants `App` / `PosScreen` via
ReactNativeWeb et esbuild. **Ce n'est pas un build Expo** : les modules natifs
`expo-status-bar`, `expo-keep-awake` et AsyncStorage sont remplacés ; le stockage
navigateur, les Web Locks et le reste du parcours POS sont réels. Prérequis :
Node 24, dépendances du dépôt installées (dont esbuild fourni par l'outillage),
Chromium Playwright présent et contrats compilés. Aucune installation automatique.

Le serveur HTTP est temporaire, lié uniquement à `127.0.0.1` avec un port
éphémère. Il ne partage ni `.next` ni cache Expo. Toutes les requêtes de l'API
locale sont interceptées par des fixtures en mémoire ; toute autre origine est
bloquée et fait échouer la recette. Les huit scénarios utilisent chacun un
contexte navigateur neuf :

- confirmation d'un créneau, puis encaissement de la même commande ;
- réponse de création perdue puis reprise après rechargement, même UUID/corps ;
- stockage refusé : aucun POST de création ;
- Web Locks absents : commande téléphone indisponible, aucun POST ;
- reprise depuis un autre onglet : son nom et ses deux articles restent intacts,
  le brouillon d'origine inchangé est vidé après lecture du reçu archivé ;
- si ce brouillon d'origine a lui-même été modifié, il reste également intact ;
- requête suspendue dans A : le verrou empêche une reprise réseau concurrente
  dans B ; l'événement de stockage actualise ensuite B ;
- rejet puis clôture serveur explicite avant libération et nouvelle référence.

Le téléphone n'expose ni paiement anticipé ni rattachement fidélité non supporté.
Les captures bureau/tablette/mobile sont conservées dans un nouveau dossier
temporaire `sm-pos-phone-…` annoncé au lancement. Le résultat JSON et le code de
sortie indiquent les assertions réellement exécutées ; les erreurs JavaScript
de tous les onglets sont contrôlées. Le `finally` ferme le navigateur et ce seul
serveur, sans effacer les preuves ni aucun cache du projet.

Cette recette n'appelle ni Mongo, ni Stripe, ni SMS, ni staging/production. Elle
ne prouve pas le backend d'admission, le bundle Expo final, un périphérique natif
ou l'encaissement physique. Ces vérifications restent distinctes. Elle n'est pas
automatiquement exécutée en CI.
