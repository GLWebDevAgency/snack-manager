import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";

/** État vide standard : tuile icône, titre, indice, action optionnelle. */
export function EmptyState({
  icon = "search",
  title,
  hint,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-2 p-10 text-center",
        className,
      )}
    >
      <div
        className="grid size-11 place-items-center rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] text-mut"
        aria-hidden
      >
        <Icon name={icon} size={20} />
      </div>
      <p className="text-sm font-bold text-ink">{title}</p>
      {hint && <p className="max-w-[360px] text-[13px] text-mut">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
