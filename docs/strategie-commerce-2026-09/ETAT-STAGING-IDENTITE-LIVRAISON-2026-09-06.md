# État vérifié — staging, identité client et livraison

Relevé en lecture seule le 6 septembre 2026 (Europe/Paris), **avant déploiement des nouveaux correctifs de paiement**. Il distingue un code fusionné d'un parcours effectivement livré. Complète [l'espace client](HISTORIQUE-ESPACE-CLIENT.md).

## Déploiement retrouvé

- L'API staging `/health` annonce `486765cc28b62f5859ce878a5c0d53d94cf8e2ff`, alors le dernier `develop`. Railway confirme les quatre services API/web/POS/KDS en réussite pour le [déploiement 33993347647](https://github.com/GLWebDevAgency/snack-manager/actions/runs/33993347647). Le SHA des fronts est corrélé au pipeline, pas prouvé par un endpoint de version frontend.
- Les travaux fidélité PR99 et leur revue PR100 sont ancêtres de cette version. Les huit smokes publics passent ; les quatre tests du parc réel du [run E2E 33993701964](https://github.com/GLWebDevAgency/snack-manager/actions/runs/33993701964) sont **ignorés**, pas validés.
- Les migrations PostgreSQL avaient réussi dans les deux déploiements défaillants retrouvés. Le premier (`33980087170`) échouait à la publication des variables du web, avec détail fournisseur masqué. Le second (`33980179812`) plantait au démarrage CommonJS de l'API : `Cannot access 'capacites_1' before initialization`.
- [PR114](https://github.com/GLWebDevAgency/snack-manager/pull/114) corrige les imports tardifs employés par les décorateurs et ajoute le chargement CI du vrai `AppModule` compilé. Elle corrige également le JavaScript du worker TV. Aucun incident plus récent retrouvé dans ce contrôle.

## Classfood : pourquoi seul le retrait est visible

Lecture ciblée du tenant en staging, aucune écriture : Boost et capacités `online`/`delivery` actives, commande non suspendue, **une zone configurée**, mais `delivery.enabled=false` et état Connect enregistré `chargesEnabled=false`. Deux prérequis indépendants ferment donc la publication. Cette vérification ne remplace pas une synchronisation auprès de Stripe.

Le site expose `delivery.available=false` et masque volontairement les zones. Une liste publique vide n'est pas la preuve d'une configuration privée vide. Les horaires filtrent les créneaux après cette porte, pas la visibilité du mode.

Livré : zones, frais/minimum/seuil de gratuité, devis recalculé, adresse et créneau de livraison, prépaiement obligatoire, départ depuis le BO pour une commande prête/payée et remise interdite à la cuisine.

Non livré : identité/application livreur, affectation authentifiée à un équipier polyvalent, missions cloisonnées et preuve QR/PIN de remise. Le champ `driverName` est actuellement un libellé facultatif, pas un compte livreur. La livraison ne doit donc pas être qualifiée de complète de bout en bout.

Prochain correctif BO : montrer les prérequis réels au gérant (activation, zone, Connect), avec accès à l'encaissement ; distinguer « paramètres enregistrés » de « livraison publiée ». Ne pas publier les motifs de configuration internes aux consommateurs et ne pas afficher artificiellement une livraison impayable.

## Fidélité : écart produit confirmé

Livré : inscription accompagnée BO/POS, QR et session de carte, solde/mouvements, navigation carte ↔ commande. Programme Classfood actif en points, aucune récompense active dans le catalogue relevé.

Non livré : inscription publique, session personnelle vérifiée, profil prérempli depuis la fidélité, historique personnel, rattachement/crédit automatique des commandes web. Le checkout lit seulement `sm.customer` dans `localStorage`, global à l'origine et sans expiration. Il ne récupère pas un profil fidélité : ce manque n'est pas une régression de déploiement.

Le QR affiché en caisse n'est pas une preuve suffisante pour exposer téléphone, adresse et historique personnel. Le profil privé et la session client doivent rester distincts de cette capacité de consultation de carte.

## Cadrage demandé pour le prochain lot

1. Identifiant client technique opaque, téléphone normalisé vérifié et dédoublonné **par restaurant** ; pas de clé primaire basée sur un numéro susceptible de changer. Aucun rattachement de carte ou d'anciennes commandes sur simple correspondance de numéro.
2. Adresse facultative à l'inscription et pour le retrait. Lors du choix livraison, demander la destination, vérifier la zone et afficher frais/total immédiatement. Enregistrer une adresse dans le profil seulement sur choix explicite ; figer l'adresse de chaque commande.
3. Invité conservé, inscription légère proposée sans la rendre obligatoire, champs préremplis uniquement s'ils sont vierges et session personnelle valide ; ne pas écraser une saisie en cours ni modifier silencieusement le profil pour une commande passée pour autrui.
4. Preuve anti-robot serveur, quotas par source/contact/restaurant et budget global, codes à usage unique et durée bornée, renvois/essais limités, aucune réponse révélant l'existence d'un compte. Aucun gain à la simple inscription ; gains seulement sur ventes admissibles confirmées, idempotentes.
5. Notifications transactionnelles séparées du consentement marketing. Pas de promotions fictives, urgence artificielle ou inscription forcée pour améliorer la conversion.

**Décision ultérieure du 6 septembre : Twilio Verify choisi, essai gratuit uniquement.** Aucun budget payant approuvé ni inscription publique activée. CLI installée et profil connecté ; préparation de la liste de recette, de l'échéance et des quotas sans envoi réel. L'essai ne permet pas de promettre des inscriptions SMS gratuites illimitées. Le [suivi unique](SUITE-APRES-COMMERCE.md) porte désormais les décisions et l'ordre de réalisation.
