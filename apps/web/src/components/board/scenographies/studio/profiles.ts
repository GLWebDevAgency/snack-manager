import type { Scenography, ScreenOrientation } from "@sm/contracts";

export type StudioPreset = Exclude<Scenography, "ardoise" | "comptoir">;
export type StudioFamily = "poster" | "gallery" | "editorial";
export interface StudioProfile {
  family: StudioFamily;
  layout: "split" | "center" | "stage" | "panels" | "wide" | "alternating" | "sidebar" | "columns" | "manifesto" | "frames" | "horizon" | "facets" | "ribbon";
  atmosphere: "spotlight" | "orbit" | "curtain" | "daylight" | "pan" | "planes" | "diagonal" | "vertical" | "type" | "trace" | "aurora" | "prism" | "ribbon";
  entrance: "rise" | "reveal" | "slide";
}

/** Geometry, continuous movement and entrance are authored together, never as colour variants. */
export const STUDIO_PROFILES = {
  affiche: { family: "poster", layout: "split", atmosphere: "spotlight", entrance: "rise" },
  halo: { family: "poster", layout: "center", atmosphere: "orbit", entrance: "reveal" },
  premiere: { family: "poster", layout: "stage", atmosphere: "curtain", entrance: "slide" },
  galerie: { family: "gallery", layout: "panels", atmosphere: "daylight", entrance: "reveal" },
  panorama: { family: "gallery", layout: "wide", atmosphere: "pan", entrance: "slide" },
  decoupe: { family: "gallery", layout: "alternating", atmosphere: "planes", entrance: "rise" },
  editorial: { family: "editorial", layout: "sidebar", atmosphere: "diagonal", entrance: "slide" },
  colonne: { family: "editorial", layout: "columns", atmosphere: "vertical", entrance: "rise" },
  manifeste: { family: "editorial", layout: "manifesto", atmosphere: "type", entrance: "reveal" },
  contour: { family: "gallery", layout: "frames", atmosphere: "trace", entrance: "reveal" },
  aurore: { family: "poster", layout: "horizon", atmosphere: "aurora", entrance: "rise" },
  prisme: { family: "gallery", layout: "facets", atmosphere: "prism", entrance: "slide" },
  ruban: { family: "editorial", layout: "ribbon", atmosphere: "ribbon", entrance: "slide" },
} as const satisfies Record<StudioPreset, StudioProfile>;

/** Dense categories retain every name and price. Images yield space before typography does. */
export function studioComposition(count: number, orientation: ScreenOrientation, family: StudioFamily) {
  const n = Math.min(8, Math.max(1, count));
  const portrait = orientation === "portrait";
  const dense = n > 4;
  const rows = portrait ? n : (dense ? 2 : 1);
  const columns = portrait ? 1 : (dense ? Math.ceil(n / 2) : n);
  const name = portrait
    ? (n === 1 ? 112 : n === 2 ? 78 : n <= 4 ? 64 : 48)
    : (n === 1 ? 120 : n === 2 ? 76 : n <= 4 ? 58 : 44);
  return { dense, rows, columns, name, price: name * (family === "editorial" ? 0.82 : 0.88) };
}
