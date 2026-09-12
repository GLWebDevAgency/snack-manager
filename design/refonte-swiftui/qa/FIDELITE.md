# Comparaison avec la référence visuelle

Référence : ancien aperçu RestoPilot fourni dans la conversation. Résultat : captures Chromium du studio, inspectées visuellement, notamment POS, KDS, carte fidélité et back-office restaurant. Comparaison du POS/KDS à 1512×982 ; contrôle des vues mobiles à 390×844.

| Point | Référence | Rendu du kit / arbitrage |
|---|---|---|
| Palette | Toile #f5f5f3, surfaces blanches, mandarine | Valeurs reprises ; mode sombre propre et variante laiton disponibles. |
| Médias | Illustrations SVG détourées dans aplats discrets | Vecteurs d’origine repris, 24 variantes exportables ; pas de photos commerciales inventées. |
| POS | Rail, catalogue, panneau ticket | Même principe ; intitulés et moyens de paiement de Snack Manager ; pied maintenu visible. |
| KDS | Tickets arrondis et trois étapes | Composition reprise, mais statuts/couleurs/actions réels du dépôt ; aucun bouton de remise inventé. |
| Typographie | Chiffres tabulaires, tailles hiérarchisées | Renforcement de la lisibilité et des cibles ; police système sans fichier distribué. |
| Interactions | Feuilles, boutons, filtres | États, clavier, focus et réduction du mouvement ajoutés ; données restent des fixtures. |
| Mobile | Non entièrement couvert par l’ancien aperçu | Extension cohérente : navigation persistante et contenu intrinsèque non comprimé. |
| Marque | RestoPilot | Snack Manager conservé ; l’identité du restaurant n’est pas remplacée par la maquette. |

## Déviations intentionnelles

Le bouton mandarine utilise un texte sombre pour le contraste. Les libellés POS/KDS sont adaptés au code audité, pas copiés aveuglément depuis l’application RestoPilot de formation. Les filtres KDS sont ceux des canaux existants, pas une nouvelle gestion par poste. Le KDS prêt est passif. Les pages supplémentaires sont des références de structure, et non des reproductions pixel-perfect d’écrans actuels qui n’ont pas été ouverts.

Il serait incorrect d’annoncer une fidélité pixel-perfect globale ou une parité fonctionnelle déjà démontrée : l’intégration aux applications et la lecture exhaustive de tous les sous-formulaires restent à faire. Les défauts visuels constatés pendant cette revue ont été corrigés et consignés dans RESULTATS.md.
