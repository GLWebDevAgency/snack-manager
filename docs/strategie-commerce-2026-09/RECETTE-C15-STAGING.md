# C15 — livraison et recette staging du 7 septembre 2026

## Version effectivement servie

[PR123](https://github.com/GLWebDevAgency/snack-manager/pull/123), fusionnée par
PR squash à `54b30755973423fbdc32c92a003ccd6fd34f408e`.
[Déploiement34077279754](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34077279754)
entièrement réussi : CI, secrets, préflight Railway, migrations PostgreSQL
supply/fidélité et contrôle après migration, quatre services, smoke **8/8**.
`/health` sert le SHA exact. Les quatre déploiements précédents sont `REMOVED`.

| Service | Nouveau déploiement vérifié |
| --- | --- |
| API | `789b5f79-4bc0-4ef8-ba18-e073f9304159` |
| Web | `92160679` (préfixe Railway) |
| POS | `ed262638` (préfixe Railway) |
| KDS | `0c1d7bc0` (préfixe Railway) |

La différence d'ascendance entre `main` et `develop` a été examinée : l'arbre
de `main` `fc56673` est identique à celui de `c754705`, ancêtre de `develop`.
Aucun correctif fonctionnel de production n'est absent du socle. La
réconciliation topologique reste une opération distincte, pas un cherry-pick
improvisé dans ce lot.

## Initialisation des données

Le fondateur a confirmé utiliser uniquement le Chrome de ce Mac pour la
caisse staging. Le récapitulatif de cette caisse affichait explicitement
« Journal local durable et file de synchronisation vide ». Aucun journal,
stockage navigateur ou ticket incertain n'a été purgé pour cette bascule.

Après arrêt des anciens services et vérification du nouveau SHA, sauvegarde
BSON ciblée privée avec contrôle d'empreintes : **4 tenants, 2 117 Orders,
4 admissions, 0 calendrier**. Elle est conservée localement dans
`/tmp/sm-capacity-staging-rollout.rEPWie`, avec permissions privées ; ce n'est
ni une sauvegarde hors machine ni une procédure de restauration globale.
Aucun contenu client ni secret de connexion n'est versionné dans ce dépôt.

Bootstrap opérateur explicite, jour Paris `2026-09-07`, sans appel Stripe :

| Restaurant staging | Génération stable | Résultat |
| --- | --- | --- |
| classfood | `c390e744-6155-4806-b938-04f767a46b70` | active, 1 jour, 3 occupations historiques conservées |
| chez-nicolas | `37895c5e-9079-4671-9e0c-39f9e61cd475` | active, 1 jour, 0 occupation |
| pizza-vita | `ac087868-e642-48b2-a633-fea432b5d219` | active, journée explicitement sans service |
| smash-bros-burger | `70b2348e-aa26-4cc3-86f2-e40fa556f8d1` | active, journée explicitement sans service |

Relecture finale : les quatre contrôles ont le bon UUID et le bon début de
jour ; les **2 117 commandes d'origine sont retrouvées avec leurs champs
financiers inchangés**. Aucune offre, zone ou tarification commerciale n'a été
activée par cette opération. Ne pas revenir à un writer legacy après activation.

## Recette réellement exécutée

Dans le POS Classfood appairé, Chrome desktop connecté, sur les services
staging réels :

1. Ticket téléphone de recette identifié, canette du vrai catalogue à 1,50 €,
   numéro fictif sans SMS, créneau 18:10.
2. Confirmation serveur : commande n°2 réservée, aucun paiement enregistré.
3. « Encaisser maintenant » ouvre la modale de **cette même commande**.
   Compte juste, espèces 1,50 €, puis confirmation du paiement par le serveur.
4. Base relue : une Order `6a9e2afc038259a234040a52`, une admission `created`,
   un siège cuisine et un reçu comptoir. Aucun double ticket.
5. Commande observée payée et prête en KDS ; l'historique enregistre ensuite
   préparation, prête, remise. Ces transitions ont été réalisées dans la
   session gérant pendant la recette, **pas par les appels d'automatisation**.
6. Journal local : une commande téléphone, 1,50 € espèces, zéro à encaisser,
   file de synchronisation vide. Après relecture, POS et KDS n'affichent plus
   de commande active. La commande de recette reste en historique, `delivered`.

[Démo dédiée34078299537](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34078299537)
sur `develop` réussie. L'E2E automatique34078210360 a également réussi, mais
ses **quatre scénarios sur comptes réels sont ignorés faute d'identifiants** ;
ils n'ont réalisé aucune mutation et ne constituent pas une preuve de recette.

## Incident temporaire et correctifs de suite

Avant activation, `/slots` refusait les réservations avec
`503 ORDER_CAPACITY_CALENDAR_UNAVAILABLE`, comme prévu. Cependant `/site`
agrège menu et calendrier : ce refus a aussi empêché le rendu de la carte.
Le digest web `71233965` est relié à ce 503 dans les logs du déploiement.

Après bootstrap, `/site` et `/slots` répondent 200 et une navigation complète
affiche la carte sur les deux domaines staging. Le bouton « Réessayer » seul
réaffichait l'erreur : `reset()` ne redemande pas les données serveur dans
Next16.3.1. La correction utilise le `retry()` stable de cette version, sans
purger panier ou session. Ses tests isolés ne valent pas une nouvelle recette
du serveur Next sur staging tant que sa PR séparée n'est pas déployée.

Deux améliorations restent à traiter explicitement :

- permettre la consultation du catalogue quand seul le calendrier est en
  maintenance, tout en gardant les nouvelles réservations fermées ;
- corriger le total tronqué dans le récapitulatif POS observé à 1 512 px
  (« 1,50… » dans le grand total, ligne Espèces correctement lisible).

## Limites et étape suivante

Pas de validation physique de tablette, panne réseau, TPE, imprimante, banque
ou SMS. Les reprises ambiguës/inter-onglets et la concurrence dernière place
ont leurs preuves locales/CI, pas une simulation réseau réalisée sur ce parc.
La fidélité sur ticket téléphone reste explicitement indisponible dans C15.

Après clôture du correctif de reprise, **L2.1 : accès livreur opérationnels** :
habilitation révocable d'un livreur ou équipier polyvalent, indépendante de
RH/planning, puis sessions et missions limitées au livreur. L'app livreur,
l'affectation et la preuve de remise restent à implémenter.

**Production inchangée. Toute promotion exige une PR et un GO distinct sur
le périmètre exact recetté.**
