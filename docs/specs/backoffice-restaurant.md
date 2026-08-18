# Spécification — Back-office Restaurant (Gérant)

**Suite SaaS « Snack Manager » · surface web desktop · cible Next.js**

> Document de référence pour recréer en production la surface « Back-office Restaurant » de la maquette haute-fidélité, **sans relire le code source de la maquette**. Tout ce qui est décrit ci-dessous est observé dans la maquette (valeurs exactes citées). Ce qui n'existe pas dans la maquette est explicitement marqué **« à définir »**.

**Sources de la maquette** (pour traçabilité uniquement) :
- `Menu Trivolet Redesign (1)/app/backoffice.jsx` — shell, dashboard, commandes
- `Menu Trivolet Redesign (1)/app/backoffice-2.jsx` — menu, promos, horaires, stats, avis, équipe
- Dépendances partagées : `app/classfood-ds.css`, `app/sm-ds.css`, `app/sm-skin.css`, `app/sm-brand.jsx`, `app/cf-ui.jsx`, `app/cf-helpers.js`, `app/cf-theme.js`, hôte `SM - Back-office Restaurant.html`

---

## Sommaire

1. [Contexte, pile & montage](#1-contexte-pile--montage)
2. [Theming & tokens de design](#2-theming--tokens-de-design)
3. [Shell applicatif (cadre, sidebar, topbar)](#3-shell-applicatif)
4. [Bibliothèque de composants & états](#4-bibliothèque-de-composants--états)
5. [Vue « Tableau de bord »](#5-vue--tableau-de-bord-)
6. [Vue « Commandes » (live)](#6-vue--commandes--live)
7. [Vue « Menu & prix » (CRUD + drag & drop + import CSV)](#7-vue--menu--prix-)
8. [Vue « Promos »](#8-vue--promos-)
9. [Vue « Horaires »](#9-vue--horaires-)
10. [Vue « Statistiques »](#10-vue--statistiques-)
11. [Vue « Avis clients »](#11-vue--avis-clients-)
12. [Vue « Équipe & pointage »](#12-vue--équipe--pointage-)
13. [Micro-interactions, animations, minuteurs, sons](#13-micro-interactions-animations-minuteurs-sons)
14. [Données lues/écrites — API & modèle MongoDB](#14-données-luesécrites--api--modèle-mongodb)
15. [États vides / chargement / erreur](#15-états-vides--chargement--erreur)
16. [Inventaire des z-index et des couches](#16-inventaire-des-z-index-et-des-couches)
17. [Écarts, no-ops et points « à définir »](#17-écarts-no-ops-et-points--à-définir-)

---

## 1. Contexte, pile & montage

### 1.1 Nature de la maquette

- Application React 18.3.1 (UMD + Babel standalone) montée dans une page HTML statique. En production : **Next.js**, desktop uniquement (aucun breakpoint responsive dans la maquette — comportement mobile **à définir**).
- Multi-tenant / marque grise : chaque restaurant (tenant) a son accent de couleur, son nom, sa ville, son slug ; tout le reste du design est fixe (voir §2).
- Langue : **français** intégralement. Locale de formatage : `fr-FR`.

### 1.2 Page hôte

- Fond de page (hors app) : `radial-gradient(1200px 700px at 50% -10%, #14161a, #0c0d10 60%, #060708)`, `overflow: hidden`.
- L'app est rendue dans un « stage » centré (`position: fixed; left: 50%; top: 50%`) et **mise à l'échelle** pour tenir dans la fenêtre : `scale = clamp(0.05, min(1, (hauteurFenêtre − 24)/862, (largeurFenêtre − 24)/1360))`, recalculé sur `resize` (+ deux recalages différés à 60 ms et 400 ms au chargement). En production ce mécanisme d'échelle est un artefact de démo — **à définir** (layout fluide recommandé).
- Police chargée : **Inter** (Google Fonts, graisses 400/500/600/700/800). Les polices « Alfa Slab One », « Barlow Condensed », « ADLaM Display » sont référencées dans les tokens historiques mais **ne sont pas chargées** sur cette page : tout est rendu en Inter.
- Divers hôte : `caret-color: #c9a15a` sur inputs/textarea ; `::selection { background:#c9a15a; color:#000 }` (écrasé ensuite par le skin : `background: var(--sm-accent); color: var(--sm-on-accent)`) ; scrollbars WebKit globales 10 px, pouce `rgba(255,255,255,.14)` rayon 99 px, hover `rgba(201,161,90,.5)` ; `overscroll-behavior: none` ; `@media (prefers-reduced-motion: reduce)` force animations/transitions à `.01ms`.
- Un « hub pill » de démo (lien « S », 30×30 px, coin bas-gauche, opacité .22 → 1 au survol, `z-index: 99999`) et un **switcher de marque** de démo (barre bas-gauche, `z-index: 800`, masquée en iframe) existent dans la maquette : hors périmètre production.

### 1.3 Ordre de cascade CSS (important pour les valeurs effectives)

1. `classfood-ds.css` — design system de base (tokens `--cf-*`, composants `.cf-*`).
2. `sm-ds.css` (importé par `sm-skin.css`) — référentiel « SM Dark » (tokens `--sm-*`, composants `.sm-*`).
3. `sm-skin.css` — **adaptateur** : remappe tous les `--cf-*` sur les valeurs SM Dark et surcharge les classes `.cf-*`. S'applique à `:root`, `[data-theme="dark"]` **et** `[data-theme="light"]` → il n'y a de fait **qu'un seul thème (sombre)** sur cette surface.
4. `sm-brand.jsx` — injecte l'accent du tenant : `--cf-accent: <accent marque>` et `--cf-on-accent: #ffffff` sur `document.documentElement`.

> Conséquence : toutes les valeurs « effectives » citées dans ce document sont celles **après** application du skin SM Dark.

---

## 2. Theming & tokens de design

### 2.1 Règles marque grise (contrat produit)

- **Personnalisable par restaurant (tenant)** : `--sm-accent` / `--cf-accent` (couleur d'accent), logo (tuile initiale), nom, ville, slug, téléphone.
- **Fixe pour tous les comptes** : neutres, typographie, rayons, ombres, et surtout les **couleurs fonctionnelles** :
  - **Vert `#3fae4a`** = prêt / positif / ouvert / en poste
  - **Rouge `#c94b3f`** = nouveau / urgent / alerte / absence / suppression
  - **Ambre `#e0973f`** = attente / en préparation (l'implémentation actuelle du back-office utilise en pratique le **gold `#c9a15a`** pour le badge « En prépa » — voir §2.6)

### 2.2 Marques de démo (tenants)

| id | Nom | Ville | Slug | Accent | Lettre | Téléphone |
|---|---|---|---|---|---|---|
| `classfood` | Class'Food | Perriers-sur-Andelle | `classfood` | `#C8281E` | C | 09 84 36 49 76 |
| `obraise` | O'Braise | Rouen | `obraise` | `#E0762F` | O | 02 35 00 00 00 |
| `greenhouse` | Green House | Évreux | `greenhouse` | `#2F9E62` | G | 02 32 00 00 00 |

- Marque par défaut : `greenhouse` (forcée quand la page est embarquée en iframe) ; sinon lue depuis `localStorage["sm-brand-id"]`.
- Champ dérivé : `fullName = name + " · " + city`.
- Logo marque grise : tuile carrée `size × size` (rayon `round(size × 0.28)`), fond `var(--cf-accent)`, initiale blanche Inter 800 à `size × 0.52` ; wordmark optionnel Inter 800 `size × 0.5`, letter-spacing −0.02em.

### 2.3 Tokens effectifs — couleurs

| Token | Valeur effective | Usage |
|---|---|---|
| `--cf-bg` | `#000` | fond de l'app |
| `--cf-surface` | `#111` | surfaces/cartes de base |
| `--cf-surface-2` | `#1a1a1a` | surfaces secondaires (lignes, en-têtes de table, hover) |
| `--cf-text` / `--cf-ink` | `#fff` | texte principal |
| `--cf-text-mut` / `--cf-mut` | `#999` | texte secondaire |
| `--cf-border` / `--cf-line` | `rgba(255,255,255,.1)` | bordures, séparateurs |
| `--cf-fill` | `#1a1a1a` | fonds « encre » (sidebar, pills, en-têtes drawer) |
| `--cf-on-fill` | `#fff` | texte sur `--cf-fill` |
| `--cf-accent` | **par tenant** (déf. `#c9a15a`) | accent de marque (remplaçable) |
| `--cf-on-accent` | `#fff` (injecté par la couche marque) | texte sur accent |
| `--cf-gold` / `--sm-accent` par défaut | `#c9a15a` | doré SM (badges « En prépa », étoiles, alertes douces) |
| `--cf-green` / `--sm-green` | `#3fae4a` | **fonctionnel : prêt/positif** |
| `--cf-red` / `--sm-red` | `#c94b3f` | **fonctionnel : urgent/alerte** |
| `--sm-amber` | `#e0973f` | **fonctionnel : attente** (défini, peu utilisé dans ce module) |
| `--sm-accent-hover` | `#e0b96f` | focus ring |
| `--sm-card` | `#111` | carte plate |
| `--sm-badge-bg` | `#1a1a1a` | fonds badges/iconbtn |
| `--sm-btn-dark` | `#262626` | bouton « ink » |
| `--sm-surface-3` | `rgba(255,255,255,.03)` | hover ligne de table |
| `--sm-surface-6` | `rgba(255,255,255,.06)` | bordures de cartes, chips |
| `--sm-border-10` | `rgba(255,255,255,.1)` | bordures |
| `--sm-white-50` | `rgba(255,255,255,.5)` | bordure chip actif |
| `--sm-gray` | `#999` | texte secondaire |
| `--sm-card-gradient` | `linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)` | fond des cartes |

### 2.4 Tokens effectifs — rayons, espacements, layout

| Token | Valeur | Usage |
|---|---|---|
| `--cf-r` / `--sm-r` | `16px` | cartes |
| `--cf-r-sm` / `--sm-r-sm` | `10px` | inputs |
| `--cf-r-lg` / `--sm-r-lg` | `20px` | grands blocs |
| `--sm-r-md` | `12px` | cartes plates |
| `--sm-r-xs` | `8px` | petits éléments |
| `--cf-r-pill` / `--sm-r-pill` | `999px` / `50px` | pilules, boutons |
| `--cf-u` | `16px` | gap standard (`.cf-row`, `.cf-between`) |
| `--cf-u2` | `24px` | espacement moyen |
| `--cf-u3` | `32px` | grand espacement |
| `--sm-content` | `1200px` | largeur contenu landing (non utilisée ici) |

Grille de la surface : padding de contenu des vues **26 px** ; gouttières entre cartes **16 px** ; padding interne des cartes **18 px** (20 px pour certaines cartes avis) ; padding des lignes de table `12px 18px` (en-tête) et `10–12px 18px` (lignes).

### 2.5 Tokens effectifs — typographie

Police unique : `'Inter', system-ui, sans-serif` (`--cf-disp`, `--cf-body`, `--cf-cond` pointent tous sur Inter après skin).

| Classe | Style effectif | Usage |
|---|---|---|
| `.cf-disp` | Inter 600, letter-spacing −0.03em, line-height 1.1, pas de capitales | titres, gros chiffres, n° de retrait |
| `.cf-cond` | Inter 500, letter-spacing −0.015em | texte courant dense |
| `.cf-eyebrow` | 11 px, 600, uppercase, letter-spacing .06em, couleur `#999` | libellés de sections |
| `.cf-label` | 12 px, 700, uppercase, letter-spacing .04em, `#999` | labels de champs |
| `.cf-tabnums` | `font-variant-numeric: tabular-nums` | toutes les colonnes chiffrées |

Échelle observée dans ce module : 8–9 px (pills), 10–11 px (eyebrows/en-têtes de table), 12–13.5 px (méta), 14–15 px (texte), 16–18 px (titres de cartes), 20–24 px (titres/numéros), 30 px (valeurs KPI), 44 px (note moyenne avis).

### 2.6 Sémantique des statuts de commande (fixe tous tenants)

| Statut | Libellé affiché | Couleur badge | Texte badge |
|---|---|---|---|
| `new` | « Nouvelle » | `var(--cf-accent)` (accent tenant) | `#fff` |
| `cooking` | « En prépa » | `var(--cf-gold)` `#c9a15a` | `#1C1612` |
| `ready` | « Prête » | `var(--cf-green)` `#3fae4a` | `#fff` |
| `done` | « Remise » | `var(--cf-text-mut)` `#999` | `#fff` |

> ⚠️ Écart avec la règle produit « rouge = nouveau/urgent, ambre = attente » : la maquette colore « Nouvelle » avec **l'accent tenant** (pas le rouge fixe) et « En prépa » avec le **gold** `#c9a15a` (pas l'ambre `#e0973f`). Choix final **à définir** ; recommandation : appliquer les couleurs fonctionnelles fixes en production.

### 2.7 Ombres & divers

- Ombre carte : `--cf-shadow-card: 0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)`.
- Ombres génériques : `--cf-shadow: 0 1px 0 rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.38)` ; `--cf-shadow-2: 0 2px 0 rgba(0,0,0,.35), 0 16px 40px rgba(0,0,0,.45)` ; `--cf-shadow-soft: 0 12px 34px rgba(0,0,0,.4)` ; `--cf-shadow-accent: 0 0 0 1px var(--cf-accent)`.
- Focus clavier : `:focus-visible { outline: 2px solid var(--sm-accent-hover) #e0b96f; outline-offset: 2px }`.
- Motion tokens : `--sm-ease: cubic-bezier(.2,.8,.2,1)` ; `--sm-t-fast: .2s` ; `--sm-t-med: .45s` ; `--sm-t-slow: .6s`.

### 2.8 Mécanisme de « tweaks » (préférences visuelles)

Un applicateur global lit `localStorage["cf-tweaks"]` (JSON `{ accent, radius, density }`) et pose sur `<html>` :
- `--cf-accent = accent` ;
- `--cf-r = radius px`, `--cf-r-sm = max(4, radius−5) px`, `--cf-r-lg = radius+8 px` ;
- `--cf-u = density px`, `--cf-u2 = round(density × 1.5) px`.

En production : mapper sur la configuration du tenant (API), pas sur localStorage — **à définir**.

---

## 3. Shell applicatif

### 3.1 Cadre « navigateur » (démo)

La maquette encapsule l'app dans un faux navigateur desktop :
- Conteneur : **1360 × 862 px**, `border-radius: 16px`, `overflow: hidden`, ombre `0 40px 100px rgba(0,0,0,0.4)`, fond `var(--cf-surface)`.
- Barre de titre : hauteur **44 px**, fond `var(--cf-surface-2)`, `border-bottom: 1px solid var(--cf-border)`, padding `0 16px` ; trois pastilles 12 px (`#ff5f57`, `#febc2e`, `#28c840`), gap 8 px.
- Barre d'URL : pilule centrée `max-width: 420px`, hauteur 26 px, rayon 8 px, bord 1 px `var(--cf-border)`, icône check 12 px verte + texte 13 px `#999` : **`admin.{slug}.fr`** (ex. `admin.greenhouse.fr`).

En production ce cadre disparaît ; l'app occupe le viewport. Le canevas de référence du design est donc **1360 × 862** (dont 66 px de rail sidebar → zone de contenu ≈ **1294 px** de large).

### 3.2 Sidebar rétractable — **overlay, ne pousse pas le contenu**

Structure :
- Un conteneur en flux de **largeur fixe `RAIL = 66px`** (`flex-shrink: 0`, `position: relative`, **`z-index: 45`**) réserve la place du rail.
- À l'intérieur, le panneau réel est en `position: absolute; top: 0; bottom: 0; left: 0` avec `width: open ? 232px : 66px` (`PANEL = 232`). **Quand elle s'ouvre, la sidebar recouvre le contenu à droite (overlay), le contenu ne bouge pas.**
- Fond `var(--cf-fill)` `#1a1a1a`, `border-right: 1px solid var(--cf-border)`, padding `18px 12px`, `overflow: hidden`, colonne flex.
- Transition : `width .28s cubic-bezier(.2,.8,.2,1), box-shadow .28s`. Ombre portée à l'état ouvert : `18px 0 44px rgba(0,0,0,0.45)` ; `none` fermé.
- Le panneau porte `data-theme="dark"` (sans effet visuel ici, le skin unifie les thèmes — à conserver si un jour le back-office repasse en clair).

Persistance : état ouvert/fermé écrit dans `localStorage["sm-bo-nav"]` (`"open"` / `"closed"` ; défaut : ouvert).

En-tête :
- Logo marque (tuile initiale) taille 30 px + nom du tenant 18 px `var(--cf-text)`, `white-space: nowrap`, **opacité 1 → 0 en .2s** quand la sidebar se ferme.
- Ouvert : eyebrow « **Gestion** » (10 px, `rgba(244,238,225,0.4)`, padding `0 8px 8px`). Fermé : trait horizontal 1 px `rgba(244,238,225,0.12)` (marges `0 4px 10px`).

Navigation (8 entrées, gap 3 px) — ordre, icône, libellé exacts :

| id | Icône | Libellé |
|---|---|---|
| `dashboard` | `home` | Tableau de bord |
| `orders` | `ticket` | Commandes |
| `menu` | `grid` | Menu & prix |
| `promos` | `tag` | Promos |
| `hours` | `clock` | Horaires |
| `stats` | `chart` | Statistiques |
| `team` | `user` | Équipe & pointage |
| `reviews` | `star` | Avis clients |

Item de nav — états :
- **Normal** : fond transparent, texte `rgba(244,238,225,0.72)`, Inter 600 14 px, icône 18 px stroke 2, padding `11px 12px` (ouvert) / `11px 0` centré (fermé), rayon 10 px, `title` natif = libellé (tooltip utile en mode fermé).
- **Actif** : fond `var(--cf-accent)`, texte `#fff`, graisse 800, icône stroke 2.3.
- **Hover** : rien de spécifié dans la maquette (transition `background .12s` prête) — **à définir** (suggestion : `rgba(244,238,225,0.06)`).
- **Badge de compteur** (uniquement `orders`) : nombre de commandes au statut `new`. Ouvert : pilule à droite, fond `var(--cf-gold)`, texte `#1C1612` 11 px 800, padding `1px 7px`, rayon 999. Fermé : point 8 px `var(--cf-gold)` en `top: 7px; right: 12px`, bord 2 px `var(--cf-fill)`. Masqué si 0.

Pied de sidebar (`margin-top: auto`, `border-top: 1px solid rgba(244,238,225,0.12)`, disposition ligne si ouvert / colonne si fermé, gap 10 px) :
- Avatar rond 34 px fond `var(--cf-accent)`, initiale « M » 15 px blanc.
- Ouvert seulement : « **Le Gérant** » (14 px 700 `var(--cf-cream)`) et la ville du tenant (12 px `rgba(244,238,225,0.5)`).
- Icône `gear` 17 px `rgba(244,238,225,0.5)`, `title="Paramètres"` — **no-op, à définir**.
- Bouton réduire/développer : 28×28 px, rayon 8 px, bord 1 px `rgba(244,238,225,0.18)`, fond `rgba(244,238,225,0.06)`, icône `back` (ouvert) / `arrow` (fermé) 14 px, `title` = « Réduire le menu » / « Développer le menu », transition `background .12s`.

> Nuances de couleur en dur dans la sidebar (`rgba(244,238,225,…)` = crème du DS historique) : conserver ou normaliser sur blanc — **à définir**.

### 3.3 Topbar

- Bandeau `padding: 16px 26px`, `border-bottom: 1px solid var(--cf-border)`, fond `var(--cf-bg)`, `flex-shrink: 0`, disposition `space-between`.
- Gauche :
  - `<h1>` titre de la vue = libellé de l'entrée de nav active, 24 px `.cf-disp`.
  - Sous-titre 14 px `#999` : date du jour formatée `fr-FR` `{weekday long} {day} {month long} {year}` avec première lettre en capitale, suivie de « ` · service du midi` » si heure locale < 16 h, sinon « ` · service du soir` ».
- Droite (gap 12 px) :
  - **Recherche globale** : input `.cf-input` largeur 220 px, `padding-left: 36px`, placeholder « `Rechercher…` », icône 16 px `#999` positionnée `left: 12px; top: 12px`. ⚠️ La maquette utilise l'icône `grid` (quadrillage) et l'input est **non câblé** (aucun état) — fonctionnalité **à définir** (recommandé : icône `search`, recherche globale commandes/produits/clients).
  - **Pilule Ouvert/Fermé** (état local `open`, défaut ouvert) : bouton pilule `padding: 8px 14px`, fond `var(--cf-surface)`, bord `2px solid var(--cf-green)` si ouvert / `2px solid var(--cf-accent)` si fermé ; pastille 9 px de même couleur ; libellé gras 14 px « **Ouvert** » / « **Fermé** ». Clic = bascule. ⚠️ Aucun effet aval dans la maquette (pas de coupure de la prise de commande) — comportement serveur **à définir**.
  - **Cloche** : `.cf-iconbtn` (40×40, pilule, bord 1 px `rgba(255,255,255,.1)`, fond `#1a1a1a`, hover bord `rgba(255,255,255,.5)`) icône `bell` 18 px — **no-op, notifications à définir**.

### 3.4 Zone de contenu

- `flex: 1`, colonne, `overflow: hidden`, fond `var(--cf-bg)`. Chaque vue gère son propre scroll vertical (`.cf-scroll`, scrollbar fine 8 px, pouce `rgba(255,255,255,.1)`).
- Vue inconnue (fallback) : texte « `…` » en `#999`, padding 40 px.
- La navigation entre vues est un simple échange de contenu (state local `view`) : **pas de routing URL** dans la maquette. En production : routes Next.js (`/dashboard`, `/orders`, …) — **à définir**.

---

## 4. Bibliothèque de composants & états

### 4.1 Boutons `.cf-btn` (composant `Btn`)

Base effective : inline-flex centré, gap 9 px, Inter 600 14 px, letter-spacing −0.2 px, pas de capitales, padding `13px 20px`, rayon 50 px, `white-space: nowrap`.

| Variante | Fond | Texte | Bord |
|---|---|---|---|
| `primary` | `var(--cf-accent)` | `#fff` | — |
| `ink` | `#262626` | `#fff` | — |
| `ghost` | transparent | `#fff` | `1px solid rgba(255,255,255,.1)` |
| `gold` | `var(--sm-accent)` | `var(--sm-on-accent)` | — (non utilisée ici) |

Tailles : `sm` → padding `9px 14px`, 12 px, icône 15 px (sinon 18 px). `block` → `width: 100%`.

États :
- **Hover** : `opacity: .85` (transition `.2s`) ; ghost : fond `rgba(255,255,255,.06)`.
- **Actif (pressed)** : `transform: translateY(1px)` (transition `.12s`).
- **Désactivé** : `opacity: .4`, `cursor: not-allowed`, sans ombre. (Aucun bouton n'est rendu désactivé dans ce module — règles d'activation **à définir**.)
- Icône optionnelle à gauche (`icon`) et/ou à droite (`iconRight`).

### 4.2 Bouton icône `.cf-iconbtn`

40×40 px (souvent réduit inline : 26–34 px), pilule, bord `1px solid rgba(255,255,255,.1)`, fond `#1a1a1a`, icône `currentColor`. Hover : bord `rgba(255,255,255,.5)` (transition `.12s`).

### 4.3 Chips de filtre `.cf-chip`

Pilule Inter 500 15 px, padding `7px 14px`, gap 6 px, fond `rgba(255,255,255,.06)`, texte `#999`, bord 1 px transparent, `user-select: none`, transition `all .12s`.
- **Hover** : texte `#fff`.
- **Actif** (`.is-on` / `aria-pressed="true"`) : texte `#fff`, bord `rgba(255,255,255,.5)`.

### 4.4 Pills `.cf-pill`

Inline-flex, Inter 600, uppercase, letter-spacing .06em, 10 px (souvent 8–9 px inline), padding `4px 9px`, rayon 999. Par défaut fond `#1a1a1a` / texte `#fff`. Variante `--out` : transparent, texte `#999`, bord `1.5px solid rgba(255,255,255,.1)`. Couleurs de fond posées inline selon sémantique (accent, gold, green, mut).

### 4.5 Champs `.cf-input` / `.cf-select` / `.cf-field` / `.cf-label`

- Input : Inter 15 px (souvent 13–14 px inline), texte `#fff`, fond `rgba(255,255,255,.05)`, bord `1px solid rgba(255,255,255,.06)`, rayon 10 px, padding `12px 14px` (souvent réduit inline), `width: 100%`.
- **Focus** : bord `var(--cf-accent)` (transition `.12s`), sans box-shadow. Placeholder : `#999` à 75 % d'opacité.
- `.cf-field` : colonne gap 6 px ; `.cf-label` : cf. §2.5.
- Select `.cf-select` : mêmes styles + chevron SVG gris intégré à droite (12 px).

### 4.6 Toggle (interrupteur) — composant local

- Piste **46 × 26 px**, rayon 999, sans bord ; pouce blanc **20 px** (`top: 3px`), `left: 3px` (off) → `left: 23px` (on), ombre `0 1px 3px rgba(0,0,0,0.3)`.
- Transitions : fond `.15s`, pouce `left .15s`.
- Couleurs : off `rgba(255,255,255,.1)` ; on **vert `#3fae4a`** ; variante `danger` on = **`var(--cf-accent)`** (⚠️ accent tenant, pas le rouge fixe — voir §17).

### 4.7 SlotToggle (créneau Ouvert/Fermé)

Bouton pilule, padding `6px 14px`, gap 8 px : pastille 8 px + libellé 13 px gras.
- **On** : bord `1.5px solid #3fae4a`, fond `color-mix(in srgb, var(--cf-green) 12%, var(--cf-surface))`, pastille et texte verts, libellé « Ouvert ».
- **Off** : bord `1.5px solid rgba(255,255,255,.1)`, fond `var(--cf-surface)`, pastille et texte `#999`, libellé « Fermé ».

### 4.8 Cartes `.cf-card--soft` et `Panel`

- Carte : fond `linear-gradient(180deg, rgba(17,17,17,.9), #111)`, bord `1px solid rgba(255,255,255,.06)`, rayon 16 px, `overflow: hidden`, ombre `0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)`.
- `Panel` = carte padding 18 px avec en-tête (`margin-bottom: 14px`) : titre `.cf-disp` 18 px, sous-titre optionnel 13 px `#999`, zone d'action à droite.

### 4.9 KPI (composant `Kpi`)

Carte padding 18 px, `flex: 1` :
- Ligne 1 : eyebrow 11 px + carré d'icône 34×34 px rayon 9, fond `#1a1a1a`, icône 18 px accent.
- Valeur : 30 px `.cf-disp`, `margin-top: 8px`.
- Delta optionnel : 13 px 700, `margin-top: 2px` ; **hausse** : `▲` vert `#3fae4a` ; **baisse** : `▼` couleur accent (le module ne rend que des hausses ; style baisse **à définir** — recommandé rouge fixe).

### 4.10 BarChart (histogramme simple)

- Conteneur : flex aligné en bas, gap 10 px, hauteur paramétrable (150/170/190 px selon usage).
- Chaque colonne : valeur formatée au-dessus (12 px 600 `#999`), barre `width: 100%`, hauteur `(v / max) × (hauteur − 40) px` (min 4 px si v > 0), fond `var(--cf-accent)`, rayon `6px 6px 0 0`, **transition `height .4s ease`** ; label en dessous (12 px 600 `#999`).

### 4.11 Étoiles (`Stars`)

5 SVG 24×24 (taille rendue 13–17 px, gap 2 px) ; remplies : fill + stroke `var(--cf-gold)` `#c9a15a` ; vides : fill none, stroke `var(--cf-line)`, stroke-width 1.5.

### 4.12 Badge de statut commande (`StatusBadge`)

`.cf-pill` 9 px — mapping exact en §2.6. Statut inconnu → repli sur « Nouvelle ».

### 4.13 Icônes

Bibliothèque interne : SVG 24×24 en tracés `stroke` (linecap/linejoin round), `stroke-width` 2 par défaut, `color: currentColor`, `aria-hidden="true"`. Noms utilisés dans ce module : `home, ticket, grid, tag, clock, chart, user, star, check, plus, minus, bell, gear, back, arrow, close, phone, euro, cart, fries, print, trash, edit, search`. (Les *path data* complets sont dans le fichier d'icônes partagé de la maquette ; à porter tels quels ou remplacer par une lib d'icônes — **à définir**.)

### 4.14 Toasts (disponible, non utilisé ici)

Composant partagé : pilule sombre centrée en bas (`bottom: 24px`, `z-index: 9000`), padding `12px 18px`, Inter 700 14 px, animation pop, autodismiss **2200 ms** (paramétrable). Le back-office ne déclenche **aucun toast** dans la maquette — feedbacks de succès/erreur **à définir**.

### 4.15 Formatage monétaire

- `fmtEuro(n)` → `n` en `#,##` virgule décimale + " €" (ex. `1290` → « 1290,00 € » ; NaN/null → « — »).
- `parseEuro(s)` → accepte nombre ou chaîne, retire `+`, espaces et `€`, convertit `,` en `.` ; toute chaîne non purement numérique → `NaN` (c'est le mécanisme des prix « à définir »).

---

## 5. Vue « Tableau de bord »

Conteneur : scroll vertical, padding 26 px.

### 5.1 Sélecteur de période

Rangée de 3 chips (gap 8 px, `margin-bottom: 16px`) : « **Aujourd'hui** » (`1j`, défaut), « **7 jours** » (`7j`), « **30 jours** » (`30j`). Sélection exclusive (`.is-on`). Change les 4 KPI **et** le graphique CA (§5.6). État local, non persisté.

### 5.2 Rangée KPI (4 cartes, gap 16 px)

Copy exacte par période (label / valeur / delta / icône) — tous les deltas sont rendus en « hausse » (▲ vert) :

**Aujourd'hui (`1j`)**
| Label | Valeur | Delta | Icône |
|---|---|---|---|
| CA | 1 290 € | +18 % vs hier | `euro` |
| Commandes | 103 | +11 % vs hier | `ticket` |
| Panier moyen | 12,50 € | +0,60 € | `cart` |
| Conversion menu | 41 % | +3 pts | `fries` |

**7 jours (`7j`)** : CA `6 200 €` / `+9 % vs sem. passée` ; Commandes `490` / `+6 %` ; Panier moyen `12,65 €` / `+0,35 €` ; Conversion menu `38 %` / `+1 pt`.

**30 jours (`30j`)** : CA `24 400 €` / `+14 % vs mois passé` ; Commandes `1 960` / `+12 %` ; Panier moyen `12,45 €` / `+0,20 €` ; Conversion menu `36 %` / `+4 pts`.

### 5.3 Carte « Objectif du jour » (1/3 de rangée, gap 16 px, `margin-top: 16px`)

- Titre 16 px + deux mini-boutons `.cf-iconbtn` 26×26 px « − » / « + » (15 px).
- **Interaction** : `−` retire 100 € (plancher **300 €**), `+` ajoute 100 €. Objectif persisté dans `localStorage["sm-bo-goal"]` (entier ; défaut **1500**). En production : réglage par restaurant côté serveur — voir §14.
- Ligne montant : `fmtEuro(caJour)` 22 px 800 + « `/ {fmtEuro(objectif)}` » 14 px `#999`. CA du jour figé à **1290** dans la maquette (→ « 1290,00 € / 1500,00 € »).
- Barre de progression : piste 10 px rayon 6 fond `#1a1a1a` ; remplissage `min(100, round(ca/objectif×100))%`, **vert `#3fae4a` si ≥ 100 %, sinon accent**, `transition: width .3s`.
- Ligne d'état 13 px `#999` :
  - < 100 % : « `{pct} % · reste {fmtEuro(objectif − ca)} ≈ {ceil((objectif − ca)/12,5)} commandes` » (12,5 € = panier moyen implicite, en dur).
  - ≥ 100 % : « `Objectif atteint — bravo à l'équipe.` »

### 5.4 Carte « Prévisions du service »

Titre + pill gold « **Prédictif** » (9 px, texte `#1C1612`). Trois lignes statiques (emoji 15 px + texte 13,5 px, gap 9 px vertical) :
- 📈 « Rush attendu **19h30 – 21h00** — samedi type : 121 commandes »
- ⚠️ « Frites : au rythme actuel, rupture estimée **~20h40** — prévoir un bac de plus »
- 👥 « 2 en cuisine + 1 comptoir recommandés sur le créneau du soir »

Contenu **statique en maquette** ; moteur prédictif réel **à définir**.

### 5.5 Carte « À faire maintenant »

Trois boutons-lignes (fond `#1a1a1a`, rayon 9, padding `9px 12px`, 13,5 px, flèche « → » accent 700 à droite, gap 7 px vertical). Chacun **navigue** vers une vue :
1. pill accent « 1 » — « Commande en ligne à accepter » → vue Commandes
2. pill gold « 3 » — « Avis clients sans réponse » → vue Avis
3. pill `#999` « 1 » — « Rupture à réactiver · Milkshake Oréo » → vue Menu

Compteurs **statiques** en maquette ; en production ils doivent être calculés (commandes `new`, avis sans `reply`, produits `out`) — voir §14.

### 5.6 Rangée « Commandes en direct » + graphique (marge haute 16 px)

- **Commandes en direct** (carte `flex: 1.3`) : en-tête titre 18 px + lien-bouton « **Tout voir →** » (accent 700 14 px, sans bord) → vue Commandes. Liste des **4 premières commandes** (gap 8 px) ; ligne : fond `#1a1a1a` rayon 10 padding `10px 12px` ; n° de retrait 20 px accent (min-width 34) ; « `{nom} · {n} article(s)` » 15 px gras ; sous-ligne 13 px `#999` « `{id} · {canal} · {écoulé}` » ; `StatusBadge` ; total 15 px tabulaire aligné droite (min-width 62). Temps écoulé : « à l'instant » si ≤ 0 min sinon « il y a {m} min » (recalculé au re-render seulement, pas de tick — **à définir** : rafraîchissement périodique).
- **Graphique** (carte `flex: 1`) : titre = `sub` de la période (« Commandes du jour · par heure » / « CA · 7 derniers jours » / « CA · 4 dernières semaines ») ; sous-titre « `Total · {total}` » (« 103 commandes » / « 6 200 € » / « 24 400 € ») ; BarChart hauteur **170 px**, format valeur : vide si 0, `{n/1000 arrondi au dixième}k` si ≥ 1000, sinon entier.
  - Données `1j` : `[3,5,22,38,30,12,6,9,20,44,52,31]`, labels `11h…22h`.
  - Données `7j` : `[0,640,720,810,1180,1560,1290]`, labels `Lun…Dim`.
  - Données `30j` : `[4980,5640,5210,6200]`, labels `S-3, S-2, S-1, Cette sem.`.

### 5.7 Carte « Top ventes de la semaine » (pleine largeur, marge haute 16 px)

Titre 18 px. 5 lignes (gap 10 px) : rang 18 px `#999` (min-width 22) · nom 15 px gras (min-width 160) · barre horizontale (piste 12 px rayon 6 fond `#1a1a1a`, remplissage accent proportionnel `qty / qtyDuPremier × 100 %`) · « `{qty} vendus` » 14 px `#999` (min-width 70, droite) · CA `fmtEuro` 14 px gras (min-width 70, droite).

Données mock : Tacos sur-mesure 214 / 2 568 € ; Le Boss 168 / 2 167 € ; Crousty One 141 / 1 339 € ; Family Box 38 / 1 630 € ; Le Smash 96 / 1 142 €. ⚠️ La barre est normalisée sur la **première ligne** (supposée max) — en production trier par quantité ou normaliser sur le vrai max.

---

## 6. Vue « Commandes » (live)

Conteneur : `position: relative` (pour le drawer), zone scrollable padding 26 px.

### 6.1 Filtres & recherche (rangée, gap 8, `margin-bottom: 16px`)

- 5 chips avec compteur vivant : « `Toutes · {n}` », « `Nouvelles · {n}` », « `En prépa · {n}` », « `Prêtes · {n}` », « `Remises · {n}` » (clé interne `all/new/cooking/ready/done`). Sélection exclusive, défaut `all`.
- Input de recherche à droite (`margin-left: auto`, largeur 250 px, padding `8px 12px`), placeholder « `Client, n° commande, n° retrait…` ». Filtrage **client-side** insensible à la casse sur la concaténation `nom + " " + id + " " + n°retrait`, appliqué **après** le filtre de statut.

### 6.2 Table des commandes

Carte sans padding (`overflow: hidden`).

En-tête (fond `#1a1a1a`, padding `12px 18px`, Inter 800 11 px uppercase letter-spacing .08em `#999`) — largeurs de colonnes exactes :

| Colonne | Largeur | Alignement |
|---|---|---|
| N° | 50 px | gauche |
| Client | `flex: 1` | gauche |
| Canal | 120 px | gauche |
| Retrait | 100 px | gauche |
| Statut | 110 px | gauche |
| Total | 90 px | droite |
| Actions | 190 px | droite |

Ligne (padding `12px 18px`, `border-top: 1px solid rgba(255,255,255,.1)`, `cursor: pointer`, clic → ouvre le drawer §6.4) :
- **N° retrait** : 20 px `.cf-disp` couleur accent.
- **Client** : nom 15 px gras ; sous-ligne 13 px `#999` : « `{id} · {résumé articles}` », résumé = `qty×  nom` joints par « , », **tronqué à 44 caractères** (qty omise si 0).
- **Canal** : pill 9 px — « En ligne » fond accent / autres (« Téléphone ») fond `#999`, texte blanc ; si non payée, suffixe « `· à payer` » 12 px couleur accent.
- **Retrait** : créneau `HH:MM` 14 px.
- **Statut** : `StatusBadge` (§2.6).
- **Total** : `fmtEuro` 15 px gras tabulaire.
- **Actions** (gap 6 px, alignées droite) :
  - Bouton imprimer 34×34 (`.cf-iconbtn`, icône `print` 16, `title="Imprimer"`) — **no-op** ; `stopPropagation` (n'ouvre pas le drawer).
  - **Bouton d'avancement d'étape** (Btn `ink` `sm`, `stopPropagation`) avec libellé selon statut : `new` → « **Accepter** », `cooking` → « **Prête** », `ready` → « **Remettre** ». Clic = transition `new → cooking → ready → done` (une étape). Statut `done` : texte « `Terminée` » 13 px `#999` à la place du bouton.

Aucun retour arrière de statut, aucune annulation dans la maquette — **à définir**.

### 6.3 Flux temps réel (maquette → contrat de prod)

Mécanique maquette :
- Au montage, mémorise les ids déjà connus, puis **tire** les nouvelles commandes depuis `localStorage["sm_live_orders"]` (tableau JSON alimenté par l'app client de la démo).
- Déclencheurs : événement `storage` (si `key === "sm_live_orders"` ou event null) **et** polling `setInterval` toutes les **4000 ms**.
- Déduplication par `id` (set des ids vus) ; chaque nouvelle commande est **préfixée en tête de liste** avec `status: "new"` forcé et `placedAt` par défaut `Date.now()`.

Contrat de production équivalent : abonnement temps réel (WebSocket/SSE) sur les nouvelles commandes du tenant + insertion en tête + compteur de la sidebar mis à jour. Notification sonore/visuelle à l'arrivée : **absente de la maquette, à définir**.

### 6.4 Drawer « Fiche commande »

Ouvert au clic sur une ligne ; superposé **à l'intérieur de la zone de contenu** (pas au-dessus de la sidebar) :
- Overlay : `position: absolute; inset: 0`, fond `rgba(28,22,18,0.35)`, `z-index: 50` ; **clic overlay = fermeture**.
- Panneau : ancré à droite, **largeur 400 px**, hauteur 100 %, fond `var(--cf-surface)`, `border-left: 2px solid var(--cf-text)`, ombre `-12px 0 40px rgba(28,22,18,0.25)`, animation d'entrée **`cf-pop` .18s ease** (scale .9 → 1 + fade). Pas d'animation de sortie (fermeture sèche) — **à définir** si souhaitée.

Header (fond `var(--cf-fill)`, texte `var(--cf-on-fill)`, padding `16px 20px`) :
- N° de retrait 30 px couleur `var(--cf-gold)` ; nom client 16 px gras ; sous-ligne « `{id} · {canal}` » 13 px opacité .7.
- Bouton fermer `.cf-iconbtn` (bord `rgba(244,238,225,0.3)`, fond transparent, icône `close` 17, `aria-label="Fermer"`).

Corps (scrollable, padding 20 px) :
1. Rangée de badges (wrap, gap 8) : `StatusBadge` ; badge paiement — payé : pill verte « **Payé en ligne** » / non payé : pill contour (« --out ») texte « **À encaisser** » `#999` bord `1.5px` ; pill contour « **Retrait {HH:MM}** ». Tous en 9 px.
2. Téléphone (si présent) : icône `phone` 15 accent + numéro 14 px.
3. Section « **Articles** » (eyebrow 11) : lignes fond `#1a1a1a` rayon 10 padding `9px 12px`, gap 8 :
   - Quantité 15 px accent (min-width 22) : `{qty}×` ou « `•` » si qty = 0 (article informatif, ex. « à partager »).
   - Nom 15 px gras ; options éventuelles 13 px `#999` jointes par « ` · ` » ; note éventuelle 13 px accent 600 préfixée « `➜ ` ».
   - Prix `fmtEuro` 14 px gras si présent.
4. Ligne Total (séparateur 1 px au-dessus, `margin-top: 12px`) : « Total » 16 px / montant 20 px accent.
5. Section « **Suivi** » (eyebrow 11) — timeline 4 étapes, chacune : pastille 24 px ronde (faite : fond vert + check blanc 13 stroke 3 ; à venir : fond `rgba(255,255,255,.1)` + point blanc 6 px), libellé 14,5 px (700 si faite), ligne à `opacity: .4` si non atteinte :
   - « Reçue » — toujours faite
   - « En préparation » — faite si statut ≠ `new`
   - « Prête » — faite si `ready` ou `done`
   - « Remise au client » — faite si `done`

Footer (padding 16, séparateur haut, 2 boutons `flex: 1`, gap 10) : « **Imprimer** » (ghost sm, icône `print`) et « **Rembourser** » (ink sm, icône `euro`) — **tous deux no-op, flux d'impression et de remboursement à définir**.

Le drawer reflète en direct les changements de statut effectués derrière lui (il relit la commande dans l'état courant).

---

## 7. Vue « Menu & prix »

> Intention affichée par la maquette : base flexible NoSQL/MongoDB — catégories & produits éditables, rattachement libre, import CSV/XML, drag & drop, tri A→Z.

Layout : bandeau d'alerte + bouton import (rangée `space-between`, `margin-bottom: 16px`), puis deux colonnes (`gap: 16px`, alignées en haut) : **carte Catégories 268 px fixe** + **carte Produits `flex: 1`**.

### 7.1 Bandeau « prix à définir »

Affiché si au moins un produit a un prix non numérique (`parseEuro` → NaN) :
- Conteneur `flex: 1`, fond `color-mix(in srgb, var(--cf-gold) 18%, var(--cf-surface))`, bord `1px solid var(--cf-gold)`, rayon 12, padding `10px 14px`, icône `tag` 17 gold.
- Texte 14 px : « **{n} prix à définir** — ces produits n'apparaissent pas encore à la commande client. »

À droite : Btn primary sm icône `arrow` « **Importer CSV / XML** » (`margin-left: 14px`) → ouvre la modale d'import (§7.5).

### 7.2 Carte « Catégories » (268 px, padding 8)

En-tête (padding `4px 6px 8px`) : eyebrow « **Catégories** » (10 px) + 2 boutons compacts :
- « **A→Z** » (fond `#1a1a1a`, bord 1 px, rayon 7, padding `3px 8px`, Inter 800 11 px, `title="Trier par ordre alphabétique"`) : **trie les catégories** par `localeCompare(fr)` sur le titre — action immédiate, sans confirmation ni annulation.
- « + » (icône `plus` 13, padding `3px 7px`, `title="Nouvelle catégorie"`) : révèle la ligne de création (§ ci-dessous).

**Ligne de catégorie** (padding `8px 8px`, rayon 9, `cursor: pointer`, clic = sélection) :
- Poignée de drag « `⋮⋮` » (11 px `#999`, `cursor: grab`, `title="Glisser pour réordonner"`).
- Icône de catégorie 16 px (accent si sélectionnée, sinon `#999`).
- Titre 13,5 px (700 si sélectionnée), ellipsis sur une ligne.
- Compteur de produits 11 px `#999` tabulaire.
- Bouton `trash` 13 px `#999` (`title="Supprimer la catégorie"`, `stopPropagation`).
- **État sélectionné** : fond `#1a1a1a`. Hover : non spécifié — **à définir**.

**Drag & drop de réordonnancement** (HTML5 natif) :
- `draggable` sur la ligne ; au `dragstart` on retient l'index source ; `dragover` → `preventDefault` (autorise le drop) ; au `drop` sur une ligne cible, l'élément est **retiré puis réinséré à l'index cible** (splice). Aucun aperçu/placeholder ni auto-scroll dans la maquette — **à définir** si voulu.
- L'ordre résultant **est l'ordre de la carte client** (contrat produit). Persistance serveur de l'ordre : voir §14.
- Aide sous la liste (11 px `#999`, line-height 1.35) : « `Glisse ⋮⋮ pour réordonner — l'ordre est celui de la carte client.` »

**Création de catégorie** :
- Ligne inline : input autofocus placeholder « `Nom de la catégorie` » (padding `7px 10px`, 13 px) + bouton valider 30×30 fond accent (check blanc 14 stroke 3).
- `Enter` ou clic ✓ = création (id généré, icône par défaut `tag`), la nouvelle catégorie devient **sélectionnée** ; `Escape` = annulation ; valeur vide = annulation silencieuse.

**Suppression protégée** :
- Catégorie **vide** : suppression immédiate, sans confirmation ; si c'était la catégorie sélectionnée, sélection reportée sur la première autre. (⚠️ cas « dernière catégorie restante » non géré par la maquette — garde-fou **à définir**.)
- Catégorie **contenant n produits** : ouverture d'une **modale de confirmation** (§7.4). À la confirmation : les produits passent en « Non rattachés » (`cat = null`), la catégorie est supprimée, la sélection bascule sur « Non rattachés » si nécessaire.

**Rangée spéciale « Non rattachés »** : visible uniquement si ≥ 1 produit orphelin ; séparée par un trait 1 px (`margin-top: 6px; padding-top: 6px`), icône `tag`, **pas de poignée de drag ni de bouton supprimer** (non réordonnable, non supprimable).

### 7.3 Carte « Produits »

- Barre de recherche (padding `12px 18px 0`) : input placeholder « `Rechercher un produit dans toute la carte…` » (padding `9px 12px`). **Quand une recherche est active, la liste ignore la catégorie sélectionnée et cherche dans toute la carte** (match `includes` insensible à la casse sur le nom).
- En-tête de table (fond `#1a1a1a`, padding `12px 18px`, 11 px 800 uppercase `#999`) :

| Colonne | Largeur | Contenu |
|---|---|---|
| (titre) | `flex: 1` | titre de la catégorie active, ou « **Résultats** » si recherche |
| Prix | 110 px | — |
| Dispo | 86 px (centré) | — |
| Rupture | 86 px (centré) | — |
| (édition) | 44 px | — |

- Corps : `max-height: 540px`, scroll interne.

**Ligne produit** (padding `10px 18px`, séparateur haut 1 px ; **`opacity: .5` si produit en rupture**) :
- Nom 15 px gras. Pill de catégorie apposée (8 px, `margin-left: 8px`) **seulement** en mode recherche ou si non rattaché : « Non rattaché » fond gold texte `#0a0b0d`, sinon titre de catégorie fond `#1a1a1a` texte `#999`.
- Description 12 px `#999`, ellipsis 1 ligne.
- **Champ prix** (colonne 110) : input suffixé « € » (positionné `right: 9px; top: 8px`, 14 px `#999`), padding `7px 22px 7px 10px`, 14 px. Valeur affichée : chiffres et virgule uniquement. **État « à définir »** (prix non numérique) : valeur vide, placeholder « `à définir` », bord `var(--cf-gold)`, fond `color-mix(in srgb, var(--cf-gold) 14%, var(--cf-surface))`. Saisie libre, non validée en maquette (validation/format serveur **à définir**).
- **Toggle « Dispo »** (vert) : l'état affiché est `avail && !out` (une rupture éteint visuellement la dispo) ; le clic bascule **`avail` uniquement**.
- **Toggle « Rupture »** (variante danger → accent) : **rupture 1-tap** ; le clic bascule `out`. Produit `out` → ligne à 50 % d'opacité + exclu de la commande client (contrat).
- **Bouton édition** ✎ 32×32 (rayon 8, bord 1 px ; inactif : fond `#1a1a1a` icône blanche ; actif : fond accent icône blanche ; `title="Modifier le produit"`) : ouvre/ferme le **panneau d'édition inline** sous la ligne.

**Panneau d'édition inline** (fond `#1a1a1a`, padding `2px 18px 14px`, grille 2 colonnes gap 10) :
- Champ « **Nom** » (input contrôlé, modification en direct).
- Champ « **Rattachement (catégorie)** » : select listant toutes les catégories + option « **Non rattaché** ». Changement immédiat (c'est le 2e moyen de rattacher un orphelin).
- Champ pleine largeur « **Composition / ingrédients** », placeholder « `Ex : escalope de poulet, jambon, œuf, tomate grillée` ».
- Boutons alignés droite : « **Fermer** » (ghost sm) et « **Enregistrer** » (primary sm, icône check). ⚠️ Dans la maquette les deux ne font que fermer le panneau — les éditions sont déjà appliquées à la frappe. En production, décider : édition optimiste + autosave, ou buffer et vrai « Enregistrer » — **à définir**.

**État vide** de la liste (aucun produit dans la catégorie / aucun résultat) : texte centré 14 px `#999`, padding 26 : « `Aucun produit ici — rattache des produits via ✎ ou importe un fichier.` »

**Création de produit à l'unité : absente de la maquette** (seuls l'import et l'édition existent) — **à définir**.

### 7.4 Modale « Supprimer la catégorie »

- Overlay : `position: absolute; inset: 0` (au-dessus de la vue), fond `rgba(0,0,0,0.6)`, **`z-index: 60`**, contenu centré. Clic overlay : **ne ferme pas** (seuls les boutons ferment).
- Boîte : `.cf-card` **440 px**, padding 22.
- En-tête : carré 38×38 rayon 10 fond `color-mix(in srgb, var(--cf-red) 22%, var(--cf-surface))` avec icône `trash` 18 **rouge `#c94b3f`** + titre 16,5 px gras : « `Supprimer « {titre} » ?` »
- Corps 14 px `#999` (interligne 1.5) : « `Cette catégorie contient` **`{n} produit(s)`**`. Ils ne seront` **`pas supprimés`** `: ils passeront en « Non rattachés », prêts à être réaffectés à une autre catégorie.` »
- Boutons (droite, gap 8, marge 18) : « **Annuler** » (ghost sm) ; « **Supprimer la catégorie** » (primary sm, icône `trash`, fond forcé **`var(--cf-red)`**).

### 7.5 Modale « Importer la carte (CSV / XML) » — 3 étapes

Même overlay que §7.4 (`rgba(0,0,0,0.6)`, z 60). Boîte **520 px**, padding 22. Titre : « **Importer la carte (CSV / XML)** » + bouton `close` 17 (ferme à toute étape et réinitialise).

**Étape 1 — dépôt de fichier** :
- Grande zone cliquable pleine largeur : fond `#1a1a1a`, bord **`2px dashed rgba(255,255,255,.1)`**, rayon 12, padding `26px 16px`, centrée : icône `arrow` 22 accent pivotée 90° (flèche vers le bas), texte gras 14,5 px « **Dépose ton fichier ici ou clique pour parcourir** », sous-texte 12,5 px `#999` « `.csv · .xml — max 5 Mo` ». ⚠️ En maquette, le clic passe directement à l'étape 2 (fichier simulé) ; **pas de vrai file input ni de drag & drop de fichier** — à implémenter en production (avec les mêmes contraintes affichées : `.csv`/`.xml`, 5 Mo max).
- Paragraphe d'aide 12,5 px `#999` (interligne 1.5) : « `Colonnes attendues :` **`nom ; prix ; catégorie ; composition ; dispo`**`. Les catégories inconnues sont créées automatiquement. Schéma flexible (NoSQL / MongoDB) : les colonnes supplémentaires sont conservées telles quelles.` »
- Bas : lien-bouton accent 13 px 700 « **Télécharger le modèle CSV** » (**no-op en maquette — à définir**) et « **Annuler** » (ghost sm).

**Étape 2 — aperçu** :
- Intro 13,5 px `#999` : « `Aperçu —` **`carte-aout.csv`** `: 3 produits · 1 nouvelle catégorie (« Wraps »)` ».
- Mini-table (bord 1 px, rayon 10) — en-tête fond `#1a1a1a` 10 px uppercase : `Nom` (flex 1) / `Prix` (64 px) / `Catégorie` (120 px). Lignes de démo exactes :

| Nom | Prix | Catégorie | Composition |
|---|---|---|---|
| Wrap Crousty | 8,90 € | Wraps | Tenders, cheddar, salade |
| Wrap Signature | 9,90 € | Wraps | Poulet mariné, sauce maison |
| Brownie | 3,50 € | Desserts & Glaces | Fait maison |

- Pill de catégorie : si la catégorie existe déjà → fond `#1a1a1a` texte `#999` avec son nom ; si elle sera créée → **fond vert `#3fae4a` texte blanc** libellé « `{nom} · nouveau` ».
- Boutons : « **Retour** » (ghost sm → étape 1) / « **Confirmer l'import** » (primary sm, icône check).
- **Logique d'import** : pour chaque ligne, retrouver la catégorie **par titre exact** ou la créer (icône `tag`) ; créer les produits (`avail: true`, `out: false`, id généré). Les produits importés apparaissent immédiatement dans la liste.

**Étape 3 — succès** :
- Centré : disque 52 px fond `color-mix(in srgb, var(--cf-green) 22%, var(--cf-surface))` avec check 26 **vert** stroke 3 ; titre 16 px 800 « **Import terminé** » ; texte 13,5 px `#999` : « `3 produits ajoutés · catégorie « Wraps » créée.` » (retour ligne) « `Retrouve-les dans la liste, prêts à éditer.` »
- Bouton centré « **Fermer** » (primary sm).

---

## 8. Vue « Promos »

Deux colonnes (gap 16, alignées en haut) : gauche `flex: 1.4`, droite `flex: 1`.

### 8.1 Panel « Codes promo »

- Sous-titre : « `Actifs sur le site & l'app de commande` ». Action droite : Btn primary sm icône `plus` « **Nouveau code** » — **no-op, formulaire de création à définir**.
- Carte de code (gap vertical 10) : conteneur **bord `1.5px dashed var(--cf-accent)`** (style « coupon »), rayon 12, padding `12px 14px`, fond `var(--cf-surface)` :
  - Carré 44×44 rayon 10 fond `#1a1a1a`, icône `tag` 22 accent.
  - Code 18 px `.cf-disp` couleur accent ; dessous 14 px `#999` : `{label}` + « ` · dès {min} €` » si un minimum existe.
  - Compteur d'usage 13 px `#999` : « `{n} utilisés` » (valeurs de démo : 142, 89, 37 ; repli 24).
  - **Toggle actif/inactif** (vert) — bascule locale ; persistance serveur à câbler (§14).

Codes de démo (formes de données à supporter) :

| Code | Type | Valeur | Libellé | Minimum |
|---|---|---|---|---|
| `CLASS10` | `pct` | 10 | « -10 % sur la commande » | 0 |
| `BIENVENUE` | `eur` | 3 | « -3 € offerts » | 15 € |
| `MENU250` | `label` | 0 | « Menu +2,50 € au lieu de +3,50 € » | 0 |

### 8.2 Panel « À la une »

- Sous-titre : « `Produits mis en avant sur l'accueil` ».
- 4 lignes (fond `#1a1a1a`, rayon 10, padding `10px 12px`, gap 8 vertical) : étoile 17 gold **remplie**, nom 15 px gras, toggle vert. Produits de démo : « Le Boss », « Tacos sur-mesure », « Family Box », « Le Smash ». ⚠️ Toggles figés à « on », clic sans effet — sélection/désélection réelle **à définir** (dont l'ajout d'un produit à la une).

### 8.3 Encart « Menu du moment »

Bloc sombre (fond `var(--cf-fill)`, rayon 12, padding 14, `margin-top: 16px`) : titre 15 px **gold** « **Menu du moment** » ; texte 14 px `rgba(244,238,225,0.8)` : « `Bandeau « Passe en menu +2,50 € » sur l'accueil client` » ; toggle on (**no-op — à définir**).

---

## 9. Vue « Horaires »

Deux colonnes (gap 16) : gauche `flex: 1.3`, droite `flex: 1`.

### 9.1 Panel « Horaires d'ouverture »

- Sous-titre : « `Créneaux de retrait proposés au client` ».
- En-tête de grille (11 px 800 uppercase `#999`) : « Jour » (110 px) / « **Midi · 11h30–14h30** » (flex 1, centré) / « **Soir · 18h00–22h30** » (flex 1, centré). ⚠️ Les plages horaires elles-mêmes sont **des libellés fixes** : pas d'édition des heures dans la maquette — **à définir** (édition des plages par service).
- 7 lignes (Lundi → Dimanche, padding `9px 6px`, séparateur haut 1 px) : nom du jour 15 px gras + un **SlotToggle** (§4.7) par service. Bascule immédiate, état local.
- État initial de démo : tout ouvert **sauf** Lundi midi et Vendredi midi (fermés).
- Note 13 px `#999` : « `Actuellement : fermé le midi lundi & vendredi (comme sur le flyer).` » (⚠️ texte statique, non recalculé depuis l'état — en production le générer ou le supprimer).

### 9.2 Panel « Fermetures exceptionnelles »

- Action droite : Btn primary sm icône `plus` « **Ajouter** » — **no-op, formulaire à définir** (date(s), motif, sous-texte).
- Lignes statiques de démo (padding `11px 0`, séparateur 1 px) : date 15 px accent centrée (colonne 74 px) ; titre 15 px gras + sous-texte 13 px `#999` ; bouton `trash` 32×32 sans bord (**no-op**).

| Date | Titre | Sous-texte |
|---|---|---|
| 14 juil. | Fête nationale | Fermé toute la journée |
| 15–22 août | Congés d'été | Réouverture le 23 |
| 25 déc. | Noël | Fermé |

### 9.3 Panel « Temps de préparation »

- Sous-titre : « `Affiché au client à la commande` ».
- Ligne : icône `clock` 22 accent + **input non contrôlé** valeur par défaut « 12 » (largeur 70 px, centré, 18 px) + texte 15 px « `minutes en moyenne` ». Aucune persistance en maquette — **à définir** (réglage tenant, cf. §14).

---

## 10. Vue « Statistiques »

Deux rangées de deux panels (gap 16 ; les panels gauches `flex: 1.4`, droits `flex: 1`).

### 10.1 Panel « Chiffre d'affaires »

- Sous-titre : « `7 derniers jours · 6 200 €` ».
- Action droite : Btn ghost sm « **Exporter CSV** » — **fonctionnel dans la maquette** : génère côté client un fichier `classfood-ca-7jours.csv` (Blob `text/csv` préfixé **BOM `﻿`**, séparateur « ; », lignes jointes par `\n`) avec l'en-tête `Jour;CA (EUR);Commandes` puis une ligne par jour (`Lun;0;0`, `Mar;640;52`, …), téléchargé via lien programmatique. ⚠️ Nom de fichier en dur « classfood- » : en production, préfixer avec le slug du tenant — **à définir**.
- BarChart hauteur **190 px**, données CA 7 jours `[0,640,720,810,1180,1560,1290]`, labels `Lun…Dim`, format valeur : vide si 0, sinon `{entier}€`.

### 10.2 Panel « Répartition des canaux »

Trois barres horizontales (gap 14) : label 14 px + pourcentage gras à droite, piste 12 px rayon 6 fond `#1a1a1a`, remplissage :

| Canal | % | Couleur |
|---|---|---|
| En ligne (Click & Collect) | 62 % | `var(--cf-accent)` |
| Sur place / comptoir | 31 % | `var(--cf-ink)` (= `#fff` sous ce skin) |
| Téléphone | 7 % | `var(--cf-gold)` |

Dessous (séparateur 1 px, `margin-top: 20px; padding-top: 16px`) : « `Taux de conversion menu (+2,50 €)` » (`#999`) / valeur « **41 %** » 20 px **vert**.

### 10.3 Panel « Affluence par heure »

- Sous-titre : « `Commandes moyennes / créneau` ».
- Histogramme custom (conteneur 150 px, gap 6) : 12 colonnes 11 h → 22 h, hauteur `v / max × 110 px`, rayon `4px 4px 0 0` ; **la barre max est en accent plein**, les autres en `color-mix(in srgb, var(--cf-accent) 45%, var(--cf-surface-2))` ; labels `{11+i}h` 11 px `#999`. Données : `[3,5,22,38,30,12,6,9,20,44,52,31]` (pic à 21 h).

### 10.4 Panel « Top ventes »

5 lignes (padding `8px 0`, séparateur 1 px sauf première) : rang gras `#999` (marge droite 8) + nom 15 px, CA `fmtEuro` 14 px gras à droite. Mêmes données que §5.7.

Filtres de période, comparaisons, autres granularités : **absents — à définir**.

---

## 11. Vue « Avis clients »

### 11.1 Bandeau résumé (rangée gap 16, `margin-bottom: 16px`)

- **Carte note** (200 px, padding 20, centré) : moyenne calculée (somme étoiles / nombre d'avis, 1 décimale — démo : **4.4**) en 44 px accent ; ligne d'étoiles 17 px (⚠️ la maquette affiche **5 étoiles pleines** en dur, pas la moyenne arrondie — corriger en production) ; sous-texte 13 px `#999` : « `5 avis ce mois · +320 au total` ».
- **Carte distribution** (flex 1, padding 20, gap 6) : 5 rangées de 5★ à 1★ : label `{s}★` 13 px (20 px de large), piste 9 px rayon 5 fond `#1a1a1a`, remplissage **gold** au prorata (`n/total×100 %`), compteur 13 px `#999` (24 px, tabulaire).

### 11.2 Liste des avis (colonne, gap 12)

Carte par avis (padding 16) :
- En-tête : avatar rond 40 px fond `#1a1a1a` initiale 16 px accent ; nom 15 px gras ; étoiles 13 px ; date relative 13 px `#999` à droite (démo : « Il y a 2 j », « Il y a 3 j », « Il y a 5 j », « Il y a 1 sem »).
- Texte de l'avis 15 px, interligne 1.4, `margin-top: 10px`.
- **Si réponse existante** : bloc indenté (`margin: 10px 0 0 20px`, fond `#1a1a1a`, rayon 10, padding `10px 14px`, **`border-left: 3px solid var(--cf-accent)`**) : label 13 px accent « `Réponse de Class'Food` » (⚠️ nom de marque **en dur** — en production : « Réponse de {nom du tenant} ») + texte 14 px.
- **Sinon — zone de réponse** : input `flex: 1` placeholder « `Répondre publiquement…` » (brouillon par avis, état local) + Btn ink sm « **Répondre** ». Clic = publie le brouillon ; si vide, publie le texte par défaut « `Merci pour votre retour ! 🙏` » (⚠️ comportement de démo — en production, désactiver le bouton si vide, **à définir**). Une fois répondida, la zone se remplace par le bloc réponse. Pas d'édition/suppression de réponse — **à définir**.

Données de démo (formes) : `{ name, stars (1–5), date (libellé relatif), text, reply|null }` — 5 avis : Yassine B. 5★, Marie L. 5★ (déjà répondue : « Merci Marie, à très vite ! 🔥 »), Karim D. 4★, Sofia M. 5★, Thomas R. 3★.

Modération, signalement, filtre par note, pagination : **absents — à définir**.

---

## 12. Vue « Équipe & pointage »

### 12.1 Rangée KPI (3 cartes, gap 16, `margin-bottom: 16px`)

| Label (eyebrow 11) | Valeur (30 px, tabulaire) | Icône (17, accent) |
|---|---|---|
| En poste maintenant | `{présents} / {total}` (démo : 3 / 5) | `user` |
| Heures équipe cette semaine | `{somme arrondie} h` (démo : 125 h) | `clock` |
| Absences ce mois | `{somme}` (démo : 3) | `bell` |

### 12.2 Panel « Pointage du jour »

- Sous-titre : « `Badge à l'arrivée et au départ — heures cumulées automatiquement` ».
- Action droite : Btn ghost sm « **Exporter les heures (CSV)** » — fonctionnel en maquette : fichier `pointage-semaine.csv` (BOM `﻿`, `text/csv;charset=utf-8`), en-tête `Employe;Role;Heures semaine;Absences`, une ligne par employé, **décimales en virgule** (ex. `38,5`).

En-tête de table (11 px 800 uppercase `#999`, padding `0 6px 10px`) :

| Colonne | Largeur | Alignement |
|---|---|---|
| Employé | `flex: 1.4` | gauche |
| Statut | `flex: 1` | gauche |
| Aujourd'hui | 110 px | droite |
| Semaine | 110 px | droite |
| Absences | 90 px | droite |
| Action | 150 px | droite |

Ligne employé (padding `12px 6px`, séparateur 1 px) :
- Avatar rond 36 px fond `#1a1a1a`, initiale 14 px — **verte si pointé**, `#999` sinon ; nom 15 px gras ; rôle 12,5 px `#999`.
- **Statut** :
  - Pointé : pastille verte 8 px + texte 13,5 px vert 700 « `En poste · arrivé il y a {h}h{mm}` » (durée depuis le badge d'arrivée, format `Xh` + minutes sur 2 chiffres).
  - Non pointé : 13,5 px `#999` = champ « prochain créneau » s'il existe (démo : « Ce soir 18:00 », « Repos aujourd'hui », « Parti à {HH:MM} ») sinon « `Hors service` ».
- **Aujourd'hui** : durée depuis l'arrivée (même format) ou « — ».
- **Semaine** : `{heures} h` gras tabulaire.
- **Absences** : compteur — **rouge `#c94b3f` si > 0**, sinon « — » en `#999`.
- **Action — pointage 1-clic** : Btn sm — pointé : ghost « **Badger le départ** » ; non pointé : ink « **Badger l'arrivée** ».
  - Badge **départ** : clôt la session ; les heures de la session sont ajoutées au compteur semaine **arrondies à la demi-heure la plus proche** (`round(x×2)/2`) ; le statut devient « `Parti à {HH:MM}` » (heure locale `fr-FR` 2 chiffres).
  - Badge **arrivée** : ouvre une session (horodatage now), efface le libellé « prochain créneau ».
- ⚠️ Les durées « il y a … » ne se rafraîchissent qu'au re-render (pas de tick) — **à définir** (tick 1 min recommandé).

Note de bas de panel (12,5 px `#999`) — cadrage produit affiché tel quel : « `En production : badge par code PIN sur la caisse · heures exportées vers la paie · absences justifiées archivées.` »

Effectif de démo : Le Gérant (Gérant, pointé depuis 3,2 h, 38,5 h/sem) ; Sofiane K. (Cuisine, pointé 2,7 h, 31 h) ; Lina M. (Caisse, non pointée, 24,5 h, 1 abs, « Ce soir 18:00 ») ; Mehdi R. (Cuisine, non pointé, 18 h, « Repos aujourd'hui ») ; Julie T. (Polyvalente, pointée 0,6 h, 12,5 h, 2 abs).

### 12.3 Planning & absences

La maquette n'affiche que : le libellé « prochain créneau » (texte libre), le compteur d'absences mensuel, et la mention paie/PIN ci-dessus. **Écrans de planning (création de créneaux), gestion/justification des absences, rôles & permissions : à définir** (le modèle de données doit les prévoir, voir §14).

---

## 13. Micro-interactions, animations, minuteurs, sons

| Élément | Effet | Durée / courbe |
|---|---|---|
| Sidebar ouverture/fermeture | `width` 66 ↔ 232 px + ombre | `.28s cubic-bezier(.2,.8,.2,1)` |
| Libellés sidebar | fondu d'opacité | `.2s` |
| Item de nav | changement de fond | `.12s` |
| Boutons `.cf-btn` | hover `opacity .85` / active `translateY(1px)` | `.2s` / `.12s` |
| Chips | couleur/bord | `.12s` |
| Iconbtn | bordure | `.12s` |
| Inputs focus | bordure → accent | `.12s` |
| Toggles (46×26) | fond + glissement du pouce | `.15s` |
| Barre objectif du jour | largeur | `.3s` |
| Barres BarChart | hauteur | `.4s ease` |
| Drawer commande / toasts | apparition `cf-pop` (scale .9→1 + fade) | `.18s ease` |
| Drag & drop catégories | natif HTML5, pas d'animation dédiée | — |
| Spotlight `.sm-spot` (disponible, non posé ici) | halo radial doré au survol | opacité `.35s` |

**Minuteries** :
- Polling des commandes entrantes : **4000 ms** (+ événement `storage`) — §6.3.
- Toast autodismiss : **2200 ms** (composant disponible, non utilisé dans ce module).
- Hook « temps écoulé » mm:ss avec tick **1 s** disponible dans la lib partagée, **non utilisé** par le back-office (les libellés « il y a X min » sont calculés au rendu).

**Sons** : **aucun son dans le back-office** (aucune API audio appelée). Alerte sonore à la réception d'une commande : **à définir**.

**Accessibilité motion** : la page hôte neutralise animations et transitions sous `prefers-reduced-motion: reduce` (durées forcées à `.01ms`) ; le pulse `.sm-dot--pulse` (keyframes `smPulse` 2 s, halo 0→8 px) est aussi désactivé dans ce cas (non utilisé dans ce module).

---

## 14. Données lues/écrites — API & modèle MongoDB

> La maquette fonctionne sur données mock en mémoire + `localStorage`. Cette section liste **ce que chaque vue lit et écrit** (fait observé) et en déduit le modèle cible (proposition dérivée, à valider). L'intention MongoDB/« schéma flexible » est explicitement affichée dans l'UI d'import (§7.5).

### 14.1 Clés `localStorage` utilisées par la maquette (à remplacer par l'API sauf mention)

| Clé | Contenu | Rôle | Cible production |
|---|---|---|---|
| `sm-bo-nav` | `"open"` / `"closed"` | état sidebar | peut rester côté client |
| `sm-bo-goal` | entier (€) | objectif CA du jour | réglage tenant serveur |
| `sm_live_orders` | JSON `[{order}]` | bus démo app client → back-office | flux temps réel serveur |
| `sm-brand-id` | id marque | switcher de démo | session/tenant auth |
| `cf-tweaks` | `{accent, radius, density}` | tweaks visuels | config tenant serveur |

### 14.2 Lectures/écritures par vue

| Vue | Lit | Écrit |
|---|---|---|
| Shell | marque du tenant (nom, ville, slug, accent, lettre) ; compteur commandes `new` | état sidebar ; état Ouvert/Fermé (aucun effet aval en maquette) |
| Tableau de bord | KPIs par période (CA, commandes, panier moyen, conversion menu, deltas) ; séries CA/commandes (heure, jour, semaine) ; CA du jour ; objectif ; prévisions ; tâches à faire (compteurs) ; 4 dernières commandes ; top produits (qty, CA) | objectif du jour (±100 €) |
| Commandes | liste des commandes du tenant (temps réel) | avancement de statut (`new→cooking→ready→done`) |
| Menu & prix | catégories (titre, icône, ordre, compteur) ; produits (nom, desc, prix, catégorie, dispo, rupture) | ordre des catégories (drag & drop, tri A→Z) ; création/suppression de catégorie ; réaffectation en masse (« Non rattachés ») ; édition produit (nom, desc, prix, catégorie) ; toggles dispo/rupture ; import en lot (produits + catégories créées) |
| Promos | codes (code, type, valeur, libellé, minimum, usages) ; produits à la une ; bandeau « menu du moment » | activation/désactivation d'un code (les autres écritures sont no-op) |
| Horaires | grille jours × services ; fermetures exceptionnelles ; temps de préparation | toggles jour/service (le reste est no-op) |
| Statistiques | CA/commandes 7 j ; répartition canaux ; conversion menu ; affluence horaire ; top produits | — (export CSV côté client) |
| Avis | avis (auteur, note, date, texte, réponse) ; note moyenne ; distribution ; total cumulé | publication d'une réponse |
| Équipe | effectif (nom, rôle, session en cours, heures semaine, absences, prochain créneau) | badge arrivée/départ (+ cumul heures arrondi 0,5 h) ; export CSV côté client |

### 14.3 Modèle MongoDB proposé (dérivé de la maquette — à valider)

Toutes les collections portent `tenantId` (index) ; le multi-tenant est par filtrage.

```
tenants        { _id, name, city, slug, accent, letter, phone,
                 settings: { dailyGoal: 1500, prepTimeMin: 12, isOpen: true,
                             tweaks: { radius, density } } }

categories     { _id, tenantId, title, icon: "tag"|…, order: <int> }
                 // order = position drag & drop = ordre carte client

products       { _id, tenantId, categoryId: ObjectId|null,   // null = « Non rattaché »
                 name, desc, price: <number|null>,           // null = « à définir » → exclu carte client
                 available: bool, out: bool,                 // out = rupture 1-tap
                 ...extra }                                   // colonnes CSV inconnues conservées telles quelles

orders         { _id, tenantId, ref: "CF-1042", pickNo: 42,
                 channel: "En ligne"|"Téléphone"|"Comptoir",
                 customer: { name, phone },
                 placedAt: Date, slot: "12:30",
                 status: "new"|"cooking"|"ready"|"done",
                 paid: bool, total: <number>,
                 items: [{ name, qty,                        // qty 0 = ligne informative « • »
                           opts?: [string], note?: string, price?: number }] }

promos         { _id, tenantId, code, type: "pct"|"eur"|"label",
                 value, label, min, active: bool, usedCount }

featured       { _id, tenantId, productId, active }           // « À la une »
banners        { _id, tenantId, key: "menu-moment", label, active }

hours          { _id, tenantId, day: "Lundi"…"Dimanche",
                 lunch: bool, dinner: bool }                  // libellés plages : à définir (11h30–14h30 / 18h00–22h30)
closures       { _id, tenantId, dateLabel|from/to, title, note }

reviews        { _id, tenantId, author, stars: 1–5, createdAt, text,
                 reply: { text, createdAt } | null }

staff          { _id, tenantId, name, role, weekHours, absencesMonth,
                 nextShiftLabel }                              // à terme : planning structuré (à définir)
timeclock      { _id, tenantId, staffId, inAt: Date, outAt: Date|null }
                 // heures semaine = somme sessions, arrondi 0,5 h au badge départ

stats          agrégations (pipeline) sur orders : CA/jour, commandes/jour,
                 affluence/heure (buckets 11h–22h), top produits (qty, CA),
                 répartition canaux, conversion menu — pas de collection dédiée requise
```

Endpoints suggérés (REST, préfixe `/api/{tenant}` — **à définir** précisément) : `GET/PATCH /settings`, `GET /dashboard?period=1j|7j|30j`, `GET /orders` (+ flux SSE/WS `orders:new`), `PATCH /orders/:id/status`, `GET/POST/PATCH/DELETE /categories` + `PUT /categories/order`, CRUD `/products` + `POST /products/import` (CSV/XML ≤ 5 Mo, colonnes `nom;prix;catégorie;composition;dispo`, colonnes extra conservées, catégories auto-créées, avec étape d'aperçu `POST /products/import/preview`), CRUD `/promos`, `GET/PUT /hours`, CRUD `/closures`, `GET /stats` + `GET /stats/export.csv`, `GET /reviews`, `POST /reviews/:id/reply`, `GET /staff`, `POST /staff/:id/punch`, `GET /timeclock/export.csv`.

### 14.4 Invariants métier observés

- Un produit **sans prix valide** n'apparaît pas à la commande client (bandeau §7.1).
- **Supprimer une catégorie ne supprime jamais ses produits** : ils passent à `categoryId: null` (« Non rattachés »).
- L'**ordre des catégories** du back-office est l'ordre d'affichage de la carte client.
- La **rupture** (`out`) est indépendante de la disponibilité (`available`) ; l'UI affiche « dispo » = `available && !out`.
- Statuts de commande **strictement croissants** : `new → cooking → ready → done` (une étape par action).
- Import : rapprochement de catégorie **par titre exact**, création sinon.
- Pointage : cumul hebdo arrondi au **0,5 h** le plus proche au badge de départ.

---

## 15. États vides / chargement / erreur

### 15.1 Présents dans la maquette

| Vue / composant | État | Rendu exact |
|---|---|---|
| Menu — liste produits | vide (catégorie vide ou 0 résultat) | texte centré 14 px `#999`, padding 26 : « Aucun produit ici — rattache des produits via ✎ ou importe un fichier. » |
| Menu — bandeau | données incomplètes | bandeau gold « {n} prix à définir — … » (§7.1) |
| Menu — champ prix | valeur manquante | placeholder « à définir », bord/fond gold (§7.3) |
| Menu — rangée « Non rattachés » | ≥ 1 orphelin seulement | rangée spéciale (§7.2) |
| Commandes — ligne `done` | terminal | « Terminée » 13 px `#999` à la place du bouton |
| Import — étape succès | confirmation | écran vert « Import terminé » (§7.5) |
| Équipe — colonnes | valeur nulle | « — » |
| Avis — sans réponse | à traiter | zone de réponse inline (§11.2) |

### 15.2 Absents de la maquette — **à définir** (obligatoire pour la prod)

- **Chargement** : aucun skeleton/spinner nulle part (les données mock sont synchrones). Définir : skeletons de cartes/lignes par vue, états de bouton « en cours » (import, réponse avis, badge pointage, avancement commande).
- **Erreur** : aucun état d'erreur (API en échec, import invalide — fichier trop lourd/mauvais format/lignes rejetées, conflit de statut commande, perte de connexion temps réel). Définir : bandeaux d'erreur, toasts (composant §4.14 disponible), retry.
- **Vides globaux** : liste de commandes vide (aucune commande sur le filtre), aucun avis, aucune promo, aucun employé, stats sans données (le BarChart gère division par max(…, 1) mais sans message) — copies **à définir**.
- **Confirmations** : seule la suppression de catégorie a une modale. Suppression de fermeture exceptionnelle, remboursement, désactivation de code promo : sans confirmation — **à définir**.

---

## 16. Inventaire des z-index et des couches

| Couche | z-index | Contexte |
|---|---|---|
| Sidebar (overlay au-dessus du contenu) | **45** | dans le shell |
| Drawer fiche commande + son overlay | **50** | dans la zone de contenu (`position: absolute; inset: 0`) |
| Modales Menu (suppression catégorie, import) | **60** | dans la zone de contenu, overlay `rgba(0,0,0,0.6)` |
| Switcher de marque (démo) | 800 | fixed, hors app |
| Nav « notch » (code présent mais **jamais monté**) | 900 | — |
| Toasts (non utilisés ici) | 9000 | fixed |
| Hub pill (démo) | 99999 | fixed |

Overlays : drawer `rgba(28,22,18,0.35)` (clic = fermer) ; modales `rgba(0,0,0,0.6)` (clic = **ne ferme pas**). Fermeture par touche `Escape` : **absente partout — à définir**.

---

## 17. Écarts, no-ops et points « à définir »

Récapitulatif de tout ce qui est visible mais non câblé, ou incohérent, dans la maquette :

**No-ops (UI présente, aucune action)**
1. Recherche globale de la topbar (non câblée ; icône `grid` au lieu de `search`).
2. Cloche notifications ; engrenage « Paramètres » (sidebar).
3. Impression (ligne commande + drawer) ; « Rembourser » (drawer).
4. « Télécharger le modèle CSV » (import).
5. « Nouveau code » (promos) ; toggles « À la une » et « Menu du moment » figés.
6. « Ajouter » et corbeilles des fermetures exceptionnelles ; heures des plages midi/soir non éditables ; temps de préparation non persisté.
7. Boutons « Fermer / Enregistrer » du panneau d'édition produit (l'édition est déjà appliquée à la frappe).

**Incohérences à arbitrer**
8. Couleurs de statut : « Nouvelle » = accent tenant et « En prépa » = gold `#c9a15a`, alors que la règle marque grise impose rouge fixe `#c94b3f` (nouveau/urgent) et ambre `#e0973f` (attente) — voir §2.6.
9. Toggle « Rupture » en variante danger utilise `var(--cf-accent)` (accent tenant) au lieu du rouge fixe.
10. « Réponse de Class'Food » et export « classfood-ca-7jours.csv » : noms de marque en dur → utiliser le tenant.
11. Carte avis : 5 étoiles pleines affichées en dur au lieu de la moyenne.
12. Note horaires « fermé le midi lundi & vendredi » statique, non dérivée de l'état.
13. Barres « Top ventes » normalisées sur la première ligne, pas sur le max réel.
14. Nuances `rgba(244,238,225,…)` (crème historique) en dur dans la sidebar et les encarts sombres.

**Comportements manquants (à définir)**
15. Routing par URL des vues ; responsive/mobile ; échelle de page (artefact démo).
16. Effet réel du bouton Ouvert/Fermé (coupure commande en ligne).
17. Sons/notifications à la réception de commande ; rafraîchissement périodique des durées (« il y a X min », pointage).
18. Retour arrière/annulation de statut de commande ; flux d'impression ticket ; flux de remboursement.
19. Création de produit à l'unité ; validation du champ prix ; hover des lignes/catégories ; garde-fou suppression de la dernière catégorie ; annulation du tri A→Z.
20. Vrai file input + drag & drop de fichier pour l'import (contraintes affichées : `.csv`/`.xml`, max 5 Mo) ; gestion des erreurs d'import.
21. CRUD complet promos (création, édition, planification) et « À la une ».
22. Édition des plages horaires par service ; CRUD des fermetures exceptionnelles.
23. Filtres de période des statistiques ; export planifiés.
24. Modération/édition des réponses aux avis ; pagination.
25. Planning structuré, absences justifiées, rôles/permissions, badge par PIN (annoncé dans le copy), export paie.
26. Tous les états de chargement et d'erreur (§15.2) ; fermeture des overlays par `Escape` ; animation de sortie du drawer.
