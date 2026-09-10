# Une vente, une identité de gain — protection PostgreSQL

Lot suivant l'attribution privée [#161](ATTRIBUTION-FIDELITE-VENTE.md), sur
`feat/loyalty-canonical-sale`. Recette locale terminée, CI distante à recevoir ; aucune
activation de gain web, migration distante ou nouvelle permission de fournisseur.

## Problème corrigé

La commande conserve son identité `tenantId + clientId` quand son paiement en
ligne est repris au comptoir. Les anciennes unicités fidélité incluent pourtant
la source : deux opérations sur deux canaux pouvaient revendiquer la même vente.
La règle actuelle du contrôleur POS reste stricte ; elle n'est pas assouplie pour
brancher le futur writer web.

Deux index PostgreSQL supplémentaires protègent les reçus et les mouvements de
gain. Pour les sources `pos` et `online`, les références connues `pos-order:UUID`,
`online-order:UUID` et `order:UUID` désignent le même UUID, quelle que soit leur
casse. La clé d'unicité est alors le tenant et cet UUID normalisé, pas le canal,
le membre ou l'identifiant d'opération. Le reçu reste protecteur même pour un
gain de zéro unité qui ne crée aucun mouvement de ledger.

Les autres sources, références opaques ou malformées ne sont pas réinterprétées
comme des commandes. Les anciens index restent présents pour leurs garanties
exactes. L'intégrité entre reçu et ledger dépend toujours de la transaction et
du lecteur de preuve ; deux index ne remplacent pas cette vérification.

## Migration et reprise

La migration `0006_canonical_sale_uniqueness` est additive : aucune réécriture
d'historique, aucune suppression de reçu ou de mouvement, aucun dédoublonnage.
Elle utilise le vrai journal Drizzle et sa transaction, avec attente de verrou
bornée à cinq secondes. Elle ne désactive pas les politiques RLS.

Un `SELECT` global de précontrôle serait trompeur pour le migrateur limité,
propriétaire de tables en FORCE RLS : il pourrait ne voir aucune ligne. La
création des index uniques contrôle toutes les lignes et refuse une collision,
même invisible à ce rôle. L'échec annule les nouveaux index et n'avance pas le
journal. Le message de collision est fixe, sans tenant ou référence de vente.

En cas de refus : conserver le binaire précédent, rapprocher les preuves par
un audit autorisé et ne jamais supprimer une ligne financière pour faire passer
le déploiement. Après succès, le binaire précédent reste compatible : le retour
applicatif ne doit pas retirer cette protection. Les index ne possèdent pas de
propriétaire SQL autonome ; le manifeste de bootstrap des 96 objets ne change
pas. Son contrôle de propriété et le journal ne prouvent pas à eux seuls
l'intégrité des définitions d'index après une intervention administrateur.

Le service existant traduit uniquement les deux nouvelles violations d'unicité
connues en conflit métier « ticket déjà traité ». Les autres erreurs SQL ne sont
pas déguisées en doublon.

## Preuves locales et réception distante attendue

Recette native : installation neuve et base 0005 peuplée, migrateur
NOSUPERUSER/NOBYPASSRLS, RLS toujours forcée, collisions historiques et rollback,
réexécution idempotente, ancien SQL d'écriture, zéro unité, deux connexions,
alias et casse, isolation tenant et préservation des autres sources.

Deux contre-tests supplémentaires passent par le vrai `LoyaltyMemberService`
avec PostgreSQL : deux canaux et opérations concurrents, pour 0 et 1 299 centimes.
Ils vérifient un seul reçu, le solde, le mouvement éventuel, le rollback de
l'opération perdante et le rejeu du gagnant. La preuve d'achat Mongo y reste un
double de test : ce n'est pas une recette bancaire.

La première version de l'index normalisait le suffixe mais pas le préfixe.
Ces tests API ont révélé que `ONLINE-ORDER` échappait au filtre ; le contre-test
est conservé.

- Suite canonique : 49/49, dont neuf gardes pures de cible et quarante cas
  utilisant PostgreSQL réel ; aucun test ignoré dans ce fichier.
- Service API avec PostgreSQL : 8/8, dont les deux nouvelles courses entre canaux.
- Traduction ciblée des erreurs SQL : 11/11 tests unitaires.
- `pnpm verify` : 51/51 tâches réussies. API : 3 418 tests réussis et 702
  ignorés dans cette passe générale sans toutes les dépendances natives.
  Ces nombres se recouvrent avec les recettes ciblées : ne pas les additionner.
- Revue indépendante en lecture seule : aucun bloqueur identifié ; limites
  entre les deux magasins et entre reçu/ledger conservées explicitement.

Le bootstrap accepte uniquement le bloc SQL relu, lié à son journal, tag,
timestamp et empreinte exacte. Les contre-tests refusent son altération ou son
déplacement. La CI conserve les anciennes suites PostgreSQL et ajoute la recette
canonique native. CI distante, reçu de migration et staging restent à consigner ;
ces résultats locaux ne constituent pas une preuve de déploiement.

## Ce que ce lot ne livre pas

Le futur worker doit encore relire un reçu canonique PostgreSQL **avant** toute
conclusion Mongo après une réponse perdue, vérifier sa preuve financière et son
attribution historique, puis acquitter sous la bonne opération. Un remboursement
peut survenir entre une lecture Mongo et un commit PostgreSQL : cette coordination
reste à traiter explicitement, pas à masquer derrière une lease ou un champ paid.
Ni crédit web automatique, ni consommation, ni compensation sont activés ici.
