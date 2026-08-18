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
 * Interrupteur 46×26 (spec backoffice §4.6) : off blanc 10 %, on VERT #3fae4a,
 * pouce blanc 20px, transitions .15s.
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
        "relative h-[26px] w-[46px] shrink-0 rounded-pill transition-colors duration-150",
        on ? (danger ? "bg-alert" : "bg-ok") : "bg-white/10",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute top-[3px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-[left] duration-150"
        style={{ left: on ? 23 : 3 }}
      />
    </button>
  );
}
