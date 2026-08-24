"use client";

/**
 * PRIMITIVES MOBILES du back-office interne.
 *
 * Le design system ne connaît que le bureau : sa modale se centre, son tiroir
 * s'accroche à droite, et aucun des deux ne survit à un écran de téléphone —
 * une modale de 480 px centrée dans 390 px déborde, et son contenu n'a aucun
 * défilement propre. Plutôt que d'alourdir `@/components/ui` pour une seule
 * surface, les pièces qui savent devenir des feuilles plein écran vivent ici,
 * chez la seule surface qui en a besoin aujourd'hui : le CRM se pilote depuis
 * un téléphone, le back-office restaurant reste un outil de comptoir.
 *
 * Deux règles héritées des meilleures applications mobiles :
 *
 *  · `100dvh`, jamais `100vh` — les barres du navigateur et le clavier
 *    rétrécissent la fenêtre visible, et un pied de gestes calé sur `100vh`
 *    finit sous le clavier au moment précis où l'on veut valider ;
 *  · en-tête et pied COLLANTS, corps défilable — le titre dit toujours où l'on
 *    est, le geste de sortie reste toujours sous le pouce.
 */

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { IconBtn } from "@/components/ui";

/**
 * MODALE-FEUILLE : la modale du design system au-dessus de `md`, une feuille
 * plein écran en dessous. Même contrat d'appel que `Modal` — le remplacement
 * dans un écran est mécanique, aucun comportement ne change côté bureau :
 * Échap ferme (sauf destructive), le voile ferme (sauf destructive), le pied
 * porte les gestes.
 */
export function SheetModal({
  open,
  onClose,
  title,
  children,
  footer,
  destructive = false,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Boutons d'action — alignés à droite au bureau, étirés sur mobile. */
  footer?: ReactNode;
  /** Destructive : fermeture explicite uniquement (croix ou bouton). */
  destructive?: boolean;
  /** Largeur max du panneau AU-DESSUS de `md` (défaut 440). */
  width?: number;
}) {
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
      className="fixed inset-0 z-[60] animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/65 md:grid md:place-items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onClick={() => {
        if (!destructive) onClose();
      }}
    >
      <div
        className={cx(
          "flex flex-col bg-[image:var(--cf-card-gradient)]",
          // Feuille : tout l'écran, sans rayon — un panneau arrondi qui touche
          // les quatre bords se lit comme un bug, pas comme un choix.
          "max-md:h-dvh max-md:w-full max-md:animate-[cf-slide-in_.28s_var(--sm-ease)_both]",
          // Bureau : la modale du DS, bornée à la fenêtre pour que son corps
          // défile au lieu de pousser le pied hors de vue.
          "md:h-auto md:max-h-[calc(100dvh-32px)] md:w-full md:max-w-[var(--sm-feuille-l)] md:animate-pop md:rounded-panel md:border md:border-white/10 md:shadow-deep",
        )}
        style={{ "--sm-feuille-l": `${width}px` } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line2 px-4 py-3.5 md:px-5">
          <h2 className="min-w-0 text-lg font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h2>
          <IconBtn icon="close" label="Fermer" size={36} iconSize={16} onClick={onClose} />
        </div>
        <div className="cf-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm text-ink md:px-5">
          {children}
        </div>
        {footer && (
          <div
            className={cx(
              "flex shrink-0 items-center justify-end gap-2 border-t border-line2 px-4 py-3.5 md:px-5",
              // Le pied reste sous le pouce : boutons étirés, ≥ 44 px, et la
              // marge de sécurité des encoches en plus du rembourrage.
              "max-md:pb-[calc(14px+env(safe-area-inset-bottom))] max-md:[&>a]:min-h-11 max-md:[&>a]:flex-1 max-md:[&>button]:min-h-11 max-md:[&>button]:flex-1",
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * FEUILLE BASSE : le menu « Plus » de la barre de navigation mobile, et tout
 * ce qui mérite un panneau ancré au pouce plutôt qu'une page. Bureau exclu par
 * construction (`md:hidden`) — au-dessus de `md`, la colonne de navigation
 * porte déjà tout.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
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
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      {/*
        La montée depuis le bas n'existe pas dans les keyframes du DS (le
        tiroir glisse depuis la droite, les barres de graphe s'étirent) : on la
        pose ici, portée par la feuille elle-même — `globals.css` reste hors du
        périmètre de cette surface.
      */}
      <style>{`@keyframes sm-feuille-monte{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div
        className="absolute inset-0 animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] animate-[sm-feuille-monte_.26s_var(--sm-ease)_both] flex-col rounded-t-panel border-t border-white/10 bg-[image:var(--cf-card-gradient)] shadow-deep">
        {/* Poignée : l'affordance universelle « ceci se referme vers le bas ». */}
        <div className="grid shrink-0 place-items-center pb-1 pt-2" aria-hidden>
          <span className="h-1 w-9 rounded-pill bg-white/20" />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2">
          <h2 className="min-w-0 truncate text-base font-extrabold tracking-[-0.02em] text-ink">
            {title}
          </h2>
          <IconBtn icon="close" label="Fermer" size={36} iconSize={16} onClick={onClose} />
        </div>
        <div className="cf-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(14px+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
