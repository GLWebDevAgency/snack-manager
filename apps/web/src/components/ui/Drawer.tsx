"use client";

import { useId, type ReactNode, type RefObject } from "react";
import { cx } from "@/lib/cx";
import { IconBtn } from "./IconBtn";
import { useDialogLayer } from "./useDialogLayer";

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
  /** Cible de focus prioritaire à l'ouverture (optionnelle). */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Tiroir latéral — positionné en fixe dans la fenêtre pour rester utilisable
 * quelle que soit la position de défilement du contenu.
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
  initialFocusRef,
}: DrawerProps) {
  const titleId = useId();
  const dialogRef = useDialogLayer({ open, onClose, initialFocusRef });

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
     * rail de navigation reste visible, tandis que `inert` le neutralise tant
     * que le dialogue modal est ouvert. Il tombe à zéro sous 640 px.
     */
    <div
      ref={dialogRef}
      inert
      tabIndex={-1}
      className="fixed inset-y-0 right-0 left-0 z-50 outline-none sm:left-[66px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? (label ?? "Panneau") : undefined}
    >
      <div
        className="absolute inset-0 animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/55 motion-reduce:animate-none"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-y-0 right-0 flex max-w-full animate-[cf-slide-in_.28s_var(--sm-ease)_both] flex-col rounded-l-panel bg-[image:var(--cf-card-gradient)] shadow-[var(--cf-shadow-drawer)] motion-reduce:animate-none"
        style={{ width }}
      >
        <div
          className={cx(
            "flex shrink-0 items-center justify-between gap-3 border-b border-line2 px-[18px] py-3.5",
            !title && "border-b-0 pb-0",
          )}
        >
          {title && (
            <h2
              id={titleId}
              className="min-w-0 truncate text-lg font-semibold tracking-[-0.03em] text-ink"
            >
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
        <div
          data-dialog-content
          className="cf-scroll min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
        {footer && (
          <div
            data-dialog-footer
            className="shrink-0 border-t border-line2 bg-black/25 px-[18px] py-3.5"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
