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
 * Bouton icône rond (spec backoffice §4.2) : 40px pilule, niveau « élément »,
 * bord 1px blanc 10 %, hover bord clair + fond éclairci, appui enfoncé (DA §4).
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
        "hover:border-white/40 hover:bg-[image:var(--cf-elev-hover)]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
