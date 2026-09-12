# Résultats de vérification — 12 septembre 2026

## Portée

Validation du **kit isolé et du studio de maquettes**, pas des applications Snack Manager en production. Les données sont fictives. Aucun terminal, prestataire bancaire, API restaurant, compte utilisateur réel ou base de production n’a été appelé.

| Vérification exécutée | Résultat |
|---|---|
| Tests Node | 44 réussis, 0 échec. Log `node-test-build.txt`. |
| Construction sans dépendance | Réussie : 57 HTML individuels + studio, 41 illustrations halal-first, 78 icônes, exports et 57 briefs. |
| Analyse XML SVG | 93 documents analysés, pas d’erreur XML. |
| Analyse syntaxique TypeScript | 8 fichiers TSX/déclarations, 0 erreur, TypeScript 5.8.3. Ce n’est pas un typecheck sémantique. |
| Matrice Chromium | 456 rendus : 57 vues × 4 formats × 2 thèmes. Titre/contenu/overflow contrôlés. |
| Exceptions et console | Aucune exception JS et aucune erreur console relevées pendant la matrice finale. |
| Interactions du studio | 10 cas de parcours + 2 cas de focus/note : tous réussis. |
| Serveur de consultation | GET / : 200 HTML ; HEAD SVG : 200 ; POST : 405. |
| Captures | 57 vues individuelles ; captures de familles et de mode sombre livrées dans l’archive. |

## Environnement et méthode

Node 22.16.0, Linux, Chromium système 144.0.7559.96 via Python Playwright. Le plugin Browser n’est pas disponible dans cette session. Le navigateur bloque `file://` avec `ERR_BLOCKED_BY_ADMINISTRATOR` ; le HTML réellement construit a donc été chargé avec `page.set_content`. Le serveur local a été vérifié séparément via HTTP. L’ouverture directe du fichier par un navigateur non administré n’a pas été recettée ici.

Formats de matrice : 1440×1000, 1024×768, 768×1024, 390×844. Captures principales : 1512×982 et 390×844. Contrôles supplémentaires : boutons de paiement visibles sur POS non compact, navigation mobile visible et absence d’écrasement du solde fidélité.

Les 10 parcours couvrent recherche produit, feuille produit, ajout fixture, paiement incertain désactivé, progression KDS fixture, KDS prêt passif, panier mobile, navigation scanner fidélité, confirmation explicite de remise et réduction des mouvements. Deux tests complémentaires vérifient Escape avec restauration du focus au produit et conservation d’une note **en mémoire seulement**.

## Corrections apportées pendant la revue

- Paiement POS initialement trop bas : zones catalogue/ticket indépendamment défilantes et pied d’encaissement maintenu visible.
- Navigation client/livreur hors viewport : cadre de hauteur mesurée et contenu interne défilant.
- Carte fidélité comprimée par le layout : lignes à hauteur intrinsèque `grid-auto-rows:max-content`, test dédié ajouté ; solde de nouveau intégralement visible.
- Fermeture de dialogue perdant le focus lors du rerendu DOM : restauration au déclencheur, test Escape réussi.
- Note de maquette non conservée : brouillon local en mémoire restauré dans sa feuille.
- Deux clés d’icônes manquantes et cumul À lancer figé : registre complété et cumul dérivé des fixtures filtrées.

## Ce qui n’est pas validé

Pas de build/typecheck React ou React Native avec les dépendances du vrai monorepo. Aucun rendu de ces composants dans Expo, Next.js ou Electron ; pas de Safari/Firefox, appareil physique, VoiceOver/TalkBack, test matériel ou test d’encaissement. Le clonage local du dépôt était bloqué par DNS ; l’audit a été effectué par le connecteur GitHub. Les tests Node ne prouvent ni la parité complète ni la conformité accessibilité de chaque composant intégré.

Une première répétition complète de la matrice a dépassé le temps d’exécution disponible ; la version finale a été relancée avec sélection DOM contrôlée et a terminé les 456 rendus. Les résultats finaux sont dans `browser-report.json`. L’ajout de `qa/browser-check.py` permet de reproduire cette méthode avec Python Playwright installé (et, facultativement, `CHROMIUM_PATH`). Ce script n’installe pas de dépendance d’application.

## GitHub

Une tentative `create_tree` a été bloquée par le connecteur avec un message indiquant qu’il ne pouvait déterminer le niveau de sécurité. Aucun commit ni PR de livraison n’a donc été créé. Une relecture a confirmé la branche `design/swiftui-visual-system` toujours à `2c879899adc0e7c3b98817ef76cf026ea5d22bf8`. Les sources sont livrées en archive et patch Git ; aucun succès d’écriture GitHub n’est revendiqué.
