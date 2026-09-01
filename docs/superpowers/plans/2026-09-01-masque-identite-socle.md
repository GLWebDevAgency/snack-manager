# Masque d'identité — plan A, le socle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un restaurant porte sa propre identité — palette, typographie, forme, mouvement, logos — sur toutes les surfaces que voit son client, de bout en bout : du document tenant jusqu'au pixel, avec six directions artistiques prêtes à porter, sans éditeur (il vient au plan B).

**Architecture:** Un module pur `marque` dans `@sm/contracts` (zod, fonctions de couleur, résolveur, six directions) que l'API, le web et la base consomment tous. Le tenant gagne un sous-document `brand` nullable ; à la lecture, `marqueEffective()` dérive un masque même sans lui. Côté web, le masque **surcharge les variables `--cf-*` existantes dans le sous-arbre** de chaque surface client (Tailwind v4 `@theme inline` résout `var()` à l'usage) : aucun second espace de noms, aucun utilitaire dupliqué — la portée est l'espace de noms. Les polices passent par `next/font/google` déclarées statiquement, choisies par variable CSS.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), zod 4, vitest 3 (défauts, pas de config), Mongoose, NestJS avec `@Body(zod(Schema))`, Next 16 App Router, Tailwind v4 CSS-first, `next/font/google`, Playwright (`playwright`, pas `@playwright/test`), pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-09-01-masque-identite-design.md`

## Écarts à la spec, motivés par le repérage

| Spec | Plan | Pourquoi |
|---|---|---|
| Résolveur dans `client-core` (§4.1) | **dans `contracts/src/marque.ts`** | `client-core` dépend de `contracts`, jamais l'inverse ; **l'API n'importe pas `client-core`** et doit rejouer `contraste()` (§6.5). `contracts` est importé par tous, zod seul, déjà hôte de fonctions pures (`plafondRemiseLabel`). |
| Espace `--m-*` + nouveaux utilitaires (§4.3) | **surcharge scopée des `--cf-*` existants** | `@theme inline` mappe déjà `bg-surface`, `text-ink`, `bg-accent`… sur `--cf-*` et l'accent tenant est déjà posé par `style` inline sur la racine des composants client. Même mécanisme, étendu à tous les jetons. L'admin reste intact : le masque n'y est jamais posé. |
| Lien Google Fonts (§4.1) | **`next/font/google`, familles déclarées statiquement, `preload: false`** | Convention exclusive du dépôt (zéro `<link>` fonts). Auto-hébergé, sans décalage de mise en page ; seules les familles réellement utilisées se téléchargent. |
| Injection « par les layouts » (§4.3) | **par les composants racine** (`Storefront`, `Tracking`, `LoyaltyCardApp`) | Il n'existe aucun `layout.tsx` sous `/r`, `/embed`, `/t`, `/fidelite` ; l'injection actuelle vit exactement là. |
| Icône PWA = `logo.mark` sur `ground` (§4.5) | **PNG du logo servi tel quel dans `icons[]`, sinon SVG généré sur `ground`** | Un SVG d'icône ne charge pas d'`<image>` externe. |
| Répertoires client (§4.4) | **+ `components/ui/**`** | La carte de fidélité est bâtie sur `@/components/ui` (Btn, Card, Pill…), pas sur `order/primitives` : sans eux, le masque a des trous. En mode sombre, `text-white → text-ink` ne change rien à l'admin. |

## Global Constraints

- **Contraste AA 4,5:1** sur les cinq couples `ink/ground`, `ink/surface`, `onAccent/accent`, `accentInk/ground`, `inkMut/ground` — vérifié par le résolveur ET rejoué par l'API (400 avec nuances proposées).
- **Cinq rôles de couleur** stockés, tout le reste dérivé — jamais un dérivé en base.
- **Aucune couleur brute** dans `app/r/**`, `app/embed/**`, `app/t/**`, `components/order/**`, `components/ui/**` — test bloquant.
- **Les champs plats `brandColor` / `logoUrl` restent** dans tous les contrats existants, dérivés du masque.
- **Couleurs sémantiques fixes** (`ok`/`alert`/`prep`) : jamais la marque.
- **Cibles tactiles ≥ 44 px** (`TOUCH_MIN` de `@sm/client-core` = 44) ; **aucun défilement horizontal de page**.
- **Trois cadres** : téléphone 390×844, tablette 768×1024, ordinateur 1440×900.
- **`prefers-reduced-motion`** écrase toujours le profil de mouvement.
- **Reprise** : lecture seule par défaut, `--appliquer` pour écrire, idempotente, lancée par `scripts/reprise-mongo.sh`.
- **Commits** : sujet en français, forme narrative (« fix : … », « feat : … »), corps qui explique le POURQUOI ; pas de « chore » fourre-tout.
- **Aucun fichier de config vitest** : les tests vivent à côté du code, imports relatifs (l'alias `@/` n'existe pas en test web).
- **`packages/contracts` est compilé** (CJS → `dist`) : après tout ajout d'export, `pnpm --filter @sm/contracts build` avant les tests aval (turbo le fait via `test.dependsOn ^build`).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `packages/contracts/src/marque.ts` | **Créé.** Énumérations, `BrandSchema`, paires typographiques, six directions, mathématiques de couleur, `contraste`, `resoudreMarque`, `marqueDeRepli`, `marqueEffective`, dérivés plats. |
| `packages/contracts/src/marque.test.ts` | **Créé.** Tests du module — dont « les six directions passent AA ». |
| `packages/contracts/src/index.ts` | **Modifié.** `export * from './marque';` |
| `packages/contracts/src/ordering.ts`, `loyalty-public.ts`, `loyalty.ts` | **Modifiés.** `brand: Brand` (nullable) dans les charges publiques. |
| `packages/db/src/schemas.ts` | **Modifié.** Sous-schéma `Brand` et `brand: { type: Brand, default: null }` sur le tenant. |
| `packages/db/src/backfill-brand.ts` + `.test.ts` | **Créés.** Reprise des tenants existants. |
| `packages/db/package.json` | **Modifié.** Tâche `backfill:brand`. |
| `apps/api/src/modules/ordering/site.service.ts`, `tenants/tenants.service.ts`, `loyalty/loyalty-public.service.ts` | **Modifiés.** Les charges publiques portent `brand: marqueEffective(tenant)`. |
| `apps/api/src/modules/tenants/tenants.controller.ts` + `tenants.service.ts` | **Modifiés.** `PATCH /tenants/me/marque`. |
| `apps/api/src/modules/crm/admin.controller.ts` + `admin.service.ts` | **Modifiés.** `PATCH /crm/tenants/:id/marque`. |
| `apps/api/src/modules/tenants/marque.test.ts` | **Créé.** Le rejeu AA côté API. |
| `apps/web/src/components/masque/polices.ts` | **Créé.** Les dix-huit familles `next/font/google`, `classesPolices`. |
| `apps/web/src/components/masque/styleDuMasque.ts` + `.test.ts` | **Créés.** `resoudreMarque` → `CSSProperties`. |
| `apps/web/src/components/masque/couleurs-brutes.test.ts` | **Créé.** Le garde : parcours des répertoires client. |
| `apps/web/src/app/globals.css` | **Modifié.** Nouveaux jetons `--cf-*` et leurs utilitaires dans `@theme inline`. |
| `apps/web/src/components/order/api.ts` | **Modifié.** `SiteTenant.brand`, `loadBrand`. |
| `apps/web/src/components/order/Storefront.tsx`, `Tracking.tsx`, `components/loyalty/LoyaltyCardApp.tsx` | **Modifiés.** Le masque remplace `themed`. |
| `apps/web/src/components/ui/*.tsx`, `components/order/*.tsx`, `app/r/**`, `app/embed/**`, `app/t/**` | **Modifiés.** Passage en sémantique. |
| `apps/web/src/app/r/[slug]/fidelite/manifest.webmanifest/route.ts`, `icon.svg/route.ts` | **Modifiés.** PWA aux couleurs du masque. |
| `scripts/capture-masque.mjs` | **Créé.** La matrice 3 × 6 × 3. |

---

### Task 1 : Le contrat `brand` — énumérations, schéma zod, paires, directions

**Files:**
- Create: `packages/contracts/src/marque.ts`
- Create: `packages/contracts/src/marque.test.ts`
- Modify: `packages/contracts/src/index.ts` (ajouter une ligne d'export)

**Interfaces:**
- Produces : `BRAND_MODES`, `BRAND_SHAPES`, `BRAND_MOTIONS`, `PRESET_KEYS`, `TYPE_PAIR_KEYS`, `BrandSchema`, `Brand`, `BrandPalette`, `TYPE_PAIRS: Record<TypePairKey, TypePair>`, `DIRECTIONS: Record<PresetKey, Brand>`, `HEX` (regex).

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// packages/contracts/src/marque.test.ts
import { describe, expect, it } from 'vitest';
import { BrandSchema, DIRECTIONS, PRESET_KEYS, TYPE_PAIRS, TYPE_PAIR_KEYS } from './marque';

describe('le contrat brand', () => {
  it('accepte une direction complète telle quelle', () => {
    for (const key of PRESET_KEYS) {
      expect(() => BrandSchema.parse(DIRECTIONS[key])).not.toThrow();
    }
  });

  it('refuse une couleur qui n’est pas un hex à six chiffres', () => {
    const brasserie = DIRECTIONS.brasserie;
    const casse = { ...brasserie, palette: { ...brasserie.palette, accent: '#abc' } };
    expect(() => BrandSchema.parse(casse)).toThrow();
  });

  it('refuse une paire typographique hors de la liste curatée', () => {
    const casse = { ...DIRECTIONS.nuit, type: { pair: 'comic-sans' } };
    expect(() => BrandSchema.parse(casse)).toThrow();
  });

  it('chaque direction pointe sur une paire qui existe', () => {
    for (const key of PRESET_KEYS) {
      expect(TYPE_PAIR_KEYS).toContain(DIRECTIONS[key].type.pair);
      expect(DIRECTIONS[key].preset).toBe(key);
    }
  });

  it('les paires « prix en mono » déclarent une famille mono', () => {
    for (const key of TYPE_PAIR_KEYS) {
      const pair = TYPE_PAIRS[key];
      if (pair.prixMono) expect(pair.mono).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : FAIL — `Cannot find module './marque'`

- [ ] **Step 3 : Écrire le module — énumérations, schéma, paires, directions**

```ts
// packages/contracts/src/marque.ts
import { z } from 'zod';

/**
 * LE MASQUE D'IDENTITÉ — un restaurant, sa marque, notre squelette.
 *
 * Jusqu'ici, un tenant ne portait qu'un logo et une couleur d'accent : tout le
 * reste était la marque grise de Snack Manager. Sur les surfaces que voit le
 * CLIENT (vitrine, commande, fidélité, suivi), le restaurant porte désormais la
 * sienne — cinq couleurs stockées, tout le reste dérivé ici, en pur.
 *
 * Ce module n'importe que zod : il est consommé par l'API (qui rejoue le
 * contraste), par le web (qui pose les variables) et par la base (reprise).
 */

export const HEX = /^#[0-9a-fA-F]{6}$/;

export const BRAND_MODES = ['light', 'dark'] as const;
export const BrandModeSchema = z.enum(BRAND_MODES);
export type BrandMode = z.infer<typeof BrandModeSchema>;

export const BRAND_SHAPES = ['net', 'doux', 'rond'] as const;
export const BrandShapeSchema = z.enum(BRAND_SHAPES);
export type BrandShape = z.infer<typeof BrandShapeSchema>;

export const BRAND_MOTIONS = ['pose', 'vif'] as const;
export const BrandMotionSchema = z.enum(BRAND_MOTIONS);
export type BrandMotion = z.infer<typeof BrandMotionSchema>;

export const PRESET_KEYS = ['brasserie', 'neon', 'atelier', 'marche', 'nuit', 'soleil'] as const;
export const PresetKeySchema = z.enum(PRESET_KEYS);
export type PresetKey = z.infer<typeof PresetKeySchema>;

export const TYPE_PAIR_KEYS = [
  'brasserie', 'neon', 'atelier', 'marche', 'nuit', 'soleil',
  'editorial', 'moderne', 'classique', 'brut',
] as const;
export const TypePairKeySchema = z.enum(TYPE_PAIR_KEYS);
export type TypePairKey = z.infer<typeof TypePairKeySchema>;

const Hex = z.string().trim().regex(HEX, 'Couleur attendue au format #rrggbb');
/** URL interne d'image (R2) — jamais un lien externe sur un ticket. */
const ImageUrl = z.string().trim().url().max(500).nullable();

export const BrandPaletteSchema = z
  .object({
    ground: Hex,
    surface: Hex,
    ink: Hex,
    accent: Hex,
    onAccent: Hex,
  })
  .strict();
export type BrandPalette = z.infer<typeof BrandPaletteSchema>;

export const BrandSchema = z
  .object({
    mode: BrandModeSchema,
    palette: BrandPaletteSchema,
    type: z.object({ pair: TypePairKeySchema }).strict(),
    shape: BrandShapeSchema,
    motion: BrandMotionSchema,
    logo: z
      .object({
        mark: z.object({ light: ImageUrl, dark: ImageUrl }).strict(),
        lockup: z.object({ light: ImageUrl, dark: ImageUrl }).strict(),
      })
      .strict(),
    hero: ImageUrl,
    preset: PresetKeySchema.nullable(),
  })
  .strict();
export type Brand = z.infer<typeof BrandSchema>;

// ─────────────────────────────────────────────────────────────
// Les paires typographiques curatées — jamais une police libre
// ─────────────────────────────────────────────────────────────

/**
 * `display`/`body`/`mono` sont des SLUGS de famille : le web déclare chaque
 * famille via next/font avec la variable `--police-<slug>`, et le résolveur
 * émet `var(--police-<slug>), <repli>`. Les familles sont listées dans
 * FONT_FAMILIES pour que le web n'en oublie aucune.
 */
export type TypePair = {
  display: string;
  body: string;
  mono: string | null;
  /** Certaines paires posent les prix en mono — l'artisan, le brut. */
  prixMono: boolean;
  /** Le libellé montré dans l'éditeur (plan B). */
  label: string;
};

export const TYPE_PAIRS: Record<TypePairKey, TypePair> = {
  brasserie: { display: 'fraunces', body: 'source-sans-3', mono: null, prixMono: false, label: 'Fraunces · Source Sans' },
  neon: { display: 'bricolage-grotesque', body: 'archivo', mono: null, prixMono: false, label: 'Bricolage · Archivo' },
  atelier: { display: 'alegreya-sans', body: 'alegreya-sans', mono: 'jetbrains-mono', prixMono: true, label: 'Alegreya Sans · prix en mono' },
  marche: { display: 'outfit', body: 'manrope', mono: null, prixMono: false, label: 'Outfit · Manrope' },
  nuit: { display: 'cormorant-garamond', body: 'figtree', mono: null, prixMono: false, label: 'Cormorant · Figtree' },
  soleil: { display: 'nunito', body: 'nunito-sans', mono: null, prixMono: false, label: 'Nunito · Nunito Sans' },
  editorial: { display: 'playfair-display', body: 'source-sans-3', mono: null, prixMono: false, label: 'Playfair · Source Sans' },
  moderne: { display: 'familjen-grotesk', body: 'instrument-sans', mono: null, prixMono: false, label: 'Familjen · Instrument' },
  classique: { display: 'libre-baskerville', body: 'lato', mono: null, prixMono: false, label: 'Baskerville · Lato' },
  brut: { display: 'archivo-black', body: 'archivo', mono: 'jetbrains-mono', prixMono: true, label: 'Archivo Black · prix en mono' },
};

/** Toutes les familles à déclarer côté web — dérivé, jamais tenu à la main. */
export const FONT_FAMILIES: readonly string[] = Array.from(
  new Set(
    Object.values(TYPE_PAIRS).flatMap((p) => [p.display, p.body, ...(p.mono ? [p.mono] : [])]),
  ),
).sort();

/** Pile de repli par genre — ce que voit le client avant que la police arrive. */
export const FONT_FALLBACKS: Record<string, string> = {
  fraunces: 'Georgia, "Times New Roman", serif',
  'cormorant-garamond': 'Georgia, "Times New Roman", serif',
  'playfair-display': 'Georgia, "Times New Roman", serif',
  'libre-baskerville': 'Georgia, "Times New Roman", serif',
  'jetbrains-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const fallbackDe = (slug: string): string => FONT_FALLBACKS[slug] ?? SANS_FALLBACK;

// ─────────────────────────────────────────────────────────────
// Six directions artistiques — des objets brand COMPLETS
// ─────────────────────────────────────────────────────────────

const sansLogos = { mark: { light: null, dark: null }, lockup: { light: null, dark: null } };

export const DIRECTIONS: Record<PresetKey, Brand> = {
  brasserie: {
    mode: 'light',
    palette: { ground: '#F5EFE3', surface: '#FFFDF8', ink: '#1F1A17', accent: '#7A2E2A', onAccent: '#FFF8F0' },
    type: { pair: 'brasserie' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'brasserie',
  },
  neon: {
    mode: 'dark',
    palette: { ground: '#0E1016', surface: '#171A23', ink: '#F3F1EC', accent: '#D8F04A', onAccent: '#0E1016' },
    type: { pair: 'neon' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'neon',
  },
  atelier: {
    mode: 'light',
    palette: { ground: '#F7F3EC', surface: '#FFFFFF', ink: '#2B2B2B', accent: '#A8482A', onAccent: '#FFF4EC' },
    type: { pair: 'atelier' }, shape: 'doux', motion: 'pose', logo: sansLogos, hero: null, preset: 'atelier',
  },
  marche: {
    mode: 'light',
    palette: { ground: '#FFFFFF', surface: '#F4F8F4', ink: '#1E4D2B', accent: '#23843F', onAccent: '#FFFFFF' },
    type: { pair: 'marche' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'marche',
  },
  nuit: {
    mode: 'dark',
    palette: { ground: '#14151A', surface: '#1D1F26', ink: '#F0EBE1', accent: '#C9A15A', onAccent: '#1C1612' },
    type: { pair: 'nuit' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'nuit',
  },
  soleil: {
    mode: 'light',
    palette: { ground: '#F6EBD9', surface: '#FFF9F0', ink: '#1B2A4A', accent: '#E07A1F', onAccent: '#1B1206' },
    type: { pair: 'soleil' }, shape: 'doux', motion: 'vif', logo: sansLogos, hero: null, preset: 'soleil',
  },
};

export const PRESET_LABELS: Record<PresetKey, string> = {
  brasserie: 'Brasserie', neon: 'Néon', atelier: 'Atelier', marche: 'Marché', nuit: 'Nuit', soleil: 'Soleil',
};
```

- [ ] **Step 4 : Exporter depuis l'index**

Dans `packages/contracts/src/index.ts`, après `export * from './loyalty-public';` :

```ts
export * from './marque';
```

- [ ] **Step 5 : Lancer le test pour le voir passer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : PASS (5 tests)

- [ ] **Step 6 : Commit**

```bash
git add packages/contracts/src/marque.ts packages/contracts/src/marque.test.ts packages/contracts/src/index.ts
git commit -m "feat : le contrat du masque d'identité — cinq rôles, dix paires, six directions"
```

---

### Task 2 : La couleur en pur — luminance, contraste, mélange, ajustement jusqu'à AA

**Files:**
- Modify: `packages/contracts/src/marque.ts` (ajouter en fin de fichier)
- Modify: `packages/contracts/src/marque.test.ts`

**Interfaces:**
- Produces : `hexVersRgb(hex): [r,g,b]`, `rgbVersHex([r,g,b]): string`, `luminance(hex): number`, `ratioContraste(a, b): number`, `melanger(a, b, t): string`, `alpha(hex, a): string` (→ `rgba(...)`), `ajusterJusquaAA(couleur, fond, seuil = 4.5): string`, `WCAG_AA = 4.5`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `packages/contracts/src/marque.test.ts` :

```ts
import { ajusterJusquaAA, alpha, luminance, melanger, ratioContraste, rgbVersHex, hexVersRgb } from './marque';

describe('la couleur en pur', () => {
  it('aller-retour hex ↔ rgb sans perte', () => {
    expect(hexVersRgb('#C9A15A')).toEqual([201, 161, 90]);
    expect(rgbVersHex([201, 161, 90])).toBe('#c9a15a');
  });

  it('le contraste blanc/noir vaut 21, et il est symétrique', () => {
    expect(ratioContraste('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(ratioContraste('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('la luminance du blanc est 1, celle du noir 0', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });

  it('mélanger à 0 rend la première, à 1 la seconde, à 0,5 le milieu', () => {
    expect(melanger('#000000', '#ffffff', 0)).toBe('#000000');
    expect(melanger('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(melanger('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('alpha rend un rgba() posable en CSS', () => {
    expect(alpha('#1f1a17', 0.12)).toBe('rgba(31, 26, 23, 0.12)');
  });

  it('ajuste un safran clair jusqu’à AA sur sable — en l’assombrissant', () => {
    const ajuste = ajusterJusquaAA('#E07A1F', '#F6EBD9');
    expect(ratioContraste(ajuste, '#F6EBD9')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ajuste)).toBeLessThan(luminance('#E07A1F'));
  });

  it('ajuste un bordeaux sombre jusqu’à AA sur noir — en l’éclaircissant', () => {
    const ajuste = ajusterJusquaAA('#7A2E2A', '#0E1016');
    expect(ratioContraste(ajuste, '#0E1016')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ajuste)).toBeGreaterThan(luminance('#7A2E2A'));
  });

  it('ne touche pas à une couleur déjà AA', () => {
    expect(ajusterJusquaAA('#1F1A17', '#F5EFE3')).toBe('#1f1a17');
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : FAIL — `hexVersRgb is not a function` (et suivants)

- [ ] **Step 3 : Implémenter**

Ajouter à la fin de `packages/contracts/src/marque.ts` :

```ts
// ─────────────────────────────────────────────────────────────
// La couleur en pur — WCAG 2.x, sans dépendance
// ─────────────────────────────────────────────────────────────

export const WCAG_AA = 4.5;

export type Rgb = readonly [number, number, number];

export function hexVersRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbVersHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Luminance relative WCAG — canal linéarisé, pondéré. */
export function luminance(hex: string): number {
  const [r, g, b] = hexVersRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratioContraste(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [clair, sombre] = la >= lb ? [la, lb] : [lb, la];
  return (clair + 0.05) / (sombre + 0.05);
}

/** Interpolation linéaire en sRGB — suffisante pour des teintes et des filets. */
export function melanger(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexVersRgb(a);
  const [br, bg, bb] = hexVersRgb(b);
  return rgbVersHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexVersRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Rapproche `couleur` du pôle opposé à `fond` (noir sur fond clair, blanc sur
 * fond sombre) par pas de 1/200, jusqu'au seuil. Une couleur déjà conforme
 * revient telle quelle, en minuscules.
 */
export function ajusterJusquaAA(couleur: string, fond: string, seuil = WCAG_AA): string {
  const depart = couleur.toLowerCase();
  if (ratioContraste(depart, fond) >= seuil) return depart;
  const pole = luminance(fond) > 0.5 ? '#000000' : '#ffffff';
  for (let pas = 1; pas <= 200; pas += 1) {
    const candidat = melanger(depart, pole, pas / 200);
    if (ratioContraste(candidat, fond) >= seuil) return candidat;
  }
  return pole;
}
```

- [ ] **Step 4 : Lancer pour voir passer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : PASS (13 tests)

- [ ] **Step 5 : Commit**

```bash
git add packages/contracts/src/marque.ts packages/contracts/src/marque.test.ts
git commit -m "feat : la couleur en pur — luminance, contraste, et l'ajustement jusqu'à AA"
```

---

### Task 3 : `contraste()` et `resoudreMarque()` — de cinq couleurs à toutes les variables

**Files:**
- Modify: `packages/contracts/src/marque.ts`
- Modify: `packages/contracts/src/marque.test.ts`

**Interfaces:**
- Consumes : Task 2 (`ratioContraste`, `melanger`, `alpha`, `ajusterJusquaAA`), Task 1 (`Brand`, `TYPE_PAIRS`, `fallbackDe`).
- Produces :
  - `type Verdict = { couple: string; avant: string; arriere: string; ratio: number; ok: boolean; proposition: string | null }`
  - `contraste(brand: Brand): { ok: boolean; verdicts: Verdict[] }`
  - `type JetonsMasque = { vars: Record<string, string>; colorScheme: BrandMode; prixMono: boolean }`
  - `resoudreMarque(brand: Brand): JetonsMasque` — `vars` porte TOUTES les variables `--cf-*` / `--sm-*` à poser sur la racine d'une surface client.

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
import { contraste, resoudreMarque } from './marque';

describe('contraste(brand)', () => {
  it('donne cinq verdicts, tous vrais, sur une direction bien dessinée', () => {
    const v = contraste(DIRECTIONS.brasserie);
    expect(v.ok).toBe(true);
    expect(v.verdicts).toHaveLength(5);
    expect(v.verdicts.map((x) => x.couple)).toEqual([
      'ink/ground', 'ink/surface', 'onAccent/accent', 'accentInk/ground', 'inkMut/ground',
    ]);
  });

  it('propose la nuance la plus proche qui passe, et elle passe', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    const v = contraste(pale);
    const raté = v.verdicts.find((x) => x.couple === 'ink/ground');
    expect(raté?.ok).toBe(false);
    expect(raté?.proposition).not.toBeNull();
    expect(ratioContraste(raté!.proposition!, pale.palette.ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resoudreMarque(brand)', () => {
  it('pose les cinq rôles et le mode', () => {
    const j = resoudreMarque(DIRECTIONS.neon);
    expect(j.colorScheme).toBe('dark');
    expect(j.vars['--cf-bg']).toBe('#0e1016');
    expect(j.vars['--cf-surface']).toBe('#171a23');
    expect(j.vars['--cf-text']).toBe('#f3f1ec');
    expect(j.vars['--cf-accent']).toBe('#d8f04a');
    expect(j.vars['--cf-on-accent']).toBe('#0e1016');
  });

  it('dérive les filets depuis l’encre, pas depuis le blanc — un fond clair a des filets sombres', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-line']).toBe('rgba(31, 26, 23, 0.12)');
    expect(j.vars['--cf-line-2']).toBe('rgba(31, 26, 23, 0.06)');
    expect(j.vars['--cf-surface-3']).toBe('rgba(31, 26, 23, 0.03)');
  });

  it('accentInk est AA sur le fond même quand l’accent ne l’est pas', () => {
    const j = resoudreMarque(DIRECTIONS.soleil);
    expect(ratioContraste(j.vars['--cf-accent-ink']!, '#F6EBD9')).toBeGreaterThanOrEqual(4.5);
  });

  it('inkMut reste lisible : ramené à AA si le mélange descend trop bas', () => {
    for (const key of PRESET_KEYS) {
      const j = resoudreMarque(DIRECTIONS[key]);
      expect(ratioContraste(j.vars['--cf-mut']!, DIRECTIONS[key].palette.ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('les couleurs sémantiques ne sont jamais la marque', () => {
    const a = resoudreMarque(DIRECTIONS.neon).vars;
    const b = resoudreMarque(DIRECTIONS.nuit).vars;
    expect(a['--cf-green']).toBe(b['--cf-green']); // même mode → mêmes sémantiques
    expect(a['--cf-green']).not.toBe(a['--cf-accent']);
  });

  it('la forme et le mouvement deviennent des variables', () => {
    const net = resoudreMarque(DIRECTIONS.brasserie).vars;
    const rond = resoudreMarque(DIRECTIONS.neon).vars;
    expect(net['--cf-r-md']).toBe('4px');
    expect(rond['--cf-r-md']).toBe('18px');
    expect(net['--sm-t-fast']).toBe('240ms');
    expect(rond['--sm-t-fast']).toBe('140ms');
    expect(rond['--sm-ease']).toContain('1.4');
  });

  it('les polices pointent sur les variables next/font, avec leur repli', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-font-display']).toBe('var(--police-fraunces), Georgia, "Times New Roman", serif');
    expect(j.vars['--cf-font-body']).toContain('var(--police-source-sans-3)');
    expect(j.prixMono).toBe(false);
    expect(resoudreMarque(DIRECTIONS.atelier).prixMono).toBe(true);
    expect(resoudreMarque(DIRECTIONS.atelier).vars['--cf-font-mono']).toContain('var(--police-jetbrains-mono)');
  });

  it('LES SIX DIRECTIONS PASSENT AA — une direction qui échoue ne se merge pas', () => {
    for (const key of PRESET_KEYS) {
      const v = contraste(DIRECTIONS[key]);
      expect(v.ok, `${key} : ${v.verdicts.filter((x) => !x.ok).map((x) => x.couple).join(', ')}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2 : Lancer pour voir échouer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : FAIL — `contraste is not a function`

- [ ] **Step 3 : Implémenter le résolveur**

Ajouter à la fin de `packages/contracts/src/marque.ts` :

```ts
// ─────────────────────────────────────────────────────────────
// Le résolveur — tout ce qui n'est pas stocké se calcule ici
// ─────────────────────────────────────────────────────────────

export type Verdict = {
  couple: string;
  avant: string;
  arriere: string;
  ratio: number;
  ok: boolean;
  /** La nuance la plus proche qui passe — `null` quand ça passe déjà. */
  proposition: string | null;
};

/** Les dérivés dont dépend le contraste — calculés une fois, partagés. */
function derives(p: BrandPalette) {
  return {
    accentInk: ajusterJusquaAA(p.accent, p.ground),
    inkMut: ajusterJusquaAA(melanger(p.ink, p.ground, 0.5), p.ground),
  };
}

export function contraste(brand: Brand): { ok: boolean; verdicts: Verdict[] } {
  const p = brand.palette;
  const d = derives(p);
  const couples: [string, string, string][] = [
    ['ink/ground', p.ink, p.ground],
    ['ink/surface', p.ink, p.surface],
    ['onAccent/accent', p.onAccent, p.accent],
    ['accentInk/ground', d.accentInk, p.ground],
    ['inkMut/ground', d.inkMut, p.ground],
  ];
  const verdicts = couples.map(([couple, avant, arriere]): Verdict => {
    const ratio = Math.round(ratioContraste(avant, arriere) * 100) / 100;
    const ok = ratio >= WCAG_AA;
    return { couple, avant, arriere, ratio, ok, proposition: ok ? null : ajusterJusquaAA(avant, arriere) };
  });
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

/** Rayons par forme — sm / md / lg ; la pilule ne change jamais. */
const RAYONS: Record<BrandShape, [number, number, number]> = {
  net: [2, 4, 6],
  doux: [6, 10, 14],
  rond: [12, 18, 24],
};

/** Durées (ms) base / entrée / fête, et courbe. */
const MOUVEMENTS: Record<BrandMotion, { base: number; entree: number; fete: number; ease: string }> = {
  pose: { base: 240, entree: 320, fete: 900, ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  vif: { base: 140, entree: 200, fete: 600, ease: 'cubic-bezier(0.3, 1.4, 0.4, 1)' },
};

/** Sémantiques fixes par mode — un « payé » est vert chez tout le monde. */
const SEMANTIQUES: Record<BrandMode, { green: string; red: string; amber: string }> = {
  dark: { green: '#3fae4a', red: '#c94b3f', amber: '#e0973f' },
  light: { green: '#2f8a3b', red: '#b7382e', amber: '#b8731f' },
};

export type JetonsMasque = {
  vars: Record<string, string>;
  colorScheme: BrandMode;
  prixMono: boolean;
};

const police = (slug: string): string => `var(--police-${slug}), ${fallbackDe(slug)}`;

export function resoudreMarque(brand: Brand): JetonsMasque {
  const p = {
    ground: brand.palette.ground.toLowerCase(),
    surface: brand.palette.surface.toLowerCase(),
    ink: brand.palette.ink.toLowerCase(),
    accent: brand.palette.accent.toLowerCase(),
    onAccent: brand.palette.onAccent.toLowerCase(),
  };
  const sombre = brand.mode === 'dark';
  const d = derives(p);
  const sem = SEMANTIQUES[brand.mode];
  const [rSm, rMd, rLg] = RAYONS[brand.shape];
  const m = MOUVEMENTS[brand.motion];
  const pair = TYPE_PAIRS[brand.type.pair];
  // Le texte posé sur une sémantique : noir ou blanc, par contraste réel.
  const sur = (fond: string) => (ratioContraste('#000000', fond) >= ratioContraste('#ffffff', fond) ? '#000000' : '#ffffff');
  const ombre = sombre ? 'rgba(0, 0, 0, 0.38)' : alpha(p.ink, 0.14);

  const vars: Record<string, string> = {
    // Neutres
    '--cf-bg': p.ground,
    '--cf-surface': p.surface,
    '--cf-surface-2': melanger(p.surface, p.ink, 0.04),
    '--cf-text': p.ink,
    '--cf-ink-soft': melanger(p.ink, p.ground, 0.25),
    '--cf-mut': d.inkMut,
    '--cf-line': alpha(p.ink, 0.12),
    '--cf-line-2': alpha(p.ink, 0.06),
    '--cf-surface-3': alpha(p.ink, 0.03),
    '--cf-surface-6': alpha(p.ink, 0.06),
    '--cf-white-50': alpha(p.ink, 0.5),
    '--cf-fill': sombre ? melanger(p.surface, p.ink, 0.06) : p.ink,
    '--cf-on-fill': sombre ? p.ink : p.ground,
    '--cf-btn-dark': sombre ? melanger(p.surface, p.ink, 0.1) : p.ink,
    // Accent
    '--cf-accent': p.accent,
    '--cf-accent-hover': melanger(p.accent, sombre ? '#ffffff' : '#000000', 0.08),
    '--cf-on-accent': p.onAccent,
    '--cf-accent-ink': d.accentInk,
    '--cf-accent-wash': alpha(p.accent, 0.12),
    '--cf-focus': alpha(p.accent, 0.6),
    // Sémantiques — fixes par mode, jamais la marque
    '--cf-green': sem.green,
    '--cf-red': sem.red,
    '--cf-amber': sem.amber,
    '--cf-green-t': ajusterJusquaAA(sem.green, p.ground),
    '--cf-red-t': ajusterJusquaAA(sem.red, p.ground),
    '--cf-amber-t': ajusterJusquaAA(sem.amber, p.ground),
    '--cf-on-green': sur(sem.green),
    '--cf-on-red': sur(sem.red),
    '--cf-on-amber': sur(sem.amber),
    // Surfaces composées — le voile suit l'encre, l'aplat suit la surface
    '--cf-card-gradient': `linear-gradient(180deg, ${alpha(p.ink, 0.05)} 0%, ${alpha(p.ink, 0)} 62%), linear-gradient(0deg, ${p.surface}, ${p.surface})`,
    '--cf-elev-gradient': `linear-gradient(180deg, ${alpha(p.ink, 0.045)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${melanger(p.surface, p.ink, 0.04)}, ${melanger(p.surface, p.ink, 0.04)})`,
    '--cf-elev-hover': `linear-gradient(180deg, ${alpha(p.ink, 0.07)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${melanger(p.surface, p.ink, 0.08)}, ${melanger(p.surface, p.ink, 0.08)})`,
    // Ombres
    '--cf-shadow': `0 1px 0 ${ombre}, 0 10px 28px ${ombre}`,
    '--cf-shadow-2': `0 2px 0 ${ombre}, 0 16px 40px ${ombre}`,
    '--cf-shadow-soft': `0 12px 34px ${ombre}`,
    '--cf-shadow-card': `0 1px 0 ${ombre}, 0 10px 26px ${ombre}`,
    '--cf-shadow-accent': `0 0 0 1px ${p.accent}`,
    '--cf-shadow-drawer': `-1px 0 0 ${alpha(p.ink, 0.08)}, -26px 0 60px ${ombre}`,
    // Forme
    '--cf-r-xs': `${rSm}px`,
    '--cf-r-sm': `${rMd}px`,
    '--cf-r-md': `${rMd}px`,
    '--cf-r': `${rLg}px`,
    '--cf-r-lg': `${rLg + 4}px`,
    '--cf-r-pill': '999px',
    // Mouvement
    '--sm-ease': m.ease,
    '--sm-t-fast': `${m.base}ms`,
    '--sm-t-med': `${m.entree}ms`,
    '--sm-t-slow': `${m.fete}ms`,
    // Polices
    '--cf-font-display': police(pair.display),
    '--cf-font-body': police(pair.body),
    '--cf-font-mono': police(pair.mono ?? 'jetbrains-mono'),
  };
  return { vars, colorScheme: brand.mode, prixMono: pair.prixMono };
}
```

- [ ] **Step 4 : Lancer pour voir passer**

Run : `pnpm --filter @sm/contracts test -- marque`
Expected : PASS. Si « LES SIX DIRECTIONS PASSENT AA » échoue sur un couple, **corriger la direction dans `DIRECTIONS`** (assombrir l'encre ou l'accent), jamais le seuil.

- [ ] **Step 5 : Commit**

```bash
git add packages/contracts/src/marque.ts packages/contracts/src/marque.test.ts
git commit -m "feat : le résolveur du masque — cinq couleurs, et toutes les autres en découlent"
```

---

### Task 4 : Le repli, le masque effectif, et les champs plats dérivés

**Files:**
- Modify: `packages/contracts/src/marque.ts`
- Modify: `packages/contracts/src/marque.test.ts`

**Interfaces:**
- Produces :
  - `marqueDeRepli(brandColor: string | null | undefined, logoUrl: string | null | undefined): Brand` — direction Nuit, accent = brandColor valide sinon `#c9a15a`, `onAccent` calculé, `logo.mark.dark = logoUrl`.
  - `marqueEffective(t: { brand?: Brand | null; brandColor?: string | null; logoUrl?: string | null }): Brand`
  - `brandColorDe(b: Brand): string` = `b.palette.accent`
  - `logoUrlDe(b: Brand): string | null` = `mark.dark ?? mark.light ?? lockup.dark ?? lockup.light`
  - `logoPour(b: Brand, format: 'mark' | 'lockup'): string | null` — la déclinaison du mode, avec repli sur l'autre déclinaison puis l'autre format.

- [ ] **Step 1 : Tests**

```ts
import { brandColorDe, logoPour, logoUrlDe, marqueDeRepli, marqueEffective } from './marque';

describe('le repli — un tenant sans brand a quand même un masque', () => {
  it('part de Nuit, prend l’accent du tenant, calcule onAccent', () => {
    const b = marqueDeRepli('#2E9E4F', 'https://r2.example/logo.png');
    expect(b.preset).toBe('nuit');
    expect(b.palette.accent).toBe('#2e9e4f');
    expect(ratioContraste(b.palette.onAccent, b.palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(b.logo.mark.dark).toBe('https://r2.example/logo.png');
    expect(contraste(b).ok).toBe(true);
  });

  it('un accent invalide retombe sur le laiton', () => {
    expect(marqueDeRepli('rouge', null).palette.accent).toBe('#c9a15a');
    expect(marqueDeRepli(null, null).palette.accent).toBe('#c9a15a');
  });

  it('un accent trop sombre pour Nuit est éclairci jusqu’à AA sur le fond', () => {
    const b = marqueDeRepli('#1a1a1a', null);
    expect(contraste(b).ok).toBe(true);
  });
});

describe('marqueEffective', () => {
  it('rend brand tel quel quand il existe', () => {
    expect(marqueEffective({ brand: DIRECTIONS.soleil, brandColor: '#000000' })).toEqual(DIRECTIONS.soleil);
  });
  it('sinon dérive du plat', () => {
    expect(marqueEffective({ brand: null, brandColor: '#2E9E4F' }).palette.accent).toBe('#2e9e4f');
  });
});

describe('les champs plats, dérivés du masque', () => {
  it('brandColor est l’accent', () => {
    expect(brandColorDe(DIRECTIONS.neon)).toBe('#D8F04A');
  });
  it('logoUrl préfère la marque sombre, puis claire, puis l’horizontale', () => {
    const b: Brand = { ...DIRECTIONS.nuit, logo: { mark: { light: 'l', dark: null }, lockup: { light: null, dark: 'ld' } } };
    expect(logoUrlDe(b)).toBe('l');
    expect(logoUrlDe({ ...b, logo: { mark: { light: null, dark: null }, lockup: { light: null, dark: 'ld' } } })).toBe('ld');
    expect(logoUrlDe(DIRECTIONS.nuit)).toBeNull();
  });
  it('logoPour suit le mode, avec repli', () => {
    const clair: Brand = { ...DIRECTIONS.brasserie, logo: { mark: { light: null, dark: 'md' }, lockup: { light: 'll', dark: null } } };
    expect(logoPour(clair, 'mark')).toBe('md');   // pas de clair → le sombre du même format
    expect(logoPour(clair, 'lockup')).toBe('ll');
    expect(logoPour({ ...clair, logo: { mark: { light: null, dark: null }, lockup: { light: 'll', dark: null } } }, 'mark')).toBe('ll'); // → l'autre format
  });
});
```

- [ ] **Step 2 : Voir échouer** — Run : `pnpm --filter @sm/contracts test -- marque` — Expected : FAIL, `marqueDeRepli is not a function`

- [ ] **Step 3 : Implémenter**

Ajouter à la fin de `packages/contracts/src/marque.ts` :

```ts
// ─────────────────────────────────────────────────────────────
// Le repli, le masque effectif, les champs plats
// ─────────────────────────────────────────────────────────────

const LAITON = '#c9a15a';

/**
 * Tant qu'un tenant n'a pas été repris (brand = null), il porte Nuit — la
 * direction la plus proche de l'identité Snack Manager — avec son accent et
 * son logo. Aucune surface ne casse avant la reprise.
 */
export function marqueDeRepli(
  brandColor: string | null | undefined,
  logoUrl: string | null | undefined,
): Brand {
  const nuit = DIRECTIONS.nuit;
  const brut = String(brandColor ?? '').trim().toLowerCase();
  const accent = ajusterJusquaAA(HEX.test(brut) ? brut : LAITON, nuit.palette.ground);
  const onAccent = ratioContraste('#000000', accent) >= ratioContraste('#ffffff', accent) ? '#000000' : '#ffffff';
  return {
    ...nuit,
    palette: { ...nuit.palette, accent, onAccent },
    logo: { mark: { light: null, dark: logoUrl ?? null }, lockup: { light: null, dark: null } },
    preset: 'nuit',
  };
}

export function marqueEffective(t: {
  brand?: Brand | null;
  brandColor?: string | null;
  logoUrl?: string | null;
}): Brand {
  return t.brand ?? marqueDeRepli(t.brandColor, t.logoUrl);
}

/** Le contrat « logo + accent » des outils du personnel : dérivé, jamais stocké à part. */
export const brandColorDe = (b: Brand): string => b.palette.accent;

export function logoUrlDe(b: Brand): string | null {
  return b.logo.mark.dark ?? b.logo.mark.light ?? b.logo.lockup.dark ?? b.logo.lockup.light;
}

/** La déclinaison du mode ; sinon l'autre déclinaison ; sinon l'autre format. */
export function logoPour(b: Brand, format: 'mark' | 'lockup'): string | null {
  const autre = format === 'mark' ? 'lockup' : 'mark';
  const pref = b.mode === 'dark' ? 'dark' : 'light';
  const alt = pref === 'dark' ? 'light' : 'dark';
  return b.logo[format][pref] ?? b.logo[format][alt] ?? b.logo[autre][pref] ?? b.logo[autre][alt];
}
```

- [ ] **Step 4 : Voir passer** — Run : `pnpm --filter @sm/contracts test` — Expected : PASS (tout le paquet)

- [ ] **Step 5 : Construire le paquet, puis commit**

Run : `pnpm --filter @sm/contracts build && pnpm --filter @sm/contracts lint`
Expected : succès, aucune erreur eslint.

```bash
git add packages/contracts/src/marque.ts packages/contracts/src/marque.test.ts
git commit -m "feat : le masque de repli — un tenant sans brand porte Nuit, jamais une page cassée"
```

---

### Task 5 : Le sous-document `brand` sur le tenant (Mongoose)

**Files:**
- Modify: `packages/db/src/schemas.ts` — avant `export const TenantSchema` (vers la ligne 47), puis dans le schéma après `brandColor` (ligne 52).

**Interfaces:**
- Produces : `TenantSchema.brand` typé `Brand | null` via `InferSchemaType` ; export `BrandSub` pour le test.

- [ ] **Step 1 : Déclarer le sous-schéma, sur le motif de `HoursSlot`/`atelier`**

Ajouter avant `export const TenantSchema = new Schema(` :

```ts
// ─────────────────────────────────────────────────────────────
// Le masque d'identité — cinq rôles stockés, tout le reste dérivé
// (packages/contracts/src/marque.ts). `null` tant que le tenant n'a pas
// été repris : le résolveur retombe alors sur Nuit + brandColor + logoUrl.
// ─────────────────────────────────────────────────────────────

const LogoPair = new Schema(
  {
    light: { type: String, default: null },
    dark: { type: String, default: null },
  },
  { _id: false },
);

export const BrandSub = new Schema(
  {
    mode: { type: String, enum: ['light', 'dark'], required: true },
    palette: {
      type: new Schema(
        {
          ground: { type: String, required: true },
          surface: { type: String, required: true },
          ink: { type: String, required: true },
          accent: { type: String, required: true },
          onAccent: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    type: {
      type: new Schema({ pair: { type: String, required: true } }, { _id: false }),
      required: true,
    },
    shape: { type: String, enum: ['net', 'doux', 'rond'], required: true },
    motion: { type: String, enum: ['pose', 'vif'], required: true },
    logo: {
      type: new Schema(
        {
          mark: { type: LogoPair, required: true },
          lockup: { type: LogoPair, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    hero: { type: String, default: null },
    preset: {
      type: String,
      enum: ['brasserie', 'neon', 'atelier', 'marche', 'nuit', 'soleil', null],
      default: null,
    },
  },
  { _id: false },
);
```

- [ ] **Step 2 : Poser le champ sur le tenant**

Dans `TenantSchema`, juste après `brandColor: { type: String, default: '#c9a15a' },` :

```ts
    brand: { type: BrandSub, default: null },
```

- [ ] **Step 3 : Vérifier le type et le paquet**

Run : `pnpm --filter @sm/db typecheck && pnpm --filter @sm/db build && pnpm --filter @sm/db test`
Expected : succès. Le type `Tenant` (`InferSchemaType`, l.372) porte désormais `brand`.

- [ ] **Step 4 : Commit**

```bash
git add packages/db/src/schemas.ts
git commit -m "feat : le tenant porte son masque — un sous-document nullable, cinq rôles, rien de dérivé"
```

---

### Task 6 : Les charges publiques portent `brand` — contrats d'abord, API ensuite

L'ordre compte : `LoyaltyPublicProgramSchema.restaurant` est `.strict()` et parsé côté web — si l'API émet `brand` avant que le contrat ne l'admette, la carte de fidélité tombe en erreur. **Contrats, build, puis API.**

**Files:**
- Modify: `packages/contracts/src/ordering.ts` (le type public du tenant, vers l.367-379)
- Modify: `packages/contracts/src/loyalty-public.ts` (l.17-27)
- Modify: `packages/contracts/src/loyalty.ts` (l.765, l'objet `restaurant`)
- Modify: `apps/api/src/modules/ordering/site.service.ts` (l.53-58)
- Modify: `apps/api/src/modules/tenants/tenants.service.ts` (`TENANT_ME_FIELDS` l.29 et `publicBySlug` l.85-100)
- Modify: `apps/api/src/modules/loyalty/loyalty-public.service.ts` (l.43-48 et l.82-88)
- Modify: `apps/api/src/modules/devices/tenant-brand.repository.ts` (l.23, le `.select`)

**Interfaces:**
- Consumes : `Brand`, `BrandSchema`, `marqueEffective`, `brandColorDe`, `logoUrlDe` (Tasks 1, 4).
- Produces : `brand: Brand` sur `PublicSiteTenant`, `LoyaltyPublicProgram.restaurant`, la vue `publicBySlug`, et sur `restaurant` de `loyalty.ts`. Les champs plats sont désormais **dérivés** de `brand` dans ces charges.

- [ ] **Step 1 : Contrats — ajouter `brand` (nullable pour la transition côté client démo)**

`packages/contracts/src/ordering.ts`, dans le type public du tenant (celui qui porte `logoUrl: string | null; brandColor: string;` vers l.370) — ajouter le champ **et** un `import type { Brand } from './marque';` en tête (import de type uniquement : ce fichier est réexporté par `index.ts`, un import de valeur créerait un cycle CJS) :

```ts
  /** Le masque d'identité — toujours présent côté API (repli Nuit sinon). */
  brand: Brand;
```

`packages/contracts/src/loyalty-public.ts`, l'objet `restaurant` (l.20-27) — ajouter à côté de `brandColor`/`logoUrl`, avec `import { BrandSchema } from './marque';` en tête (ce fichier n'est pas dans un cycle : `marque.ts` n'importe rien de `loyalty-public`) :

```ts
        brand: BrandSchema,
```

`packages/contracts/src/loyalty.ts` l.765, l'objet `restaurant: z.object({ slug, name, brandColor }).strict()` — ajouter `brand: BrandSchema.nullable().default(null)` (cette charge est aussi produite par des fixtures de test qui ne portent pas `brand`).

Run : `pnpm --filter @sm/contracts typecheck && pnpm --filter @sm/contracts build && pnpm --filter @sm/contracts test`
Expected : succès.

- [ ] **Step 2 : Écrire le test API qui échoue**

Créer `apps/api/src/modules/ordering/site-brand.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, marqueEffective, brandColorDe, logoUrlDe } from '@sm/contracts';
import { tenantPublicDe } from './site.service';

describe('la charge publique du site porte le masque', () => {
  it('un tenant repris rend son brand tel quel, et les plats en dérivent', () => {
    const t = { slug: 'x', name: 'X', brand: DIRECTIONS.soleil, brandColor: '#000000', logoUrl: null, address: '', phones: [], hours: [] };
    const v = tenantPublicDe(t);
    expect(v.brand).toEqual(DIRECTIONS.soleil);
    expect(v.brandColor).toBe(brandColorDe(DIRECTIONS.soleil));
    expect(v.logoUrl).toBe(logoUrlDe(DIRECTIONS.soleil));
  });

  it('un tenant non repris rend le repli Nuit avec son accent', () => {
    const t = { slug: 'x', name: 'X', brand: null, brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png', address: '', phones: [], hours: [] };
    const v = tenantPublicDe(t);
    expect(v.brand.preset).toBe('nuit');
    expect(v.brand.palette.accent).toBe('#2e9e4f');
    expect(v.brandColor).toBe('#2e9e4f');
    expect(v.logoUrl).toBe('https://r2/l.png');
    expect(v.brand).toEqual(marqueEffective(t));
  });
});
```

Run : `pnpm --filter @sm/api test -- site-brand` — Expected : FAIL, `tenantPublicDe` n'existe pas.

- [ ] **Step 3 : Extraire `tenantPublicDe` dans `site.service.ts`**

Au-dessus de la classe, une fonction **exportée et pure** ; puis l'appeler dans `site()` à la place du bloc `tenant: { ... }` (l.53-64) :

```ts
import { brandColorDe, logoUrlDe, marqueEffective } from '@sm/contracts';

/**
 * La vue publique de l'établissement — EXPORTÉE pour être testée sans Mongo.
 * Les champs plats sont DÉRIVÉS du masque : une seule vérité, l'accent ne
 * peut plus diverger de la palette.
 */
export function tenantPublicDe(tenant: {
  slug?: unknown; name?: unknown; brand?: unknown; brandColor?: unknown; logoUrl?: unknown;
  address?: unknown; phones?: unknown[]; hours?: Array<{ day?: unknown; lunch?: { open: string; close: string } | null; dinner?: { open: string; close: string } | null } | null>;
}) {
  const brand = marqueEffective({
    brand: (tenant.brand as Parameters<typeof marqueEffective>[0]['brand']) ?? null,
    brandColor: typeof tenant.brandColor === 'string' ? tenant.brandColor : null,
    logoUrl: typeof tenant.logoUrl === 'string' ? tenant.logoUrl : null,
  });
  return {
    slug: String(tenant.slug ?? ''),
    name: String(tenant.name ?? ''),
    brand,
    logoUrl: logoUrlDe(brand),
    brandColor: brandColorDe(brand),
    address: String(tenant.address ?? ''),
    phones: (tenant.phones ?? []).map(String),
    hours: (tenant.hours ?? []).map((h) => ({
      day: Number(h?.day ?? 0),
      lunch: h?.lunch ? { open: h.lunch.open, close: h.lunch.close } : null,
      dinner: h?.dinner ? { open: h.dinner.open, close: h.dinner.close } : null,
    })),
  };
}
```

Et dans `site()` : `tenant: tenantPublicDe(tenant),`.

- [ ] **Step 4 : Les trois autres charges**

`tenants.service.ts` : ajouter `brand: 1,` à `TENANT_ME_FIELDS` (après `brandColor: 1,`) ; dans `publicBySlug`, remplacer `logoUrl: t.logoUrl, brandColor: t.brandColor,` par :

```ts
      brand: marqueEffective(t),
      logoUrl: logoUrlDe(marqueEffective(t)),
      brandColor: brandColorDe(marqueEffective(t)),
```

(importer `brandColorDe, logoUrlDe, marqueEffective` depuis `@sm/contracts`).

`loyalty-public.service.ts`, aux deux endroits (l.43-48 et l.82-88) qui construisent `restaurant` :

```ts
      restaurant: {
        slug: String(tenant.slug),
        name: String(tenant.name),
        brand: marqueEffective(tenant),
        brandColor: brandColorDe(marqueEffective(tenant)),
        logoUrl: logoUrlDe(marqueEffective(tenant)),
      },
```

`devices/tenant-brand.repository.ts` l.23 : ajouter `brand: 1` au `.select(...)` puis, là où l'objet est rendu, poser `brandColor: brandColorDe(marqueEffective(tenant))` et `logoUrl: logoUrlDe(marqueEffective(tenant))` — **le contrat `devices.ts` ne change pas**, seules ses valeurs sont dérivées.

- [ ] **Step 5 : Voir passer, toute l'API**

Run : `pnpm --filter @sm/api typecheck && pnpm --filter @sm/api test`
Expected : PASS. Si un test de fidélité échoue parce qu'une fixture ne porte pas `brand`, **c'est le contrat `loyalty.ts` qui doit rester `.nullable().default(null)`** — pas la fixture qu'on bricole.

- [ ] **Step 6 : Commit**

```bash
git add packages/contracts/src apps/api/src/modules/ordering apps/api/src/modules/tenants/tenants.service.ts apps/api/src/modules/loyalty/loyalty-public.service.ts apps/api/src/modules/devices/tenant-brand.repository.ts
git commit -m "feat : les charges publiques portent le masque — et les champs plats en dérivent, une seule vérité"
```

---

### Task 7 : `PATCH /tenants/me/marque` et `PATCH /crm/tenants/:id/marque` — l'API rejoue AA

**Files:**
- Create: `apps/api/src/modules/tenants/marque.ts` — la garde, pure
- Create: `apps/api/src/modules/tenants/marque.test.ts`
- Modify: `apps/api/src/modules/tenants/tenants.controller.ts`, `tenants.service.ts`
- Modify: `apps/api/src/modules/crm/admin.controller.ts`, `admin.service.ts`

**Interfaces:**
- Produces : `exigerAA(brand: Brand): void` — lève `BadRequestException({ message: 'Contraste insuffisant', verdicts })` ; `TenantsService.updateMarque(tenantId, brand)` ; `AdminService.changeMarque(actor, id, brand)`.

- [ ] **Step 1 : Test de la garde**

```ts
// apps/api/src/modules/tenants/marque.test.ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { exigerAA } from './marque';

describe('l’API ne fait pas confiance à l’éditeur', () => {
  it('laisse passer une direction dessinée', () => {
    expect(() => exigerAA(DIRECTIONS.marche)).not.toThrow();
  });

  it('refuse en 400 un masque qui échoue AA — avec les couples et les nuances proposées', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    try {
      exigerAA(pale);
      throw new Error('aurait dû lever');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const corps = (e as BadRequestException).getResponse() as { message: string; verdicts: { couple: string; ok: boolean; proposition: string | null }[] };
      expect(corps.message).toBe('Contraste insuffisant');
      const rate = corps.verdicts.find((v) => v.couple === 'ink/ground');
      expect(rate?.ok).toBe(false);
      expect(rate?.proposition).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
```

Run : `pnpm --filter @sm/api test -- modules/tenants/marque` — Expected : FAIL.

- [ ] **Step 2 : La garde**

```ts
// apps/api/src/modules/tenants/marque.ts
import { BadRequestException } from '@nestjs/common';
import { contraste, type Brand } from '@sm/contracts';

/**
 * L'éditeur empêche d'arriver ici avec un masque illisible ; l'API ne s'y fie
 * pas. Le 400 rend les couples en échec ET la nuance la plus proche qui
 * passe — le même remède que l'éditeur propose en un clic.
 */
export function exigerAA(brand: Brand): void {
  const v = contraste(brand);
  if (v.ok) return;
  throw new BadRequestException({
    message: 'Contraste insuffisant',
    verdicts: v.verdicts.filter((x) => !x.ok),
  });
}
```

- [ ] **Step 3 : Les deux routes**

`tenants.controller.ts` — après `updateIdentity` :

```ts
  /**
   * Le masque d'identité du restaurateur — ce que voient SES clients. Validé
   * par le contrat, puis le contraste est REJOUÉ ici : l'API ne fait pas
   * confiance à l'écran.
   */
  @Roles('owner', 'gerant')
  @Patch('tenants/me/marque')
  updateMarque(@TenantId() tenantId: string, @Body(zod(BrandSchema)) body: Brand) {
    return this.tenants.updateMarque(tenantId, body);
  }
```

(ajouter `BrandSchema, type Brand` à l'import `@sm/contracts`.)

`tenants.service.ts` — après `updateIdentity` :

```ts
  async updateMarque(tenantId: string, brand: Brand) {
    exigerAA(brand);
    return this.tenants.findByIdAndUpdate(tenantId, { $set: { brand } }, { new: true });
  }
```

(importer `exigerAA` depuis `./marque` et `type Brand` depuis `@sm/contracts`.)

`crm/admin.controller.ts` — après `changeOffre` (même forme, même garde de classe `@Roles('sm_admin')`) :

```ts
  /** Le masque posé à l'installation, depuis la fiche client du CRM. */
  @Patch('tenants/:id/marque')
  changeMarque(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(BrandSchema)) body: Brand,
  ) {
    return this.admin.changeMarque(actor, id, body);
  }
```

`crm/admin.service.ts` — à côté de `changeOffre`, sur le même motif (le journal `adminLogs` y consigne « qui, quand » ; reprendre exactement la façon dont `changeOffre` écrit ce journal, avec l'action `'marque'`) :

```ts
  async changeMarque(actor: JwtPayload, id: string, brand: Brand) {
    exigerAA(brand);
    const t = await this.tenants.findByIdAndUpdate(id, { $set: { brand } }, { new: true });
    if (!t) throw new NotFoundException('Tenant introuvable');
    await this.journal(actor, id, 'marque', { preset: brand.preset });
    return t;
  }
```

Si `journal()` n'existe pas sous ce nom, utiliser la méthode que `changeOffre` appelle pour écrire dans `adminLogs` — **ne pas inventer une seconde écriture de journal**. Si `isPlatformLogAction` (contracts) borne les actions admises, ajouter `'marque'` à cette liste dans `packages/contracts` et rebâtir.

- [ ] **Step 4 : Voir passer**

Run : `pnpm --filter @sm/api typecheck && pnpm --filter @sm/api test`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/api/src/modules/tenants apps/api/src/modules/crm packages/contracts/src
git commit -m "feat : poser un masque — deux routes, et l'API rejoue le contraste plutôt que de croire l'écran"
```

---

### Task 8 : La reprise des tenants existants — `backfill-brand.ts`

**Files:**
- Create: `packages/db/src/backfill-brand.ts`
- Create: `packages/db/src/backfill-brand.test.ts`
- Modify: `packages/db/package.json` (script)
- Modify: `scripts/reprise-mongo.sh` (l'aide-mémoire des tâches, l.51-54)

**Interfaces:**
- Produces : `repriseMarque(tenant: { brand?: unknown; brandColor?: unknown; logoUrl?: unknown }): Brand | null` — `null` si déjà repris (idempotence par construction).

- [ ] **Step 1 : Test**

```ts
// packages/db/src/backfill-brand.test.ts
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, contraste } from '@sm/contracts';
import { repriseMarque } from './backfill-brand';

describe('la reprise du masque', () => {
  it('un tenant sans brand reçoit Nuit avec son accent et son logo', () => {
    const b = repriseMarque({ brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png' });
    expect(b?.preset).toBe('nuit');
    expect(b?.palette.accent).toBe('#2e9e4f');
    expect(b?.logo.mark.dark).toBe('https://r2/l.png');
    expect(contraste(b!).ok).toBe(true);
  });

  /** L'IDEMPOTENCE : un masque déjà posé n'est JAMAIS recalculé. */
  it('ne touche pas un tenant déjà repris', () => {
    expect(repriseMarque({ brand: DIRECTIONS.soleil, brandColor: '#000000' })).toBeNull();
  });

  it('un accent absent ou invalide retombe sur le laiton', () => {
    expect(repriseMarque({})?.palette.accent).toBe('#c9a15a');
    expect(repriseMarque({ brandColor: 'bleu' })?.palette.accent).toBe('#c9a15a');
  });
});
```

Run : `pnpm --filter @sm/db test -- backfill-brand` — Expected : FAIL.

- [ ] **Step 2 : Le script, sur le gabarit de `backfill-founder.ts`**

```ts
/**
 * Reprend les tenants d'AVANT le masque d'identité.
 *
 * Jusqu'au 01/09/2026, un tenant ne portait qu'un logo et une couleur. Le
 * masque (`brand`) stocke désormais cinq rôles, une paire typographique, une
 * forme, un mouvement et quatre logos. Sans reprise, ces tenants n'ont pas de
 * `brand` — le résolveur leur dérive Nuit à la lecture, donc RIEN ne casse ;
 * mais un `brand` explicite est ce que l'éditeur (plan B) modifiera, et ce que
 * les captures de référence documentent.
 *
 * ── Garanties ──────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer`. `$set` ciblé sur `brand` seul. Idempotent
 * par construction : un tenant qui a déjà `brand` est hors du lot.
 *
 *   pnpm --filter @sm/db backfill:brand              # montre
 *   pnpm --filter @sm/db backfill:brand --appliquer  # écrit
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { marqueDeRepli, type Brand } from '@sm/contracts';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

/** La décision, pure — `null` quand il n'y a rien à faire. */
export function repriseMarque(tenant: {
  brand?: unknown;
  brandColor?: unknown;
  logoUrl?: unknown;
}): Brand | null {
  if (tenant.brand) return null;
  return marqueDeRepli(
    typeof tenant.brandColor === 'string' ? tenant.brandColor : null,
    typeof tenant.logoUrl === 'string' ? tenant.logoUrl : null,
  );
}

async function main(): Promise<void> {
  const appliquer = process.argv.includes('--appliquer');
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquante');

  await mongoose.connect(uri);
  const Tenant = mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

  const aReprendre = await Tenant.find({ brand: { $in: [null, undefined] } }).lean();
  console.log(`\n${aReprendre.length} tenant(s) sans masque — base « ${mongoose.connection.name} »\n`);
  if (aReprendre.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const lot: { _id: unknown; nom: string; brand: Brand }[] = [];
  for (const t of aReprendre) {
    const brand = repriseMarque(t);
    if (!brand) continue;
    console.log(`  ${String(t.name ?? t.slug)} → Nuit · accent ${brand.palette.accent} · logo ${brand.logo.mark.dark ? 'oui' : 'non'}`);
    lot.push({ _id: t._id, nom: String(t.name ?? t.slug), brand });
  }

  if (!appliquer) {
    console.log('\nRien écrit. Relancer avec --appliquer pour enregistrer.\n');
    await mongoose.disconnect();
    return;
  }

  for (const { _id, brand } of lot) {
    await Tenant.updateOne({ _id }, { $set: { brand } });
  }
  console.log(`\n${lot.length} tenant(s) repris.\n`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 3 : Le script pnpm et l'aide-mémoire**

`packages/db/package.json`, après `"backfill:contact"` :

```json
    "backfill:brand": "tsx src/backfill-brand.ts"
```

`scripts/reprise-mongo.sh`, dans le bloc `USAGE` après la ligne `backfill:tracking` :

```
    backfill:brand     pose le masque d'identité (Nuit + accent + logo) sur les tenants d'avant
```

- [ ] **Step 4 : Voir passer**

Run : `pnpm --filter @sm/db test && pnpm --filter @sm/db typecheck`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/db/src/backfill-brand.ts packages/db/src/backfill-brand.test.ts packages/db/package.json scripts/reprise-mongo.sh
git commit -m "feat : la reprise du masque — lecture seule par défaut, idempotente, sur le motif maison"
```

---

### Task 9 : Côté web — les jetons manquants, les polices, et `styleDuMasque()`

**Files:**
- Modify: `apps/web/src/app/globals.css` (bloc `:root` et bloc `@theme inline`)
- Create: `apps/web/src/components/masque/polices.ts`
- Create: `apps/web/src/components/masque/styleDuMasque.ts`
- Create: `apps/web/src/components/masque/styleDuMasque.test.ts`

**Interfaces:**
- Consumes : `resoudreMarque`, `FONT_FAMILIES`, `Brand` (contracts).
- Produces : `styleDuMasque(brand: Brand): CSSProperties` (les variables + `colorScheme`) ; `classesPolices: string` (toutes les classes `variable` next/font, à poser sur la même racine) ; utilitaires Tailwind `text-inksoft`, `text-accentink`, `bg-accentwash`, `text-onok`, `text-onalert`, `text-onprep`, `bg-surface3`, `bg-surface6`, `font-display`, `font-body`, `font-mono`, `duration-fast/med/slow`.

- [ ] **Step 1 : Les jetons dans `globals.css`**

Dans `:root`, après `--cf-on-accent: #12100d;` :

```css
  /* ── Masque d'identité : dérivés que le résolveur surcharge par tenant ── */
  --cf-ink-soft: #cfcfcf;
  --cf-accent-ink: #dbc191;
  --cf-accent-wash: rgba(201, 161, 90, 0.12);
  --cf-focus: rgba(201, 161, 90, 0.6);
  --cf-on-green: #000;
  --cf-on-red: #fff;
  --cf-on-amber: #000;
  --cf-font-display: var(--font-inter), system-ui, sans-serif;
  --cf-font-body: var(--font-inter), system-ui, sans-serif;
  --cf-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

Dans `@theme inline`, après `--color-prept: var(--cf-amber-t);` :

```css
  /* Masque d'identité — mêmes conventions de nommage que ci-dessus */
  --color-inksoft: var(--cf-ink-soft);
  --color-accentink: var(--cf-accent-ink);
  --color-accentwash: var(--cf-accent-wash);
  --color-focus: var(--cf-focus);
  --color-onok: var(--cf-on-green);
  --color-onalert: var(--cf-on-red);
  --color-onprep: var(--cf-on-amber);
  --color-surface3: var(--cf-surface-3);
  --color-surface6: var(--cf-surface-6);
  --font-display: var(--cf-font-display);
  --font-body: var(--cf-font-body);
  --font-mono: var(--cf-font-mono);
  --duration-fast: var(--sm-t-fast);
  --duration-med: var(--sm-t-med);
  --duration-slow: var(--sm-t-slow);
```

Ne pas ajouter `--radius-sm/md/lg` : ces noms sont des valeurs Tailwind par défaut et les écraser toucherait l'admin. Les surfaces client emploient `rounded-ctrl/card/panel/pill`, dont les `--cf-r-*` sont déjà surchargés par le résolveur.

- [ ] **Step 2 : Les polices — `next/font/google`, statiques, sans préchargement**

```ts
// apps/web/src/components/masque/polices.ts
/**
 * LES DIX-HUIT FAMILLES DU MASQUE — déclarées ici, une fois, statiquement.
 *
 * next/font exige des appels au niveau module : on ne peut pas choisir une
 * famille à l'exécution. On les déclare donc TOUTES, avec `preload: false` —
 * next/font n'émet alors que des @font-face, et le navigateur ne télécharge
 * que les familles que le texte utilise réellement : celles de la paire du
 * tenant. Le résolveur (contracts) émet `var(--police-<slug>)`.
 *
 * Le test `polices.test.ts` garantit que FONT_FAMILIES (contracts) et cette
 * liste ne divergent jamais.
 */
import {
  Alegreya_Sans, Archivo, Archivo_Black, Bricolage_Grotesque, Cormorant_Garamond,
  Familjen_Grotesk, Figtree, Fraunces, Instrument_Sans, JetBrains_Mono, Lato,
  Libre_Baskerville, Manrope, Nunito, Nunito_Sans, Outfit, Playfair_Display, Source_Sans_3,
} from "next/font/google";

const commun = { subsets: ["latin"] as const, display: "swap" as const, preload: false };

const fraunces = Fraunces({ ...commun, variable: "--police-fraunces" });
const sourceSans3 = Source_Sans_3({ ...commun, variable: "--police-source-sans-3" });
const bricolage = Bricolage_Grotesque({ ...commun, variable: "--police-bricolage-grotesque" });
const archivo = Archivo({ ...commun, variable: "--police-archivo" });
const alegreyaSans = Alegreya_Sans({ ...commun, weight: ["400", "500", "700", "800"], variable: "--police-alegreya-sans" });
const jetbrains = JetBrains_Mono({ ...commun, variable: "--police-jetbrains-mono" });
const outfit = Outfit({ ...commun, variable: "--police-outfit" });
const manrope = Manrope({ ...commun, variable: "--police-manrope" });
const cormorant = Cormorant_Garamond({ ...commun, weight: ["400", "500", "600", "700"], variable: "--police-cormorant-garamond" });
const figtree = Figtree({ ...commun, variable: "--police-figtree" });
const nunito = Nunito({ ...commun, variable: "--police-nunito" });
const nunitoSans = Nunito_Sans({ ...commun, variable: "--police-nunito-sans" });
const playfair = Playfair_Display({ ...commun, variable: "--police-playfair-display" });
const familjen = Familjen_Grotesk({ ...commun, variable: "--police-familjen-grotesk" });
const instrument = Instrument_Sans({ ...commun, variable: "--police-instrument-sans" });
const libreBaskerville = Libre_Baskerville({ ...commun, weight: ["400", "700"], variable: "--police-libre-baskerville" });
const lato = Lato({ ...commun, weight: ["400", "700", "900"], variable: "--police-lato" });
const archivoBlack = Archivo_Black({ ...commun, weight: "400", variable: "--police-archivo-black" });

const TOUTES = [
  fraunces, sourceSans3, bricolage, archivo, alegreyaSans, jetbrains, outfit, manrope,
  cormorant, figtree, nunito, nunitoSans, playfair, familjen, instrument, libreBaskerville, lato, archivoBlack,
];

/** Les slugs déclarés — pour le test de parité avec contracts. */
export const SLUGS_DECLARES: readonly string[] = TOUTES.map((f) => f.variable.replace("--police-", "")).sort();

/** À poser sur la racine de chaque surface client, à côté de `styleDuMasque()`. */
export const classesPolices: string = TOUTES.map((f) => f.variable).join(" ");
```

Créer `apps/web/src/components/masque/polices.test.ts` — **sans importer `polices.ts`** (next/font ne se charge pas sous vitest) : on compare la LISTE DE SOURCE aux familles du contrat.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES } from "@sm/contracts";

describe("les polices du masque", () => {
  it("chaque famille du contrat est déclarée côté web, et aucune de plus", () => {
    const src = readFileSync(join(__dirname, "polices.ts"), "utf8");
    const declarees = [...src.matchAll(/variable:\s*"--police-([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
    expect(declarees).toEqual([...FONT_FAMILIES]);
  });
});
```

- [ ] **Step 3 : `styleDuMasque()` — test puis implémentation**

```ts
// apps/web/src/components/masque/styleDuMasque.test.ts
import { describe, expect, it } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { styleDuMasque } from "./styleDuMasque";

describe("styleDuMasque", () => {
  it("rend toutes les variables du résolveur plus colorScheme", () => {
    const s = styleDuMasque(DIRECTIONS.brasserie) as Record<string, string>;
    expect(s["--cf-bg"]).toBe("#f5efe3");
    expect(s["--cf-font-display"]).toContain("var(--police-fraunces)");
    expect(s.colorScheme).toBe("light");
  });
});
```

```ts
// apps/web/src/components/masque/styleDuMasque.ts
import type { CSSProperties } from "react";
import { resoudreMarque, type Brand } from "@sm/contracts";

/**
 * Le masque en `style` inline sur la RACINE d'une surface client. Tailwind v4
 * (`@theme inline`) résout `var(--cf-*)` à l'usage : tout le sous-arbre
 * change de peau, l'admin — où ce style n'est jamais posé — reste intact.
 * `colorScheme` fait suivre les contrôles natifs et les ascenseurs.
 */
export function styleDuMasque(brand: Brand): CSSProperties {
  const { vars, colorScheme } = resoudreMarque(brand);
  return { ...vars, colorScheme } as CSSProperties;
}
```

Run : `pnpm --filter @sm/web test -- masque` — Expected : PASS (2 fichiers).

- [ ] **Step 4 : Build web pour valider les polices**

Run : `pnpm --filter @sm/web build`
Expected : succès. (next/font télécharge les familles au build ; une famille mal orthographiée casse ici, pas en production.)

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/masque
git commit -m "feat : le masque côté web — jetons, dix-huit familles déclarées, et un style à poser sur une racine"
```

---

### Task 10 : Poser le masque sur les trois racines — vitrine, suivi, fidélité

**Files:**
- Modify: `apps/web/src/components/order/api.ts` (`SiteTenant`, `loadSite`, `loadSiteLegacy`, `loadBrandColor` → `loadBrand`)
- Modify: `apps/web/src/components/order/demo/fixture.ts` (`demoTenant()`), `apps/web/src/lib/demo/snapshot.ts:37`
- Modify: `apps/web/src/components/order/Storefront.tsx` (l.100 et l.203-217)
- Modify: `apps/web/src/components/order/Tracking.tsx` (l.96-100) et `apps/web/src/app/t/[id]/page.tsx` (l'appel à `loadBrandColor`)
- Modify: `apps/web/src/components/loyalty/LoyaltyCardApp.tsx` (l.226-236)

**Interfaces:**
- Consumes : `styleDuMasque`, `classesPolices` (Task 9) ; `marqueEffective`, `DIRECTIONS` (contracts).
- Produces : `SiteTenant.brand: Brand` ; `loadBrand(slug): Promise<Brand>`.

- [ ] **Step 1 : Le type et le chargement**

`api.ts` — dans `SiteTenant`, ajouter `brand: Brand;` (avec `import { marqueEffective, type Brand } from "@sm/contracts";`). Dans `loadSite`, l'objet `tenant` gagne :

```ts
          brand: marqueEffective({
            brand: site.tenant.brand ?? null,
            brandColor: site.tenant.brandColor,
            logoUrl: site.tenant.logoUrl,
          }),
```

Dans `loadSiteLegacy` (l.487), même ligne à partir de ses champs plats. Remplacer `loadBrandColor` par :

```ts
  /**
   * Le masque seul (page de suivi : le ticket ne porte pas la marque).
   * Un échec retombe sur le masque de repli — jamais sur une page cassée.
   */
  async function loadBrand(slug: string): Promise<Brand> {
    try {
      const tenant = await getJson<{ brand?: Brand | null; brandColor?: string; logoUrl?: string | null }>(
        `/public/tenants/${encodeURIComponent(slug)}`,
        { revalidate: SITE_TTL },
      );
      return marqueEffective({ brand: tenant.brand ?? null, brandColor: tenant.brandColor ?? null, logoUrl: tenant.logoUrl ?? null });
    } catch {
      return marqueEffective({ brand: null, brandColor: null, logoUrl: null });
    }
  }
```

Et en bas : `export const loadBrand = networkApi.loadBrand;` (supprimer `loadBrandColor` et son export ; corriger l'appel dans `app/t/[id]/page.tsx` : `const brand = await loadBrand(slug)` passé en prop `brand` à `Tracking`).

Fixtures : `demo/fixture.ts` `demoTenant()` et `lib/demo/snapshot.ts` — ajouter `brand: DIRECTIONS.nuit` (import depuis `@sm/contracts`). La démo porte Nuit, l'identité Snack Manager.

- [ ] **Step 2 : Les trois racines**

`Storefront.tsx` — supprimer `const accent = safeColor(site.tenant.brandColor);` et le bloc `themed` ; à la place :

```ts
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { classesPolices } from "@/components/masque/polices";
// …
  const masque = styleDuMasque(site.tenant.brand);
```

et sur la racine : `style={masque}` et `className={cx(classesPolices, "font-body min-h-dvh bg-bg text-ink", …)}`.

`Tracking.tsx` — la prop `accent: string` devient `brand: Brand` ; `themed` → `styleDuMasque(brand)` ; `<main style={masque} className={cx(classesPolices, "font-body min-h-dvh bg-bg pb-16 text-ink")}>`.

`LoyaltyCardApp.tsx` — supprimer `tenantAccentPalette` et `style` ; `const masque = styleDuMasque(catalog.restaurant.brand);` ; racine `style={masque} className={cx(classesPolices, "font-body min-h-dvh bg-bg …")}`.

Si `safeColor`/`onAccent` de `order/helpers.ts` n'ont plus d'appelant après cela : les **laisser** (le test `couleurs-brutes` ne les vise pas et `safeColor` reste utile aux tests), mais retirer leurs imports morts — eslint le signalera.

- [ ] **Step 3 : Typecheck, tests, build**

Run : `pnpm --filter @sm/web typecheck && pnpm --filter @sm/web test && pnpm --filter @sm/web lint && pnpm --filter @sm/web build`
Expected : tout vert. Les tests de la démo (`mode.test.ts`) et du suivi doivent encore passer — s'ils comparent un `brandColor`, ils comparent désormais `brand.palette.accent`.

- [ ] **Step 4 : Vérifier à l'œil, en dev, que RIEN n'a bougé**

Run : `pnpm --filter @sm/web dev` puis ouvrir `http://localhost:3000/r/demo?demo=1`.
Expected : la vitrine de démonstration est **visuellement identique** à avant (Nuit ≈ l'identité SM : fond `#14151a` au lieu de `#000`, c'est le seul écart attendu et il est voulu).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src
git commit -m "feat : les trois surfaces client portent le masque — l'accent seul devient l'identité entière"
```

---

### Task 11 : Le garde « couleurs brutes » — et le passage des composants `ui` en sémantique

Le garde est écrit AVEC une liste d'attente : les fichiers pas encore repassés y figurent, et chaque tâche de migration la vide un peu. À la fin de la Task 12, la liste est vide et le garde est total. C'est ainsi que chaque commit reste vert.

**Files:**
- Create: `apps/web/src/components/masque/couleurs-brutes.test.ts`
- Modify: `apps/web/src/components/ui/*.tsx` (14 fichiers, 37 occurrences)

**La table de passage** — à appliquer partout, sans exception ni jugement au cas par cas :

| Brut | Sémantique | Pourquoi ça marche dans les deux modes |
|---|---|---|
| `border-white/N`, `divide-white/N` | `border-ink/N`, `divide-ink/N` | l'encre est blanche en sombre, sombre en clair — le filet suit |
| `bg-white/N` | `bg-ink/N` | idem : un voile d'encre |
| `text-white` | `text-ink` | sur un fond de la marque |
| `text-white` sur `bg-accent` | `text-onaccent` | |
| `text-white` / `text-black` sur `bg-ok`, `bg-alert`, `bg-prep` | `text-onok`, `text-onalert`, `text-onprep` | calculé par contraste réel |
| `text-white` sur `bg-btndark` / `bg-fill` | `text-onfill` | |
| `bg-black`, `bg-[#000]`, `bg-[#111]` | `bg-bg` / `bg-surface` | selon le niveau |
| `bg-black/N` (voiles, fonds de modale) | `bg-bg/N` | le voile prend la couleur du fond — pâle sur clair, noir sur sombre |
| `bg-[linear-gradient(…#111,#000)]` | `bg-surface` | le dégradé de tête n'était qu'une surface |
| `text-neutral-*`, `text-zinc-*`, `text-gray-*` | `text-mut` ou `text-inksoft` | |
| `bg-[image:var(--cf-card-gradient)]` | inchangé | déjà un jeton |

- [ ] **Step 1 : Le garde, avec sa liste d'attente**

```ts
// apps/web/src/components/masque/couleurs-brutes.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LA DISCIPLINE QUI REND LE MASQUE TOTAL — un contrôle, pas une consigne.
 *
 * Une couleur brute dans une surface client est un trou dans le masque : sur
 * une Brasserie crème, un `text-white` disparaît et un `border-white/6` n'est
 * plus un filet. Ce test parcourt les répertoires client et échoue sur la
 * première occurrence, avec fichier et ligne.
 */
const SRC = join(__dirname, "..", "..");
const REPERTOIRES = ["app/r", "app/embed", "app/t", "components/order", "components/ui", "components/loyalty"];

/** Fichiers pas encore repassés — cette liste DOIT être vide à la fin de la Task 12. */
const EN_ATTENTE = new Set<string>([
  "components/order/primitives.tsx",
  "components/order/Checkout.tsx",
  "components/order/Storefront.tsx",
  "components/order/Tracking.tsx",
  "components/order/MenuBoard.tsx",
  "components/order/ProductSheet.tsx",
  "components/order/StripeCard.tsx",
  "components/order/TurnstileCheck.tsx",
  "app/r/[slug]/not-found.tsx",
  "components/loyalty/LoyaltyCardApp.tsx",
]);

const BRUT = [
  /\b(?:bg|text|border|divide|ring|from|to|via|fill|stroke)-(?:white|black)(?:\/\d+)?\b/,
  /\b(?:bg|text|border|divide)-(?:neutral|zinc|gray|slate|stone)-\d+\b/,
  /\b(?:bg|text|border|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/,
  /\[linear-gradient\([^\]]*#[0-9a-fA-F]{3,8}/,
  /\brgba?\(\s*(?:255|0)\s*,\s*(?:255|0)\s*,\s*(?:255|0)/,
];

function* fichiers(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("aucune couleur brute dans les surfaces client", () => {
  for (const rep of REPERTOIRES) {
    it(`${rep} ne porte que des jetons`, () => {
      const fautes: string[] = [];
      for (const f of fichiers(join(SRC, rep))) {
        const rel = relative(SRC, f);
        if (EN_ATTENTE.has(rel)) continue;
        const lignes = readFileSync(f, "utf8").split("\n");
        lignes.forEach((l, i) => {
          if (l.trimStart().startsWith("//") || l.trimStart().startsWith("*")) return;
          for (const re of BRUT) if (re.test(l)) fautes.push(`${rel}:${i + 1} — ${l.trim().slice(0, 100)}`);
        });
      }
      expect(fautes, fautes.join("\n")).toEqual([]);
    });
  }

  it("la liste d’attente ne contient que des fichiers qui existent encore", () => {
    for (const rel of EN_ATTENTE) expect(() => readFileSync(join(SRC, rel))).not.toThrow();
  });
});
```

Run : `pnpm --filter @sm/web test -- couleurs-brutes`
Expected : **FAIL sur `components/ui`** (37 occurrences listées, fichier:ligne). Les autres répertoires passent grâce à la liste d'attente. Si un fichier de `app/r`, `app/embed`, `app/t` ou `components/loyalty` non listé échoue, l'ajouter à `EN_ATTENTE` — il sera traité en Task 12.

- [ ] **Step 2 : Repasser `components/ui`**

Appliquer la table à `Btn.tsx`, `Card.tsx`, `Chip.tsx`, `EmptyState.tsx`, `Drawer.tsx`, `Kpi.tsx`, `IconBtn.tsx`, `SlotToggle.tsx`, `fields.tsx`, `Pill.tsx`, `Toggle.tsx`, `Modal.tsx`, `StatusBadge.tsx`, `Toast.tsx`. Les cas qui demandent une lecture :

- `Btn.tsx` VARIANTS : `ink: "bg-btndark text-onfill hover:bg-[#333]"` — le `hover:bg-[#333]` devient `hover:bg-fill` ; `ghost: "border border-line bg-ink/3 text-ink hover:border-ink/25 hover:bg-ink/8"` ; `danger: "bg-alert text-onalert …"` ; `success: "bg-ok text-onok …"` ; `gold: "bg-gold text-[#1C1612] …"` → `text-[#1C1612]` est un brut : le laiton est fixe et sombre dessus est toujours juste → **garder** mais l'écrire `text-onfill`? Non : `onfill` suit le mode. Choisir `text-bg`? Non plus. Le seul texte toujours juste sur le laiton fixe est un noir fixe : remplacer par `text-[color:var(--cf-on-gold)]` et ajouter `--cf-on-gold: #1c1612;` dans `:root` de `globals.css` et `--color-ongold: var(--cf-on-gold);` dans `@theme inline` → `text-ongold`.
- `Modal.tsx` overlay `bg-black/65` → `bg-bg/65` ; panneau `border-white/10` → `border-ink/10`.
- `Drawer.tsx` voile `bg-black/55` → `bg-bg/55`.
- `Toast.tsx`, `StatusBadge.tsx` : `text-white` sur sémantiques → `text-onok/onalert/onprep`.

Run : `pnpm --filter @sm/web test -- couleurs-brutes` — Expected : PASS pour `components/ui`.

- [ ] **Step 3 : Vérifier l'admin à l'œil — il ne doit PAS avoir bougé**

Run : `pnpm --filter @sm/web dev`, ouvrir `/admin` (connexion staging ou locale).
Expected : identique. En mode sombre, `ink` = blanc : `bg-ink/6` rend exactement `bg-white/6`. Si une teinte a bougé, c'est qu'un `text-white` était posé sur un fond clair fixe — retrouver le cas et choisir le bon `on*`.

- [ ] **Step 4 : Typecheck, lint, tests, build ; commit**

Run : `pnpm --filter @sm/web typecheck && pnpm --filter @sm/web lint && pnpm --filter @sm/web test && pnpm --filter @sm/web build`

```bash
git add apps/web/src/components/ui apps/web/src/components/masque/couleurs-brutes.test.ts apps/web/src/app/globals.css
git commit -m "fix : les composants partagés ne connaissent plus le blanc — l'encre suit le mode, l'admin ne bouge pas"
```

---

### Task 12 : Les surfaces client en sémantique, et responsive — vitrine, tunnel, suivi, fidélité

Une sous-tâche par groupe de fichiers ; chacune retire ses fichiers de `EN_ATTENTE`, passe le garde, et committe.

**Files:**
- Modify: `apps/web/src/components/order/primitives.tsx`, `Checkout.tsx`, `Storefront.tsx`, `MenuBoard.tsx`, `ProductSheet.tsx`, `Tracking.tsx`, `StripeCard.tsx`, `TurnstileCheck.tsx`, `app/r/[slug]/not-found.tsx`, `components/loyalty/LoyaltyCardApp.tsx`
- Modify: `apps/web/src/components/masque/couleurs-brutes.test.ts` (vider `EN_ATTENTE`)

**La règle responsive, appliquée en même temps** (spec §7) — elle se fait fichier par fichier, au passage :

1. **La grille produits** (`MenuBoard.tsx:235`, aujourd'hui `lg:grid-cols-2`) devient **auto-adaptative sans point de rupture** :
   `grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]` — une colonne sur téléphone, deux sur tablette, trois ou quatre sur ordinateur, sans jamais nommer un écran.
2. **La carte produit** (le composant qui rend UN produit, `MenuBoard.tsx:283-365`) : le parent de la grille prend `@container`, et la carte adapte sa disposition à SA colonne : `flex-col @md:flex-row` (photo au-dessus en colonne étroite, à gauche en large). Tailwind v4 : `@container` et `@md:` sont natifs.
3. **Les titres** : `text-[28px]` → `text-[clamp(1.5rem,1.1rem+2vw,2.25rem)]` ; les corps restent en rem fixes.
4. **Cibles tactiles** : tout `<button>` de la vitrine et du tunnel porte `min-h-11` (44 px) — vérifier `primitives.tsx` (`Btn`, `Stepper`, `Chip`), `Checkout.tsx` (boutons de créneau, de paiement), `ProductSheet.tsx` (options).
5. **Jamais de défilement horizontal** : les listes de puces/catégories (`Storefront.tsx`, rail de catégories) prennent `overflow-x-auto` sur LEUR conteneur, avec `scrollbar-none`, et le `<main>` reste `overflow-x-hidden`.
6. **Polices** : les titres portent `font-display`, les prix `font-mono` **quand le masque le demande** — `resoudreMarque` expose `prixMono` ; le Storefront le lit (`const { prixMono } = resoudreMarque(site.tenant.brand)`) et passe `className={prixMono ? "font-mono tabular-nums" : "tabular-nums"}` aux montants via `primitives.Prix` (créer ce composant s'il n'existe pas : un `<span>` qui formate `euros()`).

- [ ] **Step 12a : `primitives.tsx` + `Storefront.tsx` + `MenuBoard.tsx`** (grille, carte, rail, titres, prix)

Appliquer la table (Task 11) et les six règles ci-dessus. Retirer les trois fichiers de `EN_ATTENTE`.
Run : `pnpm --filter @sm/web test -- couleurs-brutes && pnpm --filter @sm/web typecheck`
Vérifier en dev sur `/r/demo?demo=1` aux trois largeurs (390, 768, 1440) : aucune barre horizontale, grille 1 / 2 / 3-4 colonnes.
Commit : `git commit -am "feat : la vitrine ne connaît plus le blanc — et sa grille s'adapte à la colonne, pas à l'écran"`

- [ ] **Step 12b : `ProductSheet.tsx` + `Checkout.tsx` + `StripeCard.tsx` + `TurnstileCheck.tsx`** (tunnel)

Même méthode. `StripeCard.tsx:83-97` pose des couleurs au Payment Element Stripe via `appearance` — y passer les valeurs **résolues** : `colorBackground: vars['--cf-surface']`, `colorText: vars['--cf-text']`, `colorPrimary: vars['--cf-accent']`, `borderRadius: vars['--cf-r-md']`, `fontFamily` = la famille body (Stripe ne charge pas nos `next/font` : lui donner `fallbackDe(pair.body)` seulement — le champ carte gardera la pile système, c'est accepté). Ces valeurs viennent de `resoudreMarque(site.tenant.brand).vars`, passées en prop.
Retirer les quatre fichiers de `EN_ATTENTE`. Tests, typecheck. Vérifier le tunnel en dev jusqu'à l'écran de paiement (démo).
Commit : `git commit -am "feat : le tunnel de commande porte le masque — jusqu'au champ de carte"`

- [ ] **Step 12c : `Tracking.tsx` + `app/r/[slug]/not-found.tsx` + `LoyaltyCardApp.tsx`**

`Tracking.tsx:109` : `bg-[linear-gradient(180deg,#111,#000)]` → `bg-surface` ; `:169` : `"bg-ok text-onok"`. `LoyaltyCardApp.tsx` : appliquer la table ; les cartes de palier prennent `rounded-card` et `font-display` sur le nom du programme. Retirer les trois fichiers ; **`EN_ATTENTE` doit être vide** — le supprimer entièrement du test ainsi que le `it` sur la liste.
Run : `pnpm --filter @sm/web test && pnpm --filter @sm/web typecheck && pnpm --filter @sm/web lint && pnpm --filter @sm/web build`
Commit : `git commit -am "feat : suivi et fidélité portent le masque — la liste d'attente est vide, le garde est total"`

---

### Task 13 : La PWA de fidélité aux couleurs du masque

**Files:**
- Modify: `apps/web/src/app/r/[slug]/fidelite/manifest.webmanifest/route.ts`
- Modify: `apps/web/src/app/r/[slug]/fidelite/icon.svg/route.ts`
- Modify: `apps/web/src/app/r/[slug]/fidelite/pwa-routes.test.ts`

- [ ] **Step 1 : Mettre à jour le test existant**

Dans `pwa-routes.test.ts`, le CATALOG de fixture reçoit `brand: DIRECTIONS.soleil` (import contracts). Les attentes deviennent : `theme_color` **et** `background_color` = `"#f6ebd9"` (le `ground` de Soleil) ; `icons[0].src` = `…/icon.svg` quand `brand.logo.mark` est vide ; ajouter un second cas avec `logo.mark.light = "https://r2/logo.png"` où `icons[0]` = `{ src: "https://r2/logo.png", sizes: "512x512", type: "image/png", purpose: "any" }`.

Run : `pnpm --filter @sm/web test -- pwa-routes` — Expected : FAIL.

- [ ] **Step 2 : Le manifeste**

```ts
import { logoPour } from "@sm/contracts";
// …
  const brand = catalog.restaurant.brand;
  const ground = brand.palette.ground;
  const logo = logoPour(brand, "mark");
  return Response.json(
    {
      id: path,
      name: `${catalog.restaurant.name} · Fidélité`,
      short_name: catalog.restaurant.name.slice(0, 30),
      description: `Carte et récompenses fidélité ${catalog.restaurant.name}.`,
      lang: "fr",
      dir: "ltr",
      start_url: path,
      scope: path,
      display: "standalone",
      background_color: ground,
      theme_color: ground,
      icons: logo
        ? [{ src: logo, sizes: "512x512", type: "image/png", purpose: "any" }]
        : [{ src: `${path}/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    },
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  );
```

- [ ] **Step 3 : L'icône générée, sur `ground`**

Dans `icon.svg/route.ts`, remplacer le calcul de `accent` et le SVG :

```ts
  const { ground, accent, onAccent } = catalog.restaurant.brand.palette;
  const initial = escapeXml(catalog.restaurant.name.trim().charAt(0).toUpperCase() || "R");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${ground}"/><circle cx="256" cy="256" r="174" fill="${accent}"/><text x="256" y="302" text-anchor="middle" font-family="system-ui,sans-serif" font-size="190" font-weight="900" fill="${onAccent}">${initial}</text></svg>`;
```

- [ ] **Step 4 : Voir passer, commit**

Run : `pnpm --filter @sm/web test -- pwa-routes`

```bash
git add apps/web/src/app/r/[slug]/fidelite
git commit -m "feat : l'icône sur le téléphone du client est celle du restaurant, pas la nôtre"
```

---

### Task 14 : La matrice de captures — 3 surfaces × 6 directions × 3 cadres

**Files:**
- Create: `scripts/capture-masque.mjs`
- Modify: `package.json` racine (script `captures:masque`)
- Modify: `.gitignore` (les captures ne sont pas versionnées)

**Interfaces:**
- Consumes : `DIRECTIONS` via `createRequire` sur `packages/contracts/dist/index.js` ; l'app web en dev sur `http://localhost:3000` ; la démo `/r/demo?demo=1` ; la fidélité de démo si elle existe, sinon la page `/r/demo` seule pour la troisième surface (voir Step 2).
- Produces : `docs/superpowers/captures/masque/<direction>-<surface>-<cadre>.png`, 54 fichiers, `process.exitCode = 1` si une capture manque ou pèse moins de 30 Ko.

- [ ] **Step 1 : Le levier — injecter un `brand` sans toucher la base**

La démo (`?demo=1`) porte Nuit en fixture. Pour capturer les six directions **sans six tenants**, le script intercepte la réponse de `**/public/tenants/demo/site` et de `**/public/tenants/demo/loyalty` et y remplace `tenant.brand` / `restaurant.brand` par la direction voulue. C'est exactement le motif `context.route(match, handler)` de `capture-shots.mjs:330`. Si la démo ne passe pas par le réseau (transport en mémoire), le script pose plutôt `?masque=<direction>` : ajouter dans `Storefront.tsx`, **uniquement quand `demo === true`**, la lecture de `new URLSearchParams(location.search).get("masque")` et, si c'est une clé de `DIRECTIONS`, l'emploi de cette direction à la place de `site.tenant.brand`. Jamais hors démo : la page d'un vrai restaurant ne se rethème pas par l'URL.

- [ ] **Step 2 : Le script**

```js
// scripts/capture-masque.mjs
import { chromium } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { DIRECTIONS, PRESET_KEYS } = require(resolve(root, 'packages/contracts/dist/index.js'));

const BASE = process.env.SM_WEB_URL ?? 'http://localhost:3000';
const OUT = resolve(root, 'docs/superpowers/captures/masque');
const MIN_BYTES = 30_000;
const CADRES = { telephone: [390, 844], tablette: [768, 1024], ordinateur: [1440, 900] };
const SURFACES = {
  vitrine: { url: '/r/demo?demo=1', pret: 'Commander' },
  tunnel: { url: '/r/demo?demo=1#panier', pret: 'Panier' },
  fidelite: { url: '/r/demo/fidelite?demo=1', pret: 'Fidélité' },
};

const failures = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const direction of PRESET_KEYS) {
  for (const [surface, { url, pret }] of Object.entries(SURFACES)) {
    for (const [cadre, [width, height]] of Object.entries(CADRES)) {
      const name = `${direction}-${surface}-${cadre}`;
      const context = await browser.newContext({
        viewport: { width, height }, deviceScaleFactor: 2, locale: 'fr-FR',
        timezoneId: 'Europe/Paris', reducedMotion: 'reduce', isMobile: width < 500, hasTouch: width < 500,
      });
      await context.route('**/public/tenants/demo/**', async (route) => {
        const res = await route.fetch();
        const json = await res.json().catch(() => null);
        if (!json) return route.fulfill({ response: res });
        if (json.tenant) json.tenant.brand = DIRECTIONS[direction];
        if (json.restaurant) json.restaurant.brand = DIRECTIONS[direction];
        return route.fulfill({ response: res, json });
      });
      const page = await context.newPage();
      try {
        const sep = url.includes('?') ? '&' : '?';
        await page.goto(`${BASE}${url}${sep}masque=${direction}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.getByText(pret, { exact: false }).first().waitFor({ timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.mouse.move(width - 2, height - 2);
        await page.waitForTimeout(800);
        const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (scrollX > 0) throw new Error(`défilement horizontal de ${scrollX}px`);
        const path = resolve(OUT, `${name}.png`);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        const { size } = await stat(path);
        if (size < MIN_BYTES) throw new Error(`${size} o — surface probablement vide`);
        console.log(`  ✓ ${name}`);
      } catch (e) {
        failures.push(`${name} : ${e.message}`);
        console.error(`  ✗ ${name} — ${e.message}`);
      } finally {
        await context.close();
      }
    }
  }
}
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} capture(s) en échec :\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(`\n54 captures dans ${OUT}`);
}
```

`package.json` racine, dans `scripts` : `"captures:masque": "node scripts/capture-masque.mjs"`. `.gitignore` : `docs/superpowers/captures/`.

Si `/r/demo/fidelite?demo=1` n'existe pas (la fidélité de démo n'est pas câblée), remplacer la surface `fidelite` par `suivi: { url: '/t/demo?demo=1', pret: 'Commande' }` si le suivi de démo existe, et **le dire dans le commit** — la spec demande trois surfaces, pas trois surfaces précises.

- [ ] **Step 3 : Lancer**

Dans un terminal : `pnpm --filter @sm/web dev`. Dans un autre : `pnpm captures:masque`.
Expected : `54 captures`, aucun échec — en particulier **aucun défilement horizontal** sur les 18 captures téléphone. Regarder les six `*-vitrine-telephone.png` : chaque direction doit se reconnaître au premier coup d'œil.

- [ ] **Step 4 : Commit**

```bash
git add scripts/capture-masque.mjs package.json .gitignore apps/web/src/components/order/Storefront.tsx
git commit -m "feat : la matrice du masque — 54 captures, la preuve du responsive et la référence des directions"
```

---

### Task 15 : La documentation d'exploitation, et la reprise sur staging

**Files:**
- Modify: `docs/CI-CD.md` (section « Les reprises de données Mongo », l.268-310)

- [ ] **Step 1 : Documenter la reprise**

Dans la liste des tâches `backfill:*` de `docs/CI-CD.md`, ajouter :

```
- `backfill:brand` — pose le masque d'identité (direction Nuit, accent et logo du tenant) sur les tenants d'avant le 01/09/2026. Sans lui, rien ne casse : le résolveur dérive le même masque à la lecture. Avec lui, l'éditeur (plan B) a un objet à modifier.
```

- [ ] **Step 2 : Après merge et déploiement staging — la reprise, en deux temps**

```bash
scripts/reprise-mongo.sh staging backfill:brand              # montre
scripts/reprise-mongo.sh staging backfill:brand --appliquer  # écrit, puis relance de contrôle
```

Expected : la relance de contrôle annonce `0 tenant(s) sans masque`.

- [ ] **Step 3 : Commit**

```bash
git add docs/CI-CD.md
git commit -m "docs : la reprise du masque, à lancer à la main après déploiement"
```

---

## Auto-relecture du plan

**Couverture de la spec.** §3 données → Tasks 1, 5. §4.1 résolveur → Task 3. §4.2 contraste → Task 3. §4.3 espaces de noms → Task 9 (écart motivé). §4.4 discipline → Tasks 11-12. §4.5 PWA → Task 13. §5 directions et paires → Task 1 (+ AA en Task 3). §6 éditeur → **plan B**. §6.5 API → Task 7. §7 responsive → Task 12 (règles 1-5) et Task 14 (preuve). §8 reprise → Tasks 4 (repli), 8, 15. §9 tests → chaque tâche ; matrice en Task 14. Aucun trou pour le plan A.

**Cohérence des noms.** `resoudreMarque`, `contraste`, `marqueDeRepli`, `marqueEffective`, `brandColorDe`, `logoUrlDe`, `logoPour`, `exigerAA`, `repriseMarque`, `styleDuMasque`, `classesPolices`, `tenantPublicDe` — chacun défini dans une tâche avant d'être consommé dans une suivante. Les variables CSS émises en Task 3 (`--cf-ink-soft`, `--cf-accent-ink`, `--cf-accent-wash`, `--cf-focus`, `--cf-on-green/red/amber`, `--cf-font-*`) sont celles que Task 9 déclare dans `:root` et mappe dans `@theme inline` ; `--cf-on-gold` est ajouté en Task 11.

**Ce que le plan ne fait pas, et le dit.** L'éditeur, « palette depuis le logo », le dépôt des quatre déclinaisons de logo et du héros : plan B. Les captures ne sont pas versionnées. La reprise sur production attend la validation de staging.
