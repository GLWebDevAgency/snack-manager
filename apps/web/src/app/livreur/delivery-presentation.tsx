"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { LogoMark } from "@/components/brand/Logo";
import { useDialogLayer } from "@/components/ui/useDialogLayer";

export function deliveryInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

export function DeliveryPowered() {
  return <footer className="lv-powered"><LogoMark size={14} /><span>Propulsé par <b>Snack <em>Manager</em></b></span></footer>;
}

/** Reuses the application's dialog stack: focus, Escape, inert background and scroll lock. */
export function DeliveryDialog({ open, title, onClose, children, footer, sheet = false, closeDisabled = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; sheet?: boolean; closeDisabled?: boolean;
}) {
  const ref = useDialogLayer({ open, onClose });
  return <div ref={ref} inert tabIndex={-1} hidden={!open} className={`lv-dialog${sheet ? " lv-sheet" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
    {sheet && <div className="lv-sheet-scrim" onClick={onClose} />}
    <div className="lv-dialog-panel">
      {sheet && <span className="lv-grab" aria-hidden />}
      <header className="lv-dialog-head">
        <button type="button" className="lv-icon-button" aria-label={sheet ? "Fermer la remise" : "Retour à la tournée"} disabled={closeDisabled} onClick={onClose}><Icon name={sheet ? "close" : "back"} size={18} /></button>
        <h2>{title}</h2>
      </header>
      <div data-dialog-content className="lv-dialog-content">{children}</div>
      {footer && <div data-dialog-footer className="lv-dialog-footer">{footer}</div>}
    </div>
  </div>;
}
