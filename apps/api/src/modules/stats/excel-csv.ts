/**
 * Sérialise une cellule pour un CSV ouvert dans Excel/LibreOffice.
 *
 * Les guillemets protègent la structure CSV, mais pas l'interprétation d'une
 * cellule comme formule. L'apostrophe rend la valeur inerte dans le tableur
 * sans modifier la donnée canonique conservée en base et affichée au client.
 */
type TrustedNumericCell = {
  readonly kind: 'trusted-numeric-cell';
  readonly value: string;
};

/** Conserve le type numérique Excel d'un nombre formaté par le serveur. */
export function excelCsvNumber(value: string): TrustedNumericCell {
  return { kind: 'trusted-numeric-cell', value };
}

export function excelCsvCell(value: string | number | TrustedNumericCell): string {
  const trustedNumber = typeof value === 'object';
  let cell = trustedNumber ? value.value : String(value);
  if (!trustedNumber && typeof value === 'string' && /^[=+\-@\t\r\n\u0000＝＋－＠]/u.test(cell)) {
    cell = `'${cell}`;
  }
  return /[;"\r\n]/u.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
