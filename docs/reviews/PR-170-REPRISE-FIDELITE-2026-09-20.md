# Reprise fidélité — revue ciblée au 20 septembre 2026

## Périmètre et valeur des preuves

Relecture du code présent sur `origin/develop` à la base `56699753`, dans le
cadre de la reprise des fonctionnalités introduites autour de la PR #170 et
complétées depuis. **Ce rapport n'est pas une revue complète de la PR #170.**
Le périmètre est le journal de remboursement livré par la PR #173, ses reprises,
et les conditions nécessaires au crédit fidélité web et aux compensations.
Il ne certifie pas les autres fonctionnalités Commande, Livreur ou back-office.

Les constats de code ci-dessous proviennent d'une lecture locale du 20 septembre.
Les suites citées ont été inspectées, **pas réexécutées pour ce rapport**. Aucun
appel Stripe, SMS, remboursement, crédit ou mutation distante n'a été effectué
par cet audit. Les correctifs de reprise en cours après cette base devront avoir
leur propre reçu de validation ; ils ne sont pas considérés acquis ici.

Observations staging du 20 septembre transmises par les autres intervenants :

- « Mon compte » a réellement été ouvert dans le navigateur, avec un profil
  existant portant un téléphone vérifié ; aucune donnée de ce profil n'est
  reproduite ici.
- Le runtime compte est en mode `production_paid` et l'accès a été constaté
  valide. Ce nom de mode ne signifie pas que la cible était la production :
  l'observation concerne le staging.
- `ORDER_REFUNDS_DURABLE_ENABLED` est absent et donc fermé. Le remboursement
  durable n'est pas activé sur cette cible à la date de cette observation.

Ces observations établissent un accès réel au compte, pas un crédit sur vente,
une compensation, ni une nouvelle recette complète d'inscription/passkey.

## Journal financier déjà livré : protections à conserver

Dans `apps/api/src/modules/ordering/order-refunds.service.ts` :

- Le CAS Mongo réserve l'intention et les centimes **avant** l'appel fournisseur,
  sous `__v`, `refundSyncVersion`, tenant et paiement d'origine. Une réponse
  d'écriture perdue exige une relecture exacte du commit majority ; l'incertitude
  n'autorise pas un nouvel envoi (lignes 79–97 et 229–254).
- Une reprise conserve UUID, auteur, montant, motif, compte Connect, mode et clé
  d'idempotence. Une intention sans preuve bloque une nouvelle intention. Après
  la fenêtre d'une heure, seule l'observation peut rapprocher l'opération ; la
  création n'est plus retentée (lignes 171–174 et 219–247).
- Les listes fournisseur sont réconciliées sous CAS. Les anciens IDs observés
  ne disparaissent pas simplement d'une liste tardive ; une liste vide ne libère
  pas une réserve incertaine. Les partiels confirmés/en attente sont cumulés par
  la politique `order-refund-flow.policy.ts`.
- Le reçu financier précède l'audit idempotent. Un échec de l'audit n'annule pas
  le reçu et peut être réparé par une reprise ou un webhook (lignes 136–158 et
  263–277). Redis ne constitue pas le journal.
- Le webhook sans PaymentIntent relit la charge avec la signature SDK à trois
  arguments et le compte connecté original ; sa recherche Mongo garde ce même
  compte, y compris le cas historique plateforme (lignes 284–296).

Couvertures présentes : `order-refunds.integration.test.ts` exerce notamment
les pertes de réponses Mongo/fournisseur, deux connexions concurrentes, la liste
tardive/vide, l'audit perdu et la fenêtre expirée. `order-refund-sdk.test.ts`
utilise le vrai SDK Stripe avec un serveur HTTP local pour Connect, le compte
plateforme et l'échec de lecture sans repli non cloisonné. Ce sont des preuves
locales présentes dans le dépôt, pas une preuve de remboursement bancaire réel.

## Priorité avant d'ouvrir les remboursements : reprise professionnelle

### 1. L'identité de l'intention se perd à la fermeture ou au rechargement

`apps/web/src/app/admin/orders/RefundModal.tsx:22` conserve l'UUID uniquement
dans un état React. Les lignes 41–49 traitent dans le même `try/catch` le POST
de remboursement et la relecture de la commande. Si le POST réussit puis le GET
échoue, l'écran présente une erreur et ne met pas son résumé à jour. Une reprise
dans la même modale garde l'UUID ; une réouverture le perd.

Une seconde demande partielle avec un nouvel UUID peut alors être valide dès
que le premier remboursement a sa preuve et qu'un solde reste disponible. Le
journal serveur protège une intention rejouée, pas deux intentions distinctes
créées par une UX ambiguë. Il ne faut donc pas affirmer une reprise durable de
bout en bout avec cette seule interface.

**Correction attendue :** rattacher la reprise au journal serveur et conserver
au minimum sa référence dans un journal navigateur cloisonné par tenant,
acteur et commande. Aucun mot de passe ne doit être persisté. Après ACK du POST,
enregistrer immédiatement le résultat connu ; présenter une panne de
rafraîchissement de commande séparément. Pas de nouvelle UUID ni de nouvel envoi
automatique pour sortir d'un état incertain.

### 2. Il manque une lecture locale du journal, indépendante de Stripe

`packages/contracts/src/order-refunds.ts:15` ne projette que les totaux et une
liste réduite de remboursements. Il n'expose ni intention préparée, ni opération
incertaine, ni état de rapprochement, ni possibilité de reprise par l'auteur.

Le GET existant n'est pas une lecture passive : `summary()` appelle `reconcile()`
qui incrémente les versions puis relit Stripe et répare l'audit
(`order-refunds.service.ts:148–168`). Le POST relit également Stripe avant de
retourner un reçu déjà enregistré (lignes 213–238). Une panne fournisseur peut
donc masquer dans ces réponses un résultat pourtant connu durablement.

**Correction attendue :** lecture serveur strictement locale, autorisée et
réduite aux intentions/résultats nécessaires à l'opérateur, sans secret ni effet
fournisseur. Séparer observation et reprise explicite. Préserver les mêmes
gardes tenant/auteur/corps et l'interdiction de libérer une réserve sans preuve.
L'absence de journal local navigateur ne doit pas faire disparaître une
intention serveur ni débloquer silencieusement une nouvelle demande.

Recette minimale du lot : fermeture/reload après départ, réponse POST perdue,
POST acquis puis GET commande en panne, deux onglets, autre acteur/tenant,
fournisseur indisponible avec reçu local connu, fenêtre expirée et intention
sans preuve. Vérifier le nombre d'effets fournisseur et le montant réservé,
pas seulement le texte de la modale.

## Crédit web et compensations : conditions encore absentes

### Attribution et unicité sont désormais présentes, le crédit web ne l'est pas

Le document `GAINS-VENTE-REMBOURSEMENTS.md` décrit un état du 10 septembre.
Deux prérequis ont depuis été livrés :

- `orders/customer-sale-attribution.ts` et `orders.service.ts:330` conservent
  l'attribution serveur de la nouvelle vente protégée, sa règle historique et
  son assiette `merchandise-net-v1`, distincte du total avec livraison.
- `packages/loyalty/drizzle/0006_canonical_sale_uniqueness.sql:12` ajoute l'unicité
  tenant + UUID de vente aux reçus et gains, malgré les alias de référence et
  les sources POS/web. `canonical-sale.integration.test.ts` couvre notamment
  alias concurrents et reçu de zéro unité. Ne pas reconstruire cette garantie
  ni l'affaiblir au profit d'une seule unicité par source.

Le writer actuel `loyalty-member.service.ts:1742` vérifie la vente Mongo seulement
pour `source=pos` ; l'autre branche prend `dto.purchaseCents`, puis charge le
programme courant à la ligne 1752. La branche interne `source=online` n'a pas de
producteur de crédit web retrouvé dans ce périmètre. Elle ne doit pas être
ouverte telle quelle : le futur writer doit utiliser l'attribution historique
persistée, une preuve financière serveur et l'identité canonique de la vente.
Le passage web → paiement au comptoir doit reprendre cette même vente et son
intention, sans réattribuer la carte ou changer de règle en cours de reprise.

### Les gains ne sont pas encore corrigés sur les remboursements partiels

Un remboursement partiel laisse le paiement à `paid`
(`order-refunds.service.ts:119`). Le vérificateur POS ne lit que le statut payé
et le total, sans montants remboursés/en attente ni version financière
(`loyalty-purchase-verifier.ts:75`). Le processeur traite les gains en attente,
mais ne reprend pas les gains déjà `completed` pour les corriger
(`loyalty-order-earn.processor.ts:184` et `:255`). Il ne faut pas réutiliser ces
seuls critères comme preuve nette pour le nouveau crédit web.

Le lecteur de reçu PG et la reprise après ACK Mongo perdu existent déjà. Les
tests `loyalty-order-earn.processor.integration.test.ts` couvrent un commit PG
perdu côté accusé Mongo et le remboursement pendant cette frontière. Un reçu
absent d'un snapshot n'y devient pas une preuve d'absence de crédit. Le futur
flux doit conserver cette prudence et ajouter une tâche durable de correction
à chaque évolution financière pertinente, y compris après gain terminé.

### Le writer de compensation partielle reste à construire

`reverseLedgerEntry` retire toute l'écriture initiale une seule fois
(`loyalty-member.service.ts:2395` et `:2413`), avec unicité sur
`reversedEntryId` (`packages/loyalty/src/schema.ts:475`). Il refuse un solde
insuffisant ; il ne crée ni dette ni écrêtement silencieux.

Le calcul pur `planLoyaltyEarnReversal` existe, mais aucun appel métier API n'a
été trouvé. Il faut un journal de corrections cumulées, append-only, avec
verrou de portefeuille et reçu idempotent, repris après commit PG avant ACK
Mongo. Ne pas contourner l'unicité de la compensation totale historique pour
y faire entrer plusieurs partiels. Un solde déjà consommé doit rester en
rapprochement explicite tant qu'aucune règle de dette n'est décidée.

### Un montant Stripe global ne fournit pas l'allocation éligible

`OrderRefundRequestSchema` contient montant global, motif, UUID et mot de passe,
sans ventilation produits/livraison. Ni ce motif libre ni un remboursement
Dashboard ne prouvent la part éligible. Pour les partiels, la future correction
exige une allocation persistée et des cumuls confirmés. Les réserves en attente
ne sont pas des remboursements acquis. Les historiques sans cette preuve
restent à rapprocher ; ne pas inventer un prorata ou retrancher systématiquement
les frais de livraison de l'assiette produits.

## Ordre de livraison recommandé

1. Terminer la lecture du journal et la reprise UI, puis leur validation
   indépendante. Garder le drapeau de remboursement fermé jusque-là.
2. Appliquer le protocole d'activation staging de
   [REMBOURSEMENTS-DURABLES.md](../strategie-commerce-2026-09/REMBOURSEMENTS-DURABLES.md) :
   révision servie, anciens writers retirés/drainés, paiement de test explicite,
   intention et reçus vérifiables. Une fusion de PR ne vaut pas activation.
3. Raccorder séparément crédit historique, allocation et corrections durables.
   Éprouver deux workers, pertes d'ACK PG/Mongo, partiels cumulés avant/après
   crédit, événements dupliqués/désordonnés, solde consommé et passage web → POS.
4. Annoncer uniquement les parcours réellement reçus. L'accès au compte et la
   présence d'une carte ne prouvent pas que le gain web ou sa compensation sont
   opérationnels.

Les suites et déploiements ultérieurs devront être ajoutés avec leur date,
révision et limites, sans transformer les constats du présent audit en reçu
financier ou en certification exhaustive de la PR #170.
