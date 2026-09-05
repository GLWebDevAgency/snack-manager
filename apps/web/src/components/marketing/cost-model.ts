export type OperatingCostInputs = {
  coordinationHours: number;
  hourlyCostEuros: number;
  remakes: number;
  remakeCostEuros: number;
};

const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Coût courant, en centimes. Aucun coefficient de gain ou taux concurrent. */
export function currentOperatingCost(input: OperatingCostInputs) {
  const coordinationCents = Math.round(positive(input.coordinationHours) * positive(input.hourlyCostEuros) * 100);
  const remakesCents = Math.round(positive(input.remakes) * positive(input.remakeCostEuros) * 100);
  return { coordinationCents, remakesCents, totalCents: coordinationCents + remakesCents };
}
