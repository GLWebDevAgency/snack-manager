# Historique des commandes et espace client

Complément à l'[audit des parcours commerce](PARCOURS-COMMERCE-PRODUCTION.md), demandé le 5 septembre 2026. État du code vérifié sur la branche commerce ; les parcours cibles ci-dessous **ne sont pas encore implémentés**. Ce document ne revendique aucun déploiement.

## 1. Décision produit proposée

Un historique central des commandes sert trois usages, avec trois périmètres d'accès différents. Ni le journal local d'une caisse ni les mouvements de points ne peuvent tenir lieu de cet historique.

| Emplacement | Usage et contenu |
| --- | --- |
| **Back-office → Commandes → En cours / Historique** | Le gérant exécute le service puis retrouve une commande sur toute période autorisée : détail, paiement, remboursements, ticket, recherche et export. La file active ne dépend pas du calendrier. |
| **POS → Le service → Récentes / Rechercher** | Retrouver rapidement une commande web ou caisse, vérifier son règlement, encaisser si autorisé et réimprimer. Le journal local reste nommé séparément. Les analyses multi-périodes restent au BO. |
| **Espace client du restaurant → Mes commandes · Ma fidélité · Mon profil** | Commandes actives en premier, historique personnel, détail/suivi, puis « Recommander ». La carte et les achats sont reliés sans devenir le même secret d'accès. |

L'historique personnel fait partie de la commande en ligne ; **il ne doit pas imposer l'achat du module fidélité au restaurateur ni l'adhésion du consommateur**. Quand la fidélité est activée, elle apparaît dans le même espace. L'achat en invité reste possible. Ne pas ajouter un quatrième compte visible pour la livraison : c'est un mode de la même commande.

Les offres conservent leur périmètre : commande en ligne seule donne accès aux commandes en ligne du restaurant, pas aux ventes caisse hors contrat. Une consultation ne donne pas automatiquement le droit d'annuler, rembourser ou exporter des données nominatives.

## 2. Ce qui existe réellement

### Restaurateur

- `/admin/orders` charge depuis minuit **du navigateur**, au plus 200 commandes. Recherche et filtres sont locaux. « Charger plus » révèle 50 lignes supplémentaires déjà chargées, pas une page serveur suivante. Le composant signale la troncature, mais ne permet pas de consulter la suite.
- `GET /orders` accepte statut et borne `since`, calcule le total et signale `truncated`. Pas de borne supérieure, recherche serveur ou curseur ; le tri sur `createdAt` seul n'est pas stable en cas d'égalité.
- Une commande ancienne dont l'identifiant est connu reste consultable : le défaut constaté est un accès historique incomplet, **pas une disparition démontrée des données**.
- `/admin/stats` propose aujourd'hui, 7 jours et 30 jours ainsi qu'un CSV. L'API CSV accepte `from/to` en jours Paris, mais l'interface n'a pas de période personnalisée. L'export coupe silencieusement à 20 000 lignes et la validation ne vérifie pas encore la réalité calendaire ni l'ordre des dates.
- Le POS dispose d'une file active serveur et d'un journal de ventes **local au poste et réinitialisable**. Ce journal ne constitue pas l'historique des commandes web et des autres caisses.

Preuves : [`orders/page.tsx`](../../apps/web/src/app/admin/orders/page.tsx), [`orders.service.ts`](../../apps/api/src/modules/orders/orders.service.ts), [`stats/page.tsx`](../../apps/web/src/app/admin/stats/page.tsx), [`stats.service.ts`](../../apps/api/src/modules/stats/stats.service.ts), [`stats.ts`](../../packages/contracts/src/stats.ts), [`modals.tsx`](../../apps/pos/src/modals.tsx), [`commerce.ts`](../../packages/contracts/src/commerce.ts).

### Client du restaurant

- `User` représente les utilisateurs professionnels. Le membre fidélité PostgreSQL est une identité distincte, propre au restaurant ; le téléphone facultatif saisi à l'inscription ne constitue pas une preuve de possession.
- `Order.clientId` est une **clé d'idempotence de création**, pas un identifiant de consommateur. Ne pas détourner ce champ pour regrouper des achats.
- Le lien membre fidélité/commande existe pour le POS, pas dans la création publique de commande web.
- La carte expose les 20 derniers mouvements de points ; pas l'historique des achats. Aucune page/API d'historique personnel ni action « Recommander » n'a été trouvée dans ce périmètre.
- Le suivi invité donne accès à **une commande** via un jeton aléatoire. Il ne prouve pas la propriété de toutes les commandes du même téléphone.

Preuves : [`schemas.ts`](../../packages/db/src/schemas.ts), [`schema.ts — fidélité`](../../packages/loyalty/src/schema.ts), [`index.ts — contrats commande`](../../packages/contracts/src/index.ts), [`loyalty-public.service.ts`](../../apps/api/src/modules/loyalty/loyalty-public.service.ts), [`tracking.ts`](../../apps/api/src/modules/orders/tracking.ts).

## 3. Historique gérant : critères concrets

- Périodes : aujourd'hui, hier, 7 jours, 30 jours, période personnalisée. Les journées sont celles du restaurant, actuellement Paris, pas celles du navigateur du responsable en déplacement. Borne finale exclusive au lendemain local ; changements d'heure et dates invalides testés.
- Filtres serveur : numéro/référence, canal d'origine, mode de consommation, état opérationnel et état financier **distincts**. Recherche client limitée aux personnes autorisées, bornée et protégée contre les recherches coûteuses.
- Pagination par curseur stable `(createdAt, _id)`, filtres figés dans le curseur ou vérifiés avec lui, taille maximale et index adaptés. Un ajout concurrent ne doit pas faire sauter ou doubler les lignes. Les totaux et la date de fraîcheur restent explicites.
- File active indépendante des dates, rattrapage après reconnexion, événement perdu et reprise d'onglet. Aucune commande non terminée ne disparaît à minuit.
- Export avec les mêmes critères et le même périmètre serveur que la liste. Un gros export doit être découpé ou généré en tâche dédiée ; à défaut, refuser explicitement plutôt que tronquer silencieusement.
- Dans une fiche : articles/options réellement vendus, frais, remise, total, paiement confirmé, remboursements exécutés/en attente, chronologie et ticket. Les actions financières demandent leurs droits propres et une confirmation adaptée.

### Attention : total vendu et argent encaissé ne sont pas interchangeables

Le calcul actuel de « CA » additionne `totals.total` des commandes prêtes/remises. Il ne filtre pas le paiement et ne soustrait pas les remboursements. Le CSV expose statut et montant de commande, sans net encaissé ni montants remboursés/en attente. **Ne pas réutiliser ces chiffres comme registre des règlements.**

Le futur historique doit nommer séparément valeur des commandes, paiements confirmés, remboursements et solde financier. Les encaissements/retours appartiennent à la date de leurs événements financiers, pas forcément à la date de création de la commande. Un remboursement partiel ne doit pas réécrire le prix historique des articles. Le rapprochement bancaire et la facturation Snack Manager restent des sujets distincts.

Preuves : `StatsService.revenueMatch`, `sumWindow` et `exportOrdersCsv` dans [`stats.service.ts`](../../apps/api/src/modules/stats/stats.service.ts).

## 4. Identité client : réutiliser la fidélité sans élargir son QR

### Précision du fondateur et revue du 7 septembre

**Un seul parcours visible « Mon compte »**, relié à « Mes commandes », « Ma fidélité » et « Mon profil ». Si le programme du restaurant est actif et que le client y adhère, la création du compte et de la carte se fait dans le même parcours, sans deuxième formulaire ni visite obligatoire en caisse. Le QR reste une carte de présentation, pas le secret donnant accès au compte. La commande invitée et l'historique personnel hors module fidélité restent possibles.

Le bouton « Obtenir ma carte » ne doit plus envoyer un nouvel utilisateur directement au scanner. Cible : « Créer mon compte et ma carte » avec numéro vérifié et prénom ; « Me connecter » pour le membre existant ; rattachement d'une carte de caisse comme action secondaire explicite. La déconnexion clôt la session et retire les coordonnées locales ; elle ne supprime ni la carte ni les justificatifs de vente. Prévoir aussi révocation des autres sessions et récupération sûre.

**Constats toujours ouverts** : aucune inscription consommateur publique ni session OTP trouvée ; le cookie actuel conserve une carte de caisse et la suppression locale ne révoque pas les autres appareils. Le préremplissage vient de `sm.customer`, pas d'un profil fidélité authentifié. Le journal C01 conserve la tentative active et le dernier reçu, pas toutes les commandes simultanées. Aucune API d'historique personnel ou de réachat, ni crédit automatique web de fidélité, ne doit être déduit des écrans déjà présents.

Twilio Verify est choisi, **essai gratuit fermé uniquement** : vérifier la liste des destinataires, les quotas et l'échéance avant un envoi. Aucun achat, activation publique ou budget SMS récurrent autorisé. Le futur flux exige plafonds globaux/restaurant/téléphone/IP, délai de renvoi, nombre d'essais borné, réponses sans révéler l'existence d'un compte et arrêt en cas d'incertitude sur le budget. La vérification du téléphone ne doit pas rattacher automatiquement les anciens achats ou cartes créés avec un téléphone non vérifié : possession de carte et rattachement contrôlé restent distincts.

**Plusieurs commandes en cours** : remplacer le raccourci unique vers « la dernière commande » par « Mes commandes » et un nombre de commandes actives. Chaque commande conserve son numéro, mode, créneau, statut opérationnel et financier, et son propre accès au suivi. Une deuxième commande ne remplace pas le premier suivi ; minuit, rafraîchissement et reconnexion ne retirent aucune commande non terminée. Les historiques sont paginés et protégés par propriétaire serveur, jamais regroupés par téléphone déclaré. Le réachat prépare un panier aux conditions actuelles, sans débiter ou recréer immédiatement la vente.

Ce cadrage complète L3a/L3b après le lot de fiabilité C15 et la livraison opérationnelle L2 ; il ne revendique aucun écran ou parcours livré par cette note.

### Frontière d'identité

Créer un contexte **client final** distinct des comptes du personnel. Une session authentifiée, bornée et révocable, identifie le consommateur pour un restaurant. Un accès sans mot de passe par contact vérifié est une option adaptée ; choisir et tester le canal de récupération, les quotas et la délivrabilité avant activation. Ne pas ajouter un compte global inter-restaurants ni un partage implicite des données.

Le compte est lié explicitement au membre fidélité quand le programme est actif. Une nouvelle inscription peut créer les deux dans un parcours cohérent ; pour une carte existante, utiliser une preuve de rattachement dédiée à usage unique et traiter les conflits. **Un QR montré à une caisse, un téléphone saisi, ou le lien d'une commande partagé avec un tiers ne doivent jamais donner accès à tout l'historique.**

La commande reçoit une référence privée de propriétaire, établie par le serveur depuis la session au moment de sa création. Le formulaire public ne choisit ni `customerRef`, ni tenant arbitraire. L'identité de propriétaire et l'instantané de commande sont écrits ensemble ; le KDS et les événements publics ne reçoivent pas cette référence privée.

### Invité, récupération et domaines

Une session invitée peut préserver la tentative et les commandes de cet appareil, sans conserver le secret bancaire. Le rattachement ultérieur au compte nécessite la preuve de possession de cette session ou une preuve de commande dédiée, une mise à jour conditionnelle et une opération idempotente. Pour un appareil partagé, prévoir déconnexion/effacement local et ne pas afficher automatiquement les détails sensibles à l'utilisateur suivant.

Les anciens achats sans preuve de rattachement ne sont pas récupérables automatiquement sur simple correspondance de téléphone. Prévoir une assistance contrôlée ; ne pas promettre une migration magique de tout l'historique.

Sur domaine personnalisé, les nouvelles routes doivent entrer explicitement dans la liste blanche du proxy. Le cookie fidélité actuel est limité au chemin `/fidelite` ; ne pas élargir le secret QR à tout le site pour gagner du temps. Une nouvelle session client sécure est nécessaire. Domaine plateforme et domaine restaurant ne partagent pas spontanément leurs cookies : tout transfert de session éventuel exige une preuve courte, à usage unique, liée à la destination vérifiée.

Preuves : [`proxy.ts`](../../apps/web/src/proxy.ts), [`session-cookie.ts`](../../apps/web/src/app/r/[slug]/fidelite/card-session/session-cookie.ts), [`loyalty-member.service.ts`](../../apps/api/src/modules/loyalty/loyalty-member.service.ts).

### API et stockage

- Historique filtré **tenant + propriétaire de session** ; aucune liste par téléphone ou identifiant libre. Pagination indexée et projection minimale ; autorisation répétée sur le détail et sur « Recommander ».
- Cookies `HttpOnly`, protections d'origine/CSRF, rotation/révocation et limitation des essais. Les tokens et identités privées ne sont pas publiés dans les journaux ni dans les exports opérationnels ordinaires.
- Réponses privées `no-store`, exclusion des caches du service worker et contrôle lors de chaque lecture. L'installation PWA n'autorise pas à garder indéfiniment les achats nominatifs hors ligne.
- Séparer préférence de fidélité, notifications transactionnelles et consentement marketing. Documenter récupération, fermeture de compte, conservation des justificatifs et traitement des données avant mise en service ; ne pas supprimer aveuglément les pièces métier en supprimant une session.

### Préremplissage demandé depuis la carte installée

La session actuelle n'est pas une session personnelle complète : elle conserve le **QR de caisse**. Sa projection contient `alias` et `balanceUnits`, aucun téléphone, même masqué. Le profil serveur contient un prénom et un téléphone facultatifs, pas un nom de famille distinct. L'alias peut être « Carte abcdefgh » ou « Client · 1234 » : **ne pas l'injecter dans le champ nom**.

Le checkout réutilise actuellement seulement les coordonnées saisies précédemment sur le navigateur (`sm.customer`, clé globale à l'origine, sans durée). Ce n'est pas un rattachement fidélité ; cette mémoire doit aussi être cloisonnée par restaurant, bornée et effaçable, sans être présentée comme une identité vérifiée.

Pour le parcours demandé :

1. Le client active une session personnelle par une preuve supplémentaire, distincte du QR présenté en caisse. Le téléphone existant peut servir de canal vérifié ; une carte sans téléphone reste utilisable et demande les coordonnées une première fois. Aucun prestataire SMS ni nouvel envoi n'est activé par cet audit.
2. À l'ouverture du checkout, lecture protégée du profil utile, sans dépendre du cache local du solde. Remplir uniquement les champs vierges et ne jamais écraser une saisie commencée par une réponse tardive.
3. Afficher des coordonnées vérifiables/modifiables et le bouton de passage au créneau. Si elles sont incomplètes ou si la session expire, expliquer ce qui manque et garder le parcours invité accessible. Commander pour quelqu'un d'autre ne modifie pas silencieusement le profil permanent.
4. Livraison : proposer/adresser la destination, vérifier la zone et les frais à chaque changement ; ne pas confondre le téléphone du compte avec une preuve que l'adresse est livrable.
5. Aucune coordonnée ni preuve privée dans le lien « Commander », le service worker ou les événements cuisine. L'installation PWA ne garantit pas à elle seule le partage de session après ouverture dans un navigateur ou un autre domaine : recette sur les appareils cibles obligatoire.

Une route de profil autorisée seulement par l'ancien cookie QR serait insuffisante : les protections d'origine et de transport ne démontrent pas que le détenteur du QR est propriétaire du téléphone. Cette frontière d'accès doit être livrée avec le préremplissage, pas repoussée après son activation.

## 5. « Recommander » ne doit pas copier une vente à l'identique

Le bouton prépare un **nouveau panier**, sans création de commande ni débit. Le serveur autorise la lecture de la vente source puis compare ses références avec le catalogue actuel.

| Écart constaté | Comportement attendu |
| --- | --- |
| Produit supprimé/inactif ou en rupture | Ligne signalée indisponible, jamais remplacée silencieusement |
| Variante ou option disparue, nouvelle option obligatoire | Choix à refaire avant validation |
| Retrait d'ingrédient qui ne peut plus être garanti | Avertissement explicite et confirmation ; aucune réintroduction silencieuse |
| Prix différent | Nouveau prix clairement présenté ; ancien prix conservé seulement comme historique |
| Promotion/récompense, frais, créneau ou adresse ancienne | Nouvelle validation des conditions actuelles, pas de copie des avantages ou de réservation passée |
| Panier déjà rempli | Proposer ajouter ou remplacer ; ne pas écraser les choix du client sans accord |

La fonction actuelle `draftFromLine` peut substituer la première variante disponible et retirer silencieusement des exclusions d'ingrédients devenues inconnues. **Ne pas la réutiliser telle quelle pour ce parcours.** Une projection explicite des différences et une validation sont nécessaires. Réutiliser en revanche la tarification serveur actuelle, qui recalcule depuis le menu.

La dernière validation applique de nouveau disponibilités, prix, droits, créneau et limites. La nouvelle commande a une nouvelle clé d'idempotence ; ses propres réessais la conservent. Aucun ancien paiement ou avantage consommé n'est rejoué.

Preuves : [`cart.ts`](../../apps/web/src/components/order/cart.ts), [`price-order-lines.ts`](../../apps/api/src/modules/orders/price-order-lines.ts), [`ticket.service.ts`](../../apps/api/src/modules/ordering/ticket.service.ts). Le ticket public contient des libellés lisibles, pas toutes les références nécessaires : prévoir une projection autorisée dédiée plutôt que scraper le ticket.

## 6. Lots de réalisation et réception

1. **Exploitation gérant** : file active fiable, historique paginé et dates, recherche POS, export exact. Séparer les indicateurs financiers.
2. **Identité et reprise client** : tentative persistante, session invitée/compte, récupération et propriétaire de commande ; liaison fidélité sûre et domaines personnalisés.
3. **Mes commandes** : historique/détails protégés, commande active visible et accès au suivi ; aucun accès aux commandes d'un autre client.
4. **Recommander** : comparaison au menu actuel, différences confirmées, panier préservé et nouvelle commande normale.
5. **Boucle fidélité** : crédit sur fait confirmé, récompense réservée/consommée sur commande, compensation des remboursements. La consultation du solde ne suffit pas.

Recette obligatoire : deux clients du même restaurant, même contact dans deux restaurants, QR partagé, token d'une seule commande, session révoquée, double rattachement concurrent, appareil partagé, passage de minuit et d'heure été/hiver, plus de 200 commandes, plus de 20 000 lignes d'export, prix/options/recette modifiés, rupture entre prévisualisation et validation, remboursement partiel et réponse perdue après création.

Tests existants relancés pendant cette revue : 92 ciblés BO/POS/API historique et 21 suivi/projection fidélité, verts. Ils confirment les comportements actuels ; ils ne couvrent pas les fonctionnalités proposées. Critères transversaux, priorité dans le chantier et conditions staging : [audit principal](PARCOURS-COMMERCE-PRODUCTION.md).
