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

/**
 * Le motif d'une URL d'image de masque — la forme SYNTAXIQUE, à part du schéma.
 *
 * `ImageUrl` (plus bas) est la garde des routes : zod, complète, avec la borne
 * de longueur. Mais la base est écrite aussi par l'admin-cli, par un shell et
 * par les scripts de reprise, qui ne passent PAS par zod : Mongoose a besoin du
 * même refus sous la forme qu'il sait appliquer, un `match`. D'où ce motif,
 * exporté à côté de `HEX` pour la même raison — la défense en profondeur du
 * dépôt, pas un doublon de la validation d'entrée.
 *
 * Les deux doivent dire la MÊME chose sur le protocole ; `marque.test.ts` les
 * confronte sur les mêmes URL pour qu'ils ne divergent pas.
 */
export const IMAGE_URL = /^https?:\/\//i;

/**
 * LE LAITON — l'accent de la marque Snack Manager, et le repli de tout tenant
 * qui n'a pas encore posé le sien.
 *
 * Il vivait recopié à quatre endroits : une constante PRIVÉE au bas de ce
 * fichier, l'accent de la direction Nuit trois cents lignes plus haut, le
 * `default` de `brandColor` dans les schémas Mongoose, et le test de reprise
 * qui épinglait le littéral. Une couleur de marque qui change doit changer une
 * fois. Que ce soit AUSSI l'accent de Nuit n'est pas un hasard : Nuit est la
 * direction la plus proche de notre propre identité, celle que porte un tenant
 * non repris.
 *
 * Ce que la constante ne couvre PAS : les fixtures de test qui donnent cette
 * teinte à un restaurant imaginaire (`loyalty-public.service.test.ts`,
 * `screens.fakes.ts`…). Là, le laiton est une couleur de tenant parmi d'autres
 * — n'importe quel hex ferait l'affaire — et l'y remplacer laisserait croire
 * que le test dépend de notre marque.
 */
export const LAITON = '#c9a15a';

/**
 * La casse d'un hex est normalisée ICI, à la frontière, et nulle part ailleurs.
 *
 * `#E07A1F` posé par le sélecteur de l'admin et `#e07a1f` rendu par le
 * résolveur doivent être LA MÊME valeur : sans cette normalisation au contrat,
 * `GET /tenants/me` rendait l'une ou l'autre forme selon le chemin d'écriture
 * (PATCH du masque, PATCH de l'identité, reprise), et les tests épinglaient les
 * deux. Une seule normalisation, donc — et plus aucun `.toLowerCase()` en aval.
 */
export const HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX, 'Couleur attendue au format #rrggbb');

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

/**
 * URL d'image d'un masque — le logo et la photo d'en-tête.
 *
 * `z.url()` NU accepte tout protocole : un `javascript:…` posé dans
 * `logo.mark.dark` finissait en `src` d'un `<img>` et en `src` d'icône de
 * manifeste. `protocol: /^https?$/` est la garde native de zod 4 — elle exige
 * aussi le `://`, donc `https:/r2/x.png` est refusé, et elle rend la valeur
 * déjà trimée (pas de `.trim()` en plus). On ne passe pas par `z.httpUrl()` :
 * il interdirait `http://localhost:9000` que servent les environnements de
 * développement.
 *
 * CE QUE CE SCHÉMA NE FAIT PAS : il ne restreint pas l'ORIGINE, et ne le peut
 * pas — le contrat ne connaît ni le domaine public du déploiement ni l'hôte du
 * magasin d'images. La liste blanche d'origines vit donc là où la
 * configuration existe, sur le chemin d'ÉCRITURE de l'API
 * (`modules/tenants/origines-images.ts`, exigée par `masqueAEnregistrer` pour
 * les DEUX routes `PATCH …/marque`). Elle n'y est plus une dette : ici, la
 * garde est syntaxique ; là-bas, elle est territoriale.
 *
 * La LECTURE, elle, reste volontairement tolérante à l'origine : un masque
 * déjà stocké ne doit pas devenir invalide au gré d'un changement de
 * configuration — il basculerait tout un restaurant sur le repli Nuit, sur un
 * 200. C'est l'écriture suivante qui refuse.
 *
 * `.default(null)` : une clé purement ABSENTE vaut `null` à la lecture, parce
 * que `.lean()` ne pose pas les défauts Mongoose (cf. `lireMarque`).
 */
const ImageUrl = z.url({ protocol: /^https?$/ }).max(500).nullable().default(null);

export const BrandPaletteSchema = z.object({
  ground: HexSchema,
  surface: HexSchema,
  ink: HexSchema,
  accent: HexSchema,
  onAccent: HexSchema,
});
export type BrandPalette = z.infer<typeof BrandPaletteSchema>;

const LogoPairSchema = z.object({ light: ImageUrl, dark: ImageUrl });
const LogoSchema = z.object({ mark: LogoPairSchema, lockup: LogoPairSchema });
const BrandTypeSchema = z.object({ pair: TypePairKeySchema });

/**
 * LE SCHÉMA DE LECTURE — objet nu, donc les clés inconnues sont IGNORÉES.
 *
 * C'est ce schéma que `lireMarque` applique au document de la base. Il était
 * `.strict()` : le jour où une clé additive apparaissait en base (champ d'une
 * version suivante, script d'exploitation, shell), `safeParse` échouait et le
 * restaurant basculait en silence sur Nuit — sur un 200, sur TOUTES ses
 * surfaces. Zod 4, la règle : strict à l'ENTRÉE (contre le mass assignment),
 * strip à la LECTURE d'une persistance qu'on ne contrôle pas au bit près.
 */
export const BrandSchema = z.object({
  mode: BrandModeSchema,
  palette: BrandPaletteSchema,
  type: BrandTypeSchema,
  shape: BrandShapeSchema,
  motion: BrandMotionSchema,
  logo: LogoSchema,
  hero: ImageUrl,
  preset: PresetKeySchema.nullable().default(null),
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * LE SCHÉMA D'ÉCRITURE — strict à tous les niveaux.
 *
 * Le pendant du précédent, et le SEUL à poser dans un `@Body(zod(…))` : une
 * clé qu'on n'attend pas dans un corps de requête est une tentative, pas une
 * tolérance (ASVS V5.1.3, mass assignment).
 */
export const BrandStrictSchema = BrandSchema.extend({
  palette: BrandPaletteSchema.strict(),
  type: BrandTypeSchema.strict(),
  logo: LogoSchema.extend({
    mark: LogoPairSchema.strict(),
    lockup: LogoPairSchema.strict(),
  }).strict(),
}).strict();

// ─────────────────────────────────────────────────────────────
// Les paires typographiques curatées — jamais une police libre
// ─────────────────────────────────────────────────────────────

/**
 * Les familles que le web déclare via next/font. Énumérées et non `string` :
 * une faute dans un slug n'était vue par TypeScript nulle part — seulement, et
 * plus tard, par le test texte du web qui compare les déclarations à cette
 * liste. Le test `marque.test.ts` épingle en retour que chaque slug déclaré
 * ici sert vraiment dans `TYPE_PAIRS` : pas de famille chargée pour rien.
 */
export const FONT_SLUGS = [
  'alegreya-sans',
  'archivo',
  'archivo-black',
  'bricolage-grotesque',
  'cormorant-garamond',
  'familjen-grotesk',
  'figtree',
  'fraunces',
  'instrument-sans',
  'jetbrains-mono',
  'lato',
  'libre-baskerville',
  'manrope',
  'nunito',
  'nunito-sans',
  'outfit',
  'playfair-display',
  'source-sans-3',
] as const;
export type FontSlug = (typeof FONT_SLUGS)[number];

/** La mono servie aux paires qui n'en déclarent pas — les prix restent alignés. */
export const MONO_PAR_DEFAUT: FontSlug = 'jetbrains-mono';

/**
 * `display`/`body`/`mono` sont des SLUGS de famille : le web déclare chaque
 * famille via next/font avec la variable `--police-<slug>`, et le résolveur
 * émet `var(--police-<slug>), <repli>`.
 */
export type TypePair = {
  display: FontSlug;
  body: FontSlug;
  mono: FontSlug | null;
  /** Certaines paires posent les prix en mono — l'artisan, le brut. */
  prixMono: boolean;
};

export const TYPE_PAIRS: Record<TypePairKey, TypePair> = {
  brasserie: { display: 'fraunces', body: 'source-sans-3', mono: null, prixMono: false },
  neon: { display: 'bricolage-grotesque', body: 'archivo', mono: null, prixMono: false },
  atelier: { display: 'alegreya-sans', body: 'alegreya-sans', mono: 'jetbrains-mono', prixMono: true },
  marche: { display: 'outfit', body: 'manrope', mono: null, prixMono: false },
  nuit: { display: 'cormorant-garamond', body: 'figtree', mono: null, prixMono: false },
  soleil: { display: 'nunito', body: 'nunito-sans', mono: null, prixMono: false },
  editorial: { display: 'playfair-display', body: 'source-sans-3', mono: null, prixMono: false },
  moderne: { display: 'familjen-grotesk', body: 'instrument-sans', mono: null, prixMono: false },
  classique: { display: 'libre-baskerville', body: 'lato', mono: null, prixMono: false },
  brut: { display: 'archivo-black', body: 'archivo', mono: 'jetbrains-mono', prixMono: true },
};

/** Toutes les familles à déclarer côté web — dérivé, jamais tenu à la main. */
export const FONT_FAMILIES: readonly FontSlug[] = Array.from(
  new Set(
    Object.values(TYPE_PAIRS).flatMap((p) => [p.display, p.body, ...(p.mono ? [p.mono] : [])]),
  ),
).sort();

/** Pile de repli par genre — ce que voit le client avant que la police arrive. */
export const FONT_FALLBACKS: Partial<Record<FontSlug, string>> = {
  fraunces: 'Georgia, "Times New Roman", serif',
  'cormorant-garamond': 'Georgia, "Times New Roman", serif',
  'playfair-display': 'Georgia, "Times New Roman", serif',
  'libre-baskerville': 'Georgia, "Times New Roman", serif',
  'jetbrains-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const fallbackDe = (slug: FontSlug): string => FONT_FALLBACKS[slug] ?? SANS_FALLBACK;

// ─────────────────────────────────────────────────────────────
// Six directions artistiques — des objets brand COMPLETS
// ─────────────────────────────────────────────────────────────

const sansLogos = { mark: { light: null, dark: null }, lockup: { light: null, dark: null } };

export const DIRECTIONS: Record<PresetKey, Brand> = {
  brasserie: {
    mode: 'light',
    palette: { ground: '#f5efe3', surface: '#fffdf8', ink: '#1f1a17', accent: '#7a2e2a', onAccent: '#fff8f0' },
    type: { pair: 'brasserie' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'brasserie',
  },
  neon: {
    mode: 'dark',
    palette: { ground: '#0e1016', surface: '#171a23', ink: '#f3f1ec', accent: '#d8f04a', onAccent: '#0e1016' },
    type: { pair: 'neon' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'neon',
  },
  atelier: {
    mode: 'light',
    palette: { ground: '#f7f3ec', surface: '#ffffff', ink: '#2b2b2b', accent: '#a8482a', onAccent: '#fff4ec' },
    type: { pair: 'atelier' }, shape: 'doux', motion: 'pose', logo: sansLogos, hero: null, preset: 'atelier',
  },
  marche: {
    mode: 'light',
    palette: { ground: '#ffffff', surface: '#f4f8f4', ink: '#1e4d2b', accent: '#23843f', onAccent: '#ffffff' },
    type: { pair: 'marche' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'marche',
  },
  nuit: {
    mode: 'dark',
    palette: { ground: '#14151a', surface: '#1d1f26', ink: '#f0ebe1', accent: LAITON, onAccent: '#1c1612' },
    type: { pair: 'nuit' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'nuit',
  },
  soleil: {
    mode: 'light',
    palette: { ground: '#f6ebd9', surface: '#fff9f0', ink: '#1b2a4a', accent: '#e07a1f', onAccent: '#1b1206' },
    type: { pair: 'soleil' }, shape: 'doux', motion: 'vif', logo: sansLogos, hero: null, preset: 'soleil',
  },
};

// ─────────────────────────────────────────────────────────────
// La couleur en pur — WCAG 2.x, sans dépendance
// ─────────────────────────────────────────────────────────────

/** Le plancher du TEXTE — WCAG 1.4.3. */
export const WCAG_AA = 4.5;
/** Le plancher des éléments NON textuels — anneau de focus, filet d'état (1.4.11, 2.4.13). */
export const WCAG_AA_NON_TEXTE = 3;

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

const canalLineaire = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/**
 * Luminance relative WCAG depuis des canaux 0-255 — sans détour par l'hex.
 * L'ajustement balaie jusqu'à 400 nuances : ré-encoder puis re-parser une
 * chaîne à chaque pas était l'essentiel du coût.
 */
export function luminanceRgb([r, g, b]: Rgb): number {
  return 0.2126 * canalLineaire(r) + 0.7152 * canalLineaire(g) + 0.0722 * canalLineaire(b);
}

/** Luminance relative WCAG — canal linéarisé, pondéré. */
export function luminance(hex: string): number {
  return luminanceRgb(hexVersRgb(hex));
}

const ratioLuminances = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function ratioContraste(a: string, b: string): number {
  return ratioLuminances(luminance(a), luminance(b));
}

const melangerRgb = ([ar, ag, ab]: Rgb, [br, bg, bb]: Rgb, t: number): Rgb => [
  Math.round(ar + (br - ar) * t),
  Math.round(ag + (bg - ag) * t),
  Math.round(ab + (bb - ab) * t),
];

/** Interpolation linéaire en sRGB — suffisante pour des teintes et des filets. */
export function melanger(a: string, b: string, t: number): string {
  return rgbVersHex(melangerRgb(hexVersRgb(a), hexVersRgb(b), t));
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexVersRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Le résultat d'un ajustement : la nuance retenue, et si elle tient la promesse. */
export type NuanceAjustee = {
  couleur: string;
  /** `false` : aucune nuance, jusqu'aux deux pôles, n'atteint le seuil sur TOUS les fonds. */
  ok: boolean;
};

const PAS_AJUSTEMENT = 200;
const NOIR = '#000000';
const BLANC = '#ffffff';
const NOIR_RGB: Rgb = [0, 0, 0];
const BLANC_RGB: Rgb = [255, 255, 255];

/**
 * Rapproche `couleur` du noir OU du blanc, par pas de 1/200, jusqu'à ce que le
 * seuil soit tenu sur TOUS les `fonds` À LA FOIS — et retient celle des deux
 * nuances qui y arrive en le moins de pas (« la nuance la plus proche qui
 * passe »). Une couleur déjà conforme revient telle quelle, en minuscules.
 *
 * POURQUOI LES DEUX PÔLES. Un simple test de luminance sur le fond (> 0,5 ⇒
 * noir) se trompe de pôle pour toute luminance entre ~0,18 et 0,5 — le point
 * de croisement réel du ratio WCAG.
 *
 * POURQUOI TOUS LES FONDS ENSEMBLE. La version précédente ajustait sur un fond
 * puis sur l'autre, en trois passes, en supposant les deux fonds « du même
 * côté ». Rien dans le schéma ne l'impose : avec ground #e0e0e0 et surface
 * #404040 elle rendait une teinte à 1,74:1 sans le moindre signal. Le prédicat
 * « tous les fonds passent » est jugé d'un bloc, et `ok` dit la vérité quand
 * la palette rend la promesse impossible.
 *
 * POURQUOI UN BALAYAGE ET PAS UNE DICHOTOMIE. Sur un seul fond, « le ratio
 * atteint le seuil » est faux-puis-vrai le long d'un pôle, et une recherche
 * binaire suffirait. Sur PLUSIEURS fonds ce n'est plus vrai : dès qu'un fond
 * est plus clair et l'autre plus sombre que la couleur, la conjonction peut
 * être vraie au milieu du chemin et fausse au pôle (#999999 entre #ffffff et
 * #000000 en est l'exemple). Le premier pas qui passe est la réponse ; seul un
 * balayage ne peut pas le manquer. Le coût reste bas parce qu'on reste en RGB
 * et que les luminances des fonds sont calculées une seule fois.
 */
export function ajusterJusquaAA(
  couleur: string,
  fonds: readonly string[],
  seuil: number = WCAG_AA,
): NuanceAjustee {
  const depart = couleur.toLowerCase();
  const luminancesFonds = fonds.map(luminance);
  const passe = (l: number): boolean =>
    luminancesFonds.every((lf) => ratioLuminances(l, lf) >= seuil);

  const rgb = hexVersRgb(depart);
  if (passe(luminanceRgb(rgb))) return { couleur: depart, ok: true };

  const versPole = (pole: Rgb): { couleur: string; pas: number } | null => {
    for (let pas = 1; pas <= PAS_AJUSTEMENT; pas += 1) {
      const candidat = melangerRgb(rgb, pole, pas / PAS_AJUSTEMENT);
      if (passe(luminanceRgb(candidat))) return { couleur: rgbVersHex(candidat), pas };
    }
    return null;
  };
  const versNoir = versPole(NOIR_RGB);
  const versBlanc = versPole(BLANC_RGB);
  if (versNoir && versBlanc) {
    return { couleur: versNoir.pas <= versBlanc.pas ? versNoir.couleur : versBlanc.couleur, ok: true };
  }
  if (versNoir) return { couleur: versNoir.couleur, ok: true };
  if (versBlanc) return { couleur: versBlanc.couleur, ok: true };

  /*
   * Aucun pôle ne tient la promesse. Sur UN SEUL fond, c'est impossible en
   * dessous de √21 ≈ 4,58 : quel que soit le fond, le noir ou le blanc atteint
   * au moins ce ratio — ce repli ne servirait donc qu'à un seuil supérieur
   * (AAA = 7). Sur PLUSIEURS fonds, il est atteignable dès 4,5 : c'est
   * exactement le cas que `ok: false` doit rendre visible. Par honnêteté, le
   * pôle le moins mauvais gagne — celui dont le PIRE ratio est le meilleur.
   */
  const pireRatio = (c: string): number => {
    const l = luminance(c);
    return luminancesFonds.reduce((min, lf) => Math.min(min, ratioLuminances(l, lf)), Infinity);
  };
  return { couleur: pireRatio(NOIR) >= pireRatio(BLANC) ? NOIR : BLANC, ok: false };
}

/**
 * Le texte posable sur un aplat : noir ou blanc, par CONTRASTE réel — jamais
 * par un seuil de luminance, qui se trompe de pôle au milieu de l'échelle.
 *
 * Au niveau du module parce que trois appelants en dépendent : le résolveur
 * (texte sur une sémantique), le repli (`onAccent` d'un tenant non repris) et
 * l'API (`identiteAvecAccent`, quand le sélecteur de couleur de l'admin
 * réécrit l'accent d'un masque déjà posé).
 */
export function textePosableSur(fond: string): '#000000' | '#ffffff' {
  return ratioContraste(NOIR, fond) >= ratioContraste(BLANC, fond) ? NOIR : BLANC;
}

// ─────────────────────────────────────────────────────────────
// Le résolveur — tout ce qui n'est pas stocké se calcule ici
// ─────────────────────────────────────────────────────────────

/** Sémantiques fixes par mode — un « payé » est vert chez tout le monde. */
const SEMANTIQUES: Record<BrandMode, { green: string; red: string; amber: string }> = {
  dark: { green: '#3fae4a', red: '#c94b3f', amber: '#e0973f' },
  light: { green: '#2f8a3b', red: '#b7382e', amber: '#b8731f' },
};

/*
 * L'ÉCHELLE D'ÉLÉVATION, en parts d'encre mêlées au socle.
 *
 * `--cf-surface-2` valait « surface + 4 % d'encre », dérivé sans regarder
 * `ground`. Or sur Brasserie, Atelier et Soleil le fond de page est PLUS
 * sombre que la carte : la tuile atterrissait à la valeur du fond (1,03:1 sur
 * Atelier), et les chips de catégories, la barre de recherche et les pastilles
 * posées sur `ground` s'effaçaient. La DA §1 l'interdit : deux surfaces
 * adjacentes ne portent jamais la même valeur.
 */
const ELEVATION_ELEMENT = 0.06;
const ELEVATION_SURVOL = 0.12;
/** Les voiles des dégradés — le haut d'une carte est plus encré que son aplat. */
const VOILE_CARTE = 0.05;
const VOILE_ELEMENT = 0.045;
const VOILE_SURVOL = 0.07;
/** Le lavis d'accent (`--cf-accent-wash`, spec §4.1) et les lavis sémantiques (`bg-ok/10`). */
const LAVIS_ACCENT = 0.12;
const LAVIS_SEMANTIQUE = 0.1;
/**
 * Le filet FERME de la spec §4.1 (`ruleFirm`, 24 % d'encre) — le point de
 * DÉPART de `--cf-line-firm`, pas sa valeur : 24 % d'encre ne mesure que 1,59 à
 * 2,28:1 selon la direction, quand 1.4.11 en exige 3. Voir `derives()`.
 */
const FILET_FERME = 0.24;
/** L'aplat de la piste de jauge, tel que `bg-ink/10` le rendait sur la carte. */
const PISTE_JAUGE = 0.1;

/**
 * Le socle de l'élévation : celle de {ground, surface} dont la valeur est la
 * plus proche de l'encre. En clair c'est la plus sombre, en sombre la plus
 * claire — dans les deux cas, s'en éloigner ENCORE vers l'encre s'éloigne
 * aussi de l'autre. On le déduit des luminances plutôt que de `mode` : c'est
 * la géométrie de la palette qui décide, pas une étiquette.
 */
function socleElevation(p: BrandPalette): string {
  const encre = luminance(p.ink);
  const dGround = Math.abs(luminance(p.ground) - encre);
  const dSurface = Math.abs(luminance(p.surface) - encre);
  return dGround <= dSurface ? p.ground : p.surface;
}

/** Parmi plusieurs fonds, celui sur lequel `couleur` est le moins lisible. */
function fondLePlusExigeant(couleur: string, fonds: readonly [string, ...string[]]): string {
  return fonds.reduce((pire, f) =>
    ratioContraste(couleur, f) < ratioContraste(couleur, pire) ? f : pire,
  );
}

/**
 * Tout ce que `contraste()` et `resoudreMarque()` partagent — calculé UNE
 * fois, ici, pour qu'un verdict porte sur la valeur RÉELLEMENT émise.
 */
function derives(brand: Brand) {
  const p = brand.palette;
  const socle = socleElevation(p);
  const elever = (t: number): string => melanger(socle, p.ink, t);
  const surface2 = elever(ELEVATION_ELEMENT);
  const survol = elever(ELEVATION_SURVOL);

  /*
   * `accentInk` porte les titres et les prix, mais AUSSI le texte des
   * pastilles posées sur le lavis d'accent (`bg-accentwash text-accentink`) :
   * ce lavis est le fond le plus sombre où il atterrit en mode clair. Le juger
   * sur `ground` seul, comme le faisait la lettre de la spec §4.1, le laissait
   * sous le seuil là où le client le lit.
   */
  const lavisAccent: readonly [string, string] = [
    melanger(p.ground, p.accent, LAVIS_ACCENT),
    melanger(p.surface, p.accent, LAVIS_ACCENT),
  ];

  /*
   * TOUS les fonds sur lesquels une encre atténuée se pose vraiment.
   *
   * `--cf-mut` n'était jugé que sur `ground` et `surface`. Il est pourtant
   * peint sur `bg-surface2` et sur le HAUT des dégradés `--cf-elev-*`, où il
   * tombait entre 3,0 et 4,1:1 selon la direction. WCAG 1.4.3 exige 4,5:1 sur
   * chaque fond où le texte se pose — alors on les liste tous, et le plus
   * exigeant gagne.
   *
   * LE LAVIS D'ACCENT EN FAIT PARTIE. Le halo de l'accroche (`.sm-hero`) est
   * un lavis d'accent posé SOUS l'état de service et le rappel d'horaire,
   * tous deux en `text-mut` : au cœur du halo, l'encre atténuée tombait à
   * 1,96:1 sur Néon et 2,52 sur Nuit. Le halo vaut désormais exactement
   * `--cf-accent-wash` (12 %), et ce lavis est jugé comme les autres fonds.
   */
  const fondsTexte: readonly [string, ...string[]] = [
    p.ground,
    p.surface,
    surface2,
    melanger(p.surface, p.ink, VOILE_CARTE),
    melanger(surface2, p.ink, VOILE_ELEMENT),
    melanger(survol, p.ink, VOILE_SURVOL),
    ...lavisAccent,
  ];

  const sem = SEMANTIQUES[brand.mode];
  /* Une teinte sémantique se lit sur son PROPRE lavis (`bg-ok/10 text-okt`). */
  const teinte = (couleur: string): NuanceAjustee =>
    ajusterJusquaAA(couleur, [
      p.ground,
      p.surface,
      melanger(p.ground, couleur, LAVIS_SEMANTIQUE),
      melanger(p.surface, couleur, LAVIS_SEMANTIQUE),
    ]);

  /* Hissée : `onMut` la relit, et un balayage de 200 nuances ne se fait pas deux fois. */
  const inkMut = ajusterJusquaAA(melanger(p.ink, p.ground, 0.5), fondsTexte);

  return {
    surface2,
    survol,
    fondsTexte,
    lavisAccent,
    sem,
    accentInk: ajusterJusquaAA(p.accent, [p.ground, p.surface, ...lavisAccent]),
    inkMut,
    /*
     * L'ENCRE POSABLE SUR L'ENCRE ATTÉNUÉE — noir ou blanc, par contraste réel.
     *
     * Une pastille `bg-mut` porte un libellé. Il était écrit `text-on-fill`,
     * une paire que rien n'ajuste : en mode sombre `on-fill` vaut l'encre, et
     * le couple tombait à 1,99 (Néon), 1,82 (Nuit), 2,85 (marque grise). Le
     * repli suivant fut `text-bg` — juste, mais par RICOCHET : il ne tient que
     * parce que `inkMut` est ajusté contre `ground`. `on-mut` le dit
     * directement, et `textePosableSur` garantit ≥ √21 ≈ 4,58:1 quelle que
     * soit la palette, même celle où l'ajustement d'`inkMut` échouerait.
     */
    onMut: textePosableSur(inkMut.couleur),
    /* L'anneau de focus est un ÉLÉMENT, pas du texte : 3:1 suffit (1.4.11) — mais opaque. */
    focus: ajusterJusquaAA(p.accent, [p.ground, p.surface], WCAG_AA_NON_TEXTE),
    /*
     * LE FILET FERME — celui qui PORTE UNE INFORMATION, et lui seul.
     *
     * `--cf-line` (encre à 12 %) et `--cf-line-2` (6 %) restent les filets
     * DÉCORATIFS : séparateurs de listes, contours de carte, traits de
     * section. Rien n'y est un état, et 1.4.11 ne s'y applique pas.
     *
     * Ce jeton-ci est l'autre moitié : la limite d'un CONTRÔLE et de ses états
     * — case à cocher non cochée, bouton radio non choisi, bord d'un champ de
     * saisie, onglet courant. Mesuré avant : `border-ink/25` valait 1,52 à
     * 2,16:1, `border-ink/8` 1,14 à 1,26, `border-ink/45` 2,22 à 3,88 (Néon
     * seule au-dessus). On ne lisait pas si la case était cochée ; on devinait.
     *
     * OPAQUE, et pas une opacité : une même alpha rend un ratio différent sur
     * chaque fond, donc ne garantit rien. Le départ est bien le `ruleFirm` de
     * la spec (24 % d'encre sur le socle d'élévation) ; l'ajustement ne fait
     * que l'empêcher de descendre sous 3:1 sur les trois fonds où ces
     * contrôles se posent vraiment — la page, la carte, la tuile.
     */
    lineFirm: ajusterJusquaAA(
      melanger(socle, p.ink, FILET_FERME),
      [p.ground, p.surface, surface2],
      WCAG_AA_NON_TEXTE,
    ),
    /*
     * LA PISTE D'UNE JAUGE — jugée contre l'ACCENT, pas contre le fond.
     *
     * Le remplissage d'une jauge de fidélité est un aplat d'accent ; ce qu'on
     * doit voir, c'est OÙ il s'arrête. L'information vit donc dans le couple
     * remplissage/piste, et nulle part ailleurs (1.4.11). La piste était
     * `bg-ink/10` : mesuré 7,50 (Brasserie), 10,37 (Néon), 5,23 (Nuit), 4,81
     * (Atelier), 3,75 (Marché) — et 2,38 sur SOLEIL, où le safran sur le sable
     * ne se détache plus.
     *
     * Aucun jeton existant ne rattrapait les six : les encres plus opaques
     * aggravent Soleil (elles s'éloignent du fond, pas de l'accent), les
     * aplats de bouton (`fill`, `btn`) corrigent Soleil à 4,72 mais cassent
     * Brasserie (1,85), Marché (2,07) et Atelier (2,44), et l'anneau de focus
     * EST l'accent (1,00). D'où ce dérivé de plus.
     *
     * Le départ vaut exactement ce que `bg-ink/10` rendait sur la carte : cinq
     * directions sur six ne bougent pas d'un bit, seule Soleil est corrigée.
     */
    gaugeTrack: ajusterJusquaAA(
      melanger(p.surface, p.ink, PISTE_JAUGE),
      [p.accent],
      WCAG_AA_NON_TEXTE,
    ),
    green: teinte(sem.green),
    red: teinte(sem.red),
    amber: teinte(sem.amber),
  };
}

/**
 * Les couples jugés, dans l'ordre où ils sortent — une union littérale et non
 * `string` : les verdicts partent en 400 par l'API, et un consommateur doit
 * pouvoir matcher un couple sans deviner son orthographe.
 */
export const COUPLES_CONTRASTE = [
  'ink/ground',
  'ink/surface',
  'onAccent/accent',
  'accentInk/ground',
  'accentInk/surface',
  'accentInk/accentWash',
  'inkMut/ground',
  'inkMut/surface',
  'inkMut/elevation',
  'onMut/mut',
  'greenInk/greenWash',
  'redInk/redWash',
  'amberInk/amberWash',
  'focus/ground',
  'focus/surface',
  'lineFirm/ground',
  'lineFirm/surface',
  'lineFirm/elevation',
  'gaugeTrack/accent',
] as const;
export type CoupleContraste = (typeof COUPLES_CONTRASTE)[number];

export type Verdict = {
  couple: CoupleContraste;
  /**
   * Un couple DÉRIVÉ n'est pas actionnable : le restaurateur ne pose ni
   * `inkMut`, ni `accentInk`, ni l'anneau de focus — c'est le résolveur qui
   * les calcule. Un tel verdict n'échoue que si la palette rend la dérivation
   * impossible, et il ne porte alors aucune `proposition`.
   */
  derive: boolean;
  /** 4,5 pour du texte (1.4.3), 3 pour un élément (1.4.11). */
  seuil: number;
  avant: string;
  arriere: string;
  ratio: number;
  ok: boolean;
  /** La nuance la plus proche qui passe — `null` sinon (ça passe déjà, ou rien ne passe, ou c'est dérivé). */
  proposition: string | null;
};

export function contraste(brand: Brand): { ok: boolean; verdicts: Verdict[] } {
  const p = brand.palette;
  const d = derives(brand);
  const lavisSem = (couleur: string): string =>
    fondLePlusExigeant(couleur, [
      melanger(p.ground, couleur, LAVIS_SEMANTIQUE),
      melanger(p.surface, couleur, LAVIS_SEMANTIQUE),
    ]);

  const couples: ReadonlyArray<{
    couple: CoupleContraste;
    avant: string;
    arriere: string;
    seuil: number;
    derive: boolean;
  }> = [
    { couple: 'ink/ground', avant: p.ink, arriere: p.ground, seuil: WCAG_AA, derive: false },
    { couple: 'ink/surface', avant: p.ink, arriere: p.surface, seuil: WCAG_AA, derive: false },
    { couple: 'onAccent/accent', avant: p.onAccent, arriere: p.accent, seuil: WCAG_AA, derive: false },
    { couple: 'accentInk/ground', avant: d.accentInk.couleur, arriere: p.ground, seuil: WCAG_AA, derive: true },
    { couple: 'accentInk/surface', avant: d.accentInk.couleur, arriere: p.surface, seuil: WCAG_AA, derive: true },
    {
      couple: 'accentInk/accentWash',
      avant: d.accentInk.couleur,
      arriere: fondLePlusExigeant(d.accentInk.couleur, d.lavisAccent),
      seuil: WCAG_AA,
      derive: true,
    },
    { couple: 'inkMut/ground', avant: d.inkMut.couleur, arriere: p.ground, seuil: WCAG_AA, derive: true },
    { couple: 'inkMut/surface', avant: d.inkMut.couleur, arriere: p.surface, seuil: WCAG_AA, derive: true },
    {
      // Le pire des fonds composés : surface-2 et le haut des dégradés d'élévation.
      couple: 'inkMut/elevation',
      avant: d.inkMut.couleur,
      arriere: fondLePlusExigeant(d.inkMut.couleur, d.fondsTexte),
      seuil: WCAG_AA,
      derive: true,
    },
    // Le libellé d'une pastille `bg-mut` — noir ou blanc, choisi par contraste.
    { couple: 'onMut/mut', avant: d.onMut, arriere: d.inkMut.couleur, seuil: WCAG_AA, derive: true },
    { couple: 'greenInk/greenWash', avant: d.green.couleur, arriere: lavisSem(d.sem.green), seuil: WCAG_AA, derive: true },
    { couple: 'redInk/redWash', avant: d.red.couleur, arriere: lavisSem(d.sem.red), seuil: WCAG_AA, derive: true },
    { couple: 'amberInk/amberWash', avant: d.amber.couleur, arriere: lavisSem(d.sem.amber), seuil: WCAG_AA, derive: true },
    { couple: 'focus/ground', avant: d.focus.couleur, arriere: p.ground, seuil: WCAG_AA_NON_TEXTE, derive: true },
    { couple: 'focus/surface', avant: d.focus.couleur, arriere: p.surface, seuil: WCAG_AA_NON_TEXTE, derive: true },
    /*
     * Le filet FERME sur les trois fonds où un contrôle se pose — 1.4.11.
     * Le filet DÉCORATIF (`--cf-line`) n'a volontairement aucun verdict : un
     * séparateur ne porte aucune information, lui imposer 3:1 rendrait toutes
     * les cartes du produit cerclées de gris franc.
     */
    { couple: 'lineFirm/ground', avant: d.lineFirm.couleur, arriere: p.ground, seuil: WCAG_AA_NON_TEXTE, derive: true },
    { couple: 'lineFirm/surface', avant: d.lineFirm.couleur, arriere: p.surface, seuil: WCAG_AA_NON_TEXTE, derive: true },
    { couple: 'lineFirm/elevation', avant: d.lineFirm.couleur, arriere: d.surface2, seuil: WCAG_AA_NON_TEXTE, derive: true },
    // La piste d'une jauge se juge contre son REMPLISSAGE, qui est l'accent.
    { couple: 'gaugeTrack/accent', avant: d.gaugeTrack.couleur, arriere: p.accent, seuil: WCAG_AA_NON_TEXTE, derive: true },
  ];

  const verdicts = couples.map(({ couple, avant, arriere, seuil, derive }): Verdict => {
    // Le seuil compare la valeur BRUTE — l'arrondi n'habille que le champ rapporté.
    const brut = ratioContraste(avant, arriere);
    const ratio = Math.round(brut * 100) / 100;
    const ok = brut >= seuil;
    if (ok || derive) return { couple, derive, seuil, avant, arriere, ratio, ok, proposition: null };
    const candidat = ajusterJusquaAA(avant, [arriere], seuil);
    return {
      couple, derive, seuil, avant, arriere, ratio, ok,
      proposition: candidat.ok ? candidat.couleur : null,
    };
  });
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

/**
 * Rayons par forme — cinq crans explicites, plus la pilule qui ne change
 * jamais. La spec §4.1 n'en nomme que trois (Sm/Md/Lg = `xs`/`md`/`lg` ici) ;
 * `sm` et `xl` étaient jusqu'ici l'un un doublon de `md`, l'autre un `lg + 4`
 * inventé au moment de l'émission. Une échelle se pose, elle ne s'improvise
 * pas à l'usage.
 */
const RAYONS: Record<BrandShape, { xs: number; sm: number; md: number; lg: number; xl: number }> = {
  net: { xs: 2, sm: 3, md: 4, lg: 6, xl: 8 },
  doux: { xs: 6, sm: 8, md: 10, lg: 14, xl: 18 },
  rond: { xs: 12, sm: 15, md: 18, lg: 24, xl: 28 },
};

/** Durées (ms) base / entrée / fête, et courbe. */
const MOUVEMENTS: Record<BrandMotion, { base: number; entree: number; fete: number; ease: string }> = {
  pose: { base: 240, entree: 320, fete: 900, ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  vif: { base: 140, entree: 200, fete: 600, ease: 'cubic-bezier(0.3, 1.4, 0.4, 1)' },
};

export type JetonsMasque = {
  vars: Record<string, string>;
  colorScheme: BrandMode;
  prixMono: boolean;
};

const police = (slug: FontSlug): string => `var(--police-${slug}), ${fallbackDe(slug)}`;

export function resoudreMarque(brand: Brand): JetonsMasque {
  // La palette arrive déjà en minuscules : `HexSchema` normalise à la
  // frontière, et `DIRECTIONS` comme `marqueDeRepli` sont écrits ainsi.
  const p = brand.palette;
  const sombre = brand.mode === 'dark';
  const d = derives(brand);
  const r = RAYONS[brand.shape];
  const m = MOUVEMENTS[brand.motion];
  const pair = TYPE_PAIRS[brand.type.pair];
  const ombre = sombre ? 'rgba(0, 0, 0, 0.38)' : alpha(p.ink, 0.14);

  const vars: Record<string, string> = {
    // Neutres
    '--cf-bg': p.ground,
    '--cf-surface': p.surface,
    '--cf-surface-2': d.surface2,
    '--cf-text': p.ink,
    '--cf-mut': d.inkMut.couleur,
    '--cf-on-mut': d.onMut,
    // Les deux filets DÉCORATIFS — séparateurs, contours de carte, traits de
    // section. Une opacité suffit : rien ici ne porte d'information, donc
    // aucun plancher de 1.4.11 à tenir (le filet qui, lui, en porte un est
    // `--cf-line-firm`, juste en dessous).
    '--cf-line': alpha(p.ink, 0.12),
    '--cf-line-2': alpha(p.ink, 0.06),
    // Le filet FERME — limite d'un CONTRÔLE et de ses états (case, radio,
    // champ, onglet courant) : opaque, garanti 3:1 sur la page, la carte et la
    // tuile. Voir `derives()` pour les mesures d'avant.
    '--cf-line-firm': d.lineFirm.couleur,
    '--cf-surface-3': alpha(p.ink, 0.03),
    '--cf-surface-6': alpha(p.ink, 0.06),
    '--cf-fill': sombre ? melanger(p.surface, p.ink, 0.06) : p.ink,
    '--cf-on-fill': sombre ? p.ink : p.ground,
    // Le bouton « encre » du produit : il vaut l'encre en clair, une surface
    // relevée en sombre. Il s'appelait `--cf-btn-dark` — un nom qui mentait
    // sur une Brasserie crème, où il n'a rien de sombre.
    '--cf-btn': sombre ? melanger(p.surface, p.ink, 0.1) : p.ink,
    // Accent
    '--cf-accent': p.accent,
    '--cf-accent-hover': melanger(p.accent, sombre ? BLANC : NOIR, 0.08),
    '--cf-on-accent': p.onAccent,
    '--cf-accent-ink': d.accentInk.couleur,
    '--cf-accent-wash': alpha(p.accent, LAVIS_ACCENT),
    // L'anneau de focus : OPAQUE et garanti 3:1 sur le fond comme sur la carte.
    // À 60 % d'alpha il tombait à 1,75:1 sur Soleil — un anneau qu'on ne voit
    // pas n'est pas un focus visible (1.4.11, 2.4.13).
    '--cf-focus': d.focus.couleur,
    // La piste d'une jauge : garantie 3:1 contre l'ACCENT, qui la remplit.
    // C'est le seul jeton du masque jugé contre l'accent et non contre un fond
    // — parce que c'est là qu'est l'information (« où le remplissage s'arrête »).
    '--cf-gauge-track': d.gaugeTrack.couleur,
    // Sémantiques — fixes par mode, jamais la marque
    '--cf-green': d.sem.green,
    '--cf-red': d.sem.red,
    '--cf-amber': d.sem.amber,
    // Les teintes TEXTE des sémantiques vivent dans des pastilles posées sur
    // leur propre lavis, sur une carte ou sur la page : les trois fonds.
    '--cf-green-t': d.green.couleur,
    '--cf-red-t': d.red.couleur,
    '--cf-amber-t': d.amber.couleur,
    '--cf-on-green': textePosableSur(d.sem.green),
    '--cf-on-red': textePosableSur(d.sem.red),
    '--cf-on-amber': textePosableSur(d.sem.amber),
    // Surfaces composées — le voile suit l'encre, l'aplat suit l'élévation
    '--cf-card-gradient': `linear-gradient(180deg, ${alpha(p.ink, VOILE_CARTE)} 0%, ${alpha(p.ink, 0)} 62%), linear-gradient(0deg, ${p.surface}, ${p.surface})`,
    '--cf-elev-gradient': `linear-gradient(180deg, ${alpha(p.ink, VOILE_ELEMENT)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${d.surface2}, ${d.surface2})`,
    '--cf-elev-hover': `linear-gradient(180deg, ${alpha(p.ink, VOILE_SURVOL)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${d.survol}, ${d.survol})`,
    // Ombres
    '--cf-shadow-2': `0 2px 0 ${ombre}, 0 16px 40px ${ombre}`,
    '--cf-shadow-soft': `0 12px 34px ${ombre}`,
    '--cf-shadow-card': `0 1px 0 ${ombre}, 0 10px 26px ${ombre}`,
    '--cf-shadow-drawer': `-1px 0 0 ${alpha(p.ink, 0.08)}, -26px 0 60px ${ombre}`,
    /*
     * L'OMBRE D'UN VISUEL DÉTOURÉ (`.sm-cut`) — un jeton à part, et pourquoi.
     *
     * `drop-shadow()` ne prend qu'UNE ombre, sans virgule : aucun des
     * `--cf-shadow-*` ci-dessus, tous composés de deux couches, n'y entre.
     * Elle était écrite `rgba(0, 0, 0, 0.6)` en dur dans `order.css` — une
     * tache noire sous chaque plat d'une carte crème. Elle est plus dense que
     * l'ombre de carte parce qu'elle assoit une découpe sans boîte : c'est
     * elle seule qui décolle la photo du fond.
     */
    '--cf-shadow-cut': `0 6px 12px ${sombre ? 'rgba(0, 0, 0, 0.6)' : alpha(p.ink, 0.3)}`,
    /*
     * LE VOILE S'ASSOMBRIT TOUJOURS — il ne suit jamais le fond.
     *
     * Les trois voiles (modale, tiroir, feuille du tunnel) étaient un
     * `bg-bg/N` : sur un masque CLAIR, voiler le fond avec le fond ÉCLAIRCIT
     * la page au lieu de la reculer, et la feuille flotte sur un blanc laiteux
     * sans hiérarchie. En mode sombre, un noir franc ; en mode clair, l'encre
     * du restaurant à 45 % — teintée par sa marque, mais toujours plus sombre
     * que ce qu'elle recouvre.
     */
    '--cf-scrim': sombre ? 'rgba(0, 0, 0, 0.72)' : alpha(p.ink, 0.45),
    // Forme
    '--cf-r-xs': `${r.xs}px`,
    '--cf-r-sm': `${r.sm}px`,
    '--cf-r-md': `${r.md}px`,
    '--cf-r': `${r.lg}px`,
    '--cf-r-lg': `${r.xl}px`,
    '--cf-r-pill': '999px',
    // Mouvement
    '--sm-ease': m.ease,
    /*
     * Le retour tactile est une CLASSE À PART, pas la durée de base : la DA §4
     * demande une réponse perçue en moins de 100 ms, et `active:duration-fast`
     * l'étirait à 240 ms sur un masque posé — un bouton qui s'enfonce mollement.
     * Un tiers de la base, donc : 80 ms posé, 47 ms vif.
     */
    '--sm-t-snap': `${Math.round(m.base / 3)}ms`,
    '--sm-t-fast': `${m.base}ms`,
    '--sm-t-med': `${m.entree}ms`,
    '--sm-t-slow': `${m.fete}ms`,
    // Polices
    '--cf-font-display': police(pair.display),
    '--cf-font-body': police(pair.body),
    '--cf-font-mono': police(pair.mono ?? MONO_PAR_DEFAUT),
  };
  return { vars, colorScheme: brand.mode, prixMono: pair.prixMono };
}

// ─────────────────────────────────────────────────────────────
// Le repli, le masque effectif, les champs plats
// ─────────────────────────────────────────────────────────────

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
  /*
   * L'accent STOCKÉ reste celui du restaurant — spec §8.1 : `accent =
   * brandColor`. Il était ramené à AA sur le fond de Nuit, ce qui réécrivait
   * silencieusement la couleur de marque : un tenant à l'accent sombre voyait
   * `GET /tenants/me` lui rendre un `brandColor` qu'il n'a jamais posé, et le
   * sélecteur de son admin s'ouvrait sur une autre couleur que la sienne.
   * C'est `accentInk` (dérivé, jamais stocké) qui porte l'AA du texte.
   */
  const lu = HexSchema.safeParse(brandColor ?? '');
  const accent = lu.success ? lu.data : LAITON;
  const onAccent = textePosableSur(accent);
  /*
   * Le `logoUrl` legacy n'a JAMAIS traversé le contrat : le poser tel quel
   * dans `logo.mark.dark` contournait le refus des schémas non http(s), et
   * `logoPour` le rendait ensuite en `src` de vitrine et d'icône de manifeste.
   * Le repli doit rendre un `Brand` que `BrandSchema` accepterait.
   */
  const logo = ImageUrl.safeParse(logoUrl ?? null);
  return {
    ...nuit,
    palette: { ...nuit.palette, accent, onAccent },
    logo: {
      mark: { light: null, dark: logo.success ? logo.data : null },
      lockup: { light: null, dark: null },
    },
    preset: 'nuit',
  };
}

/** Pourquoi le masque rendu n'est pas celui de la base. */
export type RepliMarque = null | 'absent' | 'invalide';

/**
 * LE SEUL ADAPTATEUR DE LECTURE — et il dit POURQUOI il replie.
 *
 * Le masque lu en base est une donnée de FORME non fiable : Mongoose infère
 * des clés optionnelles là où le contrat les veut présentes, `type.pair` en
 * simple chaîne, et `.lean()` ne pose AUCUN défaut de schéma (d'où les
 * `.default(null)` du contrat : une clé absente vaut `null` des deux côtés,
 * sinon un même document rendait Soleil par `findById()` et Nuit par
 * `.lean()`). Un sous-document HYDRATÉ porte en plus des clés de prototype
 * ($__parent, save, toObject…) : on le ramène à un objet nu avant de le lire.
 *
 * Le repli était MUET : un `brand` stocké qui échoue le contrat rendait Nuit
 * sur un 200, sans journal ni signal — l'identité d'un restaurant disparaissait
 * et personne ne le savait. `repli` porte la cause pour que les adaptateurs de
 * l'API la journalisent et que la fiche CRM puisse la dire.
 */
export function lireMarque(t: {
  brand?: unknown;
  brandColor?: string | null;
  logoUrl?: string | null;
}): { brand: Brand; repli: RepliMarque } {
  const brut = t.brand as { toObject?: () => unknown } | null | undefined;
  const nu = brut && typeof brut.toObject === 'function' ? brut.toObject() : brut;
  if (nu == null) return { brand: marqueDeRepli(t.brandColor, t.logoUrl), repli: 'absent' };
  const lu = BrandSchema.safeParse(nu);
  if (lu.success) return { brand: lu.data, repli: null };
  return { brand: marqueDeRepli(t.brandColor, t.logoUrl), repli: 'invalide' };
}

/** Le raccourci de `lireMarque` pour les appelants qui n'ont rien à journaliser. */
export function marqueEffective(t: {
  brand?: unknown;
  brandColor?: string | null;
  logoUrl?: string | null;
}): Brand {
  return lireMarque(t).brand;
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
