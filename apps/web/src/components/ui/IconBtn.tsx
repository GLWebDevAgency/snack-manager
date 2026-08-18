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
 * Bouton icône rond (spec backoffice §4.2) : 40px pilule, fond #1a1a1a,
 * bord 1px blanc 10 %, hover bord blanc 50 %.
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
        "inline-flex shrink-0 items-center justify-center rounded-pill border border-line bg-surface2 text-ink transition-colors duration-200 ease-sm",
        "hover:border-white/50",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
