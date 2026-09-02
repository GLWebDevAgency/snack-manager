"use client";

import { cx } from "@/lib/cx";

type ToggleProps = {
  on: boolean;
  onChange?: (on: boolean) => void;
  /**
   * Variante destructive : ON = ROUGE fonctionnel #c94b3f (décision prod §17 —
   * pas l'accent tenant) pour « Rupture », « retirer de la vente »…
   */
  danger?: boolean;
  disabled?: boolean;
  /** Libellé accessible (obligatoire : le toggle n'a pas de texte visible). */
  label: string;
  className?: string;
};

/**
 * Interrupteur 46×26 (spec backoffice §4.6) : off encre à 10 %, on VERT
 * #3fae4a, pouce couleur d'encre 20px. Le pouce se déplace en `translateX` —
 * le mouvement ne porte jamais sur une propriété de mise en page (DA §6).
 */
export function Toggle({
  on,
  onChange,
  danger = false,
  disabled = false,
  label,
  className,
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={cx(
        "relative h-[26px] w-[46px] shrink-0 rounded-pill border border-ink/6 transition-[background-color,opacity] duration-200 ease-sm",
        on ? (danger ? "bg-alert" : "bg-ok") : "bg-ink/10 hover:bg-ink/16",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-[2px] top-[2px] size-5 rounded-full bg-ink shadow-card transition-transform duration-200 ease-sm"
        style={{ transform: `translateX(${on ? 20 : 0}px)` }}
      />
    </button>
  );
}
