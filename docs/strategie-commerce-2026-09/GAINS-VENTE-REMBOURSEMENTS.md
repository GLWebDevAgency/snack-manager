# Fidélité sur vente et remboursement — socle de calcul

État au 10 septembre 2026 : préparation du lot suivant #158, sur
`feat/loyalty-sale-entitlement`. Deux fonctions pures sont implémentées dans
`@sm/domain`, sans writer, worker supplémentaire, migration ou activation.
Elles ne rendent pas encore les gains web disponibles.

## Politique préparée, sans modification des ventes existantes

`deriveLoyaltySaleBasis` prépare une assiette versionnée `merchandise-net-v1` :
produits après remise, **hors frais de livraison**. Le total facturé reste
distinct et doit être exactement égal aux composants. Les montants sont des
entiers sûrs en centimes ; la vérification de somme utilise BigInt, sans
arrondi silencieux. Une livraison payante avec des produits intégralement
offerts ne devient pas un achat de produits éligible.

C'est la politique retenue pour préparer le futur raccord web, pas une
réécriture de l'historique ou des règles POS actuelles. Les conditions du
programme et leur affichage devront annoncer cette assiette avant activation.
Le calcul ne prouve ni le paiement, ni le client, ni l'origine des montants.

`planLoyaltyEarnReversal` reçoit une **règle historique**, le gain initial et
les cumuls de remboursement éligible et de correction déjà confirmés. Il
recalcule les unités conservées selon les tranches, seuils et plafonds de
cette règle : pas de prorata flottant sur les points ou les tampons. Il
retourne uniquement le complément à corriger ; une reprise déjà appliquée
donne zéro. Le résultat est immuable, sans mutation de l'entrée.

Un remboursement complet conserve zéro unité, même pour un tampon dont le
seuil est zéro. Une ancienne écriture positive sur assiette nulle est
signalée incohérente, jamais réécrite. Une correction déjà enregistrée plus
grande que la cible indique un snapshot périmé/incohérent : pas de recrédit
automatique. Les erreurs ont un code/une raison fermés, sans montant brut.

## Frontières à raccorder avant ouverture

1. **Attribution immuable à la vente** : membre, programme, version de règle
   et assiette résolus côté serveur lors de la nouvelle commande protégée.
   Aucun rattachement rétroactif des ventes par téléphone ou carte actuelle.
2. **Identité canonique de vente** : le passage paiement web → comptoir ne
   crée pas une autre vente ni une nouvelle possibilité de gain. Les anciennes
   unicités incluant `source` ne suffisent pas à prouver cette garantie.
3. **Preuve financière** : paiement et remise réellement confirmés, version
   durable, distinction remboursement confirmé/en attente. Le processeur POS
   existe ; il ne traite pas encore les corrections des gains terminés.
4. **Allocation explicite du remboursement** : un remboursement Stripe global
   ne dit pas s'il concerne les produits ou seulement la livraison. Le domaine
   exige le montant éligible confirmé ; il n'invente aucune ventilation. Les
   cas sans preuve d'allocation restent à rapprocher, pas corrigés au hasard.
5. **Writer de correction** : journal append-only, verrou de portefeuille,
   unicité de la correction et reprise du commit PostgreSQL avant accusé Mongo.
   Deux calculs identiques ne prouvent pas l'idempotence concurrente des écritures.
6. **Solde déjà consommé** : aucune dette ni limite à zéro silencieuse n'est
   créée par ce lot. Prévoir un état de rapprochement explicite avant activation
   du débit, puis traiter la consommation sur une vraie vente et ses annulations.

La route professionnelle actuelle force la source POS et vérifie son ticket.
La branche interne `earn(source=online)` n'a pas de producteur en production
retrouvé ; elle ne doit pas être ouverte telle quelle, car seule la source POS
est aujourd'hui rapprochée d'une vente Mongo. Les gains standalone et les
replays historiques restent inchangés par ces fonctions pures.

## Preuves locales et limites

Assiette : baseline total brut **14 échecs / 3 succès**, puis **17/17** ;
ajout des snapshots malformés **2 échecs / 21 succès**, puis **23/23**.
Correction : stub de refus **47 échecs / 37 succès**, puis **87/87**, dont
trois compositions avec l'assiette et des contrôles de conservation/monotonie.
Les montants extrêmes, seuils, plafonds, zéro, remboursement complet, reprises,
snapshots périmés et entrées invalides sont couverts.

Domaine complet **495/495**, typage/lint/build et exports CommonJS vérifiés.
Vérification globale **51/51 tâches**, dont 41 réutilisées du cache local ;
mêmes tests/délais, paquets séquencés. Les suites web/API dépendantes ont été
rejouées lors de cette passe, sans nouveau fournisseur ou jeu de données distant.
Ces tests ne sont ni une preuve bancaire ni une recette Mongo→PostgreSQL.
Il reste à éprouver deux workers concurrents, la réponse perdue après commit,
le remboursement avant/après crédit, le changement de règle et le passage
web → comptoir dans le writer réellement raccordé. CI et staging du nouveau
lot restent à recevoir ; le pilote, les fournisseurs et la production sont
inchangés.
