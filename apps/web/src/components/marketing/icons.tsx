/**
 * Pictos du site vitrine — trait 1.6, currentColor, 24×24.
 * Jeu autonome : le back-office a le sien (`@/components/ui/icons`), calibré
 * pour un usage tactile ; ici on vise l'échelle éditoriale d'une page de vente.
 */

export type MkIconName =
  | "register"
  | "kitchen"
  | "phoneOrder"
  | "chart"
  | "check"
  | "cross"
  | "chevron"
  | "arrow"
  | "sparkle"
  | "shield"
  | "euro"
  | "clock"
  | "code"
  | "copy"
  | "download"
  | "flag"
  | "bolt"
  | "hourglass";

const PATHS: Record<MkIconName, string[]> = {
  register: ["M3 9.5 12 4l9 5.5", "M4.5 9v11h15V9", "M8.5 20v-6h7v6", "M8.5 11.5h3"],
  kitchen: ["M4 13h16", "M6 13a6 6 0 0 1 12 0", "M4.5 17.5h15", "M12 7V4"],
  phoneOrder: ["M7.5 3h9v18h-9z", "M10.5 5.6h3", "M11 18.2h2"],
  chart: ["M3 20h18", "M6.5 20v-6", "M11.5 20V8", "M16.5 20v-9", "M21 20v-4"],
  check: ["m4.5 12.5 5 5 10-11"],
  cross: ["m6.5 6.5 11 11", "m17.5 6.5-11 11"],
  chevron: ["m6 9.5 6 6 6-6"],
  arrow: ["M4 12h15", "m13 6 6 6-6 6"],
  sparkle: ["M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13l-5.6-2 5.6-2z", "M18.5 4v3", "M20 5.5h-3"],
  shield: ["M12 3.5 5 6.2v5.4c0 4.3 2.9 7.3 7 8.9 4.1-1.6 7-4.6 7-8.9V6.2z", "m9 12 2.2 2.2L15.5 10"],
  euro: ["M17.5 6a7 7 0 1 0 0 12", "M4.5 10.4h9", "M4.5 13.6h8"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.2V12l3.2 2"],
  code: ["m8.5 8.5-4 3.5 4 3.5", "m15.5 8.5 4 3.5-4 3.5", "m13.5 5-3 14"],
  copy: ["M9 9h10v11H9z", "M15 9V4H5v11h4"],
  download: ["M12 4v11", "m7.5 10.5 4.5 4.5 4.5-4.5", "M4.5 20h15"],
  flag: ["M6 21V4", "M6 5h11l-2.2 3.6L17 12H6"],
  bolt: ["M13.5 3 6 13.5h5L10.5 21 18 10.5h-5z"],
  hourglass: ["M7 4h10", "M7 20h10", "M8 4c0 4 4 5 4 8s-4 4-4 8", "M16 4c0 4-4 5-4 8s4 4 4 8"],
};

export function MkIcon({
  name,
  size = 20,
  strokeWidth = 1.6,
  className,
}: {
  name: MkIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Coche pleine 16px des listes « inclus » (vert fonctionnel #3fae4a). */
export function MkTick({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}
