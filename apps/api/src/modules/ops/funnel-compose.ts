import { FUNNEL_STEPS, type FunnelStep, type OpsFunnelRow } from '@sm/contracts';

/**
 * Des lignes d'agrégat Mongo à l'entonnoir lisible — pure, donc testée sans
 * base. Le tri met le plus gros trafic d'abord : c'est le client dont
 * l'entonnoir mérite le premier regard.
 */
export function composeFunnel(
  rows: readonly { slug: string; step: string; n: number }[],
): OpsFunnelRow[] {
  const bySlug = new Map<string, Record<FunnelStep, number>>();
  for (const row of rows) {
    if (!(FUNNEL_STEPS as readonly string[]).includes(row.step)) continue;
    const steps =
      bySlug.get(row.slug) ??
      (Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>);
    steps[row.step as FunnelStep] += row.n;
    bySlug.set(row.slug, steps);
  }
  return [...bySlug.entries()]
    .map(([slug, steps]) => ({
      slug,
      steps,
      conversionPct:
        steps.visite > 0 ? Math.round((steps.commande / steps.visite) * 100) : null,
    }))
    .sort((a, b) => b.steps.visite - a.steps.visite);
}
