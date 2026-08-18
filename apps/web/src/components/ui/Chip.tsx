"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** État actif du filtre. */
  on?: boolean;
};

/**
 * Chip de filtre (spec backoffice §4.3) : pilule fond blanc 6 %, texte #999,
 * hover texte blanc, actif texte blanc + bord blanc 50 %.
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
        "inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-pill border bg-white/6 px-3.5 py-[7px] text-[13px] font-medium transition-colors duration-200 ease-sm",
        on
          ? "border-white/50 text-white"
          : "border-transparent text-mut hover:text-white",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
