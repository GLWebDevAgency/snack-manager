# Rattacher une carte existante au compte client

État au 10 septembre 2026 : implémenté et recetté localement sur
`feat/customer-loyalty-attachment`, après l'adhésion neuve #157. CI et staging
de ce nouveau lot restent à recevoir. Aucun pilote, fournisseur ni budget
supplémentaire n'est ouvert. Production inchangée.

## Parcours et preuve de propriété

Depuis **Mon compte → Ma fidélité → J'ai déjà une carte**, le client scanne
volontairement sa carte ou colle son code/lien. Le nom n'est pas exigé pour
rattacher un profil déjà existant. Le lien est seulement analysé : il ne
déclenche aucune navigation. La caméra ne démarre pas automatiquement et un
scan n'envoie aucune demande de rattachement.

Les conditions courantes et une mention spécifique expliquent la conservation
du solde et le remplacement du QR. Une case initialement décochée précède
**Rattacher cette carte**. Changer le code ou les conditions remet ce
consentement à zéro. Aucune inscription marketing n'est déduite.

Le serveur exige conjointement :

- une session protégée valide et la capacité fidélité active ;
- un QR actif, non expiré, appartenant à une carte réellement remise ;
- la correspondance du téléphone vérifié du compte avec le profil fidélité
  chiffré, vérifié dans son propre domaine cryptographique ;
- les preuves historiques de création et l'absence d'autre propriétaire ;
- les conditions/version courantes et une opération idempotente explicite.

Un téléphone seul ne permet jamais l'adoption. Un QR seul ne connecte pas au
compte et ne donne pas accès à son historique de commandes. Les différents
refus de propriété renvoient le même résultat neutre, sans identité ou solde
du détenteur. Le rattachement ne réattribue aucune ancienne commande.

## Écriture atomique et compatibilité POS

Le writer utilise la transaction PostgreSQL de la session protégée et les
tables existantes. Aucun nouveau schéma ni migration : bootstrap inchangé à
96 objets. L'opération est un véritable `token_replace`, avec reçu strict de
rattachement et événement audité ; ce n'est pas une nouvelle adhésion.

Le membre est verrouillé avant le jeton, comme en caisse. Le serveur revérifie
le QR après acquisition du verrou, remplace sa génération, révoque l'ancien
jeton puis crée le nouveau jeton hashé et la liaison immuable au compte dans
la même transaction. Une collision d'unicité, y compris cachée par RLS,
annule l'ensemble avant de produire un refus public.

Le profil, le solde, les écritures de gains et les consentements antérieurs
restent inchangés. Une réponse perdue après commit se reprend avec la même
opération, sans seconde rotation. La lecture du compte retrouve aussi la
liaison sans redemander l'ancien QR. Le nouveau QR n'est affiché que sur un
geste distinct. Les rotations ultérieures en caisse restent compatibles.

Les contrôles commerciaux Mongo et SQL ne constituent pas une transaction
distribuée. Ils sont relus aux frontières existantes ; la protection du compte
est vérifiée avant commit puis avant publication. Aucun appel fournisseur ou
Redis n'est exécuté sous le verrou SQL métier.

## Limites de tentatives et confidentialité

Les nouvelles mutations ont une fenêtre glissante Redis de 60 secondes :
20 tentatives par source réseau signée, 100 globales, puis 6 par session et
12 par QR. Changer de restaurant ou d'identifiant d'opération ne remet pas le
budget de source à zéro. Ce sont des plafonds techniques, pas un quota de
comptes ou un budget SMS. Une source partagée peut être limitée en période
d'abus ; les lectures `view` et `card` n'utilisent pas ce budget de mutation.

Les compteurs emploient des empreintes/HMAC, jamais le QR brut, le téléphone
ou le secret de session. Une reprise consomme une tentative réseau, même
quand son effet métier est idempotent. Redis indisponible donne un refus
fermé et fixe ; aucune mutation n'est tentée en repli.

Code, consentement et caméra sont supprimés à l'annulation, au changement
d'identité, à la déconnexion réseau, au masquage ou au démontage de l'écran.
Un flux caméra obtenu après annulation est immédiatement arrêté. Le QR reste
en mémoire seulement : aucun stockage local, journal ou analytique ajouté.

## Preuves exécutées

- PostgreSQL natif : **49 tests writer**, dont 26 nouveaux ; concurrence
  réelle avec la caisse dans les deux ordres, attentes de verrous observées,
  reçus/générations, refus de propriété, collisions RLS et rollback.
- Passe dédiée : **217 tests SQL du socle**, puis **70 tests HTTP/writer**
  sur PostgreSQL/Mongo isolés, sans skip. L'HTTP couvre notamment perte de
  réponse après commit, rejeu, ancien QR refusé et erreur de quota.
- Redis réel : **6 tests**, deux connexions indépendantes, budgets concurrents,
  TTL natif et connexion perdue. La CI dispose d'un service éphémère dédié ;
  la fixture ne supprime que ses clés UUID, jamais une base Redis entière.
- Navigateur Chromium natif : **32 tests**, dont scan d'un vrai QR dans une
  vidéo synthétique, permission tardive, focus, masquage et formats
  320/390/1440. Captures inspectées avec l'identité visuelle existante.
- Contrôleur **25** et BFF **31** tests ; web complet **2528/2528** ; contrats
  complets **574/574** ; API générale **3388 succès / 675 skips** sans variables
  des bases dédiées. Ces populations se recouvrent et ne s'additionnent pas.
- Vérification globale : **51/51 tâches**, dont 28 réutilisées du cache local ;
  mêmes tests/délais, paquets séquencés. Module API CommonJS compilé chargé.

La revue indépendante serveur et navigateur n'a relevé aucun blocage. Le
rebasage sur le squash #157 conserve exactement le code local vérifié ; seule
sa documentation historique supplémentaire diffère de la base préparatoire.
Les tests navigateur utilisent un upstream isolé : ils ne remplacent ni la
recette privée staging ni une caméra de téléphone réel. Aucun SMS ou paiement
réel n'a été émis.

Restent ensuite les gains web, la consommation liée à une vraie vente et ses
compensations. Un retour arrière applicatif doit conserver les opérations,
rotations et liaisons déjà commitées ; ne pas réactiver un ancien QR ni
supprimer une association pour simuler l'annulation du rattachement.
