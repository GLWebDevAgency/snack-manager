/** Conversion stricte d'un montant français en centimes, sans flottant métier. */
export function parseEuroInput(value: string, options: { allowZero?: boolean } = {}): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [euros = "0", cents = ""] = normalized.split(".");
  const result = Number(euros) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 0) return null;
  if (!options.allowZero && result === 0) return null;
  return result;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function parseSignedInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result !== 0 ? result : null;
}
