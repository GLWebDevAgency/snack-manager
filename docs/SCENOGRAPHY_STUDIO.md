# Studio de scénographie des menus

La marque de l’établissement reste la source commune de la commande en ligne et des TV : polices, logos et palette. Les modèles changent la composition et le mouvement. Aucun écran ne stocke sa propre copie de l’identité.

## Parcours du gérant

1. Dans **Réglages → Identité**, choisir la direction artistique puis essayer l’aperçu **Écrans TV**. Cet aperçu suit le brouillon ; il n’enregistre ni l’identité ni les réglages d’un écran.
2. Dans **Écrans de salle → Apparence**, choisir un des quinze modèles. Les miniatures illustrent le modèle avec de vrais produits de la carte ; le grand aperçu joue la véritable programmation de l’écran.
3. Dans **Personnaliser**, ajuster les arrondis, la taille des prix et le mouvement. Les réglages recommandés suivent la marque. La police se modifie uniquement dans l’identité commune.
4. Dans **Carte**, utiliser l’étoile d’un produit ou **Choisir les produits** pour composer la sélection de sa catégorie. Trois produits au maximum, réordonnables, enregistrés en une seule action.

## Les quinze modèles

| Famille | Modèles | Intention |
| --- | --- | --- |
| Classiques | Ardoise, Comptoir | Carte dense ou présentation photographique de comptoir |
| Affiches | Affiche, Halo, Première | Produit vedette, lumière orbitale ou entrée scénique |
| Galerie | Galerie, Panorama, Découpe | Panneaux photographiques, cadrage large ou plans alternés |
| Éditorial | Éditorial, Colonne, Manifeste | Composition typographique, colonnes ou titres expressifs |
| Ambiances | Contour, Aurore, Prisme, Ruban | Cadres lumineux, lumière d’horizon, facettes ou rubans |

Les compositions s’adaptent au nombre de produits et à l’orientation. Les arrière-plans restent vivants pendant la lecture ; les noms et les prix gardent une position lisible. Pause, mouvement désactivé et préférence de mouvement réduit sont respectés. Les photos proviennent du catalogue du restaurant ; aucune image générée de démonstration n’est utilisée pour représenter un produit vendu.

## Une sélection commune

La TV insère une scène regroupée après la catégorie concernée, lorsqu’elle figure dans sa programmation. Un produit déjà présent dans une scène de mise en avant manuelle n’est pas ajouté une seconde fois. Les produits inactifs, en rupture ou hors du service TV courant restent sélectionnés mais ne sont pas promus.

En ligne, les **Incontournables** suivent l’ordre des catégories puis l’ordre des produits sélectionnés. Une sélection volontairement vide ne déclenche pas de suggestions automatiques. Les anciennes cartes sans sélection conservent leur comportement précédent ; supprimer toutes les catégories configurées rétablit ce repli. Les nouvelles visites suivent le cache public existant ; une page déjà ouverte ne devient pas une diffusion TV.

Une modification depuis un autre poste provoque un conflit explicite : le dialogue affiche la sélection actuelle et recharge les informations des produits avant une nouvelle validation. La fiche produit ouverte et sa recette restent intactes.

## Contrat technique et vérification

- `PUT /categories/:id/featured` reçoit `productIds` et `expectedRevision`. La limite, l’ordre et la révision sont atomiques sur la catégorie ; le déplacement ou la suppression d’un produit nettoie ses références. Le rendu vérifie aussi leur appartenance.
- `ScreenPresentation` version1 porte seulement les coins, l’échelle des prix et le mouvement. `brandDraft` est réservé à la route d’aperçu et validé avec les règles de marque existantes.
- La démonstration du back-office et la démonstration de commande restent deux fixtures distinctes. Le partage réel passe par le menu public de l’API ; les tests de projection et de normalisation le vérifient.
- Les contrôles ciblent les conflits entre postes, les sélections vidées, les ruptures, les déplacements, les anciennes API, les brouillons conservés et les aperçus sans écriture. Les rendus sont inspectés en paysage et portrait avec prix longs et plusieurs densités.
