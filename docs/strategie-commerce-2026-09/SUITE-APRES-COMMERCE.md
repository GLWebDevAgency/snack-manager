# Suivi unique des demandes — pilote Classfood et vision 2030

**Registre opérationnel actualisé le 6 septembre 2026.** C'est le point d'entrée des demandes du fondateur ; les audits liés restent des photographies datées et les spécifications décrivent les critères de réception. Ne pas réouvrir un sujet sur la seule lecture d'un ancien constat, ni confondre code écrit, fusionné, déployé et recetté.

**Objectif :** faire fonctionner les parcours vendus à Classfood de bout en bout avec les moyens d'un développeur seul. L'[audit initial](../audit-2026-08-28/AUDIT-STRATEGIQUE-ET-TECHNIQUE.md) conserve la vision concurrentielle, technique, sécurité, données, exploitation, HACCP et IA. L'[audit commerce](PARCOURS-COMMERCE-PRODUCTION.md) et l'[espace client](HISTORIQUE-ESPACE-CLIENT.md) détaillent les écarts ; **l'ordre de travail et les états actualisés ci-dessous font référence**.

## Pilotage — ordre de livraison

Un seul lot fonctionnel en réalisation ; relecture, tests et préparation non facturante peuvent avancer en parallèle. Un blocage fournisseur n'arrête pas les lots indépendants. Chaque lot est découpé en PR cohérentes : ni PR géante « tout le produit », ni écran activé sans son autorisation et son backend.

| Ordre / lot | Périmètre et condition de sortie | État au relevé |
| --- | --- | --- |
| **L0 — Fermer le lot paiement actuel** | Retrait online → comptoir sur la même commande ; encaissement POS explicite espèces/TPE/TR ; monnaie, journal, reprise ; remise distincte. Revue indépendante, vérification globale puis `develop`/staging et recette du scénario Classfood. | **LIVRÉ SUR STAGING via #120, `e266721`.** CI/migrations/quatre services verts ; smoke8/8, démos9/9 ; Classfood réel en staging : même commande passée au comptoir puis encaissée, un reçu/un audit. Aucun débit bancaire réel ni certification TPE/impression. Production inchangée. |
| **L1 — Fiabilité du service et reprise** | Tentative checkout persistée avant POST et suivi retrouvable ; file active sans coupure à minuit/200 commandes ; historique gérant paginé, recherche POS, exports exacts ; abandons et paiements tardifs, créneaux pleins/après minuit et précommandes ; refus/incident et notifications utiles. Sous-lots distincts C01/C03/C04/C05/C11/C13/C15. | **PARTIEL.** Parcours nominal présent ; ne pas assimiler la reprise de paiement L0 à la reprise complète du navigateur. Prioriser les pertes/doubles commandes et la réception quotidienne. |
| **L2 — Livraison réellement exécutable** | Prérequis visibles au BO ; gérant crée/révoque un livreur ou habilite un équipier polyvalent ; missions isolées, affectation/réaffectation, départ, QR/PIN de remise et incidents ; application web mobile installable. Les accès opérationnels ne nécessitent pas un abonnement RH. | **À FAIRE pour l'app livreur**, explicitement demandée après les tâches de paiement. Tarifs/zones/adresse/créneau/prépaiement existent. Ne dépend pas de l'inscription fidélité : un client invité doit pouvoir être livré. |
| **L3a — Identité client et préremplissage** | Session personnelle séparée du QR fidélité, inscription/connexion vérifiée, profil et coordonnées préremplies sans écraser la saisie ; adresse demandée pour livraison seulement, sauvegarde volontaire. Conservation du parcours invité. | **À FAIRE. Twilio Verify choisi ; essai gratuit uniquement.** Préparation du compte possible pendant L0–L2, aucun lancement public/payant. |
| **L3b — Boucle fidélité et réachat** | Adhésion/rattachement sûrs, points/tampons et récompenses liés à une vraie vente, crédit web/POS, consommation et compensation ; « Mes commandes », historique protégé, recommander aux conditions actuelles. | **PARTIEL.** Carte/design/navigation/solde et création accompagnée existent. Pas de boucle complète : inscription publique, gains web, consommation et historique personnel restent à livrer. Dépend de L3a pour l'espace personnel, pas du secret QR. |
| **L4 — Sur-place public** | Commander en ligne pour manger sur place, préparation/ticket/suivi cohérents ; d'abord retrait comptoir, puis QR/table vérifiable si cette prestation est retenue. | **NON LIVRÉ.** Le mode POS ne prouve pas le parcours public. |
| **L5 — Facturation SnackManager pilotée au CRM** | Billing/Invoicing B1–B5 : correspondances, contrats, paiements, impayés, modifications, avoirs et rapprochements ; pas de double émetteur. Maintenir distincts factures SM et paiements Connect du restaurant. | **PARTIEL.** Audit pur B1 seulement ; pont Checkout ponctuel existant, pas abonnement Billing actif. Compte/événements distants à revalider avant recette. |
| **L6 — TV Signature et SnackManager Studio** | Un premier écran Classfood fidèle au kit, relié au vrai catalogue/prix/ruptures ; puis demande Studio → devis CRM → aperçu → validation → publication/version précédente → « Mes créations » ; enfin quatre autres écrans. | **PARTIEL.** Animations des 15 modèles inclus fusionnées et déployées sur staging (#119). Kit audité et Studio cadré, pas encore intégré. |
| **L7 — Assistant manager 2030** | Stock fiable relié aux ventes/recettes/inventaires, pilotage matière/finances/personnel/menus ; HACCP manuel traçable puis IoT éprouvé ; conseil et automatisations IA explicables et contrôlées. Financement/validation par étapes avec les restaurants. | **FEUILLE DE ROUTE**, hors promesse du pilote. Audit de faisabilité ≠ logiciel ou conformité livrée. |

### Transversal — ne pas attendre le dernier lot

- **Offres et vente :** vitrine seule sur mesure, vitrine + commande, fidélité seule, collect ou livraison complète ; catalogue CRM/contrats/landing/BO synchronisé. Les badges d'offre ne remplacent jamais l'autorisation API. Suivre [stratégie commerciale](STRATEGIE-COMMERCIALE.md) et [registre des promesses](REGISTRE-PROMESSES.md) à chaque livraison, sans prétendre disponible une fonctionnalité partielle. Réutiliser les offres déjà codées au lieu de les reconstruire.
- **Boost et livraison :** inclusion commerciale livrée (#117), anciens Boost compris ; activation opérationnelle distincte. Dernier relevé Classfood : zone existante mais livraison désactivée et Connect non prêt. Vérifier de nouveau, terminer l'onboarding avec le titulaire et valider ses frais/conditions avant publication ; ne pas inventer une zone ou un tarif pour afficher le bouton.
- **Catalogue unique :** variantes/fromages inclus, suppléments payants, crudités/« Complet »/retraits et total dynamique corrigés (#109/#111). Recetter les données réelles Classfood sur POS et web ; mêmes choix, même prix serveur et mêmes informations cuisine. Toute nouvelle régression devient prioritaire dans le lot actif.
- **Matériel et réseau :** conserver impression réseau et stickers dans le périmètre demandé ; sourcing puis tests de vrais périphériques, reprise après erreur et non-duplication. Un aperçu ticket n'est pas une impression validée. Vérifier coupure Internet, Wi-Fi local et reprise POS/KDS ; ne pas promettre de synchronisation Bluetooth sur la seule base d'une PWA installée. Ce sont des conditions d'acceptation des offres utilisant le matériel, pas de toute vitrine web.
- **Qualité et exploitation :** identité visuelle existante, design system, accessibilité, modal/clavier/tactile, états de chargement/erreur, mouvement réduit et budget de performance dans chaque lot. Architecture modulaire, DDD/ports lorsque présents, montants serveur, tests de concurrence et sécurité multi-tenant. Pas de refonte décorative ou de dépendance sans besoin démontré.
- **Infrastructure et conformité :** surveiller CI, migrations, bootstrap PostgreSQL idempotent déjà versionné, santé et version des quatre services ; sauvegarde/restauration et secrets. Node ≥24.12 reste requis par le dépôt. Revalider les risques de l'audit initial avec preuves actuelles ; ne pas transformer un ancien score ou une mention NF525/HACCP en certification.
- **Premier restaurant en production :** après GO dédié, renseigner son vrai slug dans le smoke public fidélité si ce module est actif. Ce choix ne se déduit pas d'un tenant staging.

### Décisions et dépendances externes

1. **Twilio : essai gratuit uniquement**, décision explicite du fondateur. Aucun plafond payant de 10/20 € n'est approuvé. Pas d'achat de numéro, recharge, upgrade, Lookup payant ou SMS marketing. Mode initial fermé/liste de test, quota et échéance vérifiés, arrêt en cas d'incertitude ; aucune authentification réelle dans les tests automatisés. La CLI est installée et le profil fonctionne sur Verify ; le quota/type de compte n'est pas attesté par cet accès (la clé refuse la lecture `/Accounts`). Aucun SMS envoyé par cette préparation.
2. **Classfood :** paramètres de livraison, disponibilité Connect et récompenses actives à contrôler avec le gérant. Adresse facultative en fidélité, obligatoire au passage en livraison ; téléphone vérifié comme anti-doublon par restaurant, pas identifiant primaire immuable.
3. **Studio :** conserver le kit local original ; aucun import/exécution libre de JavaScript restaurant. Porter une composition de confiance et générer de vrais QR.
4. **Production :** aucun nouveau déploiement autorisé par une validation de staging ou par « go Twilio ». Attendre un GO distinct pour le lot concerné.

### Coordination et preuve de livraison

- Répartir explicitement les fichiers/lots entre Codex et Claude ; inspecter branches, worktrees, claims disponibles et PR avant modification/fusion. Ne pas toucher aux modifications du worktree d'un autre agent.
- Commits courts par responsabilité, puis push dès validation du lot ; pas de travail fini conservé seulement sur la machine. Les branches `codex/review-pr98` et `codex/review-pr99` sont désormais vérifiées identiques à leur distant.
- **Aucun push direct sur `develop` ou `main` : PR obligatoire**, pour staging comme pour production. Vérifier le SHA de tête au moment de la fusion. Intégrer `origin/develop` dans une branche de travail ne publie pas celle-ci ; l'indiquer clairement dans les comptes rendus. Ne pas confondre cette discipline avec une protection GitHub effectivement activée.
- Avant fusion : intégrer le dernier `origin/develop`, refaire vérification globale, tests DB requis et revue ; aucune PR concurrente ignorée. Déploiement via le flow existant, pas de contournement ad hoc Railway.
- **Terminé** = backend et UI autorisés, nominal + incidents testés, commit/PR identifiés, CI verte, version exacte sur staging et recette réelle des intégrations concernées. Un test simulé ou un test ignoré ne valide pas Stripe, Twilio, imprimante ou téléphone physique.
- Fin de lot : mettre à jour ici état, SHA/PR, preuves et reste à faire ; synchroniser les promesses commerciales. Donner au fondateur trois informations : livré, non livré/bloqué, prochaine action. Aucun pourcentage global trompeur.

**Point de reprise actuel :** [PR #122](https://github.com/GLWebDevAgency/snack-manager/pull/122) fusionnée, déploiement staging [34057717852](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34057717852) réussi sur `247d27a4c2cc0af4ff0194ee461c217b3f3792f1`. Correctif limité à la bascule atomique des promotions, sans écrasement du compteur. Quatre services en SUCCESS, migrations et santé vertes, SHA API et code compilé chargé vérifiés ; smoke8/8. Aucune promotion Classfood ni transaction modifiée pour cette recette. Le socle C15 est poussé dans la [draft #123](https://github.com/GLWebDevAgency/snack-manager/pull/123), non activé et non fusionné ; son RED runtime reste bloquant. Production non modifiée.

L0 reste livré par [PR #120](https://github.com/GLWebDevAgency/snack-manager/pull/120), avec sa [preuve de recette Classfood](https://github.com/GLWebDevAgency/snack-manager/pull/120#issuecomment-5555683883). Les parcours navigateur sans comptes de test et la recette humaine C01 ci-dessous conservent leurs limites ; un smoke vert ne les valide pas.

**C01 — fusionné et déployé sur staging**, [PR #121](https://github.com/GLWebDevAgency/snack-manager/pull/121), révision `78857c676a64f9b18b5e572ad6328cb0c4c0d485`. [Déploiement 34014869647](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34014869647) réussi : quatre services, migrations/bootstrap et index d'admission vérifiés ; smoke8/8 et démos9/9. Quatre parcours nécessitant des comptes restent ignorés dans l'E2E automatique. [Preuve détaillée](https://github.com/GLWebDevAgency/snack-manager/pull/121#issuecomment-5557380160). La tentative de recette réelle navigateur a atteint la vérification humaine Cloudflare : **aucun POST de commande ni paiement envoyé**. Perte de réponse/rechargement/reprise de cette commande ne sont donc pas recettés sur staging ; étape humaine ouverte, jamais remplacée par un contournement Turnstile.

C01 préserve : transaction IndexedDB avant POST, une tentative par établissement/origine entre onglets, corps figé et preuve aléatoire distincte du téléphone ; reçu sauvegardé avant nettoyage du panier. Une erreur HTTP/404 n'est jamais une preuve d'absence de commande. [Protocole et limites](REPRISE-CHECKOUT-DURABLE.md). Vérifications locales : web1138, journal22, panier inter-onglets7, Mongo admission23 et paiement121 ; 9 scénarios navigateur de reprise et 5 parcours checkout existants. Ces tests locaux ne remplacent pas la recette humaine bloquée. Production inchangée, aucun nouveau GO.

**Lot actif : C15 — capacité durable, avant application livreur.** Branche `codex/durable-order-reservations`, [draft #123](https://github.com/GLWebDevAgency/snack-manager/pull/123). La course de dernière place après expiration Redis est reproduite sur vrai Mongo (2 commandes pour1 place). Socle de places atomiques testé séparément, **non branché au runtime** ; le test rouge du contrôleur reste bloquant pour sa livraison. Calendrier/seed historique et admission commune public/legacy/POS téléphone à raccorder avant activation. [Découpage, protocole et réception](CAPACITE-DURABLE.md). Correctif atomique du toggle promotion livré séparément par #122 ; les reçus de réservation promotionnelle orphelins restent à traiter.

**Préparation B poursuivie le 6 septembre, sans activation :** noyau commun public/legacy/staff et canal exact (55 tests), garde des index réellement terminés (49 tests dont3 constructions Mongo suspendues), grille brute Paris (66 tests) et journal durable téléphone (48 tests, plus52 régressions POS). Pas de nouvelle dépense, pas de changement des parcours en ligne/staging. Prochain ordre : calendrier et reprise historique coordonnés avec les réglages BO → orchestrateurs/rejets durables de tous les writers → vrai créneau téléphone et confirmation serveur avant encaissement → fermeture du test runtime puis staging. Le journal seul n'ajoute encore aucun bouton au POS. Reprise checkout C01 réelle23/23 et typages/lints verts ; recette humaine Cloudflare toujours ouverte.

Bornes C01 : ce journal local n'est ni un compte client, ni l'historique personnel L3, ni une garantie si l'utilisateur efface ses données navigateur ou change d'origine/appareil. Aucun secret Stripe ou Turnstile n'est persisté. Les données détaillées de tentative sont retirées du journal dès reçu ou rejet confirmé. Les tentatives incertaines ne sont pas purgées par un TTL susceptible de réautoriser un vieux POST. Safari et redémarrage physique restent des validations distinctes des tests Chromium.

## 1. Remise : règle implémentée

La cuisine fait `nouvelle → en préparation → prête`. Elle ne confirme jamais la remise au client, sur place, à emporter, au retrait ou en livraison. L'API vérifie cette règle avant les retours idempotents ; une ancienne tablette cuisine ne peut pas contourner le changement. Une nouvelle remise exige un état `ready` et une identité caisse/gestion autorisée.

Le KDS affiche l'attente caisse/livreur. Le POS confirme une remise comptoir déjà payée, après réponse serveur et jamais via une file hors ligne. Une livraison nécessite en plus un départ confirmé ; sa clôture manuelle reste dans le back-office habilité. Aucun accès livreur ni preuve QR n'est implémenté dans ce lot.

### Limite importante : encaisser n'est pas remettre

**L0 est déployé sur staging via #120** : modale dédiée à la commande existante, panier courant préservé, espèces/TPE externe/titre-restaurant, montant et rendu validés par le serveur. L'écran de nouvelle vente n'est pas réutilisé. La recette Classfood a validé 10 € dus, 20 € saisis comme reçus et 10 € de monnaie, uniquement en données de test staging ; elle ne certifie pas un TPE physique.

L0 supprime le paiement implicite historique à la remise : le règlement puis la remise deviennent deux opérations distinctes. Un paiement en ligne commencé doit être fermé/rapproché avant un règlement alternatif ; le libellé `pending` n'exclut pas un débit en cours. Les historiques sans preuve restent à rapprocher, jamais déclarés sans risque automatiquement.

La preuve d'encaissement et le paiement sont atomiques dans la commande ; le journal append-only et les événements sont réparables par rejeu. Pas de worker de réparation universel dans ce lot, ni remboursement espèces. Voir [protocole](PAIEMENTS-ANNULATION-DURABLE.md) et [réservations](RESERVATIONS-IMPAYEES.md).

## 2. Accès livreur et preuve de remise — proposition, non implémentée

Parcours cible : `paiement confirmé → préparation → prête → affectation et départ → remise confirmée`.

| Acteur | Responsabilité |
| --- | --- |
| Cuisine | Préparer et signaler prêt ; aucune clôture client |
| Caisse / responsable | Affecter un livreur, confirmer la prise en charge, gérer les incidents |
| Livreur authentifié | Voir seulement ses missions actives, les coordonnées strictement nécessaires et confirmer leur remise |
| Client | Présenter une preuve dédiée à cette commande au moment de la remise |

Choix conseillé au pilote : interface web mobile installable, sans application native supplémentaire, optimisation de tournées ni suivi GPS continu. L'accès livreur doit être indépendant de l'abonnement RH, mais ne donne accès ni aux finances, ni aux menus, ni aux autres clients. Il faut concevoir invitation/révocation, durée de session et affectation avant d'ajouter un rôle au JWT.

Preuve : QR à forte entropie et/ou code court, secret propre à la commande, usage unique et durée limitée. Ne réutiliser ni QR fidélité ni jeton de consultation du suivi. Un QR identifie une preuve ; il ne donne pas à son détenteur le droit de modifier la commande sans authentification de l'opérateur.

- Vérification serveur du restaurant, du livreur affecté, du paiement, du départ et de l'état courant.
- Consommation de la preuve et transition de remise atomiques ; rejeu de la même opération idempotent.
- Quotas d'essais par commande/opérateur et globalement, expiration et réémission contrôlée. Ne jamais stocker ou journaliser un code en clair par facilité.
- Le livreur ne voit pas le code que le client doit lui présenter. Concevoir séparément génération, stockage sécurisé et réaffichage client : un simple hash irréversible ne permet pas ce dernier.
- Client absent, code perdu ou litige : incident explicite ; dérogation responsable motivée et auditée, jamais validation silencieuse ni remboursement automatique.
- Sans réseau : ne pas afficher une remise confirmée avant validation serveur. Définir ultérieurement une reprise hors ligne si nécessaire.

Recette exigée : commande voisine, autre tenant/livreur, code expiré/incorrect/réutilisé, double scan, réaffectation, paiement remboursé en parallèle, réponse serveur perdue et dérogation. Préparer aussi les permissions, la rétention des coordonnées et le contrôle d'accès des notifications contenant la preuve.

## 3. Écrans TV / menu animé — inclus livrés, Studio restant

Le résumé Claude fourni par l'utilisateur et son document local `bilan-et-cap.html` ont été lus. L'analyse des cinq écrans du kit Classfood a donné lieu au [cadrage Studio](../superpowers/specs/2026-09-06-snackmanager-studio.md), versionné dans #119. Le kit original n'est pas publié ni remplacé.

Les quinze modèles inclus ont leurs apparitions, transitions et rythmes propres, avec aperçu partagé, stabilité des prix et mouvement réduit. #119 est fusionnée et déployée sur staging ; l'endurance sur téléviseur réel reste à mesurer. Ce résultat ne signifie pas que les créations sur mesure du kit sont intégrées.

Direction retenue pour L6 : module React/CSS de confiance dans le lecteur existant, catalogue comme source des prix, manifeste versionné et autorisé par restaurant ; vidéo décorative pré-rendue si nécessaire. Aucun runtime Babel/développement ni code arbitraire chargé du back-office.

Prochain livrable : **un écran Classfood Signature** avec changement de prix, rupture, vrai QR, boucle et repli hors ligne vérifiés. Puis demande Studio, devis/validation CRM et publication dans « Mes créations », avant les quatre autres compositions. Ne pas promettre de synchronisation à la frame entre téléviseurs sans mesure.

## 4. Autres limites du résumé à traiter par lots

- Consommation sécurisée fidélité confirmée non raccordée : `redeem()` retourne 410 tant que la récompense n'est pas attachée à une commande. Les promesses commerciales sont corrigées en « pilote accompagné ». Ce correctif rédactionnel ne livre pas la consommation, le cumul automatique web ou l'expiration des points.
- Émission unique des factures corrigée/testée et code intégré : la [bascule contrôlée du writer](FACTURATION-EMISSION-DURABLE.md) reste une preuve opérationnelle distincte. Le [protocole commun annulation/paiement](PAIEMENTS-ANNULATION-DURABLE.md) et son extension d'encaissement explicite ont leurs tests Mongo ; recette bancaire/staging, expiration automatique et rapprochements ne sont pas certifiés par ces tests. Voir états L0/L1/L5.
- Prestations Atelier, médias et cache, notifications transactionnelles, rétention des données, tableaux comptables et tests de composants : relecture séparée du code intégré, classement risque/valeur, puis petits lots. Ne pas traiter tous ces sujets implicitement dans une PR livraison.

## 5. Migration Stripe Billing / Invoicing — préparation, non activée

Le fondateur a validé l'ajout de ce chantier le 5 septembre 2026. Décision et critères de réception : [ADR 0006](../adr/0006-migration-billing-pilotee-par-crm.md). Le CRM reste le poste de pilotage ; Stripe prend en charge la facturation des contrats migrés. Les paiements Connect des commandes restaurant restent distincts.

Priorité immédiate inchangée : fermer la course annulation/paiement des commandes. La migration Billing est ensuite menée par lots dédiés ; elle n'est pas ajoutée en bloc aux conditions de fusion de la PR commerce actuelle. Les autres demandes de remise, fidélité et écrans restent dans ce suivi et ne sont pas abandonnées. Vérifier les PR/claims et les branches actives avant chaque lot, notamment le travail Claude sur les écrans ; ne pas reprendre son worktree.

- [ ] **B1 — Contrats et correspondances** : source de facturation, date de bascule, mapping client/prix/abonnement/facture ; préserver tarifs, TVA, essais, remises figées et périodicités mixtes.
- [ ] **B2 — Pilote abonnement simple** : création depuis CRM, carte/SEPA via Stripe sécurisé, opérations durables, webhooks et rapprochement ; recette sandbox réelle.
- [ ] **B3 — Cycle commercial** : options, changement d'offre, prorations explicites, résiliation, impayés et droits ; CRM et portail de paiement cohérents, sans lever une suspension administrative par un simple règlement.
- [ ] **B4 — Prestations et historique** : Invoicing, avoirs/remboursements autorisés, historique unifié, aucune réémission des anciennes pièces ; fermeture de tous les chemins d'émission locale des obligations migrées.
- [ ] **B5 — Recette et activation** : tests monétaires et de concurrence, staging, contrats complexes, reprise après panne, configuration live relue ; production uniquement après validation staging et GO distinct.

Première partie B1 implémentée : `billingMigration.auditBillingMigration` audite des preuves contractuelles normalisées sans DB, SDK ni émission. Le contrôle couvre montants entiers, remise ventilée, échéances, couverture réelle, coupure, émetteur et correspondances Stripe. Il ne certifie ni l'extraction des données ni leur réalité distante et ne remplace pas l'arbitrage atomique du futur writer : B1 n'est donc pas encore coché complet.

Deux divergences historiques reproduites bloquent la migration automatique des dossiers concernés : remise fondateur annuelle avec Atelier imputée différemment entre signature et échéancier ; renouvellement annuel basé sur la création du tenant plutôt que sur la première période payante après essai. Rapprocher devis signé et couverture déjà facturée ; aucune ancienne pièce n'est recalculée ou modifiée par cet audit.

Le pont Checkout actuel reste un paiement ponctuel de facture SM, pas Billing. Aucun abonnement récurrent, mandat, prix, endpoint distant ni frais supplémentaire n'est activé par cet ajout au plan. Les améliorations du moteur maison restent limitées à la sécurité et au maintien nécessaire jusqu'à migration. Ne pas reconstruire en parallèle le renouvellement, les relances automatiques et la proration que Stripe doit fournir.
