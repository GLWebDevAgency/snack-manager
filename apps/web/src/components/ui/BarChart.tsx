import { cx } from "@/lib/cx";

type BarChartProps = {
  data: { label: string; value: number }[];
  /** Hauteur totale en px (défaut 150 — usages maquette : 150/170/190). */
  height?: number;
  /** Formatage de la valeur au-dessus de la barre (défaut : brut). */
  formatValue?: (v: number) => string;
  /** Description accessible du graphique (aria-label + caption sr-only). */
  title?: string;
  className?: string;
};

/**
 * Histogramme simple (spec backoffice §4.10) : barres accent, rayon 6px 6px 0 0,
 * transition height .4s, valeurs 12px #999 au-dessus, labels dessous.
 * Baseline zéro TOUJOURS (hauteur ∝ valeur/max, min 4px si > 0).
 */
export function BarChart({
  data,
  height = 150,
  formatValue = (v) => String(v),
  title = "Histogramme",
  className,
}: BarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cx(
          "grid place-items-center text-[13px] text-mut",
          className,
        )}
        style={{ height }}
      >
        Aucune donnée sur la période
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={title}
        className="flex items-end gap-2.5"
        style={{ height }}
      >
        {data.map((d, i) => {
          const h =
            d.value > 0
              ? Math.max(4, Math.round((d.value / max) * (height - 40)))
              : 0;
          return (
            <div
              key={`${d.label}-${i}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div className="max-w-full truncate text-xs font-semibold tabular-nums text-mut">
                {formatValue(d.value)}
              </div>
              <div
                className="w-full rounded-t-[6px] bg-accent transition-[height] duration-[400ms] ease-out"
                style={{ height: h }}
              />
              <div className="max-w-full truncate text-xs font-semibold text-mut">
                {d.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Données brutes pour lecteurs d'écran */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Libellé</th>
            <th scope="col">Valeur</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${d.label}-${i}`}>
              <th scope="row">{d.label}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
