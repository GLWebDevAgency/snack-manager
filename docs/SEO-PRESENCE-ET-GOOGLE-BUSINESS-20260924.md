# Snack Manager — référencement et présence web

État au 24 septembre 2026. Ce document distingue les changements préparés dans le code, les actions de publication et les décisions qui exigent des informations du propriétaire. Aucun classement ni trafic futur n’est garanti.

## Positionnement à porter partout

**Snack Manager accompagne les restaurants dans leur service, leurs menus et leur visibilité.** Logiciels de caisse, cuisine et commande directe ; conception de menus papier et TV ; site internet, fiche Google et communication. L’accompagnement est accessible avec ou sans les logiciels.

La spécialité du restaurant ne limite pas la proposition : snack, restaurant japonais, thaï, pizzeria ou autre établissement indépendant. Éviter une page quasi identique par cuisine ou par ville. Créer une page locale uniquement lorsqu’une présence et une offre locales peuvent être décrites et prouvées.

Les offres et le devis font autorité sur les inclusions. La conception du menu n’inclut pas automatiquement l’impression, la livraison, le matériel TV ni les campagnes payantes. Ne pas annoncer un éditeur de menus autonome tant que sa disponibilité n’a pas été vérifiée.

## Audit et corrections préparées

Le socle existait : canonicals, sitemap, HTML serveur des articles et données structurées. Les défauts vérifiés dans le dépôt concernaient les articles masqués par les animations jusqu’au démarrage du JavaScript, les dates du sitemap limitées à la publication, l’absence de politique HTTP d’exclusion des previews et des racines admin/sm, ainsi qu’un maillage éditorial limité aux ancres de la landing.

La refonte conserve les trois URL existantes. Elle comprend :

- un index éditorial organisé par besoin, une lecture adaptée au mobile, un sommaire ancré et du texte visible sans JavaScript ;
- trois articles réellement révisés et deux nouveaux guides : refaire sa carte papier/TV et organiser sa visibilité Google/site ;
- une réponse initiale claire, des sources datées, des exemples identifiés et une signature d’organisation reliée à une page de méthode ;
- des liens vers les pages de services concernées et vers les guides complémentaires ;
- une image de partage propre à chaque article, des données BlogPosting/BreadcrumbList cohérentes et des entités Organization/WebSite pour la marque ;
- une date lastmod issue de la vraie révision et une exclusion HTTP des environnements non publics et des surfaces d’exploitation.

Les observations HTTP avant refonte figurent dans `seo-live-baseline-20260924.md`. Les sources éditoriales sont consignées dans `seo-research-20260924.md`. Les résultats de recherche ponctuels ne sont pas un inventaire fiable de l’index ; Search Console et Bing Webmaster Tools restent nécessaires pour une base mesurable.

## Architecture éditoriale

| Besoin | Guide existant ou créé | Page commerciale liée | Prochaine preuve utile |
| --- | --- | --- | --- |
| Faire évoluer la carte | Menu papier et TV | /atelier | Avant/après autorisé, brief et livrables réels |
| Être trouvé et contacté | Visibilité Google et site | /atelier | Fiche/site de pilote avec accord, mesures datées |
| Mettre son lien de commande sur Google | Procédure Google | /commande-en-ligne | Captures à jour de sa propre fiche |
| Comprendre les coûts par canal | Prix et commissions | /offres | Exemple de calcul reproductible, contrats du restaurant |
| Organiser le retrait | Démarrer le click & collect | /commande-en-ligne, /cuisine | Checklist de service et observations validées avec l’équipe |

Poursuivre avec un rythme soutenable : un guide approfondi toutes les deux semaines, puis révision des pages qui reçoivent des impressions mais répondent mal au besoin. C’est une cadence de travail proposée, pas une règle de classement. Les prochains sujets prioritaires : brief de refonte de carte ; contenu à fournir pour son site ; organisation des commandes en cuisine. Un cas client ne sera publié qu’avec autorisation et résultats mesurés.

## Visibilité dans Google, Bing, ChatGPT et les réponses IA

Le travail utile porte sur des pages accessibles, indexables, correctement reliées et réellement informatives. Google indique qu’aucun fichier ou schéma spécifique IA n’est requis pour ses fonctionnalités IA. Il n’est donc pas prévu de générer un fichier llms.txt comme promesse de référencement. [Google : fonctionnalités IA](https://developers.google.com/search/docs/appearance/ai-features)

Lors de l’activation de Search Console, vérifier aussi le réglage « Search generative AI » dans les paramètres de la propriété. Google documente l’inclusion par défaut, avec une possible valeur héritée d’une propriété parente ; le réglage réel de Snack Manager n’a pas été consulté. Ce contrôle concerne l’apparition dans les fonctionnalités IA de Search, et reste distinct de l’entraînement des modèles. Le rapport dédié permet de suivre les impressions IA lorsqu’il est disponible et contient assez de données. [Contrôle Google](https://support.google.com/webmasters/answer/16908024) · [Rapport de performances IA](https://support.google.com/webmasters/answer/16984139)

Pour ChatGPT Search, vérifier que le site et son éventuel pare-feu laissent passer OAI-SearchBot. L’ouverture au robot de recherche ne nécessite pas de modifier une éventuelle décision concernant les robots d’entraînement. Les règles du dépôt ne suffisent pas à attester le comportement d’un CDN ou d’un pare-feu extérieur. [OpenAI : éditeurs et développeurs](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)

Bing recommande notamment des URL canoniques, des liens explorables, un sitemap exact et des contenus fiables. Son rapport AI Performance permet d’observer les citations sur les expériences prises en charge ; ces citations ne prouvent pas un classement ni la causalité d’une modification. [Consignes Bing](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a) · [Présentation du rapport AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview)

Aucun volume de trafic, classement, citation IA ou gain de conversion n’a été mesuré pendant cette refonte. Les données structurées décrivent les contenus ; elles ne promettent pas un affichage enrichi.

## Fiche Google Business Profile — dossier prêt à renseigner

### Avant création

Vérifier si une fiche existe déjà et la gérer plutôt qu’en créer une seconde. Confirmer le mode réel de relation client : réception à une adresse professionnelle, déplacements chez les restaurateurs, ou activité uniquement à distance. Une activité exclusivement en ligne n’est pas admissible à une fiche. Une entreprise qui se déplace chez ses clients peut utiliser une zone desservie ; une adresse non ouverte à la clientèle ne doit pas être présentée comme un établissement public. [Éligibilité Google](https://support.google.com/business/answer/7039811?hl=fr) · [Représenter son entreprise](https://support.google.com/business/answer/3038177?hl=fr)

Informations attendues du propriétaire : fiche existante éventuelle, nom commercial utilisé, ville, adresse selon le mode d’activité, zone réellement desservie, numéro professionnel, horaires de contact et compte Google propriétaire. Aucune de ces informations manquantes ne doit être inventée. La vérification de Google reste à accomplir selon la méthode qu’il proposera.

### Proposition de description

> Snack Manager accompagne les restaurants indépendants dans leur organisation et leur communication. Nous proposons des logiciels pour la caisse, la cuisine et la commande directe, ainsi que la conception de menus papier et TV. Notre Atelier accompagne aussi la création de sites internet et la visibilité locale : fiche Google, référencement et supports de communication. Les prestations sont adaptées au fonctionnement de chaque établissement et accessibles avec ou sans nos logiciels. Le périmètre, les livrables et les options sont précisés avant le démarrage du projet.

Description commerciale à relire avec les prestations effectivement proposées au moment de la publication. Ne pas ajouter une ville non desservie, « numéro 1 », ni une promesse de première position.

### Champs et services

| Champ | Préparation |
| --- | --- |
| Nom | Snack Manager, si c’est bien le nom utilisé dans le monde réel ; aucun ajout de mots-clés |
| Catégorie principale | Choisir dans les catégories disponibles celle qui représente l’activité principale réelle : édition de logiciels si c’est le cœur de l’activité ; décision à confirmer dans l’interface |
| Catégories secondaires | Seulement les activités réellement exercées et les catégories disponibles pertinentes, sans multiplier les variantes |
| Site | https://snackmanager.fr/?utm_source=google&utm_medium=organic&utm_campaign=business_profile |
| Contact | Numéro professionnel à fournir ; le site conduit au formulaire existant |
| Zone et horaires | Réalité opérationnelle confirmée par le propriétaire |
| Services à décrire | Logiciels restauration ; menus papier ; menus TV ; création de site ; visibilité locale ; accompagnement et prise en main |

Textes de services prêts à adapter :

- **Menus papier sur mesure.** Mise en page de votre carte à partir de vos contenus et de votre identité. Formats et fichiers de livraison précisés au devis. Impression et livraison éventuelles chiffrées séparément.
- **Menus pour écrans TV.** Création de visuels adaptés au format de vos écrans et à votre offre. Animation, diffusion, matériel et mises à jour définis selon le projet.
- **Site internet pour restaurant.** Présentation de votre établissement, de votre carte et des informations utiles. Contenus, domaine, hébergement, maintenance et éventuelle commande en ligne définis avant réalisation.
- **Visibilité locale.** Accompagnement de votre fiche Google et des informations présentes sur le site. Travail sur la cohérence, la clarté et les parcours de contact, sans promesse de position.
- **Logiciels pour le service.** Présentation des applications de caisse, cuisine et commande directe, avec vérification du périmètre adapté à l’établissement.

### Visuels et animation de la présence

Préparer le vrai logo, une couverture de marque, des captures actuelles en thème sombre et des photographies réelles d’accompagnement ou de supports livrés lorsque leur usage est autorisé. Identifier une démonstration comme telle ; ne pas la présenter comme une installation client. Ne pas importer de faux locaux ni d’équipe synthétique.

Trois textes préparés ci-dessous, à publier après validation de la fiche et disponibilité des pages de destination en production. Les visuels doivent représenter l’offre décrite ; un exemple de démonstration reste identifié comme tel. Une réalisation client pourra remplacer l’un de ces textes lorsqu’elle sera documentée et autorisée.

**Publication 1 — Présentation de l’activité**

> Votre restaurant a plusieurs besoins. L’accompagnement doit partir du vôtre. Organiser les commandes, refaire la carte, présenter vos menus sur écran ou améliorer votre présence en ligne : Snack Manager réunit des logiciels et des prestations adaptées à votre établissement. Notre Atelier est accessible avec ou sans nos logiciels. Découvrez les offres, leurs inclusions et les options, puis parlons de votre projet.

Bouton proposé : « En savoir plus ». Destination : `https://snackmanager.fr/offres?utm_source=google&utm_medium=organic&utm_campaign=business_profile&utm_content=presentation`.

**Publication 2 — Menus papier et TV**

> Des prix à mettre à jour, une carte devenue difficile à lire, un nouveau menu à présenter ? Nous concevons vos supports papier et TV à partir de votre offre et de votre identité. Le format, les livrables et les mises à jour sont définis avant le démarrage. L’impression, la livraison et le matériel éventuel sont chiffrés séparément. Notre guide vous aide à préparer un brief clair et à comparer les devis.

Bouton proposé : « En savoir plus ». Destination : `https://snackmanager.fr/blog/refaire-menu-restaurant-papier-tv?utm_source=google&utm_medium=organic&utm_campaign=business_profile&utm_content=menus`.

**Publication 3 — Visibilité du restaurant**

> Quand un client cherche votre restaurant, trouve-t-il les bons horaires, une carte à jour et un moyen simple de vous contacter ? Votre fiche Google et votre site doivent raconter la même histoire. Notre guide rassemble les points à vérifier : informations pratiques, liens, photos, avis et parcours de réservation ou de commande. Vous pouvez aussi nous confier un projet de site ou de visibilité, avec ou sans les logiciels Snack Manager.

Bouton proposé : « En savoir plus ». Destination : `https://snackmanager.fr/blog/visibilite-restaurant-google-site-internet?utm_source=google&utm_medium=organic&utm_campaign=business_profile&utm_content=visibilite`.

Ces paramètres identifient l’origine des liens ; ils ne créent pas à eux seuls un dispositif de mesure. Vérifier leur collecte dans l’outil de mesure retenu avant d’annoncer des conversions attribuées. Publier quand il existe une information utile ou une réalisation documentée.

Demander un avis honnête après une prestation, de façon identique à tous les clients concernés. Aucune récompense, sélection des seuls clients satisfaits ou faux avis. Répondre aux retours sans exposer de données privées. [Règles Google sur les contributions](https://support.google.com/contributionpolicy/answer/7400114?hl=fr)

## Mesure et séquence d’activation

1. Valider le rendu et les contrats techniques de cette branche, puis présenter le résultat sur staging. La production de la landing déjà validée est une livraison distincte.
2. Confirmer ou créer les propriétés Search Console et Bing Webmaster Tools sous le compte du propriétaire. Utiliser la vérification de domaine quand l’accès DNS est disponible ; ne pas publier de code de vérification inventé.
3. Après publication du blog, soumettre le sitemap de production et inspecter la home, le blog et les cinq guides. Observer les exclusions, pages découvertes et pages indexées.
4. Relever une base datée : impressions et clics hors marque, pages d’entrée, demandes de contact attribuables, visites depuis la fiche Google, impressions du rapport IA Google et citations Bing AI si accessibles. Séparer données mesurées et hypothèses ; ne pas additionner les rapports Google dont les données se recouvrent.
5. Revoir à 30 puis 60 jours : contenu utile mais peu cliqué, intention mal couverte, questions commerciales récurrentes. Les moteurs choisissent les délais de crawl et l’affichage.

Les comptes externes, la création ou gestion effective de la fiche, la vérification Google, les soumissions aux moteurs et les métriques historiques ne sont pas réalisés tant que les accès et informations nécessaires ne sont pas disponibles. Aucun email de prospection ou demande d’avis n’est envoyé par cette intervention.
