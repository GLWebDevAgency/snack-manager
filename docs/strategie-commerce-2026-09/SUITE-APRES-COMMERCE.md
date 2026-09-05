# Suite du chantier commerce — paiements, Billing, remise et écrans

Demandes utilisateur et cadrage au 5 septembre 2026. Distinguer les protections livrées dans la branche de travail des fonctionnalités proposées. Rien ici n'atteste un déploiement staging ou production.

**Priorité métier précisée par le fondateur :** [audit complet des parcours commerce](PARCOURS-COMMERCE-PRODUCTION.md), puis [historique gérant et espace client](HISTORIQUE-ESPACE-CLIENT.md). Click & collect, livraison, sur-place public, fidélité, suivi, accès livreur/polyvalent et réachat sont traités comme des chaînes à terminer, pas comme une collection d'écrans. Les critères de recette et l'ordre opérationnel actualisé sont dans ces deux documents.

## 1. Remise : règle implémentée

La cuisine fait `nouvelle → en préparation → prête`. Elle ne confirme jamais la remise au client, sur place, à emporter, au retrait ou en livraison. L'API vérifie cette règle avant les retours idempotents ; une ancienne tablette cuisine ne peut pas contourner le changement. Une nouvelle remise exige un état `ready` et une identité caisse/gestion autorisée.

Le KDS affiche l'attente caisse/livreur. Le POS confirme une remise comptoir déjà payée, après réponse serveur et jamais via une file hors ligne. Une livraison nécessite en plus un départ confirmé ; sa clôture manuelle reste dans le back-office habilité. Aucun accès livreur ni preuve QR n'est implémenté dans ce lot.

### Limite importante : encaisser n'est pas remettre

Le POS ne propose pas encore l'encaissement d'une commande web ou téléphone existante restée `pending`. Son écran espèces crée une nouvelle vente : **ne pas recréer la commande** pour la régler. L'interface oriente vers le responsable habilité dans le back-office, sans prétendre fournir ce parcours dans le POS.

Le back-office/API possède un comportement historique distinct : marquer remise une commande non livrée de type retrait/sur-place/emporter peut passer un paiement en attente à payé. Ce n'est pas une preuve Stripe, et ce comportement ne doit pas devenir le protocole de la future livraison. Un paiement en ligne commencé doit être rapproché avant toute demande de paiement alternative ; le libellé `pending` n'exclut pas un débit en cours.

Prochain lot nécessaire : action explicite « Encaisser cette commande » avec montant serveur, moyen de règlement, acteur, horodatage et journal ; coordination durable avec les tentatives Stripe et les annulations ; double clic, reprise après crash et concurrence entre caisses testés. Le paiement puis la remise doivent être deux faits distincts. Voir [réservations et paiement concurrent](RESERVATIONS-IMPAYEES.md).

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

## 3. Écrans TV / menu animé — après le lot commerce

Le résumé Claude fourni par l'utilisateur et son document local `bilan-et-cap.html` ont été lus. Le lien public de l'artefact n'a pas pu être ouvert directement ; ses affirmations techniques restent à revalider sur la branche intégrée avant implémentation.

Direction retenue pour étude : scènes HTML animées alimentées par les données serveur, pas une vidéo aux prix figés. Réutiliser l'identité du restaurant, les prix déjà formatés, les disponibilités et les points de cadrage des photos. Préserver une scène historique de repli, paysage et portrait, textes longs, fermeture et catalogue vide. Prix stables, animations discrètes `transform`/`opacity`, mode mouvement réduit et validation sur matériel réel.

Avant tout moteur de scènes : origine d'exécution isolée, sandbox sans accès au back-office, CSP restrictive, aucun secret/session dans la scène, messages versionnés validés par source et schéma. Les scènes doivent être des assets versionnés et revus ; ne pas autoriser arbitrairement du JavaScript fourni par un restaurant. Valider l'isolation avec le chargement des images/polices et le mécanisme `postMessage`, plutôt que cumuler des attributs sandbox contradictoires.

Prochain livrable : ADR et une scène représentative, puis harnais multi-identités/paysage/portrait et tests d'endurance, avant catalogue complet. Ne pas promettre une synchronisation instantanée si la source reste interrogée périodiquement.

## 4. Autres limites du résumé à traiter par lots

- Consommation sécurisée fidélité confirmée non raccordée : `redeem()` retourne 410 tant que la récompense n'est pas attachée à une commande. Les promesses commerciales sont corrigées en « pilote accompagné ». Ce correctif rédactionnel ne livre pas la consommation, le cumul automatique web ou l'expiration des points.
- Émission unique des factures corrigée et testée dans la branche, pas encore déployée : respecter la [bascule contrôlée du writer](FACTURATION-EMISSION-DURABLE.md). Le [protocole commun annulation/paiement](PAIEMENTS-ANNULATION-DURABLE.md) est implémenté et testé sur Mongo réel dans cette branche ; recette Stripe/staging, expiration automatique et encaissement explicite d'une commande existante restent à traiter avant activation des nouveaux encaissements.
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
