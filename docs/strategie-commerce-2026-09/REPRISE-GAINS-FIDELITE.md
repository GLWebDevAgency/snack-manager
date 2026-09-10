# Reprise d'un gain fidélité après réponse perdue

État au 10 septembre 2026 : correctif préparé sur
`fix/loyalty-earn-recovery-receipt`, après l'unicité canonique #163.
La réception CI et staging reste à effectuer pour ce lot. Aucun crédit web,
SMS, remboursement fournisseur ni débit automatique n'est activé.

## Incident corrigé

Le worker POS pouvait engager le gain PostgreSQL, perdre sa réponse avant
l'acquittement Mongo, puis rencontrer une vente remboursée. L'ancien traitement
classait alors l'intention « annulée », sans rechercher le gain déjà engagé.
Un acquittement ne vérifiait pas non plus le paiement courant ni le nombre de
documents réellement modifiés.

Le nouveau lecteur observe reçu, opération achevée et écriture du registre dans
un seul instantané SQL, sous isolation du restaurant. Il reconnaît les aliases
canoniques d'une vente, les UUID en casse différente et les reçus de gain zéro.
Une divergence d'opération, membre, source, registre ou version reste fermée.
Aucune donnée de profil, solde courant ou règle actuelle n'est nécessaire.
Ce lecteur observe un gain engagé : il ne recalcule pas son assiette financière.

## Décisions du worker

| Vente / preuve observée | Décision |
| --- | --- |
| Remise et payée, reçu cohérent | Acquitter seulement, sans nouveau calcul ni gain |
| Remise et payée, aucun reçu observé | Tenter le writer POS existant et ses contrôles |
| Annulée ou remboursée, reçu cohérent | `reconciliation_required`, code `recorded_gain_sale_ineligible` |
| Annulée ou remboursée, reçu non observé | Rester réessayable, code `sale_ineligible_unsettled` |
| Preuve divergente | `reconciliation_required`, code `earn_receipt_conflict` |
| Refus permanent du writer après intention valide | `reconciliation_required`, code `earn_confirmation_rejected` |

« Non observé » ne signifie jamais « aucun gain définitif » : une autre
transaction PostgreSQL peut encore engager son écriture. Le retry reste borné
entre cinq secondes et quinze minutes, sans nombre maximal prétendant trancher
ce doute. L'acquittement vérifie à nouveau `delivered + paid` et le bail exact
(restaurant, commande, opération, date et tentative). Un ancien worker ne peut
pas acquitter le bail de son successeur. Zéro document modifié n'est pas un succès.

## Exploitation et limites

L'état de rapprochement est privé, exclu des réponses publiques. Le worker ne
le reprend pas automatiquement. Ne pas forcer cet état à `completed`, annuler
un reçu ni modifier un solde : rapprocher d'abord commande, opération et registre
sous le même restaurant. Ce lot ne livre pas encore d'écran ou de commande
opérateur de résolution ; seuls des codes fermés sont journalisés.

Les intentions inéligibles sans reçu continuent à être relues : il reste à
concevoir une clôture prouvée et son suivi opérationnel, sans déduire l'absence
d'un commit d'un simple délai. Les lignes historiques déjà `cancelled` ne sont
pas réécrites. Un remboursement après un acquittement réussi et les remboursements
partiels demandent le futur rapprochement/compensation. Aucun point déjà dépensé
n'est transformé implicitement en dette.

Pas de migration SQL ni de modification historique. L'énumération Mongo accepte
un nouvel état privé. Un rollback vers l'ancien worker réintroduirait l'annulation
aveugle des intentions pending ; il faut donc suspendre ce worker avant un tel
retour, pas considérer le simple rollback du binaire comme une réparation.

## Preuves exigées

Les tests natifs utilisent PostgreSQL et Mongo jetables, pas les ventes Classfood.
Ils tiennent réellement un COMMIT PostgreSQL, perdent réellement l'acquittement
Mongo et font concourir deux workers. Ils contrôlent reçus, registre et solde
après reprise, gain positif et zéro compris. Le remboursement est une mutation
de fixture Mongo, pas un remboursement Stripe réel.

Une étape CI dédiée fournit les deux variables de bases de test et exécute ces
tests séquentiellement : une passe générale avec suites natives ignorées ne vaut
pas cette preuve. Le lecteur a été testé RED avant implémentation ; les nouvelles
régressions unitaires du worker ont également échoué avant son correctif. Le
harnais natif du worker, écrit en parallèle, n'est pas revendiqué comme RED.

Réception locale finale : **79/79** dans la passe ciblée (39 tests natifs du
lecteur, cinq du worker, 19 unités du lecteur et 16 du worker), zéro ignoré.
`pnpm verify --concurrency=2` : **54/54 tâches**, dont 42 réutilisées du cache
local. Le build API conserve bien `dist/main.js` et le lecteur compilé. Ces
preuves locales ne constituent pas encore un reçu de déploiement staging.

La suite L3b reste : preuve financière durable, writer web utilisant l'attribution
immuable de la vente, puis consommation et compensations. La recette privée
« Mon compte », OTP réel et clé d'accès sur appareil demeurent distincts.
