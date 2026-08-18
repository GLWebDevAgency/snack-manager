import { cx } from "@/lib/cx";

/** Squelette de chargement : bloc pulsé #1a1a1a (dimensionner via className). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("animate-pulse rounded-card bg-surface2", className)}
    />
  );
}
