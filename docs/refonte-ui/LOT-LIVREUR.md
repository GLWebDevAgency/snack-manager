# Lot livreur — présentation locale

12 septembre 2026, worktree `SnackManager-refonte-ui`, branche `refactor/apple-ui-integration`, base `aefdf974`.

## Changements

- `apps/web/src/app/livreur/delivery-access.tsx` importe les palettes, niveaux de titre et mouvement de `@sm/design-tokens`, puis injecte uniquement des propriétés CSS sur `.lv-app`. Les surfaces qui servent à `ajusterJusquaAA` viennent du même objet que les surfaces rendues : aucune désynchronisation entre nouvelle palette et contraste de l'accent.
- `apps/web/src/app/livreur/livreur.css` conserve sa portée `.lv-*` et reçoit les nouvelles surfaces opaques, des encres/états lisibles en clair et sombre, des ombres plus légères et le focus clavier 3 px. L'accès initial devient une carte. Le titre existant « Mes missions » devient visible. Les filtres et titres sont plus sobres, les mouvements d'appui passent à 90 ms et une échelle 0,985.
- `apps/web/src/app/livreur/delivery-brand-shape.browser.test.tsx` actualise les deux fonds attendus (clair `#f5f5f3`, sombre `#161916`) et vérifie les contrastes des propriétés CSS réellement rendues. Les assertions net/doux/rond, relecture de marque, repli legacy, focus et absence de mutation réseau sont conservées.

Les rayons structurels restent ceux de `styleDuMasque(brand)` : aucune valeur 12/20/28 imposée sur une préférence restaurant existante. Les onglets utilisent le rayon contrôle du tenant. Les avatars, pastilles, poignées et switches gardent leurs formes intrinsèques. La police Inter déjà utilisée reste en place ; les niveaux de titres viennent des tokens.

## Invariants

Le diff de `DeliveryAccess` est limité à l'import de tokens et à la construction de styles. Le client d'accès, la restauration, les invitations, les phases et messages d'incertitude, les callbacks de connexion/déconnexion, le polling, les listeners de visibilité/réseau et les clés de composant n'ont pas changé.

`delivery-missions.tsx`, l'historique, les préférences persistées, les clients, la remise QR/code, les incidents, UUID/révisions et reprise ne sont pas modifiés. Les états ready/route/blocked/late gardent leurs couleurs fonctionnelles, libellés et conditions. Aucun GPS, revenu ou état de mission n'est inventé. Les safe areas, scrolls, hôtes de dialogues et gestes de fermeture restent présents.

## Sources consultées

Handoff et prompt `08-LIVREUR.md`, briefs générés `courier-access`, `courier-tour`, `courier-map`, `courier-history` et `courier-account`. Images réellement ouvertes : `design/refonte-swiftui/maquettes/captures/courier-tour.png` et `courier-access.png`.

`apps/web/AGENTS.md` lu et conservé. Le guide CSS de la version Next installée a été lu dans `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` (package hoisté à la racine). Aucun nouveau reset global ni changement d'import CSS n'a été introduit.

## Vérifications exécutées

Depuis la racine, avec Node 24.20.0 :

```sh
PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH pnpm --filter @sm/web exec vitest run src/app/livreur/delivery-brand-shape.browser.test.tsx src/app/livreur/DeliveryInvitation.browser.test.tsx src/app/livreur/delivery-preferences.browser.test.tsx
```

**25 tests réussis dans 3 suites** : 8 forme/marque et contraste, 10 invitation, 7 préférences et historique. Les scénarios navigateur utilisent leurs serveurs et réponses de recette locale. Ils couvrent notamment six couples forme/thème, focus après fermeture, invitation à 320/1440 px, même tentative après réponse perdue, préférences système, accès révoqué et réponse historique tardive.

`git diff --check` : **réussi**. Aucun test retiré, aucune garde relâchée.

Typecheck complet, build Next et captures du rendu intégré restent coordonnés par l'agent principal dans `REPRISE.md`. Le rendu Safari/PWA installée, le clavier logiciel réel, la caméra et la permission de wake lock sur appareil ne sont pas prouvés par ces suites Chromium.

Aucun commit, push, fusion, déploiement, compte ou paiement de production utilisé par ce lot.
