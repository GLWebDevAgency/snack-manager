import type { HTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type PillProps = HTMLAttributes<HTMLSpanElement> & {
  /** solid = fond `fill` bordé · out = contour, texte mut. */
  variant?: "solid" | "out";
};

/**
 * LA COULEUR D'UNE PILULE EST UN COUPLE — le fond et l'encre voyagent ensemble.
 *
 * Le composant posait `bg-fill text-onfill` en base ET laissait l'appelant
 * envoyer `bg-ok/10 text-okt` par className. `cx` concatène : c'est l'ordre
 * dans la FEUILLE qui tranche, pas l'ordre des classes. Selon la place des
 * deux règles après compilation, la pilule sortait avec le fond de l'appelant
 * et l'encre de la base — texte `onfill` sur un lavis vert, sous les 4,5:1 —
 * ou l'inverse. Le même piège que `widthClass` documente dans `fields.tsx`.
 *
 * Dès que l'appelant pose un fond, il possède le couple entier : la base se
 * retire au lieu de se battre. Une pilule qui n'envoie qu'une taille ou une
 * marge garde ses couleurs de variant.
 */
const posSonFond = (className?: string) => /(^|\s)!?bg-/.test(className ?? "");

/**
 * Pilule d'étiquette (spec backoffice §4.4) : Inter 600 uppercase 10px.
 * Les couleurs sémantiques se posent via className, en couple (ex. `bg-gold
 * text-ongold`).
 *
 * Le filet d'encre à 12 % du variant plein n'est pas décoratif : la pilule
 * vaut le niveau « élément » (`fill`) et se pose aussi bien sur une carte
 * (`surface`) que sur une tuile de ce même niveau (carte membre de l'Équipe,
 * tuile de promo). Sans lui, elle disparaîtrait dans son support — deux
 * surfaces adjacentes ne portent jamais la même valeur (DA §1). Même
 * épaisseur que le variant contour : les deux variants s'alignent au pixel
 * côte à côte. La bordure survit à une surcharge de couleur, elle : c'est
 * elle qui donne au variant sa forme, pas sa teinte.
 */
export function Pill({ variant = "solid", className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pill border-[1.5px] px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] tabular-nums",
        variant === "out" ? "border-line" : "border-ink/12",
        !posSonFond(className) &&
          (variant === "out" ? "bg-transparent text-mut" : "bg-fill text-onfill"),
        className,
      )}
      {...rest}
    />
  );
}
