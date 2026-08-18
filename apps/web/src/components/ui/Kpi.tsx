import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Card } from "./Card";
import { Icon, type IconName } from "./icons";

type KpiProps = {
  /** Eyebrow 11px (« CA du jour », « Temps moyen »…). */
  label: string;
  /** Valeur 30px tabular-nums (déjà formatée : fmtEuro…). */
  value: ReactNode;
  icon?: IconName;
  /**
   * Delta coloré fonctionnel avec référence explicite :
   * up = ▲ VERT #3fae4a · down = ▼ ROUGE #c94b3f (décision prod — pas l'accent).
   */
  delta?: { dir: "up" | "down"; text: string };
  className?: string;
};

/** Carte KPI (spec backoffice §4.9). */
export function Kpi({ label, value, icon, delta, className }: KpiProps) {
  return (
    <Card className={cx("flex-1 p-[18px]", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
          {label}
        </div>
        {icon && (
          <div
            className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-surface2 text-accent"
            aria-hidden
          >
            <Icon name={icon} size={18} />
          </div>
        )}
      </div>
      <div className="mt-2 text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] tabular-nums text-ink">
        {value}
      </div>
      {delta && (
        <div
          className={cx(
            "mt-0.5 text-[13px] font-bold tabular-nums",
            delta.dir === "up" ? "text-ok" : "text-alert",
          )}
        >
          <span aria-hidden>{delta.dir === "up" ? "▲" : "▼"}</span>
          <span className="sr-only">
            {delta.dir === "up" ? "En hausse :" : "En baisse :"}
          </span>{" "}
          {delta.text}
        </div>
      )}
    </Card>
  );
}
