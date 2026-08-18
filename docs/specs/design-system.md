# Snack Manager — Spécification du Design System « SM Dark » v1

> **Objet.** Ce document spécifie exhaustivement le design system de la maquette haute-fidélité Snack Manager (suite SaaS multi-tenant, marque grise, fast-foods) : tokens, composants de base, mécanisme de theming tenant, et différences entre les trois couches CSS. Il est destiné aux développeurs qui construiront `packages/ui` et la config Tailwind **sans relire le code source de la maquette**.
>
> **Sources analysées (maquette)** :
> - `app/classfood-ds.css` — design system de base « Trivolet / Comptoir » (tokens `--cf-*`, composants `.cf-*`)
> - `app/sm-ds.css` — référentiel « SM Dark » v1 (tokens `--sm-*`, composants `.sm-*`)
> - `app/sm-skin.css` — adaptateur : remappe les tokens historiques `--cf-*` sur le référentiel SM
> - `app/cf-theme.js` — applicateur de thème runtime (accent / rayon / densité via `localStorage`)
> - `app/sm-brand.jsx` — couche marque blanche (injection de l'accent tenant, logo, switcher démo) *(lu car référencé par sm-skin.css comme injecteur d'accent)*
> - `app/cf-ui.jsx` — primitives React partagées *(lu car c'est la couche composant de base)*
> - `SM - Design System.html` — page de documentation vivante du DS (copy et démos de référence)
>
> **Convention** : toute valeur citée (px, hex, durée) provient littéralement de la maquette. Tout comportement absent de la maquette est marqué **« à définir »**.

---

## 1. Architecture des couches CSS

La maquette empile **trois fichiers CSS** et **deux scripts runtime**. L'ordre de chargement est significatif.

### 1.1 Rôle de chaque fichier

| Fichier | Rôle | Préfixes | Consommé par |
|---|---|---|---|
| `classfood-ds.css` | **Base historique** « Class'Food / Trivolet-Comptoir ». Définit les tokens `--cf-*` (palette crème/encre claire + scope sombre `[data-theme="dark"]`), le reset, et tous les composants `.cf-*`. Style « diner » : typo slab, ombres dures décalées, damier, sticker incliné. | `--cf-*`, `.cf-*` | Apps historiques (POS, KDS, client, back-office) |
| `sm-ds.css` | **Référentiel SM Dark v1** — *« source de vérité : la landing »*. Tokens bruts `--sm-*` + composants natifs `.sm-*`. Sombre uniquement. Tout **nouveau** code doit consommer directement `--sm-*` / `.sm-*`. | `--sm-*`, `.sm-*` | Landing, page Design System, nouveau code |
| `sm-skin.css` | **Adaptateur** : fait `@import url("sm-ds.css")` en tête, puis **écrase les tokens `--cf-*`** avec les valeurs SM et re-style les composants `.cf-*` pour qu'ils rendent visuellement comme la landing. Les apps historiques deviennent ainsi « SM Dark » sans réécriture. | écrase `--cf-*`, re-style `.cf-*` | Apps historiques passées en skin SM |

### 1.2 Ordre de chargement (apps)

```
1. classfood-ds.css        (tokens + composants de base)
2. sm-skin.css             (@import sm-ds.css, puis remap --cf-* → valeurs SM)
3. React + cf-helpers.js
4. cf-ui.jsx               (primitives React → window)
5. sm-brand.jsx            (marque blanche — « Charger APRÈS app/cf-ui.jsx, AVANT les apps »)
6. cf-theme.js             (tweaks localStorage)
7. app *.jsx
```

### 1.3 Différences clés `classfood-ds.css` vs `sm-skin.css`/`sm-ds.css`

| Aspect | classfood-ds.css (base) | sm-skin.css + sm-ds.css (SM Dark) |
|---|---|---|
| Fond / surfaces | Crème `#F4EEE1` / papier `#FBF8F1` (light) ; scope dark `#17130F`/`#241C16` | **Toujours sombre** : `#000` / `#111` / `#1a1a1a` — le sélecteur `:root, [data-theme="dark"], [data-theme="light"]` neutralise tout thème clair |
| Typo | 3 familles : `Alfa Slab One` (display, uppercase), `Archivo` (body), `Barlow Condensed` (cond) | **Inter partout** (400–800) ; `ADLaM Display` réservé au logotype. `.cf-disp` perd l'uppercase, passe en 600 / `-.03em` |
| Ombres | Ombres **dures** signature : `3px 3px 0 var(--cf-ink)`, `5px 5px 0`, `4px 4px 0 var(--cf-accent)` | Ombres **douces** : `0 1px 0 rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.38)` etc. ; `--cf-shadow-accent` devient un ring `0 0 0 1px var(--cf-accent)` |
| Rayons | `--cf-r:14px`, `sm:9px`, `lg:22px`, `pill:999px` | `--cf-r:16px`, `sm:10px`, `lg:20px` (pill non écrasé : reste `999px` ; les `.sm-btn` utilisent `--sm-r-pill:50px`) |
| Boutons | Uppercase 800, ombre dure, hover `brightness(1.05)` + `translateY(-1px)` | Sans transform ni ombre, 600, `letter-spacing:-.2px`, hover `opacity:.85` |
| Damier `.cf-check` | Damier 9px de haut, motif `conic-gradient` 18×18px, opacité .92 | Devient un **filet dégradé** 2px : `linear-gradient(90deg, var(--cf-accent), transparent 70%)`, opacité .7 |
| Sticker | Incliné `rotate(-4deg)` + ombre dure | `transform:none`, sans ombre, fond `--sm-accent` |
| Règle de section `.cf-head .rule` | Double filet : `border-top:2.5px solid` + `border-bottom:1px solid`, hauteur 3px | Simple filet `1px solid var(--sm-border-10)`, opacité .9 |
| Titres `.cf-head h2` | Couleur accent, slab uppercase 26px | `letter-spacing:-.03em` (Inter via remap des variables) |
| Focus | `outline:3px solid` accent à 60 % (`color-mix`) | `outline:2px solid var(--sm-accent-hover)`, `outline-offset:2px` |
| Inputs focus | Bordure texte + ring `0 0 0 3px color-mix(in srgb, var(--cf-accent) 22%, transparent)` | Bordure `var(--sm-accent)`, **sans** box-shadow |

**Verrouillages KDS** (dans `sm-skin.css`) — surfaces critiques indépendantes du thème hérité :

```css
.kds-topbar { background:#111 !important; color:#fff !important; border-bottom:1px solid rgba(255,255,255,.1) }
.kds-no    { background:#1a1a1a !important; color:#fff !important }
```

**Reset supplémentaire** (sm-skin.css) : `button { color: inherit }` — les boutons héritent la couleur du contexte (aligné landing).

---

## 2. Tokens — inventaire complet

### 2.1 Référentiel SM Dark (`sm-ds.css`, `:root`) — **à utiliser pour tout nouveau code**

#### Neutres (FIXES, identiques tous comptes)

| Token | Valeur | Usage |
|---|---|---|
| `--sm-black` | `#000` | Fond de page |
| `--sm-seam` | `#050505` | Couture / séparation de sections |
| `--sm-card` | `#111` | Cartes |
| `--sm-badge-bg` | `#1a1a1a` | Badges, prix, tuiles internes |
| `--sm-btn-dark` | `#262626` | Bouton secondaire dark |
| `--sm-surface-3` | `rgba(255,255,255,.03)` | Hover de ligne de table |
| `--sm-surface-6` | `rgba(255,255,255,.06)` | Bordures douces, fonds de chips |
| `--sm-border-10` | `rgba(255,255,255,.1)` | Bordures standard |
| `--sm-watermark` | `rgba(255,255,255,.18)` | Filigranes |
| `--sm-white` | `#fff` | Texte principal |
| `--sm-white-80` | `rgba(255,255,255,.8)` | Texte de cellule / corps sur carte |
| `--sm-white-70` | `rgba(255,255,255,.7)` | Texte atténué |
| `--sm-white-50` | `rgba(255,255,255,.5)` | Bordure d'état actif (chips) |
| `--sm-white-30` | `rgba(255,255,255,.3)` | Texte très atténué |
| `--sm-gray` | `#999` | Texte secondaire |
| `--sm-card-gradient` | `linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)` | Fond des cartes |

#### Accent (VARIABLE — marque blanche, injecté au runtime)

| Token | Valeur par défaut | Usage |
|---|---|---|
| `--sm-accent` | `#c9a15a` (laiton) | Bouton de marque, liens, focus, sélection, caret |
| `--sm-accent-hover` | `#e0b96f` | Hover des liens, outline focus |
| `--sm-on-accent` | `#000` | Texte posé sur l'accent |

> Commentaire source : *« Accent (marque blanche : injecté par sm-brand.jsx) »*. Démos de marques : Class'Food rouge `#C8281E`, O'Braise orange `#E0762F`, Green House vert `#2F9E62` (cf. §4).

#### Couleurs fonctionnelles (FIXES tous comptes — jamais remplacées par l'accent)

| Token | Valeur | Sémantique |
|---|---|---|
| `--sm-green` | `#3fae4a` | **Prêt / positif** |
| `--sm-red` | `#c94b3f` | **Nouveau / urgent** |
| `--sm-amber` | `#e0973f` | **Attente / en préparation** |

Teintes dérivées utilisées par les tags de statut (codées en dur, voir §6.4) : texte `#e77b70` (rouge), `#6ecf78` (vert), `#eab06a` (ambre).

#### Typo

| Token | Valeur |
|---|---|
| `--sm-font` | `'Inter', system-ui, sans-serif` |
| `--sm-font-logo` | `'ADLaM Display', sans-serif` (réservé au logotype Snack Manager) |

Graisse chargée (Google Fonts) : Inter `400;500;600;700;800` + ADLaM Display.

#### Rayons

| Token | Valeur | Usage (note de la page DS) |
|---|---|---|
| `--sm-r-pill` | `50px` | Boutons et chips — toujours en pilule |
| `--sm-r-lg` | `20px` | — |
| `--sm-r` | `16px` | Cartes |
| `--sm-r-md` | `12px` | Tuiles internes |
| `--sm-r-sm` | `10px` | Inputs, tuiles internes |
| `--sm-r-xs` | `8px` | — |

#### Motion

| Token | Valeur |
|---|---|
| `--sm-ease` | `cubic-bezier(.2,.8,.2,1)` |
| `--sm-t-fast` | `.2s` |
| `--sm-t-med` | `.45s` |
| `--sm-t-slow` | `.6s` |

Règle (page DS) : *« Durées 200–600 ms, easing cubic-bezier(.2,.8,.2,1), prefers-reduced-motion respecté. »*

#### Layout

| Token | Valeur |
|---|---|
| `--sm-content` | `1200px` (largeur de contenu) |
| `--sm-pad-x` | `40px` (padding horizontal) |

### 2.2 Tokens de base `--cf-*` (`classfood-ds.css`, `:root`)

Conservés pour référence : c'est le contrat consommé par les apps historiques. **En contexte SM, toutes ces valeurs sont écrasées par sm-skin.css (voir 2.3)** ; les valeurs ci-dessous ne servent que si une surface charge `classfood-ds.css` seul (univers visuel « Class'Food diner »).

Constantes de marque (jamais thémées) : `--cf-cream:#F4EEE1`, `--cf-cream-2:#EDE5D3`, `--cf-paper:#FBF8F1`, `--cf-ink:#1C1612`, `--cf-mut:#6E6354`, `--cf-red:#C8281E`, `--cf-gold:#E8B84B`, `--cf-green:#1F8A5B`, `--cf-line:rgba(28,22,18,0.16)`.

Alias accent : `--cf-accent: var(--cf-red)`, `--cf-on-accent:#F4EEE1`.

Sémantiques LIGHT : `--cf-bg:#F4EEE1`, `--cf-surface:#FBF8F1`, `--cf-surface-2:#EDE5D3`, `--cf-text:#1C1612`, `--cf-text-mut:#6E6354`, `--cf-border:rgba(28,22,18,0.16)`, `--cf-fill:#1C1612` *(fill sombre fort : pills, boutons encre, prix)*, `--cf-on-fill:#F4EEE1`.

Scope `[data-theme="dark"]` (utilisé par le KDS) — n'écrase QUE les sémantiques : `--cf-bg:#17130F`, `--cf-surface:#241C16`, `--cf-surface-2:#1F1813`, `--cf-text:#F4EEE1`, `--cf-text-mut:#A99E8D`, `--cf-border:rgba(244,238,225,0.15)`, `--cf-fill:#0E0B09`, `--cf-on-fill:#F4EEE1`, ombres → `3px 3px 0 rgba(0,0,0,0.5)`, `5px 5px 0 rgba(0,0,0,0.5)`, `--cf-shadow-card: 0 2px 0 rgba(0,0,0,0.35), 0 10px 26px rgba(0,0,0,0.4)`.

Rayons : `--cf-r:14px; --cf-r-sm:9px; --cf-r-lg:22px; --cf-r-pill:999px`.
Densité : `--cf-u:16px; --cf-u2:24px; --cf-u3:32px`.
Typo : `--cf-disp:'Alfa Slab One', Georgia, serif`, `--cf-body:'Archivo', system-ui, sans-serif`, `--cf-cond:'Barlow Condensed','Archivo',sans-serif`.
Ombres : `--cf-shadow: 3px 3px 0 var(--cf-ink)`, `--cf-shadow-2: 5px 5px 0 var(--cf-ink)`, `--cf-shadow-accent: 4px 4px 0 var(--cf-accent)`, `--cf-shadow-soft: 0 10px 30px rgba(28,22,18,0.13)`, `--cf-shadow-card: 0 2px 0 var(--cf-border), 0 8px 22px rgba(28,22,18,0.08)`.

### 2.3 Remap sm-skin.css (`:root, [data-theme="dark"], [data-theme="light"]`)

Le sélecteur couvre **les trois scopes de thème** → il n'existe plus de thème clair en contexte SM. Valeurs exactes injectées :

```css
/* surfaces — neutres landing */
--cf-bg:#000;  --cf-surface:#111;  --cf-surface-2:#1a1a1a;  --cf-paper:#111;
--cf-cream:#0b0b0b;  --cf-cream-2:#161616;
/* texte */
--cf-text:#fff;  --cf-text-mut:#999;  --cf-ink:#fff;  --cf-mut:#999;
--cf-border:rgba(255,255,255,.1);  --cf-line:rgba(255,255,255,.1);  --cf-line-2:rgba(255,255,255,.06);
/* inverse (pills, prix, sidebars) — reste sombre */
--cf-fill:#1a1a1a;  --cf-on-fill:#fff;
/* fonctionnelles landing */
--cf-gold:#c9a15a;  --cf-green:#3fae4a;  --cf-red:#c94b3f;
--cf-on-accent:#fff;
/* rayons & ombres */
--cf-r:16px;  --cf-r-sm:10px;  --cf-r-lg:20px;
--cf-shadow:0 1px 0 rgba(0,0,0,.35), 0 10px 28px rgba(0,0,0,.38);
--cf-shadow-2:0 2px 0 rgba(0,0,0,.35), 0 16px 40px rgba(0,0,0,.45);
--cf-shadow-accent:0 0 0 1px var(--cf-accent);
--cf-shadow-soft:0 12px 34px rgba(0,0,0,.4);
--cf-shadow-card:0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32);
/* typo : Inter partout */
--cf-disp:'Inter',system-ui,sans-serif;
--cf-body:'Inter',system-ui,sans-serif;
--cf-cond:'Inter',system-ui,sans-serif;
```

### 2.4 Table de mapping officielle (reprise de la page « SM — Design System »)

| Token app (`--cf-*`) | Référentiel (`--sm-*`) | Valeur |
|---|---|---|
| `--cf-bg` | `--sm-black` | `#000` |
| `--cf-surface` / `--cf-paper` | `--sm-card` | `#111` (+ gradient) |
| `--cf-surface-2` / `--cf-fill` | `--sm-badge-bg` | `#1a1a1a` |
| `--cf-text-mut` / `--cf-mut` | `--sm-gray` | `#999` |
| `--cf-border` / `--cf-line` | `--sm-border-10` | `rgba(255,255,255,.1)` |
| `--cf-accent` | `--sm-accent` | *injecté par marque* |
| `--cf-green` / `--cf-red` / `--cf-gold` | `--sm-green` / `--sm-red` / `--sm-accent` | `#3fae4a` / `#c94b3f` / `#c9a15a` |
| `--cf-disp` / `--cf-body` / `--cf-cond` | `--sm-font` | Inter |

Consigne de la page DS : *« Les apps historiques consomment des tokens `--cf-*` ; app/sm-skin.css les remappe sur le référentiel. Pour tout nouveau code, utiliser directement `--sm-*` / `.sm-*`. »*

---

## 3. Principes non négociables (copy exacte de la page DS)

En-tête de section : « Principes » — *« Cinq règles non négociables, du site public à l'écran de cuisine. »* *(Note : la page annonce « cinq » règles mais en liste six — divergence de copy à arbitrer.)*

1. **« 1 · Noir, information en avant »** — *« Fond #000, cartes #111 en dégradé subtil, bordures blanches à 6–10 %. La couleur n'est jamais décorative : elle signale un statut ou l'accent de marque. »*
2. **« 2 · Fonctionnel fixe, marque variable »** — *« Vert = prêt/positif, rouge = nouveau/urgent, ambre = attente — identiques pour tous les restaurants. Seuls l'accent, le logo et le nom changent (marque blanche). »*
3. **« 3 · Tablette d'abord »** — *« POS et KDS visent React Native : cibles tactiles ≥ 44 px, colonnes scrollables, cartes non compressibles, aucune interaction au survol requise. »*
4. **« 4 · Une action primaire par écran »** — *« Un seul bouton accent/light par vue. Le reste : dark, ghost ou lien. La hiérarchie visuelle suit la hiérarchie de décision. »*
5. **« 5 · Le mouvement prouve, il ne décore pas »** — *« Pulse = vivant, minuteur coloré = urgence, transition 3D = navigation. Durées 200–600 ms, easing cubic-bezier(.2,.8,.2,1), prefers-reduced-motion respecté. »*
6. **« 6 · Chiffres tabulaires »** — *« Tout montant, minuteur ou compteur passe en font-variant-numeric: tabular-nums pour ne jamais sauter en se mettant à jour. »*

---

## 4. Theming tenant (marque blanche)

### 4.1 Règles marque blanche (copy exacte, section « Marque blanche »)

**Personnalisable par restaurant** :
- *« Accent --sm-accent / --cf-accent (bouton de marque, liens, focus) »*
- *« Logo + nom (sm-brand.jsx : initiale, logotype, en-têtes, reçus) »*
- *« Contenu : menu, catégories, prix, horaires, photos »*

**Fixe — identique tous comptes** :
- *« Neutres (#000/#111/#1a1a1a), bordures, rayons, Inter »*
- *« Vert prêt / rouge nouveau / ambre attente »*
- *« Structure des écrans, tailles tactiles, composants »*

Note composants : *« Les tags de statut portent TOUJOURS les couleurs fonctionnelles — jamais l'accent de marque. »*

### 4.2 Injection de l'accent au runtime — `sm-brand.jsx`

C'est **le** mécanisme d'injection de l'accent tenant dans la maquette (sm-skin.css : *« L'accent --cf-accent/--sm-accent est injecté par sm-brand.jsx »*).

**Registre de marques démo** (`window.SM_BRANDS`) :

```js
{ id:"classfood",  name:"Class'Food",  city:"Perriers-sur-Andelle", slug:"classfood",  accent:"#C8281E", letter:"C", phone:"09 84 36 49 76" }
{ id:"obraise",    name:"O'Braise",    city:"Rouen",                slug:"obraise",    accent:"#E0762F", letter:"O", phone:"02 35 00 00 00" }
{ id:"greenhouse", name:"Green House", city:"Évreux",               slug:"greenhouse", accent:"#2F9E62", letter:"G", phone:"02 32 00 00 00" }
```

**Mécanique exacte** :
1. Détection iframe : `EMBEDDED = window.self !== window.top` (fallback `true` en cas d'exception cross-origin).
2. Résolution du tenant : `id = localStorage.getItem("sm-brand-id") || "greenhouse"` ; si `EMBEDDED`, force `"greenhouse"`. Fallback sur `BRANDS[2]` si id inconnu.
3. Calcule `b.fullName = name + " · " + city` et expose `window.SM_BRAND` (marque courante) et `window.SM_BRANDS`.
4. **Injection CSS** sur `document.documentElement.style` :
   - `--cf-accent` ← `brand.accent`
   - `--cf-on-accent` ← `"#ffffff"` (toujours blanc sur accent en contexte marque)
5. Remplace le composant global `CFLogo` par `BrandLogo` : tuile carrée `size × size` (défaut 44px), `border-radius: round(size*0.28)`, fond `var(--cf-accent)`, initiale en Inter 800 à `size*0.52`, couleur `#fff` ; wordmark optionnel (nom en 800 à `size*0.5`, `letter-spacing:-0.02em`, couleur `var(--cf-text)`, gap 10px).
6. Monte un **switcher démo** (voir §7.3) sauf si `EMBEDDED`.

> **Point de vigilance (constaté dans la maquette)** : `sm-brand.jsx` n'injecte que `--cf-accent` / `--cf-on-accent` ; il **ne met PAS à jour `--sm-accent`, `--sm-accent-hover` ni `--sm-on-accent`**, qui restent au laiton `#c9a15a` / `#e0b96f` / `#000`. Or sm-skin.css style plusieurs composants `.cf-*` sur `--sm-accent` (`.cf-btn--gold`, `.cf-sticker`, focus des inputs, `:focus-visible`, `::selection`). En production, l'injection tenant devra couvrir **les deux familles** de tokens (et définir la dérivation de `--sm-accent-hover` et de `--sm-on-accent` à partir de l'accent injecté — **à définir** : la maquette ne dérive pas ces valeurs).
>
> Autres valeurs laiton **codées en dur** (non re-thémées par tenant dans la maquette) : halo spotlight `rgba(201,161,90,.09)`, pulse du `.sm-dot--accent` (`--_pc:201,161,90`), `caret-color:#c9a15a`, scrollbar hover `rgba(201,161,90,.5)`, `:focus-visible` de la page DS `#c9a15a`. À variabiliser en production — **à définir**.

### 4.3 Tweaks utilisateur — `cf-theme.js` (`window.CFTheme`)

Applicateur partagé, exécuté à l'inclusion : lit `localStorage["cf-tweaks"]` (JSON, `{}` en cas d'erreur de parsing) et pose des variables CSS sur `document.documentElement.style`.

| Clé du JSON `cf-tweaks` | Effet exact |
|---|---|
| `accent` (string CSS) | `--cf-accent` ← valeur |
| `radius` (nombre, px) | `--cf-r` ← `radius`px ; `--cf-r-sm` ← `max(4, radius − 5)`px ; `--cf-r-lg` ← `radius + 8`px |
| `density` (nombre, px) | `--cf-u` ← `density`px ; `--cf-u2` ← `round(density × 1.5)`px *(`--cf-u3` n'est pas ajusté)* |

API exposée : `CFTheme.apply(t)`, `CFTheme.read()`, `CFTheme.save(t)` (merge `Object.assign({}, cur, t)` → écrit `localStorage` → applique → retourne l'objet fusionné).

> **Interaction cf-theme × sm-brand** : les deux écrivent `--cf-accent` en style inline sur `<html>` ; le dernier exécuté gagne. La priorité tenant vs tweak utilisateur en production est **à définir**.
> Persistance serveur des tweaks : absente de la maquette (localStorage uniquement) — **à définir**.

### 4.4 Modèle de données induit (pour l'API / MongoDB)

**Lu par les surfaces** (au boot, avant rendu) :
- Tenant/marque : `{ id, name, city, slug, accent (hex), letter (initiale logo), phone }` + dérivé `fullName = "name · city"`. → collection `brands`/`tenants`.
- Préférences d'affichage par poste : `{ accent?, radius?, density? }` (clé locale `cf-tweaks`).

**Écrit** :
- `localStorage["sm-brand-id"]` (string id de marque) — écrit par le switcher démo, suivi de `location.reload()`.
- `localStorage["cf-tweaks"]` (JSON) — écrit par `CFTheme.save`.

Aucun appel réseau dans ces fichiers ; l'API de résolution du tenant (par domaine ? par slug ?) est **à définir**. Les champs `slug` et `phone` existent dans le modèle mais ne sont pas consommés par la couche DS (utilisés ailleurs : en-têtes, reçus) — **à préciser lors de la spec des écrans**.

---

## 5. Typographie

### 5.1 Échelle SM (classes `.sm-*`, Inter)

| Classe | Taille | Graisse | Letter-spacing | Line-height | Couleur | Divers |
|---|---|---|---|---|---|---|
| `.sm-h1` | 70px | 600 | −.04em | 1em | `--sm-white` | `text-wrap:balance` |
| `.sm-h2` | 46px | 600 | −.04em | 1em | `--sm-white` | `text-wrap:balance` |
| `.sm-h3` | 26px | 600 | −.03em | 1.15em | `--sm-white` | |
| `.sm-h4` | 22px | 600 | −.04em | 1.4em | `--sm-white` | |
| `.sm-h5` | 18px | 600 | −.04em | 1.4em | `--sm-white` | |
| `.sm-h6` | 16px | 600 | −.02em | 1.4em | `--sm-white` | |
| `.sm-body` | 16px | 500 | −.02em | 1.5em | `--sm-gray` | |
| `.sm-small` | 13.5px | 500 | −.01em | 1.5em | `--sm-gray` | |
| `.sm-micro` | 11px | 500 | .06em | — | `--sm-gray` | `text-transform:uppercase` |
| `.sm-num` | — | — | — | — | — | `font-variant-numeric:tabular-nums` |

Copy de référence de la page DS : *« Inter partout (400–800), ADLaM Display réservé au logotype. Titres serrés (-.03/-.04 em), corps -.02 em. »* Exemples affichés : « Reprenez le contrôle », « Commandes en direct », « Ticket n°42 — Yassine B. », « Le ticket file en cuisine, déjà encaissé. », « Créneau 12:30 · payé en ligne », « Chiffre d'affaires ».

### 5.2 Classes typo de base `.cf-*`

- `.cf-disp` — base : Alfa Slab One 400, `letter-spacing:.01em`, uppercase, `line-height:.98`. **Skin SM** : `font-weight:600; letter-spacing:-.03em; text-transform:none; line-height:1.1` (famille remappée sur Inter).
- `.cf-cond` — base : Barlow Condensed. **Skin** : `font-weight:500; letter-spacing:-.015em`.
- `.cf-eyebrow` — base : 800 / 11px / `.18em` / uppercase / `--cf-text-mut`. **Skin** : `letter-spacing:.06em; font-weight:600; text-transform:uppercase; font-size:11px`.
- `.cf-muted` — couleur `--cf-text-mut`. `.cf-accent-t` — couleur `--cf-accent`. `.cf-tabnums` — `font-variant-numeric:tabular-nums`.
- `.cf-head` — tête de section : `h2` 26px (base : slab, couleur accent, uppercase) ; `.rule` (voir §1.3) ; `p` note 14px cond 500, `line-height:1.25`, marge `7px 0 0`. Marge bloc `0 0 12px`.

### 5.3 Reset & body

`classfood-ds.css` : `* { box-sizing:border-box }` ; `body { margin:0; font-family:var(--cf-body); color:var(--cf-text); background:var(--cf-bg); -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility }`. sm-skin réaffirme `body{background:var(--cf-bg);color:var(--cf-text)}`.

---

## 6. Inventaire des composants et de leurs états

> Grille d'états documentée pour chaque composant : **normal / hover / actif (pressed) / désactivé / focus** quand définis. Les états **vide / chargement / erreur** ne sont définis pour AUCUN composant de la couche DS — **à définir** globalement (spinner/squelette, message d'erreur, placeholder vide).

### 6.1 Boutons `.sm-btn` (référentiel — à privilégier)

Base : `inline-flex`, centré, `gap:8px`, `border-radius:var(--sm-r-pill)` (50px), `padding:10px 16px`, Inter 14px 600, `letter-spacing:-.2px`, `line-height:1.2em`, `border:none`, `white-space:nowrap`, `transition: opacity var(--sm-t-fast), transform var(--sm-t-fast)` (.2s).

| État | Style |
|---|---|
| hover | `opacity:.85` (sauf ghost) |
| actif (`:active`) | `transform:translateY(1px)` |
| désactivé | `opacity:.35; cursor:not-allowed` |
| focus clavier | global `:focus-visible` : `outline:2px solid var(--sm-accent-hover); outline-offset:2px` |
| chargement / erreur | **à définir** |

Variantes :

| Classe | Fond | Texte | Rôle (copy page DS) |
|---|---|---|---|
| `.sm-btn--light` | `#fff` | `#000` | *« Light = action primaire neutre »* — ex. « Encaisser » |
| `.sm-btn--accent` | `--sm-accent` | `--sm-on-accent` | *« Accent = action de marque (1 max/écran) »* |
| `.sm-btn--dark` | `#262626` | `#fff` | Secondaire |
| `.sm-btn--ghost` | transparent, `border:1px solid var(--sm-border-10)` | `#fff` | Tertiaire ; hover : `background:var(--sm-surface-6); opacity:1` |
| `.sm-btn--danger` | `--sm-red` | `#fff` | *« Danger réservé aux destructions avec confirmation »* — ex. « Annuler la commande » |

Tailles : `--lg` `padding:14px 24px; font-size:15px` (libellé démo : « Grand · 44px+ » → cible tactile ≥ 44px) ; `--sm` `padding:7px 12px; font-size:13px`.

### 6.2 Boutons `.cf-btn` (contrat legacy, rendu via skin)

Base (classfood-ds) : variables privées `--_bg`/`--_fg` (défaut `--cf-fill`/`--cf-on-fill`), `gap:9px`, 800 14px uppercase `.02em`, `padding:13px 20px`, `border-radius:var(--cf-r-pill)` (999px), `transition: transform .12s ease, box-shadow .12s ease, filter .12s ease` ; `:active` `translateY(1px)` ; `:disabled` `opacity:.4; cursor:not-allowed; box-shadow:none`.

Variantes base : `--primary` (accent + `--cf-shadow`, hover `brightness(1.05)` + `translateY(-1px)`) ; `--ink` (fill + `--cf-shadow-accent`, hover `translateY(-1px)`) ; `--gold` (fond `--cf-gold`, texte `#1C1612`, `--cf-shadow`) ; `--ghost` (transparent, `border:2px solid var(--cf-text)`, `padding:11px 18px`, hover inversion `background:var(--cf-text); color:var(--cf-bg)`) ; `--sm` (`9px 14px`, 12px) ; `--lg` (`16px 26px`, 16px) ; `--block` (flex, `width:100%`).

Overrides skin SM : `letter-spacing:-.2px; text-transform:none; font-weight:600; border-radius:var(--sm-r-pill)` (50px) ; `transition: opacity .2s, transform .12s` ; hover `opacity:.85` ; `--primary` sans ombre, hover sans filter/transform ; `--ink` → fond `--sm-btn-dark` (#262626), texte `#fff`, sans ombre ; `--gold` → fond `--sm-accent`, texte `--sm-on-accent`, sans ombre ; `--ghost` → `border:1px solid var(--sm-border-10)`, texte `#fff`, hover `background:var(--sm-surface-6)`.

Primitive React `Btn` (cf-ui.jsx) : props `variant` (défaut `"primary"`), `size`, `block`, `icon`, `iconRight`, `className`, rest → `<button>` ; icônes 18px (15px en taille `sm`).

### 6.3 Bouton icône `.cf-iconbtn`

Base : 40×40px, rond (pill), `border:2px solid var(--cf-border)`, fond `--cf-surface`, `transition: border-color .12s, background .12s` ; hover `border-color:var(--cf-text)`. Skin : `border:1px solid var(--sm-border-10)`, fond `--sm-badge-bg` ; hover `border-color:var(--sm-white-50)`. Équivalent `.sm-*` : inexistant — **à définir** pour packages/ui.

### 6.4 Badges, chips, tags, pills, stickers, prix

**`.sm-badge`** — `inline-flex`, `gap:8px`, fond `#1a1a1a`, `border:1px solid var(--sm-border-10)`, `border-radius:20px`, `padding:6px 14px`, 14px 500 `-.01em`, blanc. Sous-badge `.accent` : fond `--sm-accent`, `border-radius:12px`, `padding:2px 8px`, 12px 600, `--sm-on-accent`. Démos : « En ligne · Green House » (avec dot pulsé), « Offre fondateur **7 places** ».

**`.sm-chip`** (filtre cliquable) — 12px 500 `-.01em`, couleur `--sm-gray`, fond `--sm-surface-6`, `border:1px solid transparent`, pilule, `padding:4px 11px`, `white-space:nowrap`, `transition: color .2s, border-color .2s`. Hover : texte blanc. Actif `.is-on` : texte blanc + `border-color:var(--sm-white-50)`. Démos : « Tout · 24 » (on) / « Nouvelles · 3 » / « En prépa · 5 » / « Prêtes · 2 ».

**`.cf-chip`** — base : cond 600 15px, `padding:7px 14px`, `border:1.5px solid var(--cf-border)`, fond `--cf-surface` ; hover `border-color:var(--cf-text)` ; état actif `[aria-pressed="true"]` ou `.is-on` : fond `--cf-fill`, texte `--cf-on-fill`. Skin : `border:1px transparent`, fond `--sm-surface-6`, couleur `--sm-gray`, 500 ; hover texte `#fff` ; is-on fond `--sm-surface-6`, texte `#fff`, `border-color:var(--sm-white-50)`.

**`.sm-tag`** (statut — couleurs fonctionnelles UNIQUEMENT) — 11px 600 `.02em`, pilule, `padding:3px 10px` :

| Variante | Fond | Texte | Bordure | Libellé démo |
|---|---|---|---|---|
| `--new` | `rgba(201,75,63,.16)` | `#e77b70` | `1px solid rgba(201,75,63,.4)` | « Nouveau » |
| `--wait` | `rgba(224,151,63,.14)` | `#eab06a` | `1px solid rgba(224,151,63,.38)` | « En préparation » |
| `--ready` | `rgba(63,174,74,.14)` | `#6ecf78` | `1px solid rgba(63,174,74,.38)` | « Prête » |
| `--info` | `--sm-surface-6` | `--sm-white-80` | `1px solid var(--sm-border-10)` | « Payé en ligne » |

**`.cf-pill`** — base : 800 10px `.1em` uppercase, `padding:4px 9px`, pilule, fond `--cf-fill`/`--cf-on-fill`. Variantes : `--new` (accent), `--gold` (fond `--cf-gold`, texte `#1C1612`), `--out` (transparent, texte muted, `border:1.5px solid var(--cf-border)`), `--green` (fond `--cf-green`, texte `#fff`). Skin : `letter-spacing:.06em; font-weight:600`.

**`.cf-sticker`** — base : slab 12px `.04em` uppercase, fond accent, `padding:6px 12px 5px`, pilule, `rotate(-4deg)`, ombre dure. Skin : `transform:none; box-shadow:none; font-weight:600; letter-spacing:.02em`, fond `--sm-accent`, texte `--sm-on-accent`. (Primitive React `Sticker` : prop `rotate` défaut −4.)

**`.cf-price`** — base : slab 14px, fond `--cf-fill`, texte `--cf-on-fill`, `padding:2px 9px 3px`, `border-radius:var(--cf-r-sm)`. Variantes `--plain` (transparent), `--accent`. Skin : fond `--sm-badge-bg`, `border:1px solid var(--sm-surface-6)`, 600, `tabular-nums`. Primitive React `Price` : props `value`/`str` (parse €), `size` (14), `variant`, `from` (préfixe « dès » à 72 % de la taille, opacité .8).

### 6.5 Points de statut `.sm-dot` (pulse temps réel)

9×9px, rond, `flex-shrink:0`, fond `--sm-green` par défaut. Variantes : `--red` (`--sm-red`, `--_pc:201,75,63`), `--amber` (`--sm-amber`, `--_pc:224,151,63`), `--accent` (`--sm-accent`, `--_pc:201,161,90` — laiton codé en dur, cf. §4.2).

`.sm-dot--pulse` : `animation: smPulse 2s infinite` —

```css
@keyframes smPulse {
  0%   { box-shadow: 0 0 0 0   rgba(var(--_pc,63,174,74), .45) }
  70%  { box-shadow: 0 0 0 8px rgba(var(--_pc,63,174,74), 0) }
  100% { box-shadow: 0 0 0 0   rgba(var(--_pc,63,174,74), 0) }
}
```

Sémantique (copy DS) : *« Pulse 2 s : présence temps réel (en ligne, live) »* ; *« Rouge pulsé : nouvelle commande à accepter »*. Désactivé sous `prefers-reduced-motion: reduce`.

### 6.6 Cartes

**`.sm-card`** — fond `--sm-card-gradient`, `border:1px solid var(--sm-surface-6)`, `border-radius:var(--sm-r)` (16px). `.sm-card--pad` : `padding:22px 20px`. `.sm-card--flat` : fond `--sm-card` (#111 plat), radius 12px. `.sm-divider` : `height:1px; background:var(--sm-border-10)`.

**`.cf-card`** — base : `border:2px solid var(--cf-text)`, radius 14px, ombre dure, `overflow:hidden` ; `--soft` (`border:1px solid var(--cf-border)` + `--cf-shadow-card`) ; `--flat` (bordure fine sans ombre). Skin : les trois variantes → `border:1px solid var(--sm-surface-6)` ; `cf-card`/`--soft` fond `--sm-card-gradient`, `--flat` fond `--sm-card`.

**Spotlight `.sm-spot`** (survol doré) — pseudo `::after` en `inset:0`, `border-radius:inherit`, `pointer-events:none`, `opacity:0→1` au hover, `transition: opacity .35s`, fond `radial-gradient(360px circle at var(--mx,50%) var(--my,50%), rgba(201,161,90,.09), transparent 55%)`. JS requis (pointermove) :

```js
el.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
el.style.setProperty('--my', (ev.clientY - r.top) + 'px');
```

Règle d'usage (copy DS) : *« Réservé aux cartes interactives des surfaces desktop — jamais sur tablette. »* Transition coupée sous `prefers-reduced-motion`.

### 6.7 Formulaires

**`.sm-field`** — colonne, `gap:6px` ; `label` : 12.5px 600 blanc, `letter-spacing:.01em`.
**`.cf-field`/`.cf-label`** — colonne `gap:6px` ; label 700 12px `.04em` uppercase `--cf-text-mut`.

**`.sm-input` / `.sm-select` / `.sm-textarea`** — Inter 14px blanc, fond `rgba(255,255,255,.05)`, `border:1px solid var(--sm-surface-6)`, radius 10px, `padding:11px 13px`, `width:100%`, `outline:none`, `transition: border-color .2s`.
- Placeholder : `rgba(255,255,255,.28)`.
- Focus : `border-color:var(--sm-accent)`.
- `.sm-select` : `appearance:none` + chevron SVG inline en `background-image` (data-URI, trait `#999`, 12×12, `stroke-width:1.8`), positionné `right 12px center`, `padding-right:34px`.
- États erreur / désactivé / lecture seule : **à définir**.

**`.cf-input`/`.cf-select`/`.cf-textarea`** — base : 15px, `border:1.5px solid var(--cf-border)`, radius 9px, `padding:12px 14px` ; focus : bordure `--cf-text` + `box-shadow: 0 0 0 3px color-mix(in srgb, var(--cf-accent) 22%, transparent)` ; placeholder `color-mix(in srgb, var(--cf-text-mut) 75%, transparent)`. Skin : `border:1px solid var(--sm-surface-6)`, fond `rgba(255,255,255,.05)`, radius `--sm-r-sm` ; focus `border-color:var(--sm-accent)` sans box-shadow.

**Toggle `.sm-toggle`** — 46×26px, pilule, fond `--sm-surface-6`, `transition: background .2s`. Curseur `::before` : 20×20px blanc, `top:3px; left:3px`, `transition: left .2s`, ombre `0 1px 3px rgba(0,0,0,.4)`. État `.is-on` : fond `--sm-green`, curseur `left:23px`. Variante `--danger.is-on` : fond `--sm-red`. Libellés démo : « Disponible à la vente » (toggle vert), « Rupture (retire de la commande en ligne) » (toggle danger).

**Range `.sm-range`** — piste `height:4px`, radius 2px, fond `--sm-surface-6` ; thumb webkit 18×18px rond, fond `--sm-accent`, `border:3px solid var(--sm-black)`, `box-shadow: 0 0 0 1px var(--sm-accent)`. *(Thumb Firefox `::-moz-range-thumb` non défini — à définir.)*

**Stepper `.cf-stepper`** (quantités POS/client) — base : `inline-flex`, `border:2px solid var(--cf-text)`, pilule, fond `--cf-surface` ; boutons 36×36px, symbole 20px 800, hover inversé (`--cf-fill`/`--cf-on-fill`) ; valeur `.val` : slab 16px, `min-width:30px`, centrée. Skin : `border:1px solid var(--sm-border-10)`, fond `--sm-badge-bg` ; hover bouton `background:var(--sm-btn-dark); color:#fff`. Primitive React `Stepper` : props `value`, `onChange`, `min=0`, `max=99` ; boutons `aria-label` « Moins » / « Plus » ; valeur en `tabular-nums`.

### 6.8 KPI `.sm-kpi`

Colonne `gap:4px`, `padding:22px 20px`, fond `--sm-card-gradient`, `border:1px solid var(--sm-surface-6)`, radius 16px.
- `.k-label` : 12.5px 500 `--sm-gray`. Démos : « CA du jour », « Temps moyen ».
- `.k-value` : 34px 600 `-.03em`, `line-height:1.1em`, blanc, `tabular-nums`. Démos : « 1 290 € », « 11 min ».
- `.k-delta` : 12.5px 600 ; `.up` → `--sm-green`, `.down` → `--sm-red`. Démos : « ▲ +18 % vs mardi dernier », « ▼ à surveiller au rush ».
Règle (copy) : *« Valeur en 600, delta coloré fonctionnel avec référence de comparaison explicite. »*

### 6.9 Tables `.sm-table`

`width:100%; border-collapse:collapse`.
- `th` : 11px 600 `.06em` uppercase `--sm-gray`, alignées à gauche, `padding:10px 14px`, `border-bottom:1px solid var(--sm-border-10)`.
- `td` : 14px `--sm-white-80`, `padding:12px 14px`, `border-bottom:1px solid var(--sm-surface-6)`.
- Hover ligne : `tr:hover td { background:var(--sm-surface-3) }`.
- Tri, pagination, sélection de ligne, état vide : **à définir**.

### 6.10 Ticket KDS — les 3 états (démo de référence, page DS)

Carte `.tk` : `width:250px`, fond `--sm-card-gradient`, `border:1px solid var(--sm-surface-6)`, radius 14px, `overflow:hidden`. Zones : `.tk-head` (`padding:11px 13px`, `gap:10px`, `border-bottom:1px solid var(--sm-surface-6)`) avec numéro `.no` 19px 600 `-.03em` ; `.tk-body` (`padding:11px 13px`, 13px `--sm-white-80`, colonne `gap:6px`) ; `.tk-foot` (`padding:11px 13px`, `border-top`).

| État | Bordure carte | Head | Body (démo) | Bouton pied (pleine largeur) |
|---|---|---|---|---|
| **Nouveau** | `rgba(201,75,63,.45)` | dot rouge pulsé + « 42 » + « Yassine B. » + tag `--new` « Nouveau » (aligné droite) | « 1× Tacos L gratiné — kebab, poulet » / « 2× Coca 33cl » | `.sm-btn--light` « Accepter · 00:41 » |
| **En prépa** | (défaut) | « 41 » + « Marie L. » + tag `--wait` « En prépa » | « 1× Menu Enfant » **barré, opacité .5** (`line-through`) / « 1× Milkshake Oréo XL » | `.sm-btn--dark` « Marquer prête · 04:12 » |
| **Prête** | `rgba(63,174,74,.4)` | dot vert fixe + « 39 » + « Karim D. » + tag `--ready` « Prête » | « 1× Mix Box 1 » / « 1× Onion rings » | `.sm-btn--ghost` « Remise client · n°39 » |

Règles (copy exacte) : *« Minuteur dans le bouton d'action : vert < 5 min, ambre < 10 min, rouge au-delà. Carte non compressible (flex-shrink: 0), colonne scrollable. »*

Minuteur : hook React `useElapsed(since)` (cf-ui.jsx) — tick `setInterval` 1000 ms, retourne `{ text: "mm:ss" (zéro-paddé), minutes }`. L'application des seuils couleur au bouton (classe/style exact) n'est pas dans la couche DS — **à définir** (implémentée dans `kds-app.jsx`, hors périmètre de ce document).

### 6.11 Toast (primitive React `useToasts`, cf-ui.jsx)

Hôte : `position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:9000`, colonne `gap:8px`, `pointer-events:none`. Toast : fond `--cf-ink`, texte `--cf-cream` *(en skin SM : blanc sur #0b0b0b via remap)*, `padding:12px 18px`, pilule, 700 14px, ombre `--cf-shadow-soft`, icône optionnelle 17px couleur `--cf-gold`, animation d'entrée `.cf-anim-pop`. **Durée d'affichage : 2200 ms par défaut** (option `ms`). Pas d'animation de sortie (suppression sèche) — **à définir**. File d'attente : empilement vertical simple.

### 6.12 BarChart (primitive React, cf-ui.jsx)

Barres flex alignées en bas, `gap:10px`, hauteur défaut 150px, couleur défaut `var(--cf-accent)` ; valeur au-dessus et label en dessous (cond 12px 600 `--cf-mut`) ; barre `border-radius:6px 6px 0 0`, `min-height:4px` si valeur > 0, `transition: height .4s ease`. Axes, tooltips, états vides : **à définir**.

### 6.13 Autres primitives React (cf-ui.jsx)

- `Icon` — SVG 24×24 (taille défaut 22, stroke 2, `currentColor`), chemins via `window.CF.iconPath(name)` (cf-helpers.js), `aria-hidden`.
- `CFLogo` — logo burger Class'Food (bun `--cf-ink`, barre accent, base ink) ; anneau optionnel 3px `--cf-ink` sur fond `--cf-cream` avec ombre `4px 4px 0 var(--cf-accent)` ; wordmark slab (« Class' » ink + « Food » accent). **Remplacé au runtime par `BrandLogo` de sm-brand.jsx** (voir §4.2).
- `Head` — tête de section (`.cf-head` + slot droit aligné `flex-end` + `.rule` + note).
- `Stars` — 5 étoiles 15px, remplies ≤ n en `--cf-gold`, sinon contour `--cf-line`.
- `Check` — rend `.cf-check` (+ `--ink`).

### 6.14 Utilitaires layout & divers (classfood-ds.css)

- `.cf-row` (flex, `gap:var(--cf-u)`), `.cf-col`, `.cf-between` (space-between), `.cf-wrap`, `.cf-grow` (`flex:1`).
- `.cf-dots` — ligne de conduite pointillée (menus) : `border-bottom:1.5px dotted var(--cf-border)`, `translateY(-3px)`.
- `.cf-scroll` / `.sm-scroll` — scrollbar fine : largeur 8px, pouce `--cf-border` / `--sm-border-10`, radius 8px ; `scrollbar-color: var(--sm-border-10) transparent`.
- `.cf-ghost` — texte fantôme décoratif : display, `color:transparent`, `-webkit-text-stroke:1.5px var(--cf-text)`, `opacity:.06`, uppercase, non interactif. Skin : stroke `1px rgba(255,255,255,.5)`, `opacity:.07`.
- `.cf-hidden` — `display:none !important`.
- `@keyframes cf-pop` : `scale(.9) → scale(1)` + fade, utilisée par `.cf-anim-pop` (`animation: cf-pop .18s ease both`).

### 6.15 Modales

**Aucun composant modal n'existe dans la couche design system de la maquette** (ni `.sm-*` ni `.cf-*`). Overlay, dialogue de confirmation (requis par la règle « Danger réservé aux destructions avec confirmation »), sheet tablette : **à définir** pour packages/ui.

---

## 7. Interactions & micro-interactions

### 7.1 Récapitulatif des durées et courbes

| Interaction | Durée | Courbe | Source |
|---|---|---|---|
| Hover boutons/chips/inputs (opacity, border-color, color) | `.2s` (`--sm-t-fast`) | défaut | sm-ds |
| Press bouton (`translateY(1px)`) | `.2s` (sm) / `.12s` (cf) | ease | sm-ds / classfood |
| Hover cf (base) : transform/box-shadow/filter | `.12s` | ease | classfood |
| Toggle (fond + curseur) | `.2s` | défaut | sm-ds |
| Pop d'apparition (`cf-pop`) | `.18s` | ease, `both` | classfood |
| Spotlight (opacité du halo) | `.35s` | défaut | sm-ds |
| Pulse dot (`smPulse`) | `2s` infinite | défaut | sm-ds |
| BarChart hauteur | `.4s` | ease | cf-ui |
| Nav « notch » (largeur 46→470px) | `.45s` | `cubic-bezier(.16,1,.3,1)` | sm-brand |
| Notch : apparition des liens (opacity/blur 4px/scale 1.04) | `.25s` | défaut | sm-brand |
| Hub pill (opacité .22→1) | `.15s` | défaut | page DS |
| Toast : durée de vie | `2200ms` défaut | — | cf-ui |
| Minuteur ticket | tick `1000ms` | — | cf-ui |

`prefers-reduced-motion: reduce` : sm-ds coupe `smPulse` et la transition spotlight ; la page DS ajoute un kill-switch global (`animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important`).

**Sons** : aucun son n'est défini dans les fichiers du design system — **à définir** (notamment l'alerte nouvelle commande KDS).
**Drag & drop** : absent de la couche DS — **à définir** par écran le cas échéant.

### 7.2 Nav « notch » (sm-brand.jsx, `mountNotch`) — signature de navigation inter-apps

- Fixée en `top:0; left:50%; translateX(-50%)`, `z-index:900`, Inter.
- Deux congés SVG latéraux (`viewBox 0 0 87 34`, rendus 77×30, remplis `#000`, le droit en `scaleX(-1)`).
- Corps `.smn-mid` : hauteur 30px, fond `#000`, **largeur 46px fermée → 470px au survol**, `overflow:hidden`, `transition: width .45s cubic-bezier(.16,1,.3,1)`.
- Contenu : tuile centrale 20×20px radius 6px fond `var(--cf-accent)` avec l'initiale de la marque (800, 11px, blanc) ; de part et d'autre, groupes de liens `.smn-g` (`gap:14px`) apparaissant au hover (`opacity:0; filter:blur(4px); scale(1.04)` → net, `transition .25s`).
- Liens : 12.5px 600, couleur `#cfd2d8`, hover `#fff`, **page courante `color:var(--cf-accent)`** (classe `on`, détectée via `location.pathname`).
- Destinations (démo) : « Commande », « Caisse », « Cuisine », « Back-office ».
- *(Note : `mountNotch` est défini mais son appel n'apparaît pas dans ce fichier — comportement d'activation par surface **à définir**.)*

### 7.3 Switcher de marque démo (sm-brand.jsx, `mountBar`)

Masqué si `EMBEDDED`. Barre fixe `left:14px; bottom:14px; z-index:800` : fond `rgba(10,11,13,.92)`, `border:1px solid rgba(245,246,247,.14)`, pilule `999px`, `padding:6px 8px`, `backdrop-filter: blur(8px)`. Label « Marque » : 10px 700 `.12em` uppercase `#8b8f98`. Un bouton rond par marque : 26×26px, fond = accent de la marque, initiale blanche 800 12px, `border:2px solid #fff` si marque active (sinon transparent), `title` = « Nom · Ville ». Clic : écrit `localStorage["sm-brand-id"]` puis `location.reload()`. *(Outil démo — ne pas livrer en production ; le choix du tenant en prod est à définir, cf. §4.4.)*

### 7.4 Polish global (page DS, styles `#sm-polish` et annexes)

- `::selection { background:#c9a15a; color:#000 }` (version tokenisée dans sm-ds : `background:var(--sm-accent); color:var(--sm-on-accent)`).
- `caret-color:#c9a15a` sur `input, textarea`.
- `-webkit-tap-highlight-color:transparent` partout ; `touch-action:manipulation` sur `button, a` ; `-webkit-text-size-adjust:100%`.
- Scrollbars WebKit : 10px, pouce `rgba(255,255,255,.14)` radius 99px avec `border:2px solid transparent; background-clip:content-box` ; hover `rgba(201,161,90,.5)`.
- `html { color-scheme:dark; scroll-behavior:smooth }`.
- `:focus-visible { outline:2px solid #c9a15a; outline-offset:2px }` (tokenisé dans sm-ds : `var(--sm-accent-hover)`).

---

## 8. Page « SM — Design System.html » — structure, layout, copy

Cette page est la documentation vivante du DS. La documenter permet de la reconstruire comme page interne de `packages/ui`.

### 8.1 Head / méta

- `<title>` : « SM — Design System ». `lang="fr"`. `meta theme-color: #000000`. `meta robots: noindex`. `meta description` : « Design system SM Dark — tokens, composants, règles marque blanche. »
- Favicon : SVG data-URI — carré 64×64 noir, radius 14, « S » Arial 800 32px couleur `#c9a15a`.
- Fonts : preconnect Google Fonts + `Inter:wght@400;500;600;700;800` + `ADLaM Display`.
- Charge `app/sm-ds.css` uniquement (pas classfood-ds ni sm-skin).

### 8.2 Layout

- Reset local `*{margin:0;padding:0;box-sizing:border-box}` ; body fond `--sm-black`, texte `--sm-white`, `--sm-font`, antialiasing.
- Liens : couleur `--sm-accent`, hover `--sm-accent-hover`, sans soulignement.
- Hero `header.hero` : `padding:80px 40px 50px`, `border-bottom:1px solid var(--sm-surface-6)`, `margin-bottom:60px` ; contenu interne `max-width:1100px` centré.
- Conteneur `.wrap` : `max-width:1100px`, centré, `padding:0 40px 120px`.
- Sections `.sec` : `margin-top:70px` ; titre `h2` 32px 600 `-.03em`, `margin-bottom:6px` ; chapeau `.lead` 15px `--sm-gray`, `max-width:640px`, `line-height:1.55`, `margin-bottom:28px`.
- Grilles `.grid` : `gap:14px` ; `.g2` 2 col, `.g3` 3 col, `.g4` 4 col. Cellules `.cell` : fond `--sm-card-gradient`, `border:1px solid var(--sm-surface-6)`, radius 14px, `padding:20px` ; `h4` 13px 600 blanc `margin-bottom:14px` ; `.note` 12px `--sm-gray` `line-height:1.5`.
- Nuancier `.swatches` : grille 6 colonnes `gap:12px` ; carte `.sw` radius 12px, pastille couleur `.c` hauteur 64px, cartouche `.m` 11px sur `--sm-card`.
- Rangées de type `.type-row` : baseline, `gap:20px`, `padding:13px 0`, séparées par `--sm-surface-6` ; étiquette `.tag` 120px fixe 11px gray.
- Do/Don't `.do-dont` : 2 colonnes `gap:14px` ; blocs radius 14px `padding:18px` — do : bordure `rgba(63,174,74,.35)` fond `rgba(63,174,74,.05)` titre `#6ecf78` ; don't : bordure `rgba(201,75,63,.35)` fond `rgba(201,75,63,.05)` titre `#e77b70` ; titres 12px 700 `.06em` uppercase.
- Table de mapping `.map` : th 10.5px uppercase `.07em` gray ; td monospace (`ui-monospace`) 11.5px `--sm-white-80`.
- **Responsive** : `@media(max-width:900px)` → `.g3,.g4` passent en 2 colonnes, `.swatches` en 3, `.do-dont` en 1. *(Aucun autre breakpoint défini — comportement mobile complet à définir.)*

### 8.3 Contenu / copy exacte

- Hero : badge « SM Dark · v1 » (avec dot pulsé) ; H1 « Le design system Snack Manager » ; paragraphe : *« Une seule base visuelle — héritée de la landing — pour toutes les surfaces : caisse, cuisine, commande en ligne, back-offices. Sombre, dense en information, lisible en plein rush. »* ; boutons « Voir la landing (source) » (light) et « L'écosystème » (ghost).
- Sections (ancres) : `#principes` (§3), `#couleurs` — lead : *« Tokens exacts de la landing. L'accent est la seule couleur injectée par marque (défaut laiton #c9a15a ; démo : Class'Food rouge, O'Braise orange, Green House vert). »* — 12 swatches (§2.1), `#typo` (§5.1), `#forme` « Rayons & effets » — note : *« Cartes 16, tuiles internes 10–12, boutons et chips toujours en pilule. »* + spotlight/pulse (§6.5–6.6), `#composants` (§6), `#marque` (§4.1), `#mapping` (§2.4).
- Pastille « hub » fixe bas-gauche (`#sm-hub-pill`) : 30×30px radius 9px fond `#000`, « S » `#c9a15a` Arial 800 15px, `left:10px; bottom:10px; z-index:99999`, opacité `.22` → `1` au hover (`.15s`), ombre `0 2px 8px rgba(0,0,0,.35)` ; masquée à l'impression et quand l'URL contient `?embed`.

### 8.4 Données

La page ne lit ni n'écrit aucune donnée (pas de localStorage, pas de réseau). Seul JS : suivi `pointermove` pour le spotlight (§6.6) et masquage du hub pill si `location.search` contient `embed`.

---

## 9. Guidance d'implémentation `packages/ui` + Tailwind

> Cette section est une **traduction technique** des tokens ci-dessus, pas une reprise de la maquette.

### 9.1 Stratégie tokens

1. **Les tokens vivent en CSS variables** (fichier unique `tokens.css` reprenant §2.1 à l'identique) ; Tailwind les référence, il ne les remplace pas. C'est la condition du theming runtime : l'accent tenant est injecté en JS sur `document.documentElement` sans rebuild.
2. **Exposer l'accent en triplet** : `--sm-accent`, `--sm-accent-hover`, `--sm-on-accent` (+ alias `--cf-accent`/`--cf-on-accent` tant que du code legacy subsiste). L'injecteur de prod doit poser **les deux familles** (correctif du bug de la maquette, §4.2) et dériver hover/on-accent (**règle de dérivation à définir** — la maquette utilise `#e0b96f` fixe pour le laiton et `#ffffff` comme on-accent des marques démo).
3. **Interdire l'accent sur les statuts** : les couleurs fonctionnelles `green/red/amber` sont des constantes produit, jamais thémables (lint/`no-arbitrary-values` recommandé).

### 9.2 Extension Tailwind (mapping proposé)

```js
theme: {
  extend: {
    colors: {
      black: '#000', seam: '#050505', card: '#111',
      'badge-bg': '#1a1a1a', 'btn-dark': '#262626', gray: '#999',
      'surface-3': 'rgba(255,255,255,.03)', 'surface-6': 'rgba(255,255,255,.06)',
      'border-10': 'rgba(255,255,255,.1)', watermark: 'rgba(255,255,255,.18)',
      accent: { DEFAULT: 'var(--sm-accent)', hover: 'var(--sm-accent-hover)', on: 'var(--sm-on-accent)' },
      ready: '#3fae4a', alert: '#c94b3f', wait: '#e0973f',           // fonctionnelles fixes
      'ready-t': '#6ecf78', 'alert-t': '#e77b70', 'wait-t': '#eab06a', // teintes texte des tags
    },
    borderRadius: { xs: '8px', sm: '10px', md: '12px', DEFAULT: '16px', lg: '20px', pill: '50px' },
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], logo: ['"ADLaM Display"', 'sans-serif'] },
    transitionTimingFunction: { sm: 'cubic-bezier(.2,.8,.2,1)' },
    transitionDuration: { fast: '200ms', med: '450ms', slow: '600ms' },
    maxWidth: { content: '1200px' },
    backgroundImage: { 'card-gradient': 'linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)' },
  }
}
```

### 9.3 Composants à livrer dans `packages/ui` (dérivés de §6)

Button (5 variantes × 3 tailles + disabled ; loading **à définir**), IconButton (**à créer**, §6.3), Badge (+ sous-badge accent), Chip (filtre, état `is-on`), StatusTag (4 variantes fonctionnelles), StatusDot (pulse, 4 couleurs), Card (gradient / flat / pad / spotlight desktop-only), Divider, Field/Input/Select/Textarea (états erreur/disabled **à définir**), Toggle (+ danger), Range (thumb Firefox **à définir**), Stepper, KPI, Table, TicketKDS (3 états + minuteur `useElapsed` + seuils 5/10 min), Toast (sortie animée **à définir**), BarChart, BrandLogo (tuile initiale + wordmark), Notch nav, **Modal/ConfirmDialog (absent de la maquette — à concevoir en respectant les principes §3)**.

### 9.4 Récapitulatif des « à définir »

| Sujet | Référence |
|---|---|
| États vide / chargement / erreur de tous les composants | §6 (préambule) |
| Modales, confirmation destructive, sheets | §6.15 |
| États erreur/disabled/readonly des inputs ; thumb range Firefox | §6.7 |
| Application exacte des seuils couleur du minuteur KDS (5/10 min) | §6.10 |
| Animation de sortie des toasts | §6.11 |
| Axes/tooltips/état vide du BarChart | §6.12 |
| Sons (alerte nouvelle commande) ; drag & drop | §7.1 |
| Activation de la nav notch par surface | §7.2 |
| Résolution du tenant en production (domaine/slug) ; persistance serveur des tweaks ; priorité tenant vs tweaks | §4.3–4.4 |
| Dérivation de `--sm-accent-hover` / `--sm-on-accent` depuis l'accent injecté ; variabilisation des laitons codés en dur | §4.2, §9.1 |
| Breakpoints complets (un seul défini : 900px sur la page DS) | §8.2 |
| Divergence de copy « Cinq règles » / six cellules | §3 |
| Tri/pagination/sélection des tables | §6.9 |
