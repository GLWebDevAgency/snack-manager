"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

type SlotToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  on: boolean;
  onChange?: (on: boolean) => void;
  /** Libellés (défaut « Ouvert » / « Fermé »). */
  labels?: { on: string; off: string };
};

/**
 * Créneau Ouvert/Fermé (spec backoffice §4.7) : pilule pastille + libellé,
 * on = vert fonctionnel, off = neutre #999.
 */
export function SlotToggle({
  on,
  onChange,
  labels = { on: "Ouvert", off: "Fermé" },
  className,
  ...rest
}: SlotToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange?.(!on)}
      style={
        on
          ? {
              background:
                "color-mix(in srgb, var(--cf-green) 12%, var(--cf-surface))",
            }
          : undefined
      }
      className={cx(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-pill border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold transition-colors duration-200 ease-sm",
        on ? "border-ok text-ok" : "border-line bg-surface text-mut",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cx("size-2 rounded-full", on ? "bg-ok" : "bg-mut")}
      />
      {on ? labels.on : labels.off}
    </button>
  );
}
