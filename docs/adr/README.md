# Décisions d'architecture (ADR)

Une ADR — *Architecture Decision Record* — répond à une question qu'on ne veut pas
rouvrir tous les six mois : **pourquoi c'est comme ça ?**

Elle n'est pas un tutoriel (voir [ARCHITECTURE-LOGICIELLE.md](../ARCHITECTURE-LOGICIELLE.md))
ni une description de l'infrastructure (voir [ARCHITECTURE.md](../../ARCHITECTURE.md)).
Elle raconte un contexte, une décision, ce qu'on a écarté et ce que ça coûte.

## Index

| N° | Décision | Statut | Ce qu'elle tranche |
|---|---|---|---|
| [0001](./0001-architecture-hexagonale-et-ddd.md) | Architecture hexagonale et DDD, appliqués là où ça paie | Acceptée | Ce qui va dans `packages/domain` et ce qui reste un module NestJS — et pourquoi on refuse l'hexagone dogmatique |
| [0002](./0002-persistance-polyglotte.md) | Persistance polyglotte : MongoDB pour le commerce, PostgreSQL pour le supply | Acceptée | La grille « Mongo ou Postgres ? », les deux transactions distinctes, la cohérence inter-contextes |
| [0003](./0003-offline-first-et-idempotence.md) | Offline-first : file de mutations persistée et idempotence | Acceptée | La contrainte n° 1 du produit : `clientId`, rejeu, statut le plus avancé qui gagne |
| [0004](./0004-fournisseur-de-domaines-interchangeable.md) | Fournisseur de domaines interchangeable : port `DomainRegistrar` | Acceptée | Railway aujourd'hui, Cloudflare for SaaS au-delà de ~100 domaines — avec le seuil chiffré |

## Écrire une nouvelle ADR

**Quand** : une décision qui sera coûteuse à défaire, qui engage plusieurs paquets, ou
dont quelqu'un demandera la raison dans un an. Pas pour un choix de bibliothèque
remplaçable en une après-midi.

**Comment** : copier la structure d'une ADR existante.

```
docs/adr/NNNN-titre-en-kebab-case.md
```

- **Numérotation** : séquentielle, jamais réutilisée, même si une ADR est abandonnée.
- **Statut** : `Proposée` → `Acceptée` → `Remplacée par ADR NNNN` ou `Obsolète`.
  Une ADR acceptée **ne se modifie pas** sur le fond : on en écrit une nouvelle qui la
  remplace, et on met à jour son statut. Les corrections de forme et les liens restent
  bienvenus.
- **Sections attendues** : Contexte · Décision · Options écartées · Conséquences ·
  *Comment on saura qu'on s'est trompé*.

**Ce qui fait une bonne ADR sur ce projet :**

1. **Des exemples tirés du vrai code**, avec les chemins de fichiers. Pas d'illustration
   générique de blog.
2. **Des options écartées prises au sérieux** — en donnant d'abord ce qui les rendait
   tentantes. Une option écartée qu'on caricature n'a jamais été évaluée.
3. **L'état réel, y compris ce qui n'est pas fait.** Une ADR qui décrit un système idéal
   fait perdre du temps au premier développeur qui ouvre le code.
4. **Des seuils mesurables** dans la section de révision, pour qu'on sache
   *objectivement* quand rouvrir la décision.
