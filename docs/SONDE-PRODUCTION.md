# La sonde de production

> Écrite le 27/08/2026, après vingt heures de production non surveillée.
> Aucun secret ici : ils vivent dans Cloudflare et Railway, nulle part ailleurs.

## Les liens, tout de suite

| À quoi ça sert | Lien |
|---|---|
| **L'état de la production, en un coup d'œil** | https://sonde-snack-manager.snackmanager.workers.dev/etat |
| Forcer un contrôle immédiat | https://sonde-snack-manager.snackmanager.workers.dev/ |
| Le Worker dans le tableau de bord | https://dash.cloudflare.com/ → Workers & Pages → `sonde-snack-manager` |
| Le code de la sonde | [`infra/sonde-cloudflare/worker.js`](../infra/sonde-cloudflare/worker.js) |

Le premier lien se met en favori sur le téléphone. Il répond en 400 ms et dit
tout : l'état, la révision servie, chaque service avec son temps de réponse.

## Ce qui a changé, et pourquoi

La sonde vivait dans GitHub Actions, toutes les 30 minutes. Un passage prend
**11 secondes** ; GitHub facture la **minute pleine**. À 48 passages par jour,
cela faisait **1 440 minutes par mois pour 4 h 24 de calcul réel** — 82 % du
quota parti en arrondi, sur un poste qui pesait à lui seul la moitié du
forfait gratuit.

Le 26/08 vers 12 h UTC, le quota s'est épuisé. GitHub a cessé de démarrer les
jobs : le déploiement de production de la PR #66 est resté à quai, la
sauvegarde du 27/08 n'a pas eu lieu, et la production a servi une révision de
six commits en retard pendant vingt heures — **sans que personne ne le voie,
précisément parce que la sonde était muette elle aussi.**

Une sonde qui tombe en même temps que ce qu'elle surveille ne surveille rien.
C'est la raison de fond du déménagement : elle est désormais **ailleurs que
sur la ressource qu'elle mesure**.

| | Avant | Maintenant |
|---|---|---|
| Où | GitHub Actions | Cloudflare Workers |
| Fréquence | 30 min | **5 min** |
| Coût | 1 440 min/mois de quota | **0** |
| Alerte | e-mail GitHub + ntfy | ntfy, à la chute **et au retour** |

## Ce qu'elle vérifie

Les quatre services de production, comme `scripts/smoke.mjs` :

- **l'API** doit répondre 200 **et** publier `ok: true` — un 200 sur une API
  qui se sait malade ne prouve rien ;
- **la commande en ligne**, **la caisse** et **l'écran cuisine** doivent servir
  leur page.

Elle publie aussi la **révision** servie par l'API. C'est ce champ qui aurait
crié « la production est en retard » le 26/08.

La carte publique n'est pas contrôlée : la base de production a été remise à
blanc, il n'y a aucun établissement à servir. **Le jour où le premier
restaurant est en ligne**, mettre son slug dans `SLUG_CARTE`
(`infra/sonde-cloudflare/worker.js`) et redéployer — le contrôle devient réel
et traverse Mongo.

## Les alertes

La sonde ne prévient **qu'au changement d'état** : la chute, puis le retour.
Une sonde qui alerte à chaque passage rouge envoie 12 notifications par heure ;
au bout de deux pannes on coupe les notifications, et la troisième passe
inaperçue.

Le canal est le même que celui du veilleur de l'API : `SM_ALERT_WEBHOOK`.
Il se pose sur le Worker, une fois :

```
Cloudflare → Workers & Pages → sonde-snack-manager → Settings → Variables
  Nom    : SM_ALERT_WEBHOOK
  Valeur : https://ntfy.sh/<votre-sujet>     (chiffrer : « Encrypt »)
```

Tant qu'il n'est pas posé, la sonde fonctionne et mémorise tout — elle ne
sonne simplement pas. L'état reste consultable par le lien ci-dessus.

## Ce qu'il y a à faire, de temps en temps

Très peu, et c'est le but.

- **Rien au quotidien.** La sonde tourne seule, gratuitement, sans quota.
- **Quand ntfy sonne « Production en défaut »** : ouvrir le lien d'état, voir
  quel service est tombé et pourquoi, puis Railway pour ce service-là. La
  sonde vous redira d'elle-même quand c'est rentré dans l'ordre.
- **Le jour du premier restaurant en ligne** : renseigner `SLUG_CARTE` et
  redéployer (voir plus bas). C'est le seul changement de code prévu.
- **Une fois par mois, au hasard** : ouvrir le lien d'état et vérifier que
  l'horodatage a moins de 5 minutes. Une sonde qu'on ne vérifie jamais est une
  sonde dont on ignore qu'elle est morte.

## La doublure

`.github/workflows/sonde.yml` reste, **une fois par jour** à 6 h 07 UTC, au
lieu de 48 fois. Elle rejoue `smoke.mjs` en entier depuis un runner, avec le
dépôt sous la main — donc la carte publique le jour où un slug sera
configuré. C'est une doublure, pas un doublon : **30 minutes par mois au lieu
de 1 440**.

Elle se lance aussi à la main, depuis l'onglet Actions du dépôt.

## Redéployer la sonde

Le Worker se déploie depuis ce dépôt avec `wrangler`, qui a besoin d'un jeton
Cloudflare portant **Workers Scripts : Edit** (celui des sauvegardes ne porte
que R2) :

```sh
cd infra/sonde-cloudflare
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx --yes wrangler@4 deploy
```

`wrangler.toml` porte déjà le cron, le nom et le rattachement KV — rien à
retaper.

## Les ressources Cloudflare

| Ressource | Identifiant |
|---|---|
| Worker | `sonde-snack-manager` |
| Espace KV | `sonde-snack-manager` (`563f07d5244e4d1582eac6dd8189f586`) |
| Sous-domaine | `snackmanager.workers.dev` |
| Déclencheur | `*/5 * * * *` |

L'espace KV garde deux clefs : `etat` (`vert` / `rouge`) et `dernier-passage`
(le détail complet). C'est cette mémoire qui permet de ne notifier qu'au
changement, et d'annoncer la reprise — ce qu'un simple ping ne sait pas faire.

Le plan gratuit couvre largement l'usage : 8 640 passages par mois pour
100 000 requêtes par jour incluses, et 1 000 écritures KV par jour pour 576
utilisées.
