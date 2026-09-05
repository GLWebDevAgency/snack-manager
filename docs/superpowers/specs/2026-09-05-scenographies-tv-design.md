# Les scénographies de l'écran de salle — plusieurs mises en scène, un seul contenu vivant

*Spec de conception · 5 septembre 2026 · approche « modules dans l'application » validée*

## 1 · La décision, et ce qu'elle renverse

Le Menu Board affiche aujourd'hui une seule mise en scène, dessinée en dur, qui ne connaît de la marque que sa couleur d'accent. Le réglage « Fond clair » du back-office ne fait rien. Le gérant ne voit son écran que sur le téléviseur.

Cette spec pose trois choses :

| Question | Décision | Pourquoi |
|---|---|---|
| Comment une scénographie entre-t-elle dans le produit ? | **Un module React inscrit dans un registre**, jamais un fichier HTML monté dans un cadre isolé | Une seule exécution sur une clé HDMI à 30 €, pas d'iframe ni de messages, les polices et les jetons déjà présents, un aperçu qui rend le même composant que le téléviseur, et tout se teste avec les outils du dépôt. Le kit produit dans Claude Design est **repris**, pas branché. |
| Que voit l'écran de la marque ? | **Le masque entier**, résolu par le même résolveur que la vitrine et la carte de fidélité | Le réglage de fond devient réel : vos couleurs, un fond sombre neutre, un fond clair neutre, en gardant accent et logo. Changer une couleur repeint l'écran dans la minute. |
| Où le gérant choisit-il ? | **Un tiroir « Apparence »** sur chaque écran, avec un téléviseur miniature vivant | Il voit sa vraie boucle, avec sa vraie carte, avant d'enregistrer. Une scénographie se choisit sur une tuile vivante, pas sur une image figée. |

Le prompt de scénographie (`bilan-et-cap`, section 04) reste la grammaire de conception : c'est ce que le fondateur continue de produire dans Claude Design, et ce que l'ingénierie porte en module.

## 2 · Périmètre

**Dedans.** Le champ `scenography` sur l'écran (contrat, base, vue, contenu). La variante de fond du masque au contrat. Le masque transporté jusqu'à l'écran et résolu sur place. Un registre de scénographies. Deux scénographies complètes, paysage et portrait : **Ardoise** (l'écran actuel, adopté au masque) et **Comptoir** (la reprise du kit « Le comptoir de nuit »). Une route d'aperçu authentifiée, pour un écran ou un brouillon. Le tiroir « Apparence » du back-office. Les tests, dont un parcours de bout en bout sur l'écran de salle.

**Dehors — dit pour ne pas être deviné.**
- L'hôte de fichiers HTML externes (cadre isolé, injection de polices, politique d'images). Le contrat de données ci-dessous le permettrait plus tard sans rien changer au modèle.
- Une troisième scénographie. Elle tient ensuite dans un dossier du registre.
- Un conditionnement par formule : les écrans ne figurent pas dans la grille publiée (`CAPACITES`), rien ne leur a été vendu, rien ne leur est retiré.
- Le choix de la scénographie par scène. Une scénographie vaut pour l'écran entier : mélanger deux mises en scène dans une même boucle ferait un écran qui hésite.

## 3 · Le modèle

### 3.1 · L'écran

Trois réglages d'apparence, tous stockés sur `Screen` :

```ts
scenography: 'ardoise' | 'comptoir'   // NOUVEAU — la mise en scène
theme:       'brand' | 'dark' | 'light' // existant — le FOND, désormais effectif
orientation: 'landscape' | 'portrait'   // existant
```

Contrat (`packages/contracts/src/screens.ts`) :

```ts
export const SCENOGRAPHIES = ['ardoise', 'comptoir'] as const;
export const SCENOGRAPHY_DEFAULT: Scenography = 'comptoir'; // les écrans NEUFS
export const SCENOGRAPHY_LABELS = { ardoise: 'Ardoise', comptoir: 'Comptoir' };
export const SCENOGRAPHY_DESCRIPTIONS = {
  ardoise: 'La carte en lignes, sobre et dense : le nom, la description, le prix.',
  comptoir: 'Des boîtes photo pleines sous la lampe du comptoir, le prix en étiquette collée.',
};
export const SCREEN_THEME_LABELS = { brand: 'Vos couleurs', dark: 'Fond sombre', light: 'Fond clair' };
```

- `ScreenCreateSchema.scenography` a pour défaut `SCENOGRAPHY_DEFAULT` ; `ScreenUpdateSchema.scenography` est optionnel.
- `ScreenView` porte `scenography` et `scenographyLabel`.
- Base : `scenography: { type: String, enum: SCENOGRAPHIES, default: 'ardoise' }`. Les documents **existants** n'ont pas le champ : `toStored` lit `raw.scenography ?? 'ardoise'`, si bien qu'aucun écran installé ne change d'apparence à la mise à jour. Seuls les écrans créés après portent Comptoir par défaut.

### 3.2 · Le fond — une variante du masque, au contrat

`packages/contracts/src/marque.ts` :

```ts
export type FondEcran = 'brand' | 'dark' | 'light';
export function masquePourFond(brand: Brand, fond: FondEcran): Brand;
```

- `brand` : le masque tel quel.
- `dark` : le masque avec une palette neutre sombre — `ground #0e0e10 · surface #17171a · ink #f4f2ed` — et **l'accent et son encre conservés** ; `mode: 'dark'`, `preset: null`. Logos, photo d'accueil, accord typographique, forme, mouvement, en-tête : inchangés.
- `light` : idem avec une palette neutre claire — `ground #f5f2ec · surface #ffffff · ink #1a1816` — et `mode: 'light'`.

Les deux palettes neutres vivent dans le contrat (`FONDS_NEUTRES`), et le résultat passe `BrandSchema` : le mode suit le fond (`modePourFond`), condition que la garde d'écriture exige déjà. `resoudreMarque` fait le reste, y compris ramener l'accent en texte à AA sur le nouveau fond (`--cf-accent-ink`) et choisir les teintes sémantiques du mode.

### 3.3 · Le contenu transporté

`ScreenContent` gagne deux champs, tous deux dans l'empreinte :

```ts
scenography: Scenography;
masque: Brand;            // le masque EFFECTIF — la variante de fond déjà appliquée
```

`brand.logoUrl` et `brand.accent` (`ScreenBrand`) restent, pour le cache et l'en-tête, et sont désormais dérivés du masque effectif : `logoPour(masque, 'mark')` et `masque.palette.accent`. L'écran ne connaît pas la logique du fond : il reçoit un masque et le résout. `BoardIdentity` gagne `brand: Brand` (via `marqueObservee`), et `identiteDuTableau` reste la seule dérivation.

Un cache écrit par la version précédente n'a pas de `masque` : l'écran retombe sur `marqueDeRepli(brand.accent, brand.logoUrl)` plutôt que sur un écran noir, jusqu'à la prochaine réponse réseau.

## 4 · Le contrat d'une scénographie

`apps/web/src/components/board/scenographies/registry.ts` :

```ts
export interface ScenographyProps {
  scene: ScreenScenePayload;
  content: ScreenContent;        // brand, serviceLabel, open, timezone…
  orientation: ScreenOrientation;
  prixMono: boolean;
}
export interface ScenographyModule {
  Component: ComponentType<ScenographyProps>;
  /** `header` : l'hôte peint l'en-tête persistant (logo, service, heure) ; `none` : la scénographie dessine le sien. */
  chrome: 'header' | 'none';
}
export const SCENOGRAPHIES_WEB: Record<Scenography, ScenographyModule>;
```

Ce que l'hôte garantit à toute scénographie, et qu'elle ne refait pas :

- un cadre de **référence fixe** — 1920 × 1080 ou 1080 × 1920 — mis à l'échelle par un seul `transform: scale()` et pivoté au besoin (`use-stage`) ;
- les **jetons du masque** sur la racine (`styleDuMasque`), les **polices** de l'accord (`classesPolices`), `color-scheme`, et `data-prix-mono` ;
- la **rotation** des scènes, le **fondu** entre deux scènes (deux couches, entrante et sortante), la **barre de progression**, le **pré-chargement** des photos de la scène suivante, le **rechargement de nuit** et le verrou de veille ;
- la **mise à jour en place** : une scène recalculée avec le même `id` est re-rendue sans rejouer l'entrée. Les produits sont clés par `id` : un prix, une rupture ou une photo changent sans que rien ne saute.

Ce qu'une scénographie doit :

- n'animer que `transform` et `opacity`, n'écrire aucune couleur ni durée en dur, prendre ses durées dans `--sm-t-*` et sa courbe dans `--sm-ease` ;
- tenir les planchers de lisibilité à huit lignes — paysage : nom 42, description 24, prix 46, titre 76 px ; portrait : 56 / 30 / 62 / 96 — et monter quand il y a moins de lignes ;
- afficher `priceLabel` tel quel, recadrer une photo par `cadrageCss(photoPoint)` et rien d'autre, poser un texte sur photo sur `--cf-scrim` ;
- dire la rupture avec retenue (atténué, jamais retiré), traiter les six cas — catégorie, sélection, panneau libre, offres, fermé, liste vide — dans les deux orientations ;
- désarmer tout mouvement sous `prefers-reduced-motion`.

## 5 · Comptoir — la reprise du kit

Direction : *l'œil voit d'abord la nourriture.* Des boîtes photo pleines posées sur un fond profond, comme des plats sous la lampe du comptoir. Deuxième lecture, le prix : étiquette collée en accent, un peu de travers, jamais discrète, jamais animée. Troisième, le nom en capitales de titrage, puis la composition en retrait. Un titre de scène très grand ancre la catégorie ; son fantôme tapisse le fond en `--cf-surface` et donne de la matière sans rien ajouter.

Fichiers : `scenographies/comptoir/Comptoir.tsx`, `composition.ts` (règles pures), `comptoir.css`, `FadeText.tsx`.

### 5.1 · Composition — `composition.ts`, fonction pure

| Cas | Paysage | Portrait |
|---|---|---|
| `closed` | plaque fermée : logo, titre, « Réouverture {dayLabel} » et créneaux, ou `subtitle` si `nextOpening` est nul | idem |
| `promo` | une à trois offres en cartes, libellé en aplat vert (`--cf-green` / `--cf-on-green`) | idem, empilées |
| liste vide | plaque de marque : logo, titre, sous-titre | idem |
| 1 produit | héros plein cadre, légende sur voile | idem |
| `featured`, 2 à 8 | héros + liste latérale (jusqu'à 7 lignes) | héros dessus, liste dessous |
| 2 / 3 / 4 | 2, 3 ou 4 boîtes en ligne | 2 boîtes empilées / grille 2 × 2 |
| 5 à 6 / 7 à 8 | grille 3 × 2 / 4 × 2 | liste de 5 à 8 lignes, vignette carrée |

La table des tailles est celle du kit, par disposition et orientation, exprimée en pixels de référence (nom, description, prix, titre, libellé, nom du héros, prix du héros). Elle respecte les planchers dans tous les cas et monte dès qu'il y a moins de lignes. Les vignettes de liste et de sélection se calculent depuis la hauteur de référence du corps, jamais depuis le téléviseur.

### 5.2 · L'en-tête de la scénographie

Comptoir déclare `chrome: 'none'` et dessine son en-tête dans la scène : à gauche, l'œil-de-perdrix du service, le titre, le sous-titre ou les puces de pagination (« 2 / 3 » devient des points, le courant allongé en accent) ; à droite, le verrou du restaurant s'il est posé (`verrouPour`), sinon la marque et le nom, puis « Service du soir · 19:42 » avec l'horloge du restaurant (`useRestaurantClock`).

### 5.3 · Mouvement

- Entrée de scène : l'en-tête puis chaque boîte montent en cascade — `rise` en `--sm-t-med`, décalage `--sm-t-snap × i`.
- Dérive du héros : `scale(1) → scale(1.08)` sur exactement `scene.durationMs`, jouée une fois, jamais rejouée à la mise à jour.
- Mise à jour en place : le nom, la description, le titre, une offre se fondent en `--sm-t-fast` (`FadeText` : opacité à 0, remplacement du texte, retour) ; **le prix change sans animation** ; une photo neuve se fond par-dessus l'ancienne quand elle est chargée ; la rupture bascule par transition d'opacité du voile et de l'étiquette.
- Aucune ombre animée, aucun filtre, aucun canvas.

### 5.4 · Rupture, nouveauté, sans photo

Rupture : la boîte reste, son voile passe à 55 %, le nom en `--cf-mut`, l'étiquette de prix en `--cf-surface-6` / `--cf-mut`, un tampon « Épuisé » en `--cf-red-t` sur `--cf-surface-2`, incliné. Nouveauté : une pastille « Nouveau » en `--cf-fill` / `--cf-on-fill`, discrète. Sans photo : l'initiale du produit en fantôme géant sur `--cf-elev-gradient`.

## 6 · Ardoise — l'écran actuel, adopté au masque

Le rendu, la composition et les métriques ne changent pas. Ce qui change :

- les neutres codés en dur (`#000`, `#111`, `#1a1a1a`, gris de texte, filets) deviennent `--cf-bg`, `--cf-surface`, `--cf-surface-2`, `--cf-mut`, `--cf-line` ;
- `--bd-accent` et ses dérivés deviennent `--cf-accent`, `--cf-on-accent`, `--cf-accent-wash`, `--cf-accent-ink` ; `board-theme.ts` perd `boardPalette` (seul `monogramOf` reste) ;
- la police devient `--cf-font-body`, les titres `--cf-font-display`, les prix `--cf-font-mono` quand `prixMono` ;
- l'en-tête persistant (`chrome: 'header'`) montre le verrou s'il est posé, sinon la marque et le nom.

Sur un masque de repli (tenant non repris), Ardoise rend exactement ce qu'elle rend aujourd'hui : Nuit porte les mêmes noirs et le même laiton.

## 7 · L'API

### 7.1 · Rendu

`renderScreenContent` :

```ts
const masque = masquePourFond(snapshot.identity.brand, screen.theme);
painted = { …, scenography: screen.scenography, masque,
  brand: { slug, name, logoUrl: logoPour(masque, 'mark'), accent: masque.palette.accent } }
```

L'empreinte change donc au changement de scénographie, de fond, ou de masque.

### 7.2 · Aperçu

```
POST /screens/preview          rôles owner · gerant
body  ScreenPreviewSchema = {
  screenId?: string | null,    // l'écran dont on part (playlist, réglages) — 404 s'il n'existe pas
  orientation?, theme?, scenography?, playlist?   // les surcharges du brouillon
}
→ ScreenContent               // screenId = l'écran, ou 'preview'
```

Cas d'usage `PreviewScreenContent` : compose un écran virtuel (`active: true`) depuis l'écran chargé ou depuis les défauts, applique les surcharges, prend l'instantané de la carte, appelle `renderScreenContent`. Sans jeton d'appareil, sans battement de cœur, sans écriture.

### 7.3 · Gestion

`ManageScreens.create` transmet `scenography` ; `toScreenView` expose `scenography` et `scenographyLabel` ; `ScreenPatch.scenography`.

## 8 · L'écran de salle (web)

- `board-display.tsx` : `masque = content.masque ?? marqueDeRepli(…)` ; racine `.bd-root` avec `styleDuMasque(masque)`, `classesPolices`, `data-scenography`, `data-prix-mono` ; l'en-tête persistant selon `chrome`.
- `BoardStage` extrait de `board-display.tsx` : la scène de référence, ses deux couches, la barre de progression. Réutilisé par l'aperçu du back-office en mode **incrusté** (`data-embed="1"` : position relative, dimensions du cadre, pas de curseur masqué).
- `use-stage.ts` : `computeStage(viewport, configured)` devient une fonction pure partagée ; `useStage` mesure la fenêtre, `useEmbeddedStage(ref)` mesure un conteneur (`ResizeObserver`).
- `SceneLayer` délègue au module du registre ; `board-scenes.tsx` et `product-row.tsx` migrent sous `scenographies/ardoise/`.
- Les feuilles `board.css` et `comptoir.css` sont importées par `app/board/layout.tsx` et par le composant d'aperçu de l'admin.

## 9 · Le back-office

### 9.1 · Le tiroir « Apparence »

Ouvert depuis la carte de l'écran (bouton « Apparence », à côté de « Composer la boucle »). Largeur 640.

1. **Le téléviseur** : `BoardStage` incrusté, au ratio de l'orientation du brouillon, qui joue la vraie boucle avec `useSceneRotation`. Sous lui : précédent, pause, suivant, le nom de la scène courante et sa position (« 3 / 9 »), la barre de progression.
2. **Scénographie** : une tuile vivante par entrée du registre — un mini-cadre à l'échelle qui rend la scène courante dans cette scénographie, mouvement figé (`data-still`) — avec libellé et description. `aria-pressed`.
3. **Fond** : trois options segmentées, chacune précédée d'un échantillon (fond, surface, accent) calculé par `masquePourFond` sur le masque du restaurant.
4. **Orientation** : deux options segmentées.

Le brouillon est local ; l'aperçu le suit (`POST /screens/preview` avec les surcharges, temporisé 250 ms). Pied : « Enregistrer l'apparence » (`PATCH /screens/:id`), désactivé sans changement ; fermeture confirmée si des changements sont perdus, comme le tiroir de boucle.

**Vivant** : le contenu de l'aperçu est redemandé toutes les 30 s et au retour de focus ; l'état n'est remplacé que si `contentHash` a bougé, exactement comme sur le téléviseur. Un prix changé dans « Menu & prix » apparaît dans le tiroir sans clic.

### 9.2 · Création et carte

- Modale de création : le champ « Scénographie » s'ajoute aux deux existants (`Select`, description en aide). Défaut Comptoir.
- Carte : une pastille de plus (`scenographyLabel`).

### 9.3 · Le masque du restaurant dans l'admin

Les échantillons de fond se calculent par `masquePourFond` sur le masque **de base** du restaurant, lu dans la session (`GET /me` porte déjà `brand`, voir `lib/api.ts`). Le contenu d'aperçu ne convient pas : son `masque` est déjà la variante du brouillon, et la base ne s'en déduit pas. Sans masque en session, les trois options gardent leur libellé et perdent seulement leur échantillon. Aucune route nouvelle.

## 10 · Tests

- **Contrat** — `masquePourFond` : `brand` rend l'objet même ; `dark`/`light` gardent accent, encre d'accent, logos, accord, forme, mouvement, en-tête ; le mode suit le fond ; le résultat passe `BrandStrictSchema` ; `resoudreMarque` du résultat donne `--cf-accent` inchangé et un `--cf-bg` neutre.
- **API** — rendu : `masque` et `scenography` dans le contenu ; l'empreinte change avec le fond et avec la scénographie ; `logoUrl` suit le mode de la variante ; `toStored` sans champ ⇒ `ardoise` ; création ⇒ `comptoir`. Aperçu : brouillon sans écran ⇒ `screenId: 'preview'` ; surcharges appliquées ; écran inconnu ⇒ 404 ; câblage Nest.
- **Web** — `composition.ts` : la disposition pour chaque effectif et orientation, la table des tailles sous aucun plancher, les vignettes en pixels de référence ; `computeStage` : échelle et rotation ; `FadeText` : le prix ne passe pas par le fondu ; garde `PIECES_DE_LOGO` étendue aux nouveaux fichiers qui peignent un logo.
- **Bout en bout** — `e2e/reel/ecran-apparence.test.mjs` : connexion réelle, création d'un écran par l'API, ouverture du tiroir « Apparence », un cadre prêt avec une couche de scène, bascule de scénographie visible sur `data-scenography`, suppression de l'écran. Ignoré sans identifiants, comme les autres.

## 11 · Migration et compatibilité

- Aucune migration de données : le champ absent vaut `ardoise` à la lecture.
- Le cache local d'un téléviseur antérieur reste lisible (repli de masque) et se remplace au premier contenu frais.
- `ScreenPaired` ne change pas : la clé HDMI n'a pas à connaître la scénographie, elle la lit dans le contenu.
- Les tests de `board-theme.ts` et de `board-scenes.tsx` qui existent suivent les fichiers déplacés.
