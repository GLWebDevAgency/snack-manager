"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";

type IconBtnProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  icon: IconName;
  /** Libellé accessible (aria-label + tooltip natif). */
  label: string;
  /** Côté du bouton en px (défaut 40). */
  size?: number;
  iconSize?: number;
};

/**
 * Bouton icône rond (spec backoffice §4.2) : 40px pilule, niveau « élément »
 * (`--cf-elev-gradient`), appui enfoncé (DA §4).
 *
 * Le bord n'est plus « 1px blanc 10 % » mais `--cf-line`, l'ENCRE du
 * restaurant à 12 % : un filet clair sur une peau sombre, sombre sur une peau
 * claire. Au survol il se raffermit (`border-ink/40`) et le fond passe au
 * dégradé de survol (`--cf-elev-hover`) — deux jetons, donc deux valeurs que
 * le masque repeint.
 */
export function IconBtn({
  icon,
  label,
  size = 40,
  iconSize = 18,
  className,
  type = "button",
  ...rest
}: IconBtnProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cx(
        "cf-press inline-flex shrink-0 items-center justify-center rounded-pill border border-line bg-[image:var(--cf-elev-gradient)] text-ink",
        "hover:border-ink/40 hover:bg-[image:var(--cf-elev-hover)]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
