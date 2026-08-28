# Audit stratégique, produit et technique de SnackManager

**Date :** 28 août 2026  
**Snapshot audité :** `5438fb2b88c09111b732ac971ee56677099a7803`  
**Cible :** fast-foods indépendants, puis réseaux et multi-sites  
**Contrainte structurante :** un fondateur-développeur, budget limité, accès direct à des établissements pilotes  
**Statut du document :** audit de décision ; ce n'est ni une certification de sécurité, ni un avis juridique, fiscal ou sanitaire.

## Sommaire

1. [Verdict exécutif](#1-verdict-exécutif)
2. [Cap stratégique recommandé](#2-cap-stratégique-recommandé)
3. [Maturité du produit](#3-maturité-du-produit)
4. [Utilisateurs et parcours](#4-utilisateurs-et-parcours)
5. [Audit visuel et frontend](#5-audit-visuel-et-frontend)
6. [Paysage concurrentiel](#6-paysage-concurrentiel)
7. [Audit backend et architecture](#7-audit-backend-et-architecture)
8. [Base de données et gouvernance de la donnée](#8-base-de-données-et-gouvernance-de-la-donnée)
9. [Sécurité](#9-sécurité)
10. [Infrastructure, exploitation et qualité](#10-infrastructure-exploitation-et-qualité)
11. [Réglementation et HACCP](#11-réglementation-et-haccp)
12. [Faisabilité de l'IoT](#12-faisabilité-de-liot)
13. [Trajectoire IA](#13-trajectoire-ia)
14. [Plan réaliste pour un développeur seul](#14-plan-réaliste-pour-un-développeur-seul)
15. [Backlog priorisé](#15-backlog-priorisé)
16. [Pilotes, métriques et go-to-market](#16-pilotes-métriques-et-go-to-market)
17. [Décisions à prendre](#17-décisions-à-prendre)
18. [Méthode, preuves et limites](#18-méthode-preuves-et-limites)

---

## 1. Verdict exécutif

SnackManager est **un pilote avancé et crédible**, pas une simple maquette. Le parcours commande en ligne → caisse → cuisine → back-office est réellement implémenté, cohérent et déjà déployé. Le produit possède aussi des fondations rarement réunies dans un projet solo : marque grise, multi-tenant, fonctionnement dégradé, temps réel, paiement, planning, pointage, recettes, coûts matière, fournisseurs et pilotage interne.

Il n'est toutefois **pas encore l'assistant manager 2030** décrit dans la vision. Aujourd'hui, SnackManager enregistre et affiche beaucoup d'informations ; il ferme encore peu de boucles opérationnelles. L'écart principal n'est pas l'absence d'un chatbot. Il se situe ici :

> **Vente → recette → consommation théorique → stock réel → écart → alerte → décision → action → résultat vérifié**

La rupture la plus importante est entre la commande et le stock : les contrats et la documentation annoncent une sortie automatique sur vente, mais le code de commande ne déclenche pas le module supply. Le deuxième écart est entre les analyses déjà disponibles côté équipe SnackManager et le gérant, qui n'a pas encore son poste de travail « Aujourd'hui ».

### Note globale

**2,8 / 5 — pilote avancé, vendable dans un périmètre strict, non prêt pour une diffusion large ou une promesse de conformité.**

| Axe | Score / 5 | Lecture |
|---|---:|---|
| Valeur du noyau commande/POS/KDS | 3,7 | Parcours réel, différenciant pour un projet solo |
| Expérience et cohérence visuelle | 3,5 | Démonstration convaincante, quelques dettes d'usage terrain |
| Backend et qualité de code | 3,5 | Monolithe modulaire sérieux, domaine et tests riches |
| Stock, achats et finance | 2,1 | Bon modèle initial, boucles opérationnelles incomplètes |
| Sécurité et résilience | 2,2 | Socle présent, plusieurs risques à corriger avant extension du parc |
| HACCP et conformité caisse | 0,8 | Allergènes et audit générique seulement ; preuve réglementaire absente |
| Assistant et automatisation | 1,4 | Analyses déterministes utiles, pas encore servies comme assistant |
| IA | 0,5 | Vision documentée, aucune chaîne IA industrialisée |
| Faisabilité avec les moyens actuels | 2,5 | Bonne si le périmètre est séquencé ; mauvaise si tout est mené en parallèle |

### Les cinq vérités à retenir

1. **Le noyau est assez bon pour lancer des pilotes payants**, à condition de vendre exactement ce qui fonctionne.
2. **L'impression locale, la clôture de caisse et la réconciliation sont des prérequis**, pas des détails périphériques.
3. **Le stock doit devenir fiable avant d'ajouter de l'IA prédictive.** Une prédiction construite sur des consommations incomplètes dégrade la confiance.
4. **HACCP doit commencer sans IoT** : saisie manuelle, checklists, preuves, corrections et export de contrôle. Les capteurs viennent ensuite.
5. **Le projet ne doit pas devenir un assemblage de vingt mini-produits.** La différenciation vient de la continuité d'exécution et de la qualité de la boucle quotidienne.

### Positionnement recommandé

> **Le système d'exploitation du coup de feu, qui devient progressivement le copilote du gérant.**

À court terme, c'est plus crédible et plus mémorable que « l'ERP tout-en-un du restaurant », formulation déjà occupée par plusieurs concurrents.

---

## 2. Cap stratégique recommandé

### 2.1 Le produit à construire

La destination « restaurant 2030 » est pertinente, mais elle doit être pensée comme une succession de boucles fermées :

1. **Exécuter le service** : commander, encaisser, produire, remettre.
2. **Fiabiliser la matière** : recettes, achats, réceptions, ventes, pertes, inventaires.
3. **Prouver la maîtrise sanitaire** : tâches, relevés, écarts, actions correctives, export.
4. **Piloter la journée** : priorités, exceptions, arbitrages et vérification.
5. **Prévoir** : demande, besoins, planning, commandes et trésorerie.
6. **Automatiser sous contrôle** : proposer, faire confirmer, exécuter et tracer.

L'écran central ne devrait pas être un chatbot vide ni un tableau de graphiques supplémentaire. Il devrait être une file de décisions appelée **« Aujourd'hui »** :

- deux commandes sont en retard ;
- la tablette cuisine ne répond plus depuis 11 minutes ;
- les steaks passent sous le seuil pour le service du soir ;
- le contrôle de réception n'est pas signé ;
- le coût matière du menu X a augmenté de 2,1 points ;
- le planning est sous-couvert de 19 h à 21 h ;
- l'écart stock théorique/réel demande une vérification.

Chaque entrée doit contenir : **cause, preuve, impact estimé, action proposée, confirmation, résultat et trace**.

### 2.2 Ce qui peut devenir défendable

Le catalogue de fonctionnalités seul ne sera pas un avantage durable. Komia couvre déjà hygiène, RH, stocks et pilotage ; Innovorder vend un écosystème caisse–commande–production ; Inpulse et Apicbase traitent l'approvisionnement et le coût matière.

Le fossé défendable de SnackManager peut être :

- une installation très rapide dans un fast-food indépendant ;
- une exécution robuste pendant le rush, même avec un réseau imparfait ;
- une continuité native entre commandes, recettes, stock, équipe et HACCP ;
- des recommandations explicables et directement exécutables ;
- un accompagnement fondateur extrêmement proche du terrain au début ;
- une base de preuves et de métriques accumulées par établissement, sans enfermer le client.

### 2.3 Ce qu'il faut refuser maintenant

- fabriquer des capteurs, passerelles ou imprimantes ;
- reconstruire la paie, la comptabilité générale, la livraison ou un SIRH complet ;
- promettre du multi-site sophistiqué avant d'avoir trois pilotes stables ;
- lancer un agent IA autonome sur la caisse, les achats ou l'HACCP ;
- maintenir des variantes spécifiques par restaurant dans le cœur du produit ;
- vendre comme livrées des fonctions encore simulées ou documentées seulement.

La règle devrait être : **construire les boucles qui différencient ; intégrer ou exporter le reste**.

---

## 3. Maturité du produit

### 3.1 Échelle

- **0 — absent** : aucun flux exploitable.
- **1 — concept** : documentation, maquette ou début de code.
- **2 — partiel** : utilisable avec contournements et intervention du fondateur.
- **3 — pilote** : cohérent dans quelques établissements accompagnés.
- **4 — commercialisable** : robuste, observable, documenté et supportable.
- **5 — industrialisé** : automatisé, multi-site, mesuré et opéré à l'échelle.

### 3.2 Matrice fonctionnelle

| Domaine | Score | État constaté | Prochaine marche utile |
|---|---:|---|---|
| Commande en ligne | 4,0 | Menu réel, configurateurs, créneaux, paiement Stripe ou comptoir, suivi sans compte | Fidélité réelle, notifications, tests de charge et d'abandon |
| POS | 3,0 | Appairage, PIN, catalogue, paiements, tickets parqués, journal local, mode dégradé | Impression, erreurs périphériques, réconciliation, vraie clôture |
| KDS | 3,2 | Temps réel, polling de secours, board persistant, avancement offline | Son natif, reprise après conflit, ergonomie gantée |
| Back-office | 3,7 | Commandes, menu, horaires, promotions, appareils, écrans, avis, stats, paiement | Navigation recentrée sur « Aujourd'hui » et les exceptions |
| Menu, recettes et allergènes | 3,5 | CRUD, import CSV/XML, variantes, BOM, coûts, rollup allergènes | Versionner recettes/coûts, renforcer traçabilité et validation |
| Stocks et fournisseurs | 2,3 | Ingrédients, seuils, fournisseurs, tarifs, mouvements manuels | Déplétion idempotente, réception, lots, DLC, commandes fournisseur |
| Personnel et planning | 3,0 | Équipe, rôles, pointage, coût horaire, planning, couverture | Disponibilités, absences, espace salarié, export paie |
| Finance restaurateur | 2,0 | CA, statistiques, paiements, projection de masse salariale | Clôture, rapprochement, achats, marge réelle, exports comptables |
| Pilotage interne SnackManager | 4,0 | CRM, pipeline, production, facturation, signaux, santé du parc | Automatiser le support sans exposer les données inter-tenant |
| Conseil chiffré | 2,5 | Food cost, marges, benchmark, creux, manque à gagner | Routes tenant-scopées et actions dans « Aujourd'hui » |
| Assistant manager | 1,2 | Informations dispersées ; aucune boucle de décision complète | Priorités, explications, confirmations, suivi des résultats |
| HACCP / PMS | 0,5 | Allergènes et journal générique | Registres, preuves, corrections, export inspection |
| IoT sanitaire | 0 | Aucun capteur, étalonnage ou trou de mesure géré | Une intégration fournisseur après le HACCP manuel |
| IA | 0,5 | Aucun fournisseur LLM/vision ou évaluation | OCR menu contrôlé, puis explication des analyses |
| Mobile et offline | 3,0 | Expo, cache, AsyncStorage, file persistée | Borne de file, conflits, monitoring, impression/son natifs |
| Multi-site et intégrations | 1,0 | Multi-tenant et domaines personnalisés | Modèle établissement, API stable, connecteurs ciblés |
| Qualité logicielle | 3,2 | Suite importante de tests et builds reproductibles | Vrais lint/tests web/POS/KDS et E2E métier obligatoires |

### 3.3 Ce qui est réellement en production

L'API charge les modules d'authentification, tenants, menu, commandes, paiement, approvisionnement, statistiques, personnel, planning, marketing local, écrans, appareils, CRM, facturation et opérations. Le back-office de démonstration utilise les vrais écrans avec un transport mémoire explicitement activé par `?demo=1`, ce qui évite de confondre fixture et production.

Le contrôle public exécuté le 28 août 2026 a confirmé que l'API, le web, le POS et le KDS répondaient. Deux limites subsistent : le smoke test ne comparait pas la révision déployée au snapshot audité et aucun slug de carte publique de production n'était configuré. « En ligne » ne signifie donc pas « fonctionnel de bout en bout chez un restaurant réel ».

### 3.4 Écarts de promesse

Le marketing affirme actuellement que la caisse imprime le ticket cuisine et le sticker, que la fidélité points/tampons existe et que l'usage continue sans réseau. Or :

- l'écran POS qualifie encore l'impression réseau de branchement futur ([preuve](../../apps/pos/src/modals.tsx#L653-L659)) ;
- les stickers et le pilote physique ne forment pas une chaîne terminée ;
- aucun modèle de fidélité complet n'a été trouvé dans les schémas de production ;
- la « clôture » actuelle remet le journal local à zéro et affiche un succès, sans clôture fiscale immuable ni rapprochement ([preuve](../../apps/pos/src/PosScreen.tsx#L465-L480)).

Les affirmations concernées sont visibles dans le contenu marketing ([preuve](../../apps/web/src/components/marketing/content.ts#L678-L685), [preuve](../../apps/web/src/components/marketing/content.ts#L719-L747)). Ce décalage doit être corrigé avant acquisition : une promesse non tenue détruit plus de confiance qu'une fonction annoncée « bientôt ».

### 3.5 La boucle stock n'est pas fermée

Le contrat indique que le mouvement `sale` est généré par le système ([preuve](../../packages/contracts/src/supply.ts#L160-L166)) et l'ADR annonce une déplétion lors des ventes. Cependant `OrdersModule` n'importe pas `SupplyModule`, `OrdersService` ne dépend pas du service supply et la création de commande s'arrête après l'écriture Mongo et la publication temps réel ([module](../../apps/api/src/modules/orders/orders.module.ts), [service](../../apps/api/src/modules/orders/orders.service.ts)).

Conséquence : le stock affiché ne peut pas encore être vendu comme stock théorique fiable. C'est le plus gros écart ERP et la priorité produit après la caisse.

---

## 4. Utilisateurs et parcours

### 4.1 Couverture par persona

| Persona | Couverture actuelle | Problème principal | Fonction indispensable suivante |
|---|---|---|---|
| Propriétaire / gérant | Forte mais fragmentée | Trop d'écrans, peu de décisions guidées | « Aujourd'hui », marge réelle, alertes actionnables |
| Responsable de service | Moyenne | Pas de cockpit unique du rush | Retards, disponibilité, staffing, appareils sur une vue |
| Caissier | Forte | Impression et clôture incomplètes | Pont local robuste, erreurs guidées, réconciliation |
| Cuisine | Forte | Son natif et usages gantés à confirmer | Alertes fiables, gros touch targets, tâches HACCP |
| Client final | Forte | Fidélité promise mais absente | Compte facultatif, récompenses réelles, notifications |
| Équipier | Faible | Administré sans espace propre | Planning, disponibilités, demandes d'absence |
| Responsable HACCP | Absente | Aucune journée sanitaire numérique | Plan de maîtrise, écarts, correctifs, export |
| Comptable | Absente | Données non structurées pour son travail | Exports caisse/ventes/TVA/achats et journal d'audit |
| Fournisseur | Absente | Commandes hors produit | Bons de commande et réception ; portail plus tard |
| Franchisé / multi-site | Absente | Un tenant ressemble à un établissement | Groupe → établissements → droits et consolidation |
| Support SnackManager | Très forte | Risque d'accumuler du travail manuel | Playbooks, télémétrie, diagnostics et consentement d'accès |

### 4.2 Le parcours quotidien cible

| Moment | Système attendu | État SnackManager | Écart |
|---|---|---|---|
| Ouverture | Vérifier équipements, températures, équipe, caisse et ruptures | Informations dispersées | Checklist d'ouverture orchestrée |
| Préparation | Prévoir volumes, sortir les productions, recevoir les marchandises | Prévision absente, supply partiel | Besoins théoriques, réception et lots |
| Rush | Prendre, encaisser, produire, alerter en cas d'exception | Noyau solide | Impression, son, conflits offline, cockpit |
| Clôture | Réconcilier caisse, ventes, pertes, tâches et anomalies | Clôture locale légère | Z/archives, rapprochement, inventaire rapide |
| Pilotage | Comprendre marge, personnel, stock et satisfaction | Statistiques riches | Conseils tenant-scopés et plan d'action |
| Contrôle | Montrer immédiatement preuves HACCP et traçabilité | Absent | Dossier exportable et historique des corrections |

### 4.3 Le principe de l'assistant

L'assistant doit suivre cette séquence, quelle que soit l'interface texte, vocale ou tactile :

**Observer → détecter → expliquer → proposer → demander confirmation → agir → tracer → vérifier.**

La voix et l'IA ne doivent pas créer des chemins parallèles. Une commande vocale doit appliquer les mêmes droits, validations, confirmations et journaux que l'action manuelle correspondante.

---

## 5. Audit visuel et frontend

### 5.1 Parcours capturé

| Étape | Surface | Santé | Lecture |
|---:|---|---|---|
| 1 | [Accueil desktop](screenshots/01-accueil.png) | Bonne | Identité premium et démonstration forte, page très longue |
| 2 | [Démo caisse](screenshots/02-demo-caisse.png) | Bonne | Fonction principale immédiatement compréhensible |
| 3 | [Configurateur caisse](screenshots/03-caisse-configurateur.png) | Bonne | Flux riche, composition et total bien hiérarchisés |
| 4 | [Démo cuisine](screenshots/04-demo-cuisine.png) | À surveiller | Dense, dépendante de la couleur et du petit texte |
| 5 | [Commande client](screenshots/05-demo-commande-client.png) | Bonne | Parcours mobile crédible et cohérent avec la marque |
| 6 | [Back-office](screenshots/06-demo-backoffice.png) | Bonne | Lecture opérationnelle rapide, densité adaptée |
| 7 | [Connexion](screenshots/07-connexion-backoffice.png) | Incomplète | Propre mais sans récupération, MFA, aide ni onboarding |
| 8 | [Accueil mobile](screenshots/08-accueil-mobile.png) | À optimiser | Héros trop haut et titre fragmenté sur de nombreuses lignes |

Les captures ont été faites sur le produit réel local, avec les états de démonstration prévus par le code. Les badges de développement visibles sur certaines captures ne sont pas comptés comme défauts du produit livré.

### 5.2 Points forts

- identité visuelle distinctive et cohérente entre marketing et produit ;
- démonstration interactive des quatre surfaces, beaucoup plus convaincante que des captures statiques ;
- design system centralisé, variables sémantiques, contraste calculé sur la couleur tenant ;
- focus visible et prise en charge de `prefers-reduced-motion` ;
- états vides, chargement et erreurs présents dans les écrans majeurs ;
- barre mobile centrée sur les actions quotidiennes ;
- configurateurs complexes rendus compréhensibles sans surcharge excessive.

### 5.3 Problèmes frontend prioritaires

| Priorité | Problème | Risque | Recommandation |
|---|---|---|---|
| P1 | Quatorze destinations sous un seul groupe de gestion | Charge cognitive et sentiment d'ERP dispersé | Regrouper en Aujourd'hui, Opérations, Équipe, Pilotage, Conformité, Réglages |
| P1 | `Modal` et `Drawer` ne placent/piègent/restaurent pas le focus | Navigation clavier cassée | Réutiliser le patron de `Sheet` déjà meilleur |
| P1 | Cibles tactiles de 32–40 px sur des usages tablette | Erreurs en environnement gras ou ganté | Minimum terrain 44–48 px, davantage en cuisine |
| P1 | KDS dense et fortement codé par couleur | Lecture sous stress et accessibilité | Ajouter icône/texte/forme, agrandir les informations critiques |
| P2 | Réordonnancement des catégories à la souris seulement | Fonction inaccessible au clavier | Boutons monter/descendre + annonces live |
| P2 | Lignes `role="button"` contenant d'autres boutons | Focus et activation ambigus | Séparer lien principal et actions secondaires |
| P2 | Redirections `/admin` contradictoires | Navigation imprévisible | Choisir explicitement Aujourd'hui ou Dashboard |
| P2 | Aucun lien d'évitement dans le back-office | Navigation clavier longue | Ajouter « Aller au contenu » |
| P2 | Login sans mot de passe oublié, MFA ou aide | Support et sécurité | Parcours de récupération, MFA owner/admin, contact contextualisé |
| P3 | Héros mobile occupant presque tout le premier écran | Proposition et CTA retardés | Raccourcir le titre et rapprocher la preuve/CTA |

### 5.4 Design produit à viser

Le produit ne doit pas copier l'apparence d'un logiciel comptable. En fast-food, il faut :

- de gros objectifs et des exceptions très visibles ;
- peu de saisie pendant le rush ;
- une navigation stable par rôle et par moment de la journée ;
- des preuves consultables en profondeur, mais pas montrées par défaut ;
- des actions réversibles ou confirmées ;
- une interface qui explique ce qu'elle sait, d'où vient le chiffre et quand il a été mis à jour.

---

## 6. Paysage concurrentiel

### 6.1 Conclusion de marché

Le marché valide la vision, mais invalide l'idée que « tout réunir » suffirait comme différenciation. Komia dit déjà réunir hygiène, RH, stock et marges ; Innovorder propose une chaîne commande–paiement–production–back-office ; les spécialistes sont plus profonds sur leur verticale.

SnackManager ne doit donc pas essayer d'être meilleur que chaque spécialiste dès le départ. Il doit devenir **le cockpit quotidien qui relie leurs problèmes**, avec une excellente profondeur sur les boucles propres au fast-food indépendant.

### 6.2 Matrice concurrentielle

| Acteur | Centre de gravité | Forces publiques | Angle mort exploitable par SnackManager |
|---|---|---|---|
| [Komia](https://www.komia.io/) | Opérations tout-en-un | HACCP, RH, stocks, marge, multi-site, BI, intégrations matériel et caisse | Peut paraître horizontal ; gagner par l'exécution native du rush et l'installation ultra-guidée |
| [Innovorder](https://www.innovorder.com/restauration-commerciale/fast-food) | Écosystème de vente et production | Bornes, commande en ligne, paiement, caisse, écrans de production, analytics, API, accompagnement | Offre plus lourde ; gagner chez l'indépendant par simplicité, coût d'entrée et copilote quotidien |
| [Combo](https://combohr.com/fr/) | RH restauration | Planning, pointage, paie, communication, indicateurs | Ne pas reconstruire toute la paie ; offrir le staffing opérationnel et intégrer/exporter |
| [Inpulse](https://www.inpulse.ai/) | Approvisionnement IA multi-site | Prévisions, commandes, inventaires, production, marge | Ne pas battre d'abord leur modèle ; fermer la donnée vente-recette-stock dans le segment indépendant |
| [Apicbase](https://get.apicbase.com/restaurant-inventory-management-software/) | Food management | Recettes, achats, stocks, lots, écarts théorique/réel, API/POS | Plus orienté back-office matière ; gagner par une UX quotidienne et transactionnelle unifiée |
| [ePack Hygiene](https://epackpro.com/fr/) | HACCP numérique | Checklists, températures, traçabilité, preuves de contrôle, matériel | Construire un HACCP simple intégré aux ventes, équipes et stocks, sans matériel propriétaire |

Les volumes de clients ou gains de performance affichés par ces sociétés sont des **déclarations commerciales des éditeurs**, non vérifiées dans cet audit. Ils prouvent surtout la maturité des catégories, pas l'efficacité garantie chez un établissement donné.

### 6.3 Ce que Komia enseigne

La page HACCP de Komia couvre notamment nettoyage, températures, traçabilité, huiles, DLC, réception, documents et capteurs. Sa documentation d'intégration cite des imprimantes Brother, Koovea, Dragino et plusieurs caisses, dont Innovorder. La leçon stratégique est claire : **l'intégration d'un écosystème est plus réaliste que la fabrication de chaque brique**.

Pour SnackManager : commencer par un modèle de données indépendant du fournisseur, accepter la saisie manuelle, puis brancher un seul capteur et une seule imprimante parfaitement.

### 6.4 Ce qu'Innovorder enseigne

Innovorder positionne la caisse comme orchestrateur d'un écosystème complet : commandes, paiements, production, bornes, analytics et intégrations. Son avantage est la profondeur matérielle et opérationnelle.

SnackManager peut éviter le combat frontal en ciblant :

- les établissements indépendants qui trouvent l'écosystème trop lourd ;
- le remplacement progressif, module par module ;
- la valeur manager et HACCP au-dessus d'une caisse existante ;
- une installation accompagnée, avec preuve de retour sur investissement en quelques semaines.

### 6.5 Positionnement et message commercial

Message conseillé pour les 12 prochains mois :

> **SnackManager relie le comptoir, la cuisine et le gérant. Pendant le rush, rien ne se perd. Après le rush, vous savez quoi corriger demain.**

Ne pas ouvrir par « IA », « ERP » ou « 2030 ». Le restaurateur achète d'abord moins d'erreurs, moins de temps perdu, une meilleure marge et un contrôle plus serein. L'IA devient une preuve secondaire quand elle produit un résultat concret.

### 6.6 Modèle de conquête réaliste

1. Deux à trois **design partners payants**, proches géographiquement et techniquement comparables.
2. Un seul matériel supporté par catégorie au départ : tablette, imprimante, éventuellement sonde.
3. Onboarding payant et standardisé ; pas d'installation gratuite illimitée.
4. Mesure avant/après sur cinq indicateurs ; témoignage uniquement si les données le prouvent.
5. Aucun développement spécifique sans potentiel de généralisation à la majorité du segment.

---

## 7. Audit backend et architecture

### 7.1 Architecture actuelle

Le dépôt est un monorepo TypeScript réunissant :

- Next.js pour le marketing, la commande, le back-office restaurant et le back-office SnackManager ;
- NestJS pour l'API ;
- Expo/React Native Web pour POS et KDS ;
- MongoDB/Mongoose pour le commerce et les opérations ;
- PostgreSQL/Drizzle pour le supply ;
- Redis pour le temps réel ;
- Stripe pour l'encaissement ;
- packages séparés pour contrats, domaine, DB, supply et client offline.

Cette architecture est ambitieuse mais cohérente. Le monolithe modulaire est le bon choix pour un fondateur solo. Il ne faut pas le découper en microservices. La complexité vient déjà de trois systèmes de données opérationnels et de quatre surfaces clientes.

### 7.2 Points forts

- séparation visible entre contrats, règles de domaine, infrastructure et interfaces ;
- validation de schémas et types partagés ;
- règles monétaires testées en centimes ;
- webhooks Stripe traités de manière idempotente ;
- publication temps réel et polling de repli ;
- mode démo isolé ;
- nombreux tests de cas limites métier ;
- modules opérationnels assez indépendants pour évoluer sans microservices.

### 7.3 Risques architecturaux

#### Double écriture MongoDB → PostgreSQL

Une vente vit dans MongoDB tandis que le stock vit dans PostgreSQL. Une écriture synchrone naïve produirait des divergences lors d'une panne partielle. La bonne solution est :

1. événement métier `order.completed` ou `sale.confirmed` avec identifiant stable ;
2. **outbox transactionnelle** du côté de la source ;
3. consommateur supply idempotent ;
4. table de traitement avec clé unique d'événement ;
5. reprise, métrique de retard et écran de réconciliation ;
6. mouvement compensatoire, jamais édition silencieuse de l'historique.

Avant ce mécanisme, ne pas afficher « stock à jour » sans indiquer la fraîcheur et le dernier événement traité.

#### Frontières de domaine encore poreuses

Le menu dépend déjà du supply pour les modificateurs et les coûts, tandis que la commande ignore la déplétion. Formaliser des ports applicatifs : `RecipeCostReader`, `SaleConsumptionPublisher`, `InventoryReader`. Cela réduit le couplage aux bases et rend les défaillances explicites.

#### Temps réel comme confort, pas comme source de vérité

Redis doit rester un transport. Le client doit pouvoir reconstruire son état depuis l'API après reconnexion. Chaque action offline doit porter une clé d'idempotence, une version de ressource et une stratégie de conflit documentée.

#### Expansion excessive du module CRM interne

Le back-office SnackManager est déjà très mature. C'est utile pour vendre et supporter, mais chaque semaine consacrée à l'outil interne retarde la valeur restaurateur. Geler les développements CRM qui ne diminuent pas directement le coût de support ou le délai de conversion.

### 7.4 API recommandée

- versionner les contrats publics avant ouverture à des partenaires ;
- publier un OpenAPI généré et testé contre les DTO ;
- uniformiser erreurs, corrélation, idempotency keys et pagination ;
- scoper chaque requête par tenant dans une couche impossible à oublier ;
- distinguer les rôles restaurant, personnel, appareil, service interne et intégration ;
- enregistrer toute action sensible avec acteur, motif, avant/après et corrélation ;
- proposer des webhooks signés pour les intégrations plutôt qu'un accès DB.

### 7.5 Dette à traiter avant croissance

1. Impression et périphériques locaux.
2. Cycle de caisse et rapprochement.
3. Déplétion stock idempotente.
4. Révocation effective des sessions et appareils.
5. Conventions multi-tenant testées à chaque repository.
6. Contrat d'erreur/observabilité sur les files offline.
7. Documentation d'exploitation alignée avec la réalité déployée.

---

## 8. Base de données et gouvernance de la donnée

### 8.1 Diagnostic

Le choix MongoDB pour les flux commerce et PostgreSQL pour les données supply n'est pas intrinsèquement mauvais, mais il augmente fortement le coût d'exploitation, de sauvegarde et de cohérence. Une migration immédiate vers une base unique serait risquée et ne crée pas de valeur client. Il faut **stabiliser les frontières**, puis reconsidérer la consolidation lorsque les volumes et usages réels sont connus.

### 8.2 Modèle supply existant

Les tables couvrent déjà une bonne base : ingrédients, unités, stock courant et seuils, allergènes, recettes/BOM, fournisseurs, historique de prix, mouvements, commandes et factures fournisseurs. Le contrôleur expose toutefois surtout ingrédients, fournisseurs, BOM, alertes et mouvements ; le cycle commande → réception → facture n'est pas exploitable de bout en bout.

Les éléments absents pour un vrai stock/HACCP sont :

- établissements et zones de stockage ;
- lots/batches ;
- DLC/DDM et date d'ouverture ;
- contrôle de température à réception ;
- quantité commandée, reçue, refusée et motif ;
- rappels/retraits et produits concernés ;
- comptage d'inventaire signé ;
- gaspillage typé et pièce justificative ;
- version de recette utilisée au moment de la vente ;
- chaîne de correction, jamais écrasement de la preuve initiale.

### 8.3 Modèle minimal HACCP proposé

| Entité | Champs essentiels |
|---|---|
| `establishment` | tenant, site, fuseau, responsable, référentiel applicable |
| `haccp_plan` | version, dates, statut, approbateur |
| `task_template` | type, fréquence, zone, seuils, procédure et corrective suggérée |
| `task_instance` | échéance, état, assignation, preuve, retard |
| `measurement` | type, valeur, unité, horodatage mesure/réception, source, appareil, zone |
| `non_conformity` | règle violée, gravité, lot/équipement lié, description |
| `corrective_action` | action, responsable, délai, preuve, vérification d'efficacité |
| `equipment` | type, emplacement, capteur, plage, état, dernière calibration |
| `calibration` | méthode, référence, résultat, acteur, certificat |
| `lot` | produit, fournisseur, numéro, réception, DLC/DDM, quantité, statut |
| `receipt_check` | fournisseur, lignes, températures, intégrité, acceptation/refus |
| `cleaning_run` | zone/équipement, produit, méthode, acteur, preuve |
| `audit_event` | acteur, action, ressource, avant/après, motif, corrélation, horodatage |

### 8.4 Isolation multi-tenant

Chaque document ou ligne métier doit porter un `tenantId` et, à terme, un `establishmentId`. Les contrôles applicatifs actuels doivent être renforcés par :

- repositories ne permettant jamais une requête non scopée hors administration explicite ;
- index uniques composés avec le tenant ;
- tests négatifs systématiques tenant A → ressource tenant B ;
- PostgreSQL RLS lorsque le coût d'adoption devient raisonnable ;
- comptes DB distincts et droits minimaux pour migrations, application et sauvegarde ;
- métriques et logs sans données personnelles ni secrets.

### 8.5 Historique, fiscalité et preuves

Le schéma `AuditLog` MongoDB est un journal applicatif utile, mais reste un document mutable. Il ne suffit pas à démontrer l'inaltérabilité attendue pour une caisse ou une preuve sanitaire sensible. Pour les événements concernés :

- append-only au niveau applicatif et permissions DB dédiées ;
- hash chaîné ou lots scellés ;
- séquences et clôtures ;
- horodatage fiable ;
- corrections par événements compensatoires ;
- export signé et vérifiable ;
- politique de conservation par catégorie ;
- test de restauration et de vérification d'intégrité.

### 8.6 Sauvegarde et restauration

Une sauvegarde nocturne existe, avec stockage R2 ou artefact GitHub en repli. Les limites observées sont importantes :

- le workflow peut finir vert sans sauvegarder si les secrets ne sont pas configurés ;
- l'export peut être partiel lorsque PostgreSQL est indisponible ;
- le repli GitHub transporte potentiellement des données de production ;
- le workflow de restauration valide et compte les données, mais ne réalise pas une restauration complète vers une base ;
- RPO, RTO, chiffrement applicatif et tests de restauration ne sont pas démontrés.

Priorité : un test mensuel automatisé vers des bases éphémères, avec mesure du temps, comptage, intégrité et contrôle d'un échantillon métier.

---

## 9. Sécurité

L'audit de sécurité détaillé et son contrat machine sont livrés séparément dans [le rapport de scan](security-scan/report.md). Cette section donne la lecture produit et les priorités ; le rapport dédié garde les localisations exactes, la couverture et les remédiations.

### 9.1 Posture générale

Le dépôt montre une vraie culture de sécurité : Argon2, validation des secrets de production, rôles, guards tenant, vérification de signature Stripe, throttling, tests d'isolation, gitleaks, clés d'idempotence et documentation d'exploitation. Le niveau n'est néanmoins pas encore suffisant pour multiplier les restaurants, appareils et données RH/HACCP.

Les risques les plus structurants portent sur :

- la confiance accordée aux origines et aux URLs configurables par les clients ;
- la durée de vie et la révocation des jetons utilisateur/appareil ;
- l'isolation tenant principalement garantie par l'application ;
- des exports ou logs susceptibles de devenir des canaux d'injection ou de fuite ;
- l'absence d'en-têtes défensifs sur les surfaces publiques ;
- des dépendances de production vulnérables ;
- une sauvegarde/restauration qui n'est pas encore une preuve de continuité.

### 9.2 Dépendances

`pnpm audit --prod` trouve, sur le snapshot audité, **3 vulnérabilités hautes et 1 modérée** :

- Drizzle ORM 0.44.7 : injection possible si une entrée non fiable atteint un identifiant SQL dynamique ; correctif disponible en 0.45.2 ;
- `image-size` via Expo/Metro : deux dénis de service de parsing, sans correctif publié par l'audit ; exposition vraisemblablement liée à l'outil de build, à confirmer ;
- `uuid` via la chaîne Expo : écriture partielle de buffer, exposition indirecte et probablement build-time.

Action : mettre à jour Drizzle en priorité après tests supply. Pour Expo/Metro, suivre les versions amont, confirmer qu'aucun upload utilisateur n'atteint ce parseur et documenter l'acceptation temporaire du risque.

### 9.3 Authentification et session

Le web stocke le bearer JWT en `localStorage`. Cela rend une XSS particulièrement dommageable. Pour les surfaces web administratives : cookie `HttpOnly`, `Secure`, `SameSite` adapté, session courte, refresh rotatif, révocation et MFA pour owners/sm_admin. Pour POS/KDS : identité appareil distincte, rotation, révocation immédiate et revalidation des sockets.

### 9.4 En-têtes et CORS

L'API active actuellement `origin: true` avec `credentials: true`, ce qui reflète largement l'origine appelante. Le web et l'API publics ne présentent pas les en-têtes défensifs usuels lors du contrôle. Mettre en place :

- allowlist CORS par environnement et domaines tenant validés ;
- CSP progressive, `frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy et HSTS au proxy ;
- suppression de `x-powered-by` ;
- stratégie explicite pour les embeds plutôt qu'une autorisation générale.

### 9.5 Politique avant extension du parc

1. Corriger les constats élevés du rapport dédié.
2. Publier une politique de sécurité et un canal de signalement.
3. Ajouter tests d'autorisation inter-tenant et de révocation à la CI.
4. Séparer les secrets par environnement et service ; rotation documentée.
5. Centraliser logs de sécurité, alertes et corrélation sans PII.
6. Réaliser un test d'intrusion externe avant encaissement à grande échelle ou HACCP connecté.

