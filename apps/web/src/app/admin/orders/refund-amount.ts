/** Decimal input becomes integer cents without floating-point multiplication. */
export function refundAmountCents(value: string): number | null {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [euros = "0", cents = ""] = value.trim().replace(",", ".").split(".");
  const amount = Number(euros) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000 ? amount : null;
}

export const refundAmountInput = (cents: number): string =>
  `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
