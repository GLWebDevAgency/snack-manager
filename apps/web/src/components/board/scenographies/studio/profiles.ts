import type { Scenography, ScreenOrientation } from "@sm/contracts";

export type StudioPreset = Exclude<Scenography, "ardoise" | "comptoir">;
export type StudioFamily = "poster" | "gallery" | "editorial";
export interface StudioProfile {
  family: StudioFamily;
  layout: "split" | "center" | "stage" | "panels" | "wide" | "alternating" | "sidebar" | "columns" | "manifesto" | "frames" | "horizon" | "facets" | "ribbon";
  atmosphere: "spotlight" | "orbit" | "curtain" | "daylight" | "pan" | "planes" | "diagonal" | "vertical" | "type" | "trace" | "aurora" | "prism" | "ribbon";
  entrance: "rise" | "reveal" | "slide";
  /** A short, authored reading order; even the last price is settled early. */
  story: string;
  beats: { photo: number; name: number; detail: number; price: number };
  camera: "push" | "glide" | "rise" | "still";
}

/** Geometry, continuous movement and entrance are authored together, never as colour variants. */
export const STUDIO_PROFILES = {
  affiche: { family: "poster", layout: "split", atmosphere: "spotlight", entrance: "rise", story: "poster-billing", beats: { photo: 0, name: 2, detail: 4, price: 6 }, camera: "push" },
  halo: { family: "poster", layout: "center", atmosphere: "orbit", entrance: "reveal", story: "orbital-focus", beats: { photo: 0, name: 3, detail: 4, price: 5 }, camera: "push" },
  premiere: { family: "poster", layout: "stage", atmosphere: "curtain", entrance: "slide", story: "curtain-call", beats: { photo: 1, name: 3, detail: 5, price: 6 }, camera: "still" },
  galerie: { family: "gallery", layout: "panels", atmosphere: "daylight", entrance: "reveal", story: "gallery-hang", beats: { photo: 0, name: 2, detail: 3, price: 5 }, camera: "push" },
  panorama: { family: "gallery", layout: "wide", atmosphere: "pan", entrance: "slide", story: "tracking-shot", beats: { photo: 0, name: 2, detail: 4, price: 5 }, camera: "glide" },
  decoupe: { family: "gallery", layout: "alternating", atmosphere: "planes", entrance: "rise", story: "alternating-cut", beats: { photo: 0, name: 2, detail: 4, price: 6 }, camera: "still" },
  editorial: { family: "editorial", layout: "sidebar", atmosphere: "diagonal", entrance: "slide", story: "editorial-lead", beats: { photo: 3, name: 1, detail: 3, price: 5 }, camera: "glide" },
  colonne: { family: "editorial", layout: "columns", atmosphere: "vertical", entrance: "rise", story: "column-cadence", beats: { photo: 3, name: 0, detail: 2, price: 4 }, camera: "rise" },
  manifeste: { family: "editorial", layout: "manifesto", atmosphere: "type", entrance: "reveal", story: "type-declaration", beats: { photo: 0, name: 0, detail: 2, price: 4 }, camera: "still" },
  contour: { family: "gallery", layout: "frames", atmosphere: "trace", entrance: "reveal", story: "frame-signature", beats: { photo: 1, name: 3, detail: 4, price: 6 }, camera: "push" },
  aurore: { family: "poster", layout: "horizon", atmosphere: "aurora", entrance: "rise", story: "daybreak", beats: { photo: 0, name: 2, detail: 4, price: 6 }, camera: "rise" },
  prisme: { family: "gallery", layout: "facets", atmosphere: "prism", entrance: "slide", story: "facet-assembly", beats: { photo: 0, name: 2, detail: 4, price: 5 }, camera: "still" },
  ruban: { family: "editorial", layout: "ribbon", atmosphere: "ribbon", entrance: "slide", story: "ribbon-seal", beats: { photo: 0, name: 1, detail: 3, price: 5 }, camera: "glide" },
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
