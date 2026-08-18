# Spécification — Site vitrine public « Snack Manager »

> **Surface** : site vitrine marketing public de la suite SaaS Snack Manager (multi-tenant, marque grise, fast-foods / snacks indépendants).
> **Cible de production** : Next.js — page statique (SSG) + formulaire de contact et newsletter branchés sur une API.
> **Sources documentées (maquette haute-fidélité)** :
> - `/Users/limameghassene/development/SnackManager/design_handoff_snack_manager/Snack Manager - Site Vitrine.html` (711 lignes)
> - `/Users/limameghassene/development/SnackManager/design_handoff_snack_manager/Snack Manager - Site Vitrine.css` (614 lignes)
> - `/Users/limameghassene/development/SnackManager/Menu Trivolet Redesign (1)/Snack Manager - Site Vitrine.js` (101 lignes)
>
> Ce document est autoporteur : il permet de recréer la surface **sans relire le code de la maquette**. Toute valeur (px, hex, durées, formules) est citée depuis la maquette. Tout comportement absent de la maquette est marqué **« à définir »**.

---

## Sommaire

1. [Vue d'ensemble & squelette de page](#1-vue-densemble--squelette-de-page)
2. [Tokens de design & règles de theming tenant](#2-tokens-de-design--règles-de-theming-tenant)
3. [Head, SEO, favicon, styles globaux](#3-head-seo-favicon-styles-globaux)
4. [Spécification section par section](#4-spécification-section-par-section)
5. [Inventaire des composants & états](#5-inventaire-des-composants--états)
6. [Interactions, micro-interactions & JS de comportement](#6-interactions-micro-interactions--js-de-comportement)
7. [Données lues / écrites — API & modèle MongoDB](#7-données-lues--écrites--api--modèle-mongodb)
8. [Copy exact (récapitulatif)](#8-copy-exact-récapitulatif)
9. [Accessibilité & reduced motion](#9-accessibilité--reduced-motion)
10. [Écarts, anomalies de la maquette & points « à définir »](#10-écarts-anomalies-de-la-maquette--points--à-définir)

---

## 1. Vue d'ensemble & squelette de page

Page unique (one-page) à défilement vertical, fond noir intégral, avec navigation par ancres. Ordre exact des blocs dans le DOM :

| # | Bloc | Sélecteur / id | Ancre |
|---|------|----------------|-------|
| 0 | Header fixe « encoche » | `header.site-head` | — |
| 1 | Hero (carrousel 3D en fond) | `.hero` | `#top` (sur `<main>`) |
| 2 | Ticker de fonctionnalités | `.ticker-wrap` | — |
| 3 | Intro (watermark « ×2 ») | `.intro` | `#intro` |
| 4 | Bandeau de preuve (4 chiffres) | `.proof-band` | — |
| 5 | Simulateur ROI « postes économisés » | `.sim-section` | `#simulateur` |
| 6 | Méthode en 3 étapes | `.proc-section` | `#pourquoi` |
| 7 | Bento « Une plateforme, quatre métiers » | `.section#produit` | `#produit` |
| 8 | Catalogue app par app (4 colonnes) | `.cat-section` | `#catalogue` |
| 9 | Démo 3D navigable (iframes) | `.demo-section` | `#demo` |
| 10 | Revenus additionnels (2 offres) | `.section#revenus` | `#revenus` |
| 11 | Avant / après (slider + collage photos) | `.section` (sans id) | — |
| 12 | « Pourquoi nous » (escalier + pilier logo) | `.section` (sans id) | — |
| 13 | Vignettes « Le quotidien » (carrousel) | `.vg-section` | `#temoignages` |
| 14 | « Né au comptoir » (Class'Food) | `.fd-section` | `#pilote` |
| 15 | Comparatif Sans vs Avec | `.cmp-section` | — |
| 16 | Tarifs + offre fondateur | `.section#tarifs` | `#tarifs` |
| 17 | FAQ (accordéon) | `.faq-section` | `#faq` |
| 18 | CTA final + formulaire contact | `.cta-section` | `#contact` |
| 19 | Footer (carte à encoche + newsletter) | `footer .foot-card` | — |
| 20 | Barre sticky « Offre fondateur » | `#stickybar` (hors `<main>`) | — |

**Liens de navigation** (header desktop + menu mobile + footer) : `Produit → #produit`, `Expertise → #pourquoi`, `Revenus → #revenus`, `Tarifs → #tarifs`, `Contact → #contact`. Le logo pointe vers `#top`.

**Grille générale** :
- Largeur de contenu : `--content-width: 1200px` ; padding horizontal `--section-pad-x: 40px` (**20px** ≤ 809.98px).
- `.section` : flex column, centré, `gap: 40px`, `padding: 90px var(--section-pad-x)` (**70px** vertical ≤ 809.98px).
- `.section-head` : flex column centré, `gap: 18px`, `max-width: 650px`, texte centré.
- Largeurs max spécifiques : 1154px (bento, catalogue, démo, bf-grid, footer-card), 1147px (vignettes), 1120px (process, avant/après), 1000px (simulateur, fd-card), 900px (revenus), 880px (contact), 826px (comparatif), 680px (stickybar).

**Breakpoints utilisés** (max-width) : `1199.98px`, `1099.98px` (chips live hero), `1023.98px` (catalogue 2 col.), `809.98px` (breakpoint mobile principal), `639.98px` (catalogue 1 col., texte stickybar masqué).

---

## 2. Tokens de design & règles de theming tenant

### 2.1 Couleurs (variables CSS `:root`)

| Token | Valeur | Usage |
|-------|--------|-------|
| `--black` | `#000` | Fond de page, texte sur accent |
| `--white` | `#fff` | Texte principal, boutons clairs |
| `--gray` | `#999` | Texte secondaire (body, sous-titres) |
| `--accent` | `#c9a15a` | **Accent de marque (or)** — remplaçable par tenant |
| `--link-hover` | `#e0b96f` | Hover des liens (dérivé clair de l'accent) |
| `--card` | `#111` | Fond des cartes pleines |
| `--badge-bg` | `#1a1a1a` | Fond badges, pills, flèches |
| `--btn-dark` | `#262626` | Bouton sombre |
| `--surface-3` | `rgba(255,255,255,.03)` | Surface très légère |
| `--surface-6` | `rgba(255,255,255,.06)` | Surface légère, bordures de cartes |
| `--border-10` | `rgba(255,255,255,.1)` | Bordures |
| `--watermark` | `rgba(255,255,255,.18)` | Watermark « ×2 » |
| `--white-30` / `-50` / `-70` / `-80` | `rgba(255,255,255,.3/.5/.7/.8)` | Nuances de blanc |
| `--green` | `#3fae4a` | **Fonctionnel : prêt / positif / en ligne** — FIXE |
| `--red` | `#c94b3f` | **Fonctionnel : alerte / négatif** — FIXE |
| `--orange` | `#e0973f` | **Fonctionnel : préparation / correctif** — FIXE |
| `--seam` | `#050505` | Ombres de « couture » du notch header |
| `--card-gradient` | `linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)` | Fond cartes dégradées |
| `--footer-gradient` | `linear-gradient(114deg, rgba(255,255,255,.2) 0%, rgb(17,17,17) 11.42%, rgba(17,17,17,.51) 80.04%, rgba(255,255,255,.2) 100%)` | Fond carte footer |

### 2.2 Règles de theming tenant (marque grise)

- **L'accent `#c9a15a` est la couleur de marque remplaçable.** En production, exposer un token unique (ex. `--accent`) + son hover dérivé (`--link-hover`, ici +~10% de luminosité).
- **Les couleurs fonctionnelles sont fixes et non-themables** : vert `#3fae4a` = prêt/validé, rouge `#c94b3f` = alerte/erreur, orange `#e0973f` = préparation/correctif. Elles portent du sens opérationnel (KDS, statuts) et ne doivent jamais suivre la marque.
- **Attention** : la maquette code en dur la valeur RGB de l'accent (`201,161,90`) dans de nombreux `rgba(...)` (halos, spotlights, bordures d'offre fondateur, sélections, scrollbars, dégradés d'avatars, graphique back-office, keyframes `chipPulseGold`). En production, dériver ces alphas du token accent (ex. `color-mix()` ou variables `--accent-rgb`) pour que le re-theming tenant soit complet. Liste des occurrences en dur : `.spot::after` (.09), `.fd-card::before` (.09), `.pr-founderbar` (.14/.03, bordure .5), `.sim-flowstep:last-child` (.16, bordure .4), `.cat-col:hover` (.4), `.cmp-headpill.right` (.45/.35/.22), `.pr-card:hover` (.35), `.pr-card.popular` (.18), `dot-pulse` (.5), `#sm-exp-grad` (.28), `.ag-avatar`/`.chat-avatar` (dégradé `var(--accent)` → `#5a4526`), `.bf-halo` (.8), `.cta-line` (extrémités `rgba(201,161,90,0)`), favicon (`%23c9a15a`), `:focus-visible` (`#c9a15a`), `::selection`, `caret-color`, scrollbar hover (`rgba(201,161,90,.5)`).
- Cette page vitrine est la marque **Snack Manager elle-même** (or/noir). Le theming tenant s'applique aux produits (POS, KDS, commande en ligne) montrés en iframe — pas à cette page. **À définir** : si la vitrine doit exister en version co-brandée par revendeur.

### 2.3 Typographie

Fonts Google chargées : **Inter** (400, 500, 600, 700, 800) et **ADLaM Display** (logo wordmark). `--font-main:'Inter',sans-serif` ; `--font-logo:'ADLaM Display',sans-serif`. `-webkit-font-smoothing: antialiased` sur body.

| Classe | Desktop | ≤1199.98px | ≤809.98px | Graisse | Letter-spacing | Line-height |
|--------|---------|------------|-----------|---------|----------------|-------------|
| `.h1` | 70px | 56px | 45px | 600 | −.04em | 1em |
| `.h2` | 46px | 37px | 29px | 600 | −.04em | 1em |
| `.h3-display` | 54px | 43px | 25px | 600 | −.04em | 1.1em |
| `.h4` | 22px | — | — | 600 | −.04em | 1.4em |
| `.h5` | 18px | — | — | 600 | −.04em | 1.4em |
| `.h6` | 16px | — | — | 600 | −.02em | 1.4em |
| `.subheading` | 18px | — | 16px | 500 | −.02em | 1.4em, couleur `--gray` |
| `.body-text` | 16px | — | — | 500 | −.02em | 1.5em, couleur `--gray` |
| `.ui-link` | 14px | — | — | 500 | −.02em | 1.2em |

`.h1`, `.h2` : `text-wrap: balance`. Chiffres : `font-variant-numeric: tabular-nums` (compteurs, simulateur, outputs).

Mise en emphase dans le corps de texte : `.kw` = accent + 600 (mot-clé doré), `.kw-w` = blanc + 600, `.body-text strong` = blanc 600.

### 2.4 Rayons de bordure

20px (hero-frame, proc-card, foot-card, bf-pillar) · 19px (bf-pillarinner) · 18px (sol-card, ct-card) · 17px (faq-item, bf-tile) · 16px (proof-grid, sim-controls/results, pr-card, cat-col, vg-card, demo-frame, cmp-col, stickybar-in, bf-tileinner, fd-card) · 14px (mock-panel, hero-chip, hero-democard, sim-flow, pr-founderbar, coin d'encoche `border-radius:0 0 14px 0`, foot-notchcontent `0 0 14px 14px`) · 13px (mock-panelinner) · 12px (sol-mockup, vg-media, fd-portrait, cs-collage image-slot, pastille accent du badge, bf-logoborder) · 11px (bf-logoholder) · 10px (wf-node, upd-changelog, champs de formulaire contact, bulles chat `10px 10px 2px 10px` / `10 10 10 2`) · 8px (int-more, bf-iconholder, hover cat-item/cmp-li) · 6px (wf-icon) · 5px (upd-arrowbtn) · 50px (boutons `.btn`, chips, pills, mk-chip, chat-tag) · 24px (foot-input) · 20px (badge, fd-fact, sim-flowstep, demo-pill, pr-founderchip, pr-seatlabel) · 19px (foot-subscribe) · 99px (scrollbar thumb) · 2px (barres de progression).

### 2.5 Espacements récurrents

Gaps de grille : 20px (bento, pricing, sim-board), 24px (proc-grid), 14px (catalogue, formulaire), 16px (bf-grid), 12px (boutons hero, FAQ list, cs-collage), 10px (vg-track), 60px (cs-wrap, faq-grid, foot-columns), 62px (cmp-cols), 34px (ct-card), 28px (fd-card). Padding cartes : 28px (pricing, sim), 22px 20px (catalogue), 32px (ct-card), 15px (sol-card), 16px (fd-card), 10px (vg-card).

---

## 3. Head, SEO, favicon, styles globaux

- `<html lang="fr">`, `<meta charset="UTF-8">`, viewport standard.
- **Title** : `Snack Manager — On fait tourner votre restaurant. Pas l'inverse.`
- **Meta description** : `Caisse, cuisine, commande en ligne et back-office pour snacks indépendants. 0 % commission, marque blanche, lancement accompagné.`
- **Open Graph** : `og:title` = `Snack Manager — le système d'exploitation des snacks indépendants` ; `og:description` = `Caisse, cuisine, commande en ligne et back-office. 0 % commission, marque blanche.` ; `og:type` = `website` ; `og:site_name` = `Snack Manager`. **À définir** : `og:image`, `og:url`, canonical.
- `<meta name="theme-color" content="#000000">`.
- **Favicon** : SVG inline en data-URI — rectangle 64×64 noir, `rx=14`, lettre « S » Arial 800 32px couleur `#c9a15a`, centrée (`x=32 y=44`).
- **Fonts** : preconnect `fonts.googleapis.com` + `fonts.gstatic.com` (crossorigin) ; feuille `Inter:wght@400;500;600;700;800` + `ADLaM Display`, `display=swap`.
- `<script src="image-slot.js">` dans le head : custom element `<image-slot>` (emplacements photo). Fichier non fourni dans le handoff — comportement **à définir** (voir §10). Usage observé : attributs `id`, `fit="cover"`, `placeholder="…texte…"`.
- **Styles globaux inline (head)** :
  - `:focus-visible { outline: 2px solid #c9a15a; outline-offset: 2px }`
  - `@media (prefers-reduced-motion: reduce)` : toutes animations/transitions à `.01ms`, `scroll-behavior: auto`.
  - `::selection { background:#c9a15a; color:#000 }` (doublé dans le CSS avec les tokens).
  - `-webkit-text-size-adjust: 100%` ; `-webkit-tap-highlight-color: transparent` sur `*` ; `touch-action: manipulation` sur `button, a` ; `caret-color: #c9a15a` sur `input, textarea`.
  - Scrollbar WebKit : 10px, track transparent, thumb `rgba(255,255,255,.14)` radius 99px avec bordure 2px transparente (`background-clip: content-box`), hover `rgba(201,161,90,.5)`.
  - `html { color-scheme: dark; scroll-behavior: smooth }` — ce style inline (déclaré après la feuille) **écrase** le `scroll-behavior: auto` du fichier CSS : la navigation par ancres est fluide.
- **Reset CSS** : `* { margin:0; padding:0; box-sizing:border-box }` ; `a` sans décoration héritant la couleur ; `button` sans style natif ; listes sans puces ; `img,video { max-width:100%; display:block }` ; `body { background:#000; overflow-x:hidden }`.

---

## 4. Spécification section par section

### 4.0 Header — « encoche extensible » (desktop) / barre + burger (mobile)

**Position** : `position: fixed; top: -1px; left:0; right:0; z-index: 60`.

**Desktop (`.hd-desktop`, > 809.98px)** :
- `.hd-strip` : bande noire pleine largeur, hauteur **23px** (alignée sur le padding 23px du hero → effet de cadre continu).
- `.hd-row` : flex centré, `margin-top:-1px`. De part et d'autre du bloc central : deux SVG `notch-fillet` **87×34px** (courbe `M 0 0 C 45.98 0 37 34 87 34 L 87 0 Z`, fill `#000`), le droit en `scaleX(-1)` — ils dessinent les épaules arrondies de l'encoche.
- `.hd-mid` : hauteur **34px**, fond noir, **largeur repliée 48px** (seul le logo est visible). `box-shadow: -2px 0 0 0 #050505, 2px 0 0 0 #050505, 0 -2px 0 0 #050505` (coutures). Transition `width .45s cubic-bezier(.16,1,.3,1)`.
- **Hover sur `.hd-desktop`** → `.hd-mid { width: var(--hd-open-w, 420px) }` : l'encoche s'étire et révèle les liens.
- Liens : 2 groupes `.hd-links` (gauche : Produit, Expertise — justifiés à droite ; droite : Revenus, Tarifs, Contact — justifiés à gauche), gap 16px, autour du logo central (SVG 25×25, blanc, lien `#top`, `aria-label="Accueil"`). État replié des liens : `opacity:0; filter:blur(4px); transform:scale(1.05)` → au hover `opacity:1; blur(0); scale(1)`, transitions `.25s`. Couleur liens : blanc, hover `#e0b96f`.
- **Largeur d'ouverture calculée en JS** (`fitNotch`) : `total = max(largeurGroupe1, largeurGroupe2) × 2 + largeurLogo + 16×2 + 36` (px), où chaque largeur de groupe = somme des `offsetWidth` des liens + 16px × (n−1). Posée dans `--hd-open-w`. Recalculée à `document.fonts.ready`, `window.load` et `resize`.

**Mobile (`.hd-mobile`, ≤ 809.98px)** :
- Barre 58px, padding `0 20px`, fond noir : logo 25×25 à gauche, bouton burger à droite (`aria-label="Menu"`).
- Burger : 3 `<span>` 20×2px, radius 2px, gap 4px, padding 8px. État `.open` : span 1 `rotate(45deg) translate(4px,4px)`, span 2 `opacity:0`, span 3 `rotate(-45deg) translate(4px,-4px)` ; transitions `.3s`.
- Menu (`.hd-mobilemenu`) : colonne, gap 20px, padding `0 20px 24px`, liens 18px ; fermé `max-height:0`, ouvert `.open { max-height: 320px }`, transition `max-height .35s ease`. Toggle au clic burger (JS). **À définir** : fermeture au clic sur un lien / au clic extérieur (absent de la maquette).

### 4.1 Hero (`#top` sur `<main>`)

**Layout** : `height: 100svh; min-height: 640px` (**560px** mobile) ; `padding: 23px` ; `.hero-frame` interne `border-radius: 20px; overflow: hidden`, fond noir.

**Couches (z-order)** :
1. `.hero-demo` (fond, `aria-hidden`) : carrousel 3D d'iframes, `perspective: 1400px`, `overflow: hidden`.
2. `.hero-blur` (z1) : `backdrop-filter: blur(7px)` + `background: rgba(0,0,0,.52)`.
3. `.hero-veil` (z2) : `rgba(255,255,255,.1)` plein cadre.
4. `.hero-shade` (z2) : `linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,.75) 100%)`.
5. `.hero-content` (z2) : contenu centré (flex column, centré, texte centré, padding `0 20px`).
6. `.hero-live` (z3) : chips « live » en bas à droite.

**Carrousel 3D de fond** (script inline n°1) :
- 4 iframes vers les maquettes produit, chargées avec `?embed=1`, `loading="eager"`, `tabindex="-1"`, `title=""`, `pointer-events: none` : `SM - Back-office Restaurant.html`, `SM - Caisse (POS).html`, `SM - App Cuisine (KDS).html`, `SM - Commande en ligne.html`.
- `.hero-democard` : `width: min(900px, 74%)` (**130%** mobile), `aspect-ratio: 16/10`, radius 14px, centrée (`top:50%; left:50%`), transition `transform 1.4s cubic-bezier(.2,.8,.2,1), opacity 1.4s`. Fond iframe `#0b0c0e`.
- 4 états : `.hd-center` `translate(-50%,-50%) translateZ(0) rotateY(0)`, opacity **.85**, z3 · `.hd-left` `… translateX(-52%) translateZ(-380px) rotateY(24deg)`, opacity .4, z2 · `.hd-right` symétrique `rotateY(-24deg)` · `.hd-hidden` `… translateZ(-700px)`, opacity 0, z1.
- Avance automatique : `setInterval` **4500ms**, offset circulaire (`off = ((k-cur)%N+N)%N`, replié au-delà de N/2).

**Contenu** :
- Badge : pastille accent `Nouveau` + texte `Conçu par des restaurateurs`.
- H1 (`.hero-title`, max-width 820px, margin-top 24px) : `On fait tourner votre restaurant.` ⏎ `Pas l'inverse.`
- Sous-titre (`.hero-sub`, max-width 460px — 400px mobile, margin-top 20px) : `Caisse, cuisine, back-office et commande en ligne réunis dans une seule plateforme — à vos couleurs, pensée par des gens qui ont tenu le comptoir.` (`une seule plateforme` et `tenu le comptoir` en `.kw-w` blanc ; `à vos couleurs` en `.kw` accent).
- Actions (margin-top 32px — 28px mobile, gap 12px) : bouton **light** `Demander une démo` → `#contact` ; bouton **dark** `Explorer la démo` → `#demo`.
- Ligne de confiance (`.hero-trust`, margin-top 22px, 13px, `rgba(255,255,255,.72)`, séparateurs points 3×3px `rgba(255,255,255,.35)`) : `Sans engagement` · `Installé en quelques jours` · `Testé en service réel 7 j/7`.

**Chips « live »** (`.hero-live`, `aria-hidden`, masquées ≤ 1099.98px) :
- Zone `360×72px`, ancrée `right:44px; bottom:44px`, `pointer-events:none`. 3 chips superposées (`inset:0`) qui se relaient.
- Style chip : fond `rgba(10,10,10,.72)`, bordure `--border-10`, radius 14px, padding `13px 16px`, `backdrop-filter: blur(12px)`, gap 12px.
- Animation `heroChip` **13.5s infinite**, delays `0s / 4.5s / 9s` : 0% `opacity:0; translateY(14px)` → 4% visible → 30% visible → 34% `opacity:0; translateY(-10px)` → 100% invisible. (Chaque chip est donc visible ~3,5s, enchaînement continu.)
- Pastille 9px : verte par défaut, animation `chipPulse` 2s (halo `box-shadow 0 0 0 0 rgba(61,145,102,.45)` → `0 0 0 8px` transparent à 70%) ; variante `.gold` : fond accent, keyframes `chipPulseGold` (mêmes étapes avec `rgba(201,161,90,.45)`).
- Texte : titre 13.5px blanc 600 nowrap ; sous-texte 12px `--gray`, ellipsé.
- Contenus exacts :
  1. (vert) **Commande en ligne · 18,90 € payée** / `Ticket parti en cuisine — sans passer par la caisse`
  2. (or) **Cuisine · 3 frites à lancer** / `Agrégé sur toutes les commandes en cours`
  3. (vert) **N°42 prête en 11 min** / `Sticker sac imprimé, client prévenu`

### 4.2 Ticker de fonctionnalités (`.ticker-wrap`)

- Bande de raccord sous le hero : hauteur **52px** (44px mobile), `margin-top: -75px` (−67px mobile), `margin-bottom: 23px`, `pointer-events: none`, `aria-hidden`, z2.
- Épaules : 2 SVG notch 87×34 (56×22 mobile) retournés (`scaleY(-1)` ; droit aussi `scaleX(-1)`).
- Fenêtre centrale `.ticker-mid` : **330px** (200px mobile), fond noir, masque horizontal `linear-gradient(to right, transparent 0%, black 12.5%, black 87.5%, transparent 100%)`.
- Piste : flex gap 34px, `width: max-content`, animation `ticker-scroll` **16s linear infinite** → `translateX(-50%)`. Items dupliqués ×2 pour la boucle parfaite.
- Item : 12.5px 600 `--white-70`, point vert 5×5px. Libellés : `Cuisine (KDS)` · `Caisse (POS)` · `Back-office` · `Site & commande`.

### 4.3 Intro — watermark « ×2 » (`#intro`)

- `padding: 180px var(--section-pad-x)` (140px ≤1199.98px, 90px mobile), `overflow: hidden`.
- Watermark `.intro-watermark` (aria-hidden) : texte `×2`, centré absolu, `font-size: min(28vw, 320px)`, 800, letter-spacing −.04em, couleur `rgba(255,255,255,.18)`, opacity .9, `pointer-events:none; user-select:none`, z1.
- Titre `.h3-display .intro-heading` (z2, max-width 800px, centré, `text-wrap: balance`) en **texte dégradé** : `background-image: linear-gradient(0deg, var(--gray) 0%, var(--white) 84%)` + `background-clip: text`, couleur transparente.
- Copy : `On vous fait économiser un poste entier — parfois deux — chaque mois, en réorganisant le travail plutôt qu'en l'ajoutant.`
- Le bloc titre est un `.rv` (révélation au scroll, §6.1).

### 4.4 Bandeau de preuve (`.proof-band`, `aria-label="La preuve en chiffres"`)

- Conteneur : `padding: 0 40px 84px` (0 16px 64px mobile). Grille `.proof-grid` (`.rv`) : 4 colonnes égales (2×2 mobile), max 1200px, bordure `--surface-6`, radius 16px, fond `--card-gradient`, `overflow:hidden`. Items : `padding: 28px 26px`, séparés par `border-left` (mobile : `border-top`, règles de suppression sur 1ʳᵉ rangée/colonne).
- `.proof-num` : 40px (30px mobile) 600, **couleur accent**, tabular-nums. `.proof-label` : 13.5px `--gray`. `.proof-src` : 11px uppercase, letter-spacing .06em, opacity .6.
- **Compteurs animés** : `<span data-count="35" data-prefix="−" data-suffix=" %">` etc. — animation JS au scroll (§6.8) : durée **1100ms**, easing ease-out cubique `p = 1−(1−p)³`, déclenchée à 50% de visibilité, une seule fois. `prefers-reduced-motion` → valeur finale immédiate.
- Contenus exacts :
  | Chiffre | Label | Source |
  |---|---|---|
  | `−35 %` | `d'erreurs de commande avec la prise en ligne` | `Deliverect, 2023` |
  | `+15 %` | `de panier moyen sur les commandes en ligne` | `bas de fourchette des études` |
  | `60 min` | `pour former une recrue à la caisse` | `constaté au restaurant pilote` |
  | `7 j/7` | `testé en service réel, midi et soir` | `Class'Food — Normandie` |

### 4.5 Simulateur ROI (`#simulateur`) — argument « postes économisés »

**En-tête** : badge `Le calcul` ; H2 centré (max 620px) : `Combien vous coûte votre organisation actuelle ?` ; paragraphe `.sim-esc` (`.rv`, max 620px, centré) : `Sans vrai POS, tout repose sur des feuilles griffonnées et des totaux calculés de tête. Une commande mal relue, c'est un plat refait : ≈ 5,75 € à la poubelle. Deux par service, midi et soir, 7 j/7 : ≈ 700 € par mois — sans compter les heures passées à former chaque nouvelle recrue à « votre » caisse. Faites le calcul avec vos chiffres :` (les montants en `strong` blanc).

**Board** (`.sim-board`, `.rv`) : grille `1.1fr / 1fr`, gap 20px, max 1000px (1 colonne mobile), `align-items: stretch`.

**Colonne gauche — contrôles** (`.sim-controls` : fond `--card-gradient`, bordure `--surface-6`, radius 16px, padding 28px, gap 22px). 5 sliders `input[type=range]` :

| id | Label | Hint (`.sim-hint`, 12.5px gray) | min | max | step | défaut | Output initial |
|----|-------|--------------------------------|-----|-----|------|--------|----------------|
| `s-cmd` | `Commandes par jour` | — | 20 | 300 | 5 | 80 | `80` |
| `s-panier` | `Panier moyen` | — | 6 | 25 | 0.5 | 11.5 | `11,50 €` |
| `s-err` | `Commandes refaites par semaine` | `écriture mal relue, oublis, erreurs de prix` | 0 | 30 | 1 | 6 | `6` |
| `s-mins` | `Minutes perdues par service en coordination` | `totaux calculés de tête, déchiffrage, re-annonces en cuisine` | 0 | 60 | 5 | 20 | `20 min` |
| `s-tel` | `Commandes par téléphone par jour` | `décrochés en plein rush — en caisse, ou par quelqu'un qui quitte son poste` | 0 | 40 | 1 | 12 | `12` |

- En-tête de contrôle : label 14.5px blanc à gauche, `<output>` 15px 600 **accent** tabular-nums à droite (baseline).
- Style slider : piste 4px radius 2px fond `--surface-6` ; **thumb WebKit 18px** rond accent, bordure 3px noire + anneau `box-shadow 0 0 0 1px var(--accent)` ; thumb Firefox 12px même style.

**Colonne droite — résultats** (`.sim-results` : fond `--card`, bordure `--surface-6`, radius 16px, padding 28px) :
- `.sim-reslabel` : `RÉCUPÉRABLE CHAQUE MOIS` (13px 600 uppercase letter-spacing .06em gray).
- `.sim-resbig` `#r-total` : **52px** (42px mobile) 600 accent, tabular-nums. Valeur initiale HTML `—` (remplacée au premier `calc()` au chargement).
- `.sim-resyear` : `soit <b id="r-year">—</b> par an, CA additionnel du panier en ligne inclus` (14px gray, `b` blanc).
- Lignes de détail (`.sim-resrow`, 14px, padding 11px 0, bordures `--surface-6` haut+bas, valeur `b` blanche nowrap) :
  1. `Erreurs évitées (−35 %)` → `#r-err`
  2. `Totaux, déchiffrage & re-annonces supprimés` → `#r-coord`
  3. `Téléphone déchargé — appels + interruptions de poste` → `#r-tel`
  4. `CA additionnel — panier en ligne +15 %` → `#r-ca` — ligne `.accent` : valeur en couleur accent, préfixée `+ `
  5. `Heures d'équipe libérées` → `#r-h`
- `.sim-equiv` `#r-equiv` (13.5px gray, margin-top 14px) : `≈ {N} % d'un temps plein récupéré — hors gain des erreurs évitées.`
- CTA (`.sim-cta`, btn light, margin-top 18px, aligné à gauche) : `Vérifier ces chiffres avec nous` → `#contact`.

**Formules exactes (script inline n°3)** — constantes : `H = 13` €/h chargé, `DAYS = 30.4` jours/mois, `WKS = 4.33` semaines/mois, `FT = 151.67` h (temps plein mensuel). `tel` est plafonné à `cmd` (`Math.min`). Format monétaire : `toLocaleString('fr-FR', {maximumFractionDigits:0}) + ' €'`.

```
errSave  = err × 4.33 × panier × 0.5 × 0.35        // commande refaite ≈ 50 % du panier ; −35 % d'erreurs
coordH   = mins × 2 × 30.4 / 60                     // 2 services/jour → heures/mois
coordSave= coordH × 13
telMig   = tel × 0.6                                // 60 % des appels migrent en ligne
telH     = telMig × 4 × 30.4 / 60                   // 4 min par appel (3 min + 1 min d'interruption)
telSave  = telH × 13
online   = telMig + cmd × 0.10                      // + 10 % du comptoir migre en ligne la 1ʳᵉ année
ca       = online × 30.4 × panier × 0.15            // panier en ligne +15 %

r-total  = errSave + coordSave + telSave            // mensuel, HORS CA additionnel
r-year   = (errSave + coordSave + telSave + ca) × 12
r-h      = coordH + telH  (arrondi, suffixe " h")
r-equiv  = Math.round((coordH + telH) / 151.67 × 100) + " % d'un temps plein récupéré — hors gain des erreurs évitées." (préfixe "≈ ")
```

Recalcul sur événement `input` de chacun des 5 sliders + un appel initial au chargement. Les outputs des sliders sont mis à jour au même moment (`o-panier` avec `minimumFractionDigits: 2`).

**Bloc flux** (`.sim-flow`, `.rv` : carte `--card`, bordure, radius 14px, padding 20px 24px) :
- Titre 14px 600 blanc : `Pourquoi ça tient : la commande en ligne ne passe plus par la caisse`
- 4 étapes en chips (13px, fond `--surface-6`, radius 20px, padding 6px 12px) séparées par des flèches `→` grises : `Le client commande & paie en ligne` → `Ticket généré automatiquement` → `Visible en direct sur le KDS cuisine` → `La caisse remet le sac. C'est tout.` — la **dernière chip** est stylée accent : fond `rgba(201,161,90,.16)`, bordure `rgba(201,161,90,.4)`, texte accent.
- Mobile : étapes empilées en colonne, flèches pivotées `rotate(90deg)` avec `margin-left:14px`.
- Note (13px gray) : `Pendant ce temps, la personne en caisse reste avec les clients physiques — personne ne quitte son poste en cuisine pour décrocher, personne ne fait patienter la file.`

**Notes d'hypothèses** (`.sim-notes`, `.rv`, 12.5px, opacity .75, centré, max 1000px) : `Hypothèses prudentes, ajustées ensemble en démo : coût horaire chargé 13 €/h (SMIC restauration 2026 + charges) · commande refaite ≈ 50 % du panier · appel ≈ 3 min + 1 min d'interruption/reprise de poste, 60 % des appels migrent en ligne · 10 % du comptoir migre la 1ʳᵉ année · panier en ligne +15 % (bas de fourchette des études : +15 à +30 %) · erreurs −35 % (Deliverect, 2023) · 2 services/jour, 30,4 jours/mois.`

### 4.6 Méthode en 3 étapes (`#pourquoi`, `.proc-section`)

- Conteneur : `.proc-inner` max 1120px, colonne gap 60px (48px ≤1199.98, 40px mobile). En-tête (`.rv`, aligné à gauche, max 500px) : badge `Notre méthode` + H2 `Comment on vous accompagne vers de vrais résultats`.
- Grille : 3 colonnes gap 24px (1 colonne ≤1199.98px).
- **Carte** (`.proc-card`, `.rv`) : radius 20px, fond `--card-gradient`, padding `52px 26px 30px` (48/18/26 mobile).
  - **Tag encoche** (`.notch-tag.tl`) en haut-gauche : fond noir, padding 6px 12px, 13px, coin `border-radius: 0 0 14px 0` ; deux congés SVG 18×18 (`M 0 0 L 0 18 C 0 8.059 8.059 0 18 0 Z`, fill #000, `rotate(90deg)`) positionnés `top:0; right:-18px` et `bottom:-18px; left:0`. Libellés : `Étape 1.` / `Étape 2.` / `Étape 3.`
  - **Viewport mockup** (`.proc-viewport`) : hauteur **288px** (300px ≤1199.98, 272px mobile), `overflow:hidden`, margin-bottom 44px (36 mobile), masque de fondu bas `linear-gradient(to bottom, #000 55%, transparent 98%)`.
  - **Panneau mockup** (`.mock-panel`) : bordure-dégradé par padding 1px (`linear-gradient(180deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,.07) 40%, rgba(255,255,255,.04) 100%)`), radius 14px ; intérieur radius 13px, fond `linear-gradient(180deg,#1b1b1b 0%,#141414 55%,#111 100%)`, padding 18px, min-height 330px. Titre 15px blanc + sous-titre 11px gray + divider 1px `--border-10` (margin 14px 0).
  - **Texte de carte** (`.proc-cardtext`, `.rv`) : H4 + body-text, gap 8px.

**Carte 1 — mockup « Analyse du service »** (titre) / `Pour savoir ce qu'on peut simplifier` (sous-titre). 5 lignes `.diag-row` (gap 12px entre lignes) : icône dans cercle 34px fond `--surface-6` (pictos SVG 15×15 : horloge, refresh, bulle de chat, horloge, calendrier), puis label 10px gray + valeur 14px blanc, et pour 2 lignes une barre de progression 3px (fond `--border-10`, remplissage blanc) :
1. `Rush du vendredi soir` / `Élevé`
2. `3 postes mobilisés` + barre **72%**
3. `Commandes au stylo` / `À déchiffrer en cuisine`
4. (`.dim`, opacity .55) `~12 par semaine` + barre **34%**
5. (`.dim`) `Heures sup` / `Calculées à la main`

**Carte 2 — mockup « Configuration »** / `Connecté à votre activité`. 4 lignes `.int-row` (padding 12px 0, séparées par bordure `--surface-6`) : titre 14px blanc + texte 11px gray :
1. `Menu & prix` / `Importé depuis votre carte actuelle.` + rangée d'outils : 3 pastilles rondes 24px `--surface-6` + libellé `+ Voir plus` (11px, chip radius 8px).
2. `Équipe` / `Comptes créés pour chaque poste.`
3. `Paiement` / `Carte, espèces, click & collect.`
4. `Fidélité` / `Points et codes promo activés.`

**Carte 3 — mockup « Mises à jour »** / `Tout continue de s'améliorer`.
- Légende filtres (11px) avec pastilles 6px : `New` = `--green`, `Improved` = `--accent`, `Fixed` = `--orange`. À droite : 2 boutons flèche 18×18px radius 5px (`aria-label="Mois précédent"` / `"Mois suivant"`, `data-dir="prev|next"`).
- Changelog (`.upd-changelog`, radius 10px, fond `--surface-3`, padding 14px) contenant **2 logs** alternés :
  - **Juillet 2026** — `Ce qu'on a amélioré ce mois-ci.` : `Sticker sac imprimé à l'acceptation` (vert) · `Pointage équipe sur tablette` (vert) · `Synchro caisse ↔ cuisine plus rapide` (accent) · `Alertes sonores personnalisables` (vert, opacity .55) · `Correctifs mode hors-ligne` (orange, opacity .4).
  - **Août 2026** — `Et la suite.` : `Fidélité multi-sites` (vert) · `Chargement des tickets 30% plus rapide` (accent) · `Export des plannings en PDF` (vert, opacity .55) · `Bug d'impression sticker corrigé` (orange, opacity .4).
- **Comportement JS** : rotation auto toutes les **4000ms** (bascule `display: block/none`) ; clic flèche = navigation manuelle + **reset du timer** (le `setInterval` est recréé). NB : le CSS prévoit `.upd-log { transition: opacity .35s } .upd-log.fade { opacity:0 }` mais le JS bascule par `display` sans fondu — fondu **à définir** (voir §10).

**Textes des 3 cartes** :
1. H4 `On observe votre service` — `On identifie ce qui ralentit votre équipe et où l'automatisation change vraiment la donne.`
2. H4 `On configure votre plateforme` — `Menu, équipe, logo, couleurs, moyens de paiement — tout est prêt avant l'ouverture.`
3. H4 `On reste à vos côtés` — `Support continu, mises à jour, accompagnement — un vrai partenaire, pas un logiciel qu'on vous laisse.`

### 4.7 Bento « La plateforme » (`#produit`) — les piliers de l'offre

Badge `La plateforme` ; H2 centré (max 650px) `Une plateforme, quatre métiers du service`.

Grille : `.sol-grid` = 3 colonnes flex égales, gap 20px, max 1154px, padding `0 10px` (≤1199.98px : colonnes empilées, chacune max 650px centrée). Chaque colonne contient 2 cartes (`.sol-card`, `.rv`) : fond `#111`, radius 18px, padding 15px (12px mobile), gap 18px. Mockup (`.sol-mockup`, `aria-hidden`) : hauteur **200px**, radius 12px, bordure `--surface-6`, fond `--card-gradient` ; variante `.tall` : hauteur auto min 230px. Légende (`.sol-caption`) : 16px gray, `strong` blanc.

**Colonne 1** :
1. **Cuisine (workflow KDS)** : 3 nœuds empilés `.wf-node` (largeur 214px, padding 8px 10px, radius 10px, fond `rgba(18,18,18,.7)`, bordure `--surface-6`) — icône 20px (horloge / bol / ticket), label 12px blanc, ligne d'espacement 1px `rgba(255,255,255,.18)`, **pastille statut verte 6px**. Libellés : `Commande reçue`, `En préparation`, `Prête à remettre`. Connecteurs : SVG 2×22px, trait pointillé `rgba(255,255,255,.35)` épaisseur 1.5, `stroke-dasharray: 3 4`, **animation `dash-flow` .9s linear infinite** (`stroke-dashoffset: -14` — flux qui descend).
   Légende : **Cuisine.** `« 3 frites à lancer » : la cuisine voit tout ce qu'il faut lancer, en un coup d'œil.`
2. **Équipe (ticker vertical)** : liste défilante de 6 profils dupliqués ×2 (12 lignes), animation `ag-scroll` **14s linear infinite** → `translateY(-50%)` ; masque fondu haut/bas (transparent 0 → noir 20% → noir 80% → transparent). Ligne 30px : avatar 26px rond dégradé `linear-gradient(135deg, var(--accent), #5a4526)`, nom 12px blanc 600, rôle 10px gray, pastille verte 6px à droite. Profils : `Léa / Cuisine`, `Hugo / Caisse`, `Inès / Manager`, `Noah / Service salle`, `Jade / Plonge`, `Adam / Ouverture`.
   Légende : **Équipe.** `Rôles, plannings et présences gérés au même endroit.`

**Colonne 2** :
3. **Téléphone (onde audio)** : bande de barres verticales (largeur 4px, radius 2px, blanc 80%) de hauteurs `20/45/35/32/70/15/40/25px` ×2, animation `vo-scroll` **8s linear infinite** → `translateX(50%)` ; masque horizontal en fondu. Par-dessus : icône combiné dans un disque 64px fond `#0a0a0a`, bordure `--surface-6`, halo radial `::before` (`inset:-28px`, `rgba(255,255,255,.22)` → transparent 65%).
   Légende : **Téléphone.** `Prenez les commandes par téléphone sans perdre le fil.`
4. **Fidélité & Promos (panneau marketing)** : en-tête avec éclair 13px + titre `Fidélité & Promos` (12px) + 3 points décoratifs ; 2 lignes 11px `--white-70` : `Points cumulés à chaque passage…`, `Codes promo actifs…` ; 6 chips (11px gray, fond `--surface-6`, radius 50px, padding 4px 10px) : `Points`, `Tampons`, `SMS`, `Email`, `Anniversaire`, `Parrainage`. **Micro-interaction** : illumination séquentielle `chip-glow` **4.9s ease-in-out infinite**, delays 0/.5/1/1.5/2/2.5s — de 6% à 12% du cycle : texte `#fff` + bordure `rgba(255,255,255,.7)` ; sinon gris/transparent (état `.hot` équivalent).
   Légende : **Fidélité.** `Points, tampons et codes promo qui donnent envie de revenir.`

**Colonne 3** :
5. **Back-office (dashboard, `.tall`)** :
   - En-tête chiffres (padding 0 14px ; label 8px uppercase letter-spacing .08em gray, valeur 13px blanc) : `CA DU JOUR 1 290 €` à gauche ; à droite `ENCAISSÉ 1 180 €` et `RESTE 110 €`.
   - Graphique aire SVG `viewBox 0 0 320 60` (hauteur affichée 44px, `preserveAspectRatio="none"`) : chemin `M0 50 L40 38 L80 44 L120 24 L160 34 L200 14 L240 30 L280 8 L320 20`, remplissage dégradé vertical `#sm-exp-grad` `rgba(201,161,90,.28)` → transparent, ligne `rgba(255,255,255,.35)` épaisseur 1.
   - 4 lignes de ventilation (label 10px gray largeur 60px, barre 3px remplissage blanc 80%, valeur 10px blanche) : `Signatures` 82% `412 €` · `Tacos` 70% `356 €` · `Boissons` 45% `210 €` · `Desserts` 30% `140 €`.
   Légende : **Back-office.** `Chiffre d'affaires et dépenses suivis en temps réel.`
6. **Site & commande (chat de suivi)** : 3 bulles — client (alignée droite, largeur 64%, fond `--surface-6`, radius `10px 10px 2px 10px`) : `Commande #42 envoyée ✓` ; agent ×2 (alignées gauche, largeur 74%, avatar 18px dégradé accent, fond `--surface-3` + bordure, radius `10px 10px 10px 2px`) : `Reçue en cuisine`, `Prête dans ~12 min`. Tag centré (10px, fond `--badge-bg`, radius 50px) : `Suivi de commande en direct`.
   Légende : **Site & commande.** `Vos clients commandent, vous êtes prévenu instantanément.`

### 4.8 Catalogue app par app (`#catalogue`)

Badge `Dans le détail` ; H2 (max 680px) `Tout ce que la plateforme couvre, app par app` ; sous-texte (`.rv`, max 560px, centré) : `Pas une plaquette : chaque ligne ci-dessous existe déjà dans les maquettes — descendez d'une section pour les manipuler.`

Grille : 4 colonnes gap 14px, max 1154px (2 colonnes ≤1023.98px, 1 colonne ≤639.98px). Colonnes `.cat-col.rv` avec `transition-delay` inline en cascade : 0 / `.06s` / `.12s` / `.18s`. Style colonne : fond `--card-gradient`, bordure `--surface-6`, radius 16px, padding 22px 20px. En-tête : nom d'app 16.5px blanc + device 12px gray, bordure basse. Items (`.cat-item`, 13.5px gray, gap 9px vertical) : **losange accent 6×6px** (`rotate(45deg)`) + texte, `strong` blanc 500.

| Caisse (POS) — `Tablette, au comptoir` | Cuisine (KDS) — `Tablette & téléphone` | Commande en ligne — `Web, mobile first` | Back-office — `Web, côté gérant` |
|---|---|---|---|
| **Sur place, à emporter, téléphone** — même écran | Colonnes **Nouveau → En prépa → Prêt** | **Click & collect** avec créneaux de retrait | **CA & commandes en temps réel** |
| Config express : recette (Complet, ST, SO, SC…), sauces, tailles | « À lancer » agrégé : 3 frites, 2 tacos… en un coup d'œil | Paiement en ligne ou au retrait | Menu & prix : édition en direct, import CSV/XML |
| Tacos sur-mesure : taille, viandes, gratiné, suppléments | Minuteur couleur par commande, seuils d'alerte | Configurateur identique à la caisse — zéro surprise | Catégories en drag & drop, ruptures en un tap |
| Passage en menu (+2,50 €) en un tap | Alerte sonore à chaque nouvelle commande | Panier modifiable ligne par ligne | Stats : top ventes, affluence par heure, canaux |
| Totaux et rendu monnaie automatiques | Chaque article cochable pendant la prépa | Codes promo, fidélité points & tampons | Promos, codes et produits mis en avant |
| **Ticket cuisine + sticker sac** imprimés | Numéro de retrait pour appeler le client | Compte client, historique, recommande en 1 tap | Horaires, créneaux, fermetures exceptionnelles |
| Lignes identiques cumulées, note par produit | Thème sombre ou clair, pensé pour la cuisine | Suivi de commande en direct (reçue → prête) | **Pointage & heures** de l'équipe |
| CB, espèces, paiement au retrait | Mode hors-ligne avec resynchronisation | **À vos couleurs** : logo, nom, identité complète | Avis clients et réponses publiques |

Pied de colonne (`.cat-demolink`, 13px 600 accent, bordure haute, `margin-top:auto`, hover souligné) — boutons appelant `smDemoGo(i)` :
- `Essayer la caisse en démo →` → `smDemoGo(1)`
- `Essayer la cuisine en démo →` → `smDemoGo(2)`
- `Essayer la commande en démo →` → `smDemoGo(3)`
- `Essayer le back-office en démo →` → `smDemoGo(0)`

**Micro-interactions** : à la révélation (`.rv.in`), items animés `cat-in` .5s en cascade (delays `.1s` → `.66s` par pas de `.08s`, `translateX(-14px)` → 0) ; losanges pulsent `dot-pulse` 2.6s (halo `rgba(201,161,90,.5)` → 5px transparent). Hover item : fond `--surface-6` (radius 8px via padding négatif `3px 6px / -3px -6px`), `strong` passe accent. Hover colonne : `translateY(-4px)` + bordure `rgba(201,161,90,.4)` (transition .35s `cubic-bezier(.2,.8,.2,1)`). Les colonnes reçoivent aussi l'effet spotlight (§6.11).

### 4.9 Démo 3D navigable (`#demo`)

Badge `La démo` ; H2 (max 640px) `Explorez les applications, en démo` ; sous-texte (`.rv`, max 560px) : `Des maquettes interactives, pas des captures d'écran : cliquez, changez d'app, parcourez les écrans — un aperçu fidèle de votre futur quotidien.` (`maquettes interactives` en strong blanc, `votre futur quotidien` en `.kw` accent).

**Pills** (`#demo-pills`, `.rv`, générées en JS) : 4 boutons (13.5px, fond `--badge-bg`, bordure `--surface-6`, radius 20px, padding 8px 16px, transition all .2s). Hover : texte blanc. Actif `.is-on` : fond accent, bordure accent, texte noir 600. Libellés : `Back-office`, `Caisse (POS)`, `Cuisine (KDS)`, `Commande client`.

**Scène** (`#demo-stage`, `.rv`) : max 1154px, hauteur **640px**, `perspective: 1600px` (mobile : 420px de haut, perspective 1000px). Piste `transform-style: preserve-3d`.

**Cartes** (générées en JS, une par app, `data-i`) : `position:absolute; top:0; left:50%`, largeur `min(880px, 78%)`, hauteur **600px**, `margin-left: max(-440px, -39%)` (mobile : largeur 92%, margin-left −46%, hauteur 400px). Transitions `transform .6s cubic-bezier(.2,.8,.2,1), opacity .6s, filter .6s`, `will-change: transform`. États :
- `.is-center` : `translateX(0) translateZ(0) rotateY(0)`, opacity 1, z3, sans filtre.
- `.is-left` : `translateX(-46%) translateZ(-340px) rotateY(26deg)`, opacity .45, z2, `filter: saturate(.6) brightness(.7)`.
- `.is-right` : symétrique `rotateY(-26deg)`.
- `.is-hidden` : `translateZ(-620px)`, opacity 0, z1, `pointer-events:none`.
- Mobile : `.is-left`/`.is-right` → opacity 0 + `pointer-events:none` (seule la carte centrale est visible).

**Cadre** (`.demo-frame`) : radius 16px, bordure `--border-10`, fond `--card`, `box-shadow: 0 30px 80px rgba(0,0,0,.55)`. Contient un `<iframe>` plein cadre (`title` = label de l'app, `loading="lazy"`) et un bouton-calque transparent `.demo-focusbtn` (`aria-label="Voir {label}"`, `inset:0`) qui recentre la carte au clic ; masqué (`display:none`) sur la carte centrale, où l'iframe redevient interactive (`pointer-events:auto`).

**Flèches** (`#demo-prev` / `#demo-next`, `aria-label="Application précédente/suivante"`) : 44px rondes, fond `--badge-bg`, bordure `--border-10`, positionnées `left:-6px` / `right:-6px` à mi-hauteur (2px du bord sur mobile), hover fond `--btn-dark` (transition .2s). Chevron 18px (préc. en `scaleX(-1)`).

**Légende** (`#demo-caption`, `.rv`, max 640px, 15px gray) : innerHTML par app, incluant des chips (`.demo-chips em` : 12px blanc, fond `--badge-bg`, bordure, radius 20px, padding 4px 11px). Contenus exacts :

| App (fichier iframe) | Légende | Chips |
|---|---|---|
| `SM - Back-office Restaurant.html` | **Back-office gérant.** Menu & prix modifiables en direct, CA du jour, ruptures, promos, pointage et heures de l'équipe — toute la gestion au même endroit. | `Import CSV/XML` · `Pointage équipe` · `Stats & CA` |
| `SM - Caisse (POS).html` | **Caisse.** Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés — prise en main en une heure, même pour une nouvelle recrue. | `Config express` · `Ticket + sticker sac` · `Sur place & téléphone` |
| `SM - App Cuisine (KDS).html` | **Cuisine.** Les commandes arrivent seules, « 3 frites à lancer » en un coup d'œil, statuts Nouveau → En prépa → Prêt, minuteurs et alerte sonore. | `À lancer agrégé` · `Minuteurs couleur` · `Alerte sonore` |
| `SM - Commande en ligne.html` | **Commande en ligne.** Le client commande et paie — le ticket file droit en cuisine, déjà encaissé. La caisse ne fait que remettre le sac. | `Créneaux de retrait` · `Fidélité & promos` · `Paiement en ligne` |

**Logique JS (script inline n°2)** :
- Ordre du tableau `APPS` : index 0 = Back-office, 1 = Caisse, 2 = Cuisine (KDS), 3 = Commande client.
- **Chargement paresseux** : `iframe.src` (`{fichier}?embed=1`) n'est posé que pour la carte courante + voisine suivante + voisine précédente (`loadFrame`).
- `go(i)` : index circulaire ; répartit les classes selon l'offset replié ; active l'iframe centrale ; synchronise l'état `.is-on` des pills ; met à jour la légende.
- **Initialisation** : un `IntersectionObserver` (`rootMargin: 200px`) déclenche `go(0)` la première fois que la scène approche du viewport, puis se déconnecte (aucune iframe chargée avant).
- **API globale** : `window.smDemoGo(i)` = `go(i)` + scroll fluide vers `#demo` avec offset **−70px** (`window.scrollTo({behavior:'smooth'})`), utilisée par les liens du catalogue.
- Pas d'autoplay sur ce carrousel (contrairement au hero). Navigation clavier / swipe tactile **à définir**.

### 4.10 Revenus additionnels (`#revenus`)

Badge `Du CA en plus` ; H2 (max 680px) `Vous venez de voir l'outil. Voici le chiffre d'affaires en plus.` ; paragraphe centré (max 600px, margin `14px auto 0`) : `Deux offres au-dessus de la suite : on installe une marque de livraison clé en main dans votre cuisine, ou on pilote votre propre marque sur les plateformes. Même équipe, même matériel, mêmes horaires.` (les deux segments dorés en `.kw`, la dernière phrase en strong).

Grille inline : `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))`, gap 20px, max 900px, margin `36px auto 0`. Deux cartes `.pr-card` (mêmes styles que pricing, `height:100%`), wrappers `.rv` (2ᵉ avec `transition-delay:.1s`).

**Carte A — « Une 2ᵉ enseigne dans votre cuisine »** :
- Prix (26px) : `Vous ne payez rien pour démarrer` (`rien` en `.kw` accent).
- Descriptif : `On installe une marque de livraison toute prête (Maki-Ya, Pastella, Wings Club, Green Bowl…) dans votre cuisine : recettes, formation, comptes Uber Eats & Deliveroo, pub — on s'occupe de tout. Vous cuisinez, vous encaissez un chiffre d'affaires que vous n'aviez pas. Notre part : 8 % de ces ventes, uniquement quand ça vend. Premier ticket en 3 semaines.` (strong : « marque de livraison toute prête », « on s'occupe de tout », « 8 % de ces ventes » ; `.kw` : « chiffre d'affaires que vous n'aviez pas », « Premier ticket en 3 semaines »).
- CTA btn dark : `Découvrir les 4 marques` → **`SM - Catalogue Marques.html`** (page maquette séparée ; route de production **à définir**).
- Note (13px) : `Concepts 100 % halal · CA en plus — sans investissement, sans embauche, même équipe.`

**Carte B — « Vos ventes Uber Eats, boostées »** :
- Prix (26px) : `dès 99 €/mois`.
- Descriptif : `Vous êtes déjà sur Uber Eats ou Deliveroo, mais ça vend peu ? Nos experts reprennent votre page : menu réorganisé, photos retravaillées, promos aux bonnes heures, avis gérés. Vous ne touchez à rien, vous voyez le résultat sur un rapport clair chaque mois. Objectif : +30 % de ventes en livraison en 60 jours.` (strong et `.kw` comme cités).
- CTA btn dark : `Être rappelé` → `#contact`.
- Note : `Sans engagement · se rembourse dès le premier mois.`

**Micro-interaction « sheen »** : `#revenus .pr-card::after` — bande lumineuse oblique (largeur 45%, `skewX(-18deg)`, dégradé `transparent / rgba(255,255,255,.05) / transparent`) traversant la carte, animation `sheen` **5.5s ease-in-out infinite** (position `left:-70%` → `120%` à 25% du cycle). Un délai `2.7s` est prévu pour la 2ᵉ carte via `#revenus .pr-card:nth-child(2)` — sélecteur inopérant dans la maquette (la carte est fille unique de son wrapper `.rv`) : les deux cartes brillent en phase. Corriger en production (cibler le wrapper).

### 4.11 Avant / après (section sans id)

En-tête (`.rv`) : badge `Avant / après` + H2 `Ce que ça change, un vrai service`.

Layout `.cs-wrap` : grille `minmax(0,420px) / minmax(0,1fr)`, gap 60px, max 1120px, alignement centré (≤1199.98 : `1fr/1fr`, gap 40 ; mobile : 1 colonne, gap 32).

**Colonne texte** (`.rv.rv-x-l` — glisse depuis la gauche) : 2 diapos (`.cs-slide`, `display:flex/none`), bloc min-height 150px (0 mobile) :
1. H4 `Avant Snack Manager` — `Tickets papier, un poste en plus aux heures de rush, des commandes en ligne à gérer à côté du comptoir.`
2. H4 `Avec Snack Manager` — `Un service organisé, une équipe mieux répartie, et un gain de temps qui se voit dès la première semaine.`
- Flèches (`.cs-arrow`, `data-dir="prev|next"`, `aria-label="Précédent/Suivant"`) : 40px rondes, bordure `--border-10`, hover fond `--surface-6` (transition .2s). Navigation circulaire, **pas d'auto-rotation** ; le texte change, les photos restent fixes.

**Colonne collage** (`.rv.rv-x-r` — glisse depuis la droite) : grille 2 colonnes gap 12px de 3 `<image-slot fit="cover">` (radius 12px) : `sm-cs-1` placeholder `Photo — comptoir` (ratio 4/3), `sm-cs-2` `Photo — cuisine` (4/3), `sm-cs-3` `Photo large — équipe en service` (pleine largeur, ratio 21/8). Photos réelles **à définir**.

### 4.12 « Pourquoi nous » — escalier + pilier (section sans id)

En-tête (`.rv`) : badge `Pourquoi nous` + H2 `Ce qui change avec Snack Manager`.

Layout `.bf-grid` : `1fr 230px 1fr`, gap 16px, `align-items:end` (≤1199.98 : `1fr 220px 1fr`, stretch ; mobile : 1 colonne). Côtés : grilles 2×2 (`.bf-sidegrid`) avec placements en escalier :
- Gauche : tuile 1 en `2/1`, tuile 2 en `1/2`, tuile 3 en `2/2` (≤1199.98 : empilées).
- Droite (miroir) : `1/1`, `2/1`, `2/2`.

**Tuile** (`.bf-tile`) : bordure-dégradé padding 1px `linear-gradient(132deg, rgba(255,255,255,.7) 0%, var(--surface-6) 31%)` (variante `.right` : `228deg`, vers `--border-10` à 33%), radius 17px, min-height 140px. Intérieur radius 16px, padding 20px, fond `linear-gradient(132deg, rgba(255,255,255,.1) 0%, transparent 45%), #000` (228deg à droite). Icône dans carré 28px radius 8px fond `--surface-6` ; texte 16px gray, `strong` en bloc blanc.

Contenus (6 tuiles, pictos SVG 18px trait 1.3) :
- Gauche : **Gain de temps.** `Automatisez les tâches répétitives.` · **Économique.** `Réduisez la charge de travail manuelle.` · **Service plus fluide.** `Accélérez vos opérations.`
- Droite : **Meilleure visibilité.** `Comprenez vos chiffres rapidement.` · **Moins d'erreurs.** `Réduisez les erreurs humaines.` · **Évolutif.** `Grandissez sans effort supplémentaire.`

**Pilier central** (`.bf-pillar`, wrapper `.rv` delay .1s) : hauteur 345px (min 280 mobile), bordure-dégradé `linear-gradient(180deg, rgba(255,255,255,.9) 0%, var(--border-10) 39%)`, radius 20/19px, fond noir, logo posé en haut (padding-top 50px ; centré verticalement sur mobile). Zone logo 94×94px : halo `.bf-halo` (`inset:-3px`, dégradé `linear-gradient(2deg, rgba(201,161,90,.8) 0%, rgba(171,171,171,0) 100%)`, `filter: blur(41px)`, **animation `bf-pulse` 3.6s ease-in-out infinite** : opacity .5→.85, scale 1→1.06) ; cadre 1px dégradé blanc, logo SVG 54px blanc.

**Micro-interactions** : hover tuile → `translateY(-5px)` (.35s `cubic-bezier(.2,.8,.2,1)`), fond intérieur teinté accent `linear-gradient(132deg, rgba(201,161,90,.14), rgba(255,255,255,.02) 55%)`, icône → fond accent, texte noir, `scale(1.12) rotate(-6deg)` (.3s). Entrée : `tile-in` .6s (`translateY(26px) scale(.97)` → net), delays .05/.15/.25s par tuile.

### 4.13 Vignettes « Le quotidien » (`#temoignages`)

> NB : la maquette ne contient pas de témoignages clients nominatifs — ce sont des **vignettes de situations vécues** ; le témoignage Class'Food est porté par la section suivante (§4.14).

- `.vg-inner` max 1147px, gap 44px. Rangée d'en-tête : à gauche (`.rv`, aligné gauche) badge `Le quotidien` + H2 `Des situations qu'on connaît par cœur` ; à droite flèches (`.rv` delay .2s) 44px rondes fond `--badge-bg` (mobile : en colonne sous le titre).
- Viewport `overflow:hidden`, `user-select:none`. Piste : flex gap **10px**, `width:max-content`, transition `transform .5s cubic-bezier(.2,.8,.2,1)`.
- Slide : **375px** de large (mobile `min(375px, 100vw − 60px)`). Carte : fond `--card`, radius 16px, padding 10px. En-tête : tag 13px **accent** avec pastille 7px accent en `::before` animée `dot-pulse` 2.4s. Média : hauteur **376px** (330px mobile), radius 12px, `<image-slot fit="cover">` ; citation en surimpression bas (16px blanc, padding 16px, dégradé `rgba(0,0,0,0)` → `rgba(0,0,0,.6)`).
- **JS** : navigation par flèches, index borné `0…3` (pas de boucle), `translateX(-idx × (largeurSlide + 10))`, recalcul au `resize`. Swipe tactile / drag **à définir**.
- Hover : carte `translateY(-6px)` + `box-shadow: 0 18px 40px rgba(0,0,0,.45)` (.35s).

Contenus exacts :
| Tag | Placeholder photo | Citation |
|---|---|---|
| `Vendredi 20h` | `Photo — rush de service` | « Les commandes griffonnées au stylo que la cuisine doit déchiffrer en plein coup de feu. » |
| `Dimanche midi` | `Photo — équipe en cuisine` | « Une personne en plus juste pour gérer les commandes en ligne à côté du comptoir. » |
| `Fin de mois` | `Photo — gérant au back-office` | « Recompter les heures de l'équipe à la main pour sortir les plannings du mois. » |
| `Nouvelle recrue` | `Photo — formation d'un nouvel équipier` | « À chaque départ, des jours de formation juste pour que la nouvelle personne tienne la caisse. » |

### 4.14 « Né au comptoir » (`#pilote`) — preuve Class'Food

Badge `Né au comptoir` ; H2 (max 620px) `Construit dans un vrai restaurant, pas dans un bureau`.

Carte (`.fd-card`, `.rv`) : grille `280px / 1fr` gap 28px (1 colonne mobile), max 1000px, fond `--card-gradient`, bordure `--surface-6`, radius 16px, padding 16px, `overflow:hidden`.
- Portrait : `<image-slot id="sm-fd-portrait" fit="cover" placeholder="Photo — fondateurs au comptoir du restaurant pilote">`, radius 12px, min-height 240px.
- Citation (19px — 16.5px mobile, blanc, line-height 1.55) : `« Snack Manager est né derrière le comptoir de notre restaurant pilote. Tickets perdus en plein rush, téléphone qui sonne pendant l'encaissement, heures recomptées à la main : on a vécu chaque problème avant de l'automatiser. Chaque écran de la plateforme est testé en service réel, midi et soir, avant d'arriver chez vous. »`
- Signature (14px gray) : `Les fondateurs · Class'Food, restaurant pilote — Perriers-sur-Andelle` (`Class'Food` en accent 600).
- 3 chips (`.fd-fact`, 12.5px, fond+bordure `--surface-6`, radius 20px) : `Testé en service réel 7 j/7` · `Rodé sur de vrais rushs` · `Amélioré chaque semaine`. Hover : bordure `rgba(201,161,90,.5)`, texte accent, `translateY(-2px)` (.3s).
- **Halo dérivant** : `::before` radial `500px 300px at 20% 20%, rgba(201,161,90,.09)`, animation `fd-drift` **9s ease-in-out infinite alternate** (`translate(0,0)` → `translate(10%,14%)`). Carte également spotlightée (§6.11).

### 4.15 Comparatif « Sans vs avec » (`.cmp-section`)

Badge `Comparatif` ; H2 (max 650px) `Sans vs avec Snack Manager`. Section gap **56px** (40 mobile).

Board max 826px :
- Deux pills d'en-tête (max 600px, gap 66px — 44 mobile) : hauteur 36px (32 mobile), fond `--badge-bg`, radius 50px, 15px (13 mobile). Gauche (icône sablier) : `Sans Snack Manager`. Droite (icône éclair) : `Snack Manager` — **avec** bordure `rgba(201,161,90,.45)` et halo pulsant `pill-glow` 3s (`box-shadow` 0 → `0 0 18px 2px rgba(201,161,90,.22)`).
- Médaillon `VS` : cercle blanc 56px (44 mobile), texte noir 15px 700, centré à `top:18px` (16 mobile), z2.
- Ligne verticale centrale 1px `--border-10` de `top:50px` au bas (masquée mobile).
- Colonnes : grille `1fr/1fr`, gap 62px, margin-top 30px (1 colonne, gap 16, margin 24 mobile). Colonne = liste radius 16px, bordure `--surface-6`, padding 24px 28px, gap 14px, fonds en dégradé diagonal (`135deg` gauche / `225deg` droite : `rgba(255,255,255,.07)` → 0, sur `--surface-3`).
- Items 15px : gauche gris avec pictos **cercle rouge `--red` 14px + croix blanche** ; droite `--white-80` avec pictos **cercle vert `--green` 14px + coche blanche**.

| Sans Snack Manager (rouge) | Snack Manager (vert) |
|---|---|
| Plusieurs outils qui ne se parlent pas | Une seule plateforme, tout connecté |
| Commandes au stylo, totaux calculés de tête | Menus cadrés, totaux automatiques, ticket + sticker sac |
| Des jours de formation à chaque recrue | Caisse prise en main en une heure |
| Plannings et heures à la main | Pointage & plannings automatisés |
| Site figé, pas de click & collect | Site & commande en ligne à vos couleurs |

**Micro-interactions** : hover du board → items de gauche `opacity:.55` (le camp gagnant s'illumine) ; hover item droite fond `rgba(63,174,106,.1)`, gauche `rgba(216,81,74,.07)` (radius 8px). Révélation : colonne gauche `.rv-x-l`, droite `.rv-x-r`.

### 4.16 Tarifs (`#tarifs`) + offre fondateur

Badge `Tarifs` ; H2 (max 650px) `Un lancement accompagné, un abonnement simple`.

> ⚠️ **Écart brief/maquette** : le brief mentionne une grille « 79–139 € » ; la maquette affiche **« Sur devis »** sur les 3 plans. Les montants publics sont donc **à définir** (seul « dès 99 €/mois » existe, dans la section Revenus §4.10).

**Barre offre fondateur** (`.pr-founderbar`, `.rv`) : pleine largeur (max 1200px), flex gap 16px (colonne mobile), fond `linear-gradient(90deg, rgba(201,161,90,.14), rgba(201,161,90,.03) 60%), var(--card)`, **bordure 1px pointillée `rgba(201,161,90,.5)`**, radius 14px, padding 16px 20px.
- Chip : `OFFRE FONDATEUR` (12px 700 uppercase, fond accent, texte noir, radius 20px).
- Texte (14.5px gray) : `Les 10 premiers restaurants conservent un tarif préférentiel, à vie. Snack Manager est en lancement accompagné — le tarif deviendra public ensuite. C'est prévu, c'est assumé.` (strong blanc sur « 10 premiers restaurants » et « à vie »).
- Jauge de places (`margin-left:auto`, 0 mobile) : **10 pastilles 8px** — 3 premières `.off` (fond `--surface-6` = prises), 7 en accent (= restantes) — + libellé 12.5px : `7 places restantes sur 10` (`7 places restantes` en blanc 600). Valeur codée en dur ; alimentation dynamique **à définir** (§7).

**Grille des plans** (`.pr-grid`) : 3 colonnes gap 20px, max 1200px (1 colonne max 480px mobile). Wrappers `.rv` avec delays 0 / `.1s` / `.2s`. Carte (`.pr-card`) : fond `--card-gradient`, bordure `--surface-6`, radius 16px, padding 28px, colonne. Prix (`.pr-price`) : 34px 600 blanc. Badge `Populaire` (carte Pro `.popular`, bordure `--border-10`) : absolu `top:28px; right:28px`, fond accent, texte noir 12px 600, radius 50px, padding 5px 12px.

| | Starter | Pro (`.popular`) | Multi-sites |
|---|---|---|---|
| Prix | `Sur devis` | `Sur devis` | `Sur devis` |
| Descriptif | `Idéal pour un point de vente qui démarre avec l'automatisation.` | `Le plus choisi : la plateforme complète, site inclus.` | `Pour les groupes de plusieurs restaurants.` |
| CTA | btn **dark** `Demander un devis` → `#contact` | btn **light** `Demander un devis` → `#contact` | btn **dark** `Demander un devis` → `#contact` |
| Label features | `Inclus :` | `Tout Starter, plus :` | `Tout Pro, plus :` |
| Features (coches vertes 14px) | App Cuisine (KDS) · Caisse (POS) · Ticket & sticker imprimés · Support par email | Site & commande en ligne · Fidélité & codes promo · Module RH (pointage, planning) · Support prioritaire | Tableau de bord multi-sites · Compte dédié · Accompagnement sur mesure |

**Micro-interactions** : hover carte `translateY(-6px)` + bordure `rgba(201,161,90,.35)` (.35s) ; carte Pro « respire » `pop-breathe` 4s (`box-shadow` 0 → `0 14px 44px -8px rgba(201,161,90,.18)`) ; hover d'une ligne feature `translateX(4px)` (.25s) ; spotlight curseur (§6.11).

### 4.17 FAQ (`#faq`)

Grille `1fr / 1.2fr`, gap 60px (1 colonne, 40px mobile), `align-items:start`.
- Colonne gauche (`.rv.rv-x-l`) : badge `FAQ`, H2 `Questions fréquentes`, aide : `Une question précise ? Contactez-nous` (lien blanc 600 → `#contact`, hover `#e0b96f` souligné).
- Colonne droite (`.rv.rv-x-r`) : liste gap 12px. Item : fond + bordure `--surface-6`, radius 17px, padding 18px 20px, `cursor:pointer; user-select:none`. Question en `.h5` + chevron 16px (rotation `180deg` en `.open`, transition .3s). Réponse : wrapper `max-height: 0` → **200px** en `.open`, transition `max-height .4s cubic-bezier(.2,0,.2,1)` ; texte `padding-top:12px`.
- **JS accordéon** : clic sur `.faq-q` → ferme tous les items ; rouvre celui cliqué s'il était fermé (un seul ouvert à la fois, tous fermables). **Premier item ouvert par défaut** (classe `open` dans le HTML).

Les 8 Q/R exactes :
1. **Dois-je changer mon matériel de caisse ?** — `Non — la plateforme fonctionne sur tablette et téléphone standards. On vous conseille sur l'imprimante ticket/sticker si besoin.`
2. **Combien de temps avant d'être opérationnel ?** — `Quelques jours suffisent : configuration du menu, de l'équipe et de votre identité visuelle avant l'ouverture.`
3. **C'est adapté à quel type de restaurant ?** — `Pensé pour les fast-foods et snacks indépendants — sur place, à emporter ou en click & collect.`
4. **Puis-je garder mon site actuel ?** — `Oui, on peut connecter le module commande à votre site existant ou vous fournir un site complet à vos couleurs.`
5. **Y a-t-il un engagement de durée ?** — `On vous détaille les conditions au moment du devis, adaptées à votre activité.`
6. **Et si la connexion internet coupe ?** — `La caisse et la cuisine continuent en local : les tickets restent affichés et s'impriment, puis tout se resynchronise au retour du réseau.`
7. **C'est quoi, une marque virtuelle ?** — `Une marque de livraison qui existe uniquement sur Uber Eats & Deliveroo, préparée dans votre cuisine avec votre équipe. On fournit le concept, les recettes, la formation et la gestion — vous encaissez un CA que vous n'aviez pas.`
8. **À qui appartiennent mes données ?** — `À vous. Ventes, clients, menus : tout est exportable à tout moment (CSV), hébergé en Europe.`

### 4.18 CTA final + formulaire de contact (`#contact`)

Section `padding: 80px var(--section-pad-x) 100px`, centrée, `overflow:hidden`.
- Ligne décorative (`.cta-line`) : 439px (max 80%), 2px, `linear-gradient(90deg, rgba(201,161,90,0) 0%, rgba(255,255,255,.8) 51%, rgba(201,161,90,0) 100%)`, margin-bottom 60px.
- Chip logo : SVG 18px + wordmark ADLaM 19px `Snack Manager`.
- H2 (max 600px) : `Prêt à reprendre le contrôle de votre service ?`

**Carte contact** (`.ct-card`, `.rv`) : grille `1fr / 1.1fr` gap 34px (1 colonne, padding 22px mobile), max 880px, margin-top 34px, fond `--card-gradient`, bordure `--surface-6`, radius 18px, padding 32px, texte aligné à gauche.

Colonne gauche :
- Titre (20px blanc 600) : `On vous rappelle`
- Sous-texte (14.5px) : `Laissez vos coordonnées — on vous rappelle sous 24 h ouvrées pour caler une démo de 30 min, dans votre restaurant ou en visio.`
- 3 points à coche verte (13.5px) : `Sans engagement, sans carte bancaire` · `On repart avec vos chiffres du simulateur` · `Offre fondateur : 7 places restantes`
- Alternative (bordure haute) : `Vous préférez écrire ? contact@snackmanager.fr` (lien `mailto:`, accent 600, hover souligné).

Colonne droite — **formulaire** (`.ct-form`, `onsubmit="return false"`) :
| Champ | id | Type | Label | Placeholder | Requis |
|---|---|---|---|---|---|
| Nom | `ct-name` | text | `Votre nom` | `Karim B.` | oui |
| Restaurant | `ct-resto` | text | `Votre restaurant` | `Class'Food — Rouen` | non |
| Téléphone | `ct-tel` | tel | `Téléphone` | `06 12 34 56 78` | oui |
| Créneau | `ct-when` | select | `Quand vous rappeler ?` | — (options : `Plutôt le matin` / `Entre les services (14h–18h)` / `Après 21h`) | non |
| Message | `ct-msg` | textarea rows=3 | `Un mot sur votre besoin (optionnel)` | `Ex : 2 caisses, gros rush le midi, pas encore de commande en ligne…` | non |

- Rangées 1–2 : grilles 2 colonnes gap 14px (1 colonne mobile).
- Style champ : 14px blanc, fond `rgba(255,255,255,.05)`, bordure `--surface-6`, radius 10px, padding 11px 13px, placeholder `rgba(255,255,255,.28)` ; **focus : bordure accent** (transition .2s). Select : apparence custom, chevron SVG gris en data-URI positionné `right 12px center`. Textarea : `resize:vertical; min-height:70px`.
- Submit : btn light pleine ligne `Être rappelé`.
- Mention (12px, opacity .7, centrée) : `Vos coordonnées servent uniquement à ce rappel — jamais revendues.`

**Comportement à la soumission (script inline n°4)** : la validation native `required` bloque d'abord ; au `submit`, si `ct-name` et `ct-tel` non vides (trim), le formulaire est **remplacé** (innerHTML) par l'état succès `.ct-done` (min-height 280px, centré) : coche verte 40px + `C'est noté !` (19px blanc) + `On vous rappelle sous 24 h ouvrées sur le créneau choisi.` (14px gray). **Aucun envoi réseau dans la maquette** — endpoint, états chargement/erreur, anti-spam : **à définir** (§7).

### 4.19 Footer

`.foot-wrap` : max 1200px, padding 40px (20px mobile). **Carte** (`.foot-card`) : max 1154px, radius 20px, fond `--footer-gradient`, padding `80px 40px 20px` (70/24/20 mobile).
- **Onglet encoche** en haut-gauche (`left:40px` ; 24px mobile) : logo SVG 19px + wordmark 18px sur fond noir, radius `0 0 14px 14px`, flanqué de 2 congés SVG 18×18 (`left:-18px` / `right:-18px`).
- Colonnes (`space-between`, gap 60px, wrap ; colonne mobile gap 40px) :
  - Gauche (max 420px) : tagline 26px blanc `Simplifier le quotidien du service` ; bloc newsletter — label subheading 18px `Rejoignez la liste pour suivre le lancement` ; **formulaire** (`.foot-form`, max 360px) : input email placeholder `nom@email.com` (fond `--surface-6`, radius 24px, padding `15px 115px 15px 15px`) + bouton submit superposé à droite (`right:5px`, largeur 100px, blanc, radius 19px, 14px 600) : `S'inscrire`. JS : `preventDefault()` uniquement — **aucun feedback ni envoi** ; comportement de production **à définir**.
  - Droite : 2 colonnes de liens (gap 80px ; 60px mobile). `Pages` : Produit `#produit`, Expertise `#pourquoi`, Tarifs `#tarifs`, Contact `#contact`. `Réseaux` : Instagram, LinkedIn (`href="#"`, `target="_blank" rel="noopener noreferrer"` — URLs **à définir**). Liens gray, hover `#e0b96f`.
- Ligne légale (margin-top 60px, padding-top 20px, space-between wrap) : `© 2026 Snack Manager. Tous droits réservés.` — **l'année (`#sm-y`) est réécrite en JS avec `new Date().getFullYear()`** — et lien `Politique de confidentialité` (`href="#"` — page **à définir**).
- Sous la carte (liens internes du handoff, 12.5px, `rgba(255,255,255,.32)`) : `Écosystème & flux internes →` (`SM - Écosystème & Flux.html`), `Design system →` (`SM - Design System.html`), `Dossier fondateur →` (`SM - Dossier Fondateur.html`). **Ne pas reprendre en production** (liens de travail de la maquette).

### 4.20 Barre sticky « Offre fondateur » (`#stickybar`)

- `position:fixed; left:0; right:0; bottom:0; z-index:900`, conteneur centré padding `0 16px 16px`, `pointer-events:none` (réactivé sur la barre interne).
- Barre interne : flex gap 16px, fond `rgba(12,12,12,.92)`, bordure `--border-10`, radius 16px, padding `12px 14px 12px 20px`, `backdrop-filter: blur(14px)`, ombre `0 20px 60px rgba(0,0,0,.6)`, max 680px.
- Contenu : pastille verte 9px pulsante (`chipPulse` 2s) · texte 13.5px gray (**masqué ≤ 639.98px**) : `Offre fondateur — 7 places restantes sur 10 au tarif préférentiel à vie` (strong blanc sur « Offre fondateur ») · bouton btn light `Réserver ma démo` → `#contact` (padding 10px 18px, 13.5px) · bouton fermer `×` (20px, gray, hover blanc, `aria-label="Fermer"`).
- **Apparition** : `transform: translateY(120%)` → `translateY(0)` via `.is-on`, transition `.45s cubic-bezier(.2,.8,.2,1)` (aucune transition en reduced-motion).
- **Logique JS (scroll passif)** : visible si `window.scrollY > 1000` **et** que le haut de `#contact` est encore sous `innerHeight × 0.9` (elle disparaît à l'approche du formulaire). Le clic sur `×` la ferme définitivement pour la session de page (flag en mémoire ; **pas de persistance** localStorage — à définir si souhaité).

---

## 5. Inventaire des composants & états

| Composant | États couverts par la maquette | États absents (à définir) |
|---|---|---|
| **Bouton `.btn`** (`.light` blanc/noir, `.dark` #262626/blanc ; radius 50px, padding 10px 16px, 14px 600) | normal ; hover `opacity:.85` (transition .2s) ; focus-visible (outline accent 2px) | actif/pressed, désactivé, chargement |
| **Badge `.badge`** (fond #1a1a1a, bordure 10%, radius 20px, padding 6px 14px, 14px) + pastille `.accent` (accent, radius 12px, padding 2px 8px, 12px 600 noir) | normal | — (statique) |
| **Lien nav `.ui-link`** | normal blanc ; hover `#e0b96f` ; état replié header (opacity 0 + blur 4px + scale 1.05) | actif/courant (pas de scroll-spy) |
| **Header notch** | replié 48px ; ouvert (hover) `--hd-open-w` | ouverture au focus clavier (hover uniquement — à définir) |
| **Burger mobile** | fermé ; `.open` (croix) | — |
| **Menu mobile** | fermé (max-height 0) ; `.open` (320px) | fermeture auto sur clic lien |
| **Slider `input[type=range]`** | normal (thumb accent 18px) ; focus-visible | hover/drag distincts, désactivé |
| **Output simulateur** | valeur live (accent, tabular-nums) | — |
| **Résultats simulateur** | état initial `—` puis calculé au chargement | états vides/erreur (non applicables, calcul local) |
| **Pill démo `.demo-pill`** | normal ; hover (texte blanc) ; `.is-on` (fond accent, texte noir 600) | désactivé |
| **Carte démo `.demo-card`** | `.is-center` / `.is-left` / `.is-right` / `.is-hidden` | état chargement iframe (skeleton), erreur de chargement |
| **Flèche ronde** (démo 44px, vignettes 44px, avant/après 40px, changelog 18px) | normal ; hover (fond `--btn-dark` ou `--surface-6`) | désactivé aux bornes (vignettes : l'index est borné mais la flèche reste cliquable sans effet) |
| **Carte pricing `.pr-card`** | normal ; hover (lift −6px + bordure accent .35) ; `.popular` (badge + respiration) ; spotlight | — |
| **Barre fondateur + jauge `.pr-seat`** | pastille pleine (accent) / `.off` (prise, `--surface-6`) | alimentation dynamique du compteur |
| **FAQ `.faq-item`** | fermé ; `.open` (chevron 180°, réponse 200px max) | réponse > 200px (clipping — à définir) |
| **Champ formulaire `.ct-field`** | normal ; focus (bordure accent) ; placeholder ; `required` natif | erreur inline, désactivé, chargement |
| **Formulaire contact** | saisie ; succès `.ct-done` (remplacement complet) | envoi en cours, échec réseau, validation téléphone |
| **Newsletter footer** | saisie ; validation native email | succès, erreur, envoi |
| **Stickybar** | masquée ; `.is-on` ; fermée (définitif session) | persistance de la fermeture |
| **Chip hero live** | cycle animé 3 états ; reduced-motion : 1ʳᵉ chip statique | données réelles (contenu codé en dur) |
| **`.rv` (reveal)** | initial (opacity 0, translateY 50px ou ±40px en X) ; `.in` (net) | — |
| **`image-slot`** | placeholder texte | rendu image réelle (définition du custom element non fournie) |
| **Compteur `[data-count]`** | avant déclenchement (valeur finale en dur dans le HTML — pas de layout shift) ; animation ; reduced-motion | — |
| **Chips `mk-chip` / `fd-fact` / `sim-flowstep` / `demo-chips em`** | normal ; `mk-chip` glow séquentiel ; `fd-fact` hover accent | — |
| **Carte vignette `.vg-card`** | normal ; hover (lift −6px + ombre) | — |
| **Item catalogue `.cat-item`** | normal ; hover (fond, strong accent) ; entrée en cascade | — |
| **Item comparatif** | normal ; hover teinté vert/rouge ; gauche atténuée au hover board | — |

---

## 6. Interactions, micro-interactions & JS de comportement

Récapitulatif exhaustif des comportements. Aucun **son**, aucun **drag & drop**, aucun **minuteur visible** n'existe sur cette surface (ils sont uniquement mentionnés dans le copy et vécus dans les maquettes produit iframées).

### 6.1 Révélation au scroll (`.rv`)
- `IntersectionObserver`, `threshold: 0.15`, unobserve après première entrée (one-shot).
- Base : `opacity:0; translateY(50px)` → `.in` : net. Variantes `.rv-x-l` (`translateX(-40px)`) et `.rv-x-r` (`translateX(40px)`).
- Transition : `opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1)`. Décalages en cascade via `transition-delay` inline (catalogue .06/.12/.18s, pricing .1/.2s, revenus .1s, flèches vignettes .2s).

### 6.2 Header
- Notch desktop : ouverture au hover (largeur 48px → calculée), `.45s cubic-bezier(.16,1,.3,1)` ; liens `.25s` (opacity/blur/scale). Largeur recalculée par `fitNotch()` (formule §4.0) sur `fonts.ready`, `load`, `resize`.
- Burger : toggle classes `.open` sur bouton + menu.

### 6.3 Hero
- Carrousel 3D auto : rotation toutes les **4.5s**, transitions **1.4s** `cubic-bezier(.2,.8,.2,1)`.
- Chips live : cycle **13.5s** à 3 chips (§4.1) ; pastilles pulsantes 2s.

### 6.4 Animations en boucle (fond)
| Animation | Élément | Durée / easing | Effet |
|---|---|---|---|
| `ticker-scroll` | ticker | 16s linear infinite | `translateX(-50%)` |
| `dash-flow` | connecteurs KDS | .9s linear infinite | `stroke-dashoffset:-14` |
| `ag-scroll` | ticker équipe | 14s linear infinite | `translateY(-50%)` |
| `vo-scroll` | onde téléphone | 8s linear infinite | `translateX(50%)` |
| `chip-glow` | chips fidélité | 4.9s ease-in-out infinite, delays 0→2.5s | allumage 6–12% du cycle |
| `bf-pulse` | halo pilier logo | 3.6s ease-in-out infinite | opacity .5→.85, scale 1→1.06 |
| `chipPulse` / `chipPulseGold` | pastilles live/sticky | 2s infinite | halo 0→8px |
| `dot-pulse` | losanges catalogue, tags vignettes | 2.6s / 2.4s | halo 0→5px `rgba(201,161,90,.5)` |
| `pill-glow` | pill comparatif droite | 3s ease-in-out infinite | halo 18px |
| `pop-breathe` | carte Pro | 4s ease-in-out infinite | ombre accent |
| `sheen` | cartes revenus | 5.5s ease-in-out infinite | balayage lumineux |
| `fd-drift` | halo carte fondateur | 9s ease-in-out infinite alternate | dérive 10%/14% |
| `heroChip` | chips hero | 13.5s infinite | cycle §4.1 |
| `tile-in` / `cat-in` | tuiles bf / items catalogue | .6s / .5s `cubic-bezier(.16,1,.3,1)` both | entrée en cascade |

### 6.5 Changelog « Mises à jour »
Rotation auto **4000ms** entre 2 mois (display switch), flèches = navigation manuelle + reset du timer.

### 6.6 Sliders et calcul du simulateur
Voir formules exactes §4.5 ; recalcul à chaque `input`, formatage `fr-FR`.

### 6.7 Carrousel démo (`#demo`)
Voir §4.9 : `go(i)` circulaire, lazy-load des iframes (courante + 2 voisines), pills synchronisées, caption innerHTML, init par IntersectionObserver (`rootMargin:200px`), API `window.smDemoGo(i)` avec scroll fluide offset −70px.

### 6.8 Compteurs de preuve
`IntersectionObserver` threshold .5, one-shot ; rAF 1100ms, easing `1−(1−p)³` ; préfixes/suffixes depuis `data-prefix`/`data-suffix` ; reduced-motion → valeur directe.

### 6.9 Sliders manuels
- **Avant/après** : 2 diapos, boucle circulaire, `display:flex/none`, flèches seulement.
- **Vignettes** : index borné 0–3, `translateX(-idx×(largeur+10px))`, transition .5s `cubic-bezier(.2,.8,.2,1)`, recalcul au resize.

### 6.10 FAQ
Accordéon exclusif (un seul ouvert), item 1 ouvert par défaut, chevron 180° .3s, hauteur .4s `cubic-bezier(.2,0,.2,1)` (max 200px).

### 6.11 Spotlight curseur
Sélecteurs équipés : `.pr-card`, `.sim-controls`, `.sim-results`, `.fd-card`, `.cat-col`. Au `pointermove`, les variables `--mx`/`--my` (px relatifs à la carte) positionnent un `::after` en `radial-gradient(360px circle at var(--mx,50%) var(--my,50%), rgba(201,161,90,.09), transparent 55%)`, opacity 0→1 en `.35s` au hover.

### 6.12 Stickybar
Listener `scroll` passif : `.is-on` si `scrollY > 1000` et `#contact` pas encore proche (`top < innerHeight×.9` ⇒ masquée). Fermeture définitive au `×` (flag mémoire).

### 6.13 Formulaires
- Contact : validation native `required` → garde JS (trim nom + tel) → remplacement par l'état succès. Pas d'appel réseau.
- Newsletter : `preventDefault()` seul (sélecteur JS vise aussi `.foot-form2`, inexistant dans le HTML).

### 6.14 Divers
- Année du copyright réécrite au chargement (`new Date().getFullYear()`).
- Scroll fluide global (`scroll-behavior: smooth` sur `html`) pour toutes les ancres.

---

## 7. Données lues / écrites — API & modèle MongoDB

La maquette est **entièrement statique** : aucune lecture réseau, deux écritures simulées (contact, newsletter). Ce qui suit distingue l'existant du nécessaire en production.

### 7.1 Lectures (affichage)

| Donnée | Dans la maquette | Production (proposé) |
|---|---|---|
| Compteur offre fondateur (« 7 places restantes sur 10 », 3 pastilles off) — affiché à 3 endroits : barre tarifs, point contact, stickybar | Codé en dur | `GET /api/public/founder-offer` → `{ totalSeats: 10, seatsTaken: 3 }`. Collection `settings` (doc unique) ou champ agrégé. **À définir** : source de vérité (CRM ?) et cadence de mise à jour. Les 3 affichages doivent rester cohérents. |
| Chiffres de preuve (−35 %, +15 %, 60 min, 7 j/7 + sources) | Codés en dur (`data-count` + labels) | Constantes build-time (contenu marketing versionné). CMS **à définir**. |
| Changelog « Mises à jour » (Juillet/Août 2026) | Codé en dur | Optionnel : collection `changelog_entries { month, subtitle, items: [{ label, kind: "new"|"improved"|"fixed" }] }` — sinon contenu statique. **À définir**. |
| Copy, FAQ, tarifs, offres revenus | Codés en dur | Statique/SSG ; CMS **à définir**. Montants des plans (« Sur devis » vs grille 79–139 €) **à définir**. |
| Iframes de démo (4 apps) | Fichiers HTML relatifs + `?embed=1` | Routes des maquettes/démos hébergées ; le paramètre `embed=1` doit masquer le chrome de l'app. **À définir** : URLs finales, sandboxing des iframes. |
| Contenu des chips « live » du hero | Codé en dur (fictif) | Rester statique (illustratif). |

### 7.2 Écritures

**Lead de contact** — `POST /api/public/leads`
```jsonc
// Collection MongoDB : leads
{
  "_id": "ObjectId",
  "name": "string",             // requis (ct-name)
  "restaurant": "string|null",  // ct-resto
  "phone": "string",            // requis (ct-tel) — format à valider (à définir)
  "callbackSlot": "matin | entre-services | apres-21h",  // ct-when (3 options exactes §4.18)
  "message": "string|null",     // ct-msg
  "source": "site-vitrine",
  "sourceSection": "contact | stickybar | simulateur | pricing | revenus",  // à définir (tracking du CTA d'origine)
  "simulatorSnapshot": {        // recommandé : le copy promet « On repart avec vos chiffres du simulateur »
    "ordersPerDay": 80, "avgBasket": 11.5, "remakesPerWeek": 6,
    "minutesLostPerService": 20, "phoneOrdersPerDay": 12,
    "monthlyRecoverable": 0, "yearlyTotal": 0
  },                            // à définir : la maquette ne joint PAS ces valeurs — décision produit
  "createdAt": "Date",
  "status": "new | called | qualified | closed"   // workflow CRM à définir
}
```
Réponse succès → afficher l'état `.ct-done` (§4.18). **À définir** : état de chargement, message d'erreur réseau, anti-spam (honeypot / rate-limit), consentement RGPD explicite (la mention « jamais revendues » existe déjà).

**Inscription newsletter** — `POST /api/public/newsletter`
```jsonc
// Collection MongoDB : newsletter_subscribers
{ "_id": "ObjectId", "email": "string (unique, index)", "createdAt": "Date",
  "source": "site-vitrine-footer", "confirmedAt": "Date|null" }  // double opt-in à définir
```
La maquette n'a **aucun feedback** après soumission : UX de confirmation **à définir**.

### 7.3 Notes de conception API
- Toutes les routes de cette surface sont **publiques et non authentifiées** ; ce site ne touche pas aux données tenant (menus, commandes, équipes) — celles-ci appartiennent aux apps produit iframées.
- La page étant SSG, seule la jauge fondateur justifierait un fetch client (ou ISR). Tout le reste peut être compilé.
- Analytics/attribution des CTA (6 boutons pointent vers `#contact`) : **à définir**.

---

## 8. Copy exact (récapitulatif)

Tous les textes sont cités in extenso dans les sections §4.x correspondantes. Index de repérage :
- Meta/SEO : §3. — Header/nav : §4.0. — Hero (H1, sous-titre, CTA, trust, 3 chips live) : §4.1. — Ticker : §4.2. — Intro « ×2 » : §4.3. — 4 preuves chiffrées : §4.4. — Simulateur (labels, hints, lignes de résultat, flux 4 étapes, hypothèses) : §4.5. — 3 étapes méthode + mockups (analyse, configuration, changelog Juillet/Août 2026) : §4.6. — 6 légendes bento + contenus mockups (CA 1 290 €, chat #42…) : §4.7. — 32 items catalogue + 4 liens démo : §4.8. — 4 légendes + chips démo : §4.9. — 2 offres revenus (8 %, 99 €/mois, +30 % en 60 jours) : §4.10. — Avant/après : §4.11. — 6 bénéfices : §4.12. — 4 vignettes quotidien : §4.13. — Citation fondateurs Class'Food : §4.14. — Comparatif 5+5 : §4.15. — Offre fondateur + 3 plans + features : §4.16. — 8 Q/R FAQ : §4.17. — CTA/contact (labels, placeholders, options select, mention RGPD, état succès) : §4.18. — Footer (tagline, newsletter, liens, légal) : §4.19. — Stickybar : §4.20.

---

## 9. Accessibilité & reduced motion

- **Focus** : `:focus-visible` outline 2px `#c9a15a`, offset 2px, sur toute la page.
- **`prefers-reduced-motion: reduce`** :
  - Global (style inline head) : toutes animations/transitions ramenées à `.01ms`, `scroll-behavior:auto`.
  - Spécifique CSS : chips hero → animation coupée, seule la 1ʳᵉ chip visible statiquement ; pastilles pulsantes et stickybar sans animation/transition ; désactivation explicite de `bf-tile`, `cat-item`, `cat-dot`, `cmp-headpill.right`, `vg-tagtext::before`, `fd-card::before`, `pr-card.popular`, sheen revenus.
  - JS : compteurs de preuve affichent la valeur finale sans animation.
- **ARIA présents** : `aria-hidden` sur tous les éléments décoratifs (SVG notch, mockups, ticker, watermark, carrousel de fond, VS, divider, cta-line) ; `aria-label` sur logo (« Accueil »), burger (« Menu »), flèches (« Précédent/Suivant », « Application précédente/suivante », « Mois précédent/suivant »), focusbtn démo (« Voir {app} »), fermeture stickybar (« Fermer »), bandeau preuve (« La preuve en chiffres »). Iframes du carrousel démo titrées par app ; celles du hero `title=""` + `tabindex="-1"`.
- **Lacunes à corriger en production (à définir)** : FAQ sans `aria-expanded`/`role=button` ni support clavier natif (div cliquable) ; ouverture du notch header au hover uniquement (prévoir focus-within) ; pills/carrousels sans `aria-current` ni annonce de changement ; labels de formulaire OK (for/id) mais pas de messages d'erreur accessibles ; contraste des textes `--gray` (#999 sur #000 ≈ 5.9:1 — acceptable, à vérifier sur les 11px).

---

## 10. Écarts, anomalies de la maquette & points « à définir »

### Anomalies observées dans le code de la maquette (à corriger, ne pas reproduire)
1. **Sheen revenus** : `#revenus .pr-card:nth-child(2)::after` ne matche jamais (la carte est fille unique de son wrapper `.rv`) → le délai 2.7s est sans effet, les deux cartes brillent en phase.
2. **Pulse des losanges catalogue** : `.rv.in .cat-col:nth-child(n) .cat-dot` exige un ancêtre `.rv.in` au-dessus de `.cat-col` qui n'existe pas (la grille n'est pas `.rv`) → les délais .6/1.2/1.8s par colonne sont inopérants ; seuls s'appliquent `.rv.in .cat-dot` (delay 0 partout).
3. **Changelog** : classes CSS `.upd-log.fade` (fondu .35s) prévues mais jamais utilisées par le JS (bascule `display` sèche).
4. **Newsletter** : le JS cible `.foot-form2` qui n'existe pas dans le HTML.
5. **Vert incohérent** : le halo `chipPulse` utilise `rgba(61,145,102,.45)` et les hovers comparatif `rgba(63,174,106,.1)` alors que `--green` = `#3fae4a` (rgb 63,174,74). Unifier sur le token en production.
6. `.cmp-col.left li { text-decoration-color: rgba(216,81,74,.5) }` sans `text-decoration-line` — sans effet visible (et le rouge 216,81,74 diffère du token `--red` #c94b3f).
7. Le fichier JS vit dans un autre dossier que le HTML/CSS (`Menu Trivolet Redesign (1)/`) — artefact d'organisation du handoff.

### Divergences brief ↔ maquette
- **Tarifs 79–139 €** (mentionnés au brief) : absents de la maquette — les 3 plans affichent `Sur devis`. Seul « dès 99 €/mois » (offre boost Uber Eats) et « 8 % des ventes » (marque virtuelle) sont chiffrés. **À définir**.
- **Témoignages Class'Food** : la maquette n'a pas de carrousel de témoignages clients ; `#temoignages` contient des vignettes de situations, et la preuve Class'Food est une citation des fondateurs (§4.14). **À définir** si de vrais témoignages doivent remplacer/compléter.

### À définir (fonctionnel)
- Custom element `image-slot` (fichier `image-slot.js` non fourni) : API exacte, rendu du placeholder, injection des vraies photos (8 emplacements : 3 collage avant/après, 4 vignettes, 1 portrait fondateurs) + le sélecteur CSS `.hero-frame image-slot` suggère un slot hero possible, non utilisé dans le HTML.
- Backend contact & newsletter (endpoints, états chargement/erreur, anti-spam, RGPD, e-mail de notification interne).
- Jauge fondateur dynamique (source de vérité, synchro des 3 affichages).
- URLs finales : démos iframées, page « Catalogue Marques », réseaux sociaux, politique de confidentialité, `og:image`/`og:url`.
- Persistance de la fermeture de la stickybar ; fermeture du menu mobile au clic lien ; navigation clavier/swipe des carrousels ; accessibilité FAQ/notch (§9) ; comportement si réponse FAQ > 200px ; scroll-spy nav ; validation du champ téléphone ; tracking des CTA.
- Découpage Next.js suggéré (non prescrit par la maquette) : page server component SSG + îlots clients (`Header`, `HeroCarousel`, `Simulator`, `Changelog`, `DemoCarousel`, `Counters`, `Sliders`, `Faq`, `ContactForm`, `Newsletter`, `Stickybar`, `Spotlight`) ; iframes de démo en `loading="lazy"` + montage à l'intersection comme dans la maquette.
