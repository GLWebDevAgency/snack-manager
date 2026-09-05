# Parcours commerce — audit et critères de mise en production

Audit du 5 septembre 2026 sur `codex/commerce-delivery-stripe`, à la demande du fondateur. Priorité : clients du restaurant, caisse/cuisine, gérant et livreurs. Les chantiers IA, HACCP, RH avancées et scénographies de Claude ne sont pas des prérequis ajoutés implicitement à cette revue.

**Conclusion : la chaîne n'est pas encore complète pour une exploitation autonome.** Des parcours réels existent et sont testés, mais certaines fonctions commerciales sont absentes ; des parcours d'incident exigent encore le propriétaire ou du support manuel. Ni une démonstration fluide, ni une CI verte ne prouvent un parcours complet en production. Aucune validation staging ou production de ces nouveaux lots n'est revendiquée ici.

## 1. État par parcours

| Parcours | Ce qui existe dans la branche | Ce qui empêche de le déclarer terminé |
| --- | --- | --- |
| Vitrine → catalogue personnalisé | Domaine personnalisé, identité restaurant, menu, panier et lien vers le site vitrine | Informations produit/allergènes avant achat à publier depuis une source validée ; disponibilité réelle du paiement à exposer avant commande |
| Click & collect payé en ligne | Coordonnées, créneau, prix serveur, protection anti-abus, paiement, numéro et suivi | Reprise après actualisation/réponse perdue, notification du lien, abandon de paiement et exceptions d'exploitation |
| Click & collect payé au comptoir | Choix initial conservé et ticket existant visible dans le service POS | Pas d'action POS pour encaisser ce ticket avec moyen, monnaie rendue, journal et reprise ; la remise ne doit plus tenir lieu de paiement |
| Commande en ligne pour manger sur place | Type `surplace` présent au POS | Le parcours public ne propose que `pickup`/`delivery` ; pas de contexte table ni de parcours public sur place |
| Livraison | Zones postales, minimum/frais serveur, adresse, heure choisie/contrôlée, paiement préalable, départ et suivi | Pas de comptes/missions livreur, affectation sûre, preuve de remise, gestion d'incident ni réaffectation ; précommandes et paiement tardif à traiter |
| Fidélité | Création/scan de carte, session protégée, solde, programme/récompenses, interface installable | Pas de crédit automatique des commandes web ni de récompense consommable sur une commande ; compensation des remboursements à terminer |
| Suivi client | Paiement livraison distingué de la préparation, numéro, départ, remise et remboursements | Lien perdu au refresh si non conservé ; notifications absentes ; information de retard à compléter |
| Réception et exécution BO/POS/KDS | File, filtres, temps réel, préparation, restrictions cuisine/remise | File BO tronquée au jour/200 résultats, absence de réconciliation périodique BO, réception/refus/escalade non modélisés |
| Gérant → équipe polyvalente/livreurs | Staff caisse/cuisine/gérant, révocation de session ; comptes BO via CRM | Accès opérationnels liés au forfait RH/POS et au quota de comptes ; pas de permission livraison cumulable ni de self-service adapté |
| Historique restaurateur | Commandes du jour BO, export statistique, journal local POS, détail ancien par identifiant connu | Pas d'historique paginé avec périodes/recherche serveur ; export plafonné silencieusement ; journal POS non global |
| Compte client → historique → recommander | Session carte fidélité et lien individuel de suivi, données de vente conservées | Pas de compte consommateur unifié, historique personnel ou panier reconstruit avec validation des différences |

Les mentions « existe » désignent le code de la branche, pas son activation ni une recette sur les comptes Stripe, appareils ou domaines réels du restaurant.

## 2. Blocages prioritaires et preuves

### C01 — Reprendre une commande après interruption

**P1.** `Checkout` conserve la commande et sa clé dans `useState`/`useRef`, puis vide le panier après création. La fermeture de la feuille est désormais protégée pendant le paiement, mais une actualisation ou une fermeture d'onglet perd encore cette mémoire. Une réponse perdue avant réception du résultat peut conduire à une nouvelle clé et une deuxième commande.

À livrer : tentative persistée **avant** l'envoi ; corps métier/clé figés, récupération serveur de la même commande, accès « commande en cours » et conservation du lien de suivi. Ne jamais conserver le `client_secret` Stripe. Distinguer stockage indisponible, réponse inconnue, commande annulée et nouvelle commande volontaire.

Preuve : [`Checkout.tsx`](../../apps/web/src/components/order/Checkout.tsx), création, `clientIdRef`, `cart.clear()` et `resetTunnel`.

### C02 — Encaisser n'est pas remettre ; annuler n'est pas rembourser

**P1.** Le POS ne peut pas encaisser un retrait web existant : son action de remise exige déjà `paid`, et l'écran oriente vers le BO. L'API conserve un paiement comptoir implicite très restreint à la remise ; il manque montant serveur, moyen réellement utilisé, opérateur, instant, rendu et reprise explicites.

Le nouveau protocole refuse l'annulation d'une commande payée plutôt que de faire disparaître une recette sans geste financier. Cela laisse un vrai besoin : arrêt opérationnel distinct du traitement de l'argent, remboursement comptoir, délégation financière plafonnée et file des dossiers à rapprocher. Le remboursement Stripe propriétaire existe mais ne couvre pas tous ces cas. Les commandes intégralement remboursées doivent aussi disposer d'une terminaison opérationnelle explicite et libérer leur capacité une seule fois.

À livrer : cas d'usage « Encaisser cette commande », CAS commun avec Stripe et remboursement, opération idempotente, journal et UI caisse. Les règlements externes au TPE doivent être présentés comme constatés par l'opérateur, pas comme confirmés automatiquement par une intégration inexistante.

Preuves : [`ServicePanel.tsx`](../../apps/pos/src/ServicePanel.tsx), [`service-handover.ts`](../../apps/pos/src/service-handover.ts), [`orders.service.ts`](../../apps/api/src/modules/orders/orders.service.ts), [`order-finance.controller.ts`](../../apps/api/src/modules/orders/order-finance.controller.ts).

### C03 — File active fiable, même après minuit ou incident temps réel

**P1.** Le BO charge depuis minuit du navigateur, avec au plus 200 commandes. Ses filtres ne parcourent que ce lot. Une commande de la veille encore active peut disparaître après rechargement ; un avertissement de troncature ne permet pas de retrouver les suivantes. La publication Redis peut aussi échouer sans déconnexion de la socket ; le BO n'a pas le sondage de secours présent dans le KDS.

À livrer : file active indépendante de la date, historique paginé/recherche serveur, fuseau restaurant, rattrapage périodique et après reprise, visibilité explicite des données anciennes. Recette : 23 h 55 → 00 h 05, plus de 200 commandes, événement perdu, navigateur longtemps en arrière-plan.

Preuves : [`admin/orders/page.tsx`](../../apps/web/src/app/admin/orders/page.tsx), [`orders.service.ts`](../../apps/api/src/modules/orders/orders.service.ts), [`useBoard.ts`](../../apps/kds/src/useBoard.ts).

### C04 — Réception, refus, rupture et retard

**P1 avant exploitation non assistée.** Le BO possède un bouton « Accepter » qui passe directement de `new` à `preparing`. Il manque une décision commerciale complète avec délai, refus structuré et escalade. La disponibilité catalogue bloque les nouvelles commandes, mais une rupture découverte après paiement se traite manuellement. Pas de substitution acceptée par le client, refus par ligne, report d'estimation par commande ni escalade d'un ticket non pris en charge.

À définir puis livrer : mode d'acceptation explicite par restaurant (automatique ou opérateur), délai d'acquittement, pause de prise de commandes, refus motivé et traitement du paiement. Ne pas annoncer au client une préparation commencée sur la seule création en base.

Preuves : [`index.ts — statuts`](../../packages/contracts/src/index.ts), [`OrderDrawer.tsx`](../../apps/web/src/app/admin/orders/OrderDrawer.tsx), [`RefundModal.tsx`](../../apps/web/src/app/admin/orders/RefundModal.tsx), [`price-order-lines.ts`](../../apps/api/src/modules/orders/price-order-lines.ts).

### C05 — Abandons et paiements incertains

**P1.** La réservation de créneau n'est pas automatiquement expirée après abandon. Le nouveau protocole durable arbitre ouverture/annulation/webhook ; il ne fournit ni ordonnanceur d'expiration ni reprise autonome des fermetures. Une fin de fenêtre idempotente bancaire n'est pas une preuve que le créneau peut être libéré.

À livrer : politique réservée aux nouveaux flux éligibles, échéance serveur, fermeture bancaire vérifiée, reprise bornée, état « vérification », supervision et libération unique. Les preuves incertaines conservent leur capacité. Voir [conception détaillée](RESERVATIONS-IMPAYEES.md).

Preuves : [`slots.service.ts`](../../apps/api/src/modules/ordering/slots.service.ts), [`order-payment-lifecycle.service.ts`](../../apps/api/src/modules/ordering/order-payment-lifecycle.service.ts).

### C06 — Fidélité réellement liée à la vente

**P1 pour vendre la boucle complète.** Le solde consultable depuis la vitrine ne rattache pas le membre à la commande publique. Les achats web ne créditent pas automatiquement la carte. Le catalogue de récompenses est informatif ; l'ancienne consommation renvoie volontairement `410` tant que l'avantage n'est pas lié à une vente.

À livrer ensemble : identification consentie du membre, estimation des gains distincte du crédit acquis, réservation d'un avantage, application au chiffrage serveur, consommation sur fait métier confirmé et compensation en cas d'échec/remboursement. Tester deux caisses, web + caisse, dernier avantage concurrent, commande annulée, remboursement partiel et rejeu. **Ne pas simplement rouvrir l'ancienne route.**

Preuves : [`FideliteVitrine.tsx`](../../apps/web/src/components/order/FideliteVitrine.tsx), [`fidelite.ts`](../../apps/web/src/components/order/fidelite.ts), [`loyalty-member.controller.ts`](../../apps/api/src/modules/loyalty/loyalty-member.controller.ts), [`LoyaltyPanel.tsx`](../../apps/pos/src/LoyaltyPanel.tsx).

### C07 — Accès opérationnels inclus avec la livraison

**P1.** Sans formule POS/planning, l'offre de commande/livraison n'ouvre pas la gestion du staff. Le plafond d'un compte pour une offre sans plan inclut déjà le propriétaire. Donner un rôle caisse à un livreur serait trop large et ne constitue pas une délégation propre.

Décision recommandée : **les accès nécessaires pour exécuter une offre font partie de cette offre**. L'accès livraison est une habilitation opérationnelle, cumulable avec le métier principal d'un membre polyvalent. Planning, pointage et coûts RH restent commercialement distincts. Les prix peuvent encadrer des volumes, mais pas empêcher de servir une commande vendue.

À livrer : invitation/activation, identité individuelle, périmètre restaurant, habilitations cumulables, révocation immédiate, remplacement d'appareil, traçabilité et limites de consultation. Le gérant doit pouvoir gérer ces accès sans intervention systématique du CRM Snack Manager.

Preuves : [`commerce.ts`](../../packages/contracts/src/commerce.ts), [`comptes.ts`](../../packages/contracts/src/comptes.ts), [`staff.controller.ts`](../../apps/api/src/modules/staff/staff.controller.ts), [`staff.dto.ts`](../../apps/api/src/modules/staff/staff.dto.ts).

### C08 — Application livreur et missions

**P1 si cette application est vendue.** Le départ actuel reçoit un `driverName` facultatif, pas une identité ou une mission. Il n'y a pas de connexion livreur, d'affectation/retrait d'affectation ni de liste limitée à ses commandes.

Parcours cible : gérant habilite → affecte → livreur prend en charge → départ confirmé → remise ou incident → clôture. L'interface web mobile installable suffit comme format ; son niveau de fiabilité ne doit pas être celui d'une démo. Le livreur ne voit que les données nécessaires à ses missions actives, pas la comptabilité ni les autres clients.

À livrer : missions persistées, affectation exclusive/versionnée, acceptation, réaffectation, changement de tournée sans double remise, révocation et journal. Recette obligatoire avec un livreur dédié et un membre caisse + livraison.

Preuves : [`delivery.ts`](../../packages/contracts/src/delivery.ts), [`delivery.service.ts`](../../apps/api/src/modules/delivery/delivery.service.ts), [`DispatchModal.tsx`](../../apps/web/src/app/admin/orders/DispatchModal.tsx).

### C09 — Preuve de remise et incidents

**P1 avant livraison autonome promise.** Le BO confirme aujourd'hui le départ puis « livrée ». Aucun code/QR client ne prouve la remise et aucun workflow ne traite client absent, mauvaise adresse, refus du colis ou preuve perdue.

À livrer : preuve distincte du QR fidélité et du token de consultation, liée à la commande et à l'opérateur autorisé ; consommation atomique, durée/quotas d'essais, refus des replays. Le livreur ne doit pas voir le code attendu avant que le client le lui présente. Prévoir réaffectation, code perdu et dérogation responsable motivée. Sans réseau, afficher une opération en attente, jamais une remise confirmée fictive. Voir [règles de remise](SUITE-APRES-COMMERCE.md).

### C10 — Commande publique sur place

**P1 si proposée commercialement.** `surplace` au POS ne suffit pas : contrat et UI publics ne proposent pas ce mode. La distinction « à manger ici » / « à emporter » doit rester visible dans le ticket, la cuisine, le suivi et la remise.

Deux variantes à ne pas confondre : sur place avec retrait au comptoir ; service à table avec contexte de table vérifiable. Recommandation pour fast-food : rendre d'abord le parcours sur place au comptoir complet, puis le service à table configurable. Si QR de table, le contexte ne doit pas être une valeur arbitraire permettant de commander pour une autre table/établissement. Vérifier aussi fermeture, commandes successives, note cuisine et règles fiscales du restaurant sans déduire une TVA depuis une simple étiquette UI.

Preuves : [`FulfillmentSchema`](../../packages/contracts/src/delivery.ts), [`CreatePublicOrderSchema`](../../packages/contracts/src/index.ts), [`Checkout.tsx`](../../apps/web/src/components/order/Checkout.tsx).

### C11 — Retrouver le suivi et recevoir les changements utiles

**P1.** Aucun envoi transactionnel effectif ne livre aujourd'hui au client son lien de suivi ou l'alerte « prête/en route/incident ». Un port de notification défini n'est pas un service raccordé. Le suivi de livraison impayée présentait aussi la commande comme reçue en cuisine ; ce défaut est corrigé, avec 14 tests de rendu et une recette navigateur mobile/bureau. Le créneau impayé est désormais présenté comme souhaité, pas comme une arrivée acquise.

À livrer : canal choisi explicitement, lien récupérable, consentements nécessaires, notifications idempotentes et vérification de délivrabilité. Un service web mobile n'impose pas de commencer par du SMS payant, mais l'absence de canal doit rester visible et avoir une alternative fiable. La page doit distinguer paiement, réception, préparation, départ, remise et incident, sans fausse estimation temps réel.

Preuves : [`notifier.ts`](../../packages/domain/src/ports/notifier.ts), [`Tracking.tsx`](../../apps/web/src/components/order/Tracking.tsx), [`Checkout.tsx`](../../apps/web/src/components/order/Checkout.tsx).

### C12 — Information produit, connectivité et disponibilités

Avant une livraison réelle, les informations nécessaires à la décision d'achat doivent être consultables avant paiement. Le renvoi « allergènes/composition au comptoir » ne ferme pas ce parcours ; réutiliser les données validées du restaurant plutôt qu'inventer une composition. Une revue réglementaire dédiée reste requise : cet audit n'est pas une certification.

Autres limites à traiter : ancien marqueur de paiement indisponible conservé toute la session ; QR fidélité nécessitant le réseau pour sa présentation ; capacité d'installation testée dans le code mais pas encore sur les téléphones du pilote. Ne pas stocker durablement un secret de carte pour promettre un mode hors ligne sans concevoir révocation et risque de rejeu.

Preuves : [`Storefront.tsx`](../../apps/web/src/components/order/Storefront.tsx), [`supply.ts`](../../packages/contracts/src/supply.ts), [`LoyaltyCardApp.tsx`](../../apps/web/src/components/loyalty/LoyaltyCardApp.tsx).

### C13 — Historique restaurateur exploitable

**P1.** Il existe un historique partiel, pas une consultation complète. Le BO ne permet pas de sélectionner une plage de dates ni de chercher au-delà de sa fenêtre ; le CSV statistique coupe silencieusement à 20 000 ; le POS conserve un journal local qui n'est pas l'historique global. Les agrégats actuels de commandes prêtes/remises ne sont pas des encaissements nets.

À livrer : BO « En cours / Historique », périodes courtes et personnalisées, recherche/pagination serveur, filtres opérationnels et financiers séparés, export cohérent et recherche rapide POS. Les commandes actives restent hors limite calendaire. Droits, fuseau, chiffres financiers et tests de réception : [spécification détaillée](HISTORIQUE-ESPACE-CLIENT.md).

### C14 — Espace client unifié et « Recommander »

**P1 pour la boucle de réachat.** La carte expose des mouvements de points, pas les achats. Il manque une identité client vérifiée, le rattachement sûr des commandes et une API d'historique personnel. `Order.clientId` est une clé d'idempotence, pas une identité ; ne pas regrouper les ventes par téléphone ni donner l'historique entier au détenteur d'un QR présenté en caisse.

À livrer : « Mes commandes · Ma fidélité · Mon profil », achat invité conservé, reprise sur le même appareil et récupération sécurisée. L'historique accompagne l'offre de commande même sans module fidélité. « Recommander » prépare un panier aux conditions actuelles, avec différences explicites et confirmation. La réconciliation actuelle du panier peut remplacer une variante ou retirer une exclusion d'ingrédient devenue inconnue : ne pas l'utiliser telle quelle pour recopier un achat passé.

Identités, domaines personnalisés, reprise, droits et ordre des lots : [historique et espace client](HISTORIQUE-ESPACE-CLIENT.md).

### C15 — Coordonnées reconnues et livraison à l'heure choisie

**P1 pour le parcours demandé depuis la carte installée.** La carte QR actuelle ne publie que l'alias et le solde ; pas le téléphone. Le préremplissage depuis la fidélité nécessite une session personnelle supplémentaire, pas l'élargissement des droits du QR. Les informations manquantes doivent être demandées une première fois, les informations connues vérifiables/modifiables, sans écrasement par une réponse réseau tardive. Voir [contrat de préremplissage](HISTORIQUE-ESPACE-CLIENT.md).

Le choix d'une **heure précise** existe déjà, avec validation serveur avant création et sous verrou de créneau. Les frais/minimum et la capacité cuisine/livraison sont contrôlés. Le retrait peut être réglé en ligne ou au comptoir ; la livraison exige le paiement en ligne Connect du restaurant et ne part pas en préparation avant confirmation bancaire. Une heure choisie est une arrivée estimée, pas une garantie de trajet.

Lacunes supplémentaires confirmées :

- Paiement repris après l'heure choisie : aucune revalidation du créneau au paiement ; prévoir fermeture vérifiée avant règlement ou replanification/validation responsable après paiement reçu. Ne jamais ignorer un vrai débit tardif.
- Toutes les heures du jour complètes : absence de `nextOpenDate` dans ce cas, donc pas de navigation proposée vers le lendemain malgré sa disponibilité possible.
- Service après minuit (ex. 18 h–02 h) : plage ignorée par le calcul actuel. Vérifier les horaires réels du pilote.
- Précommande future : arrivée immédiate au KDS et retard mesuré depuis la création, sans heure de mise en production planifiée. Prévoir file « À venir », début de préparation et alertes adaptés au créneau.
- Fuseaux : clients/tickets en Paris, BO/KDS dans le fuseau du terminal ; normaliser. Les horaires de livraison reprennent les horaires restaurant, et le délai fixe ne vérifie ni trajet ni disponibilité de mission.

Preuves : [`slots.service.ts`](../../apps/api/src/modules/ordering/slots.service.ts), [`Checkout.tsx`](../../apps/web/src/components/order/Checkout.tsx), [`Board.tsx`](../../apps/kds/src/Board.tsx), [`OrderCard.tsx`](../../apps/kds/src/components/OrderCard.tsx), [`delivery.ts`](../../packages/domain/src/ordering/delivery.ts). Le délai global du restaurant, commun aux zones, n'est pas un calcul d'itinéraire.

Recette à ajouter : client reconnu/invité, coordonnées incomplètes/modifiées, adresse hors zone, livraison à heure choisie, journée pleine, minuit, paiement tardif, précommande future et même horaire visible chez les quatre acteurs.

## 3. Ordre de travail actualisé

1. **Terminer les protections et la reprise de commande** : correctifs bancaires en cours, reprise après interruption, encaissement distinct de la remise, annulation/remboursement et expiration sûre.
2. **Fiabiliser le service quotidien et l'historique gérant** : file active, périodes/recherche/export, réception, disponibilité produit, rattrapage réseau, notifications et exceptions payées.
3. **Unifier l'espace client et fermer la boucle fidélité** : identité/rattachement, historique personnel, panier « Recommander » vérifié, gains web/POS, réservation/consommation sur commande, remboursements et reprise.
4. **Livrer les accès opérationnels puis l'espace livreur** : polyvalence, missions, affectation, départ, preuve et incidents ; pas d'accès RH imposé pour livrer.
5. **Compléter le sur-place public** : retrait au comptoir, puis table si cette prestation est retenue ; chiffrage et suivi cohérents entre toutes les apps.
6. **Recette de bout en bout sur staging, puis activation par offre**. La migration Billing ajoutée précédemment reste suivie séparément : sa préparation B1 est poussée, sans nouvel émetteur activé. Elle ne remplace aucun des parcours ci-dessus.

Cet ordre n'abandonne ni Billing ni les chantiers de Claude. Il recentre la prochaine livraison sur la chaîne métier demandée. Une fonctionnalité non livrée reste non vendue comme disponible ; retirer la mention « pilote » sans terminer le parcours n'est pas une correction.

## 4. Définition de terminé par offre

- Chaque acteur peut finir son parcours depuis **son** application et ses droits, sans manipulation DB, compte propriétaire partagé ou recréation de commande.
- Montants, gains, remboursement et remises sont décidés côté serveur, avec opérations idempotentes et traces rapprochables.
- Les interfaces survivent à actualisation, onglet fermé, double clic, événement perdu, réponse retardée, suspension et révocation ; aucun écran ne présente une opération locale incertaine comme acquise.
- Prix, menus, modes de consommation, commande, cuisine et suivi expriment les mêmes faits. Les promesses commerciales correspondent aux fonctions activées pour cette offre.
- Tests automatiques, vraie base, recette bancaire sandbox, appareils/navigateurs cibles, installation et connexions dégradées sont vérifiés avec preuves. Les mocks n'attestent ni un paiement bancaire ni une impression matérielle.
- Les alertes, journaux sans secrets, rapprochements et reprises sont utilisables par l'exploitant ; restauration et bascule des versions sont vérifiées en proportion du risque.
- Staging vérifié au SHA exact, comptes/configurations réels validés, puis **GO production distinct**. Les garde-fous de concurrence ne permettent pas de mélanger ancien et nouveau protocole pendant le déploiement.

## 5. Ce qui a déjà été corrigé pendant cet audit

- Tentative bancaire durable avant Stripe, annulation fermée avant effet, récupération du même PI, webhook anticipé, version commune et lectures majoritaires : [protocole](PAIEMENTS-ANNULATION-DURABLE.md).
- Suppression du repli comptoir après tentative incertaine ; réessai du même ticket et accès au suivi. Le choix comptoir **initial** reste disponible pour le retrait.
- Conservation du choix de paiement en ligne au retrait et de son état `pending`, sans faux encaissement à la remise.
- Suivi de livraison impayée distinct de la prise en cuisine ; états terminaux et remboursements différenciés.
- Fermeture/navigation neutralisées pendant une création en cours ; moyen de paiement relu depuis la commande serveur au rejeu, pas déduit du dernier choix local.
- Numérotation des factures : lectures majoritaires et génération relue avant matérialisation ; aucun historique modifié.
- Audit B1 pur des contrats Billing : divergences explicites plutôt que migration automatique des montants erronés.

Preuves de cette passe : API générale 1 728 tests verts, dont Mongo paiement 27 scénarios métier réels + 10 garde-fous et Mongo facturation 13 scénarios + 10 garde-fous ; 6 tests PostgreSQL non exécutés dans cette commande locale. Domaine 327 tests ; web général 664 tests, dont les 11 cas supplémentaires sur l'autorité du paiement rejoué. Ces nombres décrivent des exécutions datées, pas un score de complétude produit.

Recette navigateur ciblée : vrai code Next local, API et Stripe simulés, retrait mobile 390 × 844 et livraison bureau 1440 × 1000 ; une seule création de commande, deux demandes de paiement sur la même commande après erreur, aucun repli comptoir, état bancaire `processing` non présenté comme payé. Playwright utilisé car le plugin Browser n'est pas disponible. Turbopack local renvoyait une 404 avant la route ; recette réalisée avec l'option locale `--webpack`, sans changer la configuration de déploiement. Staging, Stripe réel, matériel d'impression et téléphones physiques **non validés par cette recette**.

Recettes additionnelles : contrôle de fermeture pendant le POST d'abord rouge puis vert ; rejeu d'un POST après réponse perdue, avec choix local comptoir mais commande serveur toujours en ligne, sans fausse confirmation ; suivi de livraison impayée vérifié en bureau et mobile. Les erreurs HTTP 400/503 attendues viennent précisément des doubles de zone invalide/réponse perdue, pas d'une console déclarée propre en ignorant toutes les erreurs.

Contrôle Stripe de test renouvelé en lecture seule le 5 septembre : le compte Connect identifié pour Classfood reste `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false` et `requirements.past_due`. Des informations d'activité/support, compte externe et acceptation de conditions restent attendues. Aucun de ces champs, aucun compte bancaire ni acceptation n'a été renseigné à la place du titulaire. La recette bancaire de ce restaurant reste donc distincte et bloquée par l'onboarding, en plus des parcours applicatifs à finir. Voir [état distant](STRIPE-ETAT-DISTANT-2026-09-05.md).
