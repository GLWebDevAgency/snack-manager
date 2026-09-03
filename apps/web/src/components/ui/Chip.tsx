"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** État actif du filtre. */
  on?: boolean;
};

/**
 * Chip de filtre (spec backoffice §4.3) : pilule fond encre à 6 %, texte mut,
 * hover texte encre + fond éclairci, actif encre sur bord clair — l'encre
 * suit le mode, jamais un blanc qui disparaîtrait sur fond clair.
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
          ? "border-ink/55 bg-ink/12 text-ink"
          : "border-transparent bg-ink/6 text-mut hover:bg-ink/10 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
