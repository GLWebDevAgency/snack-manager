# Direction artistique — Snack Manager

> Référence unique pour **toutes** les surfaces : caisse, cuisine, commande en ligne, back-offices, site vitrine, marques virtuelles. Une suite d'applications doit se reconnaître au premier coup d'œil.

## L'intention

Un **noir premium stratifié**, pas un gris administratif. L'utilisateur doit sentir qu'il tient un outil qui vaut 139 €/mois — dense mais aéré, soigné, jamais tape-à-l'œil. La référence mentale : le matériel professionnel de cuisine (inox, noir mat, gestes francs), pas le tableau de bord SaaS générique.

## Les sept principes

### 1 · Profondeur
Trois niveaux de surface, jamais deux valeurs identiques côte à côte :

| Niveau | Valeur | Usage |
|---|---|---|
| Fond | `#000` | canevas de l'application |
| Carte | `#111` | panneaux, cartes, colonnes |
| Élément | `#1a1a1a` | lignes, en-têtes de table, champs, éléments actifs |

Les cartes portent un dégradé vertical très discret (`linear-gradient(180deg, rgba(255,255,255,.04), transparent)`), une bordure `rgba(255,255,255,.06)` et une ombre douce (`0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)`).

### 2 · Typographie expressive
Inter partout. L'élégance vient du **contraste de graisse**, pas de la couleur.
- Prix, totaux, numéros de retrait : 800–900, `letter-spacing: -0.02em`, chiffres tabulaires.
- Texte courant : 14–15 px, 500–600.
- Intitulés de section : 11 px, 600, capitales, `letter-spacing: .06em`, gris `#999`.
- Rien en dessous de 13 px pour une information utile en service.

### 3 · Accent parcimonieux
La couleur de marque (`--cf-accent`, par restaurant) ne sert qu'aux **actions primaires, aux totaux et aux éléments actifs**. Jamais en aplat sur de grandes zones. Une interface presque monochrome où l'accent guide l'œil.

Les couleurs **fonctionnelles** ne se personnalisent jamais, sur aucun compte :

| Couleur | Valeur | Sens |
|---|---|---|
| Vert | `#3fae4a` | prêt, positif, ouvert, en poste |
| Rouge | `#c94b3f` | urgent, alerte, retard, suppression |
| Ambre | `#e0973f` | en préparation, attente |

Un cuisinier qui change d'établissement doit lire l'écran de la même façon.

### 4 · Retour tactile immédiat
Chaque appui répond en **moins de 100 ms** : léger enfoncement (`scale .97`) et variation de fond. Sur un écran de comptoir, l'absence de retour est perçue comme un bug — et fait taper deux fois.

### 5 · Respiration
Marges 12–16 px entre cartes. Rayons cohérents : **8** contrôles · **12** cartes · **16–20** panneaux · **pilule** pour les boutons ronds et les badges.

### 6 · Mouvement sobre
Transitions 200–350 ms en `cubic-bezier(.2,.8,.2,1)`, uniquement sur l'opacité et la transformation. `prefers-reduced-motion` respecté partout.

### 7 · Lisibilité de service
Le test décisif : **à 60 cm, sous néons, avec les mains grasses**. Les informations critiques — numéro de retrait, « sans oignons », minuteur en retard — doivent sauter aux yeux *sans être lues*. Cibles tactiles ≥ 44 px (POS/KDS : ≥ 56 px pour les actions principales).

## Marque grise

Un seul levier de personnalisation : **logo + une couleur d'accent** par restaurant, injectés au runtime (variable CSS côté web, objet de thème côté natif). Tout le reste — neutres, typographie, rayons, couleurs fonctionnelles — est commun. C'est ce qui permet de livrer un nouveau client en quelques minutes tout en gardant une identité produit cohérente.

## Application par surface

| Surface | Particularité |
|---|---|
| **Caisse (POS)** | Vue toute la journée et montrée en démonstration : c'est la vitrine. Densité maîtrisée, gestes francs, confirmation d'envoi soignée. |
| **Cuisine (KDS)** | Lue **de loin, en mouvement, sous pression**. Hiérarchie brutale assumée : numéro et minuteur dominent, les retraits (« sans X ») sont impossibles à rater. |
| **Commande en ligne** | Mobile-first, aux couleurs du restaurant (pas aux nôtres). Le client doit croire qu'il commande chez son snack, pas chez un prestataire. |
| **Back-offices** | Denses en information mais jamais encombrés : tableaux lisibles, chiffres tabulaires, graphiques sobres à baseline zéro. |
| **Landing SM** | Aux couleurs Snack Manager (laiton `#c9a15a`), registre plus éditorial, mais mêmes fondations. |

## Ce qu'on ne fait jamais

Dégradés criards ou multicolores · ombres portées dures · emojis en guise d'icônes dans le produit · texte gris clair sur fond gris · animations décoratives qui retardent une action · graphiques en 3D ou en camembert à douze parts · couleur fonctionnelle détournée de son sens.
