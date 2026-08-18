/**
 * Note en étoiles (spec backoffice §4.11) : remplies fill+stroke GOLD #c9a15a
 * (fixe, pas l'accent tenant), vides contour --cf-line 1.5.
 */
export function Stars({
  value,
  size = 15,
  className,
}: {
  /** Note de 0 à 5 (arrondie à l'étoile). */
  value: number;
  size?: number;
  className?: string;
}) {
  const filled = Math.round(Math.min(5, Math.max(0, value)));
  return (
    <span
      role="img"
      aria-label={`Note : ${value.toLocaleString("fr-FR")} sur 5`}
      className={className}
      style={{ display: "inline-flex", gap: 2 }}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const on = i < filled;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            fill={on ? "var(--cf-gold)" : "none"}
            stroke={on ? "var(--cf-gold)" : "var(--cf-line)"}
            strokeWidth={on ? 1 : 1.5}
            strokeLinejoin="round"
          >
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
          </svg>
        );
      })}
    </span>
  );
}
