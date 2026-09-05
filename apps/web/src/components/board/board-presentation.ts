import type { CSSProperties } from "react";
import { screenPresentationOf, type Brand } from "@sm/contracts";

/** Presentation is local to this screen; the restaurant's identity is never cloned or edited. */
export function boardPresentation(brand: Brand, raw: unknown) {
  const presentation = screenPresentationOf(raw);
  const motion = presentation.motion === "brand"
    ? (brand.motion === "vif" ? "expressive" : "subtle")
    : presentation.motion;
  const radius = { square: 0, soft: 18, round: 40 };
  const style = {
    "--bd-price-scale": { compact: 0.88, balanced: 1, large: 1.14 }[presentation.priceScale],
    "--ss-travel": motion === "expressive" ? "30px" : "12px",
    "--ss-cycle": motion === "expressive" ? "18s" : "32s",
    "--ss-enter": motion === "expressive" ? "680ms" : "880ms",
    "--ss-stagger": motion === "expressive" ? "90ms" : "65ms",
    ...(presentation.corners === "brand" ? {} : {
      "--bd-corner": `${radius[presentation.corners]}px`,
      "--cf-r-sm": `${Math.min(radius[presentation.corners], 20)}px`,
      "--cf-r-md": `${radius[presentation.corners]}px`,
      "--cf-r-lg": `${radius[presentation.corners]}px`,
      "--cf-r-xl": `${radius[presentation.corners]}px`,
    }),
  } as CSSProperties;
  return { presentation, motion, style };
}
