# Crédits web et compensations de fidélité

Lot du 21 septembre 2026. Ce document décrit le code et la procédure
d’exploitation ; il ne vaut pas reçu de déploiement. Les résultats exécutés,
la révision servie et l’ouverture effective du drapeau doivent être consignés
séparément dans le compte rendu du lot.

## Comportement

Une nouvelle commande en ligne protégée conserve une intention de fidélité
immuable si elle possède déjà une attribution valide à un compte et à sa
carte. Une commande invitée, une attribution refusée et une ancienne commande
sans intention ne sont pas rattachées après coup. Le téléphone et le QR
courants ne servent jamais à choisir le bénéficiaire d’une vente passée.

Le crédit intervient après **paiement confirmé et remise confirmée** : remise
au comptoir pour le retrait, preuve de remise par le livreur pour la livraison.
Le retour du navigateur depuis Stripe et le passage à « Prête » ne suffisent
pas. Une commande web payée au comptoir utilise le reçu d’encaissement durable
de cette même commande, sans créer un second gain POS.

L’assiette `merchandise-net-v1` est le montant des produits après remise,
hors livraison. Le programme, sa version et les règles photographiées à la
commande sont vérifiés contre leur historique PostgreSQL. Un changement de
barème ultérieur ne recalcule pas le gain passé. Un gain nul laisse aussi un
reçu durable, empêchant un crédit ultérieur opportuniste.

Les remboursements **confirmés** corrigent le gain selon les seuils, tranches
et plafonds de la règle d’origine. Les corrections sont cumulatives : deux
remboursements partiels corrigent seulement le complément restant. Un statut
Stripe `pending` ou une intention incertaine ne vaut jamais remboursement
confirmé. Avant le premier crédit, un remboursement en attente suspend le
traitement. Un remboursement déjà connu au premier traitement est corrigé
dans la même transaction que le gain.

## Ventiler produits et livraison

Le formulaire de remboursement demande la part produits et la part livraison.
Les centimes doivent totaliser exactement le montant demandé et rester dans
la capacité de chaque poste, en comptant aussi les réservations en cours.

Un remboursement externe ou ancien peut ne pas avoir cette information. Le
propriétaire peut alors la renseigner dans le journal de la commande, après
réauthentification, avec un motif. Cette action ne demande pas un nouveau
remboursement à Stripe. Elle reste disponible si le fournisseur est fermé.
Son reçu est immuable et son identifiant ne peut désigner une autre action.

Si une répartition préparée devient impossible à cause d’une action concurrente,
son auteur peut l’abandonner après réauthentification. L’abandon est enregistré
avec le même UUID et le même corps avant de libérer le formulaire ; un POST
retardé retrouve ce reçu terminal et ne peut plus appliquer la répartition.
Une répartition déjà enregistrée n’est jamais transformée en abandon. Le
journal est borné à 128 décisions, abandons compris ; ce plafond est durable
et interdit de préparer d’autres décisions dans ce journal.

Seuls les cas sans ambiguïté sont déduits automatiquement : absence de frais
exclus, remboursement unique de toute la facture, ou cumul confirmé couvrant
toute la facture. Dans ce dernier cas, seul le total produits est déductible ;
aucune répartition individuelle fictive n’est créée. Aucun prorata arbitraire
ne transforme un remboursement de livraison en retrait de points.

Le protocole HTTP de remboursement passe à la version **2**. Un ancien
onglet doit être actualisé avant une mutation. Une ancienne intention durable
sans ventilation conserve toutefois son corps et son UUID d’origine : elle
n’est pas transformée en nouvelle demande lors de la reprise.

## Exploitation dans le back-office

Le parcours **Fidélité → Ventes web** affiche les gains, les corrections, les
points conservés à titre commercial et les dossiers à traiter. Les lectures
ne déclenchent aucune écriture financière. Elles sont limitées au restaurant
courant, à la capacité fidélité et aux rôles propriétaire/gérant.

Si le solde a été dépensé entre le gain et le remboursement, le système ne
crée ni dette, ni débit partiel implicite. Il conserve un dossier
`insufficient_balance`. Un gain ultérieur qui recharge la carte ne permet pas
au worker de prélever silencieusement ce montant. Le propriétaire décide,
avec réauthentification et motif :

- **Réessayer la correction** : débiter le complément si le solde le permet ;
  sinon conserver le dossier et le reçu de cette tentative.
- **Conserver les points à titre commercial** : renoncer uniquement au
  complément du dossier lu. Un nouveau remboursement exige une nouvelle
  correction ou une nouvelle décision.

Le navigateur conserve l’intention avant l’envoi, sans mot de passe, sous
verrou et avec contrôle de l’identité courante. Après rechargement ou réponse
perdue, il recherche le reçu exact avant d’autoriser une autre décision.
La version du dossier protège contre une décision prise sur des montants
devenus périmés.

Les dossiers de preuve incohérente demandent une investigation ; ils ne
proposent pas une validation manuelle aveugle. Les preuves privées, les
identifiants de compte, les numéros de téléphone et les secrets de remise ne
sont pas exposés dans le panneau.

## Persistance et concurrence

La commande MongoDB conserve l’intention, les preuves d’encaissement/remise
et son journal de remboursement. PostgreSQL est la source de vérité du
portefeuille, du reçu de gain et des corrections. Il n’existe pas de
transaction distribuée entre les deux bases.

Une vente canonique est identifiée par restaurant et `clientId`, quel que
soit son alias web/POS. La migration `0007_historical_sale_settlement` ajoute
les ventes, observations et corrections. Elle impose RLS, clés étrangères
tenant, invariants cumulatifs, immutabilité et exclusion des anciens writers
sur une vente déjà prise en charge. Les écritures existantes ne sont ni
effacées ni réaffectées.

Le gain, le reçu, le portefeuille, le registre et une éventuelle correction
initiale sont atomiques dans PostgreSQL. Les corrections portent un reçu
distinct relié à l’observation financière. Elles utilisent `adjust_debit`
pour conserver le contrat public existant ; ce n’est pas une annulation
intégrale fictive de l’écriture d’origine. Les métriques retirent les
corrections du gain attribué à la vente.

Le worker réclame une intention par bail MongoDB avec écriture majoritaire.
Il lit d’abord le reçu SQL avant toute reprise. L’accusé Mongo est conditionné
au bail, à l’intention et aux versions de commande/remboursement observées.
Une réponse SQL perdue ne permet donc pas de créer un second gain.

Les écritures de remboursement réveillent durablement la commande dans le
même CAS Mongo. Le traitement priorise ces intentions, avec lots de 25 et
backoff borné en cas de dépendance indisponible. Un scan de secours lit au
plus 50 commandes terminées ou à rapprocher par minute, seulement quand le
lot prioritaire n’est pas plein. Il détecte un ancien writer ignorant le
réveil et répare un accusé perdu après une décision SQL. Le délai de ce
rattrapage dépend du volume historique et de la charge : aucun délai fixe
n’est garanti par ce scan.

Les attentes ordinaires sont espacées progressivement de 30 secondes à
15 minutes. Une commande annulée avant tout gain est mise en sommeil,
sans faux reçu de gain nul ni réécriture périodique. Le scan la réveille
si ses versions métier changent. Un dossier de rapprochement reste relu
pour retrouver une décision SQL dont l’accusé Mongo aurait été perdu.

Une preuve financière dépassant 64 KiB reste à rapprocher. Elle n’est pas
tronquée pour faire passer une correction dont la preuve manquerait.

## Activation et retour arrière

`LOYALTY_WEB_SETTLEMENT_ENABLED` est fermé par défaut ; seule la chaîne
`true` autorise le traitement et les nouvelles décisions financières. La
capture de nouvelles intentions et les lectures restent possibles lorsque
ce drapeau est fermé. Les reçus d’une décision déjà commise restent lisibles.

Ordre de livraison :

1. Exécuter les tests de bases réelles et la vérification du monorepo sur la
   révision candidate ; conserver les sorties et les tests ignorés.
2. Livrer la migration additive via le pipeline existant. Vérifier le
   bootstrap, les empreintes des migrations et les droits du rôle limité.
3. Livrer API/web/POS/KDS compatibles, vérifier les index MongoDB, puis
   attendre le retrait de toutes les anciennes instances API. Une ancienne
   version ne doit pas ignorer la réservation canonique d’une vente.
4. Vérifier la révision effectivement servie et le smoke staging. Activer
   le drapeau uniquement sur staging après ces contrôles.
5. Recetter une nouvelle vente de test, son absence de gain avant remise,
   son crédit, sa correction partielle puis totale et les reçus de reprise.
   Séparer fixtures locales, parcours staging et effets fournisseur réels.

Pour suspendre : fermer le drapeau, conserver les intentions et tous les
reçus, laisser finir les transactions déjà parties, puis inspecter les
dossiers. Fermer un drapeau ne peut pas annuler rétroactivement un commit.
Ne pas supprimer les tables, réécrire les soldes ou revenir à un binaire qui
ne connaît pas ce journal. Réouvrir reprend les mêmes identités.

La production reste sous décision de l’utilisateur ; ce lot n’y crée aucun
restaurant ni aucune opération de recette.

## Périmètre vérifiable

Ce writer traite les **nouvelles ventes web attribuées** et leurs
remboursements prouvés, y compris celles encaissées au comptoir. Il ne migre
pas les anciens gains POS vers cette nouvelle politique. Le vérificateur
POS refuse désormais un nouveau gain lorsqu’un remboursement confirmé ou
incertain existe déjà ; un reçu historique exact reste rejouable.

Un remboursement en espèces sans journal durable ne peut pas être déduit
d’un commentaire ou d’un changement de statut. Il n’est pas présenté comme
automatiquement compensé par ce lot. De même, ce lot ne rend pas disponibles
les récompenses web comme moyen de paiement et ne change pas les règles
d’adhésion, de rattachement de carte ou d’accès au compte.

Les règles et contrats partagés restent dans `@sm/domain`, `@sm/contracts`
et `@sm/client-core`. L’adaptateur web fournit stockage/verrou/HTTP ; une
future application Expo pourra réutiliser les mêmes intentions et contrats
avec ses propres adaptateurs.
