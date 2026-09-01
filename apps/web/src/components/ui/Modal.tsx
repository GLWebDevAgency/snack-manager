"use client";

import { useCallback, useId, type ReactNode, type RefObject } from "react";
import { IconBtn } from "./IconBtn";
import { useDialogLayer } from "./useDialogLayer";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Boutons d'action (alignés à droite). */
  footer?: ReactNode;
  /**
   * Modale destructive (« Supprimer… ») : ni l'overlay ni Échap ne ferment la
   * fenêtre. La fermeture reste explicite via la croix ou le bouton Annuler.
   */
  destructive?: boolean;
  /** Largeur max du panneau (défaut 440). */
  width?: number;
  /** Cible de focus prioritaire à l'ouverture (optionnelle). */
  initialFocusRef?: RefObject<HTMLElement | null>;
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
  initialFocusRef,
}: ModalProps) {
  const titleId = useId();
  const closeFromEscape = useCallback(() => {
    if (!destructive) onClose();
  }, [destructive, onClose]);
  const dialogRef = useDialogLayer({
    open,
    onClose: closeFromEscape,
    initialFocusRef,
  });

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      inert
      tabIndex={-1}
      className="fixed inset-0 z-[60] grid animate-[cf-fade_.22s_var(--sm-ease)_both] place-items-center bg-black/65 p-4 outline-none motion-reduce:animate-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={() => {
        if (!destructive) onClose();
      }}
    >
      {/*
        ── LE CORPS DÉFILE, L'EN-TÊTE ET LE PIED RESTENT ──
        
        Le panneau n'avait ni hauteur maximale ni zone défilante : centré dans
        une grille, il débordait symétriquement en haut ET en bas, et le voile
        étant `fixed`, ce débordement n'alimentait AUCUN défilement — ni celui
        de la page, ni celui de la modale.
        
        Le pied devenait donc inatteignable dès que le contenu dépassait la
        hauteur utile : sur un portable 768p, la modale « Nouveau code promo »
        demande environ 712 px pour 640 disponibles. Le gérant remplissait neuf
        champs et ne pouvait pas les envoyer. Sur téléphone, où la grille se
        déplie en une colonne, c'était certain.
        
        `Drawer` faisait déjà ce qu'il fallait (`cf-scroll min-h-0 flex-1
        overflow-y-auto`) — d'où deux modales qui avaient bricolé leur propre
        `max-h` interne faute que le composant s'en charge.
        
        `100dvh` et non `100vh` : sur mobile, la barre d'adresse rétractable
        fausse `vh`, et le pied repasserait sous elle.
      */}
      <div
        className="flex max-h-[calc(100dvh-32px)] w-full animate-pop flex-col rounded-panel border border-white/10 bg-[image:var(--cf-card-gradient)] p-5 shadow-deep motion-reduce:animate-none"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <h2
            id={titleId}
            className="min-w-0 text-lg font-semibold tracking-[-0.03em] text-ink"
          >
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
        {/* `-mx-5 px-5` : la zone défilante va d'un bord à l'autre du panneau,
            sinon l'ascenseur apparaît à 20 px du bord et semble flotter. */}
        <div
          data-dialog-content
          className="cf-scroll -mx-5 min-h-0 flex-1 overflow-y-auto px-5 text-sm text-ink"
        >
          {children}
        </div>
        {footer && (
          <div
            data-dialog-footer
            className="mt-5 flex shrink-0 items-center justify-end gap-2"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
