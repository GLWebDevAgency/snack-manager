import {
  HEX,
  melanger,
  ratioContraste,
  textePosableSur,
  WCAG_AA,
} from "@sm/contracts";

/**
 * L'ACCENT DE L'ADMIN — la seule couleur de marque des surfaces du personnel.
 *
 * ═══ LA COULEUR EN PUR VIENT DU CONTRAT, PAS D'UNE COPIE ═══
 *
 * Ce module portait sa propre `luminance()`, son propre `ratioContraste()` et
 * son propre mélange — une cinquième copie des mêmes vingt lignes dans le
 * dépôt, dont trois jugeaient encore par un SEUIL DE LUMINANCE que
 * `@sm/contracts` documente comme faux (il se trompe de pôle entre 0,18 et
 * 0,5). Deux implémentations de WCAG dans un même produit finissent toujours
 * par diverger d'un dixième, et c'est le dixième qui décide de la lisibilité.
 *
 * Ce qui RESTE ici est ce que le contrat ne peut pas savoir : la géométrie de
 * la marque grise — la surface la plus claire de SM Dark et l'opacité maximale
 * d'un lavis d'accent du back-office.
 */

/** Laiton éclairci : déjà AA sur les surfaces composées les plus claires. */
export const DEFAULT_TENANT_ACCENT = "#dbc191";
/** #262626 survolé par le voile blanc maximal de 7 % du design system. */
const BRIGHTEST_ELEVATED_SURFACE = "#353535";
/** Usage réel le plus exigeant : texte accent sur `bg-accent/20`. */
const MAX_ACCENT_TINT_ALPHA = 0.2;
const WHITE = "#ffffff";

/**
 * Le sélecteur de couleur de l'admin accepte la forme courte (`#ca8`) que le
 * contrat, lui, refuse : il ne connaît que `#rrggbb`, la seule forme stockée.
 * L'expansion se fait donc ici, à cette frontière-là.
 */
function normalize(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return HEX.test(raw) ? raw : null;
}

export function tenantColorContrast(foreground: string, background: string): number {
  return ratioContraste(foreground, background);
}

/**
 * Contraste plancher sur la surface la plus claire et sur sa variante teintée
 * par l'accent. Tester uniquement l'aplat sombre surestimait le contraste des
 * pills et boutons translucides réellement affichés.
 */
export function tenantAccentContrastFloor(accent: string): number {
  return Math.min(
    ratioContraste(accent, BRIGHTEST_ELEVATED_SURFACE),
    ratioContraste(accent, melanger(BRIGHTEST_ELEVATED_SURFACE, accent, MAX_ACCENT_TINT_ALPHA)),
  );
}

/**
 * Accent effectif sur les surfaces sombres. Une marque trop sombre est
 * éclaircie juste assez pour que les usages `text-accent` restent AA ; une
 * valeur invalide retombe sur le laiton du design system.
 *
 * L'ajustement va VERS LE BLANC seulement, et c'est voulu : l'admin est
 * sombre, l'autre pôle éloignerait du seuil. Le balayage à deux pôles du
 * contrat (`ajusterJusquaAA`) sert les masques client, où le fond varie.
 */
export function accessibleTenantAccent(value: string | null | undefined): string {
  const source = normalize(value) ?? DEFAULT_TENANT_ACCENT;
  if (tenantAccentContrastFloor(source) >= WCAG_AA) {
    return source;
  }
  for (let step = 1; step <= 1_000; step += 1) {
    const candidate = melanger(source, WHITE, step / 1_000);
    if (tenantAccentContrastFloor(candidate) >= WCAG_AA) {
      return candidate;
    }
  }
  return WHITE;
}

/** Noir ou blanc, choisi par contraste réel plutôt que par seuil approximatif. */
export function readableOnTenantAccent(accent: string): "#000000" | "#ffffff" {
  return textePosableSur(accent);
}

export function tenantAccentPalette(value: string | null | undefined): {
  accent: string;
  onAccent: "#000000" | "#ffffff";
} {
  const accent = accessibleTenantAccent(value);
  return { accent, onAccent: readableOnTenantAccent(accent) };
}
