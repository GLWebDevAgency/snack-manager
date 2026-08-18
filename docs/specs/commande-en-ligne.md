# Spécification — Commande en ligne Click & Collect (surface client)

**Suite SaaS Snack Manager · multi-tenant · marque grise · fast-foods**
**Cible : Next.js, mobile-first · Document destiné aux développeurs — reprend l'intégralité de la maquette haute-fidélité, sans nécessité de relire son code source.**

| | |
|---|---|
| Version | 1.0 — 18/08/2026 |
| Sources maquette (font foi pour l'UI) | `app/client-app.jsx`, `app/client-flow.jsx`, `app/cf-ui.jsx`, `app/cf-helpers.js`, `app/cf-theme.js`, `app/sm-brand.jsx`, `app/classfood-ds.css`, `app/sm-skin.css`, `app/sm-ds.css`, `menu-data.js`, pages hôtes `Client - Commande & Site.html` et `SM - Commande en ligne.html` |
| Sources produit (contexte) | `Handoff - Développement Next.js.html` (architecture cible), `SM - FAQ Support.html` (pause en ligne), `Brief - Snack Manager.md` |
| Convention | Tout comportement **absent de la maquette** est marqué **« à définir »**. Aucune valeur inventée : chaque px, hex et durée cités proviennent du code de la maquette. |

---

## 1 · Portée et parcours couvert

Surface **client** de commande en ligne click & collect, **sans compte obligatoire** :

```
Accueil ──► Menu / carte ──► Fiche produit (bottom sheet, config) ──► Panier
   ▲                                                                    │
   │            (« Modifier » une ligne rouvre la config)               ▼
Suivi temps réel ◄── Confirmation ◄── Paiement (CB / comptoir) ◄── Créneau de retrait
(Reçue / En prépa / Prête)
```

Écrans annexes maquettés et documentés : **Compte / fidélité** (connexion facultative), carte « commande en cours » sur l'accueil, toasts, barre de panier flottante, navigation basse.

La maquette est une SPA React (état en mémoire + `localStorage`). En production : routes Next.js proposées par le handoff — `commander`, `produit/[slug]`, `panier`, `retrait`, `paiement`, `confirmation/[orderId]` — la correspondance écran → route est en §8.

---

## 2 · Enveloppe générale, shell et layout

### 2.1 Cadre téléphone (conteneur démo — ne pas porter en production)

La maquette rend l'app dans un cadre iPhone (`CFPhone`) :

- Cadre externe : **402 × 858 px**, fond `#0d0b0a`, `border-radius: 54px`, `padding: 11px`, ombre `0 40px 90px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.06)`.
- Écran interne : `border-radius: 44px`, `overflow: hidden`, fond `var(--cf-cream)`.
- Barre de statut simulée : hauteur **46 px**, padding horizontal 26 px, `z-index: 80`, heure « 11:42 » (Archivo 700, 14 px), pictos réseau/batterie SVG.
- « Dynamic island » : **108 × 30 px**, top 12, centrée, fond `#0d0b0a`, radius 20, `z-index: 90`.
- Le contenu applicatif occupe `inset: 0` avec `padding-top: 46px`.
- La page hôte met le cadre à l'échelle : `scale = min(1, (innerHeight − 32)/858, (innerWidth − 24)/402)`, recalculé au `resize` (+ passes à 60 ms et 400 ms).

**En production** : viewport mobile plein écran, `env(safe-area-inset-bottom)` déjà prévu dans les paddings des barres basses (voir plus bas). La zone utile de référence du design est **402 px de large**. Comportement ≥ tablette/desktop : **à définir** (la maquette ne le couvre pas).

### 2.2 Structure du shell applicatif

```
┌──────────────────────────────┐
│  Écran courant (flex: 1)     │  ← chaque écran gère son propre scroll
│   └ FloatingCartBar (absolu, │     (visible uniquement sur home & menu,
│      bottom 12, si panier>0) │      z-index 45)
├──────────────────────────────┤
│  BottomNav (si route ∈       │  z-index 40
│  home|menu|cart|account)     │
└──────────────────────────────┘
   ProductSheet (overlay, z 60)
   Toasts (fixed, z 9000)
```

- **Routage** : état `route {name, params}` ; routes : `home`, `menu`, `cart`, `pickup`, `checkout`, `confirm`, `account`. Naviguer vers `home|menu|cart|account` synchronise l'onglet actif de la nav basse et **remet le scroll à 0**.
- La nav basse est **masquée** sur `pickup`, `checkout`, `confirm` (tunnel).
- **Échafaudage commun `ScreenScaffold`** (panier, retrait, paiement, compte) :
  - Header : padding `12px 16px 10px`, `border-bottom: 1px solid var(--cf-line)`, fond `var(--cf-cream)` ; bouton retour optionnel (`cf-iconbtn`, icône `back` 18 px, `aria-label="Retour"`) + titre `cf-disp` 20 px.
  - Corps scrollable : `flex: 1`, padding `12px 16px 20px`.
  - Footer optionnel collé en bas : padding `12px 16px calc(12px + env(safe-area-inset-bottom))`, `border-top: 1px solid var(--cf-line)`, fond `var(--cf-cream)`.

### 2.3 Navigation basse (`BottomNav`)

- Conteneur : `border-top: 1px solid var(--cf-line)`, fond `var(--cf-paper)`, padding `8px 6px calc(10px + env(safe-area-inset-bottom))`.
- 4 onglets égaux (`flex: 1`) : **Accueil** (icône `home`), **Menu** (`grid`), **Panier** (`cart`), **Compte** (`user`). Libellés Archivo 11 px.
- États : actif = couleur `var(--cf-accent)`, label poids 800, trait d'icône 2.4 ; inactif = `var(--cf-mut)`, poids 600, trait 2.
- Badge panier : si `cartCount > 0`, pastille sur l'icône (`top: −6, right: −9`, min-width 17, h 17, radius 9, fond `var(--cf-accent)`, texte blanc 11 px poids 800). Le badge est re-monté à chaque changement de quantité (clé React = compte) → **rejoue l'animation `cf-pop`** à chaque ajout.

### 2.4 Barre de panier flottante (`FloatingCartBar`) — pattern Deliveroo/UberEats

Visible sur **Accueil** et **Menu** uniquement, si `cartCount > 0`.

- Position : `absolute; left: 14; right: 14; bottom: 12`, `z-index: 45`. Animation d'apparition `cf-pop` (0,18 s).
- Style : fond `var(--cf-accent)`, texte `var(--cf-on-accent)`, `border-radius: var(--cf-r-pill)` (999 px), padding `14px 18px`, ombre `var(--cf-shadow), 0 12px 30px rgba(28,22,18,0.3)`.
- Contenu : pastille compteur (min-width 26, h 26, radius 13, fond `rgba(0,0,0,0.25)`, Archivo 800 13 px) · texte « **Voir le panier** » (Archivo 800, 14 px, uppercase, `letter-spacing: .03em`) · **total TTC** à droite (`cf-disp` 17 px). Le montant affiché est le **total après remises** (`ctx.total`).
- Tap → route `cart`.

### 2.5 Toasts

- Hôte : `position: fixed; left: 50%; bottom: 24px; translateX(−50%)`, `z-index: 9000`, colonne gap 8, `pointer-events: none`.
- Toast : fond `var(--cf-ink)`, texte `var(--cf-cream)`, padding `12px 18px`, radius pill, Archivo 700 14 px, ombre `var(--cf-shadow-soft)`, icône optionnelle 17 px couleur `var(--cf-gold)`.
- Animation d'entrée `cf-pop` ; **auto-destruction après 2 200 ms** (paramétrable par appel via `opts.ms`). Pas d'animation de sortie (disparition sèche) — transition de sortie **à définir**.

---

## 3 · Tokens de design & theming tenant

### 3.1 Deux habillages livrés

La même app client existe sous **deux skins** :

1. **Skin « Class'Food » (crème/rétro)** — page `Client - Commande & Site.html` : charge uniquement `classfood-ds.css`. C'est l'habillage « restaurant » chaleureux.
2. **Skin « SM Dark » (marque grise)** — page `SM - Commande en ligne.html` : charge `classfood-ds.css` **puis** `sm-skin.css` (qui importe `sm-ds.css`) et remappe tous les tokens `--cf-*` sur le référentiel sombre Snack Manager. Rendu avec `theme="dark"`.

Les composants ne consomment **que** des variables `--cf-*` : l'habillage est donc entièrement piloté par CSS. En production, reproduire ce mécanisme (tokens sémantiques + adaptateur par tenant).

### 3.2 Tokens « Class'Food » (`classfood-ds.css`)

**Constantes de marque (jamais thémées)**

| Token | Valeur |
|---|---|
| `--cf-cream` | `#F4EEE1` |
| `--cf-cream-2` | `#EDE5D3` |
| `--cf-paper` | `#FBF8F1` |
| `--cf-ink` | `#1C1612` |
| `--cf-mut` | `#6E6354` |
| `--cf-red` | `#C8281E` |
| `--cf-gold` | `#E8B84B` |
| `--cf-green` | `#1F8A5B` |
| `--cf-line` | `rgba(28,22,18,0.16)` |
| `--cf-accent` | `var(--cf-red)` (alias remplaçable) |
| `--cf-on-accent` | `#F4EEE1` |

**Tokens sémantiques (light)** : `--cf-bg: #F4EEE1` · `--cf-surface: #FBF8F1` · `--cf-surface-2: #EDE5D3` · `--cf-text: #1C1612` · `--cf-text-mut: #6E6354` · `--cf-border: rgba(28,22,18,0.16)` · `--cf-fill: #1C1612` (aplat sombre : pills, boutons ink, prix) · `--cf-on-fill: #F4EEE1`.

**Surcharge `[data-theme="dark"]`** (sémantiques uniquement) : `--cf-bg: #17130F` · `--cf-surface: #241C16` · `--cf-surface-2: #1F1813` · `--cf-text: #F4EEE1` · `--cf-text-mut: #A99E8D` · `--cf-border: rgba(244,238,225,0.15)` · `--cf-fill: #0E0B09` · `--cf-on-fill: #F4EEE1` · ombres dures re-basées sur `rgba(0,0,0,0.5)`.

**Rayons** : `--cf-r: 14px` · `--cf-r-sm: 9px` · `--cf-r-lg: 22px` · `--cf-r-pill: 999px`.

**Densité (espacement)** : `--cf-u: 16px` · `--cf-u2: 24px` · `--cf-u3: 32px` (utilisés par `.cf-row`/`.cf-between` comme gap par défaut).

**Typographies** :

| Token | Police | Usage |
|---|---|---|
| `--cf-disp` | `'Alfa Slab One', Georgia, serif` | Display : titres, prix, gros numéros. Classe `.cf-disp` = poids 400, `letter-spacing: .01em`, uppercase, `line-height: .98` |
| `--cf-body` | `'Archivo', system-ui, sans-serif` | Corps, boutons, labels (graisses chargées 400–900) |
| `--cf-cond` | `'Barlow Condensed', 'Archivo', sans-serif` | Texte condensé : descriptions, sous-titres (graisses 400–700) |

**Ombres signature (dures)** : `--cf-shadow: 3px 3px 0 var(--cf-ink)` · `--cf-shadow-2: 5px 5px 0 var(--cf-ink)` · `--cf-shadow-accent: 4px 4px 0 var(--cf-accent)` · `--cf-shadow-soft: 0 10px 30px rgba(28,22,18,0.13)` · `--cf-shadow-card: 0 2px 0 var(--cf-border), 0 8px 22px rgba(28,22,18,0.08)`.

**Motifs décoratifs** : damier `.cf-check` (hauteur 9 px, `conic-gradient` accent, tuile 18 × 18 px, opacité .92 ; variante `--ink`) · texte fantôme `.cf-ghost` (display, transparent, `-webkit-text-stroke: 1.5px var(--cf-text)`, opacité .06, uppercase, non interactif).

**Accessibilité** : `:focus-visible { outline: 3px solid color-mix(in srgb, var(--cf-accent) 60%, transparent); outline-offset: 2px }`.

### 3.3 Tokens « SM Dark » (marque grise, `sm-ds.css` + adaptateur `sm-skin.css`)

Référentiel `--sm-*` (source de vérité = landing Snack Manager) :

- **Neutres (fixes tous comptes)** : `--sm-black: #000` · `--sm-seam: #050505` · `--sm-card: #111` · `--sm-badge-bg: #1a1a1a` · `--sm-btn-dark: #262626` · `--sm-surface-3: rgba(255,255,255,.03)` · `--sm-surface-6: rgba(255,255,255,.06)` · `--sm-border-10: rgba(255,255,255,.1)` · `--sm-white: #fff` (déclinaisons 80/70/50/30 %) · `--sm-gray: #999` · `--sm-card-gradient: linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)`.
- **Accent (personnalisable par restaurant, injecté par `sm-brand.jsx`)** : défaut `--sm-accent: #c9a15a` · `--sm-accent-hover: #e0b96f` · `--sm-on-accent: #000`.
- **Fonctionnelles (FIXES tous comptes)** : `--sm-green: #3fae4a` (**vert = prêt/positif**) · `--sm-red: #c94b3f` (**rouge = nouveau/urgent/alerte**) · `--sm-amber: #e0973f` (**ambre/orange = attente/préparation**).
- **Typo** : `--sm-font: 'Inter'` (graisses 400–800) · `--sm-font-logo: 'ADLaM Display'`.
- **Rayons** : `--sm-r-pill: 50px` · `--sm-r-lg: 20px` · `--sm-r: 16px` · `--sm-r-md: 12px` · `--sm-r-sm: 10px` · `--sm-r-xs: 8px`.
- **Motion** : `--sm-ease: cubic-bezier(.2,.8,.2,1)` · `--sm-t-fast: .2s` · `--sm-t-med: .45s` · `--sm-t-slow: .6s`.

L'adaptateur `sm-skin.css` remappe (pour `:root`, `[data-theme="dark"]` et `[data-theme="light"]`) : `--cf-bg: #000` · `--cf-surface: #111` · `--cf-paper: #111` · `--cf-cream: #0b0b0b` · `--cf-cream-2: #161616` · `--cf-text/--cf-ink: #fff` · `--cf-mut: #999` · `--cf-line: rgba(255,255,255,.1)` · `--cf-line-2: rgba(255,255,255,.06)` · `--cf-fill: #1a1a1a` · `--cf-gold: #c9a15a` · `--cf-green: #3fae4a` · `--cf-red: #c94b3f` · `--cf-on-accent: #fff` · rayons `16/10/20` · ombres douces sombres · **les trois familles typo passent sur Inter** (`.cf-disp` devient poids 600, `letter-spacing: −.03em`, sans uppercase). Damier remplacé par un dégradé linéaire 2 px. Boutons/pills/chips aplatis (sans ombre dure).

### 3.4 Règles de theming tenant (marque grise)

1. **Personnalisable par restaurant** : `--cf-accent`/`--sm-accent` (couleur de marque), logo, nom. C'est le SEUL levier couleur du tenant.
2. **Fixe tous comptes** : neutres, typo, rayons, et **couleurs fonctionnelles** — *vert = prêt, rouge = alerte/nouveau/urgent, orange(ambre) = attente/prépa*. Ne jamais laisser l'accent tenant écraser ces sémantiques (un tenant à accent rouge coexiste avec le rouge fonctionnel).
3. **Injection de l'accent** (`sm-brand.jsx`) : au chargement, lit `localStorage["sm-brand-id"]` (défaut `greenhouse` ; forcé à `greenhouse` en iframe), résout la marque et pose `document.documentElement.style` → `--cf-accent: <accent>` et `--cf-on-accent: #ffffff`. Marques de démo :

   | id | Nom | Ville | Accent | Lettre |
   |---|---|---|---|---|
   | `classfood` | Class'Food | Perriers-sur-Andelle | `#C8281E` | C |
   | `obraise` | O'Braise | Rouen | `#E0762F` | O |
   | `greenhouse` | Green House | Évreux | `#2F9E62` | G |

   `window.SM_BRAND` expose `{id, name, city, slug, accent, letter, phone, fullName: "Nom · Ville"}` — consommé par l'app (header, retrait, footer légal, écran compte).
4. **Logo marque blanche** (`BrandLogo`, remplace le logo Class'Food) : tuile carrée `size × size`, `border-radius: round(size × 0.28)`, fond `var(--cf-accent)`, initiale blanche Archivo/Inter 800 à `size × 0.52` ; wordmark optionnel = nom du restaurant (poids 800, `size × 0.5`, `letter-spacing: −0.02em`, couleur `var(--cf-text)`).
5. **Tweaks runtime** (`cf-theme.js`) : lit `localStorage["cf-tweaks"]` `{accent, radius, density}` et pose `--cf-accent`, `--cf-r` (= radius), `--cf-r-sm` (= max(4, radius−5)), `--cf-r-lg` (= radius+8), `--cf-u` (= density), `--cf-u2` (= round(density×1.5)). Outil de démo ; en production, équivalent = config tenant servie par l'API.
6. Un **switcher de marques** (pastilles fixes bas-gauche) est monté hors iframe pour la démo — ne pas porter.

⚠️ `--cf-line-2` (bordure fine des `OptionRow`) n'est défini **que** dans `sm-skin.css`. Dans le skin Class'Food il est indéfini (la bordure retombe sur `currentColor`). **À ajouter au DS light** (valeur suggérée : déclinaison plus faible de `--cf-line` — à définir).

---

## 4 · Inventaire des composants transverses et leurs états

### 4.1 Bouton `Btn` (`.cf-btn`)

Base : inline-flex centré, gap 9, Archivo 800 14 px uppercase `letter-spacing: .02em`, padding `13px 20px`, radius pill, `transition: transform .12s ease, box-shadow .12s ease, filter .12s ease`. Icône gauche/droite optionnelle (18 px ; 15 px en `sm`).

| Variante | Fond / texte | Ombre | Hover | Actif (press) |
|---|---|---|---|---|
| `primary` | `--cf-accent` / `--cf-on-accent` | `--cf-shadow` (3px 3px 0 ink) | `filter: brightness(1.05)` + `translateY(−1px)` | `translateY(1px)` |
| `ink` | `--cf-fill` / `--cf-on-fill` | `--cf-shadow-accent` (4px 4px 0 accent) | `translateY(−1px)` | idem |
| `gold` | `--cf-gold` / `#1C1612` | `--cf-shadow` | — | idem |
| `ghost` | transparent / `--cf-text`, bordure `2px solid var(--cf-text)`, padding `11px 18px` | — | fond `--cf-text`, texte `--cf-bg` (inversion) | idem |

Tailles : `sm` = `9px 14px` / 12 px ; `lg` = `16px 26px` / 16 px ; `block` = largeur 100 %.
**Désactivé** : `opacity: .4; cursor: not-allowed; box-shadow: none`.

### 4.2 Bouton icône `.cf-iconbtn`

40 × 40, radius pill, bordure `2px solid var(--cf-border)`, fond `var(--cf-surface)` ; hover : `border-color: var(--cf-text)` ; transition .12 s. Toujours avec `aria-label`.

### 4.3 Chip `.cf-chip` (sélecteurs d'options, onglets catégories, créneaux)

Barlow Condensed 600 15 px, padding `7px 14px`, radius pill, bordure `1.5px solid var(--cf-border)`, fond `var(--cf-surface)`, `transition: all .12s ease`, `user-select: none`.
- Hover : `border-color: var(--cf-text)`.
- **Sélectionné** (`.is-on` ou `aria-pressed="true"`) : fond `var(--cf-fill)`, texte `var(--cf-on-fill)`, bordure `var(--cf-fill)`.
- Désactivé (créneaux passés) : `opacity: .28`, `cursor: not-allowed` (posé inline).
- Contrainte atteinte (viandes au max) : chips non sélectionnées à `opacity: .4`.

### 4.4 Pill `.cf-pill` (badges)

Archivo 800 10 px uppercase `letter-spacing: .1em`, padding `4px 9px`, radius pill, défaut fond `--cf-fill`. Variantes : `--new` (fond accent — badge « Nouveau ») · `--gold` (fond `#E8B84B`, texte `#1C1612` — « Populaire ») · `--out` (transparent, texte muet, bordure 1.5 px — « Bientôt ») · `--green` (fond `#1F8A5B`, texte blanc — « En cours », « Activée »).

### 4.5 Prix `Price` (`.cf-price`)

Alfa Slab One 14 px (taille paramétrable), pastille fond `--cf-fill` texte `--cf-on-fill`, padding `2px 9px 3px`, radius `--cf-r-sm`. Préfixe optionnel « dès » (cond, 72 % de la taille, opacité .8) pour les produits à tailles (`fromPrice`). Valeur nulle/NaN → « — ». Format monétaire : `fmtEuro` = `n.toFixed(2)` avec virgule + « € » (option `bare` sans symbole). `Money` = variante texte nu (display, `font-variant-numeric: tabular-nums`).

### 4.6 Stepper quantité (`.cf-stepper`)

Bordure `2px solid var(--cf-text)`, radius pill, fond `--cf-surface`. Boutons − / + de **36 × 36**, texte 20 px Archivo 800, hover inversé (fond `--cf-fill`) ; valeur centrale min-width 30, Alfa Slab One 16 px, tabular-nums. `aria-label` « Moins » / « Plus ». Bornes `min`/`max` (99). Dans le panier `min = 0` (0 ⇒ suppression de la ligne) ; dans la fiche produit `min = 1`.

### 4.7 Champs (`.cf-input`, `.cf-textarea`, `.cf-field`, `.cf-label`)

Archivo 15 px, fond `--cf-surface`, bordure `1.5px solid var(--cf-border)`, radius `--cf-r-sm` (9 px), padding `12px 14px`, largeur 100 %.
- **Focus** : bordure `var(--cf-text)` + halo `0 0 0 3px color-mix(in srgb, var(--cf-accent) 22%, transparent)`.
- Placeholder : `color-mix(in srgb, var(--cf-text-mut) 75%, transparent)`.
- Label `.cf-label` : Archivo 700 12 px uppercase `letter-spacing: .04em`, couleur muette.
- États erreur/validation : **à définir** (aucune validation visuelle dans la maquette).

### 4.8 Cartes

`.cf-card` : fond `--cf-surface`, bordure `2px solid var(--cf-text)`, radius `--cf-r` (14 px), ombre dure `--cf-shadow`. `.cf-card--soft` : bordure `1px solid var(--cf-border)`, ombre `--cf-shadow-card`. `.cf-card--flat` : bordure fine sans ombre.

### 4.9 Icônes

Set interne de **traits SVG 24 × 24** (`stroke-linecap/join: round`, `stroke-width` 2 par défaut, `aria-hidden`) : burger, tacos, sandwich, dog, box, chicken, salad, drink, dessert, fries, star, clock, bag, check, plus, minus, fire, heart, print, bell, user, pin, phone, cart, edit, trash, chart, gear, tag, home, grid, ticket, arrow, back, close, search, euro. Icône inconnue → étoile.

### 4.10 Divers

- `SectionLabel` : eyebrow (Archivo 800 12 px uppercase `letter-spacing: .18em`, muet) + hint optionnel à droite (cond 13 px muet) ; marge `16px 0 2px`.
- `Stars` : 5 étoiles 15 px (paramétrable), remplies `--cf-gold`, vides contour `--cf-line`.
- `Check` (damier) et `.cf-ghost` : voir §3.2.
- En-tête de section menu `.cf-head` : titre display accent uppercase + **double filet** `.rule` (`border-top: 2.5px solid var(--cf-text)` + `border-bottom: 1px`, h 3, margin-top 6) + note cond muette.

---

## 5 · Écrans

### 5.1 Accueil (`home`)

Conteneur scrollable pleine hauteur, `padding-bottom: 84px` (dégage la barre panier flottante).

**Zones, de haut en bas :**

1. **Top bar** — padding `6px 16px 10px` : logo tenant avec wordmark (taille 30, sans anneau) à gauche ; à droite deux `cf-iconbtn` : `user` (→ compte, `aria-label="Compte"`) et `cart` (→ panier, `aria-label="Panier"`, badge pastille accent `top: −5, right: −5`, min-w 18, h 18 si `cartCount > 0`).
2. **Carte « commande en cours »** (`ActiveOrderCard`) — uniquement si une commande vient d'être passée (voir §5.8).
3. **Héro** — margin horizontal 12, radius `--cf-r-lg` (22 px), fond `var(--cf-fill)` (sombre), damier accent en tête, padding interne `20px 20px 22px` :
   - Texte fantôme « EAT » 128 px (`right: −24, top: −14`, stroke `rgba(245,246,247,0.06)`).
   - **Pastille statut d'ouverture** (calculée côté client sur `new Date()`) :
     - Ouvert si `midi` (jour ≠ lundi(1) et ≠ vendredi(5), 11 h 30 ≤ h < 14 h 30) ou `soir` (18 h ≤ h < 22 h 30).
     - Ouvert → fond `--cf-gold`, texte ink, point **vert** 7 px : « Ouvert · prochain retrait {HH:MM} » — heure = prochain quart d'heure à ≥ 12 min (`ceil((minutes+12)/15)×15`), rabattu sur « 11:45 » hors plage 11 h–22 h.
     - Fermé → fond `rgba(244,238,225,0.16)`, texte crème, point **accent** : « Fermé · réouvre à {18h00 | 11h30 | demain 11h30} ».
   - **H1 display 34 px**, `line-height: .98` : « Commande. / Récupère. / **Régale-toi.** » (3e ligne en `--cf-gold`).
   - Sous-titre cond 15 px `rgba(245,246,247,0.75)` : « Click & Collect · prêt en ~12 min ».
   - CTA `Btn primary` icône droite `arrow` : « **Commander maintenant** » → menu.
4. **Carrousel « Les incontournables »** — titre display 19 px accent + lien « Tout voir → » (cond 14 700, muet) ; rangée horizontale scrollable (gap 12, padding `10px 16px 4px`) de **cartes 152 px** : bordure `2px solid var(--cf-ink)`, radius 14, ombre dure ; zone visuelle h **84 px** fond `--cf-cream-2` avec icône produit 40 px (trait 1.4) et badge éventuel (pill `new`, `top/left: 7`) ; corps padding `8px 10px 10px` : nom cond 15 px, prix (`Price` 13, « dès » si tailles), bouton rond **28 px** accent avec `plus` blanc. Contenu : les 8 premiers produits `popular && available` dans l'ordre des catégories. Tap carte → `openSheet(p)` (ajout direct si produit simple, sheet sinon).
5. **Carrousel « Tes favoris »** — affiché si ≥ 1 favori disponible ; même gabarit de carte, cœur plein accent (15 px) en haut-droite à la place du badge. Titre + icône `heart` accent 17 px.
6. **Grille « Explore la carte »** — padding `18px 16px 0` ; titre display 19 accent ; grille **4 colonnes**, gap 9 ; tuiles : fond `--cf-paper`, bordure `1px solid var(--cf-line)`, radius 14, padding `12px 4px 9px`, icône catégorie 26 px + libellé raccourci cond 12 600 muet (fonction `shortCat` : retire « Compose ton », « Les », « Gourmets », « à Partager », « Menu »). 12 premières catégories. Tap → menu ancré sur la catégorie.
7. **Bannière upsell menu** — margin `18px 16px 0`, fond `--cf-gold`, radius 14, padding `14px 16px`, ombre dure, emoji 🍟 30 px : « **Passe en menu** » (display 16 ink) / « Frites + boisson pour +2,50 € seulement » (cond 13). Tap → menu.
8. **Bloc avis** — carte soft padding 16 : note « **4,8** » (display 30 accent) + 5 étoiles 13 px ; citation « « Le tacos gratiné est une tuerie » » (cond 15) ; « +320 avis Google · Yassine, Marie, Karim… » (cond 13 muet).
9. **Bloc infos restaurant** — carte bordure dure, visuel « carte » h 96 (dégradé crème + grille 22 px opacité .5 + `pin` accent rempli 34 px) puis padding 16 : ⚲ adresse · 🕐 horaires (« Tous les jours - 7J/7 · **11h30–14h30 & 18h00–22h30 · Lundi & Vendredi : soir uniquement** ») · ☎ téléphones (joints par « · »). Icônes 18 px accent, texte cond 15.
10. **Footer légal** — cond 12 centré muet : « {Nom tenant} © 2026 · {Ville} · Prix TTC, service compris · Allergènes : détail sur chaque produit ».

**Données** : lecture catalogue (popular/available/badges/prix), favoris (`localStorage["cf-favs"]`), dernière commande, horaires (logique locale — en prod : API), identité tenant. Écriture : aucune (navigation seulement).

### 5.2 Menu / carte (`menu`)

Layout en colonne : en-tête fixe, onglets catégories fixes, liste scrollable.

1. **En-tête** — padding `10px 16px 8px` : titre « **Notre carte** » (display 22) + **champ recherche** : input pill (radius 999, padding vertical 10, `padding-left: 40`), placeholder « Un smash ? Un tacos gratiné ? », icône `search` 17 px muette (`left: 13, top: 11`) ; si saisie : bouton effacer rond 26 px (`right: 10, top: 8`, fond `--cf-cream-2`, icône `close` 13, `aria-label="Effacer"`).
   - Filtrage plein-texte insensible à la casse sur `nom + description`, appliqué par catégorie (les catégories vides sont masquées).
2. **Onglets catégories** — rangée horizontale scrollable de `cf-chip` avec icône 16 px (gap 8, padding `2px 16px 10px`, `border-bottom: 1px solid var(--cf-line)`), libellés raccourcis (`shortCat`). Actif = `.is-on`.
   - **Tap** : scroll doux (`behavior: "smooth"`) vers la section (`offsetTop − 8`).
   - **Scroll-spy** : au scroll de la liste, la catégorie dont `offsetTop − 60 ≤ scrollTop` devient active et son chip se recentre (`scrollIntoView({inline: "center"})`).
   - Arrivée avec `params.cat` (depuis la grille accueil) : scroll initial vers la catégorie.
3. **Liste produits** — padding `8px 16px 96px`. Par catégorie (section `id="cat-{id}"`, margin-bottom 22) :
   - **En-tête sticky** (`top: −8`, fond `--cf-cream`, z 2, padding `8px 0 2px`) : titre display 20 accent uppercase + double filet + tagline cond 13 muette.
   - Cartes produit (`ProductCard`, gap 10) : carte soft padding 12, rangée gap 12 :
     - Bouton **favori** cœur 30 × 30 en `top/right: 6` (z 2) : contour `--cf-line` inactif, rempli `--cf-accent` actif ; `aria-label="Favori"` ; stopPropagation ; persiste dans `cf-favs`.
     - Vignette **62 × 62** radius 12 fond `--cf-cream-2`, icône 32 px trait 1.5.
     - Nom cond 17 px + badge inline (Pill `new` 8 px si badge, sinon Pill `gold` « Populaire » si populaire).
     - Description cond 13 muette, **clamp 2 lignes**.
     - Pied : prix (`Price` 14, « dès » si tailles) OU pill `--out` « **Bientôt** » si indisponible ; à droite : bouton « **Composer** » (`Btn ink sm`) si produit configurable (`customizer` ou `sizes`), sinon bouton rond **34 px** accent `plus` blanc (ombre dure).
     - **États carte** : disponible = cliquable (toute la carte ouvre la fiche, `force = true`) ; indisponible = `opacity: .55`, curseur défaut, non cliquable, boutons masqués.
     - Le bouton rond « + » d'un produit simple **ajoute directement au panier** (toast « {nom} ajouté », icône cart) sans ouvrir la fiche.
4. **État vide recherche** — centré, padding `46px 20px` : « Aucun résultat pour « {q} » » (cond 16 muet) + « Essaie « tacos », « smash » ou « box » » (cond 14).

**Catalogue affiché** (15 catégories, ordre exact ; données = `menu-data.js`, prix TTC relevés juin 2026) :

| id | Titre | Tagline | Icône | Particularités |
|---|---|---|---|---|
| `signatures` | Les Signatures | « Créations maison, montage minute » | star | tous `popular` ; « Le Smash » à 3 tailles (Simple 9,50 / Double 12,50 / Triple 14,90) |
| `burgers` | Gourmets Burgers | « Pain brioché toasté · salade · tomates · oignons rouges · cornichons » | burger | |
| `tacos` | Compose ton Tacos | « Ton tacos sur-mesure » | tacos | 1 seul produit « Tacos sur-mesure » (dès 8,90 €), `customizer: "tacos"`, popular |
| `classiques` | Les Classiques | « Servis avec crudités & frites » | burger | tags « Mega Burger » |
| `sandwichs` | Sandwichs | « Tous servis avec crudités & frites — version galette +0,50 € » | sandwich | 24 items |
| `crousty` | Crousty One | « Le plat qui cartonne — poulet crousty » | chicken | tous `popular` |
| `hotdogs` | Hot Dogs | « Pain moelleux toasté, servis avec frites » | dog | |
| `boxes` | Box à Partager | « Le meilleur de Class'Food à partager — frites & boisson incluses sur les Family » | box | Family Box popular ; Family Big Box badge « La plus grosse » |
| `texmex` | Tex-Mex | « À picorer, à partager » | chicken | 2 tailles (5 pcs / 10 pcs) |
| `assiettes` | Assiettes & Bun's | « Format généreux » | sandwich | agrège Assiettes + Bun's + Hummers |
| `salades` | Salades | « Toutes à 7,50 € » | salad | |
| `paninis` | Paninis | « Croustillant, à toute heure » | sandwich | |
| `enfant` | Menu Enfant | « Avec surprise offerte » | star | badge « + Surprise » |
| `desserts` | Desserts & Glaces | « La touche sucrée » | dessert | milkshakes à 2 tailles (Normal/XL) |
| `boissons` | Boissons | « Fraîcheur » | drink | |

Règles data : `price: null` (prix « lettres » non défini) ⇒ produit **masqué à la vente** (`available: false`, affiché « Bientôt » s'il reste listé) ; badge « Nouveau » si `isNew` ; allergènes génériques par famille (table `ALLERG`, INCO) affichés en fiche produit.

### 5.3 Fiche produit / configuration (`ProductSheet` — bottom sheet)

Ouverte par : carte produit (toujours), bouton « Composer », bouton « + » d'un produit configurable, **« Modifier » depuis le panier** (avec la ligne à éditer). Produits simples via « + » ou carrousels : ajout direct sans sheet.

**Enveloppe** : couche `absolute inset 0`, `z-index: 60`, alignée en bas.
- **Backdrop** : `rgba(28,22,18,0.5)`, animation `cf-pop .2s ease` ; tap → fermeture.
- **Sheet** : fond `--cf-cream`, `border-radius: 22px 22px 0 0`, `max-height: 92%`, ombre `0 −10px 40px rgba(0,0,0,0.3)`, **animation d'entrée `cf-sheet .28s cubic-bezier(.2,.8,.2,1)`** (translateY 100 % → 0 ; keyframes définies dans la page hôte). Animation de sortie : aucune (démontage sec) — **à définir**. Geste glisser-pour-fermer : absent — **à définir**.

**En-tête (`SheetHead`)** :
- Bandeau visuel h **128 px** fond `--cf-cream-2` : icône produit 62 px trait 1.4 ink, texte fantôme 120 px incliné −6° (« TACOS » si icône tacos, sinon « MIAM »), damier accent en bas.
- Bouton fermer `cf-iconbtn` (`top/right: 12`, fond `--cf-cream`, icône `close` 18, `aria-label="Fermer"`).
- Padding `14px 18px 0` : nom display 24 ink + badge éventuel ; description cond 15 muette ; ligne allergènes cond 12,5 : « **Allergènes :** {liste} ».

**Corps scrollable** (padding `0 18px 8px`) — deux configurateurs :

#### a) Configurateur générique (`GenericBuilder`) — tout produit sauf tacos

Sections dans l'ordre (chacune introduite par un `SectionLabel`) :

1. **« Format »** (si le produit a des tailles) : chips « {label} · {prix} € » ; sélection exclusive ; défaut = 1re taille.
2. **« La recette »** (hint « crudités au choix ») — uniquement pour les catégories à crudités (`signatures`, `burgers`, `classiques`, `sandwichs`, `hotdogs`, `assiettes`, `tacos`) : `ModsPicker` = chip « **Complet** » (actif quand aucun retrait, poids 700) + 5 chips modificateurs : `ST` Sans tomates · `SO` Sans oignons · `SSA` Sans salade · `SC` Sans crudités · `SCO` Sans cornichons (code en display 13 + libellé abrégé « s. … »). Multi-sélection, gratuit.
3. **« Sauces »** (hint « offert · plusieurs choix ») : 11 chips multi-sélection gratuite (padding réduit `5px 11px`, 14 px) : Ketchup, Mayonnaise, Samouraï, Andalouse, Poivre, Biggy, Blanche maison, Harissa, Cheesy, Moutarde, Algérienne. Pas de maximum imposé (**à définir** si limite en prod).
4. **« La bonne affaire »** — uniquement catégories éligibles (`signatures`, `burgers`, `classiques`, `sandwichs`, `hotdogs`, `crousty`, `tacos`) : **`MenuUpsell`**, gros toggle-carte : 🍟 26 px, « **Passer en Menu** » (display 15) / « + Frites & Boisson 33cl » (cond 13) / « **+2,50 €** » (display 18). État off : fond `--cf-paper`, bordure `2px solid var(--cf-ink)` ; état **on** : fond `--cf-ink`, textes crème/gold, ombre `--cf-shadow-accent` ; `transition: all .15s`.

Prix : `unit = prixTailleSélectionnée + (menu ? 2,50 : 0)` ; total affiché = `unit × qty`.

#### b) Configurateur tacos (`TacosBuilder`) — produit `customizer: "tacos"`

Titre de sheet surchargé : « **Compose ton Tacos** » / « Ton tacos, ta façon ». Sections :

1. **« Taille »** — 4 chips-cartes égales en colonne (`flex: 1`, padding `8px 4px`) : lettre display 16 (« M/L/XL/XXL »), « {n} vd », prix (12 px, gold si actif, sinon accent) :
   M 8,90 € (1 viande) · **L 9,90 € (2) — défaut** · XL 12,50 € (3) · XXL 14,50 € (4).
   Changer de taille **tronque la sélection de viandes** au nouveau maximum.
2. **« Viandes »** — hint compteur dynamique « {n}/{max} » ; 10 chips (`6px 12px`, 14 px) : Kebab, Steak, Kefta, Poulet, Tikka, Tandoori, Cordon bleu, Nuggets, Merguez, Tenders. Multi-sélection **plafonnée au max de la taille** ; au plafond, les chips non choisies passent à `opacity: .4` (toujours cliquables pour désélection).
3. **« Gratiné ? »** — `OptionRow` case à cocher « Ajouter le tacos gratiné » / sous-texte « Fromage fondant doré » / prix **+1,50 €** (M et L) ou **+2,00 €** (XL et XXL), recalculé selon la taille.
4. **« La recette »** (hint « crudités au choix ») — `ModsPicker` (identique).
5. **« Sauces »** (hint « offert ») — 11 chips identiques.
6. **« Suppléments »** (hint « en option ») — liste d'`OptionRow` cochables, 3 groupes tarifaires :
   **+1,00 €** : Cheddar, Chèvre, Bleu, Boursin, Miel, Œuf, Reblochon, Raclette, Camembert · **+1,50 €** : Lardons, Bacon, Jambon de dinde, Chorizo · **+0,80 €** : Champignons, Avocat, Poivrons, Aubergine, Oignons frits.
7. **« La bonne affaire »** — `MenuUpsell` (+2,50 €).

Prix : `unit = prixTaille + Σ suppléments + gratiné + (menu ? 2,50 : 0)` ; total = `unit × qty`.
**Validation** : CTA désactivé tant que `viandes.length ≠ max` ; libellé alors « **Choisis {max} viande(s)** ».

**`OptionRow`** (ligne cochable partagée) : bouton pleine largeur padding `10px 0`, `border-bottom: 1px solid var(--cf-line-2)` ; case 24 × 24 (radius 7, ou 50 % en mode radio), bordure `2px` `--cf-line` → cochée : fond + bordure `--cf-accent` avec `check` 15 px `--cf-on-accent` ; libellé cond 600 16 ink + sous-texte cond 13 muet ; prix à droite cond 700 15 accent « +{x} € ».

**Pied de sheet (`SheetFooter`)** — sticky bottom, padding `12px 18px calc(12px + env(safe-area-inset-bottom))`, fond `--cf-cream`, `border-top: 1px solid var(--cf-line)` : **Stepper** (min 1) + `Btn primary` extensible : « **Ajouter · {total}** » (création) ou « **Enregistrer · {total}** » (édition de ligne).

**À l'ajout** : construit la ligne de panier avec `options` groupées — Taille, Viandes, Suppléments, Recette, Gratiné, Sauces, Menu (chaque option : `{group, label, price}`) — plus un `state` interne (indices/sélections brutes) permettant de **rouvrir la config pré-remplie**. En édition, la ligne est remplacée **en conservant son `lineId`**. Tacos : nom de ligne surchargé « Tacos {M|L|XL|XXL} ». Toasts : « Ajouté au panier » / « Ligne modifiée » (générique), « Tacos ajouté 🌯 » / « Tacos modifié » ; icône `cart` (ajout) ou `check` (édition). Fermeture de la sheet après action.

⚠️ **Bug maquette à corriger en prod** : dans `GenericBuilder`, le prix de base de la ligne est le prix de la taille choisie **et** une option « Taille » portant l'écart de prix (`taille − taille de base`) est ajoutée ⇒ le panier **double-compte l'écart de taille** (l'affichage de la sheet, lui, est correct). En production : porter l'écart **soit** dans le prix de base, **soit** dans l'option, jamais les deux (le `TacosBuilder` fait correctement : option Taille à prix 0).

### 5.4 Panier (`cart`)

`ScreenScaffold`, titre « **Mon panier** », pas de bouton retour (onglet).

**État vide** : zone centrée (h 70 %, gap 14, padding 24) — icône `cart` 54 px trait 1.4 couleur `--cf-line`, « Ton panier est vide. / Il n'attend que ton tacos. » (cond 18 muet), `Btn primary` icône `arrow` « **Voir le menu** ».

**État plein** — corps :

1. **Lignes** (`CartLine`, gap 10) : carte soft padding 12 — vignette 46 × 46 radius 10 (icône 26) ; nom cond 17 ; **total ligne** (`Money` 15) = `(base + Σ options) × qty` ; récap options cond 13 muet, labels joints par « · » ; rangée basse : **Stepper min 0** (0 ⇒ suppression) + bouton « **Modifier** » (pill outline `1.5px solid var(--cf-line)`, padding `6px 12px`, cond 700 13 — affiché si le produit existe au catalogue ; **rouvre la sheet pré-remplie via `line.state`**) + bouton corbeille 34 × 34 transparent (`trash` 18, muet, `aria-label="Retirer"`).
   ⚠️ Une ligne ajoutée sans configuration (upsell, « Recommander ») a `options: []` et pas de `state` : « Modifier » rouvre la config **aux valeurs par défaut** — comportement de fusion **à définir**.
2. **Code promo** — eyebrow « Code promo » ; rangée : input placeholder « Ex : CLASS10 » (saisie forcée en MAJUSCULES) + `Btn ghost` « **OK** ». Application : trim + uppercase, lookup dans le référentiel promos ; toast « Code appliqué 🎉 » (check) ou « Code invalide » (close). Dessous, **chips raccourcis** listant tous les codes disponibles (12 px) — tap = applique directement.
   Référentiel maquette : `CLASS10` = −10 % (min 0) · `BIENVENUE` = −3 € (min 15 € de sous-total) · `MENU250` = type « label », **aucune remise calculée** (« Menu +2,50 € au lieu de +3,50 € » — mécanique réelle **à définir**). Un seul code actif à la fois (le dernier appliqué remplace). Retrait d'un code appliqué : **à définir** (pas d'UI).
3. **Instructions cuisine** — eyebrow « Instructions pour la cuisine » ; textarea 2 lignes, placeholder « Ex : sans oignons, sauce à part… », cond 15, resize désactivé. Persistée dans la commande (`note`).
4. **Upsell « On complète ? »** — rangée horizontale scrollable de 6 tuiles **108 px** (fond `--cf-paper`, bordure 1 px, radius 12, padding 10) : icône 24, nom cond 600 14, prix cond 700 13 accent. Contenu : 6 premiers produits des catégories `boissons` + `desserts`. Tap = **ajout direct** (qty 1, sans options) + toast « Ajouté ».

**Footer récapitulatif** (colonne gap 10) :
- « Sous-total » (cond 16) / montant (`Money` 17).
- Si remise code : ligne verte « Promo {CODE} » / « −{montant} » (couleur `--cf-green`).
- Si récompense fidélité activée : ligne verte « Récompense fidélité » / « −3,00 € ».
- « **Total** » (display 18) / montant (`Money` **22**). `total = max(0, sous-total − remise − récompense)`.
- Encart fidélité : fond `--cf-cream-2`, radius 10, padding `7px 12px`, étoile 15 px gold remplie : « +{round(total)} points fidélité sur cette commande ».
- CTA `Btn primary block` icône droite `arrow` : « **Choisir le retrait** » → `pickup`.

### 5.5 Créneau de retrait (`pickup`)

`ScreenScaffold`, titre « **Retrait** », retour → panier. Footer : CTA `Btn primary block` icône droite `arrow`, **désactivé tant qu'aucun choix valide**, libellé dynamique : « **Continuer · au plus tôt (~12 min)** » (mode ASAP) / « **Continuer · retrait {HH:MM}** » (créneau choisi) / « **Choisis un créneau** » (mode créneau sans sélection).

1. **Carte lieu** — carte bordure dure padding 14 : disque 46 px accent avec `pin` 24 `--cf-on-accent` ; « {Nom tenant · Ville} » (cond 16) + adresse (cond 13 muet). Mono-établissement ; multi-sites **à définir**.
2. **« Quand veux-tu récupérer ? »** — 2 grosses cartes-boutons égales (bordure `2px solid var(--cf-ink)`, radius 14, padding `13px 14px`, `transition: all .13s`) :
   - **« Au plus tôt »** (icône `fire`) / sous-texte « Prêt dans ~12 min » — **mode par défaut**.
   - **« Planifier »** (icône `clock`) / « Choisir un créneau ».
   - État sélectionné : fond `--cf-ink`, texte crème, icône `--cf-gold`, ombre `--cf-shadow-accent` ; non sélectionné : fond `--cf-paper`, icône accent.
3. **Mode ASAP** — carte info soft (padding 12, gap 10) : `check` 22 vert + « La cuisine lance ta commande **dès validation du paiement**. SMS dès que c'est prêt. »
4. **Mode créneau** — `SectionLabel` « Aujourd'hui · créneaux disponibles » ; **grille 4 colonnes, gap 8** de chips créneaux (centrés, padding `11px 4px`, heure en display 15) :
   - Liste maquette (cadence **15 min**, deux services) : 11:45 · 12:00 · 12:15 · 12:30 · 12:45 · 13:00 · 13:15 · 18:30 · 18:45 · 19:00 · 19:15 · 19:30 · 19:45 · 20:00 · 20:15 · 20:30.
   - **Créneau passé** (heure ≤ maintenant + 12 min) : `disabled`, `opacity: .28`, curseur interdit.
   - **Pastille d'affluence** 6 px à droite de l'heure : **accent = « Créneau chargé »** (maquette : 12:30, 13:00, 19:30, 20:00) · **vert = « Tranquille »** (11:45, 14:00*, 18:30). Légende sous la grille (points 6 px + cond 12,5 muet). *14:00 ne figure pas dans la liste des créneaux — incohérence de la maquette.
   - Sélection exclusive (`.is-on`).
5. **Valider** enregistre `pickup = {date: "Aujourd'hui", asap: bool, slot: "Au plus tôt · ~12 min" | "HH:MM"}` puis → `checkout`.

**Cadence réglable (cible production, cf. handoff)** : les créneaux et l'affluence sont **calculés côté serveur** — capacité paramétrable par le gérant (ex. **6 commandes / 15 min**), renvoyer un état d'affluence par créneau `calm | busy | full` (l'UI des pastilles existe ; l'état `full` = créneau non proposé/désactivé — rendu exact **à définir**). Respecter les fermetures midi lundi & vendredi. Choix d'un autre jour que « Aujourd'hui » : **à définir** (non maquetté).

### 5.6 Paiement (`checkout`)

`ScreenScaffold`, titre « **Paiement** », retour → retrait. Footer : `Btn primary block` icône `check` « **Payer {total}** », **désactivé** tant que `nom` vide ou `téléphone < 8 caractères`.

1. **« Paiement express »** — bouton **Apple Pay** pleine largeur : fond `#000`, texte blanc, radius pill, padding 13, logo  18 px + « Pay » (Archivo 700 16). Dans la maquette, il **passe la commande immédiatement** (nom « Client Apple Pay » si non connecté, téléphone « — », pay `applepay`). En production : feuille Apple Pay / Google Pay via Stripe Payment Request — **à définir**.
2. **Séparateur** « ou payer par carte » — filets latéraux 1 px, texte cond 13 muet.
3. **« Tes coordonnées »** — 2 inputs empilés (gap 10) : « Prénom & nom » (pré-rempli si connecté) · « Téléphone (pour te prévenir) » (`inputMode="tel"`). **Aucun compte requis** — ces deux champs suffisent. Validation : présence + longueur ≥ 8 seulement ; format téléphone réel **à définir**.
4. **« Paiement »** — 2 options radio-cartes (`PayOption`, `transition: all .12s`) :
   - `cb` — « **Carte bancaire** » / « Paiement sécurisé en ligne » (icône `euro`) — **défaut**.
   - `onsite` — « **Payer au retrait** » / « CB ou espèces sur place » (icône `bag`).
   - Anatomie : carte `--cf-paper`, bordure `2px` (`--cf-ink` si sélectionnée, sinon `--cf-line`), ombre dure si sélectionnée ; icône 22 accent ; radio 22 px à droite (cochée : fond accent + check blanc).
5. **Formulaire carte** (si `cb`) — carte soft padding 14 : champ « Numéro de carte » (placeholder « 4242 4242 4242 4242 », `inputMode="numeric"`) ; rangée « Expire » (« 12/28 ») + « CVC » (« 123 ») ; ligne réassurance : `check` 16 vert + « Paiement chiffré · Visa · Mastercard · CB » (cond 13 muet). **Purement visuel** dans la maquette (aucune validation/tokenisation). Production : **Stripe Payment Intents / Stripe Elements**, 3-D Secure, webhooks (cf. §8) — **à définir** au-delà du visuel.
6. **Récap** — carte fond `--cf-cream-2` sans bordure, padding 14 : « Retrait » / « **Aujourd'hui · {slot}** » puis « Total » (display 17) / montant (`Money` 20).

⚠️ Le CTA du footer dit « **Payer {total}** » même quand « Payer au retrait » est sélectionné — libellé conditionnel (« Commander », « Valider ») **à définir**.

**Soumission (`placeOrder`)** — comportement maquette, contrat à reproduire :
- Génère `id` « CF-{1043–1092} » et `pickNo` {43–51} (aléatoires — en prod : séquence serveur, `pickupNo` remis à zéro chaque jour).
- Construit la commande (voir §7.3), **vide** panier/promo/note/récompense, crédite les points (= `round(total)`) **si connecté**, navigue vers `confirm`.
- **Micro-interactions** : toast « **Envoyée en cuisine ✓** » (icône check) + **vibration `navigator.vibrate(60)`** (60 ms, silencieux si non supporté).
- Pousse la commande dans `localStorage["sm_live_orders"]` (file partagée avec les maquettes KDS/caisse/back-office, **plafonnée aux 20 dernières**) — en production : `POST /api/orders` + canal temps réel.
- Aucun état de chargement ni gestion d'échec de paiement dans la maquette — spinners, erreurs Stripe, timeout : **à définir**.

### 5.7 Confirmation & suivi temps réel (`confirm`)

Écran plein sans scaffold (scroll global), sans nav basse.

1. **Bandeau succès** — fond `--cf-accent`, texte `--cf-on-accent`, padding `40px 22px 26px`, centré ; texte fantôme « OK » 150 px (stroke `rgba(255,255,255,0.25)`, opacité .5) ; **médaillon check** 76 px (fond `--cf-cream`, `check` 42 accent trait 3, ombre `0 8px 24px rgba(0,0,0,0.25)`, animation `cf-pop`) ; « **Commande confirmée !** » (display 26 crème) ; « Un SMS te préviendra dès qu'elle est prête. » (cond 16, opacité .92).
2. **Carte numéro de retrait** — carte bordure dure, centrée, padding 20, **chevauche le bandeau** (`margin-top: −44`) : eyebrow « Numéro de retrait » ; **numéro display 62 px accent** ; « Commande {id} · retrait {slot} » (cond 15 muet).
3. **Timeline statuts** — carte soft padding 16, 3 rangées (padding vertical 8) : **Reçue → En préparation → Prête**.
   - Pastille 28 px : **verte** (`--cf-green`) si atteinte — check blanc si dépassée, point blanc 8 px si en cours — grise (`--cf-line`) sinon ; rangées futures à `opacity: .4` ; l'étape courante porte une Pill verte « **En cours** » à droite.
   - **Maquette** : progression simulée par timers — étape 1 à **2 600 ms**, étape 2 à **6 400 ms**. **Production** : abonnement temps réel au statut de la commande (NEW → COOKING → READY), poussé par le KDS ; SMS au passage READY. Étape « Remise/DONE » côté client : **à définir**.
4. **Récap commande** — carte soft : eyebrow « Ta commande » ; lignes « {qty}× » (display 14 accent, min-width 22) + nom (cond 15) ; si note : encart `--cf-cream-2` radius 9 « **Note :** {texte} » (préfixe accent).
5. **Actions** — `Btn ghost block` « **Retour à l'accueil** » ; dessous, cond 13 muet centré : « +{points} points fidélité gagnés 🎉 » (⚠️ affiché même pour un invité alors que les points ne sont crédités que connecté — harmonisation **à définir**).

**Suivi sans compte** : l'accès au suivi repose sur l'état local (aucune authentification). En production : URL `confirmation/[orderId]` accessible par identifiant de commande (+ jeton non devinable — **à définir**).

### 5.8 Carte « commande en cours » (`ActiveOrderCard`, sur l'accueil)

Affichée sur l'accueil tant qu'une `lastOrder` existe (persistance après rechargement : **à définir** — état mémoire seulement dans la maquette).

- Bouton pleine largeur (margin `0 12px 14px`), fond `--cf-ink`, texte crème, radius 14, padding `13px 16px`, ombre `--cf-shadow-accent`.
- Ligne 1 : eyebrow gold 10 px « Commande en cours · {id} » + « **N° {pickNo}** » (display 20 gold).
- **Barre de progression 3 segments** (gap 8, h 5, radius 3) : segments atteints en `--cf-green`, restants `rgba(244,238,225,0.22)`, `transition: background .3s`.
- Ligne 3 : label d'étape (cond 700 14) — « **Reçue — la cuisine s'y met** » / « **En préparation** » / « **Prête — à toi de jouer !** » — + « Retrait {slot} → » (cond 13, crème 70 %).
- **Progression maquette** : dérivée du temps écoulé (timer 1 s) — étape 0 si < 1,5 min, étape 1 si < 7 min, étape 2 ensuite. **Production** : statut réel temps réel.
- Tap → écran de suivi (`confirm`).

### 5.9 Compte / fidélité (`account`) — annexe au parcours

**Non connecté** : logo tenant 40 ; « Bienvenue chez {Nom} » (display 20 centré) ; « Connecte-toi pour cumuler des points & retrouver tes commandes. » ; inputs « Email ou téléphone » + « Mot de passe » ; `Btn primary block` « **Se connecter** » ; `Btn ghost block` « **Créer un compte** » ; lien texte « Continuer en invité → ». (Maquette : les trois actions connectent l'utilisateur de démo ; auth réelle **à définir** — handoff : OTP SMS.)

**Connecté** :
1. **Carte fidélité** — fond `--cf-fill` sombre, texte fantôme « VIP » 120 px ; eyebrow gold « Carte fidélité » ; nom (display 22 crème) + « {points} pts » (display 22 gold) ; **grille de 10 tampons** 26 px (remplis gold avec icône burger 14 ink, vides bordure `rgba(244,238,225,0.3)`) ; « Plus que {10−n} tampons → 1 burger offert 🍔 » (cond 14 gold) ; encart échange : « Échange 200 pts contre **−3 €** » + `Btn gold sm` « **Utiliser** » (désactivé si < 200 pts) → débite 200 pts, active la remise panier, toast « Récompense activée : −3 € » (icône star) ; une fois utilisée : Pill verte « **Activée** ».
2. **« Mes bons plans »** — carrousel de coupons (min-width 170, bordure `2px dashed var(--cf-accent)`, radius 12) : code (display 16 accent) + libellé (cond 14 muet).
3. **« Mes dernières commandes »** — cartes soft : vignette `bag` 42 px ; intitulé + « {id} · {quand} » ; montant + lien « **Recommander** » (cond 700 13 accent) → ré-ajoute les produits retrouvés par nom au panier (qty 1, sans options), toast « {n} article(s) ajouté(s) au panier », navigation panier. (Données mock : CF-1038 « Le Crousty · Canette » 12,50 € Hier · CF-1021 « Tacos sur-mesure · Menu » 17,00 € Il y a 4 j · CF-0994 « Family Box » 42,90 € La semaine dernière.)
4. `Btn ghost block` « **Se déconnecter** ».

---

## 6 · Récapitulatif des micro-interactions

| Interaction | Détail exact |
|---|---|
| Apparition pop | `@keyframes cf-pop` : scale .9→1 + fade, **0,18 s ease both** (`.cf-anim-pop`). Utilisée : barre panier flottante, badge panier (rejouée à chaque changement de compte), toasts, médaillon check de confirmation. Backdrop de sheet : même keyframe à **0,2 s ease**. |
| Ouverture bottom sheet | `@keyframes cf-sheet` : translateY 100 %→0, **0,28 s `cubic-bezier(.2,.8,.2,1)`** (keyframes à déclarer globalement). Pas d'animation de fermeture (à définir). |
| Boutons | transitions **0,12 s** ; press = `translateY(1px)` ; primary hover = `brightness(1.05)` + `translateY(−1px)` ; ghost hover = inversion fond/texte. |
| Chips | `transition: all .12s` ; hover bordure ; sélection inversée. |
| Focus champs | halo `0 0 0 3px` accent à 22 % + bordure texte, **0,12 s**. |
| Toggle « Passer en Menu » | `transition: all .15s` (fond/ombre/couleurs). |
| Cartes mode retrait | `transition: all .13s`. |
| Options de paiement | `transition: all .12s`. |
| Progression commande | segments `transition: background .3s` ; timers démo 2 600 ms / 6 400 ms (confirm) et seuils 1,5 min / 7 min (carte accueil, tick 1 s). |
| Toast | auto-dismiss **2 200 ms** (défaut). |
| Haptique | `navigator.vibrate(60)` à la validation de commande. |
| Scroll | ancrage catégorie `behavior: "smooth"` ; scroll-spy + recentrage du chip actif (`scrollIntoView inline: "center"`) ; reset scroll à chaque navigation. |
| Sons | **Aucun son côté client** (l'alerte sonore est côté KDS). |
| Drag & drop | **Aucun** sur cette surface. |
| Reduced motion | La page hôte SM applique `@media (prefers-reduced-motion: reduce)` → durées d'animation/transition ~0. À généraliser. |
| Divers hôte SM | `::selection` fond `#c9a15a` texte `#000` ; `caret-color: #c9a15a` ; `-webkit-tap-highlight-color: transparent` ; `touch-action: manipulation` sur boutons/liens ; `overscroll-behavior: none`. |

---

## 7 · Données par vue — lectures, écritures, contrats (pour l'API et MongoDB)

### 7.1 Synthèse par vue

| Vue | Lit | Écrit |
|---|---|---|
| Accueil | catalogue (produits `popular`/`available`), favoris, commande en cours + statut, horaires d'ouverture, identité tenant (nom, ville, accent, logo, adresse, téléphones) | — |
| Menu | catalogue complet ordonné (catégories, produits, prix, tailles, badges, dispo, allergènes), favoris | favoris (toggle) |
| Fiche produit | produit + référentiels d'options (tailles tacos, viandes, suppléments + prix, sauces, modificateurs recette, règle gratiné, offre menu +2,50 €) | ligne de panier (création ou remplacement par `lineId`) |
| Panier | panier, référentiel codes promo, catalogue (upsell boissons/desserts, existence produit pour « Modifier ») | quantités, suppressions, code promo appliqué, note cuisine, ajouts upsell |
| Retrait | établissement, créneaux du jour + affluence (serveur en prod), heure courante | choix retrait `{asap, slot}` |
| Paiement | total, retrait choisi, profil (nom si connecté) | **commande** (POST) ; intent de paiement Stripe en prod |
| Confirmation | commande créée, **statut temps réel** | — |
| Carte cmde en cours | commande active + statut | — |
| Compte | profil, points/tampons, promos, historique commandes | session, débit 200 pts (récompense), ré-ajouts panier |

### 7.2 État client & persistance maquette

- **Panier (mémoire)** — ligne :
  ```js
  { lineId: "L…",            // id local unique
    productId, name, icon,
    base: Number,             // prix unitaire de base (€)
    options: [{ group, label, price }],  // Taille · Viandes · Suppléments · Recette · Gratiné · Sauces · Menu
    qty: Number,
    state: { sizeIdx, viandes, sauces, supp, mods, gratine, menu } } // pour ré-ouvrir la config
  ```
  Prix unitaire = `base + Σ options.price` ; sous-total = Σ (unitaire × qty).
- **`localStorage`** : `cf-favs` (map `{productId: 1}`) · `sm_live_orders` (file inter-apps, 20 max) · `cf-tweaks` (theming) · `sm-brand-id` (tenant démo).
- Promo, note, récompense, pickup, user, lastOrder : état mémoire (perdu au refresh — persistance session **à définir**).

### 7.3 Contrat « commande » émis par le client (à transposer en `POST /api/orders`)

Objet poussé dans `sm_live_orders` (lu par les maquettes KDS/back-office — c'est le contrat inter-surfaces de facto) :

```js
{ id: "CF-1057",           // séquence serveur en prod
  pickNo: 47,              // n° de retrait affiché (reset quotidien)
  channel: "En ligne",     // ONLINE | COUNTER | PHONE
  name: "…", phone: "…",   // "Client en ligne" / "—" si absents
  placedAt: 1755512345000, // epoch ms
  slot: "12:30" | "Au plus tôt · ~12 min",
  status: "new",           // new → cooking → ready → done | cancelled
  paid: true,              // ⚠️ maquette : true même pour « payer au retrait » — en prod : PAID_ONLINE | PAY_ON_PICKUP
  total: 23.4,
  note: "sans oignons",
  items: [{ name, qty, opts: [{group,label,price}]?, price /* base unitaire */ }] }
```

Et côté client (`lastOrder`, alimente confirmation + carte accueil) : `{ id, pickNo, slot, total, name, phone, pay: "cb"|"onsite"|"applepay", pointsEarned, placedAt, note, items: [{name, qty}] }`.

### 7.4 Esquisse de collections MongoDB (dérivée de la maquette + handoff §4)

```
tenants        { _id, slug, name, city, accentColor, logo, phones[], address,
                 hours{...}, slotConfig{ cadenceMin: 15, capacityPerSlot: 6 },
                 onlineOrderingPaused: { until: Date, reason } | null }
categories     { _id, tenantId, slug, title, tagline, icon, order }
products       { _id, tenantId, categoryId, slug, name, desc, priceCents|null,  // null ⇒ masqué à la vente
                 sizes[{label, priceCents}], customizer: "tacos"|null,
                 allergens, badges[], isNew, popular, available, icon }
optionSets     { _id, tenantId, kind: "sauces"|"mods"|"tacos", data{...} }      // viandes, supp+prix, gratiné, menu +250
promoCodes     { _id, tenantId, code, type: "pct"|"eur"|"label", value, minCents, label, active }
orders         { _id, tenantId, number: "CF-1057", pickupNo, channel, status,   // NEW→COOKING→READY→DONE | CANCELLED
                 customer{ name, phone }, slot: Date|null /* null = ASAP */,
                 note, payment{ method: "cb"|"onsite"|"applepay", status: "PAID_ONLINE"|"PAY_ON_PICKUP", stripePaymentIntentId },
                 totals{ subtotalCents, discountCents, rewardCents, totalCents, promoCode },
                 items[{ productId, name, qty, basePriceCents, options[{group,label,priceCents}] }],
                 events[{ status, at }], placedAt }
customers      { _id, tenantId, phone, name, points, stamps, favorites[productId] }  // facultatif (sans compte possible)
loyaltyLedger  { _id, customerId, delta, reason, orderId, at }
```

Endpoints minimaux induits par les vues : `GET /menu` (catégories + produits + option sets) · `GET /slots?date=` (créneaux + affluence `calm|busy|full`) · `POST /orders` (+ création PaymentIntent Stripe si CB) · `GET /orders/:id` + **abonnement temps réel** statut · `POST /promo/validate` · favoris & fidélité si compte. Flux paiement (handoff §5) : webhook `payment_intent.succeeded` → confirme la commande, incrémente `pickupNo`, publie sur le canal temps réel `orders`, déclenche l'impression cuisine ; passage `READY` → SMS « Commande prête, n° {pickNo} ».

---

## 8 · Règles métier récapitulées

- **Prix** : TTC, format français « 12,50 € » (`toFixed(2)` + virgule). Produit sans prix (`null`) = invendable.
- **Remises** : `remiseCode` (pct sur sous-total, ou € fixe, si `sous-total ≥ min`) + `récompense fidélité` (−3 € contre 200 pts, une fois par commande) ; `total = max(0, sous-total − remises)`.
- **Fidélité** : 1 point / € du total (arrondi), crédité **si connecté** ; 10 tampons = 1 burger offert (tampon : règle d'attribution **à définir** — handoff : « tampon si burger », au passage DONE).
- **Menu (+2,50 €)** : frites + boisson 33 cl, proposé sur signatures, burgers, classiques, sandwichs, hot dogs, crousty, tacos.
- **Tacos** : nb viandes = taille (M1/L2/XL3/XXL4) ; gratiné +1,50 € (M/L) / +2,00 € (XL/XXL) ; suppléments 0,80/1,00/1,50 € ; sauces et retraits de crudités gratuits.
- **Créneaux** : aujourd'hui uniquement (maquette), cadence 15 min, coupure ≥ 12 min avant l'heure, deux services (11:45–13:15, 18:30–20:30), affluence trois états. Production : capacité/cadence réglables par tenant, calcul serveur.
- **Statuts commande** : `NEW → COOKING → READY → DONE` (+ `CANCELLED`) ; le client voit trois étapes : **Reçue / En préparation / Prête** (vert = atteint).
- **Sans compte** : nom + téléphone suffisent ; le téléphone sert au SMS « prête ».

---

## 9 · Pause commande en ligne — « victime de notre succès »

Fonction décrite dans la FAQ support (Q11) — **aucun écran client maquetté** :

> « Caisse → bouton Pause en ligne (en haut à droite) : 30 min, 1 h, ou jusqu'à demain. Les clients voient "victime de notre succès, revenez à 21h" — pas un site cassé. Ça préserve votre note. »

À spécifier pour la production :
- **Déclencheur** : bouton « Pause en ligne » dans la caisse (POS), durées 30 min / 1 h / jusqu'à demain → écrit `tenants.onlineOrderingPaused {until, reason}`.
- **Effet côté client** : la prise de commande est bloquée (menu consultable ou non : **à définir**) et un message d'attente est affiché avec l'heure de reprise, sur le ton : « Victime de notre succès — revenez à {heure} ». Copy exacte, écran(s) concerné(s) (bandeau héro ? interstitiel ? blocage du CTA panier ?), comportement d'un panier déjà rempli et des commandes déjà passées : **à définir** (rien dans la maquette).
- Le système doit présenter cet état comme volontaire et temporaire (« pas un site cassé »).

---

## 10 · Incohérences maquette & points de vigilance (à corriger en production)

1. **Double comptage du prix de taille** dans `GenericBuilder` (voir §5.3.a).
2. `--cf-line-2` non défini dans le skin light (§3.4).
3. Promo `MENU250` de type « label » : aucune remise appliquée — mécanique réelle à définir.
4. Pastille « Tranquille » configurée pour 14:00, créneau inexistant dans la liste.
5. `paid: true` écrit même en « payer au retrait » ; CTA « Payer » non conditionnel au mode.
6. `id`/`pickNo` générés aléatoirement côté client (collisions possibles) → séquences serveur.
7. « +{points} points fidélité gagnés » affiché aux invités alors que rien n'est crédité.
8. Progression du suivi simulée par minuteries (2,6 s / 6,4 s ; 1,5 min / 7 min) → remplacer par le statut réel.
9. Apple Pay court-circuite coordonnées et paiement.
10. Logique d'ouverture (héro) et créneaux calculés côté client → serveur en production.
11. « Modifier » une ligne sans `state` réinitialise la configuration.
12. Aucun état de chargement, d'erreur réseau ou d'échec de paiement nulle part → à concevoir.

---

## 11 · Liste consolidée des « à définir »

Comportement desktop/tablette · animation de fermeture de la bottom sheet + swipe-to-dismiss · transition de sortie des toasts · limite du nombre de sauces · retrait d'un code promo appliqué · fusion de config pour lignes sans état · multi-établissements · choix de date de retrait (autre qu'aujourd'hui) · rendu du créneau `full` · format/validation du téléphone · intégration Stripe réelle (Elements, 3DS, Google Pay, erreurs) · libellé CTA en mode « payer au retrait » · persistance panier/commande au rechargement (session) · URL de suivi sans compte (jeton) · étape « Remise » côté client · règle d'attribution des tampons · écran/copy exacts de la pause « victime de notre succès » · consultation du menu pendant la pause · auth réelle du compte (OTP SMS) · états d'erreur et de chargement globaux.

---

*Fin de spécification. Les valeurs (px, hex, durées, libellés) sont extraites à l'identique de la maquette ; toute divergence constatée à l'implémentation doit être arbitrée contre les fichiers sources listés en tête de document.*
