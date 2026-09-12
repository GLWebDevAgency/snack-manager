import type { CSSProperties } from "react";
import { dark, radius, motion } from "@sm/design-tokens";

/** Presentation only, scoped to the two existing staff shells.
 * The restaurant accent, functional status colours and customer brand masks
 * keep their existing owners. Never apply this adapter to documentElement.
 */
export const backofficeVisualStyle: Readonly<CSSProperties & Record<`--${string}`, string>> = Object.freeze({
  "--cf-bg": dark.canvas,
  "--cf-surface": dark.surface,
  "--cf-surface-2": dark.secondary,
  "--cf-text": dark.ink,
  "--cf-mut": dark.muted,
  "--cf-on-mut": dark.canvas,
  // Status inks must also survive the lighter surfaces after hover + tint.
  // The functional red/green/amber fills remain owned by the existing theme.
  "--cf-red-t": dark.danger,
  "--cf-green-t": dark.success,
  "--cf-amber-t": dark.warning,
  "--cf-line": "rgba(245,247,242,.10)",
  "--cf-line-2": "rgba(245,247,242,.06)",
  // A field boundary communicates a control; the decorative kit line does not
  // meet 3:1. The muted token does, on all three staff surfaces.
  "--cf-line-firm": dark.muted,
  "--cf-fill": dark.secondary,
  "--cf-on-fill": dark.ink,
  "--cf-btn": dark.secondary,
  "--cf-focus": dark.focus,
  "--cf-card-gradient": `linear-gradient(${dark.surface}, ${dark.surface})`,
  "--cf-elev-gradient": `linear-gradient(${dark.secondary}, ${dark.secondary})`,
  "--cf-elev-hover": `linear-gradient(${dark.secondary}, ${dark.secondary})`,
  "--cf-shadow-2": "0 12px 32px rgba(0,0,0,.20)",
  "--cf-shadow-soft": "0 8px 24px rgba(0,0,0,.14)",
  "--cf-shadow-card": "0 4px 16px rgba(0,0,0,.12)",
  "--cf-shadow-drawer": "-12px 0 40px rgba(0,0,0,.28)",
  "--cf-scrim": dark.scrim,
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
