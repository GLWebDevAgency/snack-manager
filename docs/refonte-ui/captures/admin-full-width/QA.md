# Validation visuelle — panneaux pleine largeur

- Application Next compilée locale : build `2ugXm_7GX89t7a7B1qhfR`.
- **22/22 contextes réussis**, **82 captures finales**, **197 mesures** de largeur gauche/droite. Écart maximal aux marges attendues : **0 px** (26 px dès 768 px, 16 px en dessous).
- Établissement et Livraison : 320, 768, 1440, 1920 et 2560 px en clair ; 390 et 1920 px en sombre. Tous les onglets parcourus.
- Enseigne, Salle, compte, journal, éditeur de marque avec aperçu et sauvegarde ; panneaux Livraison et barre de publication : toute la largeur utile. Une zone occupe sa grille ; deux et trois zones se répartissent sur grand écran et reviennent à une colonne sur téléphone.
- Contrôles de comparaison : Encaissement, Site avec/sans commande en ligne et Écrans à 320 et 1920 px.
- Brouillons Établissement et Livraison conservés à travers les onglets et retour/avant. La publication Livraison appelle le handler existant et transmet les valeurs de zone et capacité (panneau masqué compris) à une API simulée en mémoire validée par le schéma du dépôt.
- Aucun débordement horizontal du main/document ; cibles des onglets >=44 px ; aucun appel externe ni exception applicative constatés.

Inspection humaine des images par l’agent : Enseigne1920 clair, identité visuelle2560 clair et320 clair, journal1920 sombre, Livraison1920 clair une zone,2560 clair trois zones et390 sombre. Les cartes et barres s’alignent sur l’espace utile ; les champs et onglets restent lisibles sur petit écran.

Le premier passage conservé dans `initial-harness-attempt.json` contient 18 réussites et quatre erreurs de **sélecteur du harnais** : Site et Écrans rendent un conteneur `<section>`, alors que la recette cherchait uniquement un `<div>`. Après prise en compte des deux types de conteneur, les quatre comparateurs ont été relancés sur le même build, sans modification applicative ni retrait d’assertion de largeur. `results.json` rassemble les 18 passes initiales et ces quatre passes finales. Les quatre captures `*-failure.png` correspondent uniquement à cette première tentative ; elles sont conservées comme trace.

Preuves : `results.json`, captures nommées par surface/largeur/thème ; recette exécutée archivée dans `../../preuves/admin-full-width-visual.mjs`.

Limites : Chromium sur Next local, fixtures du dépôt, identité fictive et APIs interceptées. Aucun compte client réel, paiement, base ni serveur externe utilisés. Pas de validation matérielle Safari/iOS/Android ; ces preuves ne constituent pas encore une recette staging.
