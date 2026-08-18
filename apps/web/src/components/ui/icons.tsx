/**
 * Bibliothèque d'icônes du design system — SVG 24×24, tracés `stroke`
 * (linecap/linejoin round), stroke-width 2 par défaut, `currentColor`,
 * `aria-hidden` (spec backoffice-restaurant §4.13).
 */

import type { SVGAttributes } from "react";

const PATHS = {
  home: ["M3 10.5 12 3l9 7.5", "M5.5 9v12h13V9", "M10 21v-6h4v6"],
  ticket: [
    "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z",
    "M14 6v2",
    "M14 11v2",
    "M14 16v2",
  ],
  grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  tag: [
    "M12.6 2.6H3.5a1 1 0 0 0-1 1v9.1a1 1 0 0 0 .3.7l8.8 8.8a1 1 0 0 0 1.4 0l9.1-9.1a1 1 0 0 0 0-1.4L13.3 2.9a1 1 0 0 0-.7-.3z",
    "M7.5 7.5h.01",
  ],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  chart: ["M3 20h18", "M6.5 20v-7", "M11.5 20V5", "M16.5 20v-10", "M21 20v-4"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"],
  star: [
    "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  ],
  check: ["m4 12.5 5 5L20 6.5"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  bell: [
    "M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6",
    "M10 19.5a2.3 2.3 0 0 0 4 0",
  ],
  gear: [
    "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
    "M12 2.5v2.6",
    "M12 18.9v2.6",
    "M2.5 12h2.6",
    "M18.9 12h2.6",
    "m5.3 5.3 1.8 1.8",
    "m16.9 16.9 1.8 1.8",
    "m18.7 5.3-1.8 1.8",
    "m7.1 16.9-1.8 1.8",
  ],
  back: ["m15 5-7 7 7 7"],
  arrow: ["m9 5 7 7-7 7"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  phone: [
    "M5 4h4l2 5-2.5 1.5a12.5 12.5 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z",
  ],
  euro: ["M17.5 6a7 7 0 1 0 0 12", "M4.5 10.4h9", "M4.5 13.6h8"],
  cart: [
    "M3 4h2.2L7.5 16.5h11L21 8H6",
    "M9.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    "M16.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  ],
  fries: [
    "m7 10 1.4 10.5h7.2L17 10",
    "M5.5 10h13",
    "M9 9.5V4",
    "M12 9.5V3",
    "M15 9.5V4",
  ],
  print: [
    "M7 8V3h10v5",
    "M17 15.5h4v-5.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5.5h4",
    "M7 13h10v8H7z",
  ],
  trash: ["M4 7h16", "M9.5 7V4h5v3", "m6 7 1 14h10l1-14", "M10 11v6", "M14 11v6"],
  edit: ["M4 20l1.2-4.2L16.6 4.4a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8z", "m14.5 6.5 3 3"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m16.2 16.2 4.8 4.8"],
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

type IconProps = Omit<SVGAttributes<SVGSVGElement>, "children" | "stroke"> & {
  name: IconName;
  /** Taille rendue en px (défaut 18). */
  size?: number;
  /** Épaisseur du trait (défaut 2 ; 2.3 pour l'item de nav actif). */
  stroke?: number;
};

export function Icon({ name, size = 18, stroke = 2, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
