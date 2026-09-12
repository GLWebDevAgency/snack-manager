# Interactions et micro-interactions

| Interaction | Traitement | Protection |
|---|---|---|
| Appui | Retour 90 ms, échelle 0,985 maximale sur bouton | Aucun délai artificiel avant le handler ; pas de mutation dans le callback de fin d’animation. |
| Survol/focus | 120 ms, contraste local et focus 3 px | Le tactile ne dépend pas du survol ; le focus ne disparaît pas dans un verre. |
| Ajout au ticket | Confirmation de ligne 160 ms, compteur lisible | L’annonce reflète l’ajout local réel, pas une vente payée. |
| Feuille | 240 ms, opacité/translation limitée | Focus piégé par l’hôte existant, Escape/retour et restauration au déclencheur. |
| KDS | Changement ponctuel après état confirmé | Pas de boucle pulsante, pas de déplacement d’un bouton sous le doigt, ordre métier conservé. |
| Fidélité | Célébration ≤600 ms après crédit confirmé | Solde, points et palier ne sont pas incrémentés au démarrage du scan. |
| Résultat incertain | Message persistant, action de vérification contrôlée | Pas de toast fugace, pas de seconde intention, pas de spinner sans information. |
| Erreur | Message près du champ ou de l’action, résumé si utile | Ne pas effacer la saisie, possibilité de reprise, pas de vibration obligatoire. |
| Rafraîchissement | Conserver le contenu ancien explicitement marqué | Un état ancien n’est ni vide, ni une preuve de synchronisation. |

Réduire les animations : durées à zéro, suppression des déplacements et confettis, aucun flash de substitution. Réduire la transparence : fond opaque. Préférences système et application se combinent sans supprimer un réglage déjà disponible.

Les haptics sont facultatifs et conditionnés à la plateforme/permission/préférence. Ils ne transmettent aucune information exclusive et ne sont pas ajoutés à chaque action en cuisine. Aucun module de vibration n’est requis par ce kit.

## Clavier et pointeur

SegmentedControl utilise des radios et un focus itinérant ; flèches, Home/End, désactivation et option absente traitées. Les boutons d’icône portent un nom accessible. Les tableaux conservent des en-têtes, un caption et un conteneur de défilement identifiable. Le clavier logiciel ne doit jamais masquer une confirmation. Le zoom texte doit provoquer reflow et scroll, pas troncature de prix/erreur.
