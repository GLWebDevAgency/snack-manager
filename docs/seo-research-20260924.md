# Blog Snack Manager — recherche éditoriale du 24 septembre 2026

Ce document accompagne les cinq guides du registre `apps/web/src/app/(marketing)/blog/_articles/registre.ts`. Il distingue les sources externes vérifiées, les propositions éditoriales originales et le périmètre commercial confirmé dans le dépôt. Il ne constitue pas une preuve de classement, de trafic ou de conversion.

## Travail livré

- Trois URL existantes conservées et trois corps révisés : lien de commande Google, coûts des canaux de commande, lancement du click & collect. Leur date de modification est le 24 septembre 2026, sans changer la publication d'origine du 21 août.
- Deux nouveaux guides : `refaire-menu-restaurant-papier-tv` et `visibilite-restaurant-google-site-internet`, publiés le 24 septembre 2026.
- Pour chaque guide : catégorie, réponse courte, sommaire lié à de vrais titres, sources datées et choix explicite des articles associés.
- Maillage contextualisé vers l'Atelier, la commande en ligne, la cuisine et la caisse. Les services de site, fiche Google, communication et papier sont présentés avec ou sans les logiciels.
- Photos locales existantes conservées pour les trois articles historiques ; illustrations locales décoratives `bowl.svg` et `thai-noodles.svg` pour les nouveaux. Aucun établissement ni résultat client n'est suggéré par ces images.
- Aucun prix de forfait dupliqué, aucune statistique de performance, aucun témoignage, aucun auteur individuel inventé. Les exemples chiffrés sont explicitement pédagogiques et fictifs.

## Sources primaires consultées

Toutes les adresses ci-dessous ont été recherchées ou ouvertes le 24 septembre 2026. Les textes des guides proposent une synthèse limitée et renvoient aux sources ; ils ne reproduisent pas les documents officiels.

| Source | Utilisation factuelle | Limite conservée |
| --- | --- | --- |
| [Google — commandes en ligne](https://support.google.com/business/answer/10842217?hl=fr) | Ajout et préférence de lien dans les options de commande. | Interface, pays et services disponibles peuvent modifier les options ; aucune promesse de publication. |
| [Google — liens des établissements locaux](https://support.google.com/business/answer/6218037?hl=fr) | Autre présentation possible par type de transaction. | Aucun plafond de liens repris : des pages d'aide affichent des limites différentes. |
| [Google — règles des liens](https://support.google.com/business/answer/13769188?hl=fr) | Fiche validée, destination dédiée, action réelle, liens refusés et vérification par Google. | Pas de prétendue intégration native « Order with Google » pour Snack Manager. |
| [Uber Eats France — tarification des menus](https://merchants.ubereats.com/fr/fr/resources/articles/menu-pricing/) | Frais convenus à l'inscription selon formule ; prix modifiables côté commerçant. | Pas de taux universel ; grille américaine exclue ; chiffres marketing de l'article non repris. |
| [DGCCRF — informations alimentaires](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/etiquetage-des-denrees-alimentaires-les-regles-connaitre) | Renvoi pour préparer les informations alimentaires. | Aucune attestation de conformité de la carte ou du parcours. |
| [Service Public Entreprendre — réglementation des restaurants](https://entreprendre.service-public.gouv.fr/vosdroits/F22387) | Renvoi de validation des mentions avant publication d'une carte. | Les recettes et informations sont validées par le restaurant. |
| [Google — représentation de l'établissement](https://support.google.com/business/answer/3038177?hl=fr) | Identité réelle, catégorie et informations exactes, éviter les doublons. | Les données nécessaires à une fiche Snack Manager restent à confirmer par le dirigeant. |
| [Google — classement local](https://support.google.com/business/answer/7091?hl=fr) | Pertinence, distance et notoriété ; informations complètes et actualisées. | Aucune position locale garantie ou vendue. |
| [Google — avis clients](https://support.google.com/business/answer/3474122?hl=fr) | Sollicitation d'expériences réelles, sans contrepartie. | Pas d'achat d'avis ni de promesse fondée sur un nombre d'avis. |
| [Google Search Central — fonctionnalités IA](https://developers.google.com/search/docs/appearance/ai-features) | Accessibilité, contenu utile, cohérence et fondamentaux SEO. | Apparition dans les résultats non garantie. |
| [Google Search Central — guide génératif](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) | Pas de besoin de fichier llms.txt pour les résultats Google ; contenu utile et technique saine. | Pas de recette de « citation IA », pas de pages artificielles de variantes géographiques. |
| [OpenAI — FAQ des éditeurs](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq) | Rôle d'OAI-SearchBot dans la découverte via ChatGPT Search. | Accès au robot distinct d'une garantie de présence ; pas de modification suggérée des choix d'entraînement. |

## Sources internes des affirmations commerciales

- `apps/web/src/components/marketing/menu-offers.ts` : conception, supports, exclusions et limites des prestations. Les prix ne sont pas recopiés dans les articles.
- `apps/web/src/app/(marketing)/atelier/content.ts` : papier sans suite, impression/livraison séparées, coordination éventuelle séparée, diffusion TV nécessitant une suite et du matériel compatible, analyse selon données disponibles.
- `apps/web/src/app/(marketing)/commande-en-ligne/content.ts` : espace de gestion de la commande et transmission à notre KDS si utilisé ; absence de commission Snack Manager, frais de paiement séparés.
- Les affirmations historiques de fidélité automatique ou de fonctions en préparation ont été retirées de ces articles. Le blog renvoie aux pages d'offre pour le périmètre actualisé.

## Apports originaux des guides

Les grilles de diagnostic, essais de lecture papier/TV, rôles par étape de retrait, relevés d'incident, méthode de comparaison des canaux et exemples pédagogiques sont des recommandations éditoriales. Ils ne sont pas présentés comme des résultats obtenus chez un client ni comme une étude sectorielle.

La contribution pédagogique correspond au produit de vente moins les coûts variables explicitement retenus. Le texte la distingue du bénéfice net et demande des données comparables. Aucun objectif de marge ni choix tarifaire imposé n'est proposé.

## Contrôles exécutés sur ce périmètre

- ESLint du dossier `_articles` : succès, sans avertissement, avec Node 24.20.0.
- TypeScript de `@sm/web` (`tsc --noEmit`) : succès à la fin de ce travail éditorial.
- Contrôle AST TypeScript des cinq articles : 30 sections présentes dans le même ordre que les sommaires, identifiants uniques dans chaque article, 19 liens internes vers des destinations existantes, articles associés valides et cinq images locales présentes.
- Aucun commit, push ou déploiement réalisé par ce sous-travail éditorial. La compilation du site et les contrôles de pages sont pris en charge par l'intégration principale.

## Entretien éditorial

Réviser un guide quand l'interface décrite, une règle ou l'offre change ; actualiser `modifieLe` seulement après cette révision. Conserver les URL historiques. Les sources consultées sont datées dans le registre, et les guides associés sont choisis en fonction du prochain besoin du lecteur.

Pour enrichir la preuve dans une prochaine publication, recueillir des cas réels autorisés : brief initial, fichiers avant/après, contraintes de fabrication, observations de service et résultats mesurés avec leur période. Ne pas créer ces preuves à partir d'une maquette de démonstration.
