# L2.3 — Remise sécurisée, incidents et reprise

## État et périmètre

Ce lot prolonge les [accès livreur](ACCES-LIVREUR.md) et les [missions L2.2](MISSIONS-LIVREUR.md). Code et tests préparés le 7 septembre 2026 ; la PR du lot porte la CI du SHA final, puis les preuves de déploiement et de recette. Ce document ne prouve pas à lui seul une mise en ligne. Le dernier staging attesté avant ce lot est `ea0b327d2028c15e890fc5f5623122d7a8a7dd7d` ([#129](https://github.com/GLWebDevAgency/snack-manager/pull/129)), qui corrige la lecture des réglages livraison hydratés par Mongoose. Production inchangée.

Le lot ne crée ni compte client, ni carte fidélité, ni SMS. Il ne déclenche aucun encaissement, remboursement ou déplacement. Une commande invitée peut être remise sans dépendre de l'inscription fidélité L3.

## Parcours et responsabilités

1. Le responsable affecte une mission L2.2. La cuisine la prépare et la marque prête ; elle ne confirme jamais la remise.
2. Le départ exige le paiement confirmé et l'absence de blocage financier connu. Le client peut alors afficher sa preuve privée depuis le suivi ouvert sur l'appareil ayant commandé.
3. À l'arrivée, le livreur demande le PIN à six chiffres ou scanne le QR du client. Reconnaître un QR ne livre pas la commande : le livreur confirme explicitement la remise.
4. Seule une réponse serveur corrélée confirme la livraison. La mission quitte la liste active, avec une confirmation finale lisible.
5. Client absent, injoignable, adresse incorrecte, preuve indisponible ou refus : signalement explicite, sans remise ni remboursement automatique.
6. Un responsable peut renouveler la preuve ou autoriser une remise exceptionnelle après incident. Le motif obligatoire de 10 à 300 caractères est audité ; ni le paiement ni le départ ne peuvent être contournés.

| Acteur | Actions de ce lot |
| --- | --- |
| Client disposant de l'accès privé | Afficher sa preuve pour cette commande uniquement |
| Livreur authentifié et affecté | Consulter l'état, soumettre la preuve, signaler un incident, résoudre sa propre opération incertaine |
| Caisse habilitée du restaurant | Preuve et incident depuis la fiche livraison du back-office ; pas de dérogation ni renouvellement |
| Owner, cogérant/gérant habilité | Actions caisse, renouvellement motivé, dérogation motivée après incident |
| Cuisine | Aucune remise ; la route historique reste interdite |

L'ancien `PATCH` général vers `delivered` est fermé pour **toutes les livraisons**, y compris historiques et déjà livrées, avant son retour idempotent. Les remises comptoir ne sont pas modifiées. Un ancien onglet BO doit être rechargé pour utiliser la nouvelle interface. Une ancienne livraison sans accès privé client suit incident puis décision responsable : aucune preuve n'est inventée à partir de son téléphone ou de son jeton de suivi.

## Séparer suivi partagé et preuve privée

Le `trackingToken` sert déjà aux tickets et projections professionnelles : **il ne permet jamais d'obtenir le PIN ou le QR de remise**. Le serveur exige le `clientId` et le `recoveryProof` privés de la tentative C01 d'origine, vérifiés contre leur empreinte liée au restaurant et à la commande.

- Le reçu navigateur de livraison conserve cet accès privé par origine, restaurant et commande, dans un magasin IndexedDB séparé. Borne : 128 reçus, sept jours ; nettoyage opportuniste des reçus expirés, jamais suppression d'une tentative C01 incertaine.
- Une place est réservée avant l'envoi d'une nouvelle livraison. Un stockage refusé ou plein bloque ce parcours avec une explication ; il ne provoque pas un POST non récupérable.
- Le lien client peut transférer l'accès dans un **fragment** `#remise=v1.…`, jamais dans une query, un ticket, une projection serveur ou un journal. Ce fragment est une capacité privée, pas le PIN/QR. Il ne doit pas être partagé au restaurant ni à un tiers.
- L'import ne retire le fragment qu'après vérification serveur et écriture locale durable. Un reçu expiré pour la même commande n'est pas silencieusement prolongé ; un échec conserve le fragment.
- Avant un retour Stripe, l'URL est reconstruite sans fragment. Sur le geste explicite « Reprendre le paiement », l'import peut utiliser la récupération C01 existante. **Cette récupération n'est pas purement en lecture : elle peut terminer la matérialisation d'une commande déjà admise.** Elle ne crée pas une nouvelle admission et ne change pas l'identité de tentative. Seule une réponse `created`, strictement corrélée au restaurant, à la commande livraison et au jeton de suivi, permet l'import. Aucun appel de récupération n'est déclenché au simple montage/focus.
- Le PIN/QR affiché reste en mémoire, est masqué hors ligne, en arrière-plan, à expiration et à la clôture. Les réponses tardives invalidées ne le réaffichent pas. Le QR est dessiné localement, sans générateur externe.

Effacer les données du navigateur, changer d'origine/appareil sans transfert privé ou perdre cet accès impose de contacter le restaurant. Ce magasin n'est ni « Mon compte » ni « Mes commandes » ; L3 demeure séparé. Aucun code n'est envoyé par Twilio dans ce lot.

## Autorité serveur et écriture durable

`Order.deliveryHandoff` est un agrégat privé, versionné, `select:false`, exclu des sérialisations usuelles. Il contient une révision, une preuve chiffrée, l'incident éventuel, la remise et jusqu'à **64 reçus d'opération**, sans TTL ni troncature.

Chaque geste porte un UUID, la révision de remise et celle de mission attendues. Un CAS protège simultanément `__v`, les révisions, l'affectation, le statut et les barrières financières locales. La consommation de preuve, la remise, l'horodatage, l'historique de statut et le reçu sont écrits dans la même commande. Acquittement majoritaire journalisé et relecture primaire majoritaire ; aucun succès supposé sur timeout.

- Preuve : PIN uniforme à six chiffres et QR aléatoire à forte entropie, liés à la commande et à l'époque de preuve. Durée initiale : 24 h depuis le départ. Un renouvellement responsable crée une nouvelle époque de 24 h et clôt l'incident ; l'ancienne devient inutilisable.
- Cinq essais incorrects distincts verrouillent la preuve. Le rejeu exact d'un essai ne consomme pas un nouvel essai. L'expiration est également vérifiée dans le CAS avec l'horloge Mongo, pas seulement dans le navigateur.
- Même UUID/corps/auteur : réponse idempotente avec vue **actuelle**. Autre corps/action/auteur : conflit, sauf reçu d'abandon : pour la même enveloppe et le même auteur, il reste abandonné même si le corps change. L'empreinte du corps est un HMAC, pas un hash permettant de tester hors ligne les PIN possibles.
- Une réponse perdue laisse une intention locale sans PIN/QR/motif. « Vérifier cette action » envoie seulement l'identifiant, l'action et les révisions. Si la preuve existe, elle est relue ; sinon un reçu d'abandon est écrit, empêchant un ancien POST retardé d'agir ensuite.
- Une mission devenue terminale peut encore résoudre sa propre opération incertaine, sans restaurer les coordonnées client. Un 404 n'efface pas cette intention. La session et l'auteur restent contrôlés, y compris après changement d'identité.
- Journal saturé : refus de tout nouveau geste, y compris dérogation/renouvellement. Les reçus connus restent résolubles. Il n'existe pas de bouton administrateur permettant de supprimer l'historique pour contourner ce plafond.
- Audit append-only idempotent par opération et publication de mise à jour sont réparables au rejeu. Leur échec peut laisser une remise déjà écrite à vérifier ; ne pas créer une seconde livraison pour contourner l'erreur.

Les routes privées manager sont `/delivery/missions/:id/handoff`, les routes livreur `/delivery-access/missions/:id/handoff`, derrière le BFF cookie HttpOnly `/livreur/missions/:id/handoff`. La preuve client utilise un POST privé `/public/orders/:id/delivery-proof`. Corps stricts, quotas partagés, isolation tenant/acteur, absence de cache et politique de référent privée sont contrôlés. Le BFF livreur refuse les actions responsable, les redirections et les réponses non corrélées.

## Clé et exploitation

`DELIVERY_HANDOFF_KEY` contient **32 octets aléatoires en base64url canonique**, soit 43 caractères. Clé dédiée, sans repli sur JWT/fidélité/relais ; HKDF sépare chiffrement AES-256-GCM et HMAC des reçus. Le chiffrement authentifié lie restaurant, commande, époque et expiration. Aucune clé, preuve ou corps secret ne doit apparaître dans les logs, captures ou arguments de recette publiés.

- GitHub : `SM_DELIVERY_HANDOFF_KEY_STAGING` ; production : `SM_DELIVERY_HANDOFF_KEY_PRODUCTION`, différente et à provisionner seulement pour la promotion autorisée. La clé staging existe ; aucune clé production n'a été créée par ce lot.
- Le préflight valide le format **avant les migrations**. La publication runtime vérifie aussi l'indépendance des clés ; seule l'API reçoit la clé avec `--skip-deploys`, avant son déploiement. Les logs de la CLI Railway restent masqués.
- **Conserver et sauvegarder cette clé durablement. Ne pas la régénérer à chaque déploiement.** Le protocole ne possède pas encore de trousseau/version de clé : la remplacer casse le déchiffrement des preuves existantes et la comparaison des reçus. En cas de perte/compromission, suspendre les gestes concernés et préparer une reprise contrôlée ; une rotation aveugle n'est pas une réparation.
- Pas de migration SQL ni de backfill automatique des anciennes commandes. L'ajout Mongo est nullable ; les preuves sont créées à la demande.
- **Rollback :** après premières remises L2.3, ne pas redéployer un ancien binaire qui ignore l'agrégat et rouvre le `PATCH delivered`. Préférer un correctif en avant. Tout retour exceptionnel exige l'arrêt des gestes concernés et le rapprochement des opérations en vol, en conservant clé et reçus.

## Vérification et limites

Les tests couvrent crypto, contrats, schéma privé, politique de remise, vrais services Mongo, vrais contrôleurs/gardes Nest, BFF, IndexedDB natif et composants Chromium. Ils exercent mauvais tenant/livreur, ancienne session, doublon/retard, expiration, verrouillage, incident, dérogation, rotation, journal plein, retour Stripe sans capacité privée et import C01 strict. La PR consigne les commandes exécutées et leurs résultats ; les nombres de tests ne doivent pas être additionnés comme une mesure de couverture produit.

Une recette supplémentaire relie les vrais composants client/livreur à Nest et Mongo, via un relais d'authentification de test à routes limitées : génération de preuve, import IndexedDB puis rechargement client, PIN présenté au livreur, réponse réelle tronquée après commit, rechargement livreur, GET 404 puis résolution idempotente. Deux exécutions vertes ; la seconde avec les 14 tests HTTP conservés (15/15). Même commande, même opération, même date de remise, un seul audit ; aucune requête externe ni capture de code. Ce relais de test ne certifie pas les cookies du BFF Next servi, couverts séparément par 84 tests de route.

Les doubles Redis/Stripe de fixture ne prouvent pas une notification ni un débit fournisseur. Une commande de test initialisée prête/payée/partie ne valide pas la création, le paiement, la cuisine et le départ de bout en bout. Une caméra vidéo synthétique Chromium ne certifie ni une caméra physique ni Safari/PWA installée. La recette Classfood complète doit être identifiée comme telle et exige ses accès et données de test bornés ; l'accès L2.1 révoqué ne doit pas être réactivé implicitement.

Limites conservées de L2.2 : remboursement Stripe encore invisible localement avant réservation, révocation concurrente entre documents non transactionnelle, pas d'outbox universelle ni de synchronisation hors ligne. Un PIN vérifié est une preuve de possession du code, pas une preuve juridique de présence, d'identité physique ou de qualité de la livraison. L'historique client, l'inscription fidélité et la rétention globale des données restent leurs propres lots.
