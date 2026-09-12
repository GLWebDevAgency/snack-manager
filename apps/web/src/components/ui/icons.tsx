/**
 * Bibliothèque d'icônes du design system — SVG 24×24, tracés `stroke`
 * (linecap/linejoin round), stroke-width 2 par défaut, `currentColor`,
 * `aria-hidden` (spec backoffice-restaurant §4.13).
 */

import type { SVGAttributes } from "react";
import { shapes, iconNames, legacyIconAliases, resolveIconName, type IconName as DesignIconName } from "@sm/design-icons";

const PATHS = {
  navigation: ["M3 11l19-9-9 19-2-8-8-2z"],
  message: ["M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"],
  home: ["M3 10.5 12 3l9 7.5", "M5.5 9v12h13V9", "M10 21v-6h4v6"],
  play: ["M8 5v14l11-7z"],
  pause: ["M8 5v14", "M16 5v14"],
  euro: ["M17.5 6a7 7 0 1 0 0 12", "M4.5 10.4h9", "M4.5 13.6h8"],
  cart: [
    "M3 4h2.2L7.5 16.5h11L21 8H6",
    "M9.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    "M16.5 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  ],
  trash: ["M4 7h16", "M9.5 7V4h5v3", "m6 7 1 14h10l1-14", "M10 11v6", "M14 11v6"],
} as const;

export type IconName = keyof typeof PATHS | keyof typeof legacyIconAliases | DesignIconName;

export const ICON_NAMES = [...new Set<IconName>([...Object.keys(PATHS) as (keyof typeof PATHS)[], ...Object.keys(legacyIconAliases) as (keyof typeof legacyIconAliases)[], ...iconNames])];

type IconProps = Omit<SVGAttributes<SVGSVGElement>, "children" | "stroke"> & {
  name: IconName;
  /** Taille rendue en px (défaut 18). */
  size?: number;
  /** Épaisseur du trait (défaut 2 ; 2.3 pour l'item de nav actif). */
  stroke?: number;
};

export function Icon({ name, size = 18, stroke = 1.75, ...rest }: IconProps) {
  // Seul le registre de vecteurs versionnés peut produire ce fragment SVG.
  // Les anciennes clés sans équivalent gardent leur dessin et leur sémantique.
  const canonical = resolveIconName(name);
  const shape = canonical ? shapes[canonical] : undefined;
  const legacy = Object.hasOwn(PATHS, name) ? PATHS[name as keyof typeof PATHS] : [];
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
      {...(shape
        ? { dangerouslySetInnerHTML: { __html: shape } }
        : { children: legacy.map((d) => <path key={d} d={d} />) })}
    />
  );
}
