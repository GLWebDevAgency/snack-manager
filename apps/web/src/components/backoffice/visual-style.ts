import type { CSSProperties } from "react";
import { ajusterJusquaAA, melanger, textePosableSur } from "@sm/contracts";

export type BackofficeTheme = "light" | "dark";
type VisualStyle = Readonly<CSSProperties & Record<`--${string}`, string>>;
import { dark, light, radius, motion, brand } from "@sm/design-tokens";

/** Presentation only, scoped to the two existing staff shells.
 * The restaurant accent, functional status colours and customer brand masks
 * keep their existing owners. Never apply this adapter to documentElement.
 */
function visualStyle(theme: BackofficeTheme): VisualStyle {
  const t = theme === "light" ? light : dark;
  const surfaces = [t.canvas, t.surface, t.secondary].flatMap(background =>
    [0, .04, .08].map(hover => melanger(background, theme === "light" ? t.ink : "#ffffff", hover)));
  const inkOnTint = (ink: string, fill: string) => ajusterJusquaAA(ink,
    surfaces.flatMap(background => [background, melanger(background, fill, .16)])).couleur;
  return Object.freeze({
  "--cf-bg": t.canvas,
  "--cf-surface": t.surface,
  "--cf-surface-2": t.secondary,
  "--cf-text": t.ink,
  "--cf-mut": ajusterJusquaAA(t.muted, surfaces).couleur,
  "--cf-on-mut": textePosableSur(t.muted),
  // Status inks must also survive the lighter surfaces after hover + tint.
  // The functional red/green/amber fills remain owned by the existing theme.
  "--cf-red-t": inkOnTint(t.danger, "#c94b3f"),
  "--cf-green-t": inkOnTint(t.success, "#3fae4a"),
  "--cf-amber-t": inkOnTint(t.warning, "#e0973f"),
  "--cf-gold-ink": inkOnTint(brand.snackManager, brand.snackManager),
  "--cf-line": t.line,
  "--cf-line-2": theme === "light" ? "rgba(37,39,35,.08)" : "rgba(245,247,242,.06)",
  // A field boundary communicates a control; the decorative kit line does not
  // meet 3:1. The muted token does, on all three staff surfaces.
  "--cf-line-firm": t.muted,
  "--cf-fill": t.secondary,
  "--cf-on-fill": t.ink,
  "--cf-btn": t.secondary,
  "--cf-focus": t.focus,
  "--cf-card-gradient": `linear-gradient(${t.surface}, ${t.surface})`,
  "--cf-elev-gradient": `linear-gradient(${t.secondary}, ${t.secondary})`,
  "--cf-elev-hover": `linear-gradient(${t.secondary}, ${t.secondary})`,
  "--cf-shadow-2": theme === "light" ? "0 12px 32px rgba(25,32,22,.07)" : "0 12px 32px rgba(0,0,0,.20)",
  "--cf-shadow-soft": theme === "light" ? "0 8px 24px rgba(25,32,22,.05)" : "0 8px 24px rgba(0,0,0,.14)",
  "--cf-shadow-card": theme === "light" ? "0 2px 10px rgba(25,32,22,.04)" : "0 4px 16px rgba(0,0,0,.12)",
  "--cf-shadow-drawer": "-12px 0 40px rgba(0,0,0,.28)",
  "--cf-scrim": t.scrim,
  "--cf-r-xs": `${radius.field}px`,
  "--cf-r-sm": `${radius.button}px`,
  "--cf-r-md": `${radius.field}px`,
  "--cf-r": `${radius.card}px`,
  "--cf-r-lg": `${radius.sheet}px`,
  "--sm-ease": motion.curve,
  "--sm-t-snap": `${motion.press}ms`,
  "--sm-t-fast": `${motion.state}ms`,
  "--sm-t-med": `${motion.sheet}ms`,
} satisfies CSSProperties & Record<`--${string}`, string>);

}
const styles = Object.freeze({ light: visualStyle("light"), dark: visualStyle("dark") });

/** Ink is adapted to the staff surface; the existing accent fill is untouched. */
export function backofficeStyle(theme: BackofficeTheme, accent = "#c9a15a"): VisualStyle {
  const t = theme === "light" ? light : dark;
  const backgrounds = [t.canvas, t.surface, t.secondary].flatMap(background =>
    [0, .04, .08].flatMap(hover => {
      const row = melanger(background, theme === "light" ? t.ink : "#ffffff", hover);
      return [row, melanger(row, accent, .14), melanger(row, accent, .2)];
    }));
  return { ...styles[theme], "--cf-accent-ink": ajusterJusquaAA(accent, backgrounds).couleur };
}

/** Existing dark consumers retain their explicit compatibility export. */
export const backofficeVisualStyle = styles.dark;
