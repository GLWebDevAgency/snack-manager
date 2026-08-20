/**
 * Pictogrammes du site vitrine — repris tels quels de la maquette
 * « Snack Manager - Site Vitrine.html » (mêmes tracés, mêmes viewBox).
 */

type Sized = { width?: number; height?: number; className?: string; style?: React.CSSProperties };

/** Le monogramme Snack Manager (deux tracés, blanc plein). */
export function LogoMark({ width = 25, height = 25, className, style }: Sized) {
  return (
    <svg viewBox="0 0 24.958 24.991" width={width} height={height} className={className} style={style} aria-hidden="true">
      <path
        d="M 21.12 22.771 C 26.27 17.529 26.232 9.117 21.036 3.921 C 15.84 -1.275 7.428 -1.311 2.187 3.838 L 6.605 8.256 C 7.302 8.953 8.427 8.918 9.315 8.488 C 11.368 7.49 13.828 7.903 15.442 9.517 C 17.056 11.132 17.469 13.592 16.471 15.645 C 16.04 16.532 16.005 17.657 16.702 18.354 L 21.12 22.771 Z"
        fill="#fff"
      />
      <path
        d="M 18.743 24.991 L 12.189 24.991 C 11.242 24.991 10.335 24.614 9.665 23.945 L 1.045 15.326 C 0.376 14.657 0 13.748 0 12.801 L 0 6.248 Z M 6.694 24.991 L 2.678 24.991 C 1.199 24.991 0 23.792 0 22.313 L 0 18.297 Z"
        fill="#fff"
      />
    </svg>
  );
}

/** Congé de l'encoche (barre de navigation, bandeau de fonctionnalités). */
export function NotchFillet({ flip, flipY, className }: { flip?: boolean; flipY?: boolean; className?: string }) {
  const transform = `${flip ? "scaleX(-1)" : ""} ${flipY ? "scaleY(-1)" : ""}`.trim();
  return (
    <svg
      viewBox="0 0 87 34"
      width={87}
      height={34}
      className={className}
      style={transform ? { transform } : undefined}
      aria-hidden="true"
    >
      <path d="M 0 0 C 45.98 0 37 34 87 34 L 87 0 Z" fill="#000" />
    </svg>
  );
}

/** Petit congé 18×18 (étiquettes d'étape, onglet du pied de page). */
export function SmallFillet({ rotate = 0 }: { rotate?: number }) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={18}
      height={18}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      aria-hidden="true"
    >
      <path d="M 0 0 L 0 18 C 0 8.059 8.059 0 18 0 Z" fill="#000" />
    </svg>
  );
}

/** Pastille verte cochée (listes « avec Snack Manager », tarifs, contact). */
export function TickDot({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="var(--green)" />
      <path
        d="M4.2 7.3l1.9 1.9 3.7-4.2"
        fill="none"
        stroke="var(--white)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Pastille rouge croisée (liste « sans Snack Manager »). */
export function CrossDot({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="var(--red)" />
      <path d="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2" stroke="var(--white)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Chevron simple, orienté par `dir`. */
export function Chevron({ size = 16, dir = "right" }: { size?: number; dir?: "left" | "right" | "down" }) {
  const transform = dir === "left" ? "scaleX(-1)" : dir === "down" ? "rotate(90deg)" : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={transform ? { transform } : undefined} aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Chevron large de la FAQ (pointe vers le bas au repos). */
export function FaqChevron() {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
      <path d="M 3 6 L 8 11 L 13 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Flèche du changelog (mois précédent / suivant). */
export function UpdArrow({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg viewBox="0 0 16 16" width={9} height={9} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "prev" ? <path d="M12.5 8h-9M7 3.5 2.5 8 7 12.5" /> : <path d="M3.5 8h9M9 3.5 13.5 8 9 12.5" />}
    </svg>
  );
}

/* ── Pictos 16×16 des maquettes internes (panneau « Analyse du service ») ── */

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IcoClock({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} aria-hidden="true">
      <circle cx="8" cy="8" r="5.1" />
      <path d="M8 5.4V8l1.9 1.3" />
    </svg>
  );
}

export function IcoCycle({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} aria-hidden="true">
      <path d="M12.6 6.6a4.8 4.8 0 0 0-8.7-1.3" />
      <path d="M3.9 2.9v2.6h2.6" />
      <path d="M3.4 9.4a4.8 4.8 0 0 0 8.7 1.3" />
      <path d="M12.1 13.1v-2.6H9.5" />
    </svg>
  );
}

export function IcoChat({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} aria-hidden="true">
      <path d="M13.2 7.4c0 2.4-2.3 4.3-5.2 4.3-.6 0-1.2-.1-1.7-.2l-2.6 1 .9-2A4 4 0 0 1 2.8 7.4c0-2.4 2.3-4.3 5.2-4.3s5.2 1.9 5.2 4.3Z" />
      <circle cx="5.8" cy="7.4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="7.4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="7.4" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IcoCalendar({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} aria-hidden="true">
      <rect x="3" y="3.9" width="10" height="9.1" rx="1.6" />
      <path d="M3 7h10" />
      <path d="M5.7 2.6v2M10.3 2.6v2" />
    </svg>
  );
}

export function IcoTray({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} strokeWidth={1.2} aria-hidden="true">
      <ellipse cx="8" cy="4.6" rx="4.6" ry="1.9" />
      <path d="M3.4 4.6v6.8c0 1 2.1 1.9 4.6 1.9s4.6-.9 4.6-1.9V4.6" />
    </svg>
  );
}

export function IcoBag({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} {...line} strokeWidth={1.2} aria-hidden="true">
      <path d="M4.2 2.8h5.2l2.4 2.4v8H4.2Z" />
      <path d="M6 8.2h4M6 10.4h4" />
    </svg>
  );
}

export function IcoPhone({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M6.6 3.2c.5-.5 1.3-.4 1.7.1l1.9 2.4c.4.4.4 1 .1 1.5l-.9 1.3c-.2.3-.2.7 0 1a12 12 0 0 0 5.1 5.1c.3.2.7.2 1 0l1.3-.9c.5-.3 1.1-.3 1.5.1l2.4 1.9c.5.4.6 1.2.1 1.7l-1.1 1.1c-.7.7-1.7 1-2.6.7-2.9-.9-5.6-2.5-7.9-4.8a19.7 19.7 0 0 1-4.8-7.9c-.3-.9 0-1.9.7-2.6Z" />
    </svg>
  );
}

export function IcoBolt({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8.8 2.2 3.8 9h3.4l-.9 4.8 5-6.8H7.9Z" />
    </svg>
  );
}

/* ── Pictos 18×18 des tuiles « Pourquoi nous » ── */

const line18 = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
};

export function BfClock() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.5 V9 L11.4 10.5" />
    </svg>
  );
}

export function BfEuro() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.4 V12.6" />
      <path d="M10.9 6.9 C10.4 6.1 7.2 6 7.2 7.7 C7.2 9.4 10.8 8.6 10.8 10.3 C10.8 11.9 7.6 11.8 7 10.9" />
    </svg>
  );
}

export function BfBolt() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} strokeLinejoin="round" aria-hidden="true">
      <path d="M9.7 2.6 L5 9.5 H8 L7.2 15.4 L12.9 8 H9.2 L9.7 2.6 Z" />
    </svg>
  );
}

export function BfTrend() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} aria-hidden="true">
      <path d="M3.2 14.6 H14.8" />
      <path d="M4.6 11.2 L7.5 8.2 L9.8 10.2 L13.4 5.6" />
      <path d="M13.4 8.2 V5.6 H10.8" />
    </svg>
  );
}

export function BfTarget() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" />
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="9" cy="9" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BfBars() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" {...line18} aria-hidden="true">
      <path d="M4.4 14.6 V11.4" />
      <path d="M9 14.6 V8.2" />
      <path d="M13.6 14.6 V4.6" />
    </svg>
  );
}

/* ── Pictos 24×24 de la section « Matériel » ── */

/*
 * Quatre traits, aucun emoji : la charte sombre et dorée ne bouge pas, et une
 * section qui dit « rien à racheter » ne peut pas le dire avec des vignettes de
 * catalogue. Ils sont dessinés plus grands que les pictos de tuiles (34 px au
 * rendu contre 18) parce qu'ils portent la section à eux seuls — il n'y a pas
 * une phrase autour d'eux.
 *
 * Le trait est plus épais que celui des maquettes internes : à 34 px, 1,3
 * disparaît.
 */
const line24 = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Tablette Android ou iPad — la vôtre, aucun matériel propriétaire. */
export function MtTablette({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...line24} aria-hidden="true">
      <rect x="5" y="2.8" width="14" height="18.4" rx="2.4" />
      <path d="M10.4 18.5h3.2" />
    </svg>
  );
}

/** Imprimante ticket 80 mm — le ticket sort par le bas, c'est ce qu'on regarde. */
export function MtImprimante({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...line24} aria-hidden="true">
      <path d="M7.2 8.4V4.2h9.6v4.2" />
      <rect x="3.2" y="8.4" width="17.6" height="6.4" rx="1.6" />
      <path d="M7.2 12.4h9.6v7.4H7.2z" />
      <path d="M9.6 15.4h4.8M9.6 17.6h3.2" />
      <circle cx="17.9" cy="10.9" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Écran cuisine — une TV ou un moniteur mural, rien de spécifique. */
export function MtEcran({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...line24} aria-hidden="true">
      <rect x="2.8" y="4" width="18.4" height="12.6" rx="1.8" />
      <path d="M12 16.6v3.6" />
      <path d="M8.5 20.2h7" />
    </svg>
  );
}

/** Connexion internet — une box suffit, la fibre n'est pas requise. */
export function MtReseau({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...line24} aria-hidden="true">
      <path d="M3.6 10.4a11.4 11.4 0 0 1 16.8 0" />
      <path d="M7.2 14a6.6 6.6 0 0 1 9.6 0" />
      <circle cx="12" cy="18.4" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Croix « sans Snack Manager » / éclair « Snack Manager » du comparatif. */
/**
 * L'HORLOGE DE LA COLONNE « AUJOURD'HUI ».
 *
 * Elle remplace `CmpCross`, un sablier plein qui, posé face à un éclair,
 * transformait la ligne en jugement. Ici les deux pastilles nomment deux
 * MOMENTS — aujourd'hui, lundi prochain — et pas un bon et un mauvais camp.
 * D'où un trait creux plutôt qu'une forme pleine : la colonne de gauche est
 * l'état éteint, elle ne doit pas peser autant que celle qui s'allume.
 */
export function CmpToday() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4.1V7l2 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function CmpBolt() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="var(--white)" aria-hidden="true">
      <path d="M8.2 1 3.4 8.1h2.9L5.6 13l4.9-7.1H7.6L8.2 1z" />
    </svg>
  );
}
