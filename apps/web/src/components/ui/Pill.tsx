import type { HTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  /** solid = fond `fill` bordé · out = contour, texte mut. */
  variant?: "solid" | "out";
};

/**
 * Pilule d'étiquette (spec backoffice §4.4) : Inter 600 uppercase 10px.
 * Les couleurs sémantiques se posent via className (ex. bg-gold text-ongold).
 *
 * Le filet d'encre à 12 % du variant plein n'est pas décoratif : la pilule
 * vaut le niveau « élément » (`fill`) et se pose aussi bien sur une carte
 * (`surface`) que sur une tuile de ce même niveau (carte membre de l'Équipe,
 * tuile de promo). Sans lui, elle disparaîtrait dans son support — deux
 * surfaces adjacentes ne portent jamais la même valeur (DA §1). Même
 * épaisseur que le variant contour : les deux variants s'alignent au pixel
 * côte à côte.
 */
export function Pill({ variant = "solid", className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] tabular-nums",
        variant === "out"
          ? "border-line bg-transparent text-mut"
          : "border-ink/12 bg-fill text-onfill",
        className,
      )}
      {...rest}
    />
  );
}
