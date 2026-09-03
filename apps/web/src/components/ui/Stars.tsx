/**
 * Note en étoiles (spec backoffice §4.11) — un `role="img"` dont le DESSIN
 * porte l'information : combien d'étoiles sur cinq. À ce titre il relève de
 * WCAG 1.4.11 (3:1), sur la page comme sur la carte.
 *
 * ── POURQUOI NI LE LAITON NI LE FILET ─────────────────────────────────────
 *
 * Les étoiles étaient peintes en `--cf-gold`, le laiton FIXE de Snack Manager
 * — un jeton que le résolveur n'émet pas, donc jamais repeint par le masque.
 * Sur la vitrine d'un restaurant clair, ce laiton posé sur la page mesure 2,04
 * (Soleil), 2,10 (Brasserie), 2,18 (Atelier), 2,41 (Marché) : notre couleur de
 * marque, illisible, sur la page de quelqu'un d'autre.
 * Les étoiles vides suivaient `--cf-line`, l'encre à 12 % : 1,2:1, invisibles.
 * On ne pouvait donc pas lire « 3 sur 5 » — seulement « 3 ».
 *
 * Remplies → `--cf-amber-t`, la teinte AMBRE que le résolveur ajuste par mode
 * et vérifie sur la page comme sur la carte (mesuré 5,01 à 7,85 sur les six
 * directions). Elle reste une sémantique fixe : la note n'est pas l'accent du
 * restaurant, et un 2/5 en couleur de marque serait un contresens.
 * Vides → `--cf-mut`, l'encre atténuée, seule nuance sortie du résolveur déjà
 * ramenée au plancher AA sur tous les fonds (mesuré 6,17 à 8,47).
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
            fill={on ? "var(--cf-amber-t)" : "none"}
            stroke={on ? "var(--cf-amber-t)" : "var(--cf-mut)"}
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
