# @sm/ui-native

Présentation React Native / Expo partagée entre Caisse et Cuisine : police Inter
locale, tracés SVG, signature Snack Manager et animation de démarrage.

Les thèmes, dimensions et préférences restent pilotés par chaque application.
Les icônes et le logo acceptent leur couleur ; le démarrage reçoit la fin de la
restauration et le choix de mouvement réduit. Aucun état métier, stockage,
réseau ou dépendance au DOM dans les composants natifs.

`@sm/ui-native/brand` expose les constantes sans charger les composants, la
police ou SVG. Le chargeur de police adapte seulement la déclaration de graisse
variable sur le web. Les dépendances Expo/React suivent les versions des deux
applications pour conserver un seul moteur React.
