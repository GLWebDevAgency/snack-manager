# Compensation cumulative des gains POS — 21 septembre 2026

Le traitement reprend exclusivement un gain POS **déjà achevé**. Il ne crée ni compte client, ni adhésion, ni nouveau crédit. La carte autonome conserve son membre et son portefeuille. L'origine privée `pos_receipt` distingue cette adoption d'une attribution web dans `loyalty.sale_settlements`.

## Preuve et assiette

Le reçu PostgreSQL, son opération achevée et son éventuel ledger doivent correspondre au ticket canonique tenant/client. L'empreinte HMAC du corps original vérifie le membre, l'UUID, la référence, le canal POS et le montant encaissé. La règle est celle du gain initial, jamais le programme courant.

L'assiette `legacy-pos-total-v1` reprend **le total historique du ticket**, livraison incluse le cas échéant : c'est le montant sur lequel le writer POS a réellement attribué le gain. Les gains web conservent leur assiette produits après remise, hors livraison. Une modification du total historique ou un ancien reçu incohérent devient un dossier explicite ; elle ne permet pas de recalculer silencieusement un gain.

Les remboursements Stripe proviennent de la projection du journal/receipts existants. Les remboursements physiques proviennent du nouveau journal comptoir et de son attestation responsable. Un simple compteur Mongo ne prouve aucun remboursement. Aucun appel fournisseur n'est effectué par ce traitement.

## Atomicité et reprises

L'adoption et les corrections utilisent le verrou canonique tenant/client puis les mêmes reçus cumulatifs PostgreSQL que le web. Un débit ajuste le solde et les gains nets dans la transaction du reçu de correction. Le gain original reste intact. Les reprises lisent d'abord le reçu exact ; le worker acquitte Mongo seulement sous la même identité, lease et versions financières.

Le solde disponible est `balance_units - reserved_units`. Aucun débit partiel, dette ou consommation des unités réservées n'est permis. L'insuffisance exige une décision propriétaire durable : réessayer ou conserver les seuls points exigibles à cette version. Un nouveau remboursement crée une nouvelle obligation. Les décisions et leur reçu exact sont accessibles dans « Ventes fidélité » ; les lectures restent sans effet.

Un gain déjà reversé par l'ancien outil manuel n'est pas adopté : il reste à rapprocher, sans nouveau débit. Une fois le gain adopté, son reverse générique est interdit. La migration 0009 est additive, conserve les anciennes ventes web et protège l'origine et les liens du reçu.

## Activation et limites

`LOYALTY_POS_COMPENSATION_ENABLED=false` par défaut. Déployer les migrations et le nouveau code, retirer les anciens writers, puis ouvrir uniquement après recette autorisée. Un flag fermé n'efface aucun dossier ni reçu. Le fallback local parcourt au plus 50 anciennes ventes par minute, avec curseur, pour réveiller un remboursement enregistré par un ancien writer ; il ne réexécute pas les corrections d'une vente inchangée.

Le programme peut être en pause après l'acquisition du gain. Un membre actuellement inactif conserve une attente explicite. Un historique manquant ou un reverse ancien nécessite un rapprochement : cette version ne fabrique pas une correction historique pour le faire disparaître. Les tests locaux n'attestent ni remise d'espèces ni remboursement terminal physique.
