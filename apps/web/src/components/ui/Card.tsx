import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * flat = tuile INTERNE, posée dans une carte : niveau « élément » #1a1a1a,
   * rayon 12. Jamais #111 — deux surfaces adjacentes ne portent jamais la même
   * valeur (DA §1). Sinon : carte de niveau 2 (#111), rayon 16, ombre douce.
   */
  flat?: boolean;
};

/**
 * Carte SM Dark (spec backoffice §4.8) : dégradé vertical très discret
 * (voile blanc 5 % en haut), bord blanc 6 %, rayon 16, ombre carte.
 */
export function Card({ flat = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        "overflow-hidden border border-white/6",
        flat
          ? "rounded-card bg-[image:var(--cf-elev-gradient)]"
          : "rounded-panel bg-[image:var(--cf-card-gradient)] shadow-card",
        className,
      )}
      {...rest}
    />
  );
}

type PanelProps = {
  /** Titre 18px (.cf-disp). */
  title: ReactNode;
  /** Sous-titre 13px #999. */
  sub?: ReactNode;
  /** Zone d'action alignée à droite de l'en-tête. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Classes du corps (sous l'en-tête). */
  bodyClassName?: string;
};

/** Carte à en-tête : padding 18px, titre + sous-titre + actions (spec §4.8). */
export function Panel({
  title,
  sub,
  actions,
  children,
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <Card className={cx("p-[18px]", className)}>
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-[13px] text-mut">{sub}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
