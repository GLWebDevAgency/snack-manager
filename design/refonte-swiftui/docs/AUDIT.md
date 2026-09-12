# Audit de départ et arbitrage des branches

Inspection par le connecteur GitHub le 12 septembre 2026. Il s’agit d’une revue ciblée des fichiers et du graphe, pas d’un audit d’exécution de toutes les pages.

## État observé

`develop` et la branche `design/swiftui-visual-system` pointaient initialement vers `2c879899adc0e7c3b98817ef76cf026ea5d22bf8`. La première demande avait créé la branche, mais aucun commit de livraison n’y était rattaché. La liste des PR ouvertes était vide au début de cette reprise.

| Branche inspectée | Commits devant develop | Commits derrière develop | Décision |
|---|---:|---:|---|
| `codex/pos-visual-v2` | 1 | 12 | Consulter les différences, ne pas réappliquer sans comparer les fichiers actuels. |
| `codex/kds-visual-v2` | 1 | 10 | Le socle `@sm/ui-native` existe déjà sur develop. |
| `codex/commande-livreur-visual-v2` | 4 | 3 | Plusieurs composants V2 existent déjà sur develop ; conserver le develop audité. |

Le nombre de commits ne mesure pas la complétude fonctionnelle. Une intégration squash produit une divergence même lorsque le travail utile est déjà présent. Les autres branches ont été recensées, pas intégralement analysées une par une. Une nouvelle lecture du HEAD et des PR est obligatoire avant l’intégration.

## Sources effectivement examinées

| Surface | Sources et risques à protéger |
|---|---|
| Partagé | `packages/client-core/src/theme.ts`, `packages/ui-native/src/SMMark.tsx` : marque et couleurs fonctionnelles distinctes ; seuils 10/15 min. |
| POS | `apps/pos/src/PosScreen.tsx`, `Catalog.tsx`, `TicketPanel.tsx`, `PinScreen.tsx` : journal durable, reprise, dispositions, configurateur, téléphone et paiement existant. |
| KDS | `apps/kds/src/Board.tsx`, `ui.ts`, `components/SettingsSheet.tsx` : nouveau/préparation/prêt, filtres de canal, panneau À lancer, préférences, état réseau. |
| Fidélité | `apps/web/src/components/loyalty/LoyaltyCardApp.tsx` et navigation admin : carte, sessions, scan, actualisation, jetons et compte. |
| Livraison | `apps/web/src/app/livreur/delivery-presentation.tsx`, documentation COMMANDE-LIVREUR-V2 et arborescence : hôte de dialogue éprouvé, remise explicite, reprise opérationnelle. |
| Back-offices | `apps/web/src/app/admin/navigation.ts`, `admin/fidelite/navigation.ts`, `sm/navigation.ts` et arborescences : routes, noms, groupes, rôle/capacité. |
| Socle | `package.json`, `apps/web/package.json`, `apps/pos/package.json`, `ARCHITECTURE.md`. Les manifestes priment sur une ancienne description d’architecture. |

## Versions constatées, pas mises à jour

POS : Expo `~57.0.14`, React Native `0.86.2`, React `19.2.3`, react-native-svg `15.15.4`. Web : Next `16.3.1`, React `19.2.8`. Le monorepo utilise pnpm `10.14.0` et Node `>=24.12.0`. Cette mission ne modifie ni ces versions, ni le lockfile, ni les builds existants.

Le manifeste du studio identifie 57 vues de référence. Il sert de point d’entrée à la lecture du code ; une source de composition peut contenir plusieurs vues. Les formulaires génériques du back-office ne prétendent pas reproduire chaque champ de leur implémentation. Leur migration exige un inventaire champ/action/état supplémentaire.

## Ce qui est exclu

Aucune réécriture Swift, aucun backend de remplacement, aucune migration de base, aucune suppression de test, aucun changement de prix/règle fiscale, aucun rebranding imposé au restaurant, aucun déploiement ni fusion automatique.
