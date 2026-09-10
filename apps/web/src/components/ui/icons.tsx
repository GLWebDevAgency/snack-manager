/**
 * Bibliothèque d'icônes du design system — SVG 24×24, tracés `stroke`
 * (linecap/linejoin round), stroke-width 2 par défaut, `currentColor`,
 * `aria-hidden` (spec backoffice-restaurant §4.13).
 */

import type { SVGAttributes } from "react";

const PATHS = {
  pin: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0zM12 13a3 3 0 100-6 3 3 0 000 6z"],
  navigation: ["M3 11l19-9-9 19-2-8-8-2z"],
  route: ["M4 19a3 3 0 100-6 3 3 0 000 6zM20 11a3 3 0 100-6 3 3 0 000 6zM6.5 16.5L17.5 7.5"],
  qr: ["M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM18 18h3v3h-3z"],
  message: ["M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"],
  bag: ["M6 2l-3 5v13a2 2 0 002 2h14a2 2 0 002-2V7l-3-5zM3 7h18M16 11a4 4 0 01-8 0"],
  sun: ["M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"],
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
  gift: [
    "M4 10h16v11H4z",
    "M2.5 6.5h19V10h-19z",
    "M12 6.5V21",
    "M12 6.5H8.6a2.1 2.1 0 1 1 2.1-2.1c0 1.4 1.3 2.1 1.3 2.1z",
    "M12 6.5h3.4a2.1 2.1 0 1 0-2.1-2.1c0 1.4-1.3 2.1-1.3 2.1z",
  ],
  check: ["m4 12.5 5 5L20 6.5"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  bell: [
    "M18 9a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6",
    "M10 19.5a2.3 2.3 0 0 0 4 0",
  ],
  // Un vrai rouage À DENTS : l'ancien tracé (cercle + huit rayons) se lisait
  // comme un soleil — donc comme un bouton de thème clair/sombre, pas comme
  // des réglages. Constat du fondateur, 24/08/2026.
  gear: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
  ],
  // Déconnexion : la porte et la flèche qui en sort — le chevron « retour »
  // qu'elle remplace se lisait comme une navigation, pas comme une sortie.
  logout: [
    "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
    "m16 17 5-5-5-5",
    "M21 12H9",
  ],
  back: ["m15 5-7 7 7 7"],
  arrow: ["m9 5 7 7-7 7"],
  play: ["M8 5v14l11-7z"],
  pause: ["M8 5v14", "M16 5v14"],
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
  truck: ["M3 5h11v12H3z", "M14 9h4l3 4v4h-7", "M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
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
  // L'enveloppe : l'e-mail, comme donnée ou comme geste d'envoi. Le crayon
  // « edit » en tenait lieu et se lisait « modifier ce champ ».
  mail: [
    "M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5z",
    "m3.5 7.5 8.5 6 8.5-6",
  ],
  // Le triangle d'alerte : les incidents. « Erreurs » portait un rouage, qui
  // se lisait comme des réglages — et le même rouage servait déjà trois sens.
  alert: [
    "M10.3 4.6 2.7 17.8a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z",
    "M12 9.5V14",
    "M12 17.5h.01",
  ],
  tv: [
    "M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z",
    "M12 16.5v4",
    "M8.5 20.5h7",
  ],
  // Le cadenas FERMÉ : une fonction du produit que le restaurant n'a pas
  // souscrite. Il ne signale JAMAIS un manque de droit — une porte fermée à un
  // rôle n'est pas montrée du tout, elle est absente de la barre. Ici l'écran
  // reste visible exprès : on ne vend pas ce qu'on cache.
  lock: [
    "M5.5 10.5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
    "M8 10.5V7a4 4 0 0 1 8 0v3.5",
  ],
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
