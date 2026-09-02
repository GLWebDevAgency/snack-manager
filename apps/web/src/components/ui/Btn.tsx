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

/*
 * ── LE SURVOL CHANGE LE FOND, JAMAIS L'OPACITÉ DU BOUTON ────────────────────
 *
 * `hover:opacity-85` rendait le bouton ENTIER translucide : le navigateur
 * compose alors le groupe (aplat + libellé) sur la page, si bien que le fond
 * ET le texte se mélangent au fond de page dans la même proportion. Le couple
 * qui portait l'AA se déforme donc au survol — et WCAG 1.4.3 vaut pour TOUS
 * les états. Mesuré sur les six directions + l'admin : Marché primary 3,64,
 * Atelier primary 4,05, danger 4,19–4,49 partout, success 4,43–4,48 sur les
 * trois masques clairs. Le survol effaçait l'accessibilité de l'aplat.
 *
 * Deux règles, parce qu'une seule ne tient pas :
 *
 * 1. ACCENT → `--cf-accent-hover`, le jeton que le résolveur calcule déjà pour
 *    ça (accent éclairci de 8 % en sombre, assombri de 8 % en clair) et que
 *    personne ne lisait. Le couple onAccent/accentHover mesure au minimum
 *    5,25:1 (Soleil) sur les six directions et 10,26 en admin.
 *
 * 2. APLATS FIXES (btn, laiton, rouge, vert) → l'aplat glisse de 8 % vers le
 *    FOND DE PAGE, pendant que le libellé, lui, ne bouge pas. Vers l'ENCRE
 *    (la règle de l'accent) ces quatre-là passeraient SOUS le plancher : le
 *    rouge sombre et le vert clair sortent du résolveur avec 4,60 et 4,82 de
 *    marge, et 8 % d'encre les ramènent à 4,09 et 4,31. Vers le fond, le
 *    minimum relevé est 5,05 (danger sur Marché).
 *    Effet de bord voulu : sur une page sombre — l'admin — glisser vers le
 *    fond assombrit, exactement ce que faisait l'ancienne opacité.
 *
 * `color-mix()` et non un jeton de plus : ces quatre aplats ne sont pas
 * tenants, leur survol n'a donc rien à faire dans le contrat du masque.
 */
const VARIANTS: Record<NonNullable<BtnProps["variant"]>, string> = {
  primary: "bg-accent text-onaccent shadow-card hover:bg-accenthover",
  // `bg-btn` s'inverse en clair (btn = ink chez le résolveur) : le survol suit
  // la même bascule, puisqu'il se calcule depuis `--cf-btn` et le fond de page.
  ink: "bg-btn text-onfill hover:bg-[color:color-mix(in_srgb,var(--cf-btn)_92%,var(--cf-bg))]",
  ghost:
    "border border-line bg-ink/3 text-ink hover:border-ink/25 hover:bg-ink/8",
  gold: "bg-gold text-ongold shadow-card hover:bg-[color:color-mix(in_srgb,var(--cf-gold)_92%,var(--cf-bg))]",
  // Verdicts des confirmations (« Suspendre l'accès », « Rouvrir l'accès ») :
  // les points d'appel écrasaient le fond du variant primary via className —
  // un conflit que Tailwind tranche par l'ordre de la feuille, pas des classes.
  danger:
    "bg-alert text-onalert shadow-card hover:bg-[color:color-mix(in_srgb,var(--cf-red)_92%,var(--cf-bg))]",
  success:
    "bg-ok text-onok shadow-card hover:bg-[color:color-mix(in_srgb,var(--cf-green)_92%,var(--cf-bg))]",
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
