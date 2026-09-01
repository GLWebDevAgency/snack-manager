/** Laiton éclairci : déjà AA sur les surfaces composées les plus claires. */
export const DEFAULT_TENANT_ACCENT = "#dbc191";
/** #262626 survolé par le voile blanc maximal de 7 % du design system. */
const BRIGHTEST_ELEVATED_SURFACE = "#353535";
/** Usage réel le plus exigeant : texte accent sur `bg-accent/20`. */
const MAX_ACCENT_TINT_ALPHA = 0.2;
const WHITE = "#ffffff";
const BLACK = "#000000";
const WCAG_AA_TEXT = 4.5;

type Rgb = readonly [number, number, number];

function normalize(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
}

function rgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(color: string): number {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function tenantColorContrast(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixWithWhite(color: string, ratio: number): string {
  const source = rgb(color);
  return hex(source.map((channel) => channel + (255 - channel) * ratio) as unknown as Rgb);
}

function overlay(foreground: string, background: string, alpha: number): string {
  const front = rgb(foreground);
  const back = rgb(background);
  return hex(
    front.map(
      (channel, index) => channel * alpha + (back[index] ?? 0) * (1 - alpha),
    ) as unknown as Rgb,
  );
}

/**
 * Contraste plancher sur la surface la plus claire et sur sa variante teintée
 * par l'accent. Tester uniquement l'aplat sombre surestimait le contraste des
 * pills et boutons translucides réellement affichés.
 */
export function tenantAccentContrastFloor(accent: string): number {
  return Math.min(
    tenantColorContrast(accent, BRIGHTEST_ELEVATED_SURFACE),
    tenantColorContrast(
      accent,
      overlay(accent, BRIGHTEST_ELEVATED_SURFACE, MAX_ACCENT_TINT_ALPHA),
    ),
  );
}

/**
 * Accent effectif sur les surfaces sombres. Une marque trop sombre est
 * éclaircie juste assez pour que les usages `text-accent` restent AA ; une
 * valeur invalide retombe sur le laiton du design system.
 */
export function accessibleTenantAccent(value: string | null | undefined): string {
  const source = normalize(value) ?? DEFAULT_TENANT_ACCENT;
  if (tenantAccentContrastFloor(source) >= WCAG_AA_TEXT) {
    return source;
  }
  for (let step = 1; step <= 1_000; step += 1) {
    const candidate = mixWithWhite(source, step / 1_000);
    if (tenantAccentContrastFloor(candidate) >= WCAG_AA_TEXT) {
      return candidate;
    }
  }
  return WHITE;
}

/** Noir ou blanc, choisi par contraste réel plutôt que par seuil approximatif. */
export function readableOnTenantAccent(accent: string): "#000000" | "#ffffff" {
  return tenantColorContrast(BLACK, accent) >= tenantColorContrast(WHITE, accent)
    ? BLACK
    : WHITE;
}

export function tenantAccentPalette(value: string | null | undefined): {
  accent: string;
  onAccent: "#000000" | "#ffffff";
} {
  const accent = accessibleTenantAccent(value);
  return { accent, onAccent: readableOnTenantAccent(accent) };
}
