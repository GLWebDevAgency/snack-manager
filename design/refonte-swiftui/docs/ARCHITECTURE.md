# Architecture de la couche de présentation

```
Contrôleurs et état ACTUELS du produit
            | props / labels / événements
            v
    ui-web             ui-native
       \                 /
           presentation
       /        |        \
    tokens    icons     assets
```

`studio` consomme les tokens, vecteurs et styles avec ses propres fixtures DOM. Il ne simule pas un backend et n’est pas l’implémentation React des applications. Cette séparation permet de vérifier et transmettre la direction sans toucher l’encaissement réel ; elle impose aussi de tester les composants React et leur intégration séparément.

## API du kit

Les montants sont reçus comme `priceLabel`, les quantités comme labels de présentation, les actions comme callbacks. Le package presentation ne possède ni états de commande métier ni données fiscales. Les phases d’action décrivent ce que l’utilisateur voit et viennent du contrôleur existant. L’état `uncertain` verrouille le bouton déclencheur ; la reprise dédiée reste fournie par le contrôleur.

Web : ThemeBoundary, Button, IconButton, StatusBadge, Notice, TextField, SegmentedControl, Stepper, Surface, SheetFrame, Dialog optionnel, EmptyState, Skeleton, ProductTile, TicketSummary, KitchenTicket, LoyaltyPass, MissionCard, DataTable.

Native : ThemeProvider, useTheme, useReducedMotion, Button, Icon, Artwork, StatusBadge, Notice, TextField, SegmentedControl, Stepper, Surface, SheetFrame, EmptyState, Skeleton, ProductTile, TicketSummary, KitchenTicket, LoyaltyPass, MissionCard. Les tables desktop restent une spécialité web ; native peut rendre des listes via les composants existants.

Le moteur CSS ne déborde pas de `.sm-ui`. Les thèmes React n’écrivent pas des variables globales hors de leur boundary. Les options de thème existantes restent propriétaires de la persistance. Les packages n’importent aucune fixture ni API.

## Génération

`tools/build.mjs` assemble le studio autonome, exporte les SVG, le manifeste, JSON/CSS de tokens et les briefs par vue. Le build est volontairement sans dépendance externe et déterministe hors métadonnées système. Les TSX ne sont pas transformés par cette commande ; `build` du kit n’est donc pas un build d’application native ou Next.

Les exports JSON de tokens constituent un schéma documenté propre au kit, pas une déclaration de conformité intégrale au format DTCG. Toute conversion vers un outil externe doit être validée. Aucun fichier Figma, .app, APK, IPA, EXE ou DMG n’est inclus.
