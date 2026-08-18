# Spec — Back-office interne « Snack Manager » (CRM HQ)

**Surface :** back-office interne / CRM de Snack Manager (SaaS multi-tenant, marque grise, fast-foods).
**Cible production :** application Next.js desktop.
**Source maquette :** `Menu Trivolet Redesign (1)/app/sm-crm.jsx` (composant `SMCRMApp`), monté par `SM - Back-office Snack Manager.html`.
**Dépendances de la maquette :** `app/cf-ui.jsx` (Icon, Btn, Pill, BarChart), `app/cf-helpers.js` (`window.CF` : `fmtEuro`, chemins d'icônes), `app/classfood-ds.css` (base DS), `app/sm-skin.css` (adaptateur sombre, importe `app/sm-ds.css`).

Ce document permet de recréer la surface en production **sans relire le code de la maquette**. Toute valeur (px, hex, durées) est citée depuis la maquette. Tout comportement absent de la maquette est marqué **« à définir »**.

---

## 0. Convention de lecture

- Les tokens sont donnés sous leur nom CSS (`--cf-*`) **avec leur valeur effective sur cette surface** (après cascade `classfood-ds.css` → `sm-ds.css` → `sm-skin.css` → styles inline de la page hôte).
- « Accent HQ » = `#c9a15a` (laiton/or Snack Manager). C'est l'accent de CETTE surface interne ; il n'est pas thémable par les restaurants (voir §2.4).
- Les tailles de police sans unité sont en px.

---

## 1. Cadre général de la maquette

### 1.1 Page hôte (staging de démo — ne pas reproduire tel quel en prod)

- `<title>` : `Snack Manager — Back-office interne (CRM)` ; favicon : tuile noire arrondie, « S » en `#c9a15a` ; `theme-color: #000000` ; `robots: noindex`.
- Fond de page derrière l'app : `radial-gradient(1200px 700px at 50% -10%, #14161a, #0c0d10 60%, #060708)`, app centrée (`display:grid; place-items:center`), `overflow:hidden`.
- L'app est rendue dans un **cadre fixe 1360 × 862 px** mis à l'échelle pour tenir dans le viewport :
  `scale = max(0.05, min(1, (hauteurFenêtre − 24) / 862, (largeurFenêtre − 24) / 1360))`, recalculé au `resize` (via `transform: translate(-50%,-50%) scale(s)` sur un conteneur `#stage` fixé au centre).
- Police : **Inter** (Google Fonts, graisses 400, 500, 600, 700, 800).
- **En production** : l'app doit occuper tout le viewport desktop ; le cadre 1360×862, la barre « navigateur factice » (§3.1) et le scale sont des artifices de présentation de la maquette. Comportement responsive : **à définir** (la maquette est desktop fixe).

### 1.2 Chrome de fenêtre factice (dans le cadre)

Présent dans la maquette comme habillage « fenêtre macOS ». À considérer comme **décor de démo, à ne pas implémenter** (à confirmer) :

- Cadre : 1360×862, `border-radius: 16px`, `border: 1px solid rgba(255,255,255,.1)`, `box-shadow: 0 40px 100px rgba(0,0,0,0.6)`, fond `var(--cf-bg)` = `#000`, `overflow: hidden`, colonne flex.
- Barre du haut : hauteur **44px**, fond `#1a1a1a`, `padding: 0 16px`, gap 14, `border-bottom: 1px solid rgba(255,255,255,.1)`.
  - 3 pastilles « feux » : cercles **12px**, gap 8, couleurs `#ff5f57`, `#febc2e`, `#28c840`.
  - Pilule URL centrée : `flex:1; max-width: 420px`, hauteur **26px**, fond `#111`, `border-radius: 8px`, `border: 1px solid rgba(255,255,255,.1)`, `padding: 0 12px`, gap 8. Contenu : icône `check` 12px couleur `#3fae4a` + texte `hq.snackmanager.fr` (13px, `#999`).

---

## 2. Tokens de design (valeurs effectives sur cette surface)

### 2.1 Couleurs

| Token | Valeur effective | Usage |
|---|---|---|
| `--cf-bg` | `#000` | fond app |
| `--cf-surface` | `#111` | sidebar, colonnes pipeline, pilule URL |
| `--cf-surface-2` | `#1a1a1a` | barre fenêtre, tuiles icônes KPI, lignes d'activité, badges compteurs, chips modules, ligne sélectionnée, avatar admin |
| `--cf-text` | `#fff` | texte principal |
| `--cf-text-mut` | `#999` | texte secondaire / atténué |
| `--cf-border` | `rgba(255,255,255,.1)` | toutes les bordures 1px |
| `--sm-surface-6` | `rgba(255,255,255,.06)` | bordure des cartes (`.cf-card--soft`), fond hover bouton ghost |
| `--sm-card-gradient` | `linear-gradient(180deg, rgba(17,17,17,.9) 0%, rgb(17,17,17) 100%)` | fond des cartes |
| `--cf-accent` | **`#c9a15a`** (accent HQ, posé par la page hôte) | nav active, logo, valeurs MRR, icônes KPI, barres du graphe, boutons primaires |
| `--cf-on-accent` | **`#0a0b0d`** (posé par la page hôte ; le code force aussi `color:#0a0b0d` inline sur les boutons primaires) | texte sur accent |
| `--sm-accent-hover` | `#e0b96f` | (défini, peu utilisé ici) |
| `--cf-gold` | `#c9a15a` | pills « gold » (plan Pro, statuts orange/attente) — **identique à l'accent HQ sur cette surface** |
| `--cf-green` | `#3fae4a` | **fonctionnelle fixe : prêt / positif / résolu / payé** |
| `--cf-red` | `#c94b3f` | **fonctionnelle fixe : alerte / urgent / nouveau / ouvert** |
| `--sm-amber` | `#e0973f` | **fonctionnelle fixe : attente / préparation** (définie dans le DS ; non utilisée dans le CRM, qui emploie `--cf-gold` pour les états intermédiaires — harmonisation **à définir**) |
| `--sm-btn-dark` | `#262626` | fond bouton variant `ink` |
| `--sm-badge-bg` | `#1a1a1a` | fond `.cf-iconbtn` |
| `--cf-fill` / `--cf-on-fill` | `#1a1a1a` / `#fff` | pills par défaut |
| `--sm-white-50` | `rgba(255,255,255,.5)` | bordure hover `.cf-iconbtn` |

Couleurs codées en dur dans le JSX (hors tokens) : `#0a0b0d` (texte sur accent), `#fff` (texte sur pastilles/avatars), `#ff5f57`/`#febc2e`/`#28c840` (feux fenêtre), accents des clients (données, voir §5.3).

### 2.2 Typographie

- Famille unique : `Inter, system-ui, sans-serif` pour `--cf-disp`, `--cf-body`, `--cf-cond` (l'adaptateur SM remplace les polices Class'Food ; `ADLaM Display` est déclarée dans le DS pour le logo mais **non utilisée** dans le CRM).
- Classes utilitaires effectives :
  - `.cf-cond` : `font-weight: 500; letter-spacing: -0.015em` (texte secondaire).
  - `.cf-eyebrow` : `font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #999`.
  - `.cf-tabnums` : `font-variant-numeric: tabular-nums` (tous les montants et numéros en colonnes).
- Échelle observée dans le CRM : 9 (pills statut), 10 (eyebrow sidebar), 10.5 (chips modules), 11 (eyebrows, badge support), 12–13.5 (méta / secondaires), 14–14.5 (corps, noms), 16 (wordmark), 17 (titres de cartes), 19 (lettre avatar détail), 22 (H1 de page), 30 (valeur KPI).

### 2.3 Rayons, espacements, ombres, divers

| Token | Valeur | Usage |
|---|---|---|
| `--cf-r` | `16px` | cartes |
| `--cf-r-sm` | `10px` | inputs |
| `--cf-r-lg` | `20px` | (disponible) |
| `--sm-r-pill` | `50px` | boutons `.cf-btn` |
| `--cf-r-pill` | `999px` | pills, badges, iconbtn |
| Rayons inline | 7, 8, 9, 10, 11, 14 px | avatars 26/30/44px, tuiles, nav, colonnes pipeline |
| `--cf-u` / `--cf-u2` / `--cf-u3` | `16px` / `24px` / `32px` | gaps `.cf-row` / `.cf-between` (16px par défaut) |
| Padding de vue | `26px` | toutes les vues |
| Gap inter-cartes | `16px` | rangées KPI, grilles |
| `--cf-shadow-card` | `0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)` | cartes `.cf-card--soft` |
| Sélection texte | fond `#c9a15a`, texte `#000` | global |
| Caret des inputs | `#c9a15a` | global |
| `:focus-visible` | `outline: 2px solid #c9a15a; outline-offset: 2px` | global |
| Scrollbars | largeur/hauteur `10px`, pouce `rgba(255,255,255,.14)` rayon 99, hover `rgba(201,161,90,.5)` | global |

### 2.4 Règles de theming tenant (marque grise)

Règles inscrites dans le design system (`sm-ds.css`, en-tête) :

- **Personnalisable par restaurant** : `--sm-accent` / `--cf-accent` (accent de marque), logo (tuile initiale), nom.
- **Fixe pour tous les comptes** : neutres, typographie, rayons, et **couleurs fonctionnelles** :
  - vert `#3fae4a` = prêt / positif ;
  - rouge `#c94b3f` = nouveau / urgent / alerte ;
  - ambre `#e0973f` = attente / préparation.
- **Cas particulier de CETTE surface (CRM HQ)** : c'est l'outil interne de Snack Manager, pas une surface tenant. L'accent y est **fixé à `#c9a15a`** (marque SM) par la page hôte ; `sm-brand.jsx` (l'injecteur d'accent tenant) **n'est pas chargé** ici. Les accents des restaurants clients apparaissent uniquement **comme données** (pastilles avatar, pastille « Thème marque blanche » de la fiche client — §5.3).
- La maquette du CRM ne comporte aucun sélecteur de thème/tenant : gestion de l'édition du thème client (changement d'accent, upload logo…) **à définir** (le bouton « Configurer » de la fiche client est sans action).

---

## 3. Coquille applicative (commune aux 5 vues)

Layout intérieur du cadre : `flex` horizontal → **Sidebar 232px** + **zone contenu flex:1** (colonne : header de page + vue scrollable).

### 3.1 Sidebar (232px)

- Conteneur : `width: 232px`, fond `#111`, `border-right: 1px solid rgba(255,255,255,.1)`, colonne flex, `padding: 18px 12px`, `flex-shrink: 0`.
- **Bloc marque** (`padding: 0 8px 18px`, gap 10) :
  - Logo « SMLogo » : carré **30×30px**, `border-radius: 9px`, fond `#c9a15a`, lettre « S » centrée (`font-weight: 800`, taille `15px` = 30×0,5, couleur `#0a0b0d`).
  - Wordmark : `Snack Manager` — 16px, 800, `letter-spacing: -0.02em`, blanc.
- **Eyebrow** : `Interne · HQ` — 10px (padding `0 8px 8px`), uppercase, `#999`.
- **Navigation** (colonne, gap 3). 5 entrées `(id, icône, libellé)` :
  1. `dash` / `home` / `Tableau de bord`
  2. `pipeline` / `arrow` / `Pipeline`
  3. `clients` / `user` / `Clients`
  4. `billing` / `euro` / `Facturation`
  5. `support` / `bell` / `Support`
  - Item : `<button>` flex, gap 11, `padding: 11px 12px`, `border-radius: 10px`, `font-size: 14px`, texte à gauche, icône 18px.
  - **État actif** : fond `#c9a15a`, texte `#0a0b0d`, `font-weight: 800`, trait d'icône 2.3.
  - **État normal** : fond transparent, texte `#999`, `font-weight: 600`, trait d'icône 2.
  - **Hover** : aucun style défini dans la maquette — **à définir**.
  - **Badge Support** : sur l'entrée `support` uniquement, aligné à droite (`margin-left: auto`) : fond `#c94b3f`, texte `#fff`, `border-radius: 999px`, 11px, 800, `padding: 1px 7px`. Valeur = **nombre de tickets dont le statut ≠ « Résolu »** (2 dans la maquette). Masquage si 0 : **à définir** (le cas n'existe pas dans les données mock).
- **Pied utilisateur** (poussé en bas par `margin-top: auto` ; `padding: 12px 8px 0`, `border-top: 1px solid rgba(255,255,255,.1)`, gap 10) :
  - Avatar : cercle **34px**, fond `#1a1a1a`, lettre « A » 14px 800 couleur `#c9a15a`.
  - `Admin SM` (14px, 700) / `Fondateur` (12px, `#999`).
  - Icône `gear` 17px `#999` — **non interactive** dans la maquette (action **à définir**).

### 3.2 Header de page

- Bande : `padding: 16px 26px`, `border-bottom: 1px solid rgba(255,255,255,.1)`, flex space-between, `flex-shrink: 0`.
- Gauche :
  - **H1** (dépend de la vue) : 22px, 800, `letter-spacing: -0.02em`. Titres exacts :
    - `dash` → `Tableau de bord`
    - `pipeline` → `Pipeline commercial`
    - `clients` → `Clients & onboarding`
    - `billing` → `Facturation`
    - `support` → `Support`
  - Sous-titre (identique partout) : `Mardi 11 août 2026 · interne Snack Manager` — 13.5px, `#999`. En prod : date courante formatée en français — règle de formatage **à définir**.
- Droite (gap 12) :
  - Bouton **`Nouveau lead`** : `.cf-btn cf-btn--primary cf-btn--sm` avec icône `plus` (15px) — fond `#c9a15a`, texte `#0a0b0d` (forcé inline), `padding: 9px 14px`, 12px, `border-radius: 50px`. **Aucune action câblée** — formulaire de création de lead **à définir**.
  - Bouton icône cloche : `.cf-iconbtn` — **40×40px**, `border-radius: 999px`, `border: 1px solid rgba(255,255,255,.1)`, fond `#1a1a1a`, icône `bell` 18px. Hover : `border-color: rgba(255,255,255,.5)` (transition `border-color .12s, background .12s`). **Aucune action** (panneau notifications **à définir**).
- Zone de vue : `flex: 1; overflow-y: auto; padding: 26px` (classe `.cf-scroll`, scrollbar fine). La vue Pipeline utilise `overflow: auto` (scroll horizontal possible).

### 3.3 Navigation entre vues

- État `view` en mémoire (défaut `"dash"`). Le clic sur une entrée nav remplace la vue **instantanément, sans transition ni animation** (transitions de vue : **à définir**).
- Aucune synchronisation URL/route dans la maquette. En prod Next.js : routage par URL recommandé — **à définir**.
- L'état local de la vue Clients (sélection + cases onboarding) est **perdu** en quittant la vue (composant démonté). L'état du pipeline (`leads`) vit au niveau app : il **persiste entre les vues** mais est perdu au rechargement.

---

## 4. Vues

### 4.1 Tableau de bord (`dash`)

**Layout** : padding 26 ; rangée 1 = 5 cartes KPI (`gap: 16`, `align-items: stretch`, chaque carte `flex: 1`) ; rangée 2 (margin-top 16) = carte graphe (`flex: 1.3`) + carte activité (`flex: 1`).

#### Carte KPI (composant `Kpi`)

- Carte `.cf-card--soft` : fond `linear-gradient(180deg, rgba(17,17,17,.9), #111)`, `border: 1px solid rgba(255,255,255,.06)`, `border-radius: 16px`, ombre `0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)`, `padding: 18px`.
- Ligne du haut : label eyebrow (11px) à gauche ; à droite tuile **34×34px** `border-radius: 9px` fond `#1a1a1a` contenant l'icône 18px couleur `#c9a15a`.
- Valeur : 30px, 800, `letter-spacing: -0.02em`, `margin-top: 8px`.
- Sous-texte (optionnel) : 13px, 700, **toujours vert `#3fae4a`**, `margin-top: 2px`. ⚠️ Y compris pour « Risque churn » où la sémantique verte est discutable — couleur conditionnelle **à définir**.

#### Les 5 KPI (libellés/valeurs exacts)

| Label (eyebrow) | Valeur | Sous-texte | Icône | Origine de la valeur |
|---|---|---|---|---|
| `MRR` | `1115 €` | `▲ +14 % vs juillet` | `euro` | **calculée** : somme des `mrr` des clients dont `statut ≠ "Pause"` (299+299+149+219+149) |
| `Clients actifs` | `4` | `▲ +2 ce trimestre` | `user` | **calculée** : nombre de clients `statut === "Actif"` |
| `Leads en cours` | `6` | `3 démos cette semaine` | `arrow` | **calculée et réactive** : leads dont `stage ≠ "actif"` — décrémente en direct si on avance des leads dans le Pipeline |
| `Risque churn` | `1` | `Chicken Street · en pause — à rappeler` | `tag` | **codée en dur** (devrait dériver des clients en `Pause` — **à définir**) |
| `Tickets ouverts` | `2` | `Temps de réponse 42 min` | `bell` | **calculée** : tickets `statut ≠ "Résolu"` ; le temps de réponse est codé en dur |

Les sous-textes (`+14 %`, `+2 ce trimestre`, `3 démos`, `42 min`) sont statiques dans la maquette : leur calcul réel est **à définir**.

#### Carte « MRR · 6 derniers mois » (`flex: 1.3`, padding 18)

- Titre : `MRR · 6 derniers mois` — 17px, 800, margin `0 0 4px`.
- Sous-titre : `Objectif fin d'année : 2 500 €` — 13px, `#999`.
- Graphe (composant `BarChart`, margin-top 16) :
  - Données : `[320, 470, 620, 770, 940, 1115]` ; labels : `Mars, Avril, Mai, Juin, Juil., Août` ; hauteur **170px** ; couleur barres `#c9a15a`.
  - Format des valeurs au-dessus des barres : `(v/1000).toFixed(1) + "k"` → `0.3k`, `0.5k`, `0.6k`, `0.8k`, `0.9k`, `1.1k`.
  - Anatomie : conteneur flex aligné en bas, gap **10px** entre colonnes, chaque colonne `flex: 1` ; libellé valeur (12px, 600, `#999`) au-dessus ; barre `width: 100%`, hauteur `= (v / max) × (170 − 40)` px (max = 1115 → barre max 130px), `border-radius: 6px 6px 0 0`, `min-height: 4px` si v > 0 ; libellé mois (12px, 600, `#999`) en dessous.
  - **Micro-interaction** : `transition: height .4s ease` sur les barres (anime à l'apparition/changement de données).
  - Pas de tooltip, pas d'axe, pas d'état vide/chargement — **à définir**.

#### Carte « Activité récente » (`flex: 1`, padding 18)

- Titre : `Activité récente` — 17px, 800, margin `0 0 12px`.
- Liste (colonne, gap 10). Chaque ligne : flex gap 11, `padding: 9px 12px`, fond `#1a1a1a`, `border-radius: 10px` ; icône 16px `#c9a15a` ; texte 14px `flex:1` ; horodatage 12px `#999`. Contenu exact (texte / quand / icône) :
  1. `Pizza Vita a reçu le devis` / `Il y a 2 h` / `tag`
  2. `Le Comptoir Grec : matériel expédié` / `Il y a 5 h` / `box`
  3. `Démo confirmée — Smash Bros Burger` / `Hier` / `check`
  4. `Nouveau lead entrant — Chick & Go` / `Hier` / `bell`
  5. `O'Braise a renouvelé (Starter)` / `Il y a 2 j` / `euro`
- Liste statique (pas de flux temps réel, pas de lien vers l'objet concerné, pas de pagination) — **à définir**.

### 4.2 Pipeline commercial (`pipeline`)

**Layout** : padding 26, `overflow: auto` (la rangée de colonnes a `min-width: 1060px` → scroll horizontal si le cadre est réduit). Rangée : flex, gap **12**, `align-items: flex-start`, 5 colonnes `flex: 1`.

#### Étapes (ordre exact, machine à états linéaire)

| id | Libellé colonne |
|---|---|
| `contact` | `Contact entrant` |
| `demo` | `Démo planifiée` |
| `devis` | `Devis envoyé` |
| `onboarding` | `Onboarding` |
| `actif` | `Actif` |

#### Colonne

- Conteneur : fond `#111`, `border: 1px solid rgba(255,255,255,.1)`, `border-radius: 14px`, `overflow: hidden`.
- En-tête : `padding: 10px 13px`, `border-bottom: 1px solid rgba(255,255,255,.1)`, space-between :
  - libellé en gras 13.5px ;
  - **compteur** : pastille fond `#1a1a1a`, `border-radius: 999px`, `min-width: 22px`, hauteur **20px**, `padding: 0 7px`, 12px, 800, `#999` — nombre de leads de l'étape (mis à jour en direct).
- Corps : `padding: 10px`, colonne gap 10, `min-height: 120px`.
- **État vide** : texte `—` centré, `padding: 24px 0`, 13px, `#999`.

#### Carte lead (`.cf-card--soft`, padding 12)

De haut en bas :
1. Ligne titre : nom du resto en gras 14.5px ; ville à droite 12px `#999`.
2. Contact : 12.5px `#999`, margin-top 3.
3. Chips modules (flex wrap, gap 5, margin-top 8) : 10.5px, 700, `padding: 2px 8px`, `border-radius: 999px`, fond `#1a1a1a`, texte `#999`.
4. Note : 12.5px, `#999`, `line-height: 1.35`, margin-top 8.
5. Pied (space-between, margin-top 10) :
   - MRR potentiel : `{mrr} €/mois` en gras 14px couleur `#c9a15a` ;
   - si étape ≠ `actif` : bouton **`Avancer →`** (`.cf-btn--ink cf-btn--sm` : fond `#262626`, texte `#fff`, `padding: 9px 14px`, 12px, radius 50px ; hover `opacity: .85` ; active `translateY(1px)`) ;
   - si étape = `actif` : pill statut `ACTIF` (vert, voir §5.6).

#### Données seed (7 leads, exactes)

| id | resto | ville | contact | modules | mrr (€/mois) | stage | note |
|---|---|---|---|---|---|---|---|
| 1 | Chick & Go | Louviers | `S. Diallo · 06 41 —` | KDS, POS | 149 | contact | `Vu l'Instagram, veut une démo rapide` |
| 2 | La Broche Dorée | Elbeuf | `M. Aksoy · 07 82 —` | KDS, POS, Site | 249 | contact | `3 employés, gros volume kebab` |
| 3 | Smash Bros Burger | Rouen | `K. Lemaire · 06 12 —` | Pack Pro | 299 | demo | `Démo jeudi 15h sur place` |
| 4 | O'Tacos City | Vernon | `Y. Benali · 07 55 —` | KDS, Commande | 199 | demo | `Compare avec un concurrent` |
| 5 | Pizza Vita | Gisors | `A. Ricci · 06 30 —` | Pack Pro, RH | 329 | devis | `Devis envoyé le 4/08, relance J+7` |
| 6 | Le Comptoir Grec | Évreux | `N. Papas · 06 77 —` | POS, Site | 219 | onboarding | `Menu importé, matériel expédié` |
| 7 | Green House | Évreux | `L. Fontaine · 07 21 —` | Pack Pro | 299 | actif | `Client depuis mars` |

#### Comportement

- **`Avancer →`** : fait passer le lead à l'étape suivante (index +1, borné à la dernière étape). Re-render instantané, **aucune animation de déplacement** de carte.
- **Absent de la maquette, à définir** : drag & drop entre colonnes ; retour en arrière d'étape ; ouverture d'une fiche lead au clic sur la carte ; édition/suppression ; filtres/recherche/tri ; persistance (l'état est perdu au rechargement) ; conversion lead→client (avancer jusqu'à « Actif » ne crée pas de client).

### 4.3 Clients & onboarding (`clients`)

**Layout** : padding 26 ; grille `grid-template-columns: 1.5fr 1fr`, `gap: 16`, `align-items: start`. Gauche = table clients (sélectionnable) ; droite = fiche du client sélectionné.

**État local** : `sel` (index client sélectionné, **défaut 3 = Le Comptoir Grec**) ; `checks` (copie des tableaux `onboard` de chaque client, éditable par cases à cocher). Cet état est perdu en quittant la vue.

#### Table clients (carte `.cf-card--soft`, padding 0, overflow hidden)

- Ligne d'en-tête : `padding: 12px 18px`, fond `#1a1a1a`, 11px, 800, `letter-spacing: .08em`, uppercase, `#999`. Colonnes et largeurs :
  `Restaurant` (flex 1) · `Plan` (76px) · `Santé` (84px, centré) · `MRR` (80px, aligné droite) · `Statut` (104px, centré).
- Chaque ligne = `<button>` pleine largeur, `padding: 11px 18px`, `border-top: 1px solid rgba(255,255,255,.1)`, curseur pointer.
  - **Sélectionnée** : fond `#1a1a1a`. **Normale** : transparente. **Hover** : non défini — **à définir**.
  - Cellule Restaurant : pastille **30×30px** `border-radius: 8px`, fond = `accent` du client, initiale blanche 13px 800 ; puis nom 14.5px gras (bloc) + sous-ligne `"{ville} · depuis {depuis}"` 12px `#999`.
  - Cellule Plan : pill `PRO` (variante gold : fond `#c9a15a`, texte `#1C1612`) ou `STARTER` (pill par défaut : fond `#1a1a1a`, texte `#fff`) — 9px.
  - Cellule Santé : pill contour (`background: transparent; border: 1.5px solid <couleur>; color: <couleur>`, 9px) avec point « ● » :
    - statut `Actif` → `● Bonne`, couleur `#3fae4a` ;
    - statut `Onboarding` → `● Suivi`, couleur `#c9a15a` (`--cf-gold`) ;
    - autre (`Pause`) → `● À risque`, couleur `var(--cf-accent)` = `#c9a15a` sur cette surface. ⚠️ « Suivi » et « À risque » sont visuellement identiques ici ; en toute logique « À risque » devrait être rouge — **à définir**.
  - Cellule MRR : `"{mrr} €"` gras 14px, tabular-nums, aligné droite.
  - Cellule Statut : pill statut (voir §5.6) : `ACTIF` vert / `ONBOARDING` gold / `PAUSE` gris.

#### Données seed (6 clients, exactes)

| resto | ville | plan | modules | mrr | statut | depuis | accent | lettre | onboard (5 étapes) |
|---|---|---|---|---|---|---|---|---|---|
| Class'Food | Perriers-sur-Andelle | Pro | KDS, POS, BO, Commande, RH | 299 | Actif | `Janv. 2026` | `#C8281E` | C | ✓✓✓✓✓ |
| Green House | Évreux | Pro | KDS, POS, BO, Commande | 299 | Actif | `Mars 2026` | `#2F9E62` | G | ✓✓✓✓✓ |
| O'Braise | Rouen | Starter | KDS, POS | 149 | Actif | `Avril 2026` | `#E0762F` | O | ✓✓✓✓✓ |
| Le Comptoir Grec | Évreux | Pro | POS, BO, Site | 219 | Onboarding | `Août 2026` | `#3E6FB0` | C | ✓✓✗✗✗ |
| Sushi Kaito | Rouen | Starter | KDS, POS | 149 | Actif | `Mai 2026` | `#7A4FB0` | S | ✓✓✓✓✓ |
| Chicken Street | Le Havre | Pro | KDS, POS, BO, Commande | 299 | Pause | `Févr. 2026` | `#C99A2E` | C | ✓✓✓✓✓ |

NB : le champ `modules` des clients n'est **affiché nulle part** dans le CRM (utile au modèle de données ; affichage **à définir**).

#### Fiche client (carte droite, padding 18)

1. **En-tête** (flex gap 12) : pastille **44×44px** `border-radius: 11px` fond accent client, initiale blanche 19px 800 ; nom 17px gras ; sous-ligne `"{ville} · {plan} · {mrr} €/mois"` 13px `#999`.
2. Séparateur : trait 1px `rgba(255,255,255,.1)`, margin `14px 0`.
3. **Section « Thème marque blanche »** — eyebrow 11px `THÈME MARQUE BLANCHE`, puis rangée (gap 10, margin `8px 0 14px`) :
   - pastille couleur : cercle **26px**, fond accent client, `border: 2px solid rgba(255,255,255,.1)` ;
   - texte 13.5px `#999` : `Accent {hex} · logo « {lettre} » · couleurs fonctionnelles standard` (ex. `Accent #3E6FB0 · logo « C » · couleurs fonctionnelles standard`).
   - Lecture seule dans la maquette ; édition du thème tenant **à définir**.
4. **Section « Onboarding »** — eyebrow 11px `ONBOARDING`, puis checklist (colonne gap 8, margin-top 8). Étapes exactes (ordre fixe) :
   1. `Menu & prix importés`
   2. `Équipe & comptes créés`
   3. `Matériel installé (tablettes, imprimantes)`
   4. `Formation de l'équipe (1h)`
   5. `Mise en ligne commande + site`
   - Chaque étape = bouton (fond transparent, padding 0) : case **20×20px** `border-radius: 6px` ; cochée → fond et bordure `#3fae4a` + icône `check` 12px blanche trait 3 ; décochée → bordure `1.5px solid rgba(255,255,255,.1)`, fond transparent. Libellé 14px : blanc si coché, `#999` sinon (pas de barré).
   - **Clic = bascule** l'étape pour le client sélectionné (état local, non persisté, sans animation ni confirmation).
   - Le statut client ne change pas automatiquement quand tout est coché (règle « Onboarding → Actif » **à définir**).
5. Séparateur identique.
6. **Actions** (rangée gap 8) :
   - `Contacter` — `.cf-btn--ink cf-btn--sm`, icône `phone` 15px (fond `#262626`, texte blanc).
   - `Configurer` — `.cf-btn--ghost cf-btn--sm`, icône `gear` 15px (fond transparent, `border: 1px solid rgba(255,255,255,.1)`, texte blanc ; hover fond `rgba(255,255,255,.06)`).
   - **Aucune action câblée** pour les deux — **à définir**.

### 4.4 Facturation (`billing`)

**Layout** : padding 26 ; rangée de 3 KPI (gap 16, margin-bottom 16) ; table facturation.

#### KPI (libellés/valeurs exacts)

| Label | Valeur | Sous-texte | Icône | Origine |
|---|---|---|---|---|
| `MRR facturé` | `1115 €` | `6 abonnements actifs` | `euro` | valeur **calculée** (somme mrr hors `Pause`) ; ⚠️ le sous-texte dit « 6 » alors que 5 abonnements sont facturés et 1 suspendu — copy statique, à corriger/**à définir** |
| `Mise en place (one-shot)` | `1 490 €` | `2 installations en août` | `tag` | codée en dur |
| `Impayés` | `0 €` | `Tout est à jour ✓` | `check` | codée en dur |

#### Table (carte `.cf-card--soft`, padding 0)

- En-tête (mêmes styles que §4.3) : `Client` (flex 1) · `Plan` (90px) · `Mensuel` (100px, droite) · `Dernière facture` (130px, centré) · `Prochain débit` (120px, droite).
- Lignes (une par client, `padding: 12px 18px`, `border-top` 1px ; **non cliquables**, pas de hover) :
  - Client : pastille **26×26px** `border-radius: 7px` fond accent, initiale blanche 12px 800 + nom gras 14.5px.
  - Plan : pill `PRO` (gold) / `STARTER` (défaut), 9px.
  - Mensuel : `"{mrr} €"` gras 14.5px tabular-nums.
  - Dernière facture : pill statut — logique maquette : si l'abonnement est facturé (statut ≠ Pause) la pill affiche **`ACTIF`** (verte), sinon **`PAUSE`** (grise). ⚠️ Les libellés métier calculés en interne sont `Payée` / `Suspendu` mais la pill affiche « Actif »/« Pause » — libellés définitifs **à définir** (recommandé : « Payée » / « Suspendu »).
  - Prochain débit : 13.5px `#999` tabular-nums, aligné droite — `1 sept. 2026` pour tous les clients facturés, `—` pour `Pause`.
- **Absent, à définir** : détail/historique de factures, export, lien Stripe/PSP, actions (relancer un impayé, suspendre/réactiver), tri/filtres.

### 4.5 Support (`support`)

**Layout** : padding 26 ; table tickets + carte de réponse rapide (margin-top 14).

#### Table tickets (carte `.cf-card--soft`, padding 0)

- En-tête : `N°` (64px) · `Sujet` (flex 1) · `Restaurant` (130px) · `Priorité` (90px, centré) · `Statut` (100px, centré) · `Reçu` (110px, droite).
- Lignes : `padding: 13px 18px`, `border-top` 1px ; **`opacity: .55` si statut = « Résolu »** (seul état visuel différencié). Non cliquables (détail ticket **à définir**).
  - N° : gras 13.5px `#999` tabular-nums.
  - Sujet : gras 14.5px.
  - Restaurant : 13.5px.
  - Priorité : pill statut (`URGENT` rouge / `NORMAL` gold / `BAS` gris).
  - Statut : pill statut (`OUVERT` rouge / `EN COURS` gold / `RÉSOLU` vert).
  - Reçu : 13px `#999`, droite.

#### Données seed (4 tickets, exactes)

| id | resto | sujet | prio | statut | quand |
|---|---|---|---|---|---|
| T-231 | O'Braise | `L'imprimante sticker ne répond plus` | Urgent | Ouvert | `Il y a 25 min` |
| T-230 | Green House | `Ajouter un 2e écran cuisine` | Normal | En cours | `Il y a 3 h` |
| T-229 | Class'Food | `Modifier les créneaux du dimanche` | Normal | Résolu | `Hier` |
| T-228 | Sushi Kaito | `Question sur l'export comptable` | Bas | Résolu | `Il y a 2 j` |

#### Carte réponse rapide (padding 16, flex gap 10)

- Input `.cf-input` (`flex: 1`) : placeholder exact `Répondre à O'Braise sur T-231…` ; style : 15px, `padding: 12px 14px`, fond `rgba(255,255,255,.05)`, `border: 1px solid rgba(255,255,255,.06)`, `border-radius: 10px` ; focus : `border-color: #c9a15a` (transition `border-color .12s`) ; caret `#c9a15a` ; placeholder ≈ `#999` à 75 % d'opacité.
- Bouton `Envoyer` : `.cf-btn--primary` taille normale (`padding: 13px 20px`, 14px), icône `arrow` 18px, fond `#c9a15a`, texte `#0a0b0d` (forcé inline).
- **Aucune action câblée** (envoi, fil de conversation, ciblage du ticket : **à définir** — le placeholder cible T-231 en dur).

---

## 5. Inventaire des composants et états

### 5.1 `Icon` (SVG stroke)

- SVG 24×24, `fill: none` (par défaut), `stroke` = couleur passée (défaut `currentColor`), `stroke-width` défaut 2, `stroke-linecap/linejoin: round`, `aria-hidden="true"`.
- Chemins exacts utilisés par le CRM (`d` du `<path>`) :

| nom | path |
|---|---|
| `home` | `M4 11l8-7 8 7M6 10v9h12v-9` |
| `arrow` | `M5 12h14M13 6l6 6-6 6` |
| `user` | `M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0` |
| `euro` | `M15 7a5 5 0 100 10M6 10h7M6 14h7` |
| `bell` | `M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6zM10 21a2 2 0 004 0` |
| `check` | `M5 13l4 4L19 7` |
| `tag` | `M4 4h7l9 9-7 7-9-9V4zM8 8h.01` |
| `box` | `M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10` |
| `gear` | `M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13l1.5 1-2 3.5-1.8-.6a6.5 6.5 0 01-1.7 1l-.4 1.9h-4l-.4-1.9a6.5 6.5 0 01-1.7-1l-1.8.6-2-3.5 1.5-1a6.6 6.6 0 010-2l-1.5-1 2-3.5 1.8.6a6.5 6.5 0 011.7-1L10 3h4l.4 1.9a6.5 6.5 0 011.7 1l1.8-.6 2 3.5-1.5 1a6.6 6.6 0 010 2z` |
| `phone` | `M4 5c0 9 6 15 15 15l1-4-5-2-2 2a11 11 0 01-5-5l2-2-2-5L4 5z` |
| `plus` | `M12 5v14M5 12h14` |

### 5.2 `Btn` (`.cf-btn` + variantes)

Base effective : inline-flex centré, gap 9, Inter 600, 14px, `letter-spacing: -0.2px`, pas d'uppercase, `padding: 13px 20px`, `border-radius: 50px`, sans bordure, `white-space: nowrap`, `transition: opacity .2s, transform .12s`.

| Variante | Normal | Hover | Actif (pressé) | Désactivé |
|---|---|---|---|---|
| `primary` | fond `#c9a15a`, texte `--cf-on-accent` (`#0a0b0d` ; le CRM le force aussi inline) | `opacity: .85` (pas de lift, pas de filter) | `translateY(1px)` | `opacity: .4; cursor: not-allowed` (défini au DS, non utilisé dans le CRM) |
| `ink` | fond `#262626`, texte `#fff` | `opacity: .85` | `translateY(1px)` | idem |
| `ghost` | fond transparent, texte `#fff`, `border: 1px solid rgba(255,255,255,.1)`, padding `11px 18px` | fond `rgba(255,255,255,.06)`, `opacity: 1` | `translateY(1px)` | idem |
| taille `sm` | `padding: 9px 14px`, `font-size: 12px`, icônes 15px | — | — | — |

États chargement (spinner) : **absents — à définir**.

### 5.3 Pastille avatar (initiale sur accent)

Utilisée pour logo SM (30px, r9), lignes clients (30px, r8), fiche client (44px, r11), facturation (26px, r7), avatar admin (34px, cercle, fond `#1a1a1a`, lettre accent). Lettre : Inter 800, blanche (sauf logo SM et admin), taille ≈ 43–50 % du côté. Le fond = couleur d'accent du tenant (donnée). Fallback sans accent défini : **à définir**.

### 5.4 `Pill` (`.cf-pill`)

Base effective : inline-flex, gap 5, Inter **600**, uppercase, `letter-spacing: .06em`, `padding: 4px 9px`, `border-radius: 999px`, fond `#1a1a1a`, texte `#fff`, `font-size: 10px` (le CRM force 9px sur les pills Plan et Statut).
- `cf-pill--gold` : fond `#c9a15a`, texte `#1C1612` (utilisée pour `PRO`).
- Pills « santé » : variante contour construite inline — fond transparent, `border: 1.5px solid <c>`, texte `<c>`, préfixe `● `.

### 5.5 Chip module (pipeline)

Span inline : 10.5px, 700, `padding: 2px 8px`, `border-radius: 999px`, fond `#1a1a1a`, texte `#999`. Non interactive. Valeurs observées : `KDS`, `POS`, `Site`, `Commande`, `RH`, `BO`, `Pack Pro`.

### 5.6 `StatusPill` (pill de statut sémantique)

Pill 9px dont le fond dépend du libellé (mapping exact ; texte `#0a0b0d` si fond gold, sinon `#fff`) :

| Libellé | Fond | Sémantique |
|---|---|---|
| `Actif`, `Résolu` | `#3fae4a` (vert) | positif / terminé |
| `Onboarding`, `En cours`, `Normal` | `#c9a15a` (`--cf-gold`) | intermédiaire / attente |
| `Ouvert`, `Urgent` | `#c94b3f` (rouge) | alerte |
| `Pause`, `Bas` | `#999` (gris) | inactif / faible |
| autre | `#999` | fallback |

⚠️ Le DS réserve l'ambre `#e0973f` aux états « attente/prépa » ; le CRM utilise `--cf-gold` (`#c9a15a`) à la place. Choix définitif **à définir** (recommandé : conserver la règle DS vert/rouge/ambre, fixes tous tenants).

### 5.7 Cartes (`.cf-card--soft`)

Fond `linear-gradient(180deg, rgba(17,17,17,.9), #111)`, `border: 1px solid rgba(255,255,255,.06)`, `border-radius: 16px`, ombre `0 1px 0 rgba(0,0,0,.3), 0 10px 26px rgba(0,0,0,.32)`. Pas d'état hover (l'effet « spotlight » `.sm-spot` du DS n'est pas utilisé dans le CRM).

### 5.8 Tables « maison »

Pas de `<table>` : lignes flex avec largeurs de colonnes fixes (voir chaque vue). En-tête : fond `#1a1a1a`, 11px 800 uppercase `letter-spacing: .08em` `#999`, `padding: 12px 18px`. Lignes séparées par `border-top: 1px solid rgba(255,255,255,.1)`. Hover de ligne : **non défini** (le DS propose `.sm-table tr:hover td { background: rgba(255,255,255,.03) }`, non branché ici) — **à définir**. Tri, pagination, états vide/chargement/erreur : **à définir**.

### 5.9 Checkbox onboarding

20×20px, `border-radius: 6px`. Cochée : fond + bordure `#3fae4a`, check blanc 12px trait 3. Décochée : `border: 1.5px solid rgba(255,255,255,.1)`, fond transparent. Pas d'état indéterminé, pas d'animation de coche — **à définir**.

### 5.10 Input (`.cf-input`)

Voir §4.5. États erreur/désactivé : **à définir** (non stylés dans la maquette).

### 5.11 Composants disponibles dans le kit mais non utilisés par le CRM

`useToasts` (toasts bas de page, fond `--cf-ink`, apparition `.cf-anim-pop` `scale .9→1` en `.18s ease`, auto-dismiss 2200 ms), `useElapsed` (minuteur mm:ss), `Stepper`, `Stars`, `Sticker`, `Price`, points pulsés `.sm-dot--pulse` (keyframes `smPulse` 2s), toggle `.sm-toggle` (46×26, pouce 20px, transition `.2s`). Utilisables en prod pour les confirmations d'action (ex. envoi de réponse support) — usage **à définir**.

---

## 6. Interactions & micro-interactions (récapitulatif)

### 6.1 Présentes dans la maquette

| Interaction | Détail | Timing |
|---|---|---|
| Navigation sidebar | remplacement de vue instantané, état actif accent | aucun |
| `Avancer →` (pipeline) | lead passe à l'étape suivante (borné) ; compteurs de colonnes et KPI « Leads en cours » se mettent à jour en direct | re-render instantané, sans animation |
| Sélection ligne client | fond de ligne `#1a1a1a`, fiche droite mise à jour | instantané |
| Bascule étape onboarding | coche/décoche, état local par client | instantané |
| Hover boutons `.cf-btn` | `opacity: .85` | `.2s` |
| Press boutons | `translateY(1px)` | `.12s` |
| Hover bouton ghost | fond `rgba(255,255,255,.06)` | `.2s` |
| Hover `.cf-iconbtn` | bordure `rgba(255,255,255,.5)` | `.12s` |
| Focus input | bordure `#c9a15a` | `.12s` |
| Barres du graphe MRR | `transition: height .4s ease` | `.4s` |
| Focus clavier | `outline: 2px solid #c9a15a, offset 2px` | — |
| Scrollbar hover | pouce `rgba(201,161,90,.5)` | — |
| `prefers-reduced-motion: reduce` | toutes animations/transitions ramenées à `.01ms` (règle globale de la page) | — |

### 6.2 Absentes de la maquette — à définir

- **Drag & drop** des cartes du pipeline (seul le bouton « Avancer → » existe).
- **Sons** : aucun sur cette surface.
- **Minuteurs** : aucun (les horodatages « Il y a 25 min », « Hier »… sont des chaînes statiques ; rafraîchissement relatif à définir).
- Toasts/confirmations, transitions de vue, skeletons/spinners de chargement, états d'erreur réseau, tooltips (graphe et ailleurs), recherche globale, raccourcis clavier, menus contextuels, tri/filtres/pagination des tables, temps réel (websocket) sur tickets/activité.

---

## 7. Données par vue, API et modèle MongoDB

### 7.1 Lectures / écritures par vue (constat maquette)

| Vue | Lit | Écrit (maquette) | Écrit (cible prod) |
|---|---|---|---|
| Tableau de bord | clients (mrr, statut), leads (stage), tickets (statut), série MRR 6 mois, activités récentes, KPI dérivés | rien | rien (lecture seule) |
| Pipeline | leads (tous champs), étapes | `lead.stage` (mémoire seulement) | `PATCH lead.stage` + entrée d'historique |
| Clients & onboarding | clients (tous champs), étapes d'onboarding, thème tenant | cases `onboard[i]` (mémoire seulement) | `PATCH client.onboarding[i].done` |
| Facturation | clients + champs facturation dérivés (`prochain débit`, `dernière facture`), KPI one-shot/impayés | rien | à définir (actions facturation absentes) |
| Support | tickets (tous champs) | rien (input non câblé) | `POST` message de réponse sur un ticket |
| Global (header/sidebar) | compteur tickets ouverts, identité utilisateur (Admin SM · Fondateur) | rien | création de lead (« Nouveau lead ») |

Constats structurants pour l'API :
- Toutes les valeurs agrégées affichées (MRR = 1115 €, clients actifs = 4, leads en cours = 6, tickets ouverts = 2) sont **dérivées** des collections — à calculer côté serveur (endpoint dashboard) ou par agrégation, pas à stocker.
- Plusieurs libellés sont aujourd'hui codés en dur et devront devenir des données : « ▲ +14 % vs juillet », « +2 ce trimestre », « 3 démos cette semaine », « Risque churn 1 / Chicken Street », « Temps de réponse 42 min », « Mise en place 1 490 € », « 2 installations en août », « Impayés 0 € », « 1 sept. 2026 », les horodatages relatifs et le flux d'activité.
- Aucune persistance dans la maquette (pas d'appel réseau, pas de `localStorage` sur cette page). `fmtEuro` est importé mais non utilisé : les montants sont affichés `"{n} €"` sans décimales ni séparateur de milliers (`1115 €`) — **règle de formatage monétaire prod à définir** (le sous-titre du graphe écrit « 2 500 € » avec espace fine).

### 7.2 Proposition d'API (dérivée de la maquette — à valider)

```
GET  /api/crm/dashboard            → { kpis, mrrSeries[6], activity[] }
GET  /api/crm/leads                → Lead[]
POST /api/crm/leads                → création (bouton « Nouveau lead »)
PATCH /api/crm/leads/:id/stage     → { stage }  (bouton « Avancer → », futur drag & drop)
GET  /api/crm/clients              → Client[]
PATCH /api/crm/clients/:id/onboarding → { stepIndex, done }
GET  /api/crm/billing              → { kpis, rows[] }
GET  /api/crm/tickets              → Ticket[]
POST /api/crm/tickets/:id/replies  → { text }   (carte « Envoyer »)
```

### 7.3 Proposition de collections MongoDB (champs calqués sur les formes mock)

> Le CRM est une surface **HQ trans-tenant** : il lit/écrit sur l'ensemble des tenants. `tenantId` référence la collection des restaurants clients.

```js
// leads — pipeline commercial
{
  _id, resto: "Chick & Go", ville: "Louviers",
  contact: { nom: "S. Diallo", tel: "06 41 …" },     // affiché "S. Diallo · 06 41 —"
  modules: ["KDS","POS"],                             // valeurs vues : KDS, POS, BO, Site, Commande, RH, Pack Pro
  mrrPotentiel: 149,                                  // €/mois
  stage: "contact",                                   // enum: contact|demo|devis|onboarding|actif
  note: "Vu l'Instagram, veut une démo rapide",
  relances: [ { date, sequence: "A"|"B"|"C", canal: "sms"|"email"|"appel", message: "A1", reponse } ], // cf. §8.1
  createdAt, updatedAt, stageHistory: [{ stage, at }]
}

// clients (tenants) — fiches resto
{
  _id, resto: "Le Comptoir Grec", ville: "Évreux",
  plan: "Pro"|"Starter",
  modules: ["POS","BO","Site"],
  mrr: 219,
  statut: "Actif"|"Onboarding"|"Pause",
  depuis: ISODate,                                    // affiché "Août 2026"
  theme: { accent: "#3E6FB0", letter: "C" },          // marque grise ; fonctionnelles NON stockées (fixes)
  onboarding: [ { step: 0..4, done: Boolean, at } ],  // 5 étapes fixes, libellés côté front (§4.3)
  leadId                                              // origine pipeline — lien à définir
}

// tickets — support
{
  _id: "T-231", tenantId, sujet: "L'imprimante sticker ne répond plus",
  prio: "Urgent"|"Normal"|"Bas",
  statut: "Ouvert"|"En cours"|"Résolu",
  createdAt,                                          // affiché relatif ("Il y a 25 min")
  replies: [{ author, text, at }]                     // à définir (absent maquette)
}

// activities — flux « Activité récente »
{ _id, type: "devis"|"materiel"|"demo"|"lead"|"renouvellement", texte, icone, refType, refId, at }

// billing — à définir (la maquette dérive tout des clients :
//   prochainDebit = "1 sept. 2026" si statut ≠ Pause sinon "—",
//   derniereFacture = "Payée" si statut ≠ Pause sinon "Suspendu").
// Prévoir : invoices { tenantId, montant, statut, dueAt, paidAt }, oneShots (installations).

// metrics — série MRR mensuelle (le graphe lit 6 points)
{ mois: "2026-08", mrr: 1115 }

// users (HQ) — { nom: "Admin SM", role: "Fondateur", initiale: "A" }
```

---

## 8. Éléments demandés absents de la maquette CRM

### 8.1 Suivi des relances (séquences A/B/C)

**Aucune UI de relance n'existe dans la maquette CRM.** Les séquences sont définies dans un document statique de la suite : `SM - Séquences de Relance.html` (« Séquences de relance SMS & email »). Points structurants pour le CRM :

- **Séquence A — après la démo** : A1 = SMS le soir même (21h30–22h) ; A2 = appel à J+3 ; A3 = SMS à J+10 (dernier avant pause). Après A3 sans réponse : pause 30 jours puis passage en séquence C. Règle : jamais plus de deux relances sur la même proposition.
- **Séquence B — après une visite sans démo** : B1 = SMS le lendemain (14h30–16h) proposant 2 créneaux de démo ; B2 = SMS à J+7 (preuve sociale locale).
- **Séquence C — nurture long** : 1 email par mois pour tous les prospects en pause (formats C1/C2/C3 : un chiffre + une leçon + une porte ouverte ; désinscription « répondez stop »).
- **Règles d'envoi** : horaires SMS 14h30–16h30 ou 21h30–22h (jamais pendant un service) ; personnalisation obligatoire (un message non personnalisé ne part pas) ; une seule question par message ; stop immédiat en cas de « pas intéressé » ; **traçage : « Chaque envoi noté dans le CRM (back-office SM · pipeline) : date, séquence, réponse »** — c'est la seule exigence explicite liant les relances au CRM.
- Cadre légal B2B France rappelé dans le document (prospection pro sans opt-in si lien avec l'activité + moyen de désinscription).

**À définir pour la prod** : UI de suivi (sur la carte lead du pipeline et/ou une fiche lead), rappels/échéances (J+3, J+10, pause 30 j), champ `relances[]` du modèle (proposé §7.3), automatisation éventuelle des envois. La note libre du lead (`"Devis envoyé le 4/08, relance J+7"`) montre que la maquette gère aujourd'hui cela en texte libre.

### 8.2 Compteur de places fondateur

**Absent de la maquette CRM.** Le programme existe dans les documents statiques : `SM - Dossier Fondateur.html` (« L'offre fondateur : 10 places à tarif préférentiel à vie ») et les messages de relance y font référence (« place fondateur n° [X] encore libre », « il reste [X] places sur les 10 »). Aucune donnée, aucun composant ni aucun écran du CRM ne matérialise ce compteur.
**À définir** : emplacement (Tableau de bord probable), source de vérité (10 − clients signés en offre fondateur), affichage et règles (décrément à la signature).

### 8.3 Autres absences notables (récapitulatif « à définir »)

Création/édition/suppression de lead ; fiche lead détaillée ; conversion lead→client ; retour d'étape ; drag & drop ; recherche/filtres/tri/pagination ; hover des lignes ; détail client complet (au-delà de la fiche latérale) ; édition du thème tenant ; actions « Contacter » / « Configurer » ; notifications (cloche) ; réglages (gear) ; détail/actions de facturation ; fil de conversation ticket + envoi ; état vide de chaque table ; états chargement/erreur ; formatage des dates/montants ; routage URL ; responsive ; authentification/permissions ; temps réel.

---

## 9. Annexe — copy exact (chaînes affichées, par zone)

**Chrome** : `hq.snackmanager.fr`.
**Sidebar** : `Snack Manager` · `Interne · HQ` · `Tableau de bord` · `Pipeline` · `Clients` · `Facturation` · `Support` · badge `2` · `Admin SM` · `Fondateur`.
**Header** : `Tableau de bord` / `Pipeline commercial` / `Clients & onboarding` / `Facturation` / `Support` · `Mardi 11 août 2026 · interne Snack Manager` · `Nouveau lead`.
**Tableau de bord** : `MRR` · `1115 €` · `▲ +14 % vs juillet` · `Clients actifs` · `4` · `▲ +2 ce trimestre` · `Leads en cours` · `6` · `3 démos cette semaine` · `Risque churn` · `1` · `Chicken Street · en pause — à rappeler` · `Tickets ouverts` · `2` · `Temps de réponse 42 min` · `MRR · 6 derniers mois` · `Objectif fin d'année : 2 500 €` · `0.3k 0.5k 0.6k 0.8k 0.9k 1.1k` · `Mars Avril Mai Juin Juil. Août` · `Activité récente` · `Pizza Vita a reçu le devis` (`Il y a 2 h`) · `Le Comptoir Grec : matériel expédié` (`Il y a 5 h`) · `Démo confirmée — Smash Bros Burger` (`Hier`) · `Nouveau lead entrant — Chick & Go` (`Hier`) · `O'Braise a renouvelé (Starter)` (`Il y a 2 j`).
**Pipeline** : `Contact entrant` · `Démo planifiée` · `Devis envoyé` · `Onboarding` · `Actif` · `Avancer →` · `—` (colonne vide) · `{n} €/mois` · données leads du §4.2.
**Clients** : `Restaurant` · `Plan` · `Santé` · `MRR` · `Statut` · `● Bonne` · `● Suivi` · `● À risque` · `Pro` · `Starter` · `Actif` · `Onboarding` · `Pause` · `{ville} · depuis {depuis}` · `Thème marque blanche` · `Accent {hex} · logo « {lettre} » · couleurs fonctionnelles standard` · `Onboarding` · `Menu & prix importés` · `Équipe & comptes créés` · `Matériel installé (tablettes, imprimantes)` · `Formation de l'équipe (1h)` · `Mise en ligne commande + site` · `Contacter` · `Configurer` · `{ville} · {plan} · {mrr} €/mois`.
**Facturation** : `MRR facturé` · `1115 €` · `6 abonnements actifs` · `Mise en place (one-shot)` · `1 490 €` · `2 installations en août` · `Impayés` · `0 €` · `Tout est à jour ✓` · `Client` · `Plan` · `Mensuel` · `Dernière facture` · `Prochain débit` · `1 sept. 2026` · `—`.
**Support** : `N°` · `Sujet` · `Restaurant` · `Priorité` · `Statut` · `Reçu` · tickets du §4.5 · `Urgent` · `Normal` · `Bas` · `Ouvert` · `En cours` · `Résolu` · `Répondre à O'Braise sur T-231…` · `Envoyer`.
