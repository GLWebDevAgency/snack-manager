<!--
Snack Manager sert un vrai commerce. Ce qui est fusionné ici part en
production. Trois questions, pas une de plus.
-->

## Ce que ça change

<!-- Une à trois phrases, du point de vue de qui s'en sert : le gérant, la
caisse, la cuisine, le client qui commande. Pas la liste des fichiers. -->

## Comment ça a été vérifié

<!-- Ce qui a RÉELLEMENT été exécuté, avec le résultat obtenu. Une route
appelée en curl et sa réponse valent mieux qu'un « testé localement ».
La CI verte prouve que ça compile, pas que ça marche. -->

- [ ] Vérifié sur l'application qui tourne, pas seulement en compilation
- [ ] Montants manipulés en centimes, aucun flottant sur de la monnaie
- [ ] Interface entièrement en français, accents compris
- [ ] Aucun mot de passe, URL de connexion ni clé dans le diff

## Ce que ça peut casser

<!-- Migration de données, changement de contrat d'API, surface hors ligne,
appareil déjà appairé, écran de menu en salle… Écrire « rien » est une réponse
valable, mais c'est une réponse qu'on assume.
Si un retour arrière est nécessaire, comment on le fait : docs/CI-CD.md. -->
