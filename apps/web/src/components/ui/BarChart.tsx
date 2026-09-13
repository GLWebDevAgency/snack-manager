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
 * valeurs au-dessus, libellés dessous.
 * Baseline zéro TOUJOURS (hauteur ∝ valeur/max, min 4px si > 0).
 * L'apparition anime `transform: scaleY` depuis la base — jamais `height`,
 * qui déclencherait une remise en page (DA §6).
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
      {/* Filet de base : la baseline zéro doit se voir (DA — graphiques sobres). */}
      <div
        role="img"
        aria-label={title}
        className="flex items-end gap-2.5 border-b border-line2"
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
              <div className="cf-fig max-w-full truncate text-xs font-bold text-mut">
                {formatValue(d.value)}
              </div>
              {/*
                Accent parcimonieux (DA §3) : la barre n'est PAS un aplat de
                marque. Seule sa crête — la valeur qu'on lit, le sommet qu'on
                compare d'une barre à l'autre — porte l'accent pur, sur 3 px ;
                la masse en dessous n'est qu'un voile de la même teinte, qui
                s'éteint vers la base. Un histogramme se lit par ses sommets,
                pas par sa surface. Dégradé sur une seule teinte, jamais
                multicolore.
              */}
              <div
                className="w-full origin-bottom rounded-t-[6px]"
                style={{
                  height: h,
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--cf-accent) 30%, transparent) 0%, color-mix(in srgb, var(--cf-accent) 9%, transparent) 100%)",
                  boxShadow: "inset 0 3px 0 0 var(--cf-accent)",
                  animation: `cf-rise .32s var(--sm-ease) ${Math.min(i * 24, 240)}ms both`,
                }}
              />
              <div className="max-w-full truncate text-xs font-semibold text-mut">
                {d.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Données brutes pour lecteurs d'écran */}
      <div className="sr-only"><table>
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
      </table></div>
    </div>
  );
}
