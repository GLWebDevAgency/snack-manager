# Snack Manager — Contraintes business & produit (spec de référence)

> **Statut** : spécification extraite des maquettes haute-fidélité. Version 1.
> **Sources** (lues intégralement, seules sources de vérité de ce document) :
> - `Menu Trivolet Redesign (1)/SM - Roadmap Produit 12 mois.html`
> - `Menu Trivolet Redesign (1)/SM - Écosystème & Flux.html`
> - `Menu Trivolet Redesign (1)/SM - FAQ Support.html`
> - `Menu Trivolet Redesign (1)/SM - Offre 360.html`
>
> **Nature de ces 4 fichiers** : ce ne sont pas des écrans applicatifs à recréer, mais des **documents de contraintes produit** (roadmap, hub écosystème, base de connaissance support, offre commerciale). Ils fixent : l'ordre de build officiel, les critères de sortie par trimestre, les flux d'événements inter-apps, les obligations légales (NF525 / loi anti-fraude TVA, RGPD), les règles de theming multi-tenant et la structure exacte des offres/plans pour le modèle de données des abonnements.
>
> **Règle d'or de cette spec** : tout ce qui est cité entre guillemets est du texte exact de la maquette. Tout comportement non décrit dans les sources est marqué **« à définir »** — rien n'est inventé.

---

## Table des matières

1. [Vue d'ensemble de l'écosystème](#1-vue-densemble-de-lécosystème)
2. [Roadmap produit 12 mois — ordre de build officiel](#2-roadmap-produit-12-mois--ordre-de-build-officiel)
3. [Règles de gouvernance produit](#3-règles-de-gouvernance-produit)
4. [Flux inter-applications (événements déclencheurs)](#4-flux-inter-applications-événements-déclencheurs)
5. [Contraintes légales et de support (FAQ)](#5-contraintes-légales-et-de-support-faq)
6. [Structure exacte des offres / plans (modèle d'abonnement)](#6-structure-exacte-des-offres--plans-modèle-dabonnement)
7. [Theming multi-tenant (marque grise)](#7-theming-multi-tenant-marque-grise)
8. [Tokens de design observés dans les 4 documents](#8-tokens-de-design-observés-dans-les-4-documents)
9. [Structure, layout et interactions des 4 documents sources](#9-structure-layout-et-interactions-des-4-documents-sources)
10. [Données lues/écrites — implications API & modèle MongoDB](#10-données-luesécrites--implications-api--modèle-mongodb)
11. [Copy exacte (textes intégraux à réutiliser)](#11-copy-exacte-textes-intégraux-à-réutiliser)
12. [Points « à définir »](#12-points--à-définir-)

---

## 1. Vue d'ensemble de l'écosystème

### 1.1 Positionnement

Titre du hub écosystème : **« Une plateforme, cinq applications, une seule base visuelle. »**

Lead exact : « Toutes les apps partagent le design system Snack Manager (sombre, Inter, rayons doux) et se rebrandent aux couleurs de chaque restaurant — logo, nom, accent — sans toucher aux couleurs fonctionnelles. »

### 1.2 Les 5 applications produit (surface à construire)

| App | Cible / device (tag exact) | Description exacte (maquette) |
|---|---|---|
| **Commande en ligne** | « Mobile · client final » | « Module client marque blanche : carte, configurateurs, créneaux, paiement CB, fidélité. S'intègre au site du resto ou vit seul. » |
| **Caisse (POS)** | « Tablette · équipe » | « Prise de commande comptoir & téléphone, sur place / à emporter, config express (recette, sauces, menus), encaissement. » |
| **App Cuisine (KDS)** | « Tablette + téléphone · cuisine » | « Colonnes Nouveau / En prépa / Prêt, minuteurs, alertes sonores, n° de retrait, impression ticket cuisine & sticker sac. » |
| **Back-office Restaurant** | « Desktop · gérant » | « Commandes live, menu & prix, ruptures, promos, horaires, stats CA, avis clients — le poste de pilotage du gérant. » |
| **Back-office Snack Manager** (CRM interne) | « Desktop · interne SM » | « Notre CRM interne : pipeline commercial, clients & onboarding, thèmes marque blanche, facturation MRR, support. » |

Note : le theming tenant s'applique « d'un coup sur **les 4 apps du client** » (Commande en ligne, POS, KDS, Back-office Restaurant). Le CRM interne SM et le site vitrine restent en marque Snack Manager.

### 1.3 Documents satellites référencés par le hub (non applicatifs)

Le hub liste également : Site vitrine SM (« Web public »), Design system « SM Dark » (« la référence UI officielle de toutes les apps »), Dossier fondateur, Analyse MRR/ARR, Offre 360, Catalogue marques virtuelles (« Maki-Ya, Pastella, Wings Club, Green Bowl »), Pitch deck terrain (12 slides · 10 minutes), Kit réseaux sociaux (4 vidéos), One-pager comptoir (A5), Plan éditorial 30 jours, Playbook réseaux sociaux, Scripts de vente, Séquences de relance (« avec horaires d'envoi, règles et cadre légal B2B »), Roadmap produit 12 mois, Kit marques virtuelles (« Contrat partenaire type (0 € / 8 %, obligations, sortie) »), FAQ support client, Proposition commerciale (modèle), Onboarding client J1→J7.

### 1.4 Démo « boucle live »

Bandeau du hub, texte exact : « Démo « boucle live » — Ouvrez les deux, passez commande côté client : elle tombe en cuisine et au back-office en direct. » Boutons : « 1 · App client » et « 2 · Cuisine KDS ».
→ **Contrainte produit** : une commande passée dans le module client doit apparaître **en direct** (temps réel) dans le KDS **et** dans le back-office.

### 1.5 Architecture cible (section « Pour le développement » du hub)

Trois cartes, texte exact :

1. **Next.js multi-tenant** — « Un déploiement, N restaurants : thème (logo, accent) et données isolés par tenant. App Router, API routes, SSR pour le SEO des modules de commande. »
2. **Temps réel & matériel** — « Commandes poussées en temps réel (WebSocket) vers KDS/POS/BO. Imprimantes thermiques ESC/POS : ticket cuisine (acceptation) et sticker sac (prêt). »
3. **Paiement & comptes** — « Paiement en ligne CB (Stripe), paiement au retrait, comptes clients + fidélité par restaurant, facturation SaaS (mise en place + abonnement). »

---

## 2. Roadmap produit 12 mois — ordre de build officiel

Principe directeur (texte exact) : « chaque trimestre livre quelque chose qu'un restaurant PAIE. On ne construit jamais deux trimestres d'avance, et le pilote Class'Food valide tout avant le premier client externe. »

### 2.1 T1 — « Le socle qui encaisse » (mois 1–3)

**Objectif : « Class'Food tourne à 100 % sur notre système, plus aucun outil tiers. »**

| Mois | Livrables (texte exact) |
|---|---|
| **M1** | « Modèle de données multi-tenant, auth (PIN staff + comptes gérant), back-office resto : CRUD menu complet (catégories drag & drop, options, ruptures), import CSV. » |
| **M2** | « POS tablette (React Native) : prise de commande, options express, commande téléphone, impression tickets ESC/POS, totaux, clôture de caisse. Offline-first dès le départ — non négociable. » |
| **M3** | « KDS temps réel (colonnes, minuteurs, agrégat « à lancer », son), pointage équipe. **Bascule Class'Food en production réelle.** » |

**Critère de sortie T1** : « 30 jours de services complets au Class'Food sans retour au papier, temps moyen d'encaissement < 45 s, zéro commande perdue. »

### 2.2 T2 — « Le canal qui rapporte » (mois 4–6)

**Objectif : « la commande en ligne 0 % commission en production + les 3 premiers clients payants installés. »**

| Mois | Livrables (texte exact) |
|---|---|
| **M4** | « Commande en ligne client : menu, panier, personnalisation, créneaux de retrait, Stripe + paiement au comptoir, suivi de statut temps réel sans compte. » |
| **M5** | « Import de carte par photo (IA) : pipeline extraction → validation ligne à ligne. C'est l'arme d'onboarding — la démo « votre carte en 24 h » doit devenir vraie à 100 %. » |
| **M6** | « Durcissement multi-tenant (thème marque grise runtime, isolation données), monitoring, sauvegardes, page de statut. **Installation des clients fondateurs 1–3.** » |

**Critère de sortie T2** : « 3 restos externes en production, ≥ 15 % de leurs commandes du soir passent en ligne au bout de 30 jours, support < 2 appels/resto/semaine. »

### 2.3 T3 — « La rétention » (mois 7–9)

**Objectif : « le gérant ouvre le back-office tous les jours sans qu'on le lui demande. »**

| Mois | Livrables (texte exact) |
|---|---|
| **M7** | « Statistiques utiles : CA jour/semaine, top ventes, heures de pointe, digest hebdo automatique (« ta semaine en 10 lignes » par SMS/email). » |
| **M8** | « Fidélité simple (tampon digital par téléphone), codes promo, gestion des avis Google depuis le back-office. » |
| **M9** | « CRM interne SM : pipeline leads, relances tracées, compteur fondateur, facturation abonnements automatisée (Stripe Billing). Clients 4–7. » |

**Critère de sortie T3** : « connexion gérant ≥ 5 j/7 sur 80 % du parc, churn 0, MRR ≥ 1 000 €. »

### 2.4 T4 — « L'échelle » (mois 10–12)

**Objectif : « les 10 places fondateur remplies, l'offre marques virtuelles opérationnelle. »**

| Mois | Livrables (texte exact) |
|---|---|
| **M10** | « Intégration marques virtuelles : menus des 4 marques injectés chez le partenaire, tickets plateformes agrégés dans le KDS (saisie manuelle assistée d'abord, intégrations API ensuite). » |
| **M11** | « SM Boost outillé : tableau de bord des performances plateformes du client, rapport mensuel généré. » |
| **M12** | « Consolidation : dette technique, audit sécurité, RGPD complet, doc support. Décision T+1 : livraison en propre OU multi-établissement — selon la demande réelle des clients, pas l'intuition. » |

**Critère de sortie T4** : « 10 clients suite + 2 partenaires marques virtuelles, MRR ≥ 2 000 €, un mois complet sans intervention fondateur en cuisine. »

### 2.5 Refus explicites de l'année 1

Texte exact (bloc `warn`) : « **Ce qu'on refuse en année 1 :** app livreur, multi-établissement, comptabilité intégrée, réservation de tables, app client native, international. Chaque « oui » à ça est un « non » à la fiabilité du service du vendredi soir. »

→ **Contrainte pour l'architecture** : ces features ne doivent pas être construites en V1, mais le modèle de données ne doit pas les rendre impossibles (la décision multi-établissement est explicitement reportée à M12/T+1).

---

## 3. Règles de gouvernance produit

Table exacte de la roadmap :

| Règle | Application (texte exact) |
|---|---|
| **Le comptoir décide** | « Une feature n'entre en roadmap que si un client (ou Class'Food) a le problème CETTE semaine. Les demandes fondateur passent en premier — c'est la promesse vendue. » |
| **Une dette assumée** | « Tout raccourci pris est noté dans un registre avec sa date de remboursement (M12 max). Pas de registre = pas de raccourci. » |
| **Le vendredi soir est sacré** | « Aucun déploiement jeudi–dimanche. Les restos vivent le week-end ; on livre lundi–mercredi matin. » |
| **Offline d'abord** | « POS et KDS doivent finir un service complet sans internet. Toute feature qui casse ça est refusée, quelle que soit sa valeur. » |

→ **Contraintes d'ingénierie dérivées** :
- Fenêtre de déploiement autorisée : **lundi–mercredi matin uniquement**. Jamais jeudi→dimanche.
- **Offline-first obligatoire** pour POS et KDS (un service complet sans internet). Toute PR qui casse l'offline est refusée par principe.
- Registre de dette technique obligatoire, remboursement au plus tard M12.

---

## 4. Flux inter-applications (événements déclencheurs)

Les 5 flux ci-dessous sont **documentés dans le hub** (section « Flux d'utilisation documentés » / « Comment tout se connecte »). Les étapes en *déclencheur système* sont celles marquées `alt` (pastille verte) dans la maquette — ce sont des **événements automatiques**, par opposition aux actions utilisateur (pastille laiton).

### 4.1 Flux 1 · Commande client (en ligne)

Sous-titre exact : « Module commande → Back-office (temps réel) → KDS → retrait »

| # | Étape (texte exact) | Type |
|---|---|---|
| 1 | « Le client ouvre la carte (module ou site) » | Action client |
| 2 | « Configure son produit (taille, recette, sauces, menu +2,50 €) » | Action client |
| 3 | « Panier · code promo · fidélité » | Action client |
| 4 | « Choisit son créneau de retrait » | Action client |
| 5 | « Paye en ligne (CB) ou au retrait » | Action client |
| 6 | « La commande apparaît en « Nouveau » sur le KDS + alerte sonore » | **Déclencheur système** |
| 7 | « Ticket cuisine imprimé à l'acceptation » | **Déclencheur système** (sur événement « Accepter » du KDS) |
| 8 | « Passage « Prêt » → sticker sac imprimé + SMS au client » | **Déclencheur système** (sur changement de statut) |
| 9 | « Remise au comptoir via n° de retrait » | Action équipe |

**Événements dérivés pour l'API** :
- `order.created` (canal en ligne) → push temps réel KDS (colonne « Nouveau ») + alerte sonore + visibilité back-office.
- `order.accepted` → impression ESC/POS « ticket cuisine ».
- `order.ready` → impression « sticker sac » + envoi SMS client.
- Remise identifiée par le **numéro de retrait** (affiché sur l'écran de confirmation du client, cf. FAQ #4).

### 4.2 Flux 2 · Commande comptoir / téléphone (POS)

Sous-titre exact : « Caisse → KDS → encaissement »

| # | Étape (texte exact) | Type |
|---|---|---|
| 1 | « Le caissier choisit Sur place / À emporter / Téléphone » | Action équipe |
| 2 | « Ajoute les produits (config express : Complet, ST, SO, SC…) » | Action équipe |
| 3 | « Le ticket cumule les lignes identiques » | Règle système |
| 4 | « Encaissement CB / espèces (ou à la remise) » | Action équipe |
| 5 | « Envoi direct en cuisine — même file que le en-ligne » | **Déclencheur système** |

**Contraintes** : 3 modes de commande POS (« Sur place / À emporter / Téléphone ») ; abréviations de configuration express affichées : « Complet, ST, SO, SC… » (signification exacte des abréviations : **à définir**, cf. maquette POS hors périmètre de ce lot) ; cumul automatique des lignes identiques sur le ticket ; **file de préparation unique** partagée entre POS et en ligne.

### 4.3 Flux 3 · Service en cuisine (KDS)

Sous-titre exact : « Tablette en cuisine · téléphone en secours »

| # | Étape (texte exact) | Type |
|---|---|---|
| 1 | « « Nouveau » : alerte sonore + ticket flash » | Événement entrant |
| 2 | « Accepter → impression ticket cuisine (préparation du sac en amont) » | Action cuisine → **impression** |
| 3 | « Minuteur par commande (vert < 5 min · ambre < 10 · rouge au-delà) » | Règle système |
| 4 | « « Prête » → sticker sac + notification client » | Action cuisine → **impression + notification** |
| 5 | « « Remise » → commande archivée, stats mises à jour » | Action → **archivage + stats** |

**Seuils de minuteur KDS (valeurs officielles)** : **vert < 5 min, ambre < 10 min, rouge au-delà de 10 min** (compté par commande).
Statuts du cycle de vie côté cuisine : **Nouveau → En prépa → Prêt → Remise** (colonnes « Nouveau / En prépa / Prêt » + statut terminal « Remise » qui archive et met à jour les stats). Un agrégat « à lancer » existe au niveau KDS (roadmap M3). Le KDS émet un son à l'arrivée d'une commande, et affiche un « ticket flash ».

### 4.4 Flux 4 · Pilotage du restaurant (Back-office)

Sous-titre exact : « Le gérant, matin et fin de service »

Étapes exactes :
1. « Suivi live des commandes et du CA du jour »
2. « Menu & prix : dispo, ruptures, nouveautés »
3. « Promos & menu du moment (poussés sur le module client) »
4. « Horaires & fermetures exceptionnelles (pilotent les créneaux) »
5. « Équipe : pointage, plannings, absences »
6. « Avis clients : réponse publique en 1 clic »

**Événements dérivés** :
- Modification menu/prix/dispo → propagée **partout en ≤ 30 s** (« caisse, cuisine, commande en ligne », cf. FAQ #6), sans redémarrage.
- Promos / « menu du moment » → poussés vers le module de commande client.
- Horaires + fermetures exceptionnelles → **pilotent la génération des créneaux de retrait** du module en ligne.
- Réponse à un avis → publication publique en 1 clic.

### 4.5 Flux 5 · Cycle de vie client Snack Manager (CRM interne)

Sous-titre exact : « De la prospection au restaurant actif »

Étapes exactes :
1. « Contact entrant (site, démarchage, bouche-à-oreille) »
2. « Démo planifiée (sur place, 30 min) »
3. « Devis : mise en place + abonnement »
4. « Onboarding : menu importé, équipe créée, matériel, formation, mise en ligne »
5. « Actif : abonnement MRR + support continu » *(étape `alt` = état final système)*

→ Pipeline CRM : `contact → démo → devis → onboarding → actif`. Le devis distingue **mise en place** (one-shot) et **abonnement** (récurrent).

### 4.6 Flux complémentaires issus de la FAQ (comportements produit engagés auprès des clients)

Ces comportements sont promis mot pour mot aux gérants — ils sont donc contractuels pour le développement :

- **Coupure internet** (FAQ #1) : POS et KDS fonctionnent sans internet ; « Tout se synchronise tout seul au retour du réseau » ; la commande en ligne « affiche automatiquement "indisponible" aux clients ». Technique : « vérifier la file de sync au retour réseau ; si commandes en ligne perdues pendant la coupure, rappeler les clients concernés (liste dans le back-office) ». → il faut une **file de synchronisation** consultable + une **liste des clients des commandes en ligne perdues** dans le back-office.
- **Imprimante** (FAQ #2) : redémarrage imprimante depuis « Réglages caisse → Périphériques » ; le KDS permet de tourner sans papier.
- **KDS muet** (FAQ #3) : geste « tirez vers le bas pour recharger » (pull-to-refresh) ; « le mode dégradé affiche les tickets imprimés en secours ».
- **Paiement en ligne introuvable** (FAQ #4) : recherche d'une commande par **numéro de retrait** « dans la caisse, recherche en haut » ; si paiement non abouti, « l'écran du client le montre, il peut repayer au comptoir sans être débité deux fois ». Technique : « croiser avec Stripe (paiements du jour) avant tout remboursement ».
- **Annulation / remboursement** (FAQ #5) : « Sur la commande, bouton ⋯ → Annuler ou Rembourser. L'annulation avant préparation ne compte pas dans le CA ; le remboursement après paiement CB en ligne repart sur la carte du client sous 2–5 jours. Tout est tracé, rien ne disparaît. »
- **Changement de prix en service** (FAQ #6) : « Back-office → Menu → le produit → prix → Enregistrer. C'est appliqué partout en 30 secondes : caisse, cuisine, commande en ligne. »
- **Rupture** (FAQ #7) : « Back-office ou caisse → appui long sur le produit → Rupture. Il passe grisé en caisse et disparaît de la commande en ligne immédiatement. » Réactivation manuelle le lendemain **ou** automatique si case « jusqu'à demain » cochée.
- **Correction post-import IA** (FAQ #8) : édition directe dans Menu ; « L'import vous pré-remplit 95 % du travail » ; process interne : « si récurrent sur un type de carte, remonter l'exemple au pipeline import ».
- **Disponibilité horaire d'un produit** (FAQ #9) : « Créez le produit, puis Disponibilité → plage horaire. Il n'apparaîtra à la caisse et en ligne que sur ce créneau. » (ex. formule midi 11h30–14h).
- **Annulation d'une commande en ligne par le resto** (FAQ #10) : « Si elle n'est pas en préparation : caisse → la commande → Annuler, le remboursement part tout seul. Si elle est déjà en préparation, c'est votre décision commerciale — le système vous laisse faire les deux. »
- **Pause de la commande en ligne** (FAQ #11) : « Caisse → bouton Pause en ligne (en haut à droite) : 30 min, 1 h, ou jusqu'à demain. Les clients voient "victime de notre succès, revenez à 21h" — pas un site cassé. »
- **Cadence des créneaux** (FAQ #12) : « Back-office → Commande en ligne → Cadence : passez de 6 à 4 commandes par tranche de 15 min. Le système espace automatiquement les créneaux proposés. Réglez-le une fois pour vos vendredis, il s'en souvient. » → cadence paramétrable **par jour de semaine**, mémorisée ; granularité : commandes / tranche de 15 min.
- **Acquisition** (FAQ #13) : « Trois canaux : le lien dans votre bio Instagram/Google, le QR code à coller sur le comptoir et les sacs (on vous fournit le PDF), et votre vitrine. » → génération d'un **QR code PDF** par tenant.
- **PIN oublié** (FAQ #14) : « Back-office → Équipe → l'employé → Réinitialiser le PIN. Lui seul le re-choisit à sa prochaine prise de poste. » → reset ne révèle jamais le PIN ; re-choix à la prochaine connexion.
- **Journal d'audit** (FAQ #15) : « Back-office → Journal : chaque action sensible est signée par le PIN de celui qui l'a faite, avec l'heure. » (annulations, remises au minimum).
- **Mode formation** (FAQ #16) : « La caisse a un mode entraînement (Réglages → Mode formation) : vraies manipulations, fausses commandes, rien ne part en cuisine ni dans le CA. »
- **Abonnement & factures** (FAQ #17) : « Back-office → Abonnement : toutes les factures en PDF, le détail de votre formule, et votre statut fondateur (tarif gelé). Le prélèvement est le même chaque mois. »
- **Export / réversibilité** (FAQ #18) : « Back-office → Exporter (menu, historique des commandes, clients) en CSV standard. Sans engagement veut dire sans otage. »
- **Confidentialité des données** (FAQ #19) : « Vous et les comptes que vous créez. Nous, on voit des données techniques et des agrégats anonymes pour améliorer le produit — jamais votre détail sans votre accord. C'est contractuel. » → séparation stricte : données tenant vs télémétrie/agrégats anonymes côté SM.

---

## 5. Contraintes légales et de support (FAQ)

### 5.1 FAQ #20 — Obligation légale NF525 / loi anti-fraude TVA (BLOQUANT)

Question exacte : « 20 · « Vous êtes conformes RGPD / caisse certifiée ? » »

Réponse au gérant (texte exact) : « Données hébergées en Europe, registre RGPD tenu, et le module d'encaissement suit les exigences françaises de la loi anti-fraude TVA (**inaltérabilité, sécurisation, conservation, archivage**) — l'attestation est disponible dans Back-office → Abonnement. »

Note interne (texte exact) : « **Interne : l'attestation NF525/LNE ou auto-certification éditeur doit exister AVANT le premier client facturé — point juridique bloquant, pas cosmétique.** »

**Contraintes d'implémentation dérivées** :
1. Le module d'encaissement (POS + tout ce qui touche l'encaissement) doit satisfaire les 4 exigences de la loi anti-fraude TVA : **inaltérabilité, sécurisation, conservation, archivage** des données d'encaissement.
2. Une **attestation** (certification NF525/LNE **ou** auto-certification éditeur) doit être produite et **téléchargeable depuis Back-office → Abonnement**.
3. Jalon juridique : l'attestation doit exister **avant le premier client facturé** (donc avant M6 / installation des clients fondateurs 1–3 — cf. roadmap T2).
4. Cohérence avec la FAQ #5 et #15 : « Tout est tracé, rien ne disparaît » — annulations/remboursements jamais supprimés, journal d'audit signé par PIN + horodatage. Ce sont des briques de l'inaltérabilité.

### 5.2 RGPD

- « Données hébergées en Europe, registre RGPD tenu » (FAQ #20).
- Roadmap M12 : « audit sécurité, RGPD complet, doc support ».
- FAQ #18 : export CSV standard des données du tenant (menu, historique des commandes, clients) — droit à la portabilité et réversibilité.
- FAQ #19 : accès aux chiffres limité au gérant et aux comptes qu'il crée ; SM ne voit que « des données techniques et des agrégats anonymes » — engagement contractuel.
- Le hub référence aussi un « cadre légal B2B » pour les séquences de relance (détail dans `SM - Séquences de Relance.html`, hors périmètre de ce lot : **à définir** ici).

### 5.3 Règle de support (SLA)

Texte exact (bloc `warn` de la FAQ) : « **Règle de support :** en service (11h30–14h / 18h30–22h), on répond en moins de 5 minutes et on donne d'abord le geste qui sauve le service — l'explication vient après la fermeture. Hors service, tout ce qui touche l'argent (paiements, remboursements, factures) se traite le jour même. »

**Paramètres** :
- Fenêtres « SERVICE » : **11h30–14h** et **18h30–22h**.
- SLA en service : réponse **< 5 minutes**, geste opérationnel d'abord.
- Hors service : tout sujet argent (paiements, remboursements, factures) traité **le jour même**.
- Les FAQ marquées « SERVICE » (situations 1, 2, 3, 4) sont priorité absolue : « elles se traitent en minutes, pas en heures ».
- Critère de sortie T2 associé : « support < 2 appels/resto/semaine ».

### 5.4 Structure de chaque fiche FAQ (pour la base de connaissance)

Modèle éditorial imposé (lead exact) : « Chaque réponse : d'abord ce qu'on dit au gérant (simple, rassurant), puis l'action technique. »
→ Modèle de données d'une fiche support : `{ numéro, titre, tag_service?: bool, réponse_gérant, action_technique?, note_interne? }`. Catégories exactes : « Urgences en service » (1–5), « Menu & prix » (6–9), « Commande en ligne » (10–13), « Équipe & compte » (14–16), « Facturation & données » (17–20).

---

## 6. Structure exacte des offres / plans (modèle d'abonnement)

Source : `SM - Offre 360.html` (« Offre élargie · confidentiel · v1 »). Titre : « L'offre 360 : le logiciel, le studio IA, *et le chiffre d'affaires en plus*. »

### 6.1 Les trois piliers (types de revenus)

| Pilier | Nom | Contenu (texte exact) | Prix (texte exact) | Type de revenu |
|---|---|---|---|---|
| **Pilier 1 · SaaS** | « La suite Snack Manager » | « Caisse, cuisine, commande en ligne, back-office. La base de la relation. » | « **89–189 € /mois** » | « MRR » |
| **Pilier 2 · Studio IA** | « Services & création » | « Onboarding IA, refonte de carte, identité visuelle — ce qu'on a fait pour Class'Food, industrialisé. » | « **290–2 490 €** one-shot · options /mois · Boost 99 €/mois » | One-shot + options récurrentes |
| **Pilier 3 · Marques** | « Marques virtuelles » | « Un concept livraison clé en main dans la cuisine du partenaire. Zéro droit d'entrée. » | « **8 %** de commission » | « revenu variable » |

Logique commerciale (texte exact) : « chaque pilier vend les deux autres. Le resto équipé de la suite active une marque virtuelle en un clic ; le resto venu pour une marque virtuelle adopte la suite ; le studio crée le lien de confiance dès le premier jour. »

### 6.2 Pilier 1 — Suite SaaS

> **Mise à jour du 21/08/2026 — la grille n'est plus « à définir ».** Le fondateur a arrêté trois formules : **Essentiel 99 €**, **Complet 159 €**, **Boost 199 €** par mois, hors taxes. Engagement annuel : **deux mois offerts** (douze mois payés dix), soit 990 / 1 590 / 1 990 € par an. Module **Commande en ligne & fidélité** : 79 €/mois **plus 55 € de mise en service, une seule fois** — les deux compris dans Boost.
>
> Les montants ci-dessous décrivent l'INTENTION DE DÉPART (fourchette 89–189, MRR de référence 139) et sont conservés comme trace de la source. Ils ne pilotent plus rien : la grille qui fait loi est `PLAN_MRR_CENTS` dans `packages/contracts/src/crm.ts`, que le CRM et la facturation lisent tous les deux. Un prix corrigé ici sans l'être là-bas ne changerait aucune facture.

- Fourchette officielle : **89–189 €/mois** (MRR).
- Le MRR de référence utilisé dans les simulations est **139 €/mois** (ligne « SaaS seul (référence) » du tableau d'impact).
- Une formule nommée « **Complet** » existe (le service A6 est « inclus dans l'offre Complet »). Le détail des formules SaaS individuelles (noms, paliers exacts entre 89 et 189 €) n'est pas dans ces 4 fichiers : **à définir** (cf. site vitrine / proposition commerciale).
- **Frais d'installation : 290 €**, justifiés par l'onboarding IA (« Inclus dans les frais d'installation : c'est lui qui justifie les 290 €. »). Cohérent avec le flux CRM « Devis : mise en place + abonnement » et l'architecture « facturation SaaS (mise en place + abonnement) ».
- **Statut fondateur** : « tarif gelé » (FAQ #17), « compteur fondateur » au CRM (roadmap M9), « les 10 places fondateur » (T4). → le modèle d'abonnement doit porter un flag `fondateur` avec gel tarifaire.
- Sans engagement (FAQ #18 : « Sans engagement veut dire sans otage »), prélèvement mensuel constant (FAQ #17), facturation automatisée **Stripe Billing** (roadmap M9), factures PDF téléchargeables.

### 6.3 Pilier 2 — Studio IA : catalogue exact des services

**Flagship** (pill « Flagship ») : « **Onboarding IA « photo → back-office » en 24 h** » — « Photos du menu (même manuscrit) → extraction IA des produits, prix, options et suppléments → carte structurée, descriptions réécrites, catégories rangées, allergènes suggérés → le gérant valide, c'est en ligne. Inclus dans les frais d'installation : c'est lui qui justifie les 290 €. »

| Code | Service (nom exact) | Description / contenu clé | Prix (texte exact) |
|---|---|---|---|
| A1 | « Refonte de carte & pricing psychologique » | « ancres, menus, ordre des sections, prix optimisés — avec simulateur d'impact en euros » | « 690–1 490 € selon la taille de la carte » |
| A2 | « Identité visuelle complète » | « Logo retravaillé, flyer trivolet, habillage vitrine, templates réseaux sociaux — déclinés automatiquement dans l'app en marque blanche » | « 990–2 490 € » |
| A3 | « Descriptions & photos de plats assistées » | « Réécriture vendeuse de chaque fiche produit, retouche/détourage des photos du gérant, cohérence de ton sur toute la carte » | « Inclus Studio ou 290 € seul » |
| A4 | « Réponses aux avis auto-préparées » | « Chaque avis Google/app reçoit un brouillon de réponse personnalisé dans le back-office — le gérant relit, touche « Envoyer » » | « Option 19 €/mois » |
| A5 | « Promos & SMS marketing générés » | « « Mardi pluvieux, 18h, CA en retard de 12 % » → campagne SMS/notification prête à valider, ciblée sur les clients fidélité inactifs » | « Option 29 €/mois » |
| A6 | « Prévisions & alertes intelligentes » | « Rush prévu, rupture estimée à 20h40, staffing recommandé — déjà maquetté dans le back-office » | « Différenciateur inclus dans l'offre Complet » |
| A7 | « Pricing dynamique conseillé » | « Suggestions trimestrielles de prix par produit (coût matière, volumes, concurrence locale) avec impact simulé — jamais appliquées sans validation » | prix : **à définir** |
| A8 | « Traduction & accessibilité de la carte » | « Carte client en EN/ES/AR en un clic pour les zones touristiques, descriptions allergènes normalisées » | prix : **à définir** |
| A9 | « Assistant téléphone (plus tard) » | « Prise de commande vocale IA aux heures de rush — l'appel devient un ticket KDS. **Année 2+**, quand le volume le justifie » | hors année 1 |
| A10 | « Digest hebdo du gérant » | « Chaque lundi : « ta semaine en 10 lignes » — CA, top ventes, avis, anomalie caisse éventuelle, 1 action recommandée. Rétention pure » | prix : **à définir** (lié à M7 roadmap) |

### 6.4 SM Boost (« Nouveau produit »)

Titre exact : « **SM BOOST — on pilote VOTRE marque sur Uber Eats & Deliveroo** ».
Contenu exact : « menu restructuré (nommage, hiérarchie, prix psychologiques), visuels IA qualité studio, promos ciblées sur les créneaux creux, gestion des avis, rapport mensuel clair, account manager 7 j/7. Objectif : **+30 % de CA livraison en 60 jours** — à 99 €/mois, le service se rembourse dès le premier mois. »

| Plan | Prix | Contenu (texte exact) |
|---|---|---|
| **Essentiel** | **99 €/mois** | « 1 marque gérée · tous les leviers inclus · sans engagement » |
| **Pro** *(pill « populaire »)* | **149 €/mois** | « 2 marques gérées (ex : marque propre + 1 marque virtuelle) » |
| **Premium** | **199 €/mois** | « 3 marques gérées · option photos IA pro : **399 € one-shot** » |

Outillage produit associé (roadmap M11) : « SM Boost outillé : tableau de bord des performances plateformes du client, rapport mensuel généré. »

### 6.5 Pilier 3 — Marques virtuelles

Référence de marché citée : « Mealship, n°1 des marques virtuelles halal en France (+100 restaurants, +80 villes) — même équipe, même matériel, mêmes horaires. Nous répliquons le modèle en l'intégrant à notre suite : le partenaire pilote tout depuis son back-office Snack Manager. »

**Ce que SM prend en charge** (liste exacte) :
- « Comptes Uber Eats & Deliveroo créés et gérés »
- « Gestion & optimisation des marques (menus, photos, positionnement) »
- « Marketing et promotions sur les plateformes »
- « Formation du staff aux recettes et au dressage »
- « Support dédié 7 j/7 »
- « Intégration native : les commandes tombent dans le KDS, comme le reste »

**Conditions partenaire** (valeurs exactes) :
- « **0 €** de droit d'entrée »
- « **8 %** de commission **plafonnée** sur le CA marque virtuelle » (valeur du plafond : **à définir** — non précisée dans ces fichiers ; le Kit marques virtuelles est référencé « Contrat partenaire type (0 € / 8 %, obligations, sortie) »)
- « **3 sem.** du oui au premier ticket — recettes standardisées, produits sourçables chez ses fournisseurs »

**Catalogue au lancement** : « 4 marques · halal » :

| Marque | Concept (texte exact) | Argument clé (texte exact) |
|---|---|---|
| **MAKI-YA** | « Japonais street · sushi, maki, poke » | « Le concept à plus forte valeur perçue : panier moyen 24–28 €, produits froids = zéro conflit avec le poste chaud pendant le rush. » |
| **PASTELLA** | « Pâtes fraîches en box » | « 3 bases, 6 sauces, 90 secondes par plat — la marge la plus haute du catalogue (coût matière ~22 %). Idéal cuisines déjà équipées feux/plaques. » |
| **WINGS CLUB** | « Chicken wings & tenders · sauces signature » | « Réutilise la friteuse existante à 100 %. Le complément naturel des snacks/kebabs — mise en route la plus rapide (2 semaines). » |
| **GREEN BOWL** | « Bowls & salades healthy » | « Capte la clientèle midi bureaux que le snack ne touche pas. Produits froids, assemblage pur, aucune cuisson ajoutée. » |

**Exemple partenaire (mois type)** — tableau exact :

| Scénario | CA marque virtuelle | Commission SM (8 %) | « Ce qui reste au resto* » |
|---|---|---|---|
| « Démarrage (M1–M2) » | 1 500 € | 120 € | ≈ 430 € |
| « Régime de croisière » | 3 500 € | 280 € | ≈ 1 010 € |
| « Bon emplacement, 2 marques » *(ligne surlignée)* | 6 000 € | 480 € | ≈ 1 730 € |

Note exacte : « * Marge nette estimée après commission plateforme (~30 %), coût matière (~30 %) et notre commission — sur un CA qu'il n'avait pas, sans investissement ni embauche. »

Différenciateur exact : « le partenaire garde SA marque principale (site, fidélité, 0 % commission en direct) et pilote la marque virtuelle dans le même back-office. Personne d'autre ne combine les deux. »

### 6.6 Profils clients combinés (tableau d'impact — base du modèle d'abonnement)

Titre : « Le client 360 vaut trois fois le client SaaS ». Tableau exact :

| Profil client | MRR SaaS | Services (lissé/mois) | Commission marques | Revenu total /mois |
|---|---|---|---|---|
| « SaaS seul (référence) » | 139 € | — | — | **139 €** |
| « SaaS + Studio (options IA) » | 139 € | ≈ 80 € | — | **≈ 219 €** |
| « Client 360 (+1 marque virtuelle) » *(surligné)* | 139 € | ≈ 80 € | ≈ 280 € | **≈ 499 €** |
| « Client 360 + SM Boost » | 139 € | ≈ 179 € | ≈ 280 € | **≈ 598 €** |

Indicateurs affichés : « ×3,6 » (« ARPA du client 360 vs client SaaS seul — sans coût d'acquisition supplémentaire : c'est le même restaurant. »), « Churn ↓ » (« Un resto dont on gère aussi le CA livraison ne part plus : trois liens contractuels au lieu d'un. »), « + scalable » (« La commission suit le CA des partenaires — le revenu croît sans vendre de nouveau compte. L'analyse MRR/ARR ne comptait aucun de ces upsides. »).

Projection : « Si 30 % des clients du scénario central activent une marque virtuelle en croisière : ≈ +75 clients 360 à M36 → ≈ +250 k€/an de commissions au-dessus des 390 k€ d'ARR SaaS. À modéliser sérieusement après 5 pilotes. »

### 6.7 Prochaines étapes officielles (section 05)

Liste exacte :
1. « **Pilote onboarding IA chez Class'Food** : rejouer l'import de la carte par photos, chronométrer, en faire la démo vidéo de vente. »
2. « **1 concept de marque virtuelle d'abord** (Wings Club, le plus simple) testé dans la cuisine pilote 4 semaines : recettes, coûts réels, CA livraison constaté. »
3. « **Standardiser le Studio** : le livrable Class'Food (carte + identité + argumentaire) devient une offre packagée à 3 prix. »
4. « **Mettre à jour l'analyse MRR/ARR** avec les données des pilotes — pas avant. »

### 6.8 Schéma d'abonnement dérivé (pour MongoDB)

Entités strictement dérivées des sources (champs non cités = **à définir**) :

```
Subscription (par tenant)
├─ plan_saas: { fourchette: 89–189 €/mois, formule: "Complet" | à définir, mrr }
├─ frais_installation: 290 € (one-shot, inclut onboarding IA)
├─ fondateur: { actif: bool, tarif_gelé: bool, place_n°: 1–10 }
├─ options_studio_recurrentes: [ {code: "A4", 19 €/mois}, {code: "A5", 29 €/mois} ]
├─ services_studio_oneshot: [ A1: 690–1 490 €, A2: 990–2 490 €, A3: 290 € (ou inclus), photos_IA_pro: 399 € ]
├─ sm_boost: { plan: "Essentiel"(99 €)| "Pro"(149 €)| "Premium"(199 €), marques_gérées: 1|2|3, sans_engagement: true }
├─ marques_virtuelles: [ { marque: MAKI-YA|PASTELLA|WINGS CLUB|GREEN BOWL,
│     droit_entrée: 0 €, commission: 8 % du CA marque (plafonnée — plafond à définir) } ]
├─ facturation: Stripe Billing, prélèvement mensuel constant, factures PDF
└─ attestation_loi_anti_fraude: document téléchargeable (Back-office → Abonnement)
```

---

## 7. Theming multi-tenant (marque grise)

### 7.1 Ce qui se personnalise à l'onboarding d'un resto

Texte exact : « **Logo (initiale ou fichier), nom + ville, couleur d'accent** — appliqués d'un coup sur les **4 apps** du client. »

Exemples de tenants avec leur couleur d'accent exacte (swatches de la maquette) :

| Tenant | Accent |
|---|---|
| « Class'Food · Perriers » | `#C8281E` |
| « O'Braise · Rouen » | `#E0762F` |
| « Green House · Évreux » | `#2F9E62` |

Un « switcher « Marque » en bas à gauche de chaque app » permet de tester le rebranding dans les maquettes (« → testez avec le switcher « Marque » en bas à gauche de chaque app »).

### 7.2 Couleurs fonctionnelles — règle standard (INVARIANTE)

Texte exact (bloc `rule-note`) : « **Standard :** les couleurs fonctionnelles ne changent jamais d'un compte à l'autre — **vert = prêt/positif, rouge = nouveau/urgent, ambre = en attente**. Une équipe formée chez un client sait travailler chez tous. »

- Le rouge marque « nouveau/urgent » (alerte), le vert « prêt/positif », l'ambre « en attente » (préparation). Ces sémantiques valent dans toutes les apps et pour tous les tenants, quel que soit l'accent de marque.
- Application au KDS : minuteur « vert < 5 min · ambre < 10 · rouge au-delà ».
- Valeurs hex des couleurs fonctionnelles observées dans ces fichiers : vert `#3fae4a` (hub) / `#3fae6a` (Offre 360), rouge `#c94b3f` (hub). La valeur canonique unique et la valeur ambre/orange exactes sont définies dans `SM - Design System.html` (hors périmètre de ce lot) : **à définir** ici — ne pas déduire.
- Roadmap M6 : le « thème marque grise runtime » et l'« isolation données » par tenant sont un livrable de durcissement explicite.

### 7.3 Marque Snack Manager (apps internes, documents, hub)

- Accent maison « brass/laiton » : `#c9a15a` (fonds sombres) / `#b8893f` (documents fond clair).
- Logo : pastille carrée arrondie noire avec « S » en laiton (favicon SVG : `rect 64×64, rx=14, fill #000`, lettre « S » `#c9a15a`, Arial 800, 32px).

---

## 8. Tokens de design observés dans les 4 documents

> Ces 4 fichiers utilisent deux thèmes : le **thème sombre « SM Dark »** (hub Écosystème, Offre 360) et un **thème document imprimable clair** (Roadmap, FAQ — via le composant `<doc-page>`). La référence officielle complète est `SM - Design System.html` (hors périmètre). Ci-dessous, uniquement les valeurs effectivement présentes dans les sources.

### 8.1 Thème sombre — hub « Écosystème & Flux »

| Token | Valeur |
|---|---|
| `--bg` | `#0a0b0d` |
| `--panel` | `#13151a` |
| `--panel2` | `#1a1d23` |
| `--ink` (texte) | `#f5f6f7` |
| `--mut` (texte secondaire) | `#8b8f98` |
| `--line` (bordures) | `rgba(245,246,247,.12)` |
| `--brass` (accent SM) | `#c9a15a` |
| `--green` | `#3fae4a` |
| `--red` | `#c94b3f` |
| `theme-color` (meta) | `#000000` |

Typographie : `Inter` (Google Fonts, graisses chargées 400;500;600;700;800), fallback `system-ui, sans-serif`, `line-height: 1.5`, `-webkit-font-smoothing: antialiased`.
- h1 : `clamp(32px, 4.4vw, 52px)`, weight 800, `letter-spacing: -.03em`, `line-height: 1.04`, `max-width: 760px`.
- h2 : `26px`, weight 800, `letter-spacing: -.02em`.
- `.lead` : `16.5px`, couleur `--mut`, `max-width: 560px`.
- `.eyebrow` : `11.5px`, weight 700, `letter-spacing: .18em`, uppercase, couleur `--brass`.
- Logo : `19px` weight 800 ; pastille `i` 30×30px, radius `9px`, fond `--brass`, texte `#0a0b0d`.

Layout : `.wrap { max-width: 1180px; padding: 0 32px }` ; header `padding: 60px 0 30px` ; sections `padding: 46px 0` ; grille cartes `repeat(3, 1fr)`, `gap: 16px` ; breakpoint : `@media (max-width: 900px)` → 1 colonne.

Composants :
- `.card` : fond `--panel`, bordure 1px `--line`, radius `16px`, padding `20px`, `transition: border-color .15s, transform .15s`. **Hover (lien)** : `border-color: var(--brass); transform: translateY(-3px)`. Icône `.ic` 38×38px, radius `10px`, fond `--panel2`, pictos SVG 20×20 stroke `currentColor` (brass) width 2. Titre `16px`/700 ; description `13.5px`/1.45 `--mut` ; `.tag` `12px`/700 brass, collé en bas (`margin-top: auto; padding-top: 10px`).
- `.flow` : fond `--panel`, bordure `--line`, radius `16px`, padding `22px`, `margin-bottom: 14px`. h3 `16.5px`/800 ; `.sub` `13.5px` `--mut`.
- `.steps` (pastilles d'étapes) : pills `border-radius: 999px`, fond `--panel2`, bordure `--line`, `padding: 7px 14px 7px 8px`, `13px`/600, `gap: 8px`, numéro auto (compteur CSS) dans un cercle 20×20px fond `--brass` texte `#0a0b0d` `11px`/800. Variante `.alt` (étape système) : cercle fond `--green`, texte `#fff`.
- `.rule-note` : fond `--panel2`, `border-left: 3px solid var(--brass)`, radius `10px`, `padding: 12px 14px`, `13.5px` `--mut`.
- `.sw` (swatch tenant) : carré 22×22px, radius `7px`.
- Bandeau démo : bordure `1px solid rgba(201,161,90,.35)`, fond `rgba(201,161,90,.08)`, radius `12px`, padding `13px 16px` ; bouton primaire fond `#c9a15a` texte `#000` radius `8px` padding `7px 12px` `12.5px`/600 ; bouton secondaire bordure `1px solid rgba(255,255,255,.2)` texte `#fff`.
- Footer : `border-top: 1px solid var(--line)`, `padding: 34px 0 44px`, `13px`, `--mut`.

Polish global (style `#sm-polish`) : `::selection { background: #c9a15a; color: #000 }` ; `color-scheme: dark` ; `scroll-behavior: smooth` ; `caret-color: #c9a15a` ; scrollbars custom 10px, thumb `rgba(255,255,255,.14)` radius `99px`, hover `rgba(201,161,90,.5)` ; `:focus-visible { outline: 2px solid #c9a15a; outline-offset: 2px }` ; `prefers-reduced-motion: reduce` → animations/transitions ramenées à `.01ms`.

### 8.2 Thème sombre — « Offre 360 » (variante document)

| Token | Valeur |
|---|---|
| `--bg` | `#0b0b0c` |
| `--card` | `#141416` |
| `--card2` | `#1a1a1d` |
| `--line` | `rgba(255,255,255,.09)` |
| `--ink` | `#f2efe9` |
| `--mut` | `rgba(242,239,233,.6)` |
| `--dim` | `rgba(242,239,233,.42)` |
| `--brass` | `#c9a15a` |
| `--brass-soft` | `rgba(201,161,90,.14)` |
| `--green` | `#3fae6a` |
| `--r` (radius standard) | `14px` |

Typo : body `15.5px`/1.55 Inter (400→900) ; h1 `clamp(28px, 4.8vw, 42px)`/900, `letter-spacing: -.03em`, `line-height: 1.1` ; h1 em (accent) couleur `--brass` ; h2 `clamp(21px, 3vw, 28px)`/800 ; liens `--brass`, hover `#e0bd7e`.
Layout : `.wrap { max-width: 960px; padding: 0 28px }` ; header doc `padding: 34px 0 26px`, fond `linear-gradient(180deg, #111113, var(--bg))`, `border-bottom: 1px solid var(--line)` ; sections `padding: 44px 0 6px`.
Composants : `.card` radius `14px` padding `19px` ; `.pill` `11px`/700 radius `99px` fond `--brass-soft` texte `--brass` (variante `.g` : fond `rgba(63,174,106,.15)` texte `#63c98b`) ; `.num` (gros chiffre) `26px`/900 brass ; cartes mises en avant : `border-color: rgba(201,161,90,.4)` + fond `linear-gradient(135deg, rgba(201,161,90,.1), var(--card))` ; `.eyebrow` avec trait `22×1.5px` brass avant le texte ; tableaux `13.5px`, th `10.5px` uppercase `letter-spacing: .1em` `--dim`, td `padding: 10px` `border-top: 1px solid var(--line)`, colonnes `.r` alignées à droite avec `font-variant-numeric: tabular-nums`, ligne `.hl` fond `--brass-soft` weight 700 ; `.ia` (ligne service IA) : badge `.n` 30×30px radius `9px` fond `--brass-soft` texte brass `13px`/800 ; `.brand` (carte marque) : header `bh` avec dégradés spécifiques par marque (`#1c1c1f → #26201a` Maki-Ya, `→ #241a1a` Pastella, `→ #25211a` Wings Club, `→ #1a2420` Green Bowl) ; `ul.pts` puces rondes 6×6px brass ; footer `12.5px` `--dim` ; `@media print { body { background: #fff; color: #111 } }` + masquage de la pastille hub.
Pastille hub `#sm-hub-pill` : fixe `left: 10px; bottom: 10px`, 30×30px, radius `9px`, fond `#000`, « S » `#c9a15a` 15px/800, `opacity: .22` → `1` au hover, `transition: opacity .15s`, `box-shadow: 0 2px 8px rgba(0,0,0,.35)`, `z-index: 99999` ; masquée si l'URL contient `?embed`.

### 8.3 Thème document imprimable clair — Roadmap & FAQ (`<doc-page>`)

| Token | Valeur |
|---|---|
| `--brass` | `#b8893f` |
| `--ink` | `#17140f` |
| `--mut` | `#6b6455` |
| `--line` | `#e7e0d0` |
| `--cream` | `#f6f1e6` |
| Texte courant / listes | `#3a342b` |
| Lien hover | `#8f6a2f` |
| Bloc `warn` | fond `#0b0b0c`, texte `#f2efe9`, gras `#c9a15a` |

Typo (unités **pt**, document print) : body `10.5pt`/1.5 Inter (400→900) ; h1 `23pt`/900 `letter-spacing: -.02em` `line-height: 1.1` ; h2 `14pt`/800 avec `border-top: 2px solid var(--ink)` et `margin-top: 24pt; padding-top: 10pt` ; h2 small `9pt`/700 brass `letter-spacing: .08em` ; kicker `.k` `8.5pt`/700 `letter-spacing: .16em` brass ; `.lead` `11.5pt` `--mut` ; header de page `.hdr` `8pt`/600 `--mut` (flex, justifié aux extrémités).
Composants : `.box` (encadré critère de sortie) fond `--cream`, radius `10pt`, padding `11pt 14pt`, `break-inside: avoid` ; `.warn` radius `10pt` padding `11pt 14pt` `9.8pt` ; `.qa` (fiche FAQ) bordure `1px solid var(--line)`, radius `10pt`, padding `10pt 13pt`, `margin-top: 8pt`, `break-inside: avoid` — titre `10.3pt`, corps `9.7pt`, ligne technique `.esc` `8.6pt`/700 brass ; tables `9.3pt`, th `8.3pt`/800 uppercase `letter-spacing: .08em` `border-bottom: 2px solid var(--ink)`, td `padding: 6pt 8pt` `border-bottom: 1px solid var(--line)`, `tr { break-inside: avoid }` ; listes `padding-left: 16pt`, items espacés `4pt`.
Ces deux pages dépendent d'un composant `<doc-page>` + script `doc-page.js` (slot `header` ; masquage anti-FOUC `doc-page:not(:defined){visibility:hidden}`). Le rendu exact de `doc-page.js` (pagination, format papier, footer) : **à définir** — fichier hors périmètre de ce lot.

### 8.4 Synthèse tokens pour la production

- **Police unique** : Inter (400–900) + fallback `system-ui, sans-serif`.
- **Accent SM** : `#c9a15a` (sombre) / `#b8893f` (clair). **Accent tenant** : remplaçable au runtime (cf. §7).
- **Rayons** : 999px/99px (pills), 16px (cartes hub), 14px (cartes Offre), 12px (bandeau), 10–11px (icônes, notes, pastille logo), 9px (petites pastilles), 8px (boutons), 7px (swatches).
- **Transitions** : `.15s` (hover cartes : border-color + transform ; opacity pastille hub).
- **Micro-élévation hover** : `translateY(-3px)`.
- **Accessibilité** : focus visible `2px #c9a15a offset 2px` partout ; support `prefers-reduced-motion` obligatoire.

---

## 9. Structure, layout et interactions des 4 documents sources

> Rappel : ces 4 pages sont des documents, pas des écrans applicatifs. Leur structure est décrite ici pour référence (portage éventuel en base de connaissance / portail interne), pas comme écrans produit à recréer.

### 9.1 « SM — Écosystème & Flux » (hub, page web sombre)

**Structure verticale** : Header (logo + eyebrow « Écosystème produit · maquettes production » + h1 + lead) → Section `#apps` « Les applications / Ouvrir les maquettes » (bandeau démo boucle live + grille de 21 cartes-liens 3 colonnes + astuce raccourcis) → Section `#marque` « Marque blanche / Règles de personnalisation » (bloc flow : swatches tenants + rule-note standard couleurs) → Section `#flux` « Flux d'utilisation documentés / Comment tout se connecte » (5 blocs flow avec étapes numérotées) → Section `#archi` « Pour le développement / Architecture cible » (3 cartes) → Footer.

**Interactions** :
- Hover carte-lien : bordure passe à `#c9a15a` + levée `translateY(-3px)` en `.15s`.
- **Raccourcis clavier** : touches `1`–`8` ouvrent les 8 premières maquettes (script exact : ignoré si focus dans `INPUT`/`TEXTAREA` ou si `meta/ctrl/alt` pressé ; `click()` simulé sur la n-ième `a.card`). Texte d'aide exact : « Astuce : dans chaque app, la pastille « S » en bas à gauche ramène ici. Raccourcis clavier : touches 1–8 pour ouvrir une maquette. »
- Liens des cartes ouvrent les fichiers de maquette correspondants ; les 2 boutons de la démo boucle live ouvrent en `target="_blank" rel="noopener"`.
- Smooth scroll, scrollbars custom, sélection laiton, reduced-motion (cf. §8.1).
- États non couverts par la maquette (chargement, vide, erreur) : **à définir** — page statique.

### 9.2 « SM — Offre 360 » (document web sombre)

**Structure** : Header doc (logo S 38×38 + « Snack Manager » + tag « Offre élargie · confidentiel · v1 » + h1 + lede) → `#piliers` 01 · Vue d'ensemble (3 cartes piliers + note logique) → `#ia` 02 · Studio IA (carte flagship, grille A1–A10 en 2 colonnes, carte SM Boost avec 3 sous-cartes plans) → `#marques` 03 · Marques virtuelles (2 cartes prise en charge/conditions, 4 cartes marques en grille `g4` `minmax(200px,1fr)`, tableau exemple partenaire) → `#impact` 04 · Impact sur le modèle (tableau profils, 3 cartes indicateurs, projection) → `#next` 05 · Prochaines étapes (liste pts) → Footer doc (copyright année dynamique + 3 liens croisés) + pastille hub.

**Interactions** : liens hover `#e0bd7e` ; pastille hub opacity `.22 → 1` ; paramètre d'URL `?embed` masque la pastille ; année du footer injectée par JS (`new Date().getFullYear()`) ; mode print (fond blanc, pastille masquée). Aucun autre état dynamique : **à définir**.

### 9.3 « SM — Roadmap Produit 12 mois » et « SM — FAQ Support » (documents print clairs)

**Structure Roadmap** : header de page (`SNACK MANAGER · INTERNE` / `Roadmap produit — 12 mois`) → kicker « PRODUIT · ORDRE DE CONSTRUCTION » → h1 + lead → 4 sections trimestre (h2 avec small « · MOIS x–y », objectif en gras, liste M1–M12, encadré cream « Critère de sortie ») → h2 « Règles de gouvernance produit » + table 2 colonnes → bloc noir `warn` des refus.

**Structure FAQ** : header (`SNACK MANAGER · SUPPORT` / `FAQ — les 20 situations`) → kicker « SUPPORT · BASE DE CONNAISSANCE V1 » → h1 + lead → 5 catégories (h2) contenant 20 fiches `.qa` (titre numéroté en gras avec suffixe « — SERVICE » le cas échéant ; paragraphe réponse gérant entre guillemets ; ligne `.esc` « Technique : … » ou « Interne : … » en laiton) → bloc noir `warn` « Règle de support ».

**Interactions** : documents statiques destinés à l'impression (`break-inside: avoid` sur fiches, encadrés, lignes de table). Rendu paginé délégué à `doc-page.js` : **à définir**. Aucun autre comportement.

---

## 10. Données lues/écrites — implications API & modèle MongoDB

### 10.1 Données lues/écrites par les 4 documents eux-mêmes

Ces 4 pages sont statiques : elles ne lisent ni n'écrivent aucune donnée serveur. Seules exceptions : année dynamique du footer Offre 360 (JS local), paramètre `?embed` (lecture d'URL), navigation inter-fichiers. **Aucune API n'est requise pour elles.**

### 10.2 Entités du domaine imposées par les contraintes (pour le modèle MongoDB)

Chaque champ ci-dessous est justifié par une citation des sources (§2, §4, §5, §6). Tout le reste est **à définir**.

**`tenants` (restaurants)** — « Modèle de données multi-tenant » (M1), « thème (logo, accent) et données isolés par tenant » :
- identité : nom + ville, logo (initiale ou fichier), couleur d'accent (theming §7)
- horaires + fermetures exceptionnelles (pilotent les créneaux)
- config commande en ligne : cadence (commandes / tranche de 15 min, mémorisée par jour — FAQ #12), pause en ligne (30 min / 1 h / jusqu'à demain — FAQ #11)
- QR code / lien de commande (FAQ #13)

**`menus` / `categories` / `produits`** — « CRUD menu complet (catégories drag & drop, options, ruptures), import CSV » (M1), import photo IA (M5, flagship §6.3) :
- catégories ordonnables (drag & drop) ; produits avec prix, description (« descriptions réécrites »), photos, options, suppléments, allergènes (« allergènes suggérés »)
- rupture avec expiration optionnelle « jusqu'à demain » (FAQ #7) ; disponibilité par plage horaire (FAQ #9)
- provenance : saisie / import CSV / import photo IA avec « validation ligne à ligne »
- configuration express POS : « Complet, ST, SO, SC… » (détail **à définir**)

**`commandes`** — flux §4 :
- canal : en ligne / comptoir / téléphone / plateforme (M10 : « tickets plateformes agrégés dans le KDS »)
- mode : sur place / à emporter
- statuts : Nouveau → En prépa (acceptée) → Prêt → Remise ; + Annulée / Remboursée (FAQ #5, #10)
- créneau de retrait, **numéro de retrait**, lignes (cumul des identiques), code promo, fidélité, menu (+2,50 € dans l'exemple du flux)
- paiement : CB en ligne (Stripe) / au comptoir / espèces / « à la remise » ; remboursement CB 2–5 jours
- règle CA : annulation avant préparation exclue du CA (FAQ #5) ; mode formation : commandes fictives hors CA et hors cuisine (FAQ #16)
- horodatages nécessaires aux minuteurs KDS (seuils 5/10 min) et au « temps moyen d'encaissement < 45 s » (critère T1)
- offline : file de synchronisation locale POS/KDS avec re-sync au retour réseau (FAQ #1)

**`equipe` (staff)** — « auth (PIN staff + comptes gérant) » (M1), « pointage équipe » (M3) :
- comptes gérant ; employés avec PIN (reset par gérant, re-choix par l'employé — FAQ #14) ; pointage, plannings, absences (flux 4)

**`journal_audit`** — FAQ #15 + NF525 : action sensible (annulation, remise, …), signée par PIN, horodatée, **inaltérable** (« Tout est tracé, rien ne disparaît »)

**`fidelite` / `clients_finaux`** — M8 « Fidélité simple (tampon digital par téléphone) », « comptes clients + fidélité par restaurant », suivi de commande « sans compte » (M4), ciblage « clients fidélité inactifs » (A5), SMS de notification (flux 1)

**`promos`** — codes promo (M8), « Promos & menu du moment (poussés sur le module client) » (flux 4)

**`avis`** — M8 « gestion des avis Google depuis le back-office », réponse publique en 1 clic, brouillons IA (option A4)

**`stats`** — M7 : CA jour/semaine, top ventes, heures de pointe, digest hebdo (SMS/email chaque lundi — A10) ; mise à jour à la « Remise » (flux 3) ; suivi live CA du jour (flux 4)

**`abonnements`** — cf. schéma §6.8 + factures PDF, statut fondateur (tarif gelé), attestation loi anti-fraude téléchargeable

**`crm` (interne SM)** — M9 + flux 5 : leads (source : site / démarchage / bouche-à-oreille), démos, devis (mise en place + abonnement), onboarding (menu importé, équipe créée, matériel, formation, mise en ligne), statut actif, relances tracées, compteur fondateur

**`marques_virtuelles`** — M10 + §6.5 : marque (4 concepts), partenaire, menus injectés, commission 8 % plafonnée sur le CA marque, tickets plateformes (saisie manuelle assistée puis API), tableau de bord + rapport mensuel SM Boost (M11)

**`exports`** — FAQ #18 : export CSV standard (menu, historique des commandes, clients)

### 10.3 Canaux temps réel et matériel

- Push WebSocket des commandes vers **KDS / POS / Back-office** (architecture cible).
- Propagation des changements de menu/prix en ≤ 30 s vers caisse, cuisine, en ligne (FAQ #6) et des ruptures « immédiatement » (FAQ #7).
- Impressions ESC/POS : **ticket cuisine** à l'acceptation, **sticker sac** au passage « Prêt » ; tickets POS (M2). Gestion périphériques dans « Réglages caisse → Périphériques ».
- SMS : notification client au « Prêt » (flux 1), digest hebdo (M7), campagnes (A5).
- Statut « indisponible » automatique du module en ligne en cas de coupure côté resto (FAQ #1) + page de statut plateforme (M6).

---

## 11. Copy exacte (textes intégraux à réutiliser)

### 11.1 Messages client final (module en ligne)

- Pause en ligne : « **victime de notre succès, revenez à 21h** » (le libellé exact avec heure dynamique : **à définir** — la maquette cite cet exemple).
- Coupure réseau resto : le module affiche « **indisponible** » automatiquement.
- Écran de confirmation : affiche le **numéro de retrait** ; en cas d'échec de paiement, « l'écran du client le montre ».

### 11.2 Réponses support types (verbatim gérant)

Les 20 réponses de la FAQ (§4.6 et §5) sont la copy officielle du support — à intégrer telle quelle dans la base de connaissance. Titres exacts des 20 situations :

1. « Internet est coupé, je fais quoi ?! » — SERVICE
2. « L'imprimante ne sort plus de tickets » — SERVICE
3. « L'écran cuisine ne reçoit plus rien » — SERVICE
4. « Un client dit qu'il a payé en ligne mais je ne vois rien » — SERVICE
5. « J'ai encaissé une erreur, comment j'annule ? »
6. « Je veux changer un prix maintenant, en plein service »
7. « Je n'ai plus de [produit], les clients continuent de le commander »
8. « L'import de ma carte a mis un mauvais prix / oublié un plat »
9. « Je veux ajouter une formule midi qui n'existe que de 11h30 à 14h »
10. « Un client veut annuler sa commande en ligne »
11. « Je veux fermer la commande en ligne ce soir, on est débordés »
12. « Les créneaux de retrait sont trop serrés, on n'arrive pas à suivre »
13. « Comment mes clients trouvent ma page de commande ? »
14. « Un employé a oublié son code PIN »
15. « Je veux voir qui a fait quoi (annulations, remises) »
16. « Le nouveau ne s'en sort pas avec la caisse »
17. « C'est quoi ce prélèvement / je veux ma facture »
18. « Si j'arrête, je perds tout ? »
19. « Mes chiffres, qui peut les voir ? »
20. « Vous êtes conformes RGPD / caisse certifiée ? »

### 11.3 Libellés produit récurrents

- Statuts KDS : « Nouveau », « En prépa », « Prêt » (colonnes) ; actions « Accepter », « Prête », « Remise ».
- Modes POS : « Sur place / À emporter / Téléphone » ; bouton « Pause en ligne » (en haut à droite de la caisse) ; « Mode formation » (Réglages) ; « Périphériques » (Réglages caisse).
- Navigation back-office citée : Menu, Commande en ligne → Cadence, Équipe, Journal, Abonnement, Exporter, Disponibilité → plage horaire, Rupture (appui long), bouton « ⋯ → Annuler ou Rembourser », « Réinitialiser le PIN ».
- Voyant imprimante : « bleu fixe = OK ».

---

## 12. Points « à définir »

Comportements/valeurs **absents des 4 sources** — ne pas inventer, à trancher avec les autres maquettes (Design System, POS, KDS, Back-office, Site vitrine, Proposition commerciale) ou en atelier produit :

1. **Paliers exacts du SaaS** entre 89 et 189 €/mois : noms des formules (seul « Complet » est cité), contenus, prix unitaires. → cf. site vitrine / proposition commerciale.
2. **Plafond** de la commission 8 % marques virtuelles (« plafonnée » sans montant). → cf. Kit marques virtuelles.
3. Prix des services A7 (pricing dynamique), A8 (traduction), A10 (digest) ; modalités de facturation « Services (lissé/mois) ≈ 80 € / ≈ 179 € » (règle de lissage non spécifiée).
4. Signification exacte des abréviations POS « Complet, ST, SO, SC… ».
5. **Valeurs hex canoniques** des couleurs fonctionnelles (vert/rouge/ambre) — deux verts coexistent (`#3fae4a` hub, `#3fae6a` Offre) ; l'ambre n'apparaît pas en hex dans ces fichiers. → référence : `SM - Design System.html`.
6. Comportement précis de `doc-page.js` (pagination, format, footers des documents print).
7. Détail du « cadre légal B2B » des relances (fichier Séquences de relance, hors lot).
8. Sons exacts du KDS (fichier audio, volume, répétition) — seule l'existence d'une « alerte sonore » et d'un « ticket flash » est spécifiée.
9. Contenu exact du « mode dégradé » du KDS au-delà de « affiche les tickets imprimés en secours ».
10. Libellé dynamique complet du message de pause en ligne (l'exemple cite « revenez à 21h »).
11. États chargement/vide/erreur de toutes les surfaces : non couverts par ces 4 documents (statiques).
12. Processus d'obtention de l'attestation NF525/LNE vs auto-certification éditeur (choix juridique à faire — seule l'échéance « avant le premier client facturé » est fixée).
13. Modélisation détaillée des entités MongoDB au-delà des champs cités §10.2 (index, schémas de validation, stratégie d'isolation tenant : base par tenant vs champ `tenantId` — la maquette impose seulement « données isolées par tenant » et « un déploiement, N restaurants »).
