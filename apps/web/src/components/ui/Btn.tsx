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
  primary: "bg-accent text-onaccent hover:opacity-85",
  ink: "bg-btndark text-white hover:opacity-85",
  ghost: "border border-line bg-transparent text-white hover:bg-white/6",
  gold: "bg-gold text-[#1C1612] hover:opacity-85",
};

/**
 * Bouton du design system (spec backoffice §4.1) : pilule, Inter 600,
 * hover opacity .85, pressed translateY(1px), disabled opacity .4.
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
        "items-center justify-center gap-[9px] whitespace-nowrap rounded-pill font-semibold tracking-[-0.2px] transition-[opacity,background-color,transform] duration-200 ease-sm",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0",
        size === "sm" ? "px-3.5 py-[9px] text-xs" : "px-5 py-[13px] text-sm",
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
