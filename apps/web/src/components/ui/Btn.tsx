"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = accent tenant (1 max/écran) · ink = fond btn · ghost contour ·
   *  gold fixe · danger/success = verdicts rouge/vert des confirmations. */
  variant?: "primary" | "ink" | "ghost" | "gold" | "danger" | "success";
  size?: "md" | "sm";
  /** Pleine largeur. */
  block?: boolean;
  /** Icône à gauche / à droite (18px, 15px en taille sm). */
  icon?: IconName;
  iconRight?: IconName;
};

const VARIANTS: Record<NonNullable<BtnProps["variant"]>, string> = {
  primary: "bg-accent text-onaccent shadow-card hover:opacity-85",
  // Même survol que primary/gold/danger/success — mode-agnostique : `bg-btn`
  // s'inverse en clair (btn = fill = ink chez le résolveur) et assombrit
  // l'admin (#262626 → #1a1a1a, l'inverse du `#333` d'origine).
  ink: "bg-btn text-onfill hover:opacity-85",
  ghost:
    "border border-line bg-ink/3 text-ink hover:border-ink/25 hover:bg-ink/8",
  gold: "bg-gold text-ongold shadow-card hover:opacity-85",
  // Verdicts des confirmations (« Suspendre l'accès », « Rouvrir l'accès ») :
  // les points d'appel écrasaient le fond du variant primary via className —
  // un conflit que Tailwind tranche par l'ordre de la feuille, pas des classes.
  danger: "bg-alert text-onalert shadow-card hover:opacity-85",
  success: "bg-ok text-onok shadow-card hover:opacity-85",
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
