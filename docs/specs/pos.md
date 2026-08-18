# Spécification — Caisse tactile (POS)

Suite SaaS **Snack Manager** · surface « Caisse » (marque grise, multi-tenant, fast-foods)

| | |
|---|---|
| **Cible de production** | React Native / Expo, tablette **paysage 1280 × 830** (points logiques), cibles tactiles **≥ 44 px** |
| **Maquette de référence** | `Menu Trivolet Redesign (1)/app/pos-app.jsx` (composant `POSApp`) |
| **Primitives UI partagées** | `Menu Trivolet Redesign (1)/app/cf-ui.jsx` |
| **Helpers, catalogue, mocks** | `Menu Trivolet Redesign (1)/app/cf-helpers.js` (+ `menu-data.js` pour les données produits) |
| **Design system** | `app/classfood-ds.css` (tokens `--cf-*`), skin marque grise `app/sm-skin.css`, injecteur d'accent `app/sm-brand.jsx`, applicateur de tweaks `app/cf-theme.js` |
| **Pages hôtes de démo** | `Caisse - POS.html` (skin Class'Food) et `SM - Caisse (POS).html` (skin Snack Manager marque grise) |

> **Convention du document** : toutes les valeurs (px, hex, durées, chaînes) sont citées **exactement** depuis la maquette. Tout comportement absent de la maquette est marqué **« à définir »**. Les tailles sont en px CSS (à traduire en dp/pt React Native 1:1).

---

## 1. Vue d'ensemble & inventaire des vues

La caisse est un **écran unique** (pas de navigation par routes) avec des surcouches modales :

| Réf. | Vue | Type | Déclencheur |
|---|---|---|---|
| V1 | Écran principal (barre haute + rail catégories + grille produits + ticket) | plein écran | permanent |
| V2 | **Config express produit** (`QuickConfig`) — tailles, viandes tacos, gratiné, recette ST/SO…, sauces, menu | modale centrée 520 px | tap sur **n'importe quelle** carte produit disponible |
| V3 | **Encaissement espèces** (`CashModal`) | modale centrée 420 px | bouton « Espèces » |
| V4 | **Clôture de service (Z)** (`CloseModal`) | modale centrée 460 px | bouton « Service · {n} » de la barre haute |
| V5 | **Confirmation d'envoi en cuisine** | overlay centré 420 px | après tout paiement/envoi (`send`) |
| V6 | Toasts | empilement bas centré | mise en attente, rappel refusé, clôture |

**Rôle métier** : prise de commande comptoir (« Sur place », « À emporter ») et **téléphone** (nom + téléphone + heure de retrait), encaissement CB / espèces / « payer au retrait », envoi en cuisine (KDS), tickets en attente (park/recall), remise %, ventes additionnelles, clôture de caisse (Z).

---

## 2. Cadre d'écran & layout global (V1)

### 2.1 Cadre de la maquette (chrome de présentation — ne pas reproduire)

La maquette dessine une « tablette » factice : conteneur externe `1280 × 830`, fond `#0d0b0a`, `border-radius: 30px`, `padding: 13px`, ombre `0 40px 90px rgba(0,0,0,0.45)` ; conteneur interne `border-radius: 18px`, `overflow: hidden`, fond `var(--cf-bg)`, disposition en colonne. La page hôte centre et met à l'échelle ce cadre : `scale = clamp(0.05, min(1, (hauteurFenêtre − 24)/830, (largeurFenêtre − 24)/1280))`.

**En production RN** : l'app occupe le plein écran de la tablette en paysage ; seul le conteneur interne (fond `--cf-bg`, colonne) est à reproduire. Comportement hors 1280 × 830 (autres tailles de tablette) : **à définir**.

### 2.2 Grille de l'écran

```
┌──────────────────────────────────────────────────────────────────────┐
│ A. Barre haute (pleine largeur, hauteur au contenu ≈ 46 px)          │
├────────┬──────────────────────────────────────────────┬──────────────┤
│ B. Rail│ C. Zone produits (flex:1, scroll vertical)   │ D. Ticket    │
│ catég. │   - champ recherche                          │   384 px     │
│ 108 px │   - chips « tickets en attente »             │   fixe       │
│ scroll │   - grille produits 4 colonnes, gap 10       │   colonne    │
└────────┴──────────────────────────────────────────────┴──────────────┘
```

- Conteneur central : `flex: 1; display: flex; overflow: hidden; position: relative` (les modales V2–V5 sont positionnées en absolu dans cette zone, **sous** la barre haute qui reste visible).
- B (rail) : largeur **108 px**, `flex-shrink: 0`, scroll vertical.
- C (produits) : `flex: 1`, scroll vertical, `padding: 14px`.
- D (ticket) : largeur **384 px**, `flex-shrink: 0`, bordure gauche `2px solid var(--cf-text)`, fond `var(--cf-surface)`, colonne (header / corps scrollable / pied fixe).

---

## 3. Tokens de design

### 3.1 Skin « Class'Food » (référentiel `classfood-ds.css`)

Modèle : **constantes de marque** (jamais thémées) + **tokens sémantiques** (basculent en clair/sombre) + **alias accent** remplaçable.

#### Constantes de marque

| Token | Valeur | Usage |
|---|---|---|
| `--cf-cream` | `#F4EEE1` | crème (fond clair, texte sur encre) |
| `--cf-cream-2` | `#EDE5D3` | crème 2 |
| `--cf-paper` | `#FBF8F1` | papier |
| `--cf-ink` | `#1C1612` | encre (noir chaud) |
| `--cf-mut` | `#6E6354` | texte atténué |
| `--cf-red` | `#C8281E` | **rouge fonctionnel** — alerte / nouveau / urgent (sert aussi d'accent par défaut) |
| `--cf-gold` | `#E8B84B` | **ambre/or fonctionnel** — attente / mise en avant (≈ « orange = prépa » du brief) |
| `--cf-green` | `#1F8A5B` | **vert fonctionnel** — prêt / validé / positif |
| `--cf-line` | `rgba(28,22,18,0.16)` | filets |

#### Alias accent (remplaçable par tenant)

| Token | Valeur par défaut |
|---|---|
| `--cf-accent` | `var(--cf-red)` = `#C8281E` |
| `--cf-on-accent` | `#F4EEE1` |

#### Tokens sémantiques — thème clair (celui du POS)

| Token | Valeur |
|---|---|
| `--cf-bg` | `#F4EEE1` |
| `--cf-surface` | `#FBF8F1` |
| `--cf-surface-2` | `#EDE5D3` |
| `--cf-text` | `#1C1612` |
| `--cf-text-mut` | `#6E6354` |
| `--cf-border` | `rgba(28,22,18,0.16)` |
| `--cf-fill` | `#1C1612` (remplissage sombre fort : pills, boutons « ink », prix, barre haute) |
| `--cf-on-fill` | `#F4EEE1` |

#### Tokens sémantiques — thème sombre `[data-theme="dark"]` (utilisé par le KDS, pas par le POS)

`--cf-bg #17130F` · `--cf-surface #241C16` · `--cf-surface-2 #1F1813` · `--cf-text #F4EEE1` · `--cf-text-mut #A99E8D` · `--cf-border rgba(244,238,225,0.15)` · `--cf-fill #0E0B09` · `--cf-on-fill #F4EEE1` · ombres remplacées par `3px 3px 0 rgba(0,0,0,0.5)`, `5px 5px 0 rgba(0,0,0,0.5)`, carte `0 2px 0 rgba(0,0,0,0.35), 0 10px 26px rgba(0,0,0,0.4)`.

#### Rayons, densité, ombres

| Token | Valeur |
|---|---|
| `--cf-r` | `14px` (cartes) |
| `--cf-r-sm` | `9px` (inputs, prix) |
| `--cf-r-lg` | `22px` |
| `--cf-r-pill` | `999px` (boutons, chips, pills) |
| `--cf-u` / `--cf-u2` / `--cf-u3` | `16px` / `24px` / `32px` (unités d'espacement des helpers `cf-row`, `cf-between`) |
| `--cf-shadow` | `3px 3px 0 var(--cf-ink)` (ombre dure signature) |
| `--cf-shadow-2` | `5px 5px 0 var(--cf-ink)` |
| `--cf-shadow-accent` | `4px 4px 0 var(--cf-accent)` |
| `--cf-shadow-soft` | `0 10px 30px rgba(28,22,18,0.13)` |
| `--cf-shadow-card` | `0 2px 0 var(--cf-border), 0 8px 22px rgba(28,22,18,0.08)` |

#### Typographie (skin Class'Food)

| Token | Pile | Chargement démo |
|---|---|---|
| `--cf-disp` | `'Alfa Slab One', Georgia, serif` | Google Fonts |
| `--cf-body` | `'Archivo', system-ui, sans-serif` (graisses 400–900) | Google Fonts |
| `--cf-cond` | `'Barlow Condensed', 'Archivo', sans-serif` (graisses 400–700) | Google Fonts |

Classes typographiques :
- `.cf-disp` : display, `font-weight: 400`, `letter-spacing: .01em`, `text-transform: uppercase`, `line-height: .98`.
- `.cf-cond` : condensé (labels, corps compact).
- `.cf-eyebrow` : `--cf-body` 800, `11px`, `letter-spacing: .18em`, uppercase, couleur `--cf-text-mut`.
- `.cf-tabnums` : `font-variant-numeric: tabular-nums` (obligatoire sur tous les montants alignés).

### 3.2 Skin marque grise « Snack Manager » (`sm-skin.css`, chargé après `classfood-ds.css`)

La page `SM - Caisse (POS).html` démontre le **mode marque grise** : mêmes composants, tokens `--cf-*` remappés (le sélecteur couvre `:root, [data-theme="dark"], [data-theme="light"]` — le skin impose sa palette sombre neutre quel que soit le thème) :

| Token | Valeur SM |
|---|---|
| `--cf-bg` | `#000` |
| `--cf-surface` | `#111` |
| `--cf-surface-2` | `#1a1a1a` |
| `--cf-text` / `--cf-ink` | `#fff` |
| `--cf-text-mut` / `--cf-mut` | `#999` |
| `--cf-border` / `--cf-line` | `rgba(255,255,255,.1)` |
| `--cf-line-2` | `rgba(255,255,255,.06)` |
| `--cf-fill` / `--cf-on-fill` | `#1a1a1a` / `#fff` |
| `--cf-gold` | `#c9a15a` |
| `--cf-green` | `#3fae4a` |
| `--cf-red` | `#c94b3f` |
| `--cf-on-accent` | `#fff` |
| `--cf-r` / `--cf-r-sm` / `--cf-r-lg` | `16px` / `10px` / `20px` |
| Typo | `Inter` partout (`--cf-disp/--cf-body/--cf-cond`), display `font-weight: 600`, `letter-spacing: -.03em`, **sans** uppercase |

Le skin SM neutralise aussi les ombres dures (`box-shadow: none` sur les boutons), remplace le stepper/chips/inputs par des variantes sombres, et déclare en en-tête : *« Couleurs fonctionnelles fixes tous comptes : vert=prêt · rouge=nouveau/urgent · ambre=attente »*.

### 3.3 Règles de theming tenant

1. **Accent remplaçable** : `sm-brand.jsx` lit l'identité du restaurant (démo : `localStorage["sm-brand-id"]`, défaut `"greenhouse"`) et injecte `--cf-accent = brand.accent` et `--cf-on-accent = #ffffff` sur `document.documentElement`. Marques de démo :
   - Class'Food (Perriers-sur-Andelle) — accent `#C8281E`, initiale `C`, tél `09 84 36 49 76`
   - O'Braise (Rouen) — accent `#E0762F`, initiale `O`, tél `02 35 00 00 00`
   - Green House (Évreux) — accent `#2F9E62`, initiale `G`, tél `02 32 00 00 00`
2. **Logo marque grise** : `CFLogo` est remplacé par une tuile carrée `size × size` (défaut 44), `border-radius: round(size × 0.28)`, fond `var(--cf-accent)`, initiale de la marque en `--cf-body` 800, taille `size × 0.52`, blanc `#fff`. Variante `wordmark` : tuile + nom en `--cf-body` 800, `size × 0.5`, `letter-spacing: -0.02em`.
   (Le logo Class'Food d'origine — burger stylisé 64 × 46 : chapeau `--cf-ink`, barre `--cf-accent` `56×8 rx4`, barre `--cf-ink` `56×8 rx4`, anneau optionnel `border 3px --cf-ink` + `box-shadow 4px 4px 0 --cf-accent` — n'est utilisé que par la version non-marque-grise.)
3. **Couleurs fonctionnelles fixes, jamais tenant-isées** : `--cf-green` (prêt), `--cf-red` (alerte/nouveau/urgent), `--cf-gold` (ambre : attente/préparation). Elles ne doivent **pas** suivre l'accent du tenant.
4. **Tweaks par compte** (`cf-theme.js`) : lecture de `localStorage["cf-tweaks"]` (JSON `{ accent, radius, density }`) appliquée au chargement sur toutes les surfaces :
   - `accent` → `--cf-accent`
   - `radius` (nombre px) → `--cf-r = radius px`, `--cf-r-sm = max(4, radius − 5) px`, `--cf-r-lg = radius + 8 px`
   - `density` (nombre px) → `--cf-u = density px`, `--cf-u2 = round(density × 1.5) px` (`--cf-u3` non modifié)
   - API : `CFTheme.apply(t)`, `CFTheme.read()`, `CFTheme.save(t)` (merge + persist + apply). En production : stockage par tenant côté serveur — **à définir**.

---

## 4. Composants partagés (cf-ui / classfood-ds) et leurs états

### 4.1 `Icon`

SVG 24 × 24 en tracés `stroke` (`stroke-linecap/linejoin: round`), props : `name`, `size` (défaut 22), `stroke` (épaisseur, défaut 2), `color` (défaut `currentColor`), `fill` (défaut `none`). Icônes utilisées par le POS : `home`, `bag`, `phone`, `chart`, `star`, `burger`, `tacos`, `sandwich`, `chicken`, `dog`, `box`, `salad`, `dessert`, `drink`, `grid`, `close`, `clock`, `gear`, `ticket`, `euro`, `check`, `print`, `plus`, `fire`. (Tous les paths exacts sont dans `cf-helpers.js`, objet `ICON` ; icône inconnue → fallback `star`.)

### 4.2 `Btn` (`.cf-btn`)

Base : `inline-flex`, gap `9px`, `--cf-body` 800 `14px`, `letter-spacing .02em`, uppercase, padding `13px 20px`, `border-radius: 999px`, `transition: transform .12s ease, box-shadow .12s ease, filter .12s ease`. Icône gauche/droite optionnelle (18 px ; 15 px en `sm`).

| Variante | Fond / texte | Ombre | Hover | Utilisée pour |
|---|---|---|---|---|
| `primary` | `--cf-accent` / `--cf-on-accent` | `3px 3px 0 var(--cf-ink)` | `filter: brightness(1.05)` + `translateY(-1px)` | « Ajouter », « Valider l'encaissement », « Clôturer le service », « Nouvelle commande » |
| `ink` | `--cf-fill` / `--cf-on-fill` | `4px 4px 0 var(--cf-accent)` | `translateY(-1px)` | « Espèces », « CB » |
| `gold` | `--cf-gold` / `#1C1612` | `3px 3px 0 var(--cf-ink)` | — | « Payer au retrait » |
| `ghost` | transparent / `--cf-text`, bordure `2px solid var(--cf-text)`, padding `11px 18px` | — | fond `--cf-text`, texte `--cf-bg` (inversion) | « Imprimer le Z », « Ticket client » |

Tailles : `sm` = padding `9px 14px`, `12px` ; `lg` = `16px 26px`, `16px` ; `block` = pleine largeur.
États : **actif** (press) `translateY(1px)` ; **désactivé** `opacity: .4`, `cursor: not-allowed`, `box-shadow: none`.
Skin SM : uppercase supprimé, `font-weight 600`, hover `opacity: .85`, ombres supprimées.

### 4.3 `.cf-chip` (chip sélectionnable)

`--cf-cond` 600 `15px`, padding `7px 14px`, `border-radius 999px`, `border 1.5px solid var(--cf-border)`, fond `--cf-surface`, `transition: all .12s ease`, `user-select: none`.
États : **hover** `border-color: var(--cf-text)` ; **sélectionné** (`.is-on` ou `aria-pressed="true"`) fond `--cf-fill`, texte `--cf-on-fill`, bordure `--cf-fill` ; **quasi-désactivé** (viandes tacos au max) `opacity: .4` (le tap reste ignoré par la logique).

### 4.4 `.cf-input`, `.cf-select`

`--cf-body` `15px`, fond `--cf-surface`, `border 1.5px solid var(--cf-border)`, `border-radius 9px` (`--cf-r-sm`), padding par défaut `12px 14px` (le POS le resserre au cas par cas), `transition: border-color .12s, box-shadow .12s`.
**Focus** : `border-color: var(--cf-text)` + halo `0 0 0 3px color-mix(in srgb, var(--cf-accent) 22%, transparent)`. **Placeholder** : `color-mix(in srgb, var(--cf-text-mut) 75%, transparent)`. Focus clavier global : `:focus-visible { outline: 3px solid color-mix(in srgb, var(--cf-accent) 60%, transparent); outline-offset: 2px }`.

### 4.5 `Stepper` (`.cf-stepper`)

`inline-flex`, `border 2px solid var(--cf-text)`, `border-radius 999px`, fond `--cf-surface`, overflow hidden.
Boutons « − » / « + » : **36 × 36 px**, fond transparent, texte `--cf-text`, `font-size 20px`, `--cf-body` 800 ; **hover** fond `--cf-fill` texte `--cf-on-fill` ; `aria-label` `"Moins"` / `"Plus"`. Valeur : `min-width 30px`, centrée, `--cf-disp` `16px`, tabular-nums. Bornes : `min` (0 dans le ticket) et `max` 99 ; dans le ticket, atteindre 0 **supprime la ligne**.
⚠️ 36 px < 44 px : à agrandir en RN (voir §12).

### 4.6 `.cf-card`

Fond `--cf-surface`, `border 2px solid var(--cf-text)`, `border-radius 14px` (`--cf-r`), `box-shadow 3px 3px 0 var(--cf-ink)`, overflow hidden. Variantes `--soft` (bordure 1px `--cf-border`, `--cf-shadow-card`) et `--flat` non utilisées par le POS.

### 4.7 `.cf-iconbtn`

Bouton icône rond : défaut `40 × 40 px`, `border 2px solid var(--cf-border)`, fond `--cf-surface`, `transition: border-color .12s, background .12s` ; hover `border-color: var(--cf-text)`. Le POS l'utilise en **34 × 34 px** (boutons « Fermer » des modales, `aria-label="Fermer"`, icône `close` 16). ⚠️ < 44 px.

### 4.8 Toasts (`useToasts`)

Hôte : `position: fixed`, centré bas (`left: 50%`, `bottom: 24px`, `translateX(-50%)`), `z-index: 9000`, colonne, gap `8px`, `pointer-events: none`.
Toast : fond `--cf-ink`, texte `--cf-cream`, padding `12px 18px`, `border-radius 999px`, `--cf-body` 700 `14px`, `--cf-shadow-soft`, icône optionnelle 17 px couleur `--cf-gold`, animation d'entrée `cf-anim-pop`. **Auto-fermeture après 2200 ms** (paramétrable `opts.ms`). Pas d'animation de sortie (disparition sèche) — sortie animée **à définir**.

### 4.9 Animation `cf-pop`

`@keyframes cf-pop { 0% { transform: scale(.9); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }`, appliquée `. cf-anim-pop { animation: cf-pop .18s ease both }`. Utilisée par **toutes les modales/overlays** (V2–V5) et les toasts. La page hôte SM ajoute `@media (prefers-reduced-motion: reduce)` → animations/transitions à `.01ms` (à respecter en RN via le réglage système).

Autres primitives exportées (`Pill`, `Sticker`, `Price`, `Check`, `Head`, `Stars`, `BarChart`, `useElapsed`) : **non utilisées** par la surface POS.

---

## 5. Barre haute (zone A)

- Conteneur : `padding 10px 18px`, fond `var(--cf-fill)` (`#1C1612` en skin CF, `#1a1a1a` en skin SM), texte `var(--cf-on-fill)`, `flex-shrink: 0`, contenu réparti gauche/droite.
- **Gauche** (gap 12) :
  - Logo `CFLogo size={26}` (en marque grise : tuile accent 26 px + initiale).
  - Titre `Caisse` — `--cf-disp` `17px`, couleur `#f5f6f7`.
  - Sous-titre `Poste 1 · Le Gérant` — `--cf-cond` `13px`, `rgba(245,246,247,0.55)`. (Identité poste/utilisateur codée en dur — gestion réelle des postes et de la session vendeur : **à définir**.)
- **Droite** (gap 8) :
  - **Sélecteur de canal** — 3 boutons pilule, un par canal :

    | id | Label | Icône |
    |---|---|---|
    | `surplace` | `Sur place` | `home` |
    | `emporter` | `À emporter` | `bag` |
    | `tel` | `Téléphone` | `phone` |

    Style : gap interne 7, padding `8px 15px`, `border-radius 999px`, sans bordure, `--cf-body` 800 `13px` uppercase `letter-spacing .03em`, icône 15.
    **Actif** : fond `var(--cf-accent)`, texte `#fff`. **Inactif** : fond `rgba(244,238,225,0.1)`, texte `rgba(244,238,225,0.75)`. Sélection exclusive ; changer de canal **conserve** le ticket en cours (seul l'en-tête du ticket et le bloc client changent).
  - Séparateur vertical `1 × 24 px`, `rgba(255,255,255,0.14)`.
  - **Bouton clôture** : `Service · {n}` (n = nombre de commandes du jour, `dayLog.length`), icône `chart` 15, padding `8px 14px`, `border-radius 999px`, `border 1px solid rgba(255,255,255,0.18)`, fond transparent, texte `rgba(255,255,255,0.75)`, `--cf-body` 700 `13px`. Tap → ouvre V4.

⚠️ Hauteur tactile de ces pilules ≈ 31–34 px : à porter à ≥ 44 px en RN.

---

## 6. Rail catégories (zone B)

- Largeur **108 px**, fond `var(--cf-surface-2)`, padding `10px 8px`, colonne gap `6px`, scroll vertical (scrollbar fine 8 px, pouce `--cf-border`).
- Un bouton par catégorie : colonne centrée, gap 4, padding `10px 4px`, `border-radius 10px`, sans bordure.
  - **Actif** : fond `var(--cf-fill)`, texte `var(--cf-on-fill)`, icône `stroke 2.2`.
  - **Inactif** : fond transparent, texte `var(--cf-text-mut)`, icône `stroke 1.8`.
  - Icône 22 px ; label `--cf-cond` `11.5px` 700, `line-height 1.05`, centré.
- **Label raccourci** : le titre de catégorie est nettoyé des préfixes `"Compose ton "`, `"Les "`, `"Gourmets "` et du suffixe `" à Partager"`.
- Catégorie par défaut au lancement : la **première** (`signatures`). Sélectionner une catégorie remplace la grille (la recherche active, elle, est prioritaire sur la catégorie).

### 6.1 Liste exacte des catégories (ordre d'affichage)

| # | id | Titre complet | Label rail | Icône | Nb produits |
|---|---|---|---|---|---|
| 1 | `signatures` | Les Signatures | Signatures | `star` | 7 |
| 2 | `burgers` | Gourmets Burgers | Burgers | `burger` | 8 |
| 3 | `tacos` | Compose ton Tacos | Tacos | `tacos` | 1 (produit configurable) |
| 4 | `classiques` | Les Classiques | Classiques | `burger` | 12 |
| 5 | `sandwichs` | Sandwichs | Sandwichs | `sandwich` | 24 |
| 6 | `crousty` | Crousty One | Crousty One | `chicken` | 2 |
| 7 | `hotdogs` | Hot Dogs | Hot Dogs | `dog` | 3 |
| 8 | `boxes` | Box à Partager | Box | `box` | 5 |
| 9 | `texmex` | Tex-Mex | Tex-Mex | `chicken` | 7 |
| 10 | `assiettes` | Assiettes & Bun's | Assiettes & Bun's | `sandwich` | 9 |
| 11 | `salades` | Salades | Salades | `salad` | 5 |
| 12 | `paninis` | Paninis | Paninis | `sandwich` | 3 |
| 13 | `enfant` | Menu Enfant | Menu Enfant | `star` | 1 |
| 14 | `desserts` | Desserts & Glaces | Desserts & Glaces | `dessert` | 9 |
| 15 | `boissons` | Boissons | Boissons | `drink` | 8 |

Le détail produit par produit (noms, prix, variantes) est au §11.2.

---

## 7. Zone produits (zone C)

### 7.1 Champ de recherche

- Conteneur `position: relative`, `margin-bottom 12px`.
- Input `.cf-input`, placeholder **`Rechercher un produit…`**, padding `10px 14px 10px 38px`, `font-size 14px`.
- Icône décorative à gauche : `grid` 16 px (⚠️ la maquette utilise l'icône `grid` et non `search`), position `left 12 / top 11`, couleur `--cf-text-mut`.
- **Bouton effacer** (visible seulement si saisie non vide) : icône `close` 16 px, position `right 10 / top 9`, sans fond ni bordure.
- **Comportement** : filtrage instantané à chaque frappe, insensible à la casse, `name.includes(query)` sur **tous** les produits de **toutes** les catégories, résultats plafonnés à **12**. Quand une recherche est active, la grille affiche les résultats à la place de la catégorie courante. Aucun état « aucun résultat » n'est prévu (grille vide) — copy d'état vide de recherche : **à définir**. Recherche sans accents/synonymes : **à définir**.

### 7.2 Rangée « tickets en attente » (visible si ≥ 1 ticket parqué)

- Rangée wrap, gap 8, `margin-bottom 12px`, au-dessus de la grille.
- Chip par ticket : gap 8, padding `8px 13px`, `border-radius 999px`, **`border: 1px dashed var(--cf-gold)`**, fond `color-mix(in srgb, var(--cf-gold) 10%, transparent)`, icône `clock` 14 px couleur `--cf-gold`, label `--cf-cond` `13px` 700 :
  `"{custName ou libellé du canal} · {nbArticles} art. · {total formaté}"` (total = Σ unit × qty, **hors remise**).
- Tap → **rappel** du ticket (voir §10.3).

### 7.3 Grille produits

- `display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px` — **4 colonnes** fixes.
- **Carte produit** (bouton) : `text-align: left`, fond `--cf-surface`, `border 1.5px solid var(--cf-border)`, `border-radius 12px`, padding `12px 12px 10px`, `min-height 92px`, colonne ; `transition: border-color .1s, transform .08s`.
  - Ligne haute (`space-between`, gap 6, align flex-start) : **nom** `--cf-cond` gras `15px` `line-height 1.1` + icône `gear` 14 px `--cf-text-mut` (indique que le tap ouvre la config express).
  - Bas (poussé par `margin-top: auto`, `padding-top 8px`) : **prix** `--cf-disp` `15px` couleur `--cf-accent` au format `12,50 €` ; si produit à variantes (`fromPrice`), suffixe **`dès`** en `--cf-cond` `11px` `--cf-text-mut` (⚠️ dans la maquette le mot « dès » est affiché *après* le prix).
  - États :
    - **normal** : ci-dessus ;
    - **press** : `transform: scale(0.97)` posé au `mousedown`/`touchstart`, retiré au relâchement ou à la sortie ;
    - **indisponible** (`available: false`, c.-à-d. prix non numérique dans le catalogue) : `opacity: .45`, `cursor: not-allowed`, prix remplacé par le texte **`à définir`**, tap ignoré ;
    - hover : aucun style dédié (seule la transition `border-color` existe, sans règle hover effective) ;
    - chargement/erreur de la grille : **à définir** (catalogue embarqué en dur dans la maquette).
  - Les badges du catalogue (`Nouveau`, `Mega Burger`, `1+1`, `La plus grosse`, `+ Surprise`) et les descriptions **ne sont pas affichés** sur les cartes POS (ils existent dans les données ; affichage caisse : à définir).
- **Tap sur une carte disponible → ouvre systématiquement la config express (V2)**, y compris pour les produits simples (commentaire source : « chaque produit passe par la config express »).

---

## 8. Panneau ticket (zone D)

### 8.1 En-tête du ticket

- `padding 12px 16px`, `border-bottom 1px solid var(--cf-border)`.
- Titre : **`Ticket · {label du canal}`** (`Sur place` / `À emporter` / `Téléphone`) — `--cf-disp` `16px`.
- Actions à droite (gap 10), **visibles seulement si le ticket contient ≥ 1 ligne** — boutons texte sans fond ni bordure, `--cf-cond` 700 `13px` :
  - **`En attente`** — couleur `--cf-gold` ; met le ticket en attente (§10.3).
  - **`Vider`** — couleur `--cf-accent` ; vide les lignes **et** remet la remise à 0 (sans confirmation — confirmation destructive : **à définir**). Ne réinitialise ni nom/téléphone client ni note.

### 8.2 Bloc client (uniquement si canal = `tel`)

- `padding 10px 16px`, `border-bottom 1px solid var(--cf-border)`, colonne gap 8.
- Champ **`Nom du client *`** (`.cf-input`, padding `9px 12px`, `font-size 14`).
- Rangée gap 8 :
  - Champ **`Téléphone *`** (`.cf-input`, `inputMode="tel"`, padding `9px 12px`, `font-size 14`, `flex: 1`).
  - Sélecteur d'**heure de retrait** (`.cf-select`, largeur `110px`, padding `9px 8px`, `font-size 14`) — valeur par défaut `""` affichée **`~15 min`** (retrait « dès que possible ») ; options fixes : `12:15`, `12:30`, `12:45`, `13:00`, `19:00`, `19:30`, `20:00`. Créneaux dynamiques selon horaires/charge réels : **à définir**.
- **Validation** : l'envoi requiert `nom non vide` **et** `téléphone ≥ 8 caractères` (après trim). Aucun masque/format de saisie téléphone : à définir.

### 8.3 Corps — lignes du ticket (scrollable, `padding 8px 16px`)

- **État vide** : bloc centré `padding 60px 20px`, couleur `--cf-text-mut` ; icône `ticket` 40 px `stroke 1.3` couleur `--cf-border` ; texte `--cf-cond` `15px` sur deux lignes :
  `Tape un produit pour` / `démarrer la commande`.
- **Ligne de commande** : rangée gap 10, `padding 9px 0`, `border-bottom 1px solid var(--cf-border)`, align flex-start.
  - Colonne gauche (`flex: 1`) :
    - **Nom** — `--cf-cond` gras `15px`, `line-height 1.1` (ex. `Tacos L` si nom surchargé par la config).
    - **Options** (`optLabel`, si présent) — `--cf-cond` `12.5px` `--cf-text-mut`, `line-height 1.2` (ex. `L · Kebab, Poulet · ST, SO · Gratiné · Algérienne · Menu frites+boisson`).
    - **Prix unitaire** — `"{unit} / u"` (ex. `12,40 € / u`) — `12.5px` `--cf-text-mut`.
  - Colonne droite (align-end, gap 5) :
    - **Total ligne** `unit × qty` — `--cf-cond` gras tabular `15px`.
    - **Stepper** quantité (§4.5) ; `min = 0` : décrémenter à 0 **supprime la ligne** (pas de confirmation ; pas de swipe-pour-supprimer — geste RN : à définir).
- **Agrégation** : à l'ajout, une ligne dont la clé `nom|options|prixUnitaire` existe déjà voit sa **quantité incrémentée** au lieu de créer un doublon.
- **Note cuisine** (visible si ≥ 1 ligne, en bas de la liste) : `.cf-input`, placeholder **`Note cuisine (sans oignons…)`**, `margin-top 10px`, padding `9px 12px`, `font-size 14`. Une seule note par ticket (note par ligne : à définir).

### 8.4 Pied du ticket (fixe)

`padding 12px 16px 16px`, **`border-top 2px solid var(--cf-text)`**, fond `var(--cf-surface-2)`.

1. **Rangée remise** (si ≥ 1 ligne) : label `Remise` (`--cf-cond` `13px` `--cf-text-mut`) ; 3 chips à droite (gap 6, `font-size 12`, padding `4px 10px`) : **`Aucune`**, **`−5 %`**, **`−10 %`** (valeurs 0/5/10, sélection exclusive). Style sélectionné dans la maquette : fond `var(--cf-surface)`, texte `#fff`, bordure `rgba(255,255,255,0.5)` — ⚠️ lisible sur le skin SM sombre mais **incohérent sur le skin clair** (texte blanc sur crème) ; à corriger en production (état sélectionné standard `.is-on` recommandé — à définir). Remise libre (montant/%, code) : à définir.
2. **Rangée « VENTE + »** (vente additionnelle) — affichée si ≥ 1 ligne **et** qu'aucune ligne ne matche la regex `/tiramisu|milkshake|freez|coca|oasis|dessert|boisson|33cl|tarte/i` :
   - étiquette **`VENTE +`** — `--cf-cond` `11px` 800, couleur `--cf-gold`, `letter-spacing .06em` ;
   - chip **`+ Coca 33cl · 3,00 €`** → ajoute la ligne `Coca 33cl`, `unit = 3.00`, sans options (⚠️ prix codé en dur, différent du catalogue boissons « Canette 33 cl » à 1,50 € — à réconcilier) ;
   - chip **`+ Tiramisu · 3,50 €`** → ajoute `Tiramisu`, `unit = 3.50`.
   - `font-size 12.5`. Suggestions dynamiques : à définir.
3. **Rangée récap remise** (si remise > 0) : gauche `Sous-total {subtotal} · remise −{d} %` (`13px` `--cf-text-mut`) ; droite `−{montantRemise}` (`13px`, **couleur `--cf-green`**, tabular).
4. **Rangée total** (`margin-bottom 10px`) : gauche **`Total`** `--cf-disp` `17px` + suffixe `· {count} art.` (`--cf-cond` `13px` `--cf-text-mut`) ; droite **montant total** `--cf-disp` **`26px`** couleur `--cf-accent`.
5. **Rangée paiement** (gap 8) — tous désactivés tant que `canSend` est faux :
   - **`Espèces`** — `Btn` variant `ink` `sm`, icône `euro`, `flex: 1` → ouvre V3 ;
   - **`CB`** — `Btn` variant `ink` `sm`, icône `check`, `flex: 1` → `send(paid: true, mode: "CB")` immédiat (aucune intégration TPE — à définir) ;
   - **`Payer au retrait`** — **seulement si canal = `tel`** — `Btn` variant `gold` `sm`, icône `clock`, `flex: 1.2` → `send(paid: false, mode: "retrait")`.
   - `canSend = (≥ 1 ligne) ET (canal ≠ tel OU (nom rempli ET téléphone ≥ 8 car.))`.
6. Bouton vestigial masqué (`display: none`) : `Envoyer en cuisine` (`primary`, block, icône `fire`) — reliquat d'un flux antérieur avec état `payMode` jamais alimenté ; **ne pas implémenter**, l'envoi en cuisine est déclenché par les boutons de paiement.
7. **Message de validation** (si canal tel, ≥ 1 ligne et `canSend` faux) : **`Nom + téléphone requis pour une commande téléphone`** — `12.5px`, couleur `--cf-accent`, centré, `margin 8px 0 0`.

### 8.5 Calculs

```
subtotal    = Σ (unit × qty)
discountEur = subtotal × discount / 100        (discount ∈ {0, 5, 10})
total       = subtotal − discountEur
count       = Σ qty
```
Format monétaire : `fmtEuro(n)` → 2 décimales, virgule décimale, suffixe ` €` (option `bare` sans suffixe) ; valeur nulle/NaN → `—`. TVA/HT-TTC : **absents de la maquette — à définir**.

---

## 9. Config express produit (V2 — `QuickConfig`)

### 9.1 Enveloppe

- Overlay `position: absolute; inset: 0`, `z-index 70`, contenu centré (`grid place-items center`) — couvre rail + grille + ticket, pas la barre haute.
- Fond cliquable (ferme sans ajouter) : `rgba(28,22,18,0.45)`.
- Carte : `.cf-card` + `cf-anim-pop` (pop 180 ms), **largeur 520 px**, `max-height 88%`, scroll interne, `padding 22px`.
- En-tête : **nom du produit** `--cf-disp` `20px` + bouton fermer `.cf-iconbtn` 34 × 34, icône `close` 16, `aria-label="Fermer"`.

### 9.2 Sections conditionnelles (dans cet ordre)

Drapeaux calculés depuis le produit :

| Drapeau | Condition | Catégories concernées |
|---|---|---|
| `isTacos` | `customizer === "tacos"` | le produit « Tacos sur-mesure » |
| `hasRecette` | catégorie ∈ `CRUDITE_CATS` | `signatures`, `burgers`, `classiques`, `sandwichs`, `hotdogs`, `assiettes`, `tacos` |
| `hasSauces` | `hasRecette` OU `isTacos` OU catégorie = `texmex` | + `texmex` |
| `menuEligible` | catégorie ∈ | `signatures`, `burgers`, `classiques`, `sandwichs`, `hotdogs`, `crousty`, `tacos` |

Un produit sans aucun drapeau ni tailles (boisson, dessert simple, box, salade, panini…) affiche une modale réduite : titre + bouton **`Ajouter · {prix}`** (confirmation en 1 tap).

1. **Tailles** (si le produit a des `sizes`, ou tacos) — rangée wrap gap 8 :
   - chips `.cf-chip`, police `--cf-disp` `15px`, padding `9px 16px`, libellé **`{label} · {prix bare}€`** (ex. `L · 9,90€`) ; sélection exclusive (`.is-on`).
   - défaut : indice **0**, sauf tacos : indice **1** (taille **L** présélectionnée).
   - tacos : changer de taille **tronque** la sélection de viandes à la nouvelle limite (`viandes.slice(0, i+1)`). Le descriptif de taille (`1 viande`…) existe dans les données mais n'est pas affiché dans la chip.
2. **Viandes** (tacos uniquement) :
   - eyebrow **`Viandes · {n}/{max}`** (`11px`) — `max = indiceTaille + 1` (M→1, L→2, XL→3, XXL→4) ;
   - chips wrap gap 7, multi-sélection plafonnée à `max` ; chips non sélectionnées quand le plafond est atteint : `opacity: .4`, tap ignoré ;
   - 10 viandes : `Kebab`, `Steak`, `Kefta`, `Poulet`, `Tikka`, `Tandoori`, `Cordon bleu`, `Nuggets`, `Merguez`, `Tenders`.
3. **Gratiné** (tacos uniquement) — case à cocher `18 × 18 px`, `accent-color: var(--cf-accent)` ; libellé `--cf-cond` `16px` : **`Gratiné`** + **`+1,50 €`** (tailles M/L, indices 0–1) ou **`+2,00 €`** (XL/XXL) en gras couleur `--cf-accent`. Ajoute 1,50 / 2,00 au prix unitaire.
4. **Recette** (modificateurs express, si `hasRecette` ou tacos) — eyebrow **`Recette`** ; rangée wrap gap 6 :
   - chip **`Complet`** (`font-weight 700`) : sélectionnée quand aucun modificateur ; tap → vide la sélection ;
   - 5 chips modificateurs (multi-sélection libre), padding `6px 11px`, gap interne 5, contenu = **code** en `--cf-disp` `13px` gras + libellé raccourci (`"Sans "` → `"s. "`) en `12.5px` :

     | Code | Libellé complet | Affiché dans la chip |
     |---|---|---|
     | `ST` | Sans tomates | `ST` `s. tomates` |
     | `SO` | Sans oignons | `SO` `s. oignons` |
     | `SSA` | Sans salade | `SSA` `s. salade` |
     | `SC` | Sans crudités | `SC` `s. crudités` |
     | `SCO` | Sans cornichons | `SCO` `s. cornichons` |
5. **Sauces** (si `hasSauces`) — eyebrow **`Sauces`** ; chips `13px`, padding `5px 11px`, multi-sélection **sans plafond** (limite de sauces gratuites : à définir) :
   `Ketchup`, `Mayonnaise`, `Samouraï`, `Andalouse`, `Poivre`, `Biggy`, `Blanche maison`, `Harissa`, `Cheesy`, `Moutarde`, `Algérienne` (11 sauces).
6. **Menu** (si `menuEligible`) — case à cocher `18 × 18` accent ; libellé `--cf-cond` `16px` : **`Menu frites + boisson`** + **`+2,50 €`** en gras accent. Ajoute 2,50. (Choix de la boisson du menu : non prévu — à définir.)
7. **CTA** — `Btn` `primary` `block` :
   - actif : **`Ajouter · {prixUnitaire}`** (ex. `Ajouter · 14,90 €`) ;
   - désactivé (tacos avec viandes incomplètes) : **`Choisis {max} viande`** / **`Choisis {max} viandes`** (pluriel si max > 1).

### 9.3 Prix unitaire & ligne produite

```
base = prix de la taille sélectionnée (ou prix produit si pas de tailles)
unit = base + (gratiné ? (taille M/L ? 1.50 : 2.00) : 0) + (menu ? 2.50 : 0)
```
`optLabel` = concaténation **` · `** dans l'ordre : label taille → viandes (`", "`) → libellés complets des modificateurs (`", "`) → `Gratiné` → sauces (`", "`) → `Menu frites+boisson`.
Nom de ligne : nom du produit, **sauf tacos** → **`Tacos {taille}`** (ex. `Tacos XL`).
⚠️ Les **suppléments tacos** du catalogue (`supp100` +1,00 € : Cheddar, Chèvre, Bleu, Boursin, Miel, Œuf, Reblochon, Raclette, Camembert ; `supp150` +1,50 € : Lardons, Bacon, Jambon de dinde, Chorizo ; `supp080` +0,80 € : Champignons, Avocat, Poivrons, Aubergine, Oignons frits) **ne sont pas exposés** dans la config express caisse — à définir s'ils doivent l'être.

---

## 10. Flux de commande

### 10.1 Envoi en cuisine (`send(paid, mode)`)

Déclenché par : `CB` (`paid=true, mode="CB"`), validation espèces (`paid=true, mode="espèces"`), `Payer au retrait` (`paid=false, mode="retrait"`).

1. Génère le **numéro d'appel** : `no = 44 + entier aléatoire [0..19]` (⚠️ mock — séquence réelle par service : **à définir**).
2. Affiche V5 avec `{ no, paid, mode, total, channel }`.
3. Ajoute au **journal du service** `dayLog` : `{ no, paid, mode, total, channel, at: Date.now() }` (⚠️ le détail des lignes n'est pas journalisé dans la maquette ; en production la commande complète doit être persistée, voir §13).
4. **Réinitialise** : lignes, nom, téléphone, créneau, note, mode de paiement, modale espèces, remise.

**Confirmation (V5)** — overlay `z-index 80`, fond `rgba(28,22,18,0.5)` (tap = fermer), carte `.cf-card` pop, **420 px**, `padding 28px`, centrée :
- pastille ronde **64 × 64**, fond `--cf-green`, icône `fire` 32 px blanche ;
- titre **`Envoyée en cuisine !`** `--cf-disp` `22px` ;
- **`N° {no}`** `--cf-disp` **`54px`** couleur `--cf-accent` ;
- ligne info `--cf-cond` `15px` `--cf-text-mut` : `{label canal} · {total} · ` + (`Payé (CB)` / `Payé (espèces)` — ou **`À encaisser au retrait`** si non payé) ;
- ligne `13.5px` : **`Ticket cuisine imprimé · visible sur le KDS`** (⚠️ aucune impression réelle dans la maquette — voir §12) ;
- boutons (gap 10) : **`Ticket client`** (`ghost` `sm`, icône `print`, ferme seulement) · **`Nouvelle commande`** (`primary` `sm`, icône `plus`, ferme).

### 10.2 Encaissement espèces (V3 — `CashModal`)

Overlay `z-index 70`, fond `rgba(28,22,18,0.45)` (tap = fermer sans encaisser), carte pop **420 px**, `padding 22px` :
- titre **`Encaissement espèces`** `--cf-disp` `20px` ;
- sous-titre `--cf-cond` `15px` `--cf-text-mut` : **`Total à encaisser : {total}`** (montant en gras couleur `--cf-text`) ;
- rangée de chips (gap 8) :
  - **`+5 €`**, **`+10 €`**, **`+20 €`**, **`+50 €`** — police `--cf-disp` `16px`, padding `10px 18px` — chaque tap **additionne** la coupure au montant reçu (cumulable) ;
  - **`Appoint {montantArrondi}`** (`14px`) — fixe le reçu à `ceil(total)` (ex. total 23,40 € → `Appoint 24,00 €`) ;
  - **`↺`** (`14px`) — remet le reçu à 0. (Saisie libre au pavé numérique : absente — à définir.)
- ligne **Reçu** : fond `--cf-surface-2`, `border-radius 12px`, padding `12px 16px` ; label `--cf-cond` `15px` ; montant `--cf-disp` `24px` ;
- ligne **rendu** : même géométrie ; si `reçu − total ≥ 0` → fond `color-mix(in srgb, var(--cf-green) 14%, var(--cf-surface))`, label **`À rendre`**, montant `--cf-disp` `24px` couleur `--cf-green` ; sinon fond `--cf-surface-2`, label **`Reste dû`**, montant couleur `--cf-accent` ; le montant affiché est la **valeur absolue** de la différence ;
- CTA **`Valider l'encaissement`** — `primary` block icône `check`, **désactivé tant que reçu < total** → `send(true, "espèces")`.

### 10.3 Tickets en attente (park / recall)

- **Mise en attente** (`En attente` dans l'en-tête du ticket) : crée `{ id: "P" + 4 caractères alphanum. majuscules, lines, channel, custName, custPhone, note, at }`, vide le ticket courant (lignes, nom, téléphone, note, remise) et pousse le toast **`Ticket mis en attente`** (icône `clock`). ⚠️ Le **créneau de retrait** (`slot`) et la **remise** ne sont **pas** conservés dans le ticket parqué — à corriger/définir en production.
- **Rappel** (tap sur un chip §7.2) :
  - si le ticket courant contient des lignes → refus + toast **`Termine ou mets en attente le ticket en cours`** (icône `close`) ;
  - sinon → restaure lignes, canal, nom, téléphone, note, et retire le ticket de la liste d'attente.
- Persistance des tickets parqués (redémarrage, multi-poste) : **à définir** (état mémoire uniquement dans la maquette).

### 10.4 Clôture de service (V4 — `CloseModal`, « Z »)

Overlay `z-index 70`, fond **`rgba(0,0,0,0.55)`** (tap = fermer), carte pop **460 px**, `padding 24px` :
- titre **`Clôture de service`** `--cf-disp` `20px` + bouton fermer 34 × 34 (`aria-label="Fermer"`) ;
- sous-titre `14px` `--cf-text-mut` : **`{n} commande{s} ce service · poste 1`** (pluriel si n > 1) ;
- **Chiffre d'affaires** : rangée fond `--cf-surface-2`, `border-radius 12px`, padding `14px 16px` ; label `--cf-cond` `15px` **`Chiffre d'affaires`** ; montant `--cf-disp` tabular **`26px`** couleur `--cf-accent` = **somme de tous les totaux du journal** (⚠️ inclut les commandes « à encaisser au retrait » non payées — règle comptable réelle : à définir) ;
- 3 rangées de ventilation (padding `9px 4px`, `border-bottom 1px solid var(--cf-line-2)` — ⚠️ token défini uniquement par le skin SM (`rgba(255,255,255,.06)`), **absent** de `classfood-ds.css` : à ajouter au DS) ; label `14px` `--cf-text-mut`, montant gras tabular `15px` :
  - **`CB`** = Σ totaux `mode === "CB"`
  - **`Espèces`** = Σ totaux `mode === "espèces"`
  - **`À encaisser au retrait`** = Σ totaux des commandes `paid === false`
- ligne compteurs par canal (padding `9px 4px 2px`, `13px` `--cf-text-mut`) : **`Sur place {a} · À emporter {b} · Téléphone {c}`** (nombres de commandes) ;
- boutons (`margin-top 18px`, gap 10) :
  - **`Imprimer le Z`** — `ghost` `sm` icône `print`, `flex: 1` — dans la maquette ferme simplement la modale (aucune impression) ;
  - **`Clôturer le service`** — `primary` `sm` icône `check`, `flex: 1` — **vide le journal** (`dayLog = []`), ferme, toast **`Service clôturé — Z imprimé`** (icône `check`).
- Fond de caisse, écarts espèces, comptage, archivage du Z, ré-ouverture : **à définir**.

---

## 11. Données

### 11.1 Modèle produit (issu de `cf-helpers.js`, fabrique `P()`)

```
{
  id: "p{n}"            // séquentiel à la construction du catalogue (mock)
  name: string
  price: number|null    // null si prix non numérique → indisponible
  priceStr: string      // prix source "9,50"
  desc: string
  badges: string[]      // ["Nouveau"] si isNew, sinon [tag] éventuel
  icon: string          // nom d'icône
  available: boolean    // false si prix invalide ou available:false explicite
  customizer: "tacos"|null
  cat: string           // id de catégorie
  allergens: string     // libellé par famille (voir ci-dessous)
  popular: boolean
  fromPrice?: true      // produit à variantes → affiche "dès"
  sizes?: [{ label, p }]// variantes de taille/format
}
```

Allergènes par famille (info INCO générique, non affichée en caisse) : burgers/signatures `Gluten, lait, œuf, sésame` · classiques/crousty/boxes/texmex/enfant `Gluten, lait, œuf` · sandwichs/tacos/assiettes/paninis `Gluten, lait` · hotdogs `Gluten, lait, moutarde` · salades `Lait, œuf, poisson selon recette` · desserts `Gluten, lait, œuf, fruits à coque`.

### 11.2 Catalogue exact (seed de référence, prix TTC en €)

- **Signatures** (toutes `popular`) : Le Boss 13,50 · Le Bo Goss 12,50 · Bling Bling 12,50 · Egg 180 11,90 · **Le Smash** dès 9,50 (tailles : Simple 9,50 / Double 12,50 / Triple 14,90) · Le Smash Chicken 9,50 · Le Double Kif 16,90 (badge `1+1`).
- **Gourmets Burgers** : Le Classic 9,50 · Le Crousty 12,50 · Le Chèvre Miel 12,50 · Le Gourmet 12,50 · Le Montagnard 12,50 · Le Red 12,50 (Nouveau) · Le Black 12,50 (Nouveau) · Le King 14,90.
- **Tacos** : « Tacos sur-mesure » dès 8,90, `customizer: "tacos"`, desc `Choisis taille, viandes, sauces & suppléments`. Tailles : **M** 1 viande 8,90 · **L** 2 viandes 9,90 · **XL** 3 viandes 12,50 · **XXL** 4 viandes 14,50. Gratiné : +1,50 (M/L) / +2,00 (XL/XXL).
- **Les Classiques** : Cheese 5,50 · Double Cheese 7,00 · Triple Cheese 8,00 · Chicken 7,50 · Fish 7,50 · Veggi 7,50 · Texan 9,50 · Farci 9,50 · Country 9,50 · Le 180 9,50 · Le 360 13,00 · Le 540 16,00 (badges `Mega Burger` sur les 3 derniers).
- **Sandwichs** (24) : Kebab 7,50 · Végétarien 7,50 · Merguez 7,50 · 2 Steaks 7,90 · 3 Steaks 8,90 · 4 Steaks 9,90 · Kebab Fromage 8,50 · Chèvre Miel 9,50 · Kefta 9,50 · Tikka 9,50 · Tandoori 9,50 (Nouveau) · Le Boursin 9,50 (Nouveau) · Escalope Normande 9,90 (Nouveau) · Spécial 9,90 · Radical 9,90 · Duo 9,50 · Mexicain 9,50 · Suprême 9,50 · Buffalo 9,50 · Royal 9,50 · Beldi 9,50 · Maxi Kebab 9,90 · Galette 4 Fromages 9,90 (Nouveau) · Galette Burrata 11,00 (Nouveau).
- **Crousty One** : Crousty One — Riz 9,50 · Crousty One — Pâtes ou Nouilles 9,50 (tous deux `popular`).
- **Hot Dogs** : Le Class Dog 6,90 · Le Royal Dog 8,90 · Le Cheese Dog 7,50.
- **Box à Partager** : Box Menu Solo 9,90 · Mix Box 1 21,90 · Mix Box 2 26,90 · Family Box 42,90 (`popular`) · Family Big Box 53,50 (badge `La plus grosse`).
- **Tex-Mex** (chaque produit : tailles `5 pcs` / `10 pcs`, desc `5 pièces · 10 pcs {prix} €`) : Nuggets 6,00/11,00 · Wings 6,00/11,00 · Mozza sticks 6,00/11,00 · Tenders 7,50/14,00 · Jalapeños 6,50/12,00 · Samoussa 7,50/14,00 · Nems 7,50/14,00.
- **Assiettes & Bun's** : Assiette M 12,00 · Assiette L 14,50 · Assiette XL 17,00 · Bun's M 8,90 · Bun's L 9,90 · Hummer H1 7,90 · Hummer H2 9,90 · Hummer H3 12,00 · Hummer H4 14,90 (Nouveau) (desc Hummer suffixée ` · cheddar, frites`).
- **Salades** (toutes 7,50) : César · Océane · Lyonnaise · Normande (Nouveau) · Andelloise (Nouveau).
- **Paninis** : Panini Au choix 7,00 · Panini 3 fromages 6,50 · Panini Nutella 4,50 (desc `Le goûter réconfort`).
- **Menu Enfant** : 7,50 (badge `+ Surprise`), desc `Au choix : cheeseburger, 5 nuggets, kebab ou mini tacos — frites + Capri-Sun ou compote`.
- **Desserts & Glaces** : Tarte au Daim 3,50 · Cheesecake 3,50 · Tiramisu 3,50 · Fondant chocolat 3,50 · Glace Pot 100 ml 3,50 · Glace Pot 500 ml 8,00 · Glace Chocobon 3,90 · Milkshake Nature, vanille, fraise dès 3,50 (Normal 3,50 / XL 5,90) · Milkshake Oréo ou Bueno dès 4,00 (Normal 4,00 / XL 6,90).
- **Boissons** : Canette 33 cl 1,50 · Bouteille 50 cl 2,50 · Bouteille 1,5 L 3,50 · Bouteille 2 L 3,90 · Red Bull 3,00 · Monster 3,50 · Freez 3,00 · Thé / Café 1,50.

⚠️ Présents dans `menu-data.js` mais **absents du catalogue caisse** (à arbitrer) : Class Bowl (Veggi 7,90 / 1 viande 9,50 / 2-3 viandes 12,50) ; Assiette Class'Food 19,90 ; Barquettes (Frites M 3,50/L 4,50, Frites cheddar 4,50/5,50, cheddar-lardons 5,50/6,50, Viande 9,00/11,00) ; Pain Suédois 9,90 ; Tex-Mex solo (Beignets de calamar et Onion rings 10 pcs 6,50 / 20 pcs 13,00) ; supplément frites paninis +1,50.

### 11.3 État local de la vue (à transposer)

| État | Type / défaut | Rôle |
|---|---|---|
| `catId` | id catégorie, défaut `"signatures"` | catégorie affichée |
| `lines` | `[{ key, id, name, unit, optLabel, qty }]` | lignes du ticket |
| `channel` | `"surplace"` \| `"emporter"` \| `"tel"`, défaut `"surplace"` | canal |
| `config` | produit ou `null` | modale V2 ouverte |
| `cash` | bool | modale V3 ouverte |
| `custName`, `custPhone`, `slot`, `note` | strings | infos client tel + note cuisine |
| `sent` | `{ no, paid, mode, total, channel }` ou `null` | overlay V5 |
| `query` | string | recherche |
| `discount` | 0 \| 5 \| 10 | remise % |
| `parked` | tickets parqués (§10.3) | attente |
| `dayLog` | `[{ no, paid, mode, total, channel, at }]` | journal du service |
| `closing` | bool | modale V4 ouverte |
| `payMode` | vestige, toujours `null` | ne pas porter |

### 11.4 Lectures / écritures par vue → conception API & MongoDB

Ce que chaque vue **lit** et **écrit** (la maquette fait tout en mémoire ; les endpoints/collections ci-dessous sont une **proposition dérivée** de ces besoins, à valider) :

| Vue | Lit | Écrit |
|---|---|---|
| V1 grille/rail/recherche | catalogue du tenant : catégories ordonnées (id, titre, icône) + produits (nom, prix, tailles, `available`, `customizer`, `cat`) ; tickets parqués | — |
| V1 ticket | lignes en cours, remise, canal, infos client | lignes (ajout/quantité/suppression), note, remise, canal, nom/tél/créneau |
| V2 config express | règles de personnalisation : tailles+prix, viandes tacos + plafond par taille, prix gratiné par taille, `MODS`, `SAUCES`, prix menu (+2,50), appartenance catégorie→drapeaux | une ligne de ticket (unit, optLabel, nameOverride) |
| V3 espèces | total | encaissement (mode `espèces`, montants reçu/rendu — ⚠️ non journalisés dans la maquette : à définir) |
| V5 envoi | — | **commande** : `{ no, channel, paid, mode, total, at }` + (en prod) lignes, client, créneau, note, remise |
| Park/recall | liste des tickets parqués | création/suppression d'un ticket parqué |
| V4 clôture | journal du service : totaux par mode, impayés, compteurs par canal | remise à zéro du service (clôture Z) |

**Collections MongoDB proposées** (multi-tenant : toutes portent `tenantId` ; schémas à valider) :

- `tenants` : `{ _id, name, city, slug, accent, letter, phone, tweaks: { accent, radius, density } }` (cf. §3.3).
- `categories` : `{ _id, tenantId, id, title, icon, order }`.
- `products` : `{ _id, tenantId, catId, name, price, sizes: [{label, price}], customizer, available, badges, allergens, popular, order }` + règles tacos (`viandes`, plafonds par taille, prix gratiné, suppléments) et référentiels `mods`/`sauces` au niveau tenant.
- `orders` : `{ _id, tenantId, no, channel: "surplace"|"emporter"|"tel", paid: bool, payMode: "CB"|"espèces"|"retrait", subtotal, discountPct, total, customer: { name, phone }, pickupSlot, kitchenNote, lines: [{ productId?, name, unit, qty, optLabel|options structurées }], createdAt, station: "poste-1", cashier }` — statut cuisine (new/cooking/ready/done, visible côté KDS) : le POS n'écrit que la création.
- `parkedTickets` : `{ _id, tenantId, code: "Pxxxx", channel, lines, customer, note, createdAt, station }`.
- `serviceSessions` (Z) : `{ _id, tenantId, station, openedAt, closedAt, totals: { ca, cb, cash, unpaid }, countsByChannel, orderIds }`.

**Endpoints implicites** : `GET /catalog` (catégories + produits + règles de personnalisation) · `POST /orders` · `GET|POST|DELETE /parked-tickets` · `POST /service/close` (+ `GET /service/current` pour le compteur `Service · {n}`). Temps réel vers le KDS (« visible sur le KDS ») : **à définir** (websocket/queue).

---

## 12. Impression ticket / sticker

La maquette **n'imprime rien** ; elle affiche uniquement les intentions :
- texte de confirmation : `Ticket cuisine imprimé · visible sur le KDS` ;
- bouton `Ticket client` (icône `print`) — ferme la modale ;
- bouton `Imprimer le Z` — ferme la modale ; toast `Service clôturé — Z imprimé`.

**À définir intégralement en production** : pilote d'impression (ESC/POS, Bluetooth/USB/réseau), gabarit du ticket client (logo tenant, coordonnées — le catalogue expose `brand.name`, `brand.address = 63 rue du Général de Gaulle — 27910 Perriers-sur-Andelle`, `brand.phones`, `brand.hours`), gabarit du ticket cuisine (n° d'appel, canal, lignes + `optLabel`, note, créneau), **stickers** par article (aucune trace dans la maquette), gabarit du Z, gestion d'échec d'impression et réimpression.

---

## 13. Interactions & micro-interactions — récapitulatif

| Élément | Interaction | Effet / valeur exacte |
|---|---|---|
| Carte produit | press | `scale(0.97)` ; transitions `border-color .1s`, `transform .08s` |
| Carte produit | tap | ouvre V2 (toujours) |
| Boutons `.cf-btn` | hover / press | `primary` : `brightness(1.05)` + `translateY(-1px)` ; press : `translateY(1px)` ; transitions `.12s ease` |
| Chips | hover / sélection | bordure → `--cf-text` ; `.is-on` inverse fond/texte ; `transition all .12s` |
| Inputs | focus | bordure `--cf-text` + halo accent 22 %, `.12s` |
| Modales & toasts | apparition | `cf-pop` : scale .9→1 + fade, **180 ms ease** |
| Backdrops | tap | ferme la surcouche (V2/V3/V4/V5) sans action |
| Toast | vie | auto-fermeture **2200 ms** ; empilement vertical gap 8 |
| Stepper | tap −/+ | ±1 borné [0..99] ; 0 = suppression de ligne ; hover inverse les couleurs |
| Recherche | frappe | filtrage instantané (≤ 12 résultats) ; croix pour effacer |
| Tailles tacos | tap | tronque les viandes au nouveau plafond |
| Espèces | tap coupure | addition cumulative ; passage du panneau rendu en teinte verte dès que reçu ≥ total |
| Réduction de mouvement | réglage système | animations/transitions ramenées à `.01ms` (page hôte SM) |
| **Sons** | — | **aucun son dans la maquette — à définir** |
| **Drag & drop** | — | **aucun dans la surface POS** (n/a) |
| **Minuteurs** | — | seul timer : auto-fermeture des toasts (2200 ms). `useElapsed` (mm:ss, tick 1 s) existe dans `cf-ui.jsx` mais n'est pas utilisé par le POS |
| Retour haptique | — | absent — à définir |

---

## 14. Copy exact (inventaire complet)

Barre haute : `Caisse` · `Poste 1 · Le Gérant` · `Sur place` · `À emporter` · `Téléphone` · `Service · {n}`
Recherche : `Rechercher un produit…`
Chip attente : `{nom ou canal} · {n} art. · {total} €`
Carte produit : `dès` · `à définir` (produit sans prix)
Ticket : `Ticket · Sur place|À emporter|Téléphone` · `En attente` · `Vider` · `Tape un produit pour` / `démarrer la commande` · `{prix} / u` · `Note cuisine (sans oignons…)`
Client tel : `Nom du client *` · `Téléphone *` · `~15 min` · `12:15` `12:30` `12:45` `13:00` `19:00` `19:30` `20:00` · `Nom + téléphone requis pour une commande téléphone`
Pied : `Remise` · `Aucune` · `−5 %` · `−10 %` · `VENTE +` · `+ Coca 33cl · 3,00 €` · `+ Tiramisu · 3,50 €` · `Sous-total {X} · remise −{d} %` · `−{Y} €` · `Total` · `· {n} art.` · `Espèces` · `CB` · `Payer au retrait` · (masqué : `Envoyer en cuisine`)
Config express : `{nom du produit}` · `{taille} · {prix}€` · `Viandes · {n}/{max}` · `Gratiné` `+1,50 €` / `+2,00 €` · `Recette` · `Complet` · `ST s. tomates` · `SO s. oignons` · `SSA s. salade` · `SC s. crudités` · `SCO s. cornichons` · `Sauces` · `Ketchup` `Mayonnaise` `Samouraï` `Andalouse` `Poivre` `Biggy` `Blanche maison` `Harissa` `Cheesy` `Moutarde` `Algérienne` · `Menu frites + boisson` `+2,50 €` · `Ajouter · {prix}` · `Choisis {n} viande(s)`
Espèces : `Encaissement espèces` · `Total à encaisser : {total}` · `+5 €` `+10 €` `+20 €` `+50 €` · `Appoint {X} €` · `↺` · `Reçu` · `À rendre` · `Reste dû` · `Valider l'encaissement`
Clôture : `Clôture de service` · `{n} commande{s} ce service · poste 1` · `Chiffre d'affaires` · `CB` · `Espèces` · `À encaisser au retrait` · `Sur place {a} · À emporter {b} · Téléphone {c}` · `Imprimer le Z` · `Clôturer le service`
Confirmation : `Envoyée en cuisine !` · `N° {no}` · `{canal} · {total} · Payé ({mode})` / `À encaisser au retrait` · `Ticket cuisine imprimé · visible sur le KDS` · `Ticket client` · `Nouvelle commande`
Toasts : `Ticket mis en attente` · `Termine ou mets en attente le ticket en cours` · `Service clôturé — Z imprimé`
Accessibilité (aria-labels) : `Fermer` · `Moins` · `Plus`

---

## 15. Adaptations React Native / Expo (écarts maquette → production)

1. **Cibles tactiles ≥ 44 px** — éléments sous le seuil dans la maquette, à agrandir (visuel conservé, zone de hit étendue via `hitSlop`/padding) : boutons stepper 36 × 36 ; boutons fermer 34 × 34 ; pilules canaux ≈ 34 de haut ; chips remise (≈ 25), sauces (≈ 29), recette (≈ 30), chips standards (≈ 33) ; boutons texte « En attente »/« Vider » ; croix de recherche.
2. **Hover** : sans objet au doigt — transposer les styles hover en états `pressed` (Pressable), conserver press `scale(0.97)` / `translateY(1px)`.
3. **CSS non portable** : `color-mix(...)` (halo focus 22 %, fond chip parqué 10 % or, panneau rendu 14 % vert) → précalculer les couleurs ; ombres dures `3px 3px 0` → vues décalées ou `shadowOffset` sans blur ; `conic-gradient` (damier, non utilisé en POS) n/a.
4. **`<select>` créneau** → picker/action-sheet natif.
5. **Polices** : embarquer Alfa Slab One, Archivo, Barlow Condensed (skin restaurant) et Inter (skin SM) via `expo-font`.
6. **Scroll** : listes (rail, grille, lignes ticket) en `FlatList`/`ScrollView` ; la grille 4 colonnes reste fixe en paysage 1280.
7. **Animations** : `cf-pop` 180 ms → Reanimated/`Animated` (scale .9→1 + opacity), respecter `AccessibilityInfo.isReduceMotionEnabled`.
8. **Clavier** : `inputMode="tel"` → `keyboardType="phone-pad"` ; prévoir l'évitement clavier pour le bloc client du ticket.

---

## 16. Points « à définir » (absents de la maquette) — liste consolidée

1. Persistance/serveur : tout est en mémoire (catalogue en dur, commandes, tickets parqués, journal Z perdus au rechargement).
2. Numéro de commande réel (mock : aléatoire 44–63) ; séquençage par service/tenant.
3. Impression réelle (ticket client, ticket cuisine, **stickers**, Z) et gestion d'erreurs d'impression.
4. Intégration TPE pour « CB » (la maquette valide instantanément).
5. Saisie libre du montant espèces (pavé numérique) ; journalisation du reçu/rendu.
6. TVA / HT-TTC / justificatifs légaux (NF525 etc.).
7. Authentification vendeur, gestion multi-postes (« Poste 1 · Le Gérant » codé en dur).
8. Créneaux de retrait dynamiques (liste fixe de 7 horaires + « ~15 min »).
9. Conservation du créneau et de la remise dans les tickets en attente (perdus actuellement).
10. Confirmation avant « Vider » ; suppression de ligne par geste.
11. État « aucun résultat » de la recherche ; recherche insensible aux accents.
12. Suppléments tacos payants (+1,00/+1,50/+0,80 €) non exposés en caisse ; choix de la boisson du menu ; plafond de sauces.
13. Produits du menu papier absents du catalogue caisse (Class Bowl, Barquettes, Pain Suédois, Assiette Class'Food, Tex-Mex solo).
14. Prix upsell « Coca 33cl · 3,00 € » incohérent avec le catalogue (Canette 33 cl 1,50 €).
15. Style sélectionné des chips de remise illisible sur le skin clair (texte `#fff` sur `--cf-surface`).
16. Token `--cf-line-2` non défini dans `classfood-ds.css` (utilisé par la clôture ; défini seulement dans `sm-skin.css`).
17. Sons, retours haptiques, animation de sortie des toasts.
18. Statut cuisine temps réel (lien POS → KDS), annulation/modification d'une commande envoyée, remboursements.
19. Comportement responsive hors 1280 × 830.
20. CA du Z incluant les impayés « au retrait » : règle comptable à trancher.
