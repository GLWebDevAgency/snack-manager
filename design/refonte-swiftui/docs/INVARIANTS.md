# Invariants non négociables

La refonte change le rendu, pas le sens des opérations. Une maquette n’autorise jamais à supprimer un comportement absent de son état initial.

| Domaine | À conserver sans réimplémentation dans les composants |
|---|---|
| Argent | Centimes entiers, totaux et libellés dérivés par les fonctions existantes, garde de vente en cours, remise motivée, remboursements, rapprochement et journal. |
| Réseau POS | File locale, identifiants idempotents, journal durable, rejets, données anciennes et reprises existantes. Le mode offline réel ne se remplace pas par celui du prototype. |
| Paiement | Carte, espèces, titre-restaurant, commande existante, réponse incertaine. Une nouvelle clé d’opération n’est pas créée pour réessayer un timeout. |
| Téléphone | Créneau/admission confirmé avant encaissement ; champs client, journal et verrou de reprise conservés. |
| Catalogue | Variantes, groupes min/max, options obligatoires, suppléments, retraits, indisponibilités, quantités et note. Photo et cadrage viennent du catalogue/médiathèque. |
| Ticket | Édition, suppression, attente, rappel, vidage confirmé, fidélité, dispositions et côté du ticket. |
| KDS | new/preparing/ready, filtres, ordre, temporisation, panneaux, acquittements, pendingIds et reprise. Les seuils 10/15 min restent dans client-core. |
| Remise | Un ticket KDS prêt reste en attente de prise en charge. Le livreur confirme explicitement après lecture du code ; scanner ne livre pas. |
| Livraison | Mission affectée, prête et payée avant départ ; UUID/révision de reprise ; incident ne vaut pas annulation/remboursement. Ne pas inventer de GPS/distances/revenus. |
| Commande web | Panier entre onglets/retours, créneau frais, devis/adresse, intention Stripe commune, processing non assimilé à paid, invités/appareil distincts du compte. |
| Fidélité | Solde serveur, consentements, identité, jetons à usage unique, scan, reprises, fraîcheur, crédits et récompenses. Aucune mutation après une simple animation. |
| Droits | Tenant, rôle, capacité et session existants. Rôle interdit masqué, capacité non souscrite visible verrouillée suivant le code. Jamais sécurité côté UI seule. |
| Dialogue | Hôte existant, pile, focus, Escape/retour Android, inert, scroll lock, blocage de fermeture pendant opération, zones sûres et clavier. |
| Données | Aucun nom, prix, taux, allergène, promotion ou métrique fictive du studio dans l’application réelle. |

## Contrat d’un composant

Props de présentation en entrée, événements UI en sortie. Aucun client API, calcul de total, statut de commande, storage, websocket, mutation ou dépendance au domaine dans les packages UI. Le conteneur existant décide si une action est autorisée. Le kit peut rendre un bouton désactivé ; il ne remplace pas la garde qui refuse l’opération.

`KitchenTicket` accepte une action optionnelle : pour l’état prêt, fournir un message passif sans callback. `ProductTile.renderMedia` permet de conserver la politique de photo et de cadrage. `SheetFrame` fournit seulement l’apparence et se monte dans le contrôleur de modal existant.

## Critère d’acceptation d’une migration

Inventaire avant/après signé par surface ; aucun handler/prop métier supprimé sans équivalent démontré ; tests existants conservés ; non-régression offline/reprise pertinente ; captures clair/sombre et densités ; rapport des limites. Une case inconnue bloque l’affirmation « parité complète », pas la livraison d’un lot isolé.
