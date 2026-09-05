# Scénographies de l'écran de salle — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plusieurs mises en scène pour l'écran de salle, le masque du restaurant jusqu'au téléviseur, un fond qui devient réel, et un tiroir « Apparence » dans le back-office avec un téléviseur miniature vivant.

**Architecture:** Une scénographie est un module React inscrit dans un registre côté web ; l'hôte (`BoardStage`) garantit le cadre de référence, les jetons du masque, les polices, la rotation et la mise à jour en place. L'API transporte le masque effectif (variante de fond appliquée au contrat) dans `ScreenContent`, et expose une route d'aperçu authentifiée. Deux scénographies : Ardoise (l'existante, adoptée au masque) et Comptoir (reprise du kit Claude Design).

**Tech Stack:** pnpm/turbo · packages/contracts (zod) · packages/db (Mongoose) · apps/api (NestJS, vitest) · apps/web (Next 16, React, Tailwind v4, vitest) · e2e (Playwright, scripts `.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-05-scenographies-tv-design.md`

## Global Constraints

- Tout le travail se fait dans le plan de travail `scratchpad/wt`, branche `feat/scenographies-tv`, jamais dans `/Users/limameghassene/development/SnackManager`.
- Une scénographie n'anime que `transform` et `opacity` ; aucune couleur ni durée en dur ; durées `--sm-t-snap/fast/med/slow`, courbe `--sm-ease`.
- Planchers de lisibilité à huit lignes — paysage : nom 42, description 24, prix 46, titre 76 px ; portrait : 56 / 30 / 62 / 96.
- `priceLabel` affiché tel quel ; recadrage par `cadrageCss(photoPoint)` uniquement ; texte sur photo sur `--cf-scrim`.
- Les écrans existants restent sur `ardoise` ; les écrans neufs reçoivent `comptoir`.
- Aucune migration de données. Le cache d'un téléviseur antérieur reste lisible (repli `marqueDeRepli`).
- Commits en français, message à la première ligne sans préfixe conventionnel obligatoire (le dépôt mêle `feat :` et phrases), pied :
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` puis `Claude-Session: https://claude.ai/code/session_01Ch9Cv68RaoGcayvJfpAFUg`.
- Portail avant PR : `pnpm turbo lint test build` vert. Fusion squash. Sonde : `SM_REVISION_ATTENDUE=<sha> node scripts/smoke.mjs staging`.
- `git commit --only <chemins>` ou `git add <chemins>` explicites : jamais `git add -A`.

---

### Task 1 : Contrat — scénographies, libellés de fond, aperçu

**Files:**
- Modify: `packages/contracts/src/screens.ts`
- Test: `packages/contracts/src/screens-scenographie.test.ts`

**Interfaces:**
- Produces: `SCENOGRAPHIES`, `ScenographySchema`, `Scenography`, `SCENOGRAPHY_DEFAULT = 'comptoir'`, `SCENOGRAPHY_LABELS`, `SCENOGRAPHY_DESCRIPTIONS`, `SCREEN_THEME_HINTS`, `ScreenPreviewSchema` / `ScreenPreview`, champs `scenography` sur `ScreenCreate`/`ScreenUpdate`/`ScreenView`, champs `scenography` et `masque: Brand` sur `ScreenContent`.

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// packages/contracts/src/screens-scenographie.test.ts
import { describe, expect, it } from 'vitest';
import {
  SCENOGRAPHIES,
  SCENOGRAPHY_DEFAULT,
  SCENOGRAPHY_DESCRIPTIONS,
  SCENOGRAPHY_LABELS,
  SCREEN_THEME_HINTS,
  SCREEN_THEME_LABELS,
  SCREEN_THEMES,
  ScreenCreateSchema,
  ScreenPreviewSchema,
  ScreenUpdateSchema,
} from './screens';

describe('Scénographies — le contrat', () => {
  it('un écran neuf reçoit Comptoir sans que personne ne le demande', () => {
    const cree = ScreenCreateSchema.parse({ name: 'Comptoir gauche' });
    expect(cree.scenography).toBe(SCENOGRAPHY_DEFAULT);
    expect(SCENOGRAPHY_DEFAULT).toBe('comptoir');
  });

  it('chaque scénographie a un libellé et une description', () => {
    for (const s of SCENOGRAPHIES) {
      expect(SCENOGRAPHY_LABELS[s].length).toBeGreaterThan(0);
      expect(SCENOGRAPHY_DESCRIPTIONS[s].length).toBeGreaterThan(0);
    }
  });

  it('une scénographie inconnue est refusée à la mise à jour', () => {
    expect(ScreenUpdateSchema.safeParse({ scenography: 'neon' }).success).toBe(false);
    expect(ScreenUpdateSchema.safeParse({ scenography: 'ardoise' }).success).toBe(true);
  });

  it("l'aperçu accepte un brouillon sans écran, avec des surcharges partielles", () => {
    const lu = ScreenPreviewSchema.parse({ theme: 'light' });
    expect(lu.screenId).toBeUndefined();
    expect(lu.theme).toBe('light');
    expect(lu.scenography).toBeUndefined();
  });

  it('les libellés de fond disent ce que le fond fait, et chaque fond a une aide', () => {
    expect(SCREEN_THEME_LABELS.brand).toBe('Vos couleurs');
    expect(SCREEN_THEME_LABELS.dark).toBe('Fond sombre');
    expect(SCREEN_THEME_LABELS.light).toBe('Fond clair');
    for (const t of SCREEN_THEMES) expect(SCREEN_THEME_HINTS[t].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd scratchpad/wt && pnpm --filter @sm/contracts exec vitest run src/screens-scenographie.test.ts`
Expected: FAIL — `SCENOGRAPHIES` n'est pas exporté.

- [ ] **Step 3 : Implémenter dans `screens.ts`**

Après le bloc `SCREEN_THEME_LABELS` (remplacer ses trois valeurs) :

```ts
export const SCREEN_THEME_LABELS: Record<ScreenTheme, string> = {
  brand: 'Vos couleurs',
  dark: 'Fond sombre',
  light: 'Fond clair',
};

/** L'aide sous chaque fond — ce que le réglage FAIT, puisqu'il le fait enfin. */
export const SCREEN_THEME_HINTS: Record<ScreenTheme, string> = {
  brand: 'Le masque de votre marque, tel quel.',
  dark: 'Un fond sombre neutre, votre accent et votre logo.',
  light: 'Un fond clair neutre, votre accent et votre logo.',
};

// ─── Scénographies ───

/**
 * La MISE EN SCÈNE d'un écran — jamais le contenu, qui est la carte.
 *
 * Une scénographie est un module de l'application (registre côté web), pas un
 * fichier déposé : c'est ce qui permet de la tester, de lui garantir les
 * polices et les jetons du masque, et de la rendre à l'identique dans le
 * téléviseur miniature du back-office.
 */
export const SCENOGRAPHIES = ['ardoise', 'comptoir'] as const;
export const ScenographySchema = z.enum(SCENOGRAPHIES);
export type Scenography = z.infer<typeof ScenographySchema>;

/**
 * Les écrans NEUFS. Les écrans déjà installés n'ont pas le champ en base et
 * restent sur Ardoise à la lecture (`toStored`) : une mise à jour du logiciel
 * ne change pas l'apparence d'un téléviseur accroché au mur.
 */
export const SCENOGRAPHY_DEFAULT: Scenography = 'comptoir';

export const SCENOGRAPHY_LABELS: Record<Scenography, string> = {
  ardoise: 'Ardoise',
  comptoir: 'Comptoir',
};

export const SCENOGRAPHY_DESCRIPTIONS: Record<Scenography, string> = {
  ardoise: 'La carte en lignes, sobre et dense : le nom, la description, le prix.',
  comptoir: 'Des boîtes photo pleines sous la lampe du comptoir, le prix en étiquette collée.',
};
```

Dans `ScreenCreateSchema`, après `theme` : `scenography: ScenographySchema.default(SCENOGRAPHY_DEFAULT),`.
Dans `ScreenUpdateSchema`, après `theme` : `scenography: ScenographySchema.optional(),`.

Après `ScreenUpdateSchema` :

```ts
/**
 * Un aperçu — l'écran tel qu'il serait, sans jeton d'appareil.
 *
 * `screenId` désigne l'écran dont on part (sa boucle, ses réglages) ; les
 * autres champs sont les SURCHARGES du brouillon du tiroir « Apparence ». Sans
 * `screenId`, l'aperçu part des défauts et de la boucle générée depuis la carte.
 */
export const ScreenPreviewSchema = z.object({
  screenId: z.string().min(1).max(64).nullish(),
  orientation: ScreenOrientationSchema.optional(),
  theme: ScreenThemeSchema.optional(),
  scenography: ScenographySchema.optional(),
  playlist: z.array(ScreenSceneSchema).optional(),
});
export type ScreenPreview = z.infer<typeof ScreenPreviewSchema>;
```

En tête du fichier, sous l'import de `PointInteret` : `import type { Brand } from './marque';` (type seul : `index.ts` réexporte les deux fichiers).

Dans `ScreenContent`, après `theme: ScreenTheme;` :

```ts
  scenography: Scenography;
  /**
   * LE MASQUE EFFECTIF — la variante de fond DÉJÀ appliquée (`masquePourFond`).
   * L'écran ne connaît pas la logique du fond : il reçoit un masque et le
   * résout avec le même résolveur que la vitrine. Dans l'empreinte : une
   * couleur changée repeint l'écran dans la minute.
   */
  masque: Brand;
```

Dans `ScreenView`, après `themeLabel: string;` : `scenography: Scenography;` et `scenographyLabel: string;`.

- [ ] **Step 4 : Lancer, vérifier le vert, puis chercher les anciens libellés**

Run: `pnpm --filter @sm/contracts exec vitest run src/screens-scenographie.test.ts`
Expected: PASS.
Run: `grep -rn "Couleurs du restaurant\|Fond noir" apps packages e2e --include='*.ts' --include='*.tsx' --include='*.mjs' | grep -v node_modules`
Expected : aucune occurrence hors `screens.ts` ; sinon corriger les tests qui les citent.

- [ ] **Step 5 : Commit**

```bash
git add packages/contracts/src/screens.ts packages/contracts/src/screens-scenographie.test.ts
git commit -m "contrat : la scénographie d'un écran, et un fond qui dit ce qu'il fait"
```

---

### Task 2 : Contrat — `masquePourFond`, la variante de fond du masque

**Files:**
- Modify: `packages/contracts/src/marque.ts` (après `marqueDeRepli`)
- Test: `packages/contracts/src/masque-pour-fond.test.ts`

**Interfaces:**
- Produces: `type FondEcran = 'brand' | 'dark' | 'light'`, `FONDS_NEUTRES`, `masquePourFond(brand: Brand, fond: FondEcran): Brand`.

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// packages/contracts/src/masque-pour-fond.test.ts
import { describe, expect, it } from 'vitest';
import {
  BrandStrictSchema,
  DIRECTIONS,
  FONDS_NEUTRES,
  masquePourFond,
  modePourFond,
  resoudreMarque,
} from './marque';

describe('masquePourFond — le fond de l’écran est une variante du masque', () => {
  it('« vos couleurs » rend le masque lui-même, sans copie', () => {
    const brand = DIRECTIONS.soleil;
    expect(masquePourFond(brand, 'brand')).toBe(brand);
  });

  it('« fond sombre » garde l’accent, son encre, les logos et l’accord, et passe en mode sombre', () => {
    const brand = DIRECTIONS.brasserie; // une direction claire
    const sombre = masquePourFond(brand, 'dark');
    expect(sombre.mode).toBe('dark');
    expect(sombre.palette.ground).toBe(FONDS_NEUTRES.dark.ground);
    expect(sombre.palette.accent).toBe(brand.palette.accent);
    expect(sombre.palette.onAccent).toBe(brand.palette.onAccent);
    expect(sombre.logo).toBe(brand.logo);
    expect(sombre.type).toBe(brand.type);
    expect(sombre.shape).toBe(brand.shape);
    expect(sombre.motion).toBe(brand.motion);
    expect(sombre.entete).toBe(brand.entete);
    expect(sombre.preset).toBeNull();
  });

  it('« fond clair » passe en mode clair et garde l’accent tel quel dans les jetons', () => {
    const brand = DIRECTIONS.neon; // une direction sombre
    const clair = masquePourFond(brand, 'light');
    expect(clair.mode).toBe('light');
    const { vars, colorScheme } = resoudreMarque(clair);
    expect(colorScheme).toBe('light');
    expect(vars['--cf-bg']).toBe(FONDS_NEUTRES.light.ground);
    expect(vars['--cf-accent']).toBe(brand.palette.accent);
  });

  it('les deux variantes passent la garde d’écriture : le mode suit le fond', () => {
    for (const fond of ['dark', 'light'] as const) {
      const variante = masquePourFond(DIRECTIONS.atelier, fond);
      expect(BrandStrictSchema.safeParse(variante).success).toBe(true);
      expect(variante.mode).toBe(modePourFond(variante.palette.ground));
    }
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter @sm/contracts exec vitest run src/masque-pour-fond.test.ts`
Expected: FAIL — `masquePourFond` n'existe pas.

- [ ] **Step 3 : Implémenter dans `marque.ts`, juste après `marqueDeRepli`**

```ts
// ─────────────────────────────────────────────────────────────
// Le fond de l'écran de salle — une variante du masque, pas un thème à part
// ─────────────────────────────────────────────────────────────

/** Le réglage de fond d'un écran de salle (`ScreenTheme`, écrit ici en type seul pour éviter le cycle). */
export type FondEcran = 'brand' | 'dark' | 'light';

/**
 * Les deux fonds NEUTRES — ni Snack Manager, ni le restaurant : un noir tiède
 * et un blanc cassé sur lesquels l'accent du restaurant reste le seul signal.
 * Le noir n'est pas #000 (DA §1 : jamais le noir pur) ; le clair n'est pas
 * #fff en fond de page, réservé aux surfaces.
 */
export const FONDS_NEUTRES: Record<'dark' | 'light', Pick<BrandPalette, 'ground' | 'surface' | 'ink'>> = {
  dark: { ground: '#0e0e10', surface: '#17171a', ink: '#f4f2ed' },
  light: { ground: '#f5f2ec', surface: '#ffffff', ink: '#1a1816' },
};

/**
 * Le masque EFFECTIF d'un écran selon son fond.
 *
 * `brand` rend l'objet même. Les deux autres remplacent le fond, la surface et
 * l'encre par un neutre et GARDENT tout le reste — accent et encre d'accent,
 * logos, photo, accord typographique, forme, mouvement, en-tête. Le mode suit
 * le fond, comme la garde d'écriture l'exige ; `preset` tombe à `null`
 * puisque ce n'est plus la direction stockée. `resoudreMarque` fait ensuite
 * ce qu'il fait partout : ramener l'accent en texte à AA sur le nouveau fond.
 */
export function masquePourFond(brand: Brand, fond: FondEcran): Brand {
  if (fond === 'brand') return brand;
  const neutre = FONDS_NEUTRES[fond];
  return {
    ...brand,
    mode: modePourFond(neutre.ground),
    palette: { ...brand.palette, ...neutre },
    preset: null,
  };
}
```

- [ ] **Step 4 : Lancer, vérifier le vert**

Run: `pnpm --filter @sm/contracts exec vitest run src/masque-pour-fond.test.ts src/mode-fond.test.ts`
Expected: PASS (les tests existants du mode restent verts).

- [ ] **Step 5 : Commit**

```bash
git add packages/contracts/src/marque.ts packages/contracts/src/masque-pour-fond.test.ts
git commit -m "contrat : le fond de l'écran est une variante du masque, accent et logo conservés"
```

---

### Task 3 : Base et dépôt — le champ `scenography`

**Files:**
- Modify: `packages/db/src/schemas.ts` (ScreenSchema, après `theme`)
- Modify: `apps/api/src/modules/screens/screens.repository.ts` (`StoredScreen`, `NewScreen`, `ScreenPatch`, `toStored` exporté)
- Modify: `apps/api/src/modules/screens/screens.fakes.ts` (`storedScreen`, `FakeScreensRepository.create`)
- Modify: `apps/api/src/modules/screens/manage-screens.usecase.ts` (`create`)
- Modify: `apps/api/src/modules/screens/screens.view.ts` (`toScreenView`)
- Modify: `apps/api/src/modules/screens/manage-screens.test.ts` (appels `create` : ajouter `scenography`)
- Test: `apps/api/src/modules/screens/screens.repository.test.ts`

**Interfaces:**
- Consumes: `Scenography`, `SCENOGRAPHY_LABELS`, `SCENOGRAPHIES` (Task 1).
- Produces: `StoredScreen.scenography: Scenography`, `NewScreen.scenography`, `ScreenPatch.scenography?`, `toStored(raw: RawScreen): StoredScreen` exporté.

- [ ] **Step 1 : Écrire le test du dépôt qui échoue**

```ts
// apps/api/src/modules/screens/screens.repository.test.ts
import { describe, expect, it } from 'vitest';
import { toStored, type RawScreen } from './screens.repository';

/** Un document tel que `.lean()` le rend — sans défaut de schéma appliqué. */
function brut(patch: Partial<RawScreen> = {}): RawScreen {
  return {
    _id: '65f000000000000000000010',
    tenantId: '65f000000000000000000001',
    name: 'Comptoir',
    playlist: [],
    ...patch,
  } as unknown as RawScreen;
}

describe('toStored — un écran antérieur garde son apparence', () => {
  it('sans champ en base, la scénographie vaut Ardoise', () => {
    expect(toStored(brut()).scenography).toBe('ardoise');
  });

  it('avec le champ, elle est lue telle quelle', () => {
    expect(toStored(brut({ scenography: 'comptoir' })).scenography).toBe('comptoir');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd scratchpad/wt && pnpm --filter api exec vitest run src/modules/screens/screens.repository.test.ts`
(le nom du paquet API se lit dans `apps/api/package.json`, champ `name` ; adapter `--filter`.)
Expected: FAIL — `toStored` n'est pas exporté.

- [ ] **Step 3 : Base — `packages/db/src/schemas.ts`**

Vérifier l'import existant depuis `@sm/contracts` en tête du fichier (il importe déjà `PRESENTATIONS_ENTETE`) et y ajouter `SCENOGRAPHIES`. Dans `ScreenSchema`, après la ligne `theme:` :

```ts
    // La mise en scène. ABSENTE sur les écrans antérieurs : `toStored` lit
    // alors « ardoise », l'écran qu'ils ont toujours eu — une mise à jour ne
    // change pas l'apparence d'un téléviseur accroché au mur. Les écrans neufs
    // reçoivent le défaut du contrat (Comptoir) à la création, pas ce défaut-ci.
    scenography: { type: String, enum: [...SCENOGRAPHIES], default: 'ardoise' },
```

- [ ] **Step 4 : Dépôt — `screens.repository.ts`**

Import : `import type { Scenography, ScreenOrientation, ScreenScene, ScreenTheme } from '@sm/contracts';`

`StoredScreen` : après `readonly theme: ScreenTheme;` ajouter `readonly scenography: Scenography;`.
`NewScreen` : après `readonly theme: ScreenTheme;` ajouter `readonly scenography: Scenography;`.
`ScreenPatch` : après `readonly theme?: ScreenTheme;` ajouter `readonly scenography?: Scenography;`.

Remplacer `type RawScreen = …` et `function toStored` par :

```ts
export type RawScreen = Screen & { _id: unknown };

/** Exporté pour le test du champ absent : `.lean()` n'applique aucun défaut de schéma. */
export function toStored(raw: RawScreen): StoredScreen {
  return {
    id: String(raw._id),
    tenantId: String(raw.tenantId),
    name: String(raw.name ?? ''),
    pairingCode: raw.pairingCode ?? null,
    pairingCodeExpiresAt: raw.pairingCodeExpiresAt ?? null,
    paired: raw.paired === true,
    orientation: (raw.orientation ?? 'landscape') as ScreenOrientation,
    theme: (raw.theme ?? 'brand') as ScreenTheme,
    // Les écrans antérieurs au champ gardent l'écran qu'ils ont toujours eu.
    scenography: (raw.scenography ?? 'ardoise') as Scenography,
    playlist: (raw.playlist ?? []).map((s) => ({
      kind: s.kind as ScreenScene['kind'],
      categoryId: s.categoryId ? String(s.categoryId) : null,
      productIds: (s.productIds ?? []).map((id) => String(id)),
      title: s.title ?? null,
      durationMs: Number(s.durationMs ?? 0),
    })),
    lastSeenAt: raw.lastSeenAt ?? null,
    active: raw.active !== false,
  };
}
```

- [ ] **Step 5 : Doublures, cas d'usage, vue**

`screens.fakes.ts` — `storedScreen()` : après `theme: 'brand',` ajouter `scenography: 'ardoise',`. `FakeScreensRepository.create` : après `theme: screen.theme,` ajouter `scenography: screen.scenography,`.

`manage-screens.usecase.ts` — dans `create`, après `theme: dto.theme,` ajouter `scenography: dto.scenography,`.

`screens.view.ts` — import `SCENOGRAPHY_LABELS` depuis `@sm/contracts` ; dans `toScreenView`, après `themeLabel:` ajouter :

```ts
    scenography: screen.scenography,
    scenographyLabel: SCENOGRAPHY_LABELS[screen.scenography],
```

`manage-screens.test.ts` — chaque `useCase.create(CLASSFOOD, { … theme: … })` reçoit en plus `scenography: 'comptoir'` (le type `ScreenCreate` le rend obligatoire une fois le défaut zod appliqué). Ajouter à la fin du `describe` :

```ts
  it('la scénographie choisie est stockée et relue avec son libellé', async () => {
    const created = await useCase.create(CLASSFOOD, {
      name: 'Vitrine',
      orientation: 'landscape',
      theme: 'brand',
      scenography: 'comptoir',
    });
    expect(created.scenography).toBe('comptoir');
    expect(created.scenographyLabel).toBe('Comptoir');

    const updated = await useCase.update(CLASSFOOD, created.id, { scenography: 'ardoise' });
    expect(updated.scenography).toBe('ardoise');
    expect(updated.scenographyLabel).toBe('Ardoise');
  });
```

- [ ] **Step 6 : Lancer les tests du module écrans et le typage**

Run: `pnpm --filter <api> exec vitest run src/modules/screens && pnpm --filter <api> exec tsc --noEmit -p tsconfig.json`
Expected: PASS ; aucune erreur de type. Si `apps/web/src/lib/demo/router.ts` (`screenView`) est typé `ScreenView`, ajouter `scenography: 'ardoise', scenographyLabel: 'Ardoise'` à l'objet qu'il rend, et vérifier avec `pnpm --filter web exec tsc --noEmit`.

- [ ] **Step 7 : Commit**

```bash
git add packages/db/src/schemas.ts apps/api/src/modules/screens/screens.repository.ts apps/api/src/modules/screens/screens.repository.test.ts apps/api/src/modules/screens/screens.fakes.ts apps/api/src/modules/screens/manage-screens.usecase.ts apps/api/src/modules/screens/manage-screens.test.ts apps/api/src/modules/screens/screens.view.ts
# + apps/web/src/lib/demo/router.ts si touché
git commit -m "écrans : la scénographie est stockée, les écrans installés gardent Ardoise"
```

---

### Task 4 : API — le masque voyage dans le contenu

**Files:**
- Modify: `apps/api/src/modules/screens/menu-board.repository.ts` (`BoardIdentity.brand`, `identiteDuTableau`)
- Modify: `apps/api/src/modules/screens/render-screen-content.ts` (`renderScreenContent`)
- Modify: `apps/api/src/modules/screens/screens.fakes.ts` (`boardIdentity`)
- Modify: `apps/api/src/modules/screens/menu-board.repository.test.ts` (attentes sur l'identité)
- Test: `apps/api/src/modules/screens/build-screen-content.test.ts` (nouveau `describe`)

**Interfaces:**
- Consumes: `masquePourFond`, `logoPour`, `marqueDeRepli` (contrat) ; `StoredScreen.scenography` (Task 3).
- Produces: `BoardIdentity.brand: Brand` ; `ScreenContent.masque`, `.scenography`, `brand.logoUrl` et `brand.accent` dérivés du masque effectif.

- [ ] **Step 1 : Écrire les tests qui échouent** (à la fin de `build-screen-content.test.ts`)

```ts
import { marqueDeRepli, type Brand } from '@sm/contracts';
import { boardIdentity } from './screens.fakes';

describe('Le masque voyage jusqu’à l’écran', () => {
  const avecLogos = (): Brand => ({
    ...marqueDeRepli('#c9a15a', null),
    logo: {
      mark: { light: 'https://cdn.test/clair.png', dark: 'https://cdn.test/sombre.png' },
      lockup: { light: null, dark: null },
    },
  });

  it('« vos couleurs » transporte le masque du restaurant tel quel, et la scénographie', () => {
    const snapshot = boardSnapshot();
    const content = renderScreenContent(storedScreen({ scenography: 'comptoir' }), snapshot, MERCREDI_MIDI);
    expect(content.masque).toEqual(snapshot.identity.brand);
    expect(content.scenography).toBe('comptoir');
  });

  it('« fond clair » rend un masque clair qui garde l’accent', () => {
    const content = renderScreenContent(storedScreen({ theme: 'light' }), boardSnapshot(), MERCREDI_MIDI);
    expect(content.masque.mode).toBe('light');
    expect(content.masque.palette.accent).toBe('#c9a15a');
    expect(content.brand.accent).toBe('#c9a15a');
  });

  it('le logo de l’en-tête suit le mode du fond', () => {
    const snapshot = boardSnapshot({ identity: boardIdentity({ brand: avecLogos() }) });
    const sombre = renderScreenContent(storedScreen({ theme: 'brand' }), snapshot, MERCREDI_MIDI);
    const clair = renderScreenContent(storedScreen({ theme: 'light' }), snapshot, MERCREDI_MIDI);
    expect(sombre.brand.logoUrl).toBe('https://cdn.test/sombre.png');
    expect(clair.brand.logoUrl).toBe('https://cdn.test/clair.png');
  });

  it('l’empreinte change avec le fond et avec la scénographie', () => {
    const base = renderScreenContent(storedScreen(), boardSnapshot(), MERCREDI_MIDI);
    const fond = renderScreenContent(storedScreen({ theme: 'dark' }), boardSnapshot(), MERCREDI_MIDI);
    const mise = renderScreenContent(storedScreen({ scenography: 'comptoir' }), boardSnapshot(), MERCREDI_MIDI);
    expect(fond.contentHash).not.toBe(base.contentHash);
    expect(mise.contentHash).not.toBe(base.contentHash);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter <api> exec vitest run src/modules/screens/build-screen-content.test.ts`
Expected: FAIL — `content.masque` est `undefined`, `boardIdentity({ brand })` refuse `brand`.

- [ ] **Step 3 : `menu-board.repository.ts`**

Import : ajouter `type Brand` à l'import de `@sm/contracts`. Dans `BoardIdentity`, après `readonly brandColor: string;` :

```ts
  /** LE MASQUE observé — la source dont `logoUrl` et `brandColor` dérivent. */
  readonly brand: Brand;
```

Dans `identiteDuTableau`, après `name: …,` ajouter `brand,`.

- [ ] **Step 4 : `render-screen-content.ts`**

Import : ajouter `logoPour, masquePourFond` à l'import de `@sm/contracts`. Dans `renderScreenContent`, avant `const painted = {` :

```ts
  /**
   * Le masque EFFECTIF : la variante de fond est appliquée ICI, une fois, et
   * l'écran reçoit un masque qu'il résout comme la vitrine. Il n'a pas à
   * connaître la logique du fond — une clé HDMI n'a personne pour s'apercevoir
   * qu'elle l'applique autrement que le back-office.
   */
  const masque = masquePourFond(snapshot.identity.brand, screen.theme);
```

Dans `painted`, après `theme: screen.theme,` :

```ts
    scenography: screen.scenography,
    masque,
```

et remplacer le bloc `brand:` par :

```ts
    brand: {
      slug: snapshot.identity.slug,
      name: snapshot.identity.name,
      // Dérivés du masque EFFECTIF : un logo dessiné pour fond sombre ne se
      // pose pas sur « Fond clair ».
      logoUrl: logoPour(masque, 'mark'),
      accent: masque.palette.accent,
    },
```

- [ ] **Step 5 : Doublures et test d'identité**

`screens.fakes.ts` — import `marqueDeRepli` depuis `@sm/contracts` ; dans `boardIdentity()`, après `brandColor: '#c9a15a',` ajouter `brand: marqueDeRepli('#c9a15a', null),`.

`menu-board.repository.test.ts` — chercher les assertions sur `identiteDuTableau(...)` : `grep -n "identiteDuTableau" apps/api/src/modules/screens/menu-board.repository.test.ts`. Une comparaison `toEqual` sur l'objet entier devient `toMatchObject` (le champ `brand` s'ajoute), et une nouvelle assertion vérifie la source :

```ts
  it('porte le masque observé, dont les champs plats dérivent', () => {
    const identite = identiteDuTableau({ _id: 'x', slug: 'classfood', name: "Class'Food", brandColor: '#c9a15a' });
    expect(identite.brand.palette.accent).toBe('#c9a15a');
    expect(identite.brandColor).toBe(identite.brand.palette.accent);
  });
```

- [ ] **Step 6 : Lancer le module et le typage**

Run: `pnpm --filter <api> exec vitest run src/modules/screens && pnpm --filter <api> exec tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src/modules/screens/menu-board.repository.ts apps/api/src/modules/screens/menu-board.repository.test.ts apps/api/src/modules/screens/render-screen-content.ts apps/api/src/modules/screens/screens.fakes.ts apps/api/src/modules/screens/build-screen-content.test.ts
git commit -m "écrans : le masque effectif voyage jusqu'au téléviseur, le fond devient réel"
```

---

### Task 5 : API — l'aperçu, pour un écran ou un brouillon

**Files:**
- Create: `apps/api/src/modules/screens/playlist-lisible.ts` (extrait de `manage-screens.usecase.ts`)
- Create: `apps/api/src/modules/screens/preview-screen-content.usecase.ts`
- Modify: `apps/api/src/modules/screens/manage-screens.usecase.ts` (importer la garde extraite)
- Modify: `apps/api/src/modules/screens/screens.controller.ts` (route `POST screens/preview`)
- Modify: `apps/api/src/modules/screens/screens.module.ts` (fournisseur)
- Test: `apps/api/src/modules/screens/preview-screen-content.test.ts`

**Interfaces:**
- Consumes: `ScreenPreview` / `ScreenPreviewSchema` (Task 1), `renderScreenContent` (Task 4), `buildDefaultPlaylist`, `FakeMenuBoardRepository.asRepository()`, `FakeScreensRepository.asRepository()`.
- Produces: `PreviewScreenContent.execute(tenantId: string, dto: ScreenPreview): Promise<ScreenContent>` ; `assertPlaylistIsReadable(playlist)` dans `playlist-lisible.ts`.

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// apps/api/src/modules/screens/preview-screen-content.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PreviewScreenContent } from './preview-screen-content.usecase';
import {
  FakeMenuBoardRepository,
  FakeScreensRepository,
  TestClock,
  scene,
  storedScreen,
} from './screens.fakes';

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';
const MERCREDI_MIDI = new Date('2026-08-19T10:30:00Z');

describe('Aperçu d’un écran — le téléviseur miniature du back-office', () => {
  let screens: FakeScreensRepository;
  let useCase: PreviewScreenContent;

  beforeEach(() => {
    screens = new FakeScreensRepository();
    const board = new FakeMenuBoardRepository();
    useCase = new PreviewScreenContent(new TestClock(MERCREDI_MIDI), screens.asRepository(), board.asRepository());
  });

  it('un brouillon sans écran part des défauts et de la boucle générée depuis la carte', async () => {
    const content = await useCase.execute(CLASSFOOD, {});
    expect(content.screenId).toBe('preview');
    expect(content.scenography).toBe('comptoir');
    expect(content.orientation).toBe('landscape');
    expect(content.scenes.length).toBeGreaterThan(0);
    expect(content.scenes[0]?.kind).toBe('category');
  });

  it('les surcharges du brouillon s’appliquent par-dessus l’écran désigné', async () => {
    screens.seed(storedScreen({ id: 'screen-1', tenantId: CLASSFOOD, theme: 'brand', scenography: 'ardoise' }));
    const content = await useCase.execute(CLASSFOOD, {
      screenId: 'screen-1',
      theme: 'light',
      scenography: 'comptoir',
      orientation: 'portrait',
    });
    expect(content.screenId).toBe('screen-1');
    expect(content.theme).toBe('light');
    expect(content.masque.mode).toBe('light');
    expect(content.scenography).toBe('comptoir');
    expect(content.orientation).toBe('portrait');
  });

  it('une boucle fournie remplace celle de l’écran', async () => {
    screens.seed(storedScreen({ id: 'screen-1', tenantId: CLASSFOOD }));
    const content = await useCase.execute(CLASSFOOD, {
      screenId: 'screen-1',
      playlist: [scene({ kind: 'custom', title: 'Bienvenue' })],
    });
    expect(content.scenes.map((s) => s.title)).toEqual(['Bienvenue']);
  });

  it('un écran inconnu, ou celui d’un voisin, vaut 404', async () => {
    screens.seed(storedScreen({ id: 'screen-9', tenantId: VOISIN }));
    await expect(useCase.execute(CLASSFOOD, { screenId: 'nulle-part' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(useCase.execute(CLASSFOOD, { screenId: 'screen-9' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter <api> exec vitest run src/modules/screens/preview-screen-content.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Extraire la garde de boucle**

```ts
// apps/api/src/modules/screens/playlist-lisible.ts
import { BadRequestException } from '@nestjs/common';
import type { ScreenScene } from '@sm/contracts';
import { invalidSceneIds } from './screens.repository';

/** Un identifiant de scène illisible vaut une erreur de saisie, pas un 500. */
export function assertPlaylistIsReadable(playlist: readonly ScreenScene[] | undefined): void {
  const invalid = invalidSceneIds(playlist ?? []);
  if (invalid.length > 0) {
    throw new BadRequestException(`Identifiants de scène invalides : ${invalid.join(', ')}`);
  }
}
```

Dans `manage-screens.usecase.ts` : supprimer la fonction locale, importer `{ assertPlaylistIsReadable } from './playlist-lisible'`, retirer `BadRequestException` et `invalidSceneIds` des imports s'ils ne servent plus.

- [ ] **Step 4 : Le cas d'usage**

```ts
// apps/api/src/modules/screens/preview-screen-content.usecase.ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENOGRAPHY_DEFAULT, type ScreenContent, type ScreenPreview } from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { buildDefaultPlaylist } from './default-playlist';
import { MenuBoardRepository } from './menu-board.repository';
import { assertPlaylistIsReadable } from './playlist-lisible';
import { renderScreenContent } from './render-screen-content';
import { ScreensRepository, type StoredScreen } from './screens.repository';

/**
 * CAS D'USAGE — l'écran tel qu'il serait, vu du back-office.
 *
 * Le tiroir « Apparence » montre un téléviseur miniature qui joue la vraie
 * boucle avec la vraie carte. Il n'a ni jeton d'appareil, ni battement de
 * cœur, et il n'écrit rien : on compose un écran VIRTUEL depuis l'écran
 * désigné (ou les défauts), on lui applique les surcharges du brouillon, et
 * on passe par le même rendu que la clé HDMI — c'est la seule façon de
 * garantir que ce que le gérant voit est ce que le client verra.
 */
@Injectable()
export class PreviewScreenContent {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly screens: ScreensRepository,
    private readonly board: MenuBoardRepository,
  ) {}

  async execute(tenantId: string, dto: ScreenPreview): Promise<ScreenContent> {
    assertPlaylistIsReadable(dto.playlist);
    const now = this.clock.now();

    const base = dto.screenId ? await this.screens.byId(tenantId, dto.screenId) : null;
    if (dto.screenId && !base) throw new NotFoundException('Écran introuvable');

    const snapshot = await this.board.snapshot(tenantId, now);
    if (!snapshot) throw new NotFoundException('Établissement introuvable');

    const virtuel: StoredScreen = {
      id: base?.id ?? 'preview',
      tenantId,
      name: base?.name ?? 'Aperçu',
      pairingCode: null,
      pairingCodeExpiresAt: null,
      paired: true,
      orientation: dto.orientation ?? base?.orientation ?? 'landscape',
      theme: dto.theme ?? base?.theme ?? 'brand',
      scenography: dto.scenography ?? base?.scenography ?? SCENOGRAPHY_DEFAULT,
      playlist:
        dto.playlist ?? base?.playlist ?? buildDefaultPlaylist(snapshot.categories, snapshot.products),
      lastSeenAt: null,
      // Un aperçu est toujours « actif » : un écran désactivé montre sa veille
      // sur le téléviseur, mais le gérant qui règle l'apparence veut voir la carte.
      active: true,
    };

    return renderScreenContent(virtuel, snapshot, now);
  }
}
```

- [ ] **Step 5 : Route et module**

`screens.controller.ts` — imports : ajouter `ScreenPreviewSchema, type ScreenPreview` depuis `@sm/contracts` et `PreviewScreenContent` ; constructeur : `private readonly preview: PreviewScreenContent,`. Après `regenerateCode` :

```ts
  /**
   * L'aperçu du tiroir « Apparence » — l'écran, ou un brouillon, rendu par le
   * même chemin que la clé HDMI. Un POST parce qu'il porte une boucle.
   */
  @Roles('owner', 'gerant')
  @Post('screens/preview')
  previewContent(@TenantId() tenantId: string, @Body(zod(ScreenPreviewSchema)) body: unknown) {
    return this.preview.execute(tenantId, body as ScreenPreview);
  }
```

`screens.module.ts` — importer `PreviewScreenContent` et l'ajouter aux `providers`.

- [ ] **Step 6 : Lancer le module, le typage, le lint API**

Run: `pnpm --filter <api> exec vitest run src/modules/screens && pnpm --filter <api> lint`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add apps/api/src/modules/screens/playlist-lisible.ts apps/api/src/modules/screens/preview-screen-content.usecase.ts apps/api/src/modules/screens/preview-screen-content.test.ts apps/api/src/modules/screens/manage-screens.usecase.ts apps/api/src/modules/screens/screens.controller.ts apps/api/src/modules/screens/screens.module.ts
git commit -m "écrans : l'aperçu d'un écran ou d'un brouillon, rendu par le chemin du téléviseur"
```

---

### Task 6 : Web — le registre, l'hôte `BoardStage`, la scène pure `computeStage`

**Files:**
- Create: `apps/web/src/components/board/scenographies/registry.ts`
- Create: `apps/web/src/components/board/scenographies/ardoise/Ardoise.tsx` (déplacement de `board-scenes.tsx`, sans `SceneLayer`)
- Move: `apps/web/src/components/board/product-row.tsx` → `apps/web/src/components/board/scenographies/ardoise/product-row.tsx`
- Create: `apps/web/src/components/board/scene-layer.tsx`
- Create: `apps/web/src/components/board/board-stage.tsx`
- Modify: `apps/web/src/components/board/use-stage.ts` (`computeStage`, `useStage`, `useEmbeddedStage`)
- Modify: `apps/web/src/components/board/use-scene-rotation.ts` (`paused`, `go`)
- Modify: `apps/web/src/components/board/board-display.tsx`
- Modify: `apps/web/src/components/board/board-theme.ts` (retirer `boardPalette`)
- Modify: `apps/web/src/components/board/board.css` (mode incrusté)
- Delete: `apps/web/src/components/board/board-scenes.tsx`
- Test: `apps/web/src/components/board/use-stage.test.ts`, `apps/web/src/components/board/use-scene-rotation.test.ts` (si absent, créer)

**Interfaces:**
- Consumes: `Scenography`, `ScreenContent.masque/scenography` (Task 1), `styleDuMasque`, `classesPolices`, `marqueDeRepli`, `TYPE_PAIRS`.
- Produces:
  ```ts
  export interface ScenographyProps { scene: ScreenScenePayload; content: ScreenContent; orientation: ScreenOrientation; prixMono: boolean }
  export interface ScenographyModule { Component: ComponentType<ScenographyProps>; chrome: 'header' | 'none' }
  export const SCENOGRAPHIES_WEB: Record<Scenography, ScenographyModule>
  export function moduleDe(slug: string | undefined): ScenographyModule   // repli Ardoise
  export function computeStage(viewport: { width: number; height: number }, configured: ScreenOrientation | null): Stage
  export function useEmbeddedStage(ref: RefObject<HTMLElement | null>, configured: ScreenOrientation): Stage
  export function useSceneRotation(scenes, options?: { paused?: boolean }): SceneRotation & { go(delta: number): void }
  export function BoardStage(props: { content: ScreenContent | null; masque: Brand; current; leaving; stage: Stage; embed?: boolean; still?: boolean; fallback?: ReactNode })
  export function masqueDuContenu(content: ScreenContent | null): Brand
  ```

- [ ] **Step 1 : Test de `computeStage` (échoue : fonction absente)**

```ts
// apps/web/src/components/board/use-stage.test.ts
import { describe, expect, it } from "vitest";
import { computeStage } from "./use-stage";

describe("computeStage — la scène de référence mise à l'échelle", () => {
  it("un paysage sur un 1280 × 720 est réduit aux deux tiers, sans rotation", () => {
    const stage = computeStage({ width: 1280, height: 720 }, "landscape");
    expect(stage.ready).toBe(true);
    expect(stage.rotated).toBe(false);
    expect(stage.style["--bd-scale"]).toBeCloseTo(2 / 3, 5);
    expect(stage.style["--bd-w"]).toBe("1920px");
  });

  it("un portrait configuré sur un signal paysage pivote de 90°, à l'échelle des dimensions échangées", () => {
    const stage = computeStage({ width: 1920, height: 1080 }, "portrait");
    expect(stage.rotated).toBe(true);
    expect(stage.style["--bd-rot"]).toBe("90deg");
    expect(stage.style["--bd-scale"]).toBeCloseTo(1080 / 1080, 5);
  });

  it("sans mesure, la scène n'est pas prête et l'orientation détectée est paysage", () => {
    const stage = computeStage({ width: 0, height: 0 }, null);
    expect(stage.ready).toBe(false);
    expect(stage.orientation).toBe("landscape");
  });

  it("un conteneur au ratio 9:16 rend un portrait droit, à l'échelle de sa largeur", () => {
    const stage = computeStage({ width: 270, height: 480 }, "portrait");
    expect(stage.rotated).toBe(false);
    expect(stage.style["--bd-scale"]).toBeCloseTo(0.25, 5);
  });
});
```

Run: `cd scratchpad/wt && pnpm --filter web exec vitest run src/components/board/use-stage.test.ts` → FAIL.

- [ ] **Step 2 : `use-stage.ts` — extraire la fonction pure, ajouter l'incrusté**

Remplacer le corps du fichier après `REFERENCE` par :

```ts
export interface StageStyle extends CSSProperties {
  "--bd-w": string;
  "--bd-h": string;
  "--bd-scale": number;
  "--bd-rot": string;
}

export interface Stage {
  orientation: ScreenOrientation;
  /** La scène est pivotée : le matériel ne sort pas dans le bon sens. */
  rotated: boolean;
  ready: boolean;
  /** À poser sur l'élément `.bd-stage`. */
  style: StageStyle;
}

interface Viewport {
  width: number;
  height: number;
}

/**
 * La règle, PURE : d'une mesure et d'une orientation configurée, l'échelle et
 * la rotation. Partagée par le téléviseur (la fenêtre) et par le back-office
 * (un conteneur) — la même règle, donc le même rendu.
 */
export function computeStage(viewport: Viewport, configured: ScreenOrientation | null): Stage {
  const ready = viewport.width > 0 && viewport.height > 0;
  const detected: ScreenOrientation = viewport.width >= viewport.height ? "landscape" : "portrait";
  const orientation = configured ?? detected;
  const rotated = ready && orientation !== detected;
  const { width, height } = REFERENCE[orientation];

  // Pivotée, la scène occupe `height × width` à l'écran : l'échelle se
  // calcule sur les dimensions échangées.
  const scale = !ready
    ? 1
    : rotated
      ? Math.min(viewport.width / height, viewport.height / width)
      : Math.min(viewport.width / width, viewport.height / height);

  return {
    orientation,
    rotated,
    ready,
    style: {
      "--bd-w": `${width}px`,
      "--bd-h": `${height}px`,
      "--bd-scale": scale,
      "--bd-rot": rotated ? "90deg" : "0deg",
    },
  };
}

const SAME = (a: Viewport, b: Viewport) => a.width === b.width && a.height === b.height;

/** Le téléviseur : la scène suit la fenêtre. */
export function useStage(configured: ScreenOrientation | null): Stage {
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () =>
      setViewport((previous) => {
        const next = { width: window.innerWidth, height: window.innerHeight };
        return SAME(previous, next) ? previous : next; // même mesure : pas de re-rendu (12 h/jour)
      });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return useMemo(() => computeStage(viewport, configured), [configured, viewport]);
}

/**
 * Le back-office : la scène suit un CONTENEUR, dont le ratio est celui de
 * l'orientation — donc jamais de rotation. `ResizeObserver` plutôt que
 * `resize` : le tiroir s'ouvre, la colonne se replie, le conteneur bouge
 * sans que la fenêtre change.
 */
export function useEmbeddedStage(ref: RefObject<HTMLElement | null>, configured: ScreenOrientation): Stage {
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport((previous) => {
        const next = { width: rect.width, height: rect.height };
        return SAME(previous, next) ? previous : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return useMemo(() => computeStage(viewport, configured), [configured, viewport]);
}
```

Imports en tête : `import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";`.

Run: le test de l'étape 1 → PASS.

- [ ] **Step 3 : `use-scene-rotation.ts` — pause et navigation manuelle**

Signature : `export function useSceneRotation(scenes: readonly ScreenScenePayload[], options: { paused?: boolean } = {}): SceneRotation`. Ajouter à `SceneRotation` : `/** Avance ou recule d'un cran, en boucle — le tiroir « Apparence ». */ go: (delta: number) => void;`. Le minuteur :

```ts
  const paused = options.paused === true;
  useEffect(() => {
    if (paused || scenes.length <= 1 || !current) return;
    const timer = setTimeout(() => {
      setIndex((value) => (value + 1) % scenes.length);
    }, current.durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, scenes.length, paused]);

  const go = useCallback(
    (delta: number) => {
      if (scenes.length === 0) return;
      setIndex((value) => (((value + delta) % scenes.length) + scenes.length) % scenes.length);
    },
    [scenes.length],
  );

  return { current, leaving, index: safeIndex, go };
```

Test `use-scene-rotation.test.ts` (créer s'il n'existe pas ; environnement `jsdom` requis → en tête du fichier `// @vitest-environment jsdom` ; vérifier que `jsdom` est installé côté web avec `ls apps/web/node_modules/jsdom` — sinon installer `pnpm --filter web add -D jsdom` et le dire dans le commit) :

```ts
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
```

Si `@testing-library/react` n'est pas installé (`ls apps/web/node_modules/@testing-library`), NE PAS l'ajouter : tester `go` par une fonction pure extraite `indexSuivant(index, delta, length)` exportée depuis le même fichier et utilisée par `go` :

```ts
export const indexSuivant = (index: number, delta: number, length: number): number =>
  length === 0 ? 0 : (((index + delta) % length) + length) % length;
```

```ts
import { describe, expect, it } from "vitest";
import { indexSuivant } from "./use-scene-rotation";
describe("indexSuivant — la boucle du tiroir", () => {
  it("avance, recule, et boucle dans les deux sens", () => {
    expect(indexSuivant(0, 1, 3)).toBe(1);
    expect(indexSuivant(2, 1, 3)).toBe(0);
    expect(indexSuivant(0, -1, 3)).toBe(2);
    expect(indexSuivant(5, 1, 0)).toBe(0);
  });
});
```

- [ ] **Step 4 : Le registre et Ardoise déplacée**

```ts
// apps/web/src/components/board/scenographies/registry.ts
import type { ComponentType } from "react";
import type { Scenography, ScreenContent, ScreenOrientation, ScreenScenePayload } from "@sm/contracts";
import { Ardoise } from "./ardoise/Ardoise";

/**
 * LE REGISTRE DES SCÉNOGRAPHIES — une mise en scène est un module, pas un fichier.
 *
 * L'hôte (`BoardStage`) garantit à chacune le cadre de référence, les jetons du
 * masque, les polices de l'accord, la rotation, le fondu entre scènes et la
 * mise à jour en place. Une scénographie ne fait que composer une scène.
 */
export interface ScenographyProps {
  scene: ScreenScenePayload;
  content: ScreenContent;
  orientation: ScreenOrientation;
  /** Deux accords sur dix posent les prix en chasse fixe — lu une fois par l'hôte. */
  prixMono: boolean;
}

export interface ScenographyModule {
  Component: ComponentType<ScenographyProps>;
  /** `header` : l'hôte peint l'en-tête persistant ; `none` : la scénographie dessine le sien. */
  chrome: "header" | "none";
}

export const SCENOGRAPHIES_WEB: Record<Scenography, ScenographyModule> = {
  ardoise: Ardoise,
  // `comptoir` s'ajoute à la tâche 9.
  comptoir: Ardoise,
};

/** Un contenu mis en cache par une version antérieure n'a pas de scénographie : Ardoise. */
export function moduleDe(slug: string | undefined): ScenographyModule {
  return (slug && (SCENOGRAPHIES_WEB as Record<string, ScenographyModule>)[slug]) || Ardoise;
}
```

`git mv apps/web/src/components/board/product-row.tsx apps/web/src/components/board/scenographies/ardoise/product-row.tsx`.
`git mv apps/web/src/components/board/board-scenes.tsx apps/web/src/components/board/scenographies/ardoise/Ardoise.tsx`, puis dans ce fichier : retirer `SceneLayer` (elle passe à `scene-layer.tsx`), renommer `SceneBody` en `ArdoiseScene` avec la signature `({ scene, orientation, content }: ScenographyProps)` — `brandName = content.brand.name`, `logoUrl = content.brand.logoUrl` — et exporter en fin de fichier :

```ts
export const Ardoise: ScenographyModule = { Component: ArdoiseScene, chrome: "header" };
```

(import `type { ScenographyModule, ScenographyProps } from "../registry"` — import de type seul, le cycle est sans effet.)

- [ ] **Step 5 : `scene-layer.tsx` et `board-stage.tsx`**

```tsx
// apps/web/src/components/board/scene-layer.tsx
"use client";

import type { ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { moduleDe } from "./scenographies/registry";

/**
 * Une couche de scène. Deux couches coexistent le temps du fondu (l'entrante
 * par-dessus la sortante) : c'est ce qui évite le passage par le noir.
 * La composition est déléguée au module de la scénographie de l'écran.
 */
export function SceneLayer({
  scene,
  content,
  phase,
  prixMono,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  phase: "in" | "out";
  prixMono: boolean;
}) {
  const { Component } = moduleDe(content.scenography);
  return (
    <div className="bd-layer" data-phase={phase} aria-hidden={phase === "out"}>
      <Component scene={scene} content={content} orientation={content.orientation} prixMono={prixMono} />
    </div>
  );
}
```

```tsx
// apps/web/src/components/board/board-stage.tsx
"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { TYPE_PAIRS, marqueDeRepli, type Brand, type ScreenContent, type ScreenScenePayload } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { BoardHeader } from "./board-header";
import { SceneLayer } from "./scene-layer";
import { moduleDe } from "./scenographies/registry";
import type { Stage } from "./use-stage";

/**
 * Le masque que l'écran PEINT. Un cache écrit par une version antérieure n'en
 * porte pas : on replie sur l'accent et le logo plats plutôt que sur un écran
 * noir, le temps du prochain contenu frais.
 */
export function masqueDuContenu(content: ScreenContent | null): Brand {
  if (content?.masque) return content.masque;
  return marqueDeRepli(content?.brand.accent ?? null, content?.brand.logoUrl ?? null);
}

/**
 * L'HÔTE — ce que toute scénographie reçoit sans le refaire.
 *
 * Le cadre de référence mis à l'échelle, les jetons du masque et les polices
 * de l'accord sur la racine, l'en-tête persistant si la scénographie le
 * demande, les deux couches du fondu, la barre de progression. Le téléviseur
 * et le tiroir « Apparence » montent le même composant : `embed` ne change
 * que la géométrie (le conteneur au lieu de la fenêtre), jamais le rendu.
 */
export function BoardStage({
  content,
  current,
  leaving,
  stage,
  embed = false,
  still = false,
  fallback = null,
  className,
}: {
  content: ScreenContent | null;
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  stage: Stage;
  /** Incrusté dans une page (aperçu) : géométrie du conteneur, curseur visible. */
  embed?: boolean;
  /** Mouvement figé — les tuiles de choix du tiroir. */
  still?: boolean;
  /** Ce qui s'affiche sans scène (chargement, non appairé). */
  fallback?: ReactNode;
  className?: string;
}) {
  const masque = useMemo(() => masqueDuContenu(content), [content]);
  const skin = useMemo(() => styleDuMasque(masque), [masque]);
  const prixMono = TYPE_PAIRS[masque.type.pair].prixMono;
  const chrome = moduleDe(content?.scenography).chrome;
  const multiScene = (content?.scenes.length ?? 0) > 1;

  return (
    <div
      className={cx("bd-root", classesPolices, className)}
      style={skin}
      data-embed={embed ? "1" : "0"}
      data-still={still ? "1" : "0"}
      data-scenography={content?.scenography ?? "ardoise"}
      data-prix-mono={prixMono ? "1" : "0"}
    >
      <div
        className="bd-stage"
        data-orientation={stage.orientation}
        data-ready={stage.ready ? "1" : "0"}
        style={stage.style}
      >
        {content && chrome === "header" ? (
          <BoardHeader
            masque={masque}
            brand={content.brand}
            serviceLabel={content.serviceLabel}
            open={content.open}
            timezone={content.timezone}
          />
        ) : null}

        <div className="bd-stagearea">
          {leaving && content ? (
            <SceneLayer key={`out-${leaving.id}`} scene={leaving} content={content} phase="out" prixMono={prixMono} />
          ) : null}
          {current && content ? (
            <SceneLayer key={current.id} scene={current} content={content} phase="in" prixMono={prixMono} />
          ) : (
            fallback
          )}
        </div>

        <div className="bd-progress">
          {multiScene && current && !still ? (
            <div
              key={current.id}
              className="bd-progress-fill"
              style={{ "--bd-dur": `${current.durationMs}ms` } as CSSProperties}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6 : `board-display.tsx` — utiliser l'hôte**

Retirer `boardPalette`, `SceneLayer`, `BoardHeader`, `useMemo` des imports ; importer `BoardStage`. Le rendu devient :

```tsx
  return (
    <div className="bd-display-root">
      <BoardStage
        content={content}
        current={current}
        leaving={leaving}
        stage={stage}
        className="bd-display"
        fallback={
          // Ni réseau ni cache : une plaque sobre, jamais un écran noir.
          <div className="bd-layer" data-phase="in">
            <div className="bd-plate">
              <div className="bd-plate-kicker">Menu Board</div>
              <div className="bd-plate-title">
                {checked && !token ? "Écran non appairé" : "Chargement de la carte"}
              </div>
              <div className="bd-plate-line">
                {checked && !token
                  ? "Redirection vers l'appairage…"
                  : "Le dernier menu connu s'affichera dès qu'il sera disponible."}
              </div>
            </div>
          </div>
        }
      />
      {offline ? (
        <div className="bd-offline">
          <span className="bd-offline-dot" />
          Hors ligne
          {lastSyncAt ? ` · carte de ${formatSync(lastSyncAt, content?.timezone ?? null)}` : ""}
        </div>
      ) : null}
    </div>
  );
```

Le bandeau hors ligne sort de la scène (il était dans `.bd-stagearea`) : vérifier dans `board.css` que `.bd-offline` est positionné en `position: fixed` — sinon le passer en `fixed` avec les mêmes décalages. `.bd-display-root { position: fixed; inset: 0; }`.

`board-theme.ts` : supprimer `boardPalette`, `BoardPalette`, `normaliser`, `readableOn`, `DEFAULT_ACCENT`, `ENCRE_*` et les imports devenus inutiles ; garder `monogramOf`. Vérifier : `grep -rn "boardPalette" apps/web/src` → aucune occurrence (sinon `pairing-screen.tsx` : remplacer par `styleDuMasque(marqueDeRepli(null, null))` sur sa racine, avec `classesPolices`).

`board-header.tsx` : signature `({ masque, brand, serviceLabel, open, timezone }: { masque: Brand; brand: ScreenBrand; … })`. Le bloc `.bd-brand` devient :

```tsx
      <div className="bd-brand">
        {verrou ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bd-verrou" src={verrou} alt={brand.name} decoding="async" />
        ) : (
          <>
            {marque ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bd-logo" src={marque} alt="" decoding="async" />
            ) : (
              <div className="bd-logo bd-logo-fallback">{monogramOf(brand.name)}</div>
            )}
            <div className="bd-brand-name">{brand.name}</div>
          </>
        )}
      </div>
```

avec, avant le `return` : `const verrou = verrouPour(masque);` et `const marque = marqueSeule(masque);` où :

```ts
/** La MARQUE (le symbole) du mode en cours, sans retomber sur le verrou : ici le nom est écrit à côté. */
export function marqueSeule(brand: Brand): string | null {
  const pref = brand.mode === "dark" ? "dark" : "light";
  const alt = pref === "dark" ? "light" : "dark";
  return brand.logo.mark[pref] ?? brand.logo.mark[alt];
}
```

(`verrouPour` depuis `@/components/ui/verrou`.)

- [ ] **Step 7 : `board.css` — l'incrusté et le verrou**

Après `.bd-display, .bd-display * { cursor: none }` :

```css
/* ── Incrusté dans une page (tiroir « Apparence ») ── */

/* La racine prend la géométrie de son conteneur ; la scène reste centrée dedans. */
.bd-root[data-embed="1"] {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

/* Les tuiles de choix : le mouvement est figé, on regarde une composition. */
.bd-root[data-still="1"] *,
.bd-root[data-still="1"] *::before,
.bd-root[data-still="1"] *::after {
  animation-play-state: paused !important;
}

.bd-verrou {
  height: var(--bd-logo);
  width: auto;
  max-width: 460px;
  object-fit: contain;
  flex: 0 0 auto;
}
```

- [ ] **Step 8 : Typage, lint, tests web**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web exec vitest run src/components/board`
Expected: PASS. Le garde `verrou.test.ts` (PIECES_DE_LOGO) est mis à jour à la tâche 12.

- [ ] **Step 9 : Commit**

```bash
git add apps/web/src/components/board
git commit -m "écran de salle : un hôte, un registre de scénographies, et le masque sur la racine"
```

---

### Task 7 : Web — Ardoise adopte le masque

**Files:**
- Modify: `apps/web/src/components/board/board.css`
- Modify: `apps/web/src/components/board/scenographies/ardoise/Ardoise.tsx` (aucun changement de rendu attendu ; vérifier les classes)

**Interfaces:**
- Consumes: jetons `--cf-*` posés par `BoardStage` (Task 6), `data-prix-mono`.

- [ ] **Step 1 : Substitutions, une par une, dans `board.css`**

| Avant (ligne indicative) | Après |
|---|---|
| `font-family: var(--font-inter), system-ui, sans-serif;` (racine) | `font-family: var(--cf-font-body, system-ui, sans-serif);` |
| `--bd-accent: #c9a15a;` `--bd-on-accent: #12100d;` `--bd-accent-12: …;` `--bd-accent-24: …;` | supprimer les quatre lignes |
| toute occurrence `var(--bd-accent)` | `var(--cf-accent)` |
| `var(--bd-on-accent)` | `var(--cf-on-accent)` |
| `var(--bd-accent-12)` | `var(--cf-accent-wash)` |
| `var(--bd-accent-24)` | `var(--cf-line-firm)` |
| `--bd-mut: #9a9a9a;` | `--bd-mut: var(--cf-mut);` |
| `--bd-mut-2: #6f6f6f;` | `--bd-mut-2: var(--cf-line-firm);` |
| `--bd-line: rgba(255, 255, 255, 0.08);` | `--bd-line: var(--cf-line);` |
| `--bd-card: linear-gradient(…#111, #111);` (2 lignes) | `--bd-card: var(--cf-card-gradient);` |
| `--bd-elev: linear-gradient(…#1a1a1a);` (2 lignes) | `--bd-elev: var(--cf-elev-gradient);` |
| `background: #1a1a1a;` (×3 : logo, vignette, photo héros) | `background: var(--cf-surface-2);` |
| `border: 1px solid rgba(255, 255, 255, 0.06);` (×2) | `border: 1px solid var(--cf-line-2);` |
| `background: rgba(255, 255, 255, 0.05);` | `background: var(--cf-surface-6);` |
| carte promo : `linear-gradient(180deg, var(--bd-accent-12), rgba(255,255,255,0) 70%), linear-gradient(0deg, #111, #111)` | `linear-gradient(180deg, var(--cf-accent-wash), rgba(255, 255, 255, 0) 70%), var(--cf-card-gradient)` |
| piste de progression `rgba(255, 255, 255, 0.06)` | `var(--cf-surface-6)` |
| bandeau hors ligne `rgba(0, 0, 0, 0.72)` | `var(--cf-scrim)` |
| appairage : `color: #fff;` (×3) | `color: var(--cf-text);` |
| appairage : bordures `rgba(255, 255, 255, 0.1)` (×2) | `var(--cf-line)` |

Puis ajouter, dans la section « Titre de scène » : `.bd-title { font-family: var(--cf-font-display, inherit); }` (fusionner dans la règle existante), et à la fin de la section « Liste de produits » :

```css
/* Deux accords sur dix posent les prix en chasse fixe : l'hôte le dit, la feuille suit. */
.bd-root[data-prix-mono="1"] .bd-price,
.bd-root[data-prix-mono="1"] .bd-hero-price,
.bd-root[data-prix-mono="1"] .bd-promo-label {
  font-family: var(--cf-font-mono);
  font-variant-numeric: tabular-nums;
}
```

Mettre à jour le commentaire d'en-tête du fichier (« Les couleurs neutres reprennent les tokens de globals.css… seul --bd-accent est injecté ») : *« Toutes les couleurs viennent des jetons du masque posés par l'hôte (`BoardStage`) : sur un tenant non repris, le repli Nuit rend les mêmes noirs et le même laiton qu'avant. »*

- [ ] **Step 2 : Vérifier qu'il ne reste aucune couleur en dur hors replis**

Run: `grep -n "#[0-9a-fA-F]\{3,6\}\b\|rgba(255, 255, 255\|rgba(0, 0, 0" apps/web/src/components/board/board.css`
Expected : seules les valeurs de REPLI dans `var(--cf-…, #…)` et le `rgba(255, 255, 255, 0)` transparent du dégradé promo.

- [ ] **Step 3 : Garde de non-régression — `apps/web/src/components/board/board-css.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./board.css", import.meta.url), "utf8");

describe("board.css — l'écran de salle ne connaît que les jetons du masque", () => {
  it("n'écrit aucune couleur en dur hors valeur de repli d'un jeton", () => {
    const sansReplis = css.replace(/var\(--cf-[a-z0-9-]+,\s*[^)]+\)/g, "").replace(/rgba\(255, 255, 255, 0\)/g, "");
    expect(sansReplis).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(sansReplis).not.toMatch(/rgba\(255, 255, 255,/);
    expect(sansReplis).not.toMatch(/rgba\(0, 0, 0,/);
  });

  it("n'anime que transform et opacity", () => {
    const keyframes = css.match(/@keyframes[\s\S]*?\n}/g) ?? [];
    for (const bloc of keyframes) {
      const proprietes = [...bloc.matchAll(/^\s+([a-z-]+)\s*:/gm)].map((m) => m[1]);
      for (const p of proprietes) expect(["transform", "opacity"]).toContain(p);
    }
  });
});
```

Run: `pnpm --filter web exec vitest run src/components/board/board-css.test.ts` → PASS (sinon, la substitution manquée est nommée par le test).

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/board/board.css apps/web/src/components/board/board-css.test.ts
git commit -m "ardoise : l'écran de salle prend le masque du restaurant, plus un gris en dur"
```

---

### Task 8 : Web — Comptoir, les règles de composition (pures)

**Files:**
- Create: `apps/web/src/components/board/scenographies/comptoir/composition.ts`
- Test: `apps/web/src/components/board/scenographies/comptoir/composition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Disposition = "closed" | "promo" | "empty" | "hero" | "featured" | "g2x1" | "g3x1" | "g4x1" | "g3x2" | "g4x2" | "stack2" | "g2x2" | "list";
  export function disposition(kind: ScreenScenePayload["kind"], count: number, o: ScreenOrientation): Disposition
  export interface Tailles { nom: number; desc: number; prix: number; titre: number; libelle: number; nomHeros: number; prixHeros: number }
  export function tailles(o: ScreenOrientation, d: Disposition): Tailles
  export const PLANCHERS: Record<ScreenOrientation, { nom: number; desc: number; prix: number; titre: number }>
  export function vignettes(o: ScreenOrientation, d: Disposition, count: number): { liste: number; laterale: number }
  export function variablesDeScene(o: ScreenOrientation, d: Disposition, count: number): CSSProperties
  ```

- [ ] **Step 1 : Test (échoue)**

```ts
import { describe, expect, it } from "vitest";
import { PLANCHERS, disposition, tailles, variablesDeScene, vignettes, type Disposition } from "./composition";

const O = ["landscape", "portrait"] as const;

describe("disposition — combien de produits, quelle composition", () => {
  it("les cas qui ne dépendent pas de l'effectif", () => {
    expect(disposition("closed", 5, "landscape")).toBe("closed");
    expect(disposition("promo", 0, "portrait")).toBe("promo");
    expect(disposition("category", 0, "landscape")).toBe("empty");
    expect(disposition("custom", 1, "portrait")).toBe("hero");
    expect(disposition("featured", 4, "landscape")).toBe("featured");
    expect(disposition("featured", 1, "landscape")).toBe("hero");
  });

  it("en paysage : 2, 3, 4 en ligne ; 5 à 6 en 3 × 2 ; 7 à 8 en 4 × 2", () => {
    expect(disposition("category", 2, "landscape")).toBe("g2x1");
    expect(disposition("category", 3, "landscape")).toBe("g3x1");
    expect(disposition("category", 4, "landscape")).toBe("g4x1");
    expect(disposition("category", 5, "landscape")).toBe("g3x2");
    expect(disposition("category", 6, "landscape")).toBe("g3x2");
    expect(disposition("category", 7, "landscape")).toBe("g4x2");
    expect(disposition("category", 8, "landscape")).toBe("g4x2");
  });

  it("en portrait : 2 empilés ; 3 à 4 en 2 × 2 ; 5 à 8 en liste", () => {
    expect(disposition("category", 2, "portrait")).toBe("stack2");
    expect(disposition("category", 3, "portrait")).toBe("g2x2");
    expect(disposition("category", 4, "portrait")).toBe("g2x2");
    expect(disposition("category", 5, "portrait")).toBe("list");
    expect(disposition("category", 8, "portrait")).toBe("list");
  });
});

describe("tailles — jamais sous les planchers, et ça monte quand il y a de la place", () => {
  const atteignables: Record<(typeof O)[number], Disposition[]> = {
    landscape: ["closed", "promo", "empty", "hero", "featured", "g2x1", "g3x1", "g4x1", "g3x2", "g4x2"],
    portrait: ["closed", "promo", "empty", "hero", "featured", "stack2", "g2x2", "list"],
  };
  for (const o of O) {
    for (const d of atteignables[o]) {
      it(`${o} · ${d}`, () => {
        const t = tailles(o, d);
        const p = PLANCHERS[o];
        expect(t.nom).toBeGreaterThanOrEqual(p.nom);
        expect(t.desc).toBeGreaterThanOrEqual(p.desc);
        expect(t.prix).toBeGreaterThanOrEqual(p.prix);
        expect(t.titre).toBeGreaterThanOrEqual(p.titre);
        expect(t.nomHeros).toBeGreaterThanOrEqual(t.nom);
        expect(t.prixHeros).toBeGreaterThanOrEqual(t.prix);
      });
    }
  }
  it("deux produits en paysage se lisent de plus loin que huit", () => {
    expect(tailles("landscape", "g2x1").nom).toBeGreaterThan(tailles("landscape", "g4x2").nom);
  });
});

describe("vignettes — des pixels de référence, jamais la taille du téléviseur", () => {
  it("une liste portrait de 8 lignes partage 1522 px moins les 7 interlignes", () => {
    expect(vignettes("portrait", "list", 8).liste).toBe(176);
  });
  it("la liste latérale d'une sélection de 8 en paysage tient dans 740 px", () => {
    expect(vignettes("landscape", "featured", 8).laterale).toBe(77);
  });
  it("une liste latérale ne descend jamais sous 56 ni au-dessus de 120", () => {
    expect(vignettes("landscape", "featured", 2).laterale).toBe(120);
    expect(vignettes("portrait", "featured", 8).laterale).toBeGreaterThanOrEqual(56);
  });
});

describe("variablesDeScene — ce que la feuille lit", () => {
  it("pose les tailles, les vignettes et l'effectif", () => {
    const vars = variablesDeScene("portrait", "list", 6) as Record<string, string | number>;
    expect(vars["--ct-fs-nom"]).toBe("56px");
    expect(vars["--ct-n"]).toBe(6);
    expect(vars["--ct-thumb"]).toMatch(/px$/);
  });
});
```

Run: `pnpm --filter web exec vitest run src/components/board/scenographies/comptoir/composition.test.ts` → FAIL.

- [ ] **Step 2 : Implémenter `composition.ts`**

```ts
import type { CSSProperties } from "react";
import type { ScreenOrientation, ScreenScenePayload } from "@sm/contracts";

/**
 * COMPTOIR — les règles de composition, pures.
 *
 * Tout est en pixels de la RÉSOLUTION DE RÉFÉRENCE (1920 × 1080 / 1080 × 1920) :
 * l'hôte met la scène à l'échelle, la scénographie ne connaît jamais le
 * téléviseur. La table des tailles respecte les planchers à huit lignes et
 * monte dès qu'il y a moins de produits — une catégorie de deux se lit d'un
 * mètre plus loin qu'une catégorie de huit.
 */

export type Disposition =
  | "closed" | "promo" | "empty" | "hero" | "featured"
  | "g2x1" | "g3x1" | "g4x1" | "g3x2" | "g4x2"
  | "stack2" | "g2x2" | "list";

export function disposition(kind: ScreenScenePayload["kind"], count: number, o: ScreenOrientation): Disposition {
  if (kind === "closed") return "closed";
  if (kind === "promo") return "promo";
  if (count <= 0) return "empty";
  if (count === 1) return "hero";
  if (kind === "featured") return "featured";
  if (o === "landscape") {
    if (count === 2) return "g2x1";
    if (count === 3) return "g3x1";
    if (count === 4) return "g4x1";
    return count <= 6 ? "g3x2" : "g4x2";
  }
  if (count === 2) return "stack2";
  return count <= 4 ? "g2x2" : "list";
}

export interface Tailles {
  nom: number; desc: number; prix: number; titre: number; libelle: number;
  nomHeros: number; prixHeros: number;
}

/** Les planchers du produit — huit lignes, lues à quatre mètres. */
export const PLANCHERS: Record<ScreenOrientation, { nom: number; desc: number; prix: number; titre: number }> = {
  landscape: { nom: 42, desc: 24, prix: 46, titre: 76 },
  portrait: { nom: 56, desc: 30, prix: 62, titre: 96 },
};

type Ligne = [nom: number, desc: number, prix: number, titre: number, libelle: number, nomHeros?: number, prixHeros?: number];

const TABLE: Record<ScreenOrientation, Partial<Record<Disposition, Ligne>>> = {
  landscape: {
    g4x2: [42, 24, 46, 80, 20], g3x2: [46, 26, 52, 84, 20], g4x1: [54, 30, 60, 90, 22],
    g3x1: [58, 30, 64, 90, 22], g2x1: [66, 34, 72, 96, 24], hero: [96, 38, 110, 96, 26],
    featured: [42, 30, 46, 80, 20, 72, 84], promo: [44, 28, 52, 112, 26, 60, 84],
    closed: [56, 36, 46, 96, 26], empty: [42, 24, 46, 80, 20],
  },
  portrait: {
    list: [56, 30, 62, 96, 24], g2x2: [60, 32, 68, 100, 26], stack2: [72, 36, 80, 104, 28],
    hero: [104, 40, 120, 104, 30], featured: [56, 34, 62, 96, 24, 80, 96],
    promo: [52, 32, 60, 128, 30, 68, 96], closed: [64, 40, 56, 112, 30], empty: [56, 30, 62, 96, 24],
  },
};

export function tailles(o: ScreenOrientation, d: Disposition): Tailles {
  const ligne = TABLE[o][d] ?? TABLE[o].empty!;
  const [nom, desc, prix, titre, libelle, nomHeros, prixHeros] = ligne;
  return { nom, desc, prix, titre, libelle, nomHeros: nomHeros ?? nom, prixHeros: prixHeros ?? prix };
}

/** Hauteur de référence du CORPS (sous l'en-tête, au-dessus de la marge basse). */
const CORPS: Record<ScreenOrientation, number> = { landscape: 740, portrait: 1522 };
/** En portrait, la sélection pose son héros sur 760 px, puis 24 px d'écart. */
const HEROS_PORTRAIT = 760 + 24;
const INTERLIGNE_LISTE = 16;
const INTERLIGNE_LATERALE = 12;

export function vignettes(o: ScreenOrientation, d: Disposition, count: number): { liste: number; laterale: number } {
  const corps = CORPS[o];
  const n = Math.max(1, count);
  const liste = d === "list" ? Math.min(240, Math.round((corps - (n - 1) * INTERLIGNE_LISTE) / n)) : 0;
  let laterale = 0;
  if (d === "featured") {
    const m = Math.max(1, n - 1);
    const cote = o === "landscape" ? corps : corps - HEROS_PORTRAIT;
    const rangee = (cote - (m - 1) * INTERLIGNE_LATERALE) / m;
    laterale = Math.max(56, Math.min(120, Math.round(rangee - 18)));
  }
  return { liste, laterale };
}

export function variablesDeScene(o: ScreenOrientation, d: Disposition, count: number): CSSProperties {
  const t = tailles(o, d);
  const v = vignettes(o, d, count);
  return {
    "--ct-fs-nom": `${t.nom}px`,
    "--ct-fs-desc": `${t.desc}px`,
    "--ct-fs-prix": `${t.prix}px`,
    "--ct-fs-titre": `${t.titre}px`,
    "--ct-fs-libelle": `${t.libelle}px`,
    "--ct-fs-heros-nom": `${t.nomHeros}px`,
    "--ct-fs-heros-prix": `${t.prixHeros}px`,
    "--ct-thumb": `${v.liste || 176}px`,
    "--ct-sthumb": `${v.laterale || 76}px`,
    "--ct-n": count,
    "--ct-m": Math.max(1, count - 1),
  } as CSSProperties;
}
```

Run: le test → PASS.

- [ ] **Step 3 : Commit**

```bash
git add apps/web/src/components/board/scenographies/comptoir/composition.ts apps/web/src/components/board/scenographies/comptoir/composition.test.ts
git commit -m "comptoir : les règles de composition, en pixels de référence et sous aucun plancher"
```

---

### Task 9 : Web — Comptoir, le composant, sa feuille, `FadeText`

**Files:**
- Create: `apps/web/src/components/board/scenographies/comptoir/FadeText.tsx`
- Create: `apps/web/src/components/board/scenographies/comptoir/Comptoir.tsx`
- Create: `apps/web/src/components/board/scenographies/comptoir/comptoir.css`
- Modify: `apps/web/src/components/board/scenographies/registry.ts` (`comptoir: Comptoir`)
- Modify: `apps/web/src/app/board/layout.tsx` (importer `comptoir.css`)
- Modify: `apps/web/src/components/board/board-css.test.ts` (couvrir aussi `comptoir.css`)
- Test: `apps/web/src/components/board/scenographies/comptoir/FadeText.test.ts` (fonction pure `dureeMs`)

**Interfaces:**
- Consumes: `ScenographyProps`, `ScenographyModule` (Task 6), `composition.ts` (Task 8), `cadrageCss(point): string` (object-position), `verrouPour`, `marqueSeule` (Task 6), `useRestaurantClock`.
- Produces: `export const Comptoir: ScenographyModule = { Component: ComptoirScene, chrome: "none" }`.

- [ ] **Step 1 : `FadeText` — un texte qui se fond quand il change, et sa durée lue dans le jeton**

Test (échoue) :

```ts
// FadeText.test.ts
import { describe, expect, it } from "vitest";
import { dureeMs } from "./FadeText";
describe("dureeMs — la durée d'un jeton de mouvement", () => {
  it("lit des millisecondes, des secondes, et replie à 240 ms sur une valeur vide", () => {
    expect(dureeMs("240ms")).toBe(240);
    expect(dureeMs(" 0.32s ")).toBe(320);
    expect(dureeMs("")).toBe(240);
  });
});
```

Implémentation :

```tsx
// FadeText.tsx
"use client";

import { useEffect, useRef, useState, type ElementType } from "react";

/** « 240ms » → 240, « 0.32s » → 320. Vide ou illisible : la valeur de base du profil « posé ». */
export function dureeMs(brut: string): number {
  const v = brut.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 240;
  return /ms$/.test(v) ? n : n * 1000;
}

/**
 * Un texte qui SE FOND quand sa valeur change — jamais un saut.
 *
 * La mise à jour en place (même scène, prix ou nom corrigé) arrive au plus une
 * fois par minute, sous les yeux des clients : l'ancien texte s'efface en
 * `--sm-t-fast`, le nouveau prend sa place, et la ligne ne bouge pas. Le prix,
 * lui, ne passe PAS par ici — le contrat veut qu'il change sans animation.
 */
export function FadeText({
  value,
  as: Tag = "span",
  className,
}: {
  value: string;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(value);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (value === shown) return;
    const duree = dureeMs(ref.current ? getComputedStyle(ref.current).getPropertyValue("--sm-t-fast") : "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le fondu est un ENCHAÎNEMENT dans le temps (effacer, puis remplacer) : il ne se dérive pas du rendu, il se joue après lui.
    setFading(true);
    const timer = setTimeout(() => {
      setShown(value);
      setFading(false);
    }, duree);
    return () => clearTimeout(timer);
  }, [value, shown]);

  return (
    <Tag ref={ref} className={className} data-fade={fading ? "1" : "0"}>
      {shown}
    </Tag>
  );
}
```

- [ ] **Step 2 : `Comptoir.tsx`**

```tsx
"use client";

import type { CSSProperties } from "react";
import { cadrageCss, type ScreenContent, type ScreenProduct, type ScreenPromo, type ScreenScenePayload } from "@sm/contracts";
import { verrouPour } from "@/components/ui/verrou";
import { marqueSeule } from "../../board-header";
import { useRestaurantClock } from "../../board-runtime";
import type { ScenographyModule, ScenographyProps } from "../registry";
import { disposition, variablesDeScene, type Disposition } from "./composition";
import { FadeText } from "./FadeText";

/**
 * COMPTOIR — « le comptoir de nuit ».
 *
 * L'œil voit d'abord la nourriture : des boîtes photo pleines, posées sur un
 * fond profond, comme des plats sous la lampe du comptoir. Deuxième lecture,
 * le prix : étiquette collée en accent, un peu de travers, jamais discrète,
 * jamais animée. Troisième, le nom en capitales de titrage, puis la
 * composition en retrait. Le titre de scène ancre la catégorie ; son fantôme
 * tapisse le fond et donne de la matière sans rien ajouter.
 *
 * Le rythme : une entrée en cascade des boîtes, puis le calme — seule la
 * photo du héros dérive, sur toute la durée de la scène. Rien ne clignote,
 * rien ne saute quand un prix change (`FadeText`, clés par identifiant).
 *
 * Tout vient du masque et du contenu : aucune couleur, aucune police, aucune
 * durée ici. La même scénographie sert tous les restaurants.
 */

/** Le contrat plafonne à huit ; un panneau libre n'est pas paginé par le serveur. */
const MAX_PRODUITS = 8;
const MAX_OFFRES = 3;

/** « Les », « La », « L' » ne font pas une initiale. */
function initiale(nom: string): string {
  return nom.replace(/^\s*(les?|la|l')\s*/i, "").trim().charAt(0).toUpperCase() || "?";
}

function Photo({ p, drift, durationMs }: { p: ScreenProduct; drift?: boolean; durationMs?: number }) {
  if (!p.photoUrl) return <span className="ct-ghost">{initiale(p.name)}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={p.photoUrl}
      src={p.photoUrl}
      alt=""
      decoding="async"
      className={drift ? "ct-drift" : undefined}
      style={{
        objectPosition: cadrageCss(p.photoPoint),
        ...(drift && durationMs ? { animationDuration: `${durationMs}ms` } : {}),
      }}
    />
  );
}

const etat = (p: ScreenProduct) => ({
  "data-oos": p.outOfStock ? "1" : "0",
  "data-photo": p.photoUrl ? "1" : "0",
});

function Prix({ p, className = "ct-badge" }: { p: ScreenProduct; className?: string }) {
  // Le prix change SANS animation — c'est la règle, pas un oubli.
  return <span className={className}>{p.priceLabel}</span>;
}

function Etiquettes({ p }: { p: ScreenProduct }) {
  return (
    <>
      <span className="ct-new" hidden={!p.isNew}>Nouveau</span>
      <span className="ct-oos-tag">Épuisé</span>
    </>
  );
}

function Tuile({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-tile ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} />
        <div className="ct-dim" />
        <Prix p={p} />
        <Etiquettes p={p} />
      </div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
    </article>
  );
}

function Ligne({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-row ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} />
        <div className="ct-dim" />
        <Etiquettes p={p} />
      </div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
      <Prix p={p} />
    </article>
  );
}

function Heros({ p, i, durationMs }: { p: ScreenProduct; i: number; durationMs: number }) {
  return (
    <article className="ct-hero ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} drift durationMs={durationMs} />
        <div className="ct-dim" />
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <Prix p={p} className="ct-badge ct-badge-hero" />
      <span className="ct-new" hidden={!p.isNew}>Nouveau</span>
      <div className="ct-cap">
        <FadeText as="h3" className="ct-name ct-name-hero" value={p.name} />
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
    </article>
  );
}

function LigneLaterale({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-srow ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-thumb"><Photo p={p} /></div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <span className="ct-new" hidden={!p.isNew}>Nouveau</span>
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <Prix p={p} className="ct-price" />
    </article>
  );
}

function Offre({ o, i }: { o: ScreenPromo; i: number }) {
  return (
    <article className="ct-promo ct-it" style={{ "--i": i } as CSSProperties}>
      <div className="ct-ptx">
        <FadeText as="h3" className="ct-ptitle" value={o.title} />
        <FadeText as="p" className="ct-pdesc" value={o.description} />
      </div>
      <FadeText className="ct-plab" value={o.label} />
    </article>
  );
}

function Marque({ content, grand = false }: { content: ScreenContent; grand?: boolean }) {
  const verrou = verrouPour(content.masque);
  const marque = marqueSeule(content.masque);
  const src = verrou ?? marque;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={grand ? "ct-logo ct-logo-big" : "ct-logo"} src={src} alt={content.brand.name} decoding="async" />;
  }
  return <div className={grand ? "ct-bname ct-bname-big" : "ct-bname"}>{content.brand.name}</div>;
}

function Puces({ subtitle }: { subtitle: string | null }) {
  if (!subtitle) return <div className="ct-sub" />;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(subtitle);
  if (!m) return <div className="ct-sub"><FadeText className="ct-subtxt" value={subtitle} /></div>;
  const a = Number(m[1]);
  const n = Number(m[2]);
  return (
    <div className="ct-sub">
      <span className="ct-pips" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className="ct-pip" data-on={i + 1 === a ? "1" : "0"} />
        ))}
      </span>
      <span className="ct-subtxt">{a} / {n}</span>
    </div>
  );
}

function Entete({ scene, content }: { scene: ScreenScenePayload; content: ScreenContent }) {
  const heure = useRestaurantClock(content.timezone);
  return (
    <header className="ct-hd ct-it" style={{ "--i": 0 } as CSSProperties}>
      <div className="ct-hd-l">
        <div className="ct-eyebrow"><FadeText value={content.serviceLabel} /></div>
        <FadeText as="h1" className="ct-title" value={scene.title} />
        <Puces subtitle={scene.subtitle} />
      </div>
      <div className="ct-hd-r">
        <Marque content={content} />
        <div className="ct-svc">
          <span className="ct-dot" data-open={content.open ? "1" : "0"} />
          <span>{content.serviceLabel}</span>
          <span className="ct-sep" />
          <span className="ct-clock">{heure}</span>
        </div>
      </div>
    </header>
  );
}

function Ferme({ scene, content, durationMs }: { scene: ScreenScenePayload; content: ScreenContent; durationMs: number }) {
  const no = scene.nextOpening;
  return (
    <section className="ct-closed">
      <div className="ct-ring" style={{ animationDuration: `${durationMs}ms` }} />
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} grand />
        <FadeText as="h1" className="ct-title" value={scene.title} />
        {no ? (
          <>
            <div className="ct-reopen">Réouverture {no.dayLabel}</div>
            <div className="ct-wins">
              {no.windows.map((w) => <span key={w} className="ct-win">{w}</span>)}
            </div>
          </>
        ) : (
          <FadeText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle ?? ""} />
        )}
        <div className="ct-svc-line">{content.serviceLabel}</div>
      </div>
    </section>
  );
}

function Vide({ scene, content }: { scene: ScreenScenePayload; content: ScreenContent }) {
  return (
    <section className="ct-closed">
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} grand />
        <FadeText as="h1" className="ct-title" value={scene.title || content.brand.name} />
        {scene.subtitle ? <FadeText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle} /> : null}
      </div>
    </section>
  );
}

function Corps({ d, scene, products, promos }: { d: Disposition; scene: ScreenScenePayload; products: ScreenProduct[]; promos: ScreenPromo[] }) {
  const dur = Math.max(0, Math.round(scene.durationMs));
  if (d === "hero") return <Heros p={products[0]!} i={1} durationMs={dur} />;
  if (d === "list") return <div className="ct-grid">{products.map((p, i) => <Ligne key={p.id} p={p} i={i + 1} />)}</div>;
  if (d === "featured")
    return (
      <div className="ct-feat">
        <Heros p={products[0]!} i={1} durationMs={dur} />
        <div className="ct-side">{products.slice(1).map((p, i) => <LigneLaterale key={p.id} p={p} i={i + 2} />)}</div>
      </div>
    );
  if (d === "promo")
    return <div className="ct-promos" data-count={String(promos.length)}>{promos.map((o, i) => <Offre key={o.id} o={o} i={i + 1} />)}</div>;
  return <div className="ct-grid">{products.map((p, i) => <Tuile key={p.id} p={p} i={i + 1} />)}</div>;
}

function ComptoirScene({ scene, content, orientation }: ScenographyProps) {
  const products = scene.products.slice(0, MAX_PRODUITS);
  const promos = scene.promos.slice(0, MAX_OFFRES);
  const d = disposition(scene.kind, products.length, orientation);
  const style = variablesDeScene(orientation, d, products.length);
  const mot = scene.kind === "closed" ? content.brand.name : scene.title;

  return (
    <div className="ct" data-disposition={d} data-o={orientation} style={style}>
      <div className="ct-bg" aria-hidden>
        <div className="ct-halo" />
        <div className="ct-bgword">{mot}</div>
      </div>
      <div className="ct-stage">
        {d === "closed" ? (
          <Ferme scene={scene} content={content} durationMs={scene.durationMs} />
        ) : d === "empty" ? (
          <Vide scene={scene} content={content} />
        ) : (
          <>
            <Entete scene={scene} content={content} />
            <section className="ct-body"><Corps d={d} scene={scene} products={products} promos={promos} /></section>
          </>
        )}
      </div>
    </div>
  );
}

export const Comptoir: ScenographyModule = { Component: ComptoirScene, chrome: "none" };
```

Dans `registry.ts` : importer `{ Comptoir } from "./comptoir/Comptoir"` et poser `comptoir: Comptoir` (retirer le commentaire provisoire).

- [ ] **Step 3 : `comptoir.css`** — toutes les tailles en `var(--ct-fs-*)`, toutes les couleurs en `--cf-*`, tout mouvement en `--sm-*`

```css
/*
 * COMPTOIR — feuille de la scénographie « le comptoir de nuit ».
 * Pixels de RÉFÉRENCE (l'hôte met à l'échelle). Aucune couleur, aucune durée
 * en dur : les jetons du masque sont posés par `BoardStage` sur `.bd-root`.
 * Mouvement : transform et opacity, rien d'autre — clé HDMI, douze heures.
 */

.ct { position: absolute; inset: 0; overflow: hidden; background: var(--cf-bg); color: var(--cf-text); font-family: var(--cf-font-body); --ct-price-font: var(--cf-font-display); }
.bd-root[data-prix-mono="1"] .ct { --ct-price-font: var(--cf-font-mono); }
.ct img { display: block; }
.ct [hidden] { display: none !important; }

/* fond : halo d'accent et titre fantôme */
.ct-bg { position: absolute; inset: 0; overflow: hidden; }
.ct-halo { position: absolute; width: 1500px; height: 1500px; right: -520px; top: -640px; border-radius: 50%; background: radial-gradient(closest-side, var(--cf-accent-wash), var(--cf-bg)); }
.ct-bgword { position: absolute; left: -24px; bottom: -150px; font-family: var(--cf-font-display); font-size: 580px; line-height: 1; text-transform: uppercase; white-space: nowrap; color: var(--cf-surface); letter-spacing: -0.02em; }
.ct[data-o="portrait"] .ct-bgword { font-size: 400px; bottom: -104px; }

.ct-stage { position: absolute; inset: 0; padding: 56px 64px 60px; display: flex; flex-direction: column; gap: 32px; }
.ct[data-o="portrait"] .ct-stage { padding: 56px 48px 60px; gap: 28px; }

/* en-tête de scène */
.ct-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 40px; flex: none; }
.ct-hd-l { min-width: 0; flex: 1; }
.ct-eyebrow { font-weight: 700; font-size: var(--ct-fs-libelle); letter-spacing: 0.14em; text-transform: uppercase; color: var(--cf-accent-ink); margin-bottom: 12px; line-height: 1; min-height: 1em; }
.ct-title { margin: 0; font-family: var(--cf-font-display); font-size: var(--ct-fs-titre); line-height: 0.94; text-transform: uppercase; letter-spacing: -0.01em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ct-sub { margin-top: 16px; font-size: var(--ct-fs-desc); color: var(--cf-mut); display: flex; align-items: center; gap: 16px; line-height: 1; min-height: 1em; }
.ct-pips { display: flex; gap: 10px; align-items: center; }
.ct-pip { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--cf-line-2); }
.ct-pip[data-on="1"] { width: 44px; border-radius: var(--cf-r-pill); background: var(--cf-accent); }
.ct-hd-r { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 14px; text-align: right; }
.ct-logo { max-height: 108px; max-width: 360px; width: auto; height: auto; object-fit: contain; }
.ct-bname { font-family: var(--cf-font-display); font-size: 48px; text-transform: uppercase; line-height: 1; }
.ct-svc { display: flex; align-items: center; gap: 14px; font-size: var(--ct-fs-libelle); font-weight: 600; color: var(--cf-mut); letter-spacing: 0.02em; white-space: nowrap; }
.ct-dot { width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--cf-green); }
.ct-dot[data-open="0"] { background: var(--cf-red); }
.ct-sep { width: 1px; height: 1.3em; background: var(--cf-line); }
.ct-clock { font-weight: 800; color: var(--cf-text); font-variant-numeric: tabular-nums; }

/* corps et grilles */
.ct-body { flex: 1; min-height: 0; position: relative; }
.ct-grid { display: grid; gap: 28px; height: 100%; min-height: 0; }
.ct[data-disposition="g4x2"] .ct-grid { grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(2, 1fr); }
.ct[data-disposition="g3x2"] .ct-grid { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }
.ct[data-disposition="g4x1"] .ct-grid { grid-template-columns: repeat(4, 1fr); }
.ct[data-disposition="g3x1"] .ct-grid { grid-template-columns: repeat(3, 1fr); }
.ct[data-disposition="g2x1"] .ct-grid { grid-template-columns: repeat(2, 1fr); }
.ct[data-disposition="g2x2"] .ct-grid { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); gap: 24px; }
.ct[data-disposition="stack2"] .ct-grid { grid-template-rows: repeat(2, 1fr); gap: 24px; }
.ct[data-disposition="list"] .ct-grid { grid-template-rows: repeat(var(--ct-n), 1fr); gap: 16px; }

/* boîte produit */
.ct-tile { position: relative; display: flex; flex-direction: column; background: var(--cf-surface); border-radius: var(--cf-r-md); box-shadow: var(--cf-shadow-card); overflow: hidden; min-height: 0; }
.ct-ph { position: relative; flex: 1; min-height: 0; background: var(--cf-surface-2); overflow: hidden; }
.ct-ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
[data-photo="0"] .ct-ph { background: var(--cf-elev-gradient); }
.ct-ghost { position: absolute; right: -0.06em; bottom: -0.22em; font-family: var(--cf-font-display); font-size: 280px; line-height: 1; color: var(--cf-surface-3); text-transform: uppercase; }
.ct-dim { position: absolute; inset: 0; background: var(--cf-bg); opacity: 0; transition: opacity var(--sm-t-fast) var(--sm-ease); }
[data-oos="1"] .ct-dim { opacity: 0.55; }
.ct-badge { position: absolute; left: 18px; top: 18px; background: var(--cf-accent); color: var(--cf-on-accent); font-family: var(--ct-price-font); font-size: var(--ct-fs-prix); line-height: 1; padding: 0.22em 0.42em 0.18em; border-radius: var(--cf-r-sm); transform: rotate(-3deg); box-shadow: var(--cf-shadow-2); white-space: nowrap; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
[data-oos="1"] .ct-badge { background: var(--cf-surface-6); color: var(--cf-mut); }
.ct-new { position: absolute; right: 16px; top: 16px; font-weight: 700; font-size: var(--ct-fs-libelle); letter-spacing: 0.1em; text-transform: uppercase; background: var(--cf-fill); color: var(--cf-on-fill); padding: 0.4em 0.75em; border-radius: var(--cf-r-pill); line-height: 1; }
.ct-oos-tag { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-4deg); font-family: var(--cf-font-display); font-size: var(--ct-fs-nom); text-transform: uppercase; color: var(--cf-red-t); background: var(--cf-surface-2); border: 3px solid var(--cf-line-2); border-radius: var(--cf-r-sm); padding: 0.25em 0.6em; line-height: 1; opacity: 0; white-space: nowrap; transition: opacity var(--sm-t-fast) var(--sm-ease); }
[data-oos="1"] .ct-oos-tag { opacity: 1; }
.ct-tx { padding: 18px 22px 22px; display: flex; flex-direction: column; gap: 8px; flex: none; }
.ct-name { margin: 0; font-family: var(--cf-font-display); font-size: var(--ct-fs-nom); line-height: 1; text-transform: uppercase; color: var(--cf-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; letter-spacing: -0.005em; }
.ct-desc { margin: 0; font-size: var(--ct-fs-desc); line-height: 1.25; color: var(--cf-mut); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-oos="1"] .ct-name { color: var(--cf-mut); }

/* ligne (portrait, 5 à 8) */
.ct-row { position: relative; display: flex; align-items: center; gap: 26px; background: var(--cf-surface); border-radius: var(--cf-r-md); box-shadow: var(--cf-shadow-soft); overflow: hidden; min-height: 0; padding-right: 28px; }
.ct-row .ct-ph { flex: none; width: var(--ct-thumb); height: 100%; }
.ct-row .ct-tx { flex: 1; min-width: 0; padding: 0; gap: 6px; }
.ct-row .ct-desc { -webkit-line-clamp: 1; }
.ct-row .ct-badge { position: static; flex: none; }
.ct-row .ct-new { right: auto; left: 12px; top: 12px; }
.ct-row .ct-oos-tag { font-size: calc(var(--ct-fs-nom) * 0.6); }

/* héros */
.ct-hero { position: relative; border-radius: var(--cf-r-lg); overflow: hidden; background: var(--cf-surface-2); box-shadow: var(--cf-shadow-card); height: 100%; min-height: 0; }
.ct-hero .ct-ph { position: absolute; inset: 0; }
.ct-hero .ct-ghost { font-size: 640px; }
.ct-badge-hero { left: 36px; top: 36px; font-size: var(--ct-fs-heros-prix); }
.ct-hero .ct-new { right: 32px; top: 32px; }
.ct-cap { position: absolute; left: 36px; right: 36px; bottom: 36px; background: var(--cf-scrim); border-radius: var(--cf-r-md); padding: 28px 34px; display: flex; flex-direction: column; gap: 10px; }
.ct-name-hero { font-size: var(--ct-fs-heros-nom); line-height: 0.96; }
.ct-hero .ct-desc { -webkit-line-clamp: 3; }
.ct-hero .ct-oos-tag { font-size: var(--ct-fs-heros-nom); }

/* héros + liste latérale */
.ct-feat { display: grid; grid-template-columns: 1.45fr 1fr; gap: 32px; height: 100%; min-height: 0; }
.ct[data-o="portrait"] .ct-feat { grid-template-columns: 1fr; grid-template-rows: 760px 1fr; gap: 24px; }
.ct-side { display: grid; grid-template-rows: repeat(var(--ct-m), 1fr); gap: 12px; min-height: 0; }
.ct-srow { position: relative; display: flex; align-items: center; gap: 20px; border-bottom: 2px solid var(--cf-line); padding: 0 6px; min-height: 0; }
.ct-thumb { position: relative; width: var(--ct-sthumb); height: var(--ct-sthumb); flex: none; border-radius: var(--cf-r-sm); overflow: hidden; background: var(--cf-surface-2); }
.ct-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ct-thumb .ct-ghost { font-size: calc(var(--ct-sthumb) * 1.1); right: -0.04em; bottom: -0.2em; }
.ct-srow .ct-tx { flex: 1; min-width: 0; padding: 0; gap: 4px 12px; flex-direction: row; align-items: center; flex-wrap: wrap; }
.ct-srow .ct-name { -webkit-line-clamp: 1; }
.ct[data-o="landscape"] .ct-srow .ct-name { -webkit-line-clamp: 2; line-height: 0.95; }
.ct-srow .ct-new { position: static; font-size: calc(var(--ct-fs-libelle) * 0.85); }
.ct-price { font-family: var(--ct-price-font); font-size: var(--ct-fs-prix); color: var(--cf-accent-ink); line-height: 1; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ct-srow[data-oos="1"] .ct-price, .ct-srow[data-oos="1"] .ct-name { color: var(--cf-mut); }
.ct-srow .ct-oos-tag { position: static; transform: rotate(-3deg); opacity: 0; font-size: calc(var(--ct-fs-libelle) * 0.9); border-width: 2px; }
.ct-srow[data-oos="1"] .ct-oos-tag { opacity: 1; }

/* offres */
.ct-promos { display: grid; gap: 24px; align-content: center; height: 100%; min-height: 0; }
.ct-promos[data-count="1"] { grid-template-rows: 1fr; }
.ct[data-o="landscape"] .ct-promos[data-count="3"] { grid-template-columns: repeat(3, 1fr); align-content: stretch; }
.ct[data-o="landscape"] .ct-promos[data-count="2"] { grid-template-columns: repeat(2, 1fr); align-content: stretch; }
.ct-promo { display: flex; flex-direction: column; justify-content: space-between; gap: 26px; background: var(--cf-surface); border-radius: var(--cf-r-md); padding: 36px 40px; box-shadow: var(--cf-shadow-soft); min-height: 0; }
.ct-promos[data-count="1"] .ct-promo { flex-direction: row; align-items: center; }
.ct-ptx { flex: 1; min-width: 0; }
.ct-ptitle { margin: 0; font-family: var(--cf-font-display); font-size: var(--ct-fs-heros-nom); text-transform: uppercase; line-height: 1; letter-spacing: -0.005em; }
.ct-pdesc { margin: 12px 0 0; font-size: var(--ct-fs-desc); color: var(--cf-mut); line-height: 1.25; }
.ct-plab { align-self: flex-start; background: var(--cf-green); color: var(--cf-on-green); font-family: var(--ct-price-font); font-size: var(--ct-fs-heros-prix); line-height: 1; padding: 0.24em 0.4em 0.2em; border-radius: var(--cf-r-sm); transform: rotate(-3deg); box-shadow: var(--cf-shadow-2); white-space: nowrap; }

/* fermé et plaque de marque */
.ct-closed { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
.ct-ring { position: absolute; left: 50%; top: 50%; width: 1500px; height: 1500px; margin: -750px 0 0 -750px; border: 3px dashed var(--cf-line); border-radius: 50%; animation: ct-spin linear infinite; }
.ct-cbox { position: relative; display: flex; flex-direction: column; align-items: center; gap: 28px; max-width: 1400px; }
.ct-logo-big { max-height: 220px; max-width: 640px; }
.ct-bname-big { font-size: 120px; }
.ct-reopen { font-family: var(--cf-font-display); font-size: var(--ct-fs-nom); text-transform: uppercase; color: var(--cf-accent-ink); line-height: 1; }
.ct-wins { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.ct-win { font-family: var(--ct-price-font); font-size: var(--ct-fs-prix); background: var(--cf-surface-2); border: 2px solid var(--cf-line-2); color: var(--cf-text); padding: 0.3em 0.7em; border-radius: var(--cf-r-pill); line-height: 1; white-space: nowrap; }
.ct-subtxt-big { margin: 0; font-size: var(--ct-fs-desc); color: var(--cf-mut); max-width: 26ch; line-height: 1.3; }
.ct-svc-line { font-weight: 700; font-size: var(--ct-fs-libelle); letter-spacing: 0.12em; text-transform: uppercase; color: var(--cf-mut); }

/* mouvement : transform et opacity, rien d'autre */
@keyframes ct-rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ct-drift { from { transform: scale(1) translate(0, 0); } to { transform: scale(1.08) translate(-1.6%, -1.2%); } }
@keyframes ct-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes ct-fade { from { opacity: 0; } to { opacity: 1; } }
.ct-it { animation: ct-rise var(--sm-t-med) var(--sm-ease) both; animation-delay: calc(var(--sm-t-snap) * var(--i, 0)); }
.ct-drift { animation-name: ct-drift; animation-timing-function: var(--sm-ease); animation-fill-mode: both; }
[data-fade="1"] { opacity: 0; }
.ct-name, .ct-desc, .ct-title, .ct-eyebrow, .ct-subtxt, .ct-ptitle, .ct-pdesc, .ct-plab { transition: opacity var(--sm-t-fast) var(--sm-ease); }

/* L'hôte glisse ses couches ; Comptoir a sa propre cascade : la couche entrante ne fait qu'un fondu. */
.bd-root[data-scenography="comptoir"] .bd-layer[data-phase="in"] { animation: ct-fade var(--sm-t-fast) var(--sm-ease) both; }

@media (prefers-reduced-motion: reduce) {
  .ct *, .ct *::before, .ct *::after { animation: none !important; transition: none !important; }
}
```

Dans `app/board/layout.tsx` : `import "@/components/board/scenographies/comptoir/comptoir.css";` sous l'import de `board.css`.

Dans `board-css.test.ts` : lire aussi `comptoir.css` et faire tourner les deux assertions sur chaque feuille (boucle sur `[["board.css", …], ["comptoir.css", …]]`).

- [ ] **Step 4 : Typage, lint, tests, et le rendu de contrôle**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web exec vitest run src/components/board`
Expected: PASS.

Rendu de contrôle (hors dépôt, dans le scratchpad) : un script qui monte `BoardStage` avec un `ScreenContent` de fixture (deux catégories de 3 et 8 produits avec et sans photo, une sélection de 5, une scène d'offres à 2, une scène fermée, en paysage puis portrait, sur les trois fonds), le rend en HTML statique avec `react-dom/server`, y inline `board.css` + `comptoir.css` + les variables `--police-*` sur des polices système, et l'ouvre avec Chromium (le Playwright du dossier `e2e`) en 1920 × 1080 pour une capture par scène. Regarder chaque capture : aucun texte sous son plancher, aucun débordement, les étiquettes de prix lisibles sur les trois fonds, la rupture atténuée. Corriger la feuille, pas le script.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/board/scenographies apps/web/src/app/board/layout.tsx apps/web/src/components/board/board-css.test.ts
git commit -m "comptoir : la scénographie du kit, reprise en module — boîtes photo, prix collé, cascade, dérive"
```

---

### Task 10 : Back-office — l'aperçu vivant (`useScreenPreview`, `LiveStage`, `StillStage`)

**Files:**
- Create: `apps/web/src/app/admin/screens/apparence/use-screen-preview.ts`
- Create: `apps/web/src/app/admin/screens/apparence/LiveStage.tsx`
- Create: `apps/web/src/app/admin/screens/apparence/StillStage.tsx`
- Modify: `apps/web/src/components/ui/icons.tsx` (icônes `play`, `pause`)
- Test: `apps/web/src/app/admin/screens/apparence/use-screen-preview.test.ts` (fonction pure `cleDuBrouillon`)

**Interfaces:**
- Consumes: `BoardStage`, `useEmbeddedStage`, `useSceneRotation(scenes, { paused })` (Task 6), `api.post`, `ScreenPreview`, `ScreenContent`.
- Produces:
  ```ts
  export interface Brouillon { screenId: string | null; orientation: ScreenOrientation; theme: ScreenTheme; scenography: Scenography }
  export function cleDuBrouillon(b: Brouillon): string
  export function useScreenPreview(brouillon: Brouillon): { content: ScreenContent | null; error: string | null; loading: boolean }
  export function LiveStage(props: { content: ScreenContent | null; current; leaving; index: number; paused: boolean; onTogglePause(): void; onGo(delta: number): void })
  export function StillStage(props: { content: ScreenContent; scene: ScreenScenePayload; scenography: Scenography })
  ```

- [ ] **Step 1 : Icônes** — dans `PATHS` de `icons.tsx`, ajouter (mêmes conventions de tracé que les voisines, viewBox 24, trait 2) :

```ts
  play: <path d="M8 5v14l11-7z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
```

(Vérifier la forme exacte des entrées existantes de `PATHS` — élément JSX ou chaîne `d` — et s'y conformer.)

- [ ] **Step 2 : Test de la clé du brouillon (échoue)**

```ts
import { describe, expect, it } from "vitest";
import { cleDuBrouillon } from "./use-screen-preview";
describe("cleDuBrouillon — ce qui déclenche un nouvel aperçu", () => {
  it("change avec chaque réglage, pas avec l'ordre des clés", () => {
    const a = cleDuBrouillon({ screenId: "s1", orientation: "landscape", theme: "brand", scenography: "comptoir" });
    const b = cleDuBrouillon({ scenography: "comptoir", theme: "brand", orientation: "landscape", screenId: "s1" });
    const c = cleDuBrouillon({ screenId: "s1", orientation: "portrait", theme: "brand", scenography: "comptoir" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
```

- [ ] **Step 3 : `use-screen-preview.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenography, ScreenContent, ScreenOrientation, ScreenTheme } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";

export interface Brouillon {
  screenId: string | null;
  orientation: ScreenOrientation;
  theme: ScreenTheme;
  scenography: Scenography;
}

/** Une clé stable : l'ordre des champs ne compte pas, chaque réglage compte. */
export const cleDuBrouillon = (b: Brouillon): string =>
  [b.screenId ?? "", b.orientation, b.theme, b.scenography].join("|");

/** Le gérant clique trois fois en une seconde : un seul aperçu part. */
const TEMPORISATION_MS = 250;
/** Même cadence que la liste des écrans : un prix changé apparaît sans clic. */
const RAFRAICHISSEMENT_MS = 30_000;

/**
 * L'APERÇU VIVANT — le même contrat de fraîcheur que le téléviseur.
 *
 * Le contenu n'est remplacé que si son empreinte a bougé, ou si le brouillon
 * a changé : un aperçu repeint toutes les trente secondes casserait la scène
 * en cours sous les yeux du gérant, exactement ce qu'on évite en salle.
 */
export function useScreenPreview(brouillon: Brouillon): {
  content: ScreenContent | null;
  error: string | null;
  loading: boolean;
} {
  const cle = cleDuBrouillon(brouillon);
  const [content, setContent] = useState<ScreenContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hashRef = useRef<string | null>(null);
  const cleRef = useRef<string>("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const corps = {
      screenId: brouillon.screenId,
      orientation: brouillon.orientation,
      theme: brouillon.theme,
      scenography: brouillon.scenography,
    };

    const charger = async () => {
      try {
        const next = await api.post<ScreenContent>("/screens/preview", corps);
        if (!alive) return;
        const nouveauBrouillon = cleRef.current !== cle;
        if (nouveauBrouillon || next.contentHash !== hashRef.current) {
          hashRef.current = next.contentHash;
          cleRef.current = cle;
          setContent(next);
        }
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Aperçu indisponible");
      } finally {
        if (alive) setLoading(false);
      }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- le chargement est asynchrone et suit le brouillon : c'est l'effet qui sait quand repartir.
    setLoading(true);
    const premier = setTimeout(() => void charger(), TEMPORISATION_MS);
    const boucle = () => {
      timer = setTimeout(() => {
        void charger().finally(boucle);
      }, RAFRAICHISSEMENT_MS);
    };
    boucle();
    const auRetour = () => void charger();
    window.addEventListener("focus", auRetour);

    return () => {
      alive = false;
      clearTimeout(premier);
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", auRetour);
    };
    // Le brouillon est lu à travers sa clé : un objet neuf à chaque rendu ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  return { content, error, loading };
}
```

- [ ] **Step 4 : `LiveStage.tsx` et `StillStage.tsx`**

```tsx
// LiveStage.tsx
"use client";

import { useRef } from "react";
import type { ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { BoardStage } from "@/components/board/board-stage";
import { useEmbeddedStage } from "@/components/board/use-stage";
import "@/components/board/board.css";
import "@/components/board/scenographies/comptoir/comptoir.css";

/**
 * LE TÉLÉVISEUR MINIATURE — le même hôte que la salle, dans un cadre au ratio
 * de l'orientation. Sous lui, la barre de transport : le gérant regarde une
 * scène précise, revient, met en pause. La boucle reste celle du contenu.
 */
export function LiveStage({
  content,
  current,
  leaving,
  index,
  paused,
  onTogglePause,
  onGo,
  loading,
  error,
}: {
  content: ScreenContent | null;
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  index: number;
  paused: boolean;
  onTogglePause: () => void;
  onGo: (delta: number) => void;
  loading: boolean;
  error: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const orientation = content?.orientation ?? "landscape";
  const stage = useEmbeddedStage(ref, orientation);
  const total = content?.scenes.length ?? 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={ref}
        className="relative mx-auto w-full overflow-hidden rounded-card border border-white/10 bg-black shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
        style={
          orientation === "landscape"
            ? { aspectRatio: "16 / 9" }
            : { aspectRatio: "9 / 16", width: "auto", height: 460 }
        }
        data-testid="apercu-ecran"
      >
        <BoardStage
          content={content}
          current={current}
          leaving={leaving}
          stage={stage}
          embed
          fallback={
            <div className="bd-layer" data-phase="in">
              <div className="bd-plate">
                <div className="bd-plate-kicker">Aperçu</div>
                <div className="bd-plate-title">{error ? "Aperçu indisponible" : "Chargement de la carte"}</div>
                <div className="bd-plate-line">{error ?? "La boucle de cet écran arrive."}</div>
              </div>
            </div>
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onGo(-1)} aria-label="Scène précédente" disabled={total < 2}
          className="cf-press grid size-8 place-items-center rounded-ctrl border border-line2 text-mut hover:text-ink disabled:opacity-30">
          <Icon name="back" size={14} />
        </button>
        <button type="button" onClick={onTogglePause} aria-label={paused ? "Reprendre la boucle" : "Mettre en pause"} disabled={total < 2}
          className="cf-press grid size-8 place-items-center rounded-ctrl border border-line2 text-mut hover:text-ink disabled:opacity-30">
          <Icon name={paused ? "play" : "pause"} size={14} />
        </button>
        <button type="button" onClick={() => onGo(1)} aria-label="Scène suivante" disabled={total < 2}
          className="cf-press grid size-8 place-items-center rounded-ctrl border border-line2 text-mut hover:text-ink disabled:opacity-30">
          <Icon name="arrow" size={14} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[13px] text-mut">
          {current ? (
            <>
              <span className="font-semibold text-ink">{current.title}</span>
              {current.subtitle ? ` · ${current.subtitle}` : ""}
              <span className="cf-fig"> · {index + 1} / {total}</span>
              {loading ? " · actualisation…" : ""}
            </>
          ) : loading ? "Chargement…" : "Aucune scène"}
        </div>
      </div>
    </div>
  );
}
```

```tsx
// StillStage.tsx
"use client";

import { useMemo, useRef } from "react";
import type { Scenography, ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { BoardStage } from "@/components/board/board-stage";
import { useEmbeddedStage } from "@/components/board/use-stage";

/**
 * LA TUILE VIVANTE — une scénographie candidate, rendue avec la scène du
 * moment, mouvement figé. Ce n'est pas une image : c'est le module lui-même,
 * si bien que la tuile et le téléviseur ne peuvent pas diverger.
 */
export function StillStage({ content, scene, scenography }: { content: ScreenContent; scene: ScreenScenePayload; scenography: Scenography }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useEmbeddedStage(ref, content.orientation);
  const variante = useMemo(() => ({ ...content, scenography }), [content, scenography]);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-ctrl bg-black"
      style={content.orientation === "landscape" ? { aspectRatio: "16 / 9" } : { aspectRatio: "9 / 16", height: 160, width: "auto" }}>
      <BoardStage content={variante} current={scene} leaving={null} stage={stage} embed still />
    </div>
  );
}
```

- [ ] **Step 5 : Typage, lint, test**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web exec vitest run src/app/admin/screens`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/app/admin/screens/apparence apps/web/src/components/ui/icons.tsx
git commit -m "écrans : un téléviseur miniature vivant dans le back-office, même hôte que la salle"
```

---

### Task 11 : Back-office — le tiroir « Apparence », la carte, la création

**Files:**
- Create: `apps/web/src/app/admin/screens/apparence/ApparenceDrawer.tsx`
- Modify: `apps/web/src/app/admin/screens/screen-card.tsx` (pastille + bouton « Apparence »)
- Modify: `apps/web/src/app/admin/screens/page.tsx` (état `apparenceId`, sélecteur de scénographie à la création)

**Interfaces:**
- Consumes: `useScreenPreview`, `LiveStage`, `StillStage` (Task 10), `useSceneRotation` (Task 6), `masquePourFond`, `SCENOGRAPHIES`, `SCENOGRAPHY_LABELS/DESCRIPTIONS`, `SCREEN_THEME_LABELS/HINTS`, `TenantMe` (`api.get('/tenants/me')`), `Drawer`, `Modal`, `Btn`, `useToast`.
- Produces: `ApparenceDrawer({ screen, onClose, onSaved })` ; `ScreenCard` reçoit `onApparence: () => void`.

- [ ] **Step 1 : `ApparenceDrawer.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCENOGRAPHIES, SCENOGRAPHY_DESCRIPTIONS, SCENOGRAPHY_LABELS,
  SCREEN_ORIENTATIONS, SCREEN_ORIENTATION_LABELS, SCREEN_THEMES, SCREEN_THEME_HINTS, SCREEN_THEME_LABELS,
  masquePourFond, type Brand, type Scenography, type ScreenOrientation, type ScreenScenePayload, type ScreenTheme, type ScreenView,
} from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Drawer, Modal, useToast } from "@/components/ui";
import { useSceneRotation } from "@/components/board/use-scene-rotation";
import { LiveStage } from "./LiveStage";
import { StillStage } from "./StillStage";
import { useScreenPreview } from "./use-screen-preview";

const VIDE: ScreenScenePayload[] = [];

/** Les trois pastilles d'un fond : fond, surface, accent — calculées par la même règle que l'écran. */
function Echantillon({ brand, theme }: { brand: Brand | null; theme: ScreenTheme }) {
  if (!brand) return null;
  const p = masquePourFond(brand, theme).palette;
  return (
    <span className="flex shrink-0 items-center -space-x-1" aria-hidden>
      {[p.ground, p.surface, p.accent].map((c, i) => (
        <span key={i} className="size-3.5 rounded-full border border-black/30" style={{ background: c }} />
      ))}
    </span>
  );
}

/**
 * LE TIROIR « APPARENCE » — choisir en regardant.
 *
 * Le brouillon est local ; l'aperçu le suit avant tout enregistrement, et il
 * est VIVANT : la vraie boucle, la vraie carte, redemandées comme sur le
 * téléviseur. Rien n'est écrit tant que le gérant n'a pas enregistré.
 */
export function ApparenceDrawer({ screen, onClose, onSaved }: { screen: ScreenView; onClose: () => void; onSaved: (updated: ScreenView) => void }) {
  const toast = useToast();
  const base = useMemo(
    () => ({ orientation: screen.orientation, theme: screen.theme, scenography: screen.scenography }),
    [screen.orientation, screen.theme, screen.scenography],
  );
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [paused, setPaused] = useState(false);
  const [brand, setBrand] = useState<Brand | null>(null);

  const dirty = draft.orientation !== base.orientation || draft.theme !== base.theme || draft.scenography !== base.scenography;

  const { content, error, loading } = useScreenPreview({ screenId: screen.id, ...draft });
  const scenes = content?.scenes ?? VIDE;
  const { current, leaving, index, go } = useSceneRotation(scenes, { paused });

  // Le masque de BASE, pour les échantillons de fond : le contenu d'aperçu
  // porte déjà la variante, la base ne s'en déduit pas.
  useEffect(() => {
    let alive = true;
    api.get<TenantMe>("/tenants/me").then((me) => { if (alive) setBrand(me.brand); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const updated = await api.patch<ScreenView>(`/screens/${screen.id}`, draft);
      onSaved(updated);
      toast("Apparence enregistrée — l'écran suit dans la minute", { icon: "check" });
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Enregistrement impossible — réessayez");
    } finally {
      setSaving(false);
    }
  }

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  return (
    <Drawer open onClose={requestClose} title={`Apparence — ${screen.name}`} width={640}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-mut">{dirty ? "Modifications non enregistrées" : "Apparence à jour"}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={requestClose}>Fermer</Btn>
            <Btn variant="primary" size="sm" icon="check" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Enregistrement…" : "Enregistrer l'apparence"}
            </Btn>
          </div>
        </div>
      }>
      <div className="flex flex-col gap-5 p-[18px]">
        <LiveStage content={content} current={current} leaving={leaving} index={index} paused={paused}
          onTogglePause={() => setPaused((p) => !p)} onGo={go} loading={loading} error={error} />

        {/* ── Scénographie : des tuiles vivantes ── */}
        <section>
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">Scénographie</div>
          <div className={cx("grid gap-3", draft.orientation === "landscape" ? "grid-cols-2" : "grid-cols-2")}>
            {SCENOGRAPHIES.map((s) => (
              <button key={s} type="button" aria-pressed={draft.scenography === s}
                onClick={() => setDraft((d) => ({ ...d, scenography: s }))}
                className={cx("cf-press flex flex-col gap-2 rounded-card border p-2 text-left",
                  draft.scenography === s ? "border-accent bg-accentwash" : "border-line2 hover:border-white/25")}>
                {content && current ? <StillStage content={content} scene={current} scenography={s} />
                  : <div className="aspect-video w-full rounded-ctrl bg-black/40" />}
                <div className="px-1 pb-1">
                  <div className="text-sm font-bold text-ink">{SCENOGRAPHY_LABELS[s]}</div>
                  <div className="text-xs leading-snug text-mut">{SCENOGRAPHY_DESCRIPTIONS[s]}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Fond ── */}
        <section>
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">Fond</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCREEN_THEMES.map((t) => (
              <button key={t} type="button" aria-pressed={draft.theme === t}
                onClick={() => setDraft((d) => ({ ...d, theme: t }))}
                className={cx("cf-press flex items-start gap-2.5 rounded-card border px-3 py-2.5 text-left",
                  draft.theme === t ? "border-accent bg-accentwash" : "border-line2 hover:border-white/25")}>
                <Echantillon brand={brand} theme={t} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{SCREEN_THEME_LABELS[t]}</span>
                  <span className="block text-xs leading-snug text-mut">{SCREEN_THEME_HINTS[t]}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Orientation ── */}
        <section>
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">Orientation</div>
          <div className="grid grid-cols-2 gap-2">
            {SCREEN_ORIENTATIONS.map((o) => (
              <button key={o} type="button" aria-pressed={draft.orientation === o}
                onClick={() => setDraft((d) => ({ ...d, orientation: o }))}
                className={cx("cf-press rounded-card border px-3 py-2.5 text-sm font-bold",
                  draft.orientation === o ? "border-accent bg-accentwash text-ink" : "border-line2 text-mut hover:border-white/25")}>
                {SCREEN_ORIENTATION_LABELS[o]}
              </button>
            ))}
          </div>
        </section>
      </div>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title="Abandonner les modifications ?" destructive width={420}
        footer={<>
          <Btn variant="ghost" onClick={() => setConfirmClose(false)}>Reprendre</Btn>
          <Btn variant="ink" style={{ background: "var(--cf-red)" }} onClick={() => { setConfirmClose(false); onClose(); }}>Abandonner</Btn>
        </>}>
        <p className="leading-relaxed">L&apos;apparence n&apos;a pas été enregistrée : «&nbsp;{screen.name}&nbsp;» garde la sienne.</p>
      </Modal>
    </Drawer>
  );
}
```

Les types `ScreenOrientation` / `Scenography` importés servent au `useState` s'ils sont nécessaires au typage de `draft` ; sinon retirer les imports inutilisés (le lint les refuse).

- [ ] **Step 2 : `screen-card.tsx`**

Propriété `onApparence: () => void`. Dans le bloc « Configuration », ajouter `<Pill variant="out">{screen.scenographyLabel}</Pill>` après la pastille du thème. Dans les actions, pour un écran appairé comme non appairé, ajouter avant « Composer la boucle » :

```tsx
              <Btn variant="ink" size="sm" icon="tv" onClick={onApparence}>
                Apparence
              </Btn>
```

et passer « Composer la boucle » en `variant="ghost"` sur l'écran appairé (une seule action principale par carte).

- [ ] **Step 3 : `page.tsx`**

- Imports : `SCENOGRAPHIES, SCENOGRAPHY_DESCRIPTIONS, SCENOGRAPHY_LABELS, SCENOGRAPHY_DEFAULT, type Scenography` depuis `@sm/contracts` ; `ApparenceDrawer` depuis `./apparence/ApparenceDrawer`.
- `draft` de création : ajouter `scenography: Scenography` (défaut `SCENOGRAPHY_DEFAULT`) ; `openCreate` le remet ; `submitCreate` l'envoie.
- État `const [apparenceId, setApparenceId] = useState<string | null>(null);` et `const apparenceScreen = byId(apparenceId);` ; `confirmDelete` le remet à `null` si c'est l'écran supprimé.
- `ScreenCard` : `onApparence={() => setApparenceId(screen.id)}`.
- Modale de création, sous la grille orientation/thème :

```tsx
          <Field label="Scénographie" htmlFor="screen-scenography" hint={SCENOGRAPHY_DESCRIPTIONS[draft.scenography]}>
            <Select id="screen-scenography" value={draft.scenography}
              onChange={(e) => setDraft((d) => ({ ...d, scenography: e.target.value as Scenography }))}>
              {SCENOGRAPHIES.map((s) => <option key={s} value={s}>{SCENOGRAPHY_LABELS[s]}</option>)}
            </Select>
          </Field>
```

- Avant `{composeScreen && (…)}` :

```tsx
      {apparenceScreen && (
        <ApparenceDrawer key={apparenceScreen.id} screen={apparenceScreen} onClose={() => setApparenceId(null)} onSaved={replace} />
      )}
```

- [ ] **Step 4 : Typage, lint, build web**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/app/admin/screens
git commit -m "écrans : le tiroir « Apparence » — scénographie, fond et orientation, choisis en regardant"
```

---

### Task 12 : Gardes et parcours de bout en bout

**Files:**
- Modify: `apps/web/src/components/ui/verrou.test.ts` (`PIECES_DE_LOGO`)
- Modify: `e2e/socle/api.mjs` (`del`)
- Create: `e2e/reel/ecran-apparence.test.mjs`
- Modify: `e2e/README.md` (la table des parcours)

- [ ] **Step 1 : Garde du logo** — ajouter à `PIECES_DE_LOGO` : `"components/board/board-header.tsx"` et `"components/board/scenographies/comptoir/Comptoir.tsx"`. Run: `pnpm --filter web exec vitest run src/components/ui/verrou.test.ts` → PASS.

- [ ] **Step 2 : `socle/api.mjs`** — dans l'objet rendu par `client`, après `patch:` : `del: (chemin) => exiger('DELETE', chemin),`.

- [ ] **Step 3 : Le parcours réel**

```js
/**
 * SCÉNARIO 5 — L'APPARENCE D'UN ÉCRAN SE CHOISIT EN REGARDANT.
 *
 * Le gérant crée un écran, ouvre son tiroir « Apparence », voit un téléviseur
 * miniature qui joue sa vraie boucle, change de scénographie et enregistre.
 * Trois systèmes : le back-office, la route d'aperçu de l'API, et l'hôte de
 * l'écran de salle — le même code que la clé HDMI. C'est la première
 * couverture de bout en bout de l'écran de salle.
 *
 * ─── CE SCÉNARIO ÉCRIT DANS UNE VRAIE BASE ───
 * Il crée un écran et le supprime ; la suppression est notée AVANT la création
 * de quoi que ce soit dans l'interface, et rejouée par le socle si le
 * processus meurt en route.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { client } from '../socle/api.mjs';
import { identifiants, raisonDeSauter } from '../socle/env.mjs';
import { classerJournal, noterARemettre, reparerParcSiNecessaire } from '../socle/parc.mjs';

const parc = cibles();
const sauter = raisonDeSauter(parc);
const NOM = 'E2E · apparence';

scenario(
  'Back-office réel — l’apparence d’un écran se choisit sur un téléviseur miniature vivant',
  { format: FORMATS.comptoir, sauter, delai: 180_000 },
  async (page) => {
    const { gerant } = identifiants();
    const api = client(parc.api);
    await reparerParcSiNecessaire();
    await api.connexion(gerant);

    // Un écran d'une exécution précédente morte en route ? Il porte ce nom.
    for (const ancien of await api.get('/screens')) {
      if (ancien.name === NOM) await api.del(`/screens/${ancien.id}`);
    }

    const cree = await api.post('/screens', { name: NOM, orientation: 'landscape', theme: 'brand', scenography: 'comptoir' });
    await noterARemettre([
      { acteur: 'gerant', methode: 'DELETE', chemin: `/screens/${cree.id}`, corps: undefined, decrit: `écran « ${NOM} » supprimé` },
    ]);

    try {
      // ── 1 · Connexion par le vrai formulaire ──
      await page.goto(`${parc.web}/admin`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'E-mail' }).fill(gerant.email);
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(gerant.motDePasse);
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await page.waitForURL(/\/admin\/(dashboard|menu)/);

      // ── 2 · Le tiroir de l'écran créé ──
      await page.goto(`${parc.web}/admin/screens`, { waitUntil: 'domcontentloaded' });
      const carte = page.locator('article, div').filter({ has: page.getByRole('heading', { name: NOM }) }).last();
      await carte.getByRole('button', { name: 'Apparence' }).click();

      // ── 3 · Le téléviseur joue une scène — le même hôte que la salle ──
      const apercu = page.getByTestId('apercu-ecran');
      await apercu.locator('.bd-stage[data-ready="1"] .bd-layer').first().waitFor({ state: 'visible' });
      assert.equal(await apercu.locator('.bd-root').getAttribute('data-scenography'), 'comptoir');

      // ── 4 · Changer de scénographie se voit avant d'enregistrer ──
      await page.getByRole('button', { name: /^Ardoise/ }).click();
      await apercu.locator('.bd-root[data-scenography="ardoise"]').waitFor({ state: 'attached' });

      // ── 5 · Enregistrer, et relire par l'API ──
      await page.getByRole('button', { name: "Enregistrer l'apparence" }).click();
      await attendreTexte(page, 'Apparence enregistrée');
      const relu = await api.get(`/screens/${cree.id}`);
      assert.equal(relu.scenography, 'ardoise', 'la scénographie enregistrée doit être relue par l’API');
    } finally {
      await api.del(`/screens/${cree.id}`);
      await classerJournal();
    }
  },
);
```

Vérifier avec `sed -n 120,200p e2e/socle/navigateur.mjs` la signature exacte de `scenario` (nom, options, corps) et l'usage de `page.getByTestId` (Playwright standard). Ajouter le fichier à la table du `README.md` : `reel/ecran-apparence.test.mjs` — « un écran créé, son tiroir d'apparence, un téléviseur miniature qui joue sa boucle, une scénographie changée et relue ».

- [ ] **Step 4 : Commit**

```bash
git add apps/web/src/components/ui/verrou.test.ts e2e/socle/api.mjs e2e/reel/ecran-apparence.test.mjs e2e/README.md
git commit -m "écrans : la garde du logo suit l'écran de salle, et un parcours réel couvre le tiroir d'apparence"
```

---

### Task 13 : Portail, relecture, PR, staging, sonde, parcours réel

- [ ] **Step 1 : Portail complet** — `cd scratchpad/wt && pnpm turbo lint test build`. Tout vert. Corriger ce qui tombe, dans le bon fichier, avec un commit nommé.

- [ ] **Step 2 : Relecture adverse** — un workflow de critique (deux agents séquentiels : contrat de scénographie et accessibilité des tokens ; API et empreinte) sur le diff `origin/develop...HEAD`. Intégrer les constats réels.

- [ ] **Step 3 : Pousser, PR** — `git push -u origin feat/scenographies-tv` ; vérifier `git log origin/feat/scenographies-tv -1` ; `gh pr create --base develop --title "feat : plusieurs scénographies pour l'écran de salle, et un téléviseur miniature vivant dans le back-office" --body-file <corps>` avec le corps : ce qui change pour le gérant, ce qui change pour l'écran, la compatibilité (Ardoise pour l'existant), les tests, le pied `🤖 Generated with [Claude Code](https://claude.com/claude-code)` et le lien de session.

- [ ] **Step 4 : Fusion et sonde** — vérifier l'intersection de fichiers avec les branches de GPT poussées depuis (`git diff --name-only origin/develop...HEAD` contre leurs diffs) ; `gh pr merge --squash` ; noter le sha de `origin/develop` ; attendre le déploiement Railway ; `SM_REVISION_ATTENDUE=<sha> node scripts/smoke.mjs staging` → 8 contrôles verts.

- [ ] **Step 5 : Le parcours réel contre staging** — `pnpm e2e:reel` (ou `node e2e/lancer.mjs reel/ecran-apparence`) avec les identifiants du `.env` racine. Vert, écran supprimé, journal classé.

- [ ] **Step 6 : Capture** — avec Chromium, se connecter sur staging, ouvrir le tiroir d'un écran du pilote, capturer le tiroir et le téléviseur miniature en Comptoir et en Ardoise, sur « Vos couleurs » et « Fond clair » ; les mettre dans le scratchpad et les envoyer à l'utilisateur.

- [ ] **Step 7 : Compte rendu** — ce qui est en staging, ce qui reste (troisième scénographie, hôte HTML externe), aucune promotion en production sans accord.
