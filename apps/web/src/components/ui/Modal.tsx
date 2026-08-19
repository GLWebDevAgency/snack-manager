"use client";

import { useEffect, type ReactNode } from "react";
import { IconBtn } from "./IconBtn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Boutons d'action (alignés à droite). */
  footer?: ReactNode;
  /**
   * Modale destructive (« Supprimer… ») : le clic sur l'overlay et Échap ne
   * ferment PAS — fermeture explicite uniquement (croix ou bouton Annuler).
   */
  destructive?: boolean;
  /** Largeur max du panneau (défaut 440). */
  width?: number;
};

/**
 * Modale (règle DS : « Danger réservé aux destructions avec confirmation ») —
 * overlay noir 60 % z-60, panneau carte gradient, animation pop.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  destructive = false,
  width = 440,
}: ModalProps) {
  useEffect(() => {
    if (!open || destructive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, destructive, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid animate-[cf-fade_.22s_var(--sm-ease)_both] place-items-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onClick={() => {
        if (!destructive) onClose();
      }}
    >
      <div
        className="w-full animate-pop rounded-panel border border-white/10 bg-[image:var(--cf-card-gradient)] p-5 shadow-deep"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-lg font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h2>
          <IconBtn
            icon="close"
            label="Fermer"
            size={32}
            iconSize={16}
            onClick={onClose}
          />
        </div>
        <div className="text-sm text-ink">{children}</div>
        {footer && (
          <div className="mt-5 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
