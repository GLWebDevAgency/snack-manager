"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** État actif du filtre. */
  on?: boolean;
};

/**
 * Chip de filtre (spec backoffice §4.3) : pilule fond blanc 6 %, texte #999,
 * hover texte blanc + fond éclairci, actif blanc sur bord clair.
 * Retour tactile immédiat à l'appui (DA §4).
 */
export function Chip({
  on = false,
  className,
  children,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={on}
      className={cx(
        // Graisse identique dans les deux états : bascule sans saut de largeur.
        "cf-press inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 py-[7px] text-[13px] font-semibold",
        on
          ? "border-white/55 bg-white/12 text-white"
          : "border-transparent bg-white/6 text-mut hover:bg-white/10 hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
