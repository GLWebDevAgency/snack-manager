# Commande et Livreur V2

Cette version reprend la présentation du kit mobile et l'intègre aux parcours réels. Les montants, disponibilités, paiements, affectations et remises restent déterminés par les contrats et services métier. Les maquettes ne constituent pas une source de données.

## Piloter la marque et la carte

`/admin/site` regroupe quatre sections : **Identité**, **Accueil**, **Carte** et **Style avancé**. La marque du restaurant reste unique : logo, couleurs, polices et accroches sont partagés avec les surfaces qui consomment cette identité, y compris les icônes installées. Un logo explicitement retiré d'une marque existante ne revient pas depuis l'ancien champ `logoUrl` ; l'héritage reste disponible pour la première configuration d'un restaurant ancien.

L'aperçu Commande utilise les composants publics et les vrais produits, prix et photos du restaurant, dans un cadre isolé sans interaction de commande. Il montre le brouillon ; seul l'enregistrement acquitté modifie les données servies. Une erreur de relecture et un brouillon devenu ancien sont signalés. L'aperçu n'est pas une preuve de publication immédiate : caches des pages, icônes et propagation DNS conservent leurs propres délais.

La présentation des produits distingue photo détourée et photo de couverture. Le choix « populaire » peut être automatique, imposé ou masqué ; l'automatisme utilise les quantités vendues et payées des trente derniers jours, parmi les produits actifs avec photo. Les mises en avant réutilisent la sélection du catalogue. Ces réglages n'envoient pas de nouveaux prix, variantes ou options. Les accès Marque et Menu restent contrôlés séparément selon le rôle et les capacités du restaurant.

## Commander

La navigation propose **Carte**, **Rechercher**, **Commandes** et **Fidélité** lorsque cette dernière est disponible. Les onglets de la page Commande partagent le panier et son contrôleur ; les changements d'onglet et le retour navigateur conservent la sélection. Les liens directs utilisent `/r/{slug}/carte`, `/recherche` et `/commandes`.

Le retrait présente trois étapes : panier, créneau, puis coordonnées et paiement regroupés. La livraison conserve quatre étapes afin de vérifier séparément l'adresse et le devis. Les créneaux sont relus, les options obligatoires et variantes restent validées, et le prix accepté vient du parcours serveur. Les verrouillages de commande et de paiement restent actifs pendant une opération incertaine.

L'onglet Commandes distingue les raccourcis invités de cet appareil, conservés sept jours, de l'historique authentifié du compte. Oublier un raccourci n'annule ni la commande ni son paiement ; les reçus nécessaires à une reprise en cours restent protégés. Recommander relit les références historiques et le catalogue actuel, puis demande de résoudre les produits, variantes ou options devenus incompatibles avant de remplir le panier. Un ancien prix n'est pas réutilisé comme tarif courant.

Le paiement express et le formulaire carte utilisent la même intention Stripe et le même compte connecté. Un wallet indisponible laisse le formulaire carte utilisable. Une réponse `processing` reste une confirmation bancaire en cours ; elle n'est pas annoncée comme un paiement terminé.

## Livrer

L'espace livreur propose **Tournée**, **Carte**, **Historique** et **Compte**. La session expose la marque et les coordonnées du restaurant ainsi que les missions affectées à cet accès. La vue Carte représente les arrêts et leurs adresses réelles ; elle ouvre Google Maps, Plans ou Waze. Elle ne fournit ni position GPS, ni kilomètres calculés, ni optimisation automatique de tournée.

Le départ exige toujours une mission prête, affectée à l'opérateur et dont le paiement est confirmé. La remise exige une confirmation explicite après saisie du code ou lecture du QR. Un QR reconnu n'est pas une livraison confirmée. Les opérations conservent leur UUID et leur révision pour la reprise ; un timeout conduit à vérifier la même opération, sans produire une seconde intention. Le succès n'apparaît qu'après la réponse serveur. Signaler un incident n'annule ni ne rembourse automatiquement la commande.

L'historique est une lecture serveur séparée, paginée par cinquante livraisons terminées, limitée au restaurant et à l'opérateur authentifié. Il utilise l'heure de remise enregistrée par le serveur et ne réintroduit pas ces missions dans la liste des actions disponibles. Les résumés de paiement exposés sont en lecture seule.

Les préférences locales couvrent le thème, l'application de navigation, l'alerte sonore et le maintien de l'écran allumé pendant une tournée. Le son, la vibration et le Wake Lock dépendent des autorisations et possibilités du navigateur. Le lien SMS ouvre le composeur du téléphone : l'envoi reste une action du livreur, sans envoi serveur automatique ni garantie de réception.

## Notifications, wallets et exploitation

L'alerte « commande prête » exige le consentement pour cette commande et cet appareil, puis un acquittement durable. Les abonnements chiffrés sont bornés à cinq par commande, expirent au plus tard sept jours après sa création et sont traités sous bail. Une révocation et une réponse tardive sont arbitrées par révision. Le traitement est **au moins une fois** ; un message déjà remis au fournisseur ne peut pas être rappelé.

Les domaines de paiement Stripe Connect sont réconciliés en arrière-plan depuis la configuration publique et les domaines actifs du restaurant, indépendamment du checkout. Les hôtes, modes et comptes sont contrôlés ; un domaine désactivé manuellement n'est jamais réactivé par ce traitement. Le rattrapage et ses caches sont asynchrones.

- [Notifications : configuration, stockage et limites](../apps/api/src/modules/order-notifications/README.md)
- [Domaines Stripe : périmètre, délais et recette isolée](../apps/api/src/modules/payment-domains/README.md)
- [Configuration d'environnement](../.env.example)

La CI exécute les cas durables push sur MongoDB, ainsi que les projections MongoDB et baux Redis PMD, dans des étapes dédiées avec cibles locales et ressources de test isolées. Stripe et les fournisseurs push y sont simulés : ces tests ne prouvent pas l'apparition d'Apple Pay/Google Pay ni la réception d'une notification sur un appareil installé. Ces parcours nécessitent une recette sur le domaine et les appareils concernés.

## Arbitrages du kit et partage futur

L'encaissement d'espèces à la porte n'est pas introduit : il demanderait un parcours de caisse et de rapprochement distinct du prépaiement actuel. Le délai d'annulation fictif et le succès avant réponse serveur sont écartés. Une fermeture de page ne constitue pas une garantie de transmission. Les distances, revenus et événements absents des données ne sont pas inventés.

Les contrats et règles indépendantes du navigateur restent dans les packages partagés, notamment `@sm/contracts` et `@sm/client-core`. Les composants DOM, permissions, liens natifs et service workers restent des adaptateurs web ; une future application Expo devra fournir ses adaptateurs et être validée sur appareils, tout en conservant les mêmes contrats métier.
