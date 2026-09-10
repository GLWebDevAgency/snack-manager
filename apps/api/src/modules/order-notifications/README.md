Notifications transactionnelles de commande

Le consentement porte sur une commande et l'abonnement de cet appareil. Les routes publiques recoupent le restaurant avec la capacité de suivi existante ; elles ne rendent aucune donnée de compte. Le navigateur affiche « activée » après l'ACK durable. Une révision CAS empêche un POST retardé de réactiver une préférence désactivée entre-temps. Après conflit, l'utilisateur doit consentir de nouveau.

Configuration API (secrets dans le gestionnaire du déploiement, jamais dans le web) :

- ORDER_PUSH_VAPID_PUBLIC_KEY et ORDER_PUSH_VAPID_PRIVATE_KEY : paire P-256 VAPID, base64url.
- ORDER_PUSH_VAPID_SUBJECT : URL HTTPS publique réelle de la plateforme.
- ORDER_PUSH_ENCRYPTION_KEY_BASE64 : clé aléatoire de 32 octets encodée en base64.

Une configuration incomplète désactive l'inscription et le worker. Conserver les clés entre déploiements : changer la clé de chiffrement rend les abonnements existants indéchiffrables ; changer la clé VAPID nécessite leur renouvellement navigateur. Aucun secret n'est journalisé. L'URL et les clés d'abonnement sont chiffrées AES-256-GCM avec une donnée associée tenant/commande/empreinte d'endpoint.

Le modèle OrderReadyNotification déclare unicité tenant/commande, index de travail et TTL. Il est enregistré par le DatabaseModule existant. Les abonnements sont bornés à cinq par commande et expirent au plus tard sept jours après sa création. Une réplique prend un bail durable de 120 secondes ; chaque tentative relit l'état enregistré de la commande, son paiement, puis le consentement et le bail. Paiement confirmé exigé, sauf retrait au comptoir en attente de paiement ; remboursement en cours bloque l'envoi. Les états terminaux annulent l'alerte. Les échecs transitoires font huit tentatives espacées de 15 secondes à 15 minutes ; un 404/410 ou une redirection efface les clés. Aucun autre hôte que les trois fournisseurs déclarés au contrat n'est accepté et le transport ne suit pas les redirections.

Le traitement est au moins une fois : un arrêt après remise au fournisseur mais avant ACK Mongo peut provoquer une seconde remise. Le tag stable remplace la notification affichée ; il ne garantit pas une réception exactement une fois. Une notification déjà remise au fournisseur ne peut être rappelée par une révocation ultérieure. Les délais du navigateur/fournisseur restent indépendants du worker.

La PWA est isolée sous /r/{slug}/, démarre sur /carte et ouvre /commandes sans identifiant ni preuve. Son worker ne gère aucun fetch et ne crée aucun cache. Depuis un lien de suivi /t portant une preuve, l'installation renvoie explicitement vers la carte publique. Le clic d'une notification se contente de focaliser un onglet Commandes déjà ouvert, pour conserver ses brouillons ou un paiement en cours.

Vérifications locales : tests contrat et schéma ; routes HTTP Nest réelles avec service simulé ; chiffrement et frontière web-push simulée ; tests Mongo sur un mongod éphémère lié à 127.0.0.1 (SM_TEST_MONGOD permet de désigner le binaire, aucun MONGO_URL applicatif utilisé) ; composants React dans Chromium avec API/permission/PushManager simulés ; vrais PNG 180/192/512 et manifest/SW. Ces tests ne prouvent pas la réception sur un iPhone/Android installé, ni un envoi VAPID sur un fournisseur réel. Une recette matérielle consentie reste nécessaire sur le domaine déployé.
