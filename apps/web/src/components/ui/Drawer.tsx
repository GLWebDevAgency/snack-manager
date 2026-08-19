"use client";

import { useEffect, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { IconBtn } from "./IconBtn";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Titre de l'en-tête (18px). Sans titre, passer un aria-label via `label`. */
  title?: ReactNode;
  /** Libellé accessible si pas de titre textuel. */
  label?: string;
  children: ReactNode;
  /** Largeur du panneau (défaut 400 — spec backoffice §6.4). */
  width?: number;
  /** Pied fixe optionnel (boutons d'action). */
  footer?: ReactNode;
};

/**
 * Tiroir latéral — positionné en ABSOLU dans la zone de contenu (le parent,
 * le <main> du shell admin, est `position: relative`).
 * Profondeur (DA §1) : voile noir, panneau de niveau 2 en dégradé, séparation
 * portée par l'ombre (filet blanc 8 %) plutôt que par un bord blanc dur.
 */
export function Drawer({
  open,
  onClose,
  title,
  label,
  children,
  width = 400,
  footer,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    /**
     * `fixed`, et non `absolute`.
     *
     * En absolu, le tiroir se cale sur la ZONE DE CONTENU, qui défile et peut
     * mesurer plusieurs milliers de pixels : ouvert depuis le bas d'une longue
     * liste de commandes, il s'ancrait en haut du contenu et sortait de
     * l'écran. En fixe, il suit toujours la fenêtre.
     *
     * Le décalage à gauche préserve l'intention de la maquette (§6.4) : le
     * rail de navigation reste visible et cliquable, le tiroir ne recouvre que
     * la zone de travail. Il tombe à zéro sous 640 px, où l'espace manque.
     */
    <div
      className="fixed inset-y-0 right-0 left-0 z-50 sm:left-[66px]"
      role="dialog"
      aria-modal="true"
      aria-label={label ?? (typeof title === "string" ? title : "Panneau")}
    >
      <div
        className="absolute inset-0 animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/55"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-y-0 right-0 flex max-w-full animate-[cf-slide-in_.28s_var(--sm-ease)_both] flex-col rounded-l-panel bg-[image:var(--cf-card-gradient)] shadow-[var(--cf-shadow-drawer)]"
        style={{ width }}
      >
        <div
          className={cx(
            "flex shrink-0 items-center justify-between gap-3 border-b border-line2 px-[18px] py-3.5",
            !title && "border-b-0 pb-0",
          )}
        >
          {title && (
            <h2 className="min-w-0 truncate text-lg font-semibold tracking-[-0.03em] text-ink">
              {title}
            </h2>
          )}
          <IconBtn
            icon="close"
            label="Fermer"
            size={32}
            iconSize={16}
            onClick={onClose}
            className="ml-auto"
          />
        </div>
        <div className="cf-scroll min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line2 bg-black/25 px-[18px] py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
