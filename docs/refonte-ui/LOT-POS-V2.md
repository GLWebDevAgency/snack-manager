# POS — fidélité visuelle et service à table

Branche `refactor/ui-handoff-fidelity`, reprise sur `develop` `80f2eac` (PR 178), après le premier gel sur `a01f857`. Applications Expo/React Native existantes, sans changement de versions. Comparaison avec `references/RestoPilot-POS.png` et les captures `pos-sale`, `pos-config`, `pos-settings` du kit. Le service comptoir historique reste accessible séparément de la salle.

## Présentation et préférences

Les cartes produit disposent d'une densité confortable (trois colonnes sur le desktop de référence) ou compacte. Le nombre de colonnes dépend toujours de la largeur effectivement disponible. Photos réelles, cadrages, catégories, produits, prix et configurateur restent les mêmes. La hiérarchie est allégée, les photos agrandies et les sélecteurs distinguent la vue et le mode de commande. Les icônes viennent du kit partagé ; les catégories utilisent une correspondance explicite de familles, sans déduire une image de produit.

Les réglages réunissent apparence claire/sombre, réduction des mouvements, réduction de transparence, densité du catalogue et les trois dispositions existantes. Ces préférences sont persistées dans la clé existante, avec migration indépendante des champs. Le choix système de réduction des mouvements reste prioritaire. Les réglages de poste et le splash restent disponibles.

Fichiers : `App.tsx`, `Catalog.tsx`, `CategoryTabs.tsx`, `category-icons.ts`, `SettingsModal.tsx`, `TicketPanel.tsx`, `TopBar.tsx`, `layout.ts`, `useLayout.ts`, `theme.ts`, `ui.tsx`, `prefs.ts`, `usePrefs.tsx` et leurs tests sous `apps/pos`. L'adaptateur partagé d'icônes est décrit dans `LOT-ICONES-V2.md`.

## Parcours salle intégré

La configuration des tables se fait dans les réglages du restaurant (voir `LOT-SALLE-BO.md`). La caisse peut ouvrir une tablée avec ses couverts, composer des plats, envoyer plusieurs tickets en cuisine, confirmer le service physique, encaisser chaque ticket avec le contrôleur existant, transférer la tablée et libérer la table après vérification. Le KDS reçoit le libellé de table ; une commande confirmée servie sort de la file cuisine tout en restant impayée. Le service physique ne modifie pas le paiement.

Chaque envoi utilise la chaîne serveur existante de prix, options, stock, promotions et admission. Aucun montant du brouillon ne fait autorité. Variantes, options, retraits, notes et fidélité restent conservés. Le service à table demande une connexion pour confirmer l'occupation partagée ; les ventes ordinaires gardent leur file hors ligne existante.

`PosScreen.tsx` orchestre `DiningRoomPanel.tsx` et `useDining.ts`. La table consultée est distincte de la table du brouillon : parcourir la salle ne réattribue aucun panier. Les tickets mis en attente gardent leur référence de tablée. Un panier non vide doit être terminé, mis en attente ou vidé explicitement avant de changer de contexte.

`dining-operation.ts` conserve une intention validée avant tout appel réseau, avec UUID, auteur et identité opaque du brouillon. Une erreur réseau, un timeout, un 403 ou un conflit générique ne l'effacent pas. Seul un reçu confirmé ou un rejet durable portant le même UUID permet l'acquittement. La purge/désappairage est bloquée tant que cette référence existe ou reste illisible. La session originale peut être reconnectée pour reprendre le même envoi. Toutes les mutations de salle passent par la gate du poste, qui diffère le verrouillage pendant l'opération ; l'auteur est revérifié après écriture locale et avant envoi.

`dining-journal.ts` construit le journal avec le numéro, l'identité, le prix et le paiement confirmés par le serveur. Son écriture durable précède l'acquittement de l'envoi. Un journal refusé conserve l'intention, sans autoriser une nouvelle commande. Les reprises dédupliquent le journal et préservent un paiement plus récent. Entre onglets, la reprise conserve le brouillon étranger et garde bloqué le brouillon original jusqu'à confirmation de sa propre référence ; un acquittement externe ne le rend pas revendable.

Fichiers métier supplémentaires : `dining-operation.ts`, `dining-journal.ts`, `useDining.ts`, `DiningRoomPanel.tsx`, `PosScreen.tsx`, `client.ts`, `pos-state.ts`, `service-state.ts`, tests d'intentions/journal et recette `e2e/local/refonte-pos-dining.mjs`. Les changements serveur et contrats possèdent leurs propres preuves ; la recette navigateur ci-dessous ne s'y substitue pas.

## Preuves locales et limites

Ces preuves portent sur la seconde passe avant reprise de la PR 178 ; la compatibilité avec sa nouvelle base est vérifiée séparément.

- Typecheck et suite POS : **331 tests Vitest + 5 tests de configuration build passent**. Aucun test supprimé. Le test de liste des clés à purger est enrichi avec la nouvelle intention.
- Export web : réussi, empreinte `index-2fd628f40eefe1c55603fbf282285579.js`.
- Recette visuelle historique : **7/7**, A/B/C, clair/sombre, desktop/tablette/mobile, configurateur, ticket, notes, focus, réglages et rotation du viewport. Une nouvelle capture finale sur la base PR 178 remplacera les preuves de présentation précédentes.
- Recette salle : **6/6**, avec service avant paiement, transfert, encaissement, clôture, ticket imprimable conservant sa table historique, perte de réponse/rechargement, autre équipier bloqué, quota du journal refusé, deux onglets et remboursement avant reprise. `captures/pos-salle-v2/resultats.json`.
- Exports Hermes iOS et Android réussis dans `/tmp/snackmanager-refonte-v2-pos-native`, après les derniers durcissements et le correctif journal.
- Logs `preuves/pos-v2-*-avant178.log`.

Le journal respecte la convention existante « montant avant remise + remise séparée ». Une reprise déjà remboursée porte un marqueur explicite « Remboursé · encaissement historique », sans inventer une dette ni modifier la ventilation historique existante. Le récapitulatif rappelle que les remboursements ne sont pas déduits de ce journal local. Les entrées préexistantes restent dédupliquées et conservées.

Captures réellement inspectées : catalogue clair et paramètres sombres, salle desktop claire avant/après service, salle mobile sombre, création d'illustration et thèmes BO. Les captures salle reposent sur le vrai export Expo et des réponses HTTP locales interceptées ; les contrôles serveur sur Mongo temporaire et HTTP Nest sont distincts. Aucun compte, base, règlement, TPE ni déploiement réel. Les exports natifs ne valent pas une recette sur appareil, imprimante ou tiroir-caisse.

La clôture porte sur les tickets entiers de la tablée. Aucun fractionnement par couvert, paiement partiel ou pilotage de TPE n'est ajouté à ce lot. Ces comportements ne sont pas simulés par l'interface. La référence table imprimée au moment de l'envoi reste un historique ; l'occupation actuelle se lit dans la tablée après transfert.

## Validation finale sur PR 178

Les packages contrats/client-core ont été reconstruits après le rebase local. Les sources terrain validées sont identifiées par `preuves/pr178-terrain-source-freeze.json` ; le HEAD seul précédait les derniers correctifs POS.

- Typecheck : **PASS** ; **332 tests Vitest + 5 tests Node PASS**, aucun ignoré.
- Export web : **PASS**, `preuves/pr178-pos-build.log`.
- Présentation : **7/7 parcours PASS**, 29 captures dans `captures/pos-fidelite-v2-final`. Une assertion de géométrie vérifie les trois colonnes à 1 512 px, y compris avec le rail A, avec des cartes d'au moins 276 px. Catalogue, configurateur, ticket, notes, clavier, réglages et rotation restent testés.
- Salle : **7/7 parcours PASS**, `captures/pos-salle-v2/resultats.json`. Le dernier cas reprend une entrée déjà persistée impayée, puis encaissée et remboursée par un autre poste : une seule entrée, même intention, aucun nouvel encaissement et libération possible. Les états remboursés restent terminaux face à une ancienne réponse payée.
- Exports natifs **iOS et Android PASS** après ce correctif, `preuves/pr178-pos-native.log`. Ce sont des bundles Hermes, sans signature ni distribution.

La réconciliation commune accepte désormais la preuve serveur remboursée pour réparer un faux dû local, sans créer une vente absente ni déduire un remboursement du journal historique. L'acquittement de l'envoi Salle attend cette écriture durable. Ce correctif a été relu indépendamment (`COMPATIBILITE-PR178-AUDIT.md`).

Les logs `preuves/pr178-pos-{typecheck,tests,build,visuel,salle,native}.log` remplacent les résultats antérieurs pour le lot final. Les captures de diagnostic `*-failure.*` conservées dans le dossier Salle proviennent d'un ancien sélecteur de recette (« Commandes » est une case de sélection, pas un bouton) ; elles ne figurent pas dans les résultats finaux réussis.
