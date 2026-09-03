"use client";

import type { CSSProperties } from "react";
import { hexVersRgb, ratioContraste, type ScreenTheme } from "@sm/contracts";

/**
 * Marque grise : le seul levier de personnalisation d'un écran est la couleur
 * d'accent du restaurant. Tout le reste — noirs stratifiés, typographie,
 * rayons, vert / rouge / ambre fonctionnels — est commun à tous les comptes.
 */

const DEFAULT_ACCENT = "#c9a15a";
/** L'encre sombre de la charte — un noir teinté, jamais le noir pur. */
const ENCRE_SOMBRE = "#12100d";
const ENCRE_CLAIRE = "#ffffff";

/**
 * Le sélecteur de l'admin accepte la forme courte (`#ca8`), que le contrat
 * refuse — il ne connaît que `#rrggbb`. L'expansion se fait donc ici, à la
 * frontière, et le contrat fait le reste.
 */
function normaliser(input: string | null | undefined): string | null {
  if (!input) return null;
  const hex = input.trim().toLowerCase().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : null;
}

/**
 * Texte lisible sur l'accent — PAR CONTRASTE RÉEL, jamais par un seuil.
 *
 * Sur le laiton par défaut, du blanc tombe à ~2,4:1 — illisible à trois
 * mètres. Le seuil de luminance `> 0,42` qui décidait ici se trompe de pôle
 * pour toute luminance entre ~0,18 et 0,5 : le croisement réel des deux
 * ratios WCAG est à 0,179, et un accent moyen recevait donc l'encre la moins
 * lisible des deux. `ratioContraste` vient du contrat, comme partout ailleurs
 * dans le produit.
 */
function readableOn(hex: string): string {
  return ratioContraste(ENCRE_SOMBRE, hex) >= ratioContraste(ENCRE_CLAIRE, hex)
    ? ENCRE_SOMBRE
    : ENCRE_CLAIRE;
}

export interface BoardPalette extends CSSProperties {
  "--bd-accent": string;
  "--bd-on-accent": string;
  "--bd-accent-12": string;
  "--bd-accent-24": string;
}

/**
 * Variables CSS de la marque, posées sur la racine de l'écran.
 *
 * Les tons translucides sont calculés ici en `rgba()` plutôt qu'avec
 * `color-mix()` : les navigateurs des clés HDMI et des Smart TV d'entrée de
 * gamme ne le connaissent pas, et une couleur non résolue donnerait un accent
 * transparent — donc invisible.
 */
export function boardPalette(accent?: string | null, theme?: ScreenTheme): BoardPalette {
  // Les thèmes « dark » et « light » du back-office ne changent pas la teinte
  // de marque : ils décideront de la valeur de fond. L'écran de salle reste sur
  // le noir profond, seul fond qui tienne face à un néon de comptoir.
  const teinte = (theme === "dark" ? null : normaliser(accent)) ?? DEFAULT_ACCENT;
  const [r, g, b] = hexVersRgb(teinte);
  return {
    "--bd-accent": `rgb(${r}, ${g}, ${b})`,
    "--bd-on-accent": readableOn(teinte),
    "--bd-accent-12": `rgba(${r}, ${g}, ${b}, 0.12)`,
    "--bd-accent-24": `rgba(${r}, ${g}, ${b}, 0.26)`,
  };
}

/** Monogramme de repli quand le restaurant n'a pas encore de logo. */
export function monogramOf(name: string): string {
  const words = name.trim().split(/[\s'’-]+/).filter(Boolean);
  if (words.length === 0) return "SM";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
