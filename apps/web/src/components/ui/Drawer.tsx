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
 * le <main> du shell admin, est `position: relative`) : overlay brun 35 %,
 * panneau droit 400px bord gauche 2px blanc, animation pop .18s.
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
    <div
      className="absolute inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={label ?? (typeof title === "string" ? title : "Panneau")}
    >
      <div
        className="absolute inset-0 bg-[rgba(28,22,18,0.35)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-y-0 right-0 flex max-w-full animate-pop flex-col border-l-2 border-white bg-surface"
        style={{ width }}
      >
        <div
          className={cx(
            "flex shrink-0 items-center justify-between gap-3 border-b border-line px-[18px] py-3.5",
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
          <div className="shrink-0 border-t border-line px-[18px] py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
