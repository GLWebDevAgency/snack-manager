"use client";

import type { CSSProperties } from "react";
import type { ScreenTheme } from "@sm/contracts";

/**
 * Marque grise : le seul levier de personnalisation d'un écran est la couleur
 * d'accent du restaurant. Tout le reste — noirs stratifiés, typographie,
 * rayons, vert / rouge / ambre fonctionnels — est commun à tous les comptes.
 */

const DEFAULT_ACCENT = "#c9a15a";

function parseHex(input: string | null | undefined): [number, number, number] | null {
  if (!input) return null;
  const hex = input.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Luminance relative WCAG — sert à choisir le texte posé SUR l'accent. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Texte lisible sur l'accent.
 *
 * Sur le laiton par défaut, du blanc tombe à ~2,4:1 — illisible à trois mètres.
 * On bascule sur un noir teinté dès que l'accent est clair, exactement comme
 * le back-office et la caisse.
 */
function readableOn(rgb: [number, number, number]): string {
  return luminance(rgb) > 0.42 ? "#12100d" : "#ffffff";
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
  const rgb = (theme === "dark" ? null : parseHex(accent)) ?? parseHex(DEFAULT_ACCENT)!;
  const [r, g, b] = rgb;
  return {
    "--bd-accent": `rgb(${r}, ${g}, ${b})`,
    "--bd-on-accent": readableOn(rgb),
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
