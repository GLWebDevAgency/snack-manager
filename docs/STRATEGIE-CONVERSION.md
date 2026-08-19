# Stratégie de conversion — vitrine Snack Manager

> Brief de référence pour la page d'accueil. La maquette d'origine donne la **forme** (hero 3D, notch, simulateur, carrousels) ; ce document donne l'**intention commerciale**. Les deux doivent tenir ensemble : une belle page qui ne convertit pas est un échec, une page qui convertit mais fait cheap tue la crédibilité d'un produit à 139 €/mois.

## 1 · À qui on parle vraiment

Un patron de snack indépendant, 30–55 ans, 60 heures par semaine, qui **décide vite et à l'instinct**. Il a déjà été déçu : un site web payé 1 500 € jamais mis à jour, des commissions de livraison à 30 %, un commercial de caisse qui a promis puis disparu.

Trois conséquences directes sur la page :

- **Il croit ce qu'il voit, pas ce qu'on lui raconte.** Une capture de l'écran de cuisine en service vaut trois paragraphes d'arguments.
- **Il lit peu.** Chaque section doit se comprendre en cinq secondes, titre et chiffre d'abord.
- **Il se méfie du jargon.** « Multi-tenant », « offline-first », « SaaS » ne veulent rien dire pour lui. « Ça marche même si le wifi saute », si.

## 2 · Les quatre leviers, dans l'ordre

### Levier 1 — La preuve par le pair (le plus fort)
Class'Food n'est pas une référence client, c'est **notre légitimité**. « Construit derrière un vrai comptoir à Perriers-sur-Andelle » désarme la méfiance mieux que n'importe quel argument produit. À placer **haut**, pas enterré dans les témoignages.

### Levier 2 — L'auto-persuasion par le chiffre
Le **simulateur de ROI** de la maquette est l'arme maîtresse, et c'est de la psychologie de vente pure : un prospect qui calcule lui-même son gain se convainc infiniment mieux qu'un prospect à qui on annonce un résultat. Il faut donc qu'il :
- manipule ses propres chiffres (commandes par jour, appels en plein rush, heures de gestion) ;
- aboutisse à un **montant mensuel en euros** ;
- voie ce montant **comparé au prix de l'abonnement**, dans la même zone d'écran. Le rapport doit sauter aux yeux sans calcul mental.

### Levier 3 — L'ancrage par le coût de l'inaction
Le prix ne se juge jamais dans l'absolu, toujours par comparaison. **Avant** d'afficher 79–139 €/mois, montrer ce que coûte le statu quo : commissions des plateformes sur un ticket moyen, affiches réimprimées à chaque changement de prix, heures recomptées à la main, appels manqués en plein coup de feu. Après cet ancrage, l'abonnement paraît dérisoire — et il l'est.

Argument le plus percutant du dossier : **zéro commission**. Sur un ticket de 20 €, une plateforme prend environ 6 €. Trente commandes par semaine, et l'abonnement est remboursé plusieurs fois.

### Levier 4 — Le risque ramené à zéro
Un indépendant ne craint pas de dépenser, il craint de **se faire piéger**. Quatre garanties, énoncées simplement :
- sans engagement ;
- **export complet de vos données** — « sans engagement veut dire sans otage » ;
- installation et reprise de carte **faites par nous** ;
- hébergement en Europe, conformité caisse.

## 3 · Traiter les objections là où elles naissent

| Objection réelle | Où la traiter | Comment |
|---|---|---|
| « Je n'ai pas le temps d'apprendre » | juste après le hero | « Votre carte est en ligne en 24 h. Vous ne saisissez rien. » |
| « Mon équipe n'y arrivera pas » | section produit | montrer les gros boutons, le code PIN, l'écran cuisine lisible de loin |
| « Ça va tomber en panne un vendredi soir » | section produit | « Fonctionne même sans internet — aucune commande perdue » |
| « Combien ça coûte, vraiment ? » | tarifs affichés | prix visibles, pas de « demandez un devis » |
| « Et si je veux partir ? » | tarifs + FAQ | export complet, sans engagement |
| « C'est pour les chaînes, pas pour moi » | preuve Class'Food | un snack de village, 7 j/7 |

## 4 · Architecture de la page

L'ordre suit le cheminement mental d'un prospect, pas la logique d'un catalogue produit.

1. **Hero** — promesse + preuve visuelle immédiate (carrousel 3D des vraies applications) + un seul appel à l'action dominant.
2. **Bandeau de réassurance** — sans engagement · installé en quelques jours · testé en service réel 7 j/7.
3. **Le problème, dans ses mots** — le téléphone qui sonne en plein rush, les commandes qui repassent par la caisse, les heures recomptées à la main.
4. **Simulateur de ROI** — il calcule son gain. Point culminant de la page.
5. **Les quatre surfaces** — captures réelles, une phrase de bénéfice chacune (pas une liste de fonctionnalités).
6. **Le coût de l'inaction** — commissions, affiches, heures perdues → ancrage.
7. **Tarifs** — après l'ancrage, jamais avant. Offre fondateur avec **compteur réel** de places restantes.
8. **La preuve Class'Food** — chiffres réels du pilote.
9. **FAQ** — les objections résiduelles, juste avant le dernier appel à l'action.
10. **Appel à l'action final** — le même que le premier, jamais un nouveau.

## 5 · Règles d'exécution

- **Un seul appel à l'action dominant** : « Demander une démo ». Le secondaire (« Voir les tarifs ») reste visuellement faible. Deux boutons de force égale divisent la conversion.
- **Aucun chiffre inventé.** Les chiffres du pilote viennent de la base ; les projections du simulateur sont présentées comme des estimations, avec leurs hypothèses visibles. Un chiffre gonflé qui s'effondre en rendez-vous détruit la vente.
- **La rareté doit être vraie.** Les 10 places fondateur sont réelles et le compteur est branché sur les données. Une fausse urgence se repère et coûte la confiance.
- **Formulaire court** : nom, téléphone, ville. Chaque champ supplémentaire coûte des conversions, et un restaurateur répond mieux au téléphone qu'à un e-mail.
- **Le téléphone visible en permanence.** Cette cible appelle. Un numéro cliquable dans la barre de navigation convertit mieux qu'un formulaire.
- **Performance = conversion.** La page se consulte souvent sur un téléphone en 4G entre deux services : images optimisées, animations en transform/opacité, rien qui bloque l'affichage.
- **Pas de jargon technique**, jamais. « Hébergé en Europe » plutôt que « conforme RGPD », « ça marche sans internet » plutôt que « offline-first ».
