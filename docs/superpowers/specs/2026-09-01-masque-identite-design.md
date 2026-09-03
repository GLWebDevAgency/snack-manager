# Le masque d'identité — un restaurant, sa marque, notre squelette

*Spec de conception · 1er septembre 2026 · approche A validée*

## 1 · La décision, et ce qu'elle renverse

Jusqu'ici la doctrine était écrite dans `globals.css` : *« SEUL `--cf-accent` change par tenant »*. Un logo, une couleur d'accent, et tout le reste porte la marque grise de Snack Manager. Le tenant ne stocke que `logoUrl` et `brandColor`.

Cette spec la renverse pour les **surfaces que voit le client** : vitrine, commande en ligne, carte de fidélité, suivi de commande. Là, le restaurant porte *sa* marque — palette complète, typographie, forme, mouvement, logos, photo. Le squelette (mise en page, parcours, composants) reste le nôtre : c'est ce qui garantit que le résultat est beau quel que soit le restaurateur.

Trois décisions cadrent tout le reste :

| Question | Décision | Pourquoi |
|---|---|---|
| Jusqu'où va le masque ? | **L'identité**, pas la composition | Shopify, Square, Toast donnent la main sur la marque, pas sur la structure. La liberté totale produit du laid. |
| Sur quelles surfaces ? | **Client uniquement** | Les outils du personnel (POS, KDS, admin) gardent Snack Manager, avec logo + accent comme aujourd'hui. Un seul mécanisme de thème, une expérience cohérente d'un restaurant à l'autre pour le personnel. |
| Qui compose ? | **Nous à l'installation, lui ensuite** | Cohérent avec « on pose tout sur place ». Le restaurateur ajuste dans son admin, à l'intérieur de garde-fous. |

Une exigence supplémentaire, posée après coup : **reprendre l'identité existante d'un restaurant** est un cas de première classe, pas une exception — d'où « palette depuis le logo » (§6.3).

## 2 · Périmètre

**Dedans.** Le sous-document `brand` sur le tenant et son contrat. La résolution `resoudreMarque` et les jetons `--m-*`. Le passage des surfaces client aux classes sémantiques. Six directions artistiques. L'éditeur, monté deux fois. La reprise des tenants existants. Les tests, dont la matrice de captures.

**Dehors — chantiers suivants, dans l'ordre.**
- **Chantier 2 — la fidélité premium** : micro-interactions, icônes SVG animées, célébrations de palier. Elle lit le profil de mouvement du masque ; elle se construit *après* ce socle.
- **Chantier 3 — la composition du site vitrine** : sections activables et réordonnables. Hérite du masque.
- Les écrans TV (`board`) gardent leur `theme: brand | dark | light` ; ils adopteront le masque plus tard.
- Le ticket ESC/POS reste texte — il n'a pas de couleur.

## 3 · Les données — l'objet `brand`

Sur `TenantSchema`, un sous-document :

```ts
brand: {
  mode:    'light' | 'dark',                 // le fond de base
  palette: {                                 // CINQ hex, rien de plus
    ground:   string,                        // fond de page
    surface:  string,                        // cartes, panneaux
    ink:      string,                        // texte principal
    accent:   string,                        // action, lien, prix
    onAccent: string,                        // texte posé sur l'accent
  },
  type:    { pair: TypePairKey },            // clé d'une paire curatée (§5.2)
  shape:   'net' | 'doux' | 'rond',          // l'échelle de rayons
  motion:  'pose' | 'vif',                   // le profil de mouvement
  logo: {
    mark:   { light: string | null, dark: string | null },   // carré
    lockup: { light: string | null, dark: string | null },   // horizontal
  },
  hero:    string | null,                    // photo d'accueil
  preset:  PresetKey | null,                 // d'où l'on est parti
}
```

**Pourquoi cinq rôles seulement.** Un restaurateur sait choisir un fond, un texte, un accent. Encre atténuée, filets, surface secondaire, survol, teintes des états : tout cela se **calcule** (§4.1), jamais stocké. L'éditeur reste à cinq sélecteurs, la cohérence est mécanique.

**Le logo en quatre déclinaisons** parce qu'un logo pensé pour fond clair meurt sur fond sombre, et que la carte de fidélité, le suivi et la vitrine n'ont pas toujours le même fond. Une déclinaison manquante retombe sur l'autre du même format ; un format manquant retombe sur l'autre format.

**Le contrat.** `BrandSchema` (zod) dans `packages/contracts/src/tenant.ts`, avec `PresetKey`, `TypePairKey`, et la validation : hex à six chiffres, URL d'image internes. Les charges publiques qui portaient `brandColor` + `logoUrl` — carte publique (`ordering.ts`), fidélité (`loyalty-public.ts`, `loyalty.ts`), suivi — portent désormais `brand: Brand` **en plus**. Les deux champs plats **restent** partout, dérivés à la lecture : `brandColor = brand.palette.accent`, `logoUrl = brand.logo.mark.dark ?? brand.logo.mark.light`. C'est le contrat « logo + accent » des outils du personnel (`devices.ts`), et il ne bouge pas.

**Nullable pendant la transition.** `brand` est `null` tant que le tenant n'a pas été repris (§8). Le résolveur sait travailler sans lui.

## 4 · La résolution — de cinq couleurs à un masque

### 4.1 · `resoudreMarque(brand): Jetons`

Une fonction **pure** dans `packages/client-core`, sans dépendance au DOM, testable en vitest. Elle rend un objet de jetons nommés, que le web sérialise en variables CSS `--m-*`.

Dérivés depuis les cinq rôles et le mode :

| Jeton | Dérivation | Garde |
|---|---|---|
| `inkSoft` | `ink` mêlé 25 % vers `ground` | — |
| `inkMut` | `ink` mêlé 50 % vers `ground` | ramené jusqu'à AA 4,5:1 sur `ground` |
| `rule` / `ruleFirm` | `ink` à 12 % / 24 % sur `ground` | — |
| `surface2` | `surface` mêlé 4 % vers `ink` | — |
| `accentHover` | `accent` éclairci 8 % (sombre) ou assombri 8 % (clair) | — |
| `accentInk` | `accent` ajusté jusqu'à AA 4,5:1 sur `ground` | **c'est lui que porte tout accent utilisé comme texte** — un safran clair reste un beau bouton, il ne devient jamais un lien illisible |
| `accentWash` | `accent` à 12 % sur `ground` | — |
| `focus` | anneau `accent` à 60 % | — |
| `ok` / `warn` / `stop` + leurs `wash` | fixes par mode, légèrement teintés vers `ink` | les couleurs sémantiques ne sont **pas** de la marque — un « payé » est vert chez tout le monde |
| `shadow` | par mode | — |

Puis :
- **`type.pair`** → familles display / body / mono, URL Google Fonts (`display=swap`), piles de repli déclarées, et `prixMono: boolean` (certaines paires posent les prix en mono).
- **`shape`** → `radiusSm / Md / Lg / Pill` : net `2 / 4 / 6 / 999`, doux `6 / 10 / 14 / 999`, rond `12 / 18 / 24 / 999`.
- **`motion`** → `durBase / durIn / durFete`, `ease` : posé `240 / 320 / 900 ms`, `cubic-bezier(.2,.8,.2,1)` ; vif `140 / 200 / 600 ms`, `cubic-bezier(.3,1.4,.4,1)` (léger dépassement). Toujours écrasé par `prefers-reduced-motion`.

### 4.2 · `contraste(brand): Verdicts`

Même module. Rend les cinq couples critiques avec leur ratio et leur verdict AA : `ink/ground`, `ink/surface`, `onAccent/accent`, `accentInk/ground`, `inkMut/ground`. Et pour chaque échec, **la nuance la plus proche qui passe** — c'est ce que l'éditeur propose en un clic (§6.4) et ce que l'API exige (§6.5).

### 4.3 · Deux espaces de noms, volontairement

- `--cf-*` reste **Snack Manager** : admin, CRM `/sm`, site public `(marketing)`. Rien n'y change.
- `--m-*` est **le masque** : injecté par les layouts de `/r/[slug]`, `/embed/[slug]`, `/t/[id]` et `/r/[slug]/fidelite`.

Tailwind mappe le masque en utilitaires sémantiques, dans `globals.css` à côté des `--color-*` existants :

`bg-ground · bg-surface · bg-surface2 · text-ink · text-ink-soft · text-ink-mut · bg-accent · text-onaccent · text-accent-ink · bg-accent-wash · border-rule · border-rule-firm · rounded-sm/md/lg/pill · font-display · font-body · font-mono · duration-base/in/fete · ease-m`

### 4.4 · La discipline qui rend le masque total

Dans les répertoires client — `app/r/**`, `app/embed/**`, `app/t/**`, `components/order/**` — **aucune couleur brute** : ni `bg-[#…]`, ni `text-white`, ni `bg-black`, ni `text-neutral-*`. Un test le garantit (§9). C'est le vrai chantier de cette spec : repasser le storefront, le suivi et la carte de fidélité en sémantique.

### 4.5 · La PWA de fidélité

`/r/[slug]/fidelite` est une application installable. Son `manifest.webmanifest` et son `icon.svg` sont des routes : elles lisent le masque — `theme_color = ground`, `background_color = ground`, icône = `logo.mark` sur `ground`. L'icône sur l'écran d'accueil du client est celle du restaurant, pas la nôtre.

## 5 · Six directions artistiques

Une direction n'est pas une palette : c'est un objet `brand` **complet** — palette, paire, forme, mouvement — avec un point de vue et un traitement de photo suggéré. Dessinées par nous, elles passent AA (test, §9), et sont capturées en référence (matrice, §9).

### 5.1 · Les directions

| Clé | Nom | Pour qui | Mode | Fond · surface · encre · accent · sur-accent | Paire | Forme · mouvement |
|---|---|---|---|---|---|---|
| `brasserie` | **Brasserie** | classe, terroir | clair | `#F5EFE3 · #FFFDF8 · #1F1A17 · #7A2E2A · #FFF8F0` | `brasserie` | net · posé |
| `neon` | **Néon** | street food moderne | sombre | `#0E1016 · #171A23 · #F3F1EC · #D8F04A · #0E1016` | `neon` | rond · vif |
| `atelier` | **Atelier** | artisan, fait maison | clair | `#F7F3EC · #FFFFFF · #2B2B2B · #A8482A · #FFF4EC` | `atelier` | doux · posé |
| `marche` | **Marché** | frais, healthy | clair | `#FFFFFF · #F4F8F4 · #1E4D2B · #23843F · #FFFFFF` | `marche` | rond · vif |
| `nuit` | **Nuit** | premium sombre | sombre | `#14151A · #1D1F26 · #F0EBE1 · #C9A15A · #1C1612` | `nuit` | net · posé |
| `soleil` | **Soleil** | méditerranéen | clair | `#F6EBD9 · #FFF9F0 · #1B2A4A · #E07A1F · #1B1206` | `soleil` | doux · vif |

**Nuit** est la plus proche de l'identité Snack Manager actuelle : c'est la direction par défaut de la reprise (§8). **Soleil** illustre pourquoi `accentInk` existe : le safran est un bouton superbe et un lien illisible — le résolveur tranche.

Traitement de photo suggéré par direction (un simple filtre CSS sur le héros, désactivable) : Brasserie et Nuit — contraste doux, légère désaturation ; Néon — saturation poussée ; Atelier et Soleil — chaleur ; Marché — nu.

### 5.2 · Les paires typographiques curatées

Dix paires, toutes sur Google Fonts, chacune avec piles de repli. Le restaurateur choisit dans cette liste, jamais une police libre.

| Clé | Display | Corps | Prix en mono |
|---|---|---|---|
| `brasserie` | Fraunces | Source Sans 3 | non |
| `neon` | Bricolage Grotesque | Archivo | non |
| `atelier` | Alegreya Sans | Alegreya Sans | **oui** — JetBrains Mono |
| `marche` | Outfit | Manrope | non |
| `nuit` | Cormorant Garamond | Figtree | non |
| `soleil` | Nunito | Nunito Sans | non |
| `editorial` | Playfair Display | Source Sans 3 | non |
| `moderne` | Familjen Grotesk | Instrument Sans | non |
| `classique` | Libre Baskerville | Lato | non |
| `brut` | Archivo Black | Archivo | **oui** — JetBrains Mono |

## 6 · L'éditeur

### 6.1 · Un composant, deux montages

`EditeurDeMarque` vit dans `apps/web/src/components/brand/`. Il est monté :
- dans **`/sm/clients/[id]`**, section « Identité » — pour nous, à l'installation ;
- dans **`/admin/identite`**, nouvelle entrée de navigation « Votre identité », placée à côté de « Votre site web » — pour le restaurateur.

Même composant, même aperçu, mêmes garde-fous. Seule la route d'enregistrement diffère (§6.5).

### 6.2 · La disposition

À gauche, les commandes dans l'ordre naturel de la décision :

1. **Palette depuis le logo** — le premier bouton (§6.3)
2. **Direction** — galerie des six, en vignettes rendues (pas des noms)
3. **Les cinq rôles** — cinq sélecteurs, avec le verdict AA en direct
4. **Typographie** — la liste des dix paires, chacune rendue dans sa propre police
5. **Forme** et **mouvement** — deux segments à trois et deux positions
6. **Logos** — quatre dépôts, avec l'aperçu de chacun sur son fond
7. **Photo d'accueil**

À droite, **un aperçu vivant** : trois surfaces réelles — en-tête de vitrine avec le héros, une carte produit, la carte de fidélité — rendues avec les **vrais composants** et le brouillon de jetons. Pas une maquette : le résultat. Trois cadres commutables : téléphone, tablette, ordinateur (§7).

Sur téléphone, l'éditeur lui-même empile : commandes puis aperçu, avec un bouton flottant « Voir » qui fait défiler vers l'aperçu.

### 6.3 · Palette depuis le logo

Le geste qui sert le cas « on reprend son identité ». Au dépôt du logo (marque), côté navigateur, sur canvas : quantification des couleurs (median cut, ~5 couleurs), élimination des quasi-blancs et quasi-noirs, choix de la dominante la plus saturée comme `accent`. Le `ground` est un neutre du mode choisi, teinté de 3 % vers la teinte dominante du logo ; `ink` et `onAccent` sont dérivés et **déjà corrigés AA**. Le restaurateur part de *sa* marque et ajuste.

Aucune dépendance npm : ~100 lignes, testées sur des fixtures d'images.

### 6.4 · Les garde-fous

- **Contraste** : les cinq couples (§4.2) vérifiés en direct. Un échec affiche le ratio, le seuil, et **« nuance proposée »** — un clic applique la nuance la plus proche qui passe. On n'interdit pas ; on propose.
- **Polices** : curatées (§5.2), pas de champ libre.
- **Logos** : SVG ou PNG, ≤ 512 Ko, dimensions minimales par format (marque ≥ 256 px, horizontale ≥ 512 px de large). Validés au dépôt par le mécanisme existant (`modules/tenants/logo.*`), étendu aux quatre déclinaisons et au héros.
- **Enregistrement immédiat**, pas de circuit brouillon/publication : l'aperçu est la sécurité.

### 6.5 · L'API

- `PATCH /admin/brand` — portée tenant, authentification admin.
- `PATCH /crm/tenants/:id/brand` — portée CRM.
- Corps : `BrandSchema`. Le serveur **rejoue `contraste()`** et refuse (400, avec les couples en échec et les nuances proposées) tout ce qui ne passe pas AA. L'éditeur empêche d'y arriver ; l'API ne fait pas confiance à l'éditeur.
- Dépôts d'images : extension de `logo.controller` — un `variant` (`mark-light | mark-dark | lockup-light | lockup-dark | hero`).

## 7 · Responsive — la règle, pas l'intention

Trois classes d'écran : **téléphone < 640 px, tablette 640–1024 px, ordinateur au-delà**. Mobile-first partout.

- **Échelle typographique fluide** : `clamp()` sur chaque cran, comme le fait déjà l'admin.
- **Requêtes de conteneur** sur les cartes et panneaux : une carte produit s'adapte à *sa* colonne, pas à la fenêtre.
- **Cibles tactiles ≥ 44 px** — `TOUCH_MIN` de `client-core`.
- **Aucun défilement horizontal de page, jamais** ; un tableau défile dans son conteneur.
- L'aperçu de l'éditeur offre **les trois cadres** ; la matrice de captures (§9) les couvre tous.

## 8 · Reprise des tenants existants

Aucun grand soir.

1. **Repli à la lecture.** Tant que `brand` est `null`, le résolveur dérive : direction Nuit, `accent = brandColor`, `onAccent` calculé AA, `logo.mark.dark = logoUrl`. Toutes les surfaces client fonctionnent avant même la reprise.
2. **`backfill-brand.ts`** dans `packages/db/src/`, sur le motif maison : lecture seule par défaut, `--appliquer` pour écrire, idempotent (un tenant qui a déjà `brand` est ignoré), tâche `backfill:brand` dans `package.json`, lancé par `scripts/reprise-mongo.sh` — qui pose l'environnement, compose l'URL du proxy et nomme la base (les trois pièges déjà documentés dans `docs/CI-CD.md`).
3. **Les champs plats deviennent des dérivés** à la lecture (getters), conservés dans tous les contrats existants.

## 9 · Tests — ce qui est garanti

| Test | Où | Garantit |
|---|---|---|
| `resoudreMarque` : dérivation, repli des logos, mode | `client-core` | Les jetons sont cohérents et complets |
| **Les six directions passent AA** sur les cinq couples | `client-core` | Une direction qui échoue ne se merge pas |
| `contraste` : la nuance proposée passe toujours | `client-core` | Le garde-fou ne propose jamais un échec |
| Palette depuis le logo, sur fixtures | `components/brand` | La dominante est celle attendue, la palette passe AA |
| `BrandSchema` + dérivés plats | `contracts` | Compatibilité arrière des cinq charges |
| **Couleurs brutes interdites** — parcours des répertoires client | `apps/web` | La discipline est un contrôle, pas une consigne |
| `backfill-brand` : idempotent, lecture seule par défaut | `db` | Comme `backfill-founder.test.ts` |
| API : AA rejoué, 400 avec nuances proposées | `api` | Le serveur ne fait pas confiance à l'éditeur |
| **Matrice visuelle** : 3 surfaces × 6 directions × 3 cadres = 54 captures | Playwright, via `scripts/capture-shots.mjs` | La preuve du responsive et la référence des directions |

## 10 · Ce qui n'est pas décidé ici

- Le détail du chantier 2 (fidélité premium) : quelles interactions, quelles célébrations, quelles icônes. Il aura sa propre spec, sur ce socle.
- La composition du site vitrine (chantier 3).
- L'adoption du masque par les écrans TV.
