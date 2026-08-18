import type { HTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  /** solid = fond #1a1a1a · out = contour, texte #999. */
  variant?: "solid" | "out";
};

/**
 * Pilule d'étiquette (spec backoffice §4.4) : Inter 600 uppercase 10px.
 * Les couleurs sémantiques se posent via className (ex. bg-gold text-[#1C1612]).
 */
export function Pill({ variant = "solid", className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]",
        variant === "out"
          ? "border-[1.5px] border-line bg-transparent text-mut"
          : "bg-fill text-onfill",
        className,
      )}
      {...rest}
    />
  );
}
