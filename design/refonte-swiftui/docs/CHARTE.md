# Charte visuelle

## Direction

Le langage est celui du précédent aperçu RestoPilot : toile claire légèrement grisée, surfaces blanches, photos/illustrations détourées, rayons continus, hiérarchie calme et panneaux opératoires nets. La mandarine `#ed612e` reste une **option de démonstration**, pas un remplacement du laiton Snack Manager `#c9a15a` ni de la couleur du tenant.

« SwiftUI » nomme ici l’inspiration des conventions Apple. L’implémentation reste React Native pour Expo et React/DOM pour Next.js. Un rendu identique au pixel entre polices/systèmes n’est pas promis. Le comportement système, l’accessibilité et la stabilité métier priment sur une imitation d’effet.

## Composition

POS : catalogue visuel avec recherche et catégories ; ticket ancré gauche/droite selon préférence ; contenu du catalogue et lignes du ticket défilent indépendamment ; total et moyens de paiement accessibles sans chercher en bas d’une page. Sous le seuil compact de l’application, tiroir ticket et accès permanent au panier. Ne pas remplacer les dispositions A/B/C par une seule grille.

KDS : trois colonnes ou onglets compacts, ordre stable des tickets, notes et suppressions lisibles, panneau À lancer conservé. Nouveau rouge, préparation ambre, prêt vert. Le minuteur conserve ses règles propres. Pas de mouvement permanent des cartes pendant une lecture, pas de changement d’ordre par esthétique, pas de fond translucide sous une commande critique.

Client/livreur : une action primaire par étape, navigation basse persistante au-dessus des zones sûres, barres compactes, grandes zones tactiles. Les détails lourds se présentent en feuilles, sans réinitialiser les contrôleurs en les fermant.

Back-office : rail de navigation groupé existant, titres identiques à la navigation, tables pour comparer des données, formulaires en sections. Ne pas transformer tous les tableaux en cartes : la densité doit servir la tâche. Conserver les liens de détail, exports, filtres et droits.

## Tokens

Source exécutable : `packages/tokens/index.mjs`. Palette claire : canvas `#f5f5f3`, surface `#ffffff`, ink `#252723`. Palette sombre : canvas `#111310`, surface `#1c1f1b`, ink `#f5f7f2`. Les couleurs d’alerte textuelles diffèrent de l’accent et des aplats de statut pour garantir le contraste.

Espacements : 4, 8, 12, 16, 24, 32, 48. Rayon champ/bouton 12, carte 20, feuille 28. Cibles de conception : 44 minimum, 48 confortable, 56 cuisine. Ce sont des valeurs de design ; les calculs de densité et préférences existants restent les propriétaires du layout.

Police système : `-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif` sur web. Native conserve le choix système ou la police existante du projet via adaptateur. Aucune redistribution de SF Pro ni modification de l’Inter existante. Chiffres tabulaires pour totaux, quantités, heures. Ne pas désactiver le scaling du texte pour résoudre un débordement.

## Matières et contrastes

Le verre est réservé au chrome secondaire et à la navigation. Les contenus de caisse, tickets et alertes utilisent des surfaces opaques stables. Le mode Réduire la transparence revient à un fond plein ; le refus ou l’absence d’une API de blur n’empêche jamais une action.

Contraste cible : 4,5:1 pour les textes normaux, 3:1 pour les grands textes et informations graphiques pertinentes. Les aplats de marque reçoivent un texte noir ou blanc déterminé par le contraste. Le bouton mandarine a donc un texte sombre dans le kit, contrairement à l’ancien aperçu. La conformité complète ne se réduit pas à ce test arithmétique.

## États et accessibilité

Focus visible 3 px, libellés explicites des icônes interactives, aucune information transmise uniquement par la couleur, contenus longs reflow, clavier, lecteur d’écran et réduction de mouvement. Tous les états réseau doivent nommer la situation : chargement, vide, ancien, erreur, attente, résultat incertain. « Envoyé » et « Payé » exigent l’événement métier correspondant, pas la fin d’une animation.

Sources de principes : Apple HIG Materials et W3C WCAG 2.2, références dans `docs/SOURCES.md`. Il s’agit d’une charte spécifique à Snack Manager, sans affiliation ou validation Apple.
