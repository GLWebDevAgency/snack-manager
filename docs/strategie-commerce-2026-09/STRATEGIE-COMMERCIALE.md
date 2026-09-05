# Stratégie commerce — septembre 2026

État : recommandation pour les nouveaux devis, intégrée au catalogue de cette branche. Elle ne migre aucun contrat existant. Lecture du code et des pages publiques le 5 septembre 2026 ; une fonction présente dans le code n'est pas une preuve de validation en production.

## Décision commerciale

Vendre d'abord un problème résolu : fidéliser, prendre des commandes directes, puis organiser le service. La vision d'assistant-manager 2030 guide la feuille de route, mais ne constitue pas le périmètre vendu aujourd'hui. Class'Food sert de pilote, pas de preuve statistique de rentabilité.

Le site vitrine est une prestation sur mesure indépendante. Ses boutons « Commander » ouvrent le module Snack Manager du restaurant ; les produits, horaires, disponibilités, identité et prix restent gérés dans le back-office du module. Ne pas recréer un second catalogue dans la vitrine.

## Catalogue cible, HT par établissement

| Offre | Mensuel | Périmètre et limites |
|---|---:|---|
| Fidélité seule | 39 € | **Pilote accompagné** : carte publique, programme points/tampons, récompenses configurables et administration ; consommation sécurisée des récompenses à finaliser, pas de cumul automatique après commande web |
| Click & collect | 79 € | Commande et paiement en ligne, retrait, back-office de traitement ; fidélité incluse dans les mêmes limites du pilote accompagné |
| Click & collect + livraison | 119 € | Offre précédente + livraison organisée par le restaurant ; ouverture après validation pilote, sans réseau de livreurs fourni |
| Essentiel | 99 € | Suite caisse/cuisine et socle de gestion selon matrice contractuelle |
| Complet | 159 € | Essentiel + planning et stocks selon matrice contractuelle |
| Boost | 199 € | Complet + collect, pilote fidélité accompagné et support prioritaire ; livraison non incluse |
| Livraison ajoutée à Boost | +40 € | Même condition de validation pilote ; pas de double abonnement collect |
| Site vitrine / refonte | Dès 690 € / 990 €, une fois | Sur devis borné, indépendant de la caisse ; domaine, hébergement, maintenance, contenus et révisions explicités |

Source exécutable des modules : `packages/contracts/src/commerce.ts` ; suites : `packages/contracts/src/crm.ts` et `capacites.ts`. Mise en service standard des applications autonomes : 55 € HT une fois selon devis ; pas de facturation répétée du même onboarding. L'installation matérielle et les prestations personnalisées sont distinctes. Ne pas présenter 55 € comme couvrant plusieurs journées sur place.

Les montants sont une hypothèse commerciale à tester, pas le résultat d'une étude de disposition à payer. Conserver l'annuel déjà prévu au contrat pour les suites ; ne pas inventer une remise annuelle supplémentaire sur les modules. La politique fondateur existante doit être explicitée au devis : assiette, durée, exclusions, renouvellement. Ne pas inventer de nombre de places déjà vendues.

**Limite de commercialisation fidélité** : ne pas vendre une application de fidélisation pleinement finalisée. La consommation de récompenses est fermée dans le code tant qu'elle n'est pas liée de façon sécurisée à une vente ; le cumul automatique sur les commandes en ligne est absent. Le pilote à 39 € porte uniquement sur le périmètre administratif, les cartes et la configuration du programme, avec accompagnement et limites acceptés au devis. Aucun ajustement de points ne doit être présenté comme un contournement de la consommation fermée. Sans accord explicite sur ce périmètre réduit, différer la vente autonome jusqu'à la recette du parcours complet. Le même statut s'applique à la fidélité incluse dans les autres offres ; la carte autonome est exclue du SEO « en stock ».

### Règles de combinaison

- Fidélité 39 → collect 79 : remplacement, pas 39 + 79.
- Collect 79 → livraison 119 : supplément de 40, fidélité déjà incluse.
- Boost 199 + livraison 40 : 239 ; ni 199 + 119, ni supplément fidélité.
- Essentiel 99 + collect 79 : 178. Complet 159 + collect 79 : 238 ; proposer Boost à 199 si son périmètre répond au besoin.
- Suite et fidélité seules : le supplément fidélité ne s'applique que si elle n'est pas déjà incluse. Toute modification de contrat client exige un devis/avenant clair.
- Ne pas facturer la livraison tant que son activation opérationnelle n'est pas validée. Un flag commercial ne prouve ni la configuration des zones ni la présence d'un livreur.

## Architecture de l'offre et du parcours

`Vitrine sur mesure → lien du restaurant → commande personnalisée → paiement → réception back-office → préparation → retrait ou livraison restaurant`

La carte fidélité est accessible comme module distinct en pilote accompagné ; la flèche commande → attribution automatique → consommation de récompense n'est pas un parcours livré aujourd'hui.

Un domaine principal peut porter la vitrine ; un sous-domaine de commande, ou l'adresse Snack Manager existante, ouvre l'application. Sans vitrine, le domaine peut directement pointer vers la commande. Le propriétaire du domaine reste le restaurant. Documenter DNS, certificat, renouvellement et responsable de chaque hébergement ; aucune promesse d'intervention DNS sans accès.

Le back-office dépend des capacités **et** du rôle : menu, commandes web, clients/fidélité, identité, horaires/créneaux et Stripe Connect servent l'offre web. Les créneaux de commande ne sont pas le planning du personnel. Caisse, KDS, appareils, pointage et stocks sont des droits distincts. La fidélité seule ne doit pas ouvrir les ventes complètes du restaurant.

Un écran non souscrit peut afficher une présentation et une invitation à comparer les offres ; il ne charge pas les données protégées derrière un voile. Un utilisateur sans rôle suffisant reçoit un refus d'accès, pas une invitation à payer. Les API imposent les mêmes règles que la navigation. L'absence de POS/KDS ne doit pas empêcher l'acceptation, la préparation et la clôture des commandes web.

## Positionnement concurrentiel

Angle défendable : un interlocuteur de proximité, une image sur mesure et des modules cohérents sans remplacement forcé de caisse. Ce n'est ni « tout moins cher que tout le monde », ni « toute la gestion est déjà automatisée ». Le principal substitut au début est l'empilement téléphone/papier/site/caisse existante, pas uniquement un autre SaaS.

Les concurrents vendent aussi accompagnement, matériel, intégrations et fiabilité éprouvée. Comparer un devis complet : logiciel, installation, matériel, maintenance, paiement, engagement, nombre d'établissements et support. Voir [sources concurrentielles](SOURCES-CONCURRENTIELLES.md). Les taux concurrents non attribués et les projections automatiques de gains ont été retirés du marketing.

## Économie d'un développeur seul

Connu : prix proposés et architecture du catalogue. À mesurer : hébergement imputable par restaurant, stockage, emails/SMS, géocodage, cartes, services externes, frais Stripe propres à la plateforme, incidents, temps d'onboarding et support. Les frais Stripe Connect des commandes et la facturation SaaS sont deux flux distincts ; préciser qui paie quoi et ne pas supposer qu'ils sont nuls.

Formules de pilotage, sans ROI inventé :

- Contribution mensuelle par restaurant = abonnement HT encaissé − coûts variables − temps support × coût horaire interne.
- Contribution onboarding = frais initiaux HT − sous-traitance − temps de préparation/formation × coût horaire interne.
- Seuil de couverture = charges fixes mensuelles ÷ contribution moyenne positive. Si celle-ci est négative, ajouter des clients aggrave le problème.
- Retour acquisition = coût acquisition complet ÷ contribution mensuelle ; calculer seulement après observation d'une contribution positive.
- Capacité support = heures support réellement disponibles ÷ heures consommées par client. Garder une réserve d'incident plutôt que vendre toutes les heures.
- Effet fidélité = variation mesurée de revisite/cohorte et marge après coût des récompenses ; pas seulement points émis.

Pas de chiffres fictifs pour compléter ces inconnues. Le simulateur public calcule seulement des coûts actuels saisis par le visiteur. Un temps libéré n'est pas automatiquement de la trésorerie économisée ; une commande directe peut remplacer une commande déjà existante.

Décision à chaque lot de clients : conserver le prix si contribution et support sont soutenables ; ajuster le prochain devis ou le périmètre si l'onboarding consomme plusieurs heures non couvertes. Ne pas appliquer rétroactivement une hausse. Limiter les sites sur mesure à un périmètre écrit (pages, contenus, allers-retours, intégration, entretien) ; les campagnes et réseaux sociaux ne doivent pas absorber le temps de fiabilisation produit.

## Vente et acquisition réalistes

1. Qualifier en 20–30 minutes : besoin principal, caisse existante, responsable des commandes, volumes observés, réseau, domaine, Stripe, livreurs réels, disponibilité du gérant. Demander les factures pour comparer les coûts, pas des estimations arrangées.
2. Montrer un seul parcours avec ses produits : fidélité seule, commande/retrait, ou service caisse/cuisine. Identifier qui agit lorsque ça sonne et qui gère un paiement échoué.
3. Devis modulaire : abonnement, mise en service, vitrine, matériels, paiement, limites, conditions de support, étapes de réception. Livraison et fidélité en pilote explicitement séparées, sans promettre les parcours absents.
4. Recette avant ouverture : commande réelle de faible montant, réception sans POS, annulation/remboursement, créneau complet, fermeture, isolation entre restaurants, QR fidélité, reset/reconnexion et coupure réseau. Annuler/rembourser les tests conformément au processus réel.
5. Revue après un premier cycle d'exploitation convenu : données observées, incidents, effort support, retours du personnel. Obtenir l'autorisation avant témoignage, logo ou chiffre public.
6. Prospecter ensuite des établissements comparables, via contacts terrain et recommandations autorisées. Développer un cas client démontrable avant une acquisition payante large.

Objections : « Je garde ma caisse » → modules autonomes ; « J'ai déjà un site » → un bouton vers le module, pas de refonte imposée ; « Vous avez des livreurs ? » → non, organisation restaurant ; « Sans Internet ? » → limites précises et procédure de secours ; « Vous êtes seul ? » → support borné, sauvegarde/reprise documentée, pas de promesse 24/7 ; « Pourquoi payer la fidélité ? » → montrer configuration, usage et rétention mesurable, sans garantir d'augmentation du CA.

## Ordre de livraison

1. Catalogue, autorisations, devis/factures cohérents ; supprimer toute double facturation.
2. Recette autonome collect et opérations paiement ; fonctions souscrites réellement utilisables sans POS. Pour la fidélité, finaliser puis tester la consommation sécurisée liée à une vente et ses reprises/annulations avant une offre autonome pleinement opérationnelle ; traiter séparément l'attribution automatique web. Maintenir entre-temps le périmètre administratif du pilote accompagné.
3. Livraison restaurant : zones, frais/minimum, créneaux/capacité, réception, statuts, annulation/remboursement, adresse et consignes, attribution opérationnelle. Validation complète avant activation payante.
4. Premiers clients et mesure du support ; industrialiser onboarding, alertes et réversibilité.
5. Améliorations stocks/planning éprouvées puis conseil analytique. IA, HACCP, IoT : lots distincts avec validation métier et budget, jamais un sceau de conformité automatique.

Critères de sortie : tests et CI verts ne remplacent ni les scénarios réels de staging ni le GO production. Ce document n'atteste d'aucun déploiement.
