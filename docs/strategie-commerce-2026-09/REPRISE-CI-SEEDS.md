# Reprise CI : charger les seeds après les gardes

## Incident observé le 10 septembre 2026

La PR #158 a passé sa CI, puis a été fusionnée au commit
`db9c739c408e0286b7fead32b2e82d85fd37c472`. Le
[déploiement 34454486357](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34454486357)
a échoué pendant `Tests`, dans le refus d'une base servie par `seed.ts` :
le sous-processus Node/tsx a atteint son plafond de 10 000 ms (`ETIMEDOUT`).
Le signal et le statut du processus ne figuraient pas dans ce diagnostic.

Les migrations et les déploiements ont été ignorés. #157, révision
`1f50f66ec49471cfe11d15ba4686400330e02dc2`, reste la dernière version reçue.
Le délai n'a pas été reproduit par le test ciblé local original (18/18).
Le chargement prématuré des dépendances est établi dans le code ; une cause
unique de contention du runner n'est pas démontrée.

## Correction bornée

Les deux exécutables `seed.ts` et `seed-orders.ts` vérifient désormais
l'autorisation de la cible avant de charger Mongoose. Après connexion, ils
attendent les contrôles de données durables avant de charger les modèles
et les dépendances de hachage. La déconnexion en `finally` est conservée.

Les gardes URL/données, les écritures du seed, `require.main`, les options
de connexion et les délais de test **10 s / 15 s** restent inchangés.
Un simple import ne connecte pas de driver ; il peut toujours lire les
ressources locales et préparer les constantes existantes.

## Contre-preuves

Les tests lancent les vrais exécutables dans Node 24/tsx. Un hook synchrone
intercepte `require` et `import`, et un refus au niveau socket empêche
toute connexion TCP. La connexion Mongoose est remplacée par une fixture
locale ; son premier appel `model` arrête le parcours avant toute écriture.

- Refus de cible avant chargement du driver.
- Refus séparé pour chacune des trois collections de preuves durables.
- Erreur de lecture fermée et déconnexion.
- Trois lectures vides puis arrivée au writer, sans écriture.
- Import passif sans driver ni connexion.
- Contre-tests du hook lui-même : `require` et `import` restent refusés
  avec lectures incomplètes, ou avec une preuve dans la dernière collection.

La sentinelle positive prouve l'entrée du writer, **pas l'exécution complète
d'un seed ni le hachage effectif**. Aucune base réelle n'est ensemencée par
cette recette. Le fichier `seed.ts`, exclu du tsconfig standard, fait aussi
l'objet d'une compilation TypeScript ciblée sans émission.

## Réception

Recette locale finale : **51/51 tâches** (`pnpm verify`, 41 en cache),
DB **437 tests passés / 10 ignorés**, dont **32** tests du harnais ; API
**3388 passés / 675 ignorés**. La compilation ciblée de `seed.ts` réussit.
Ces nombres se recouvrent et ne prouvent pas des parcours privés staging.

Le premier passage global a échoué dans le nettoyage Chromium du test de
clé d'accès (`afterAll`, 10 s), malgré toutes ses assertions réussies. Le
rejeu ciblé inchangé passe **15/15**, puis la vérification globale du diff
final réussit. Aucune modification de ce test ni de ses délais ; cause du
nettoyage lent non démontrée. Conserver cet incident si le symptôme récidive.

La nouvelle PR et son déploiement restent à recevoir. Exiger la CI verte,
les étapes de migrations, les quatre services Railway, la révision API
attendue, le smoke et les E2E effectivement exécutés. Une fusion ne remplace
aucune de ces preuves. Aucun GO production, fournisseur ou pilote n'est déduit.
