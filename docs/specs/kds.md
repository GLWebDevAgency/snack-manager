# Spécification — Écran Cuisine (KDS)

**Suite SaaS Snack Manager · surface « Cuisine / KDS » · cible production : React Native / Expo (tablette)**

> Document de référence rédigé à partir de la maquette haute-fidélité. Il est autoporteur :
> il doit permettre de recréer la surface en production sans relire le code de la maquette.
> Toute valeur (px, hex, ms) est citée depuis la maquette. Tout comportement absent de la
> maquette est explicitement marqué **« à définir »**.

**Fichiers source de la maquette :**

| Rôle | Fichier |
|---|---|
| Composant KDS (React) | `Menu Trivolet Redesign (1)/app/kds-app.jsx` |
| Page hôte marque grise (canonique SaaS) | `Menu Trivolet Redesign (1)/SM - App Cuisine (KDS).html` |
| Page hôte variante Class'Food (héritage) | `Menu Trivolet Redesign (1)/Cuisine - App KDS.html` |
| Design system de base (tokens `--cf-*`) | `Menu Trivolet Redesign (1)/app/classfood-ds.css` |
| Référentiel SaaS « SM Dark » (tokens `--sm-*`) | `Menu Trivolet Redesign (1)/app/sm-ds.css` |
| Adaptateur marque grise (`--cf-*` → SM) | `Menu Trivolet Redesign (1)/app/sm-skin.css` |
| Couche marque blanche (accent + logo tenant) | `Menu Trivolet Redesign (1)/app/sm-brand.jsx` |
| Primitives UI partagées (Icon, Btn, useElapsed…) | `Menu Trivolet Redesign (1)/app/cf-ui.jsx` |
| Helpers + données mock (`window.CF`) | `Menu Trivolet Redesign (1)/app/cf-helpers.js` |
| Applicateur de thème (localStorage `cf-tweaks`) | `Menu Trivolet Redesign (1)/app/cf-theme.js` |

---

## 1. Vue d'ensemble

Le KDS (Kitchen Display System) est l'écran cuisine temps réel. Trois modes de rendu
existent dans la maquette, commutables par un switcher démo :

| Mode | Libellé du switcher | Cadre simulé | Usage |
|---|---|---|---|
| `tablet` (défaut) | « Tablette » | 1180 × 810 px | Écran principal en cuisine — **cible production** |
| `phone` | « Téléphone » | 392 × 812 px | Version mobile de secours |
| `ticket` | « Ticket » | 300 px de large | Ticket cuisine imprimable (thermique 80 mm) |

Le flux métier : une commande arrive en statut **`new` (Nouveau)** → le cuisinier
l'**accepte** → **`cooking` (En préparation)** → il la **marque prête** → **`ready` (Prête)**
→ **remise au client** → **`done`** (la commande quitte le tableau et rejoint l'historique
« Servies »). L'avancement se fait **exclusivement par bouton** (un tap = étape suivante).

> **Écart brief/maquette — drag & drop :** aucun glisser-déposer de carte entre colonnes
> n'existe dans la maquette. **À définir** si le drag & drop doit être ajouté en production.

Machine à états (constante `STATUS` de la maquette) :

| Statut | Libellé colonne | Statut suivant | Libellé du bouton d'action | Icône du bouton |
|---|---|---|---|---|
| `new` | « Nouveau » | `cooking` | « Accepter » | `bell` (cloche) |
| `cooking` | « En préparation » | `ready` | « Marquer prête » | `fire` (flamme) |
| `ready` | « Prête » | `done` | « Remise au client » | `check` (coche) |
| `done` | — (retiré du tableau) | — | — | — |

---

## 2. Theming multi-tenant (marque grise)

### 2.1 Principe

Deux couches de tokens :

1. **`--sm-*`** (`sm-ds.css`) : le référentiel SaaS « SM Dark », source de vérité.
2. **`--cf-*`** (`classfood-ds.css`) : tokens historiques consommés par les composants ;
   l'adaptateur `sm-skin.css` **remappe** les `--cf-*` sur les valeurs SM et les verrouille
   pour `:root`, `[data-theme="dark"]` **et** `[data-theme="light"]` — en marque grise, le
   KDS est donc **toujours sombre**, quel que soit le thème demandé.

Règle marque blanche (commentaire d'en-tête de `sm-ds.css`, normative) :

- **PERSONNALISABLE par restaurant** : `--sm-accent` (accent de marque), le **logo** et le **nom**.
- **FIXE tous comptes** : neutres, typo, rayons, et **couleurs fonctionnelles** —
  **vert `#3fae4a` = prêt/positif · rouge `#c94b3f` = nouveau/urgent · ambre `#e0973f` = attente**.

> **Nuance constatée dans la maquette :** l'adaptateur mappe `--cf-gold` sur `#c9a15a`
> (le doré de la landing) et non sur l'ambre fonctionnel `#e0973f` (`--sm-amber`). La
> colonne « En préparation » du KDS s'affiche donc en `#c9a15a`. **À définir/harmoniser**
> en production : utiliser `#e0973f` (ambre fonctionnel officiel) ou `#c9a15a` (rendu
> effectif de la maquette) pour l'état « en prépa ».

### 2.2 Injection tenant (`sm-brand.jsx`)

- `window.SM_BRAND` = marque courante ; l'accent est injecté à chaud :
  `--cf-accent = brand.accent` et `--cf-on-accent = #ffffff`.
- Marques de démo :

| id | Nom | Ville | Accent | Lettre | Téléphone |
|---|---|---|---|---|---|
| `classfood` | Class'Food | Perriers-sur-Andelle | `#C8281E` | C | 09 84 36 49 76 |
| `obraise` | O'Braise | Rouen | `#E0762F` | O | 02 35 00 00 00 |
| `greenhouse` | Green House | Évreux | `#2F9E62` | G | 02 32 00 00 00 |

- Sélection persistée dans `localStorage["sm-brand-id"]` ; défaut `greenhouse`
  (forcé à `greenhouse` quand l'app est embarquée en iframe).
- `brand.fullName = name + " · " + city` (ex. « Green House · Évreux »).
- **Logo tenant** : le composant `CFLogo` est remplacé par `BrandLogo` — une tuile carrée
  de côté `size`, `border-radius: round(size × 0.28)`, fond `var(--cf-accent)`, contenant
  la **lettre initiale** de la marque en blanc, `font-weight: 800`,
  `font-size: size × 0.52`, `line-height: 1`. Variante `wordmark` : tuile + nom de la
  marque (`font-weight: 800`, `font-size: size × 0.5`, `letter-spacing: -0.02em`,
  couleur `var(--cf-text)`), gap 10 px.
- Un **switcher de marque démo** (barre fixe en bas-gauche : pastilles rondes 26 × 26 px
  colorées à l'accent de chaque marque, libellé « Marque ») recharge la page au clic —
  outil de démo uniquement, **hors périmètre production**.

> **Production — à définir :** upload d'un vrai logo image (la maquette ne gère que la
> tuile-initiale) ; la personnalisation logo/nom vient du back-office tenant.

### 2.3 Ajustements de thème (`cf-theme.js`)

`localStorage["cf-tweaks"]` (JSON), appliqué sur `document.documentElement` à chaque
chargement :

| Clé | Effet |
|---|---|
| `accent` | `--cf-accent` |
| `radius` (px) | `--cf-r = radius`, `--cf-r-sm = max(4, radius − 5)`, `--cf-r-lg = radius + 8` |
| `density` (px) | `--cf-u = density`, `--cf-u2 = round(density × 1.5)` |
| `kdsTheme` (`"dark"`\|`"light"`) | thème passé au cadre KDS (`data-theme`) ; défaut `"dark"`. Sans effet visuel en marque grise (tokens verrouillés), effectif uniquement sur la variante Class'Food. |

---

## 3. Tokens de design

### 3.1 Couleurs — rendu marque grise (valeurs effectives du KDS SaaS)

Définies dans `sm-skin.css` (verrouillées quel que soit `data-theme`) :

| Token | Valeur | Usage |
|---|---|---|
| `--cf-bg` | `#000` | Fond de l'app |
| `--cf-surface` | `#111` | Cartes de commande, panneau Servies |
| `--cf-surface-2` | `#1a1a1a` | Fond des colonnes et du panneau All Day |
| `--cf-text` | `#fff` | Texte principal |
| `--cf-text-mut` / `--cf-mut` | `#999` | Texte secondaire / fond du pill canal hors « En ligne » |
| `--cf-border` | `rgba(255,255,255,.1)` | Bordures, séparateurs |
| `--cf-fill` / `--cf-on-fill` | `#1a1a1a` / `#fff` | Chips actifs, aplats inverses |
| `--cf-accent` | **injecté par tenant** (ex. `#2F9E62`) | Accent de marque : colonne Nouveau, boutons d'action, pastilles, alertes |
| `--cf-on-accent` | `#fff` | Texte sur accent |
| `--cf-green` | `#3fae4a` | **Fixe : prêt / positif** (colonne Prête, minuteur < 5 min, pill Payé, SMS) |
| `--cf-red` | `#c94b3f` | **Fixe : urgent** (minuteur ≥ 10 min) |
| `--cf-gold` | `#c9a15a` | Colonne En préparation, All Day, minuteur 5–10 min, N° de retrait (cf. §2.1 : ambre officiel `#e0973f` à arbitrer) |
| `--cf-r` / `--cf-r-sm` / `--cf-r-lg` | `16px` / `10px` / `20px` | Rayons |
| `--cf-shadow-card` | `0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)` | Ombre carte au repos |
| `--cf-shadow-accent` | `0 0 0 1px var(--cf-accent)` | « Ombre » d'une carte nouvelle (liseré) |
| `--cf-shadow` | `0 1px 0 rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.38)` | Ombre générique |

Tokens `--sm-*` complémentaires (référentiel, utilisés par les overrides de skin) :
`--sm-surface-6: rgba(255,255,255,.06)` · `--sm-border-10: rgba(255,255,255,.1)` ·
`--sm-badge-bg: #1a1a1a` · `--sm-btn-dark: #262626` · `--sm-gray: #999` ·
`--sm-accent-hover: #e0b96f` · `--sm-amber: #e0973f` ·
`--sm-card-gradient: linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)`.

Surfaces critiques KDS verrouillées par le skin (indépendantes du thème hérité) :

```css
.kds-topbar { background:#111 !important; color:#fff !important; border-bottom:1px solid rgba(255,255,255,.1); }
.kds-no     { background:#1a1a1a !important; color:#fff !important; }   /* case N° de retrait */
```

### 3.2 Couleurs — variante Class'Food (héritage, pour référence)

`classfood-ds.css`, thème `[data-theme="dark"]` (le KDS Class'Food est sombre par défaut) :
bg `#17130F` · surface `#241C16` · surface-2 `#1F1813` · texte `#F4EEE1` ·
texte muet `#A99E8D` · bordure `rgba(244,238,225,0.15)` · fill `#0E0B09`.
Constantes de marque : crème `#F4EEE1`, encre `#1C1612`, rouge `#C8281E`, or `#E8B84B`,
vert `#1F8A5B`. Rayons : `--cf-r 14px`, `--cf-r-sm 9px`, `--cf-r-lg 22px`,
`--cf-r-pill 999px`. Densité : `--cf-u 16px`, `--cf-u2 24px`, `--cf-u3 32px`.

### 3.3 Typographie

| Contexte | `--cf-disp` (display) | `--cf-body` | `--cf-cond` (condensé) |
|---|---|---|---|
| Marque grise (production) | `'Inter', system-ui, sans-serif` | idem | idem |
| Class'Food (héritage) | `'Alfa Slab One', Georgia, serif` | `'Archivo', system-ui` | `'Barlow Condensed', 'Archivo'` |

En marque grise, les classes typographiques sont redéfinies :
`.cf-disp { font-weight:600; letter-spacing:-.03em; text-transform:none; line-height:1.1 }` ·
`.cf-cond { font-weight:500; letter-spacing:-.015em }`.
Police chargée par la page : **Inter 400/500/600/700/800** (Google Fonts).
`.cf-tabnums { font-variant-numeric: tabular-nums }` est appliqué sur **tous les
chiffres vivants** (horloge, minuteurs) pour éviter le tremblement de largeur.

### 3.4 Motion

| Token / règle | Valeur |
|---|---|
| `--sm-ease` | `cubic-bezier(.2,.8,.2,1)` |
| `--sm-t-fast` / `--sm-t-med` / `--sm-t-slow` | `.2s` / `.45s` / `.6s` |
| Transitions boutons/chips/inputs `--cf-*` | `.12s ease` |
| Animation « carte nouvelle » `kds-flash` | `1.4s ease-in-out infinite` (détail §6.2) |
| `@keyframes cf-pop` (toasts) | `scale(.9)→1 + fade`, `.18s ease` |
| `prefers-reduced-motion: reduce` | toutes animations/transitions ramenées à `.01ms` (règle globale de la page hôte) |

### 3.5 Divers (page hôte marque grise)

`::selection { background:#c9a15a; color:#000 }` · `caret-color:#c9a15a` ·
`-webkit-tap-highlight-color: transparent` · `touch-action: manipulation` sur
`button, a` · `overscroll-behavior: none` sur `html, body` ·
scrollbars WebKit globales : 10 px, pouce `rgba(255,255,255,.14)` rayon 99 px,
hover `rgba(201,161,90,.5)` ; scrollbars `.cf-scroll` : 8 px, pouce `var(--cf-border)` ·
`:focus-visible { outline: 2px solid #c9a15a; outline-offset: 2px }` (page hôte) et
`outline: 2px solid var(--sm-accent-hover)` (référentiel SM).
Meta : `apple-mobile-web-app-capable=yes`, status-bar `black`,
`format-detection: telephone=no`, `robots noindex`, `theme-color #000000`.

---

## 4. Mode Tablette — structure & layout

### 4.1 Cadre (démo) et mise à l'échelle

La maquette dessine une tablette physique (`TabletFrame`) : conteneur **1180 × 810 px**,
fond `#0d0b0a`, `border-radius: 34px`, `padding: 14px`,
`box-shadow: 0 40px 90px rgba(0,0,0,0.5)` ; bouton latéral décoratif (barre noire
5 × 46 px, rayon 3, à `left: 6px`, centrée verticalement). L'écran intérieur :
`border-radius: 20px`, `overflow: hidden`, fond `var(--cf-bg)`, colonne flex,
attribut `data-theme` = `cf-tweaks.kdsTheme` ou `"dark"`.

La page hôte centre le tout et le met à l'échelle :
dimensions de scène `tablet: 1208 × 838`, `phone: 392 × 812`, `ticket: 340 × 640` ;
`scale = max(0.05, min(1, (innerHeight − 80)/h, (innerWidth − 40)/w))`, recalculé sur
`resize` (et à 40 ms puis 300 ms après chaque render).

> **Production :** le cadre et le scaling sont des artifices de démo. L'app RN/Expo occupe
> le plein écran de la tablette ; conserver la surface utile intérieure
> **1152 × 782 px** (1180 − 2 × 14) comme référence de design paysage.

Le switcher de mode (pill fixe centrée en haut, `top: 46px`, fond `rgba(15,17,20,0.92)`,
bordure `rgba(245,246,247,0.14)`, rayon 999, padding 5 px ; boutons Inter 700 12 px,
`#8b8f98`, actif fond `var(--cf-accent)` blanc) est également un outil de démo.

### 4.2 Squelette de l'écran

```
┌──────────────────────────────────────────────────────────────────┐
│ TOOLBAR (.kds-topbar)  — hauteur intrinsèque, flex-shrink: 0     │
├──────────────────────────────────────────────────────────────────┤
│ ZONE PRINCIPALE  flex:1 · display:flex · gap:12 · padding:14     │
│ ┌────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────────┐  │
│ │ALL DAY │ │  NOUVEAU      │ │ EN PRÉPARATION│ │  PRÊTE       │  │
│ │196px   │ │  flex:1       │ │  flex:1       │ │  flex:1      │  │
│ │(toggle)│ │  (scroll)     │ │  (scroll)     │ │  (scroll)    │  │
│ └────────┘ └───────────────┘ └───────────────┘ └──────────────┘  │
│                    [ Panneau SERVIES — overlay droit 320px ]     │
└──────────────────────────────────────────────────────────────────┘
```

- Zone principale : `overflow: hidden`, `position: relative` (ancre le panneau Servies).
- Les 3 colonnes partagent l'espace restant à parts égales (`flex: 1`, `min-width: 0`).
- Le panneau All Day est optionnel (toggle, **activé par défaut**), largeur fixe
  **196 px**, `flex-shrink: 0`.

### 4.3 Toolbar (barre supérieure)

Classe `.kds-topbar` (fond `#111`, bordure basse `rgba(255,255,255,.1)`),
`padding: 12px 18px`, `flex-shrink: 0`, layout `space-between` en 3 groupes :

**Groupe gauche** (gap 14) :
- **Logo tenant** `BrandLogo size=30` (tuile accent 30 × 30, rayon 8, lettre blanche ~15.6 px).
- Titre **« Cuisine · KDS »** — `.cf-disp`, 18 px, `var(--cf-text)`.
- Dessous (gap 6, margin-top 2) : **pastille de connexion** ronde 8 × 8 px, fond
  `var(--cf-green)`, halo `box-shadow: 0 0 0 3px rgba(31,138,91,0.25)`
  (⚠ rgba codée en dur sur le vert Class'Food — à retokeniser en production), suivie du
  texte **« En ligne · {SM_BRAND.fullName} »** (ex. « En ligne · Green House · Évreux »),
  `.cf-cond` 13 px `var(--cf-text-mut)`. C'est ici que s'affiche le **nom du client
  (tenant)** ; la pastille reflète l'état de connexion (cf. §9 mode offline).

**Groupe central — filtres canal** (gap 6) : 4 chips `.cf-chip`
(13 px, padding 5 px 12 px) : **« Tous »** (`all`), **« En ligne »**, **« Sur place »**,
**« Tél. »** (valeur `Téléphone`). Sélection exclusive, état actif `.is-on`.
Un 5ᵉ chip **« Servies · {n} »** ouvre/ferme le panneau Servies (n = nb servi ce service).

**Groupe droit** (gap 20) :
- **3 compteurs** : valeur `.cf-disp` 24 px colorée + libellé `.cf-cond` 12 px muet —
  « En attente » (`var(--cf-accent)`), « En prépa » (`var(--cf-gold)`),
  « Prêtes » (`var(--cf-green)`). Les compteurs **respectent le filtre canal**.
- **« Temps moyen »** : `{avgMin}` `.cf-disp` 24 px blanc + suffixe « min » 13 px ;
  masqué tant qu'aucune commande n'a été servie.
  `avgMin = max(1, round(moyenne(doneAt − placedAt) / 60000))`.
- **Horloge** : `HH:MM` (locale `fr-FR`, 2 chiffres), `.cf-disp .cf-tabnums` 22 px,
  rafraîchie toutes les **1000 ms**.
- **Bouton Annuler** `.cf-iconbtn` (icône `back` 19 px), tooltip
  « Annuler la dernière action » ; désactivé (opacité .35) si historique vide.
- **Toggle All Day** `.cf-iconbtn` (icône `grid` 18 px), tooltip
  « Vue All Day (cumul produits) » ; actif : fond `var(--cf-gold)`, texte `#1C1612`.
- **Toggle son** `.cf-iconbtn` (icône `bell` 19 px), tooltip « Alerte sonore » ;
  actif : fond `var(--cf-accent)`, texte blanc. **Actif par défaut.**
- **Bouton « Simuler commande »** — `Btn variant="gold" size="sm" icon="plus"`
  (outil démo ; **hors périmètre production**, remplacé par l'arrivée réelle des commandes).

`.cf-iconbtn` : 40 × 40 px, rayon pill, bordure 1 px `rgba(255,255,255,.1)`,
fond `#1a1a1a` (skin SM) ; hover : bordure `rgba(255,255,255,.5)`.

### 4.4 Colonne de statut (`Column`)

- Conteneur : `flex: 1`, colonne flex, fond `var(--cf-surface-2)` (`#1a1a1a`),
  `border-radius: var(--cf-r)` (16 px), `overflow: hidden`, `min-width: 0`.
- **En-tête** : `padding: 10px 14px`, `space-between` ; fond selon statut —
  `new` → `var(--cf-accent)` · `cooking` → `var(--cf-gold)` · `ready` → `var(--cf-green)` ;
  couleur du texte : `#0a0b0d` sur la colonne `cooking`, `#fff` sinon.
  Libellé `.cf-disp` 16 px + **badge compteur** : fond `rgba(255,255,255,0.25)`,
  rayon 999, `min-width: 26px`, hauteur 24 px, padding 0 8 px, centré grid,
  `.cf-disp` 15 px.
- **Corps** : `.cf-scroll`, `flex: 1`, `min-height: 0`, `overflow-y: auto`,
  `padding: 12px`, colonne flex `gap: 12px`, `overscroll-behavior: contain`,
  `-webkit-overflow-scrolling: touch`.
- **État vide** : tiret « — » centré, `var(--cf-text-mut)`, `padding: 30px 0`,
  police condensée 15 px.

Les listes de chaque colonne **respectent le filtre canal** de la toolbar.

### 4.5 Panneau « All Day » (agrégat « à lancer »)

Pattern Toast/Square : cumul des produits restant à produire.

- Conteneur : largeur **196 px**, `flex-shrink: 0`, colonne flex, fond
  `var(--cf-surface-2)`, rayon `var(--cf-r)`, `overflow: hidden`.
- **En-tête** : `padding: 10px 14px`, fond `var(--cf-gold)`, texte `#1C1612` ;
  titre **« All Day »** `.cf-disp` 15 px ; badge total : fond `rgba(28,22,18,0.18)`,
  rayon 999, min-width 26, hauteur 24, `.cf-disp` 14 px — total = somme des quantités.
- **Corps** : `.cf-scroll`, `padding: 10px 12px`, colonne gap 8. Chaque ligne
  (alignement `baseline`, gap 8) : **« {n}× »** `.cf-disp` 16 px `var(--cf-gold)`
  `min-width: 28px` + **nom du produit** `.cf-cond` 14 px, `font-weight: 600`,
  `line-height: 1.1` (ex. « 3× Frites cheddar L »).
- **État vide** : « Rien à préparer » (`.cf-cond` 14 px muet).
- **Pied** : `padding: 8px 12px`, `border-top: 1px solid var(--cf-border)`,
  légende **« Cumul Nouveau + En prépa »** 11.5 px muet.

**Règle d'agrégation** : commandes de statut `new` ou `cooking` uniquement ;
par article, quantité ajoutée = `qty > 0 ? qty : 1` ; cumul par **nom exact**
d'article ; tri **décroissant** par quantité.
⚠ L'agrégat **ignore le filtre canal** (il porte sur toutes les commandes actives) —
comportement de la maquette, à confirmer en production (**à définir**).
Il ignore aussi les options/variantes (cumul au nom seul).

### 4.6 Panneau « Servies » (historique + rappel)

Overlay ancré à droite de la zone principale : `position: absolute; top/right/bottom: 0`,
largeur **320 px**, `z-index: 60`, fond `var(--cf-surface)`,
`border-left: 1px solid var(--cf-border)`,
`box-shadow: -20px 0 50px rgba(0,0,0,.45)`. Pas d'animation d'entrée/sortie dans la
maquette (montage/démontage sec) — transition de slide **à définir**.

- **En-tête** : `padding: 12px 16px`, bordure basse ; titre **« Servies · {n} »**
  `.cf-disp` 16 px ; bouton fermer `.cf-iconbtn` 32 × 32 (icône `close` 15 px,
  `aria-label="Fermer"`).
- **Liste** (ordre **antéchronologique** — dernière servie en tête) : cartes
  `border: 1px solid var(--cf-border)`, rayon 12, `padding: 10px 12px`, gap 10 :
  - Ligne 1 : **« N°{pickNo} · {nom client} »** `.cf-cond` 15 px **/** durée de
    préparation **« {m} min »** 12.5 px muet, `m = max(1, round((doneAt − placedAt)/60000))`.
  - Ligne 2 : récapitulatif articles — `"{qty}× {nom}"` (qty omis si 0) joints par
    « , », **tronqué à 52 caractères** ; 12.5 px muet.
  - Bouton **« ↩ Rappeler la commande »** : fond transparent, bordure 1 px
    `var(--cf-border)`, rayon 999, `padding: 5px 12px`, 12.5 px, `font-weight: 700`.
- **État vide** : « Aucune commande servie ce service » (14 px muet, centré, padding 30).

**Rappel** : la commande quitte l'historique, est réinsérée **en tête** du tableau avec le
statut `ready`, et le panneau se ferme.
L'historique est plafonné aux **20 dernières** commandes servies (mémoire de session ;
persistance serveur **à définir**).

---

## 5. Carte de commande (`Ticket`) — inventaire complet

### 5.1 Conteneur

- Classes : `cf-card` (+ `kds-new` si statut `new`).
- Fond `var(--cf-surface)` ; **bordure 2 px** : `var(--cf-accent)` si **nouvelle OU en
  retard**, sinon `var(--cf-border)` ; ombre : `var(--cf-shadow-accent)`
  (`0 0 0 1px accent`) si nouvelle, sinon `var(--cf-shadow-card)`.
- `display: flex; flex-direction: column; overflow: hidden;` et surtout
  **`flex-shrink: 0`** : la carte ne se comprime jamais dans la colonne — sa **hauteur
  reste stable**, dictée par son contenu (en-tête + articles + bouton), jamais par la
  place disponible. Pas de hauteur fixe en px dans la maquette.
- Rayon hérité de `.cf-card` (`var(--cf-r)` = 16 px en marque grise).

### 5.2 En-tête (bordure basse 1 px)

- **Case N° de retrait** (`.kds-no`) : largeur fixe **62 px**, fond `#1a1a1a`, colonne
  centrée, `padding: 8px 0` ; libellé « N° » (8 px, `font-weight: 800`,
  `letter-spacing: .1em`, opacité .7) au-dessus du **numéro** `.cf-disp` **30 px**
  couleur `var(--cf-gold)`, `line-height: 1`.
- **Bloc droit** (`flex: 1`, `padding: 8px 12px`, `min-width: 0`) :
  - Ligne 1 : **nom du client** (`.cf-cond` gras 16 px) ↔ **minuteur** `mm:ss`
    (`.cf-disp .cf-tabnums` 18 px, couleur dynamique §6.1).
  - Ligne 2 (gap 6, margin-top 4) :
    - **Pill canal** : 8 px, `padding: 2px 7px`, texte `#F4EEE1` ; fond
      `var(--cf-accent)` si canal « En ligne », sinon `var(--cf-mut)` (`#999`).
      Texte = valeur du canal (« En ligne » / « Sur place » / « Téléphone »).
    - **Pill paiement** : « Payé » (fond `var(--cf-green)`, blanc) ou « À payer »
      (transparent, bordure 1.5 px `var(--cf-border)`, texte muet).
    - **Pill « Retard »** (condition §6.1) : fond `var(--cf-accent)`, blanc.
    - À droite (`margin-left: auto`) : **« {id} · {slot} »** (ex. « CF-1042 · 12:30 »),
      `.cf-cond` muet 12 px.

### 5.3 Liste d'articles (`padding: 8px 12px`, `flex: 1`)

Chaque ligne (gap 8, `padding: 4px 0`, `align-items: flex-start`,
`cursor: pointer`, tooltip **« Pointer l'article »**) :

- **Marqueur quantité** `.cf-disp` 16 px, `min-width: 24px` : `"{qty}×"` si `qty > 0`,
  sinon `"•"` (article-titre sans quantité, ex. « Family Box ») ; couleur
  `var(--cf-accent)` — devient **« ✓ » vert** quand l'article est pointé.
- **Nom** `.cf-cond` gras 15.5 px, `line-height: 1.1`.
- **Options** (`opts: string[]`, optionnel) : jointes par « · », 13 px muet,
  `line-height: 1.2` (ex. « Kebab, Poulet, Tenders · Gratiné · Sauce algérienne, samouraï »).
- **Note** (optionnelle) : préfixe « ➜ », 13 px, couleur `var(--cf-accent)`,
  `font-weight: 600` (ex. « ➜ à partager »).

**Pointage (strike)** : un tap bascule l'état « pointé » de la ligne — opacité **0.38**,
`text-decoration: line-through`, marqueur « ✓ » vert ; transition `opacity .12s`.
⚠ État **local à la carte côté client** dans la maquette (perdu au démontage/rafraîchissement) ;
persistance et partage entre écrans **à définir**.

### 5.4 Ligne SMS

Si `status === "ready"` **et** `channel === "En ligne"` :
**« 📱 SMS « C'est prêt » envoyé au client »** — `.cf-cond` 12 px,
`var(--cf-green)`, `font-weight: 700`, `padding: 0 12px 8px`.
⚠ Purement décoratif dans la maquette (aucun envoi réel) ; le déclenchement effectif du
SMS au passage en `ready` est **à définir** côté backend.

### 5.5 Bouton d'action (pied de carte)

`.cf-btn` pleine largeur, `border-radius: 0`, `padding: 12px`, 13 px, texte blanc ;
fond `var(--cf-green)` si statut `ready`, sinon `var(--cf-accent)` ;
icône 17 px + libellé selon statut (tableau §1). Un tap = passage au statut suivant.
États du bouton : hover (héritage `.cf-btn:hover` : `opacity .85` en skin SM),
actif `transform: translateY(1px)`. Pas d'état chargement/erreur (**à définir** pour
les écritures réseau en production). Pas de confirmation ni de retour arrière par carte
(le retour se fait via l'Annuler global).

### 5.6 Récapitulatif des états de la carte

| État | Déclencheur | Rendu |
|---|---|---|
| Nouvelle | `status === "new"` | Bordure accent 2 px, liseré `0 0 0 1px accent`, **animation `kds-flash`** (§6.2) |
| Normale | `cooking`/`ready`, < 10 min | Bordure `var(--cf-border)`, ombre carte |
| En retard | `minutes ≥ 10` et statut ≠ `ready` | Bordure accent + pill « Retard » |
| Prête | `status === "ready"` | Bouton vert « Remise au client » (+ ligne SMS si En ligne) |
| Article pointé | tap sur la ligne | Opacité .38, barré, ✓ vert |
| Hover / pressée | pointeur | Héritées des primitives (`.cf-btn`, curseur pointer) |
| Chargement / erreur / désactivée | — | **Absentes de la maquette — à définir** |

---

## 6. Minuteurs, alertes visuelles et sonores

### 6.1 Minuteur de carte (`useElapsed` + `timerColor`)

- Tick toutes les **1000 ms** ; affichage `mm:ss` (zéro-paddé) depuis `placedAt`.
- **Seuils de couleur (valeurs de la maquette)** :

| Temps écoulé | Couleur | Token |
|---|---|---|
| `< 5 min` | vert | `var(--cf-green)` `#3fae4a` |
| `5 – < 10 min` | doré/ambre | `var(--cf-gold)` `#c9a15a` |
| `≥ 10 min` | rouge | `var(--cf-red)` `#c94b3f` |

> **Écart brief/maquette :** le brief cible « vert < 10 min, orange < 15, rouge au-delà » ;
> la maquette implémente **5 / 10 min**. Seuils définitifs **à arbitrer** (idéalement
> paramétrables par tenant — **à définir**).

- **Retard** : `minutes ≥ 10` **et** statut ≠ `ready` → pill « Retard » + bordure accent.

### 6.2 Flash « nouvelle commande »

`.kds-new` (posée sur toute carte de statut `new`) :
`animation: kds-flash 1.4s ease-in-out infinite` — version marque grise :

```css
@keyframes kds-flash {
  0%,100% { box-shadow: 0 0 0 1px var(--cf-accent), 0 0 0 0 rgba(201,75,63,0.5); }
  50%     { box-shadow: 0 0 0 1px var(--cf-accent), 0 0 0 8px rgba(201,75,63,0); }
}
```

(Onde de 8 px qui s'évanouit ; le rgba du halo est codé sur le rouge fonctionnel
`#c94b3f` — ⚠ non tokenisé.) Désactivée par `prefers-reduced-motion`.

### 6.3 Sons

**Bip « nouveau ticket »** (`beep()`, WebAudio) : oscillateur **carré**, gain **0.06**,
**880 Hz** puis **660 Hz à t + 0.1 s**, arrêt à **t + 0.22 s** (double note descendante
d'environ 220 ms). Silencieux si le toggle son est désactivé ; échec silencieux
(`try/catch`) si l'audio est indisponible.

⚠ Dans la maquette, le bip n'est déclenché **que** par « Simuler commande ». L'arrivée
d'une commande réelle (via la file `sm_live_orders`, §9) ne déclenche **que** le
clignotement du titre d'onglet. En production : **jouer le bip à chaque nouvelle commande
entrante** (comportement attendu, à confirmer).

> **Écart brief/maquette — rappel 60 s :** aucun son de rappel périodique (toutes les
> 60 s tant qu'un ticket `new` n'est pas accepté) n'existe dans la maquette. **À définir**
> (périodicité, condition d'arrêt, opt-out).

**Notification d'onglet** (web uniquement) : à l'arrivée d'une commande live, le titre du
document devient **« ● Nouvelle commande — Cuisine »** pendant **4000 ms** puis est
restauré. Équivalent RN/Expo (notification locale, vibration ?) **à définir**.

---

## 7. Interactions & micro-interactions — synthèse

| Interaction | Geste | Effet | Détails |
|---|---|---|---|
| Accepter / Marquer prête / Remise | tap bouton bas de carte | statut suivant ; la carte change de colonne ; `done` → historique Servies | instantané, pas d'animation de déplacement (**à définir** si transition souhaitée) |
| Pointer un article | tap ligne article | barré + ✓ vert, opacité .38 | transition opacity .12s ; état local |
| Annuler (undo) | tap icône `back` toolbar | restaure le **snapshot** de la dernière commande modifiée (statut inclus) ; si elle avait été servie, elle est retirée de l'historique ; si absente du tableau, réinsérée en tête | pile d'annulation plafonnée à **10** entrées |
| Rappeler une servie | tap « ↩ Rappeler la commande » | retour en colonne Prête (tête de liste), panneau fermé | — |
| Filtrer par canal | tap chip | filtre colonnes + compteurs (pas l'All Day) | sélection exclusive |
| Toggle All Day | tap icône `grid` | affiche/masque le panneau 196 px | actif par défaut ; les colonnes se redistribuent (flex) |
| Toggle son | tap icône `bell` | active/désactive le bip | actif par défaut |
| Ouvrir Servies | tap chip « Servies · n » | overlay droit 320 px | fermeture par ✕ ou nouveau tap |
| Simuler commande | tap bouton doré | injecte une commande factice en tête de « Nouveau » + bip | **démo uniquement** (détail §10.2) |
| Hover boutons/chips | pointeur | `.cf-btn:hover` opacity .85 ; `.cf-chip:hover` texte blanc ; `.cf-iconbtn:hover` bordure claire | transitions .12–.2 s |
| Appui bouton | press | `translateY(1px)` | `.cf-btn:active` |
| Drag & drop | — | **absent** | **à définir** |
| Sons | — | §6.3 | — |
| Minuteries | — | horloge 1 s, minuteurs 1 s, poll live 4 s, titre 4 s | — |

---

## 8. Mode Téléphone (`PhoneKDS`)

Cadre démo `PhoneFrameDark` : 392 × 812 px, fond `#0d0b0a`, rayon 50, padding 10 ;
écran intérieur rayon 40 ; encoche décorative 100 × 26 px (top 11, rayon 16, z-index 90).
Le contenu réserve `padding-top: 40px` pour l'encoche.

Structure (colonne pleine hauteur, fond `var(--cf-bg)`) :

1. **Topbar** (`.kds-topbar`, `padding: 8px 14px`) : titre **« Cuisine »** `.cf-disp`
   16 px ; à droite : horloge `.cf-disp .cf-tabnums` 16 px `var(--cf-gold)` + toggle son
   `.cf-iconbtn` **34 × 34 px** (icône `bell` 16).
2. **Onglets de statut** (gap 6, `padding: 10px 12px 6px`) : 3 chips `flex: 1` centrés,
   13 px, `padding: 8px 4px` — libellé « {Nouveau|En préparation|Prête} {compteur} ».
   Un seul statut visible à la fois (pas de colonnes côte à côte).
3. **Liste** : `.cf-scroll`, `padding: 6px 12px 14px`, gap 10 ; cartes `Ticket`
   identiques au mode tablette (une prop `compact` est passée mais **sans effet** dans la
   maquette — variante compacte **à définir**). État vide :
   **« Aucune commande {libellé en minuscules} »** (ex. « Aucune commande en préparation »),
   centré, padding 40.
4. **Pied** : `padding: 8px 12px calc(10px + env(safe-area-inset-bottom))`, bordure
   haute ; bouton démo pleine largeur « Simuler une commande » (gold, sm, icône plus).

Absents du mode téléphone (par rapport à la tablette) : filtres canal, All Day,
panneau Servies, undo, temps moyen. **À définir** s'ils doivent être portés en production.

---

## 9. Synchronisation temps réel & mode offline

### 9.1 Mécanique de la maquette (mock du canal temps réel)

- Les commandes initiales proviennent du jeu mock `window.CF.ORDERS` (statuts `done`
  exclus au chargement).
- **File live** : clé `localStorage["sm_live_orders"]` (JSON array, plafonnée aux
  **20 dernières** entrées), **écrite** par l'app client au moment du paiement, **lue**
  par le KDS et le back-office. Le KDS écoute :
  - l'événement `storage` (filtré sur la clé `sm_live_orders`) — sync inter-onglets ;
  - un **poll toutes les 4000 ms** ;
  - un pull immédiat au montage.
- Déduplication par `Set` d'ids déjà vus ; les nouvelles commandes sont **préfixées** au
  tableau avec `status: "new"` et `placedAt` par défaut `Date.now()` ; le titre d'onglet
  clignote 4 s (§6.3).
- Structure écrite par l'app client :
  `{ id, pickNo, channel: "En ligne", name, phone, placedAt, slot, status: "new",
  paid: true, total, note, items: [{ name, qty, opts?, price }] }`.

### 9.2 Mode offline — état réel et cible

La maquette ne simule **pas** de coupure réseau : la pastille « En ligne · {tenant} » est
**toujours verte** et aucun état dégradé n'existe. Le fonctionnement est néanmoins
« local-first » de fait (état en mémoire + file localStorage).

**À définir pour la production (aucune spec dans la maquette)** :
- détection de perte de connexion et rendu de la pastille/texte en mode hors-ligne
  (proposition évidente : pastille rouge + « Hors ligne » — **à valider**) ;
- file d'attente locale des transitions de statut effectuées hors-ligne et rejeu à la
  reconnexion (stockage AsyncStorage/SQLite côté Expo) ;
- résolution de conflits multi-écrans ;
- transport temps réel réel (WebSocket/SSE/push) en remplacement du poll localStorage.

---

## 10. Données

### 10.1 Modèle « commande » lu/écrit par le KDS

Champs observés dans la maquette (jeu `CF.ORDERS` + simulateur + file live) :

| Champ | Type | Exemple | Rôle KDS |
|---|---|---|---|
| `id` | string | `"CF-1042"` | identifiant affiché (« CF-1042 · 12:30 »), clé de liste |
| `pickNo` | int | `42` | **N° de retrait** (case dorée 62 px, panneau Servies, ticket imprimé) |
| `channel` | enum | `"En ligne"` \| `"Sur place"` \| `"Téléphone"` | pill canal, filtre, condition SMS |
| `name` | string | `"Yassine B."` | nom client sur la carte |
| `phone` | string | `"07 45 70 13 53"` | non affiché sur le KDS (présent dans les données ; utilisé ailleurs) |
| `placedAt` | epoch ms | `Date.now() − 60000` | base du minuteur et du temps de préparation |
| `slot` | string `"HH:MM"` | `"12:30"` | créneau de retrait affiché |
| `status` | enum | `new` \| `cooking` \| `ready` \| `done` | colonne / cycle de vie — **seul champ modifié par le KDS** |
| `paid` | bool | `true` | pill Payé / À payer ; ligne Paiement du ticket |
| `total` | float € | `31.30` | ticket imprimé uniquement (non affiché sur la carte) |
| `note` | string? | — | note globale (présente dans la file live ; non rendue par la carte KDS — **à définir**) |
| `items[]` | array | — | lignes de la carte |
| `items[].name` | string | `"Tacos XL"` | nom d'article (clé d'agrégation All Day) |
| `items[].qty` | int | `1` (0 = ligne-titre « • », compte 1 en All Day) | quantité |
| `items[].opts` | string[]? | `["Bien cuit"]` | options, jointes par « · » |
| `items[].note` | string? | `"à partager"` | note de ligne « ➜ … » |
| `items[].price` | float? | `14.5` | non affiché sur le KDS |

Données dérivées côté KDS (session, non persistées dans la maquette) :
- `served[]` : commandes remises, avec `doneAt` (epoch ms) — plafonné à 20 ;
- `hist[]` : snapshots pour l'undo — plafonné à 10 ;
- `struck` : pointage d'articles par index — local à la carte ;
- `avgMin`, compteurs par statut : calculés.

### 10.2 Jeux de données de la maquette (pour seed/fixtures)

Commandes initiales : CF-1042 (new, En ligne, Yassine B., payé, 31,30 €),
CF-1041 (cooking, En ligne, Marie L.), CF-1040 (cooking, Téléphone, M. Lambert, non payé),
CF-1039 (ready, En ligne, Karim D.), CF-1038 (done, exclue à l'affichage).

Simulateur (bouton démo) : `id = "CF-" + (1043 + n)`, `pickNo = 43 + n` ;
noms tirés de `[Léa P., Hugo M., Inès K., Noah B., Jade R., Adam T.]` ;
canal « En ligne » (p ≈ 0.7) sinon « Sur place » ; `paid` vrai (p ≈ 0.7) ;
`total = 8 + round(random × 30)` € ; `slot` = heure courante ; 4 paniers types :
1. Tacos L gratiné ×1 (« Kebab, Poulet » · « Sauce blanche », note « Menu +2,50 ») + Sprite 33cl ×1
2. Le Boss ×2 (« Bien cuit ») + Frites cheddar L ×1
3. Crousty One Riz ×1 + Milkshake Bueno ×1
4. Mix Box 1 ×1 (note « à partager »)

### 10.3 Contrat API / modèle MongoDB (déduits — à valider)

Le KDS a besoin de (déduit strictement des lectures/écritures ci-dessus) :

- **Lecture temps réel** des commandes du tenant avec `status ∈ {new, cooking, ready}`
  (abonnement + snapshot initial), et des servies récentes (`done`, avec `doneAt`).
- **Écriture** : transition de statut (`new→cooking→ready→done`), rappel
  (`done→ready`), undo (retour au statut précédent). Idempotence/horodatage des
  transitions **à définir**.

Proposition de document MongoDB `orders` (dérivée du modèle §10.1 ; les champs marqués ✚
sont exigés par le contexte SaaS mais absents de la maquette — **à définir**) :

```js
{
  _id, ✚ tenantId,           // multi-tenant : partition obligatoire
  number: "CF-1042",         // id lisible
  pickNo: 42,
  channel: "online|onsite|phone",   // mapping des libellés FR à définir
  customer: { name, phone },
  placedAt: ISODate, slot: "12:30",
  status: "new|cooking|ready|done",
  ✚ statusHistory: [{ status, at, by }],   // requis pour undo/audit/temps moyen fiables
  paid: true, total: 31.30, note: null,
  items: [{ name, qty, opts: [], note: null, price: 14.5,
            ✚ struckBy: null }],           // si le pointage doit être persistant
  ✚ doneAt: ISODate                        // remise au client (temps de service)
}
```

Index suggérés : `{ tenantId, status, placedAt }` et `{ tenantId, doneAt }` — **à définir**.
Paramètres tenant consommés par le KDS : `accent` (hex), `name`, `city`, `phone`,
`letter`/logo, ✚ seuils de minuteur, ✚ activation SMS — **à définir** dans la collection
de configuration tenant.

---

## 11. Ticket cuisine imprimable (mode `ticket`, thermique 80 mm)

Rendu en `data-theme="light"` sur la première commande active (ou la première du mock).
Conteneur `#cf-receipt` : largeur **300 px** (~80 mm), fond `#fff`, texte `#000`,
`padding: 18px 16px`, police Inter, ombre écran `0 20px 50px rgba(0,0,0,0.25)`
(supprimée à l'impression).

Contenu, de haut en bas :

1. **En-tête centré** (séparé par `border-bottom: 2px dashed #000`) :
   nom de la marque en **capitales**, 22 px, weight 800 ; « {ville} · {téléphone} » 12 px ;
   **« TICKET CUISINE »** 15 px weight 800.
2. **Lignes clé/valeur** (14 px, alignées aux extrémités) :
   « Commande » {id} · « Retrait N° » **« ★ {pickNo} »** · « Canal » {canal} ·
   « Créneau » {slot} · « Client » {nom}.
3. **Articles** (séparateur `2px dashed`) : « {qty}× {nom} » gras 15 px (qty omis si 0) ;
   options 12 px indentées 12 px ; note « ➜ {note} » 12 px gras indentée.
4. **Totaux** (séparateur dashed) : « TOTAL » {montant formaté `12,34 €`} ·
   « Paiement » : **« Payé en ligne »** ou **« À encaisser »**.
5. Horodatage `placedAt` en `toLocaleString("fr-FR")`, 12 px, centré.
6. **« À TOUT DE SUITE ! »** 13 px weight 800, centré.

Bouton écran « Imprimer le ticket » (`Btn primary`, icône `print`) → `window.print()`.
CSS d'impression : switcher et boutons masqués, fond blanc, transform de scène annulé.
Impression automatique à l'acceptation d'une commande : **absente — à définir**
(pilote d'imprimante thermique ESC/POS côté production).

---

## 12. Copy exact (inventaire de toutes les chaînes affichées)

| Emplacement | Texte exact |
|---|---|
| Toolbar, titre | `Cuisine · KDS` |
| Toolbar, statut connexion | `En ligne · {nom marque} · {ville}` |
| Filtres canal | `Tous` · `En ligne` · `Sur place` · `Tél.` |
| Chip historique | `Servies · {n}` |
| Compteurs | `En attente` · `En prépa` · `Prêtes` · `Temps moyen` (valeur `{n} min`) |
| Tooltips toolbar | `Annuler la dernière action` · `Vue All Day (cumul produits)` · `Alerte sonore` |
| Bouton démo (tablette / téléphone) | `Simuler commande` / `Simuler une commande` |
| En-têtes colonnes | `Nouveau` · `En préparation` · `Prête` |
| Colonne vide | `—` |
| Carte, libellé n° | `N°` |
| Pills carte | `En ligne` / `Sur place` / `Téléphone` · `Payé` / `À payer` · `Retard` |
| Carte, méta | `{id} · {slot}` |
| Tooltip ligne article | `Pointer l'article` |
| Note d'article | `➜ {note}` |
| Ligne SMS | `📱 SMS « C'est prêt » envoyé au client` |
| Boutons d'action | `Accepter` · `Marquer prête` · `Remise au client` |
| All Day | `All Day` · `Rien à préparer` · `Cumul Nouveau + En prépa` |
| Panneau Servies | `Servies · {n}` · `N°{pickNo} · {nom}` · `{m} min` · `↩ Rappeler la commande` · `Aucune commande servie ce service` · aria `Fermer` |
| Téléphone | `Cuisine` · `Aucune commande {statut en minuscules}` |
| Titre d'onglet (flash 4 s) | `● Nouvelle commande — Cuisine` |
| Ticket imprimé | `TICKET CUISINE` · `Commande` · `Retrait N°` (`★ {n}`) · `Canal` · `Créneau` · `Client` · `TOTAL` · `Paiement` · `Payé en ligne` · `À encaisser` · `À TOUT DE SUITE !` |
| Bouton impression | `Imprimer le ticket` |
| Switcher démo | `Tablette` · `Téléphone` · `Ticket` |
| Switcher marque démo | `Marque` |

Format monétaire : `n.toFixed(2)` avec virgule décimale + ` €` (ex. `31,30 €`) ;
tiret cadratin `—` si valeur absente. Locale générale : `fr-FR`.

---

## 13. Notes d'adaptation React Native / Expo (production)

Éléments web de la maquette sans équivalent direct — à transposer :

- **WebAudio `beep()`** → `expo-av`/`expo-audio` (asset court ou synthèse) en respectant
  le profil sonore §6.3 ; gérer le mode silencieux iOS (**à définir**).
- **`localStorage`** (`sm_live_orders`, `cf-tweaks`, `sm-brand-id`) → AsyncStorage +
  vrai canal temps réel (§9.2).
- **`document.title` clignotant** → notification locale/vibration (**à définir**).
- **`window.print()`** → impression thermique native (ESC/POS) (**à définir**).
- **Hover/tooltips (`title=`)** : sans objet au tactile — prévoir un équivalent
  (appui long ?) ou l'abandon (**à définir**).
- Scroll des colonnes : `overscroll-behavior: contain` → `ScrollView` avec
  `overScrollMode`/`bounces` maîtrisés.
- Garder l'écran **toujours éveillé** en cuisine (`expo-keep-awake`) — non couvert par
  la maquette (**à définir**).

---

## 14. Écarts brief ↔ maquette & synthèse des « à définir »

| # | Sujet | Maquette | À définir / arbitrer |
|---|---|---|---|
| 1 | Seuils minuteur | vert < 5 min · doré < 10 · rouge ≥ 10 | brief : 10/15 — arbitrer, idéalement paramétrable tenant |
| 2 | Son rappel 60 s | absent | périodicité, condition (tickets `new` non acceptés ?), arrêt |
| 3 | Bip sur commande réelle | bip uniquement sur simulation | déclencher sur toute commande entrante |
| 4 | Mode offline | non simulé (pastille toujours verte) | détection, UI dégradée, file de rejeu, conflits |
| 5 | Drag & drop entre colonnes | absent (boutons uniquement) | opportunité produit |
| 6 | Couleur « en prépa » | `#c9a15a` (gold landing) | vs ambre fonctionnel officiel `#e0973f` |
| 7 | Persistance pointage articles | état local volatile | persistance + multi-écrans |
| 8 | Persistance Servies / undo | mémoire de session (caps 20 / 10) | historisation serveur |
| 9 | All Day vs filtre canal | All Day ignore le filtre | comportement attendu ? |
| 10 | `note` globale de commande | non affichée sur la carte | l'afficher ? |
| 11 | Variante `compact` (téléphone) | prop passée, sans effet | densité mobile |
| 12 | États chargement/erreur (réseau) | absents | skeletons, retry, toasts |
| 13 | Transitions de déplacement de carte | aucune | animation colonne→colonne |
| 14 | Animation ouverture panneau Servies | aucune | slide-in ? |
| 15 | Impression auto du ticket | absente | ESC/POS à l'acceptation |
| 16 | SMS « C'est prêt » | mention décorative | envoi réel backend au passage `ready` |
| 17 | Logo tenant image | tuile initiale uniquement | upload logo |
| 18 | Fonctions tablette absentes du téléphone | filtres, All Day, Servies, undo | portée mobile |
| 19 | Halo pastille connexion | rgba en dur `rgba(31,138,91,0.25)` | retokeniser |
| 20 | Halo `kds-flash` | rgba en dur `rgba(201,75,63,…)` | retokeniser sur l'accent |
| 21 | Multi-tenant serveur (`tenantId`, config) | absent (démo mono-poste) | modèle §10.3 |
| 22 | Écran toujours éveillé | non couvert | `expo-keep-awake` |

---

## 15. Accessibilité (état de la maquette)

- `:focus-visible` : contour 2 px `#c9a15a`, offset 2 px.
- `prefers-reduced-motion: reduce` : animations et transitions neutralisées (0.01 ms).
- Icônes SVG en `aria-hidden="true"` ; bouton fermer du panneau Servies avec
  `aria-label="Fermer"`.
- Chiffres tabulaires sur toutes les valeurs vivantes.
- Manques constatés (**à définir**) : rôles/labels des toggles (son, All Day, undo ne
  portent que des `title`), annonce vocale des nouvelles commandes, taille de cibles
  tactiles < 44 px sur certains chips (ex. 5 × 12 px de padding), contraste du texte
  muet `#999` sur `#111` à vérifier (WCAG AA ≈ 4.6:1, limite pour petits corps).
