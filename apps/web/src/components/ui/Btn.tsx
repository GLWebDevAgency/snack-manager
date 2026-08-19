"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = accent tenant (1 max/écran) · ink #262626 · ghost contour · gold fixe. */
  variant?: "primary" | "ink" | "ghost" | "gold";
  size?: "md" | "sm";
  /** Pleine largeur. */
  block?: boolean;
  /** Icône à gauche / à droite (18px, 15px en taille sm). */
  icon?: IconName;
  iconRight?: IconName;
};

const VARIANTS: Record<NonNullable<BtnProps["variant"]>, string> = {
  primary: "bg-accent text-onaccent shadow-card hover:opacity-85",
  ink: "bg-btndark text-white hover:bg-[#333]",
  ghost:
    "border border-line bg-white/3 text-white hover:border-white/25 hover:bg-white/8",
  gold: "bg-gold text-[#1C1612] shadow-card hover:opacity-85",
};

/**
 * Bouton du design system (spec backoffice §4.1) : pilule, Inter 600.
 * Retour tactile (DA §4) : léger enfoncement `scale(.97)` + variation de fond,
 * perçu sous les 100 ms grâce à l'ease `cubic-bezier(.2,.8,.2,1)`.
 */
export function Btn({
  variant = "primary",
  size = "md",
  block = false,
  icon,
  iconRight,
  className,
  children,
  type = "button",
  ...rest
}: BtnProps) {
  const iconSize = size === "sm" ? 15 : 18;
  return (
    <button
      type={type}
      className={cx(
        block ? "flex w-full" : "inline-flex",
        "cf-press items-center justify-center gap-[9px] whitespace-nowrap rounded-pill font-bold tracking-[-0.01em]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-3.5 py-[9px] text-[13px]" : "px-5 py-[13px] text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}
