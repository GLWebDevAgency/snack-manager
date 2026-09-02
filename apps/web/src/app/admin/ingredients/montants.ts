/**
 * Conversion des montants saisis — règles pures, sans un seul import.
 *
 * Séparées de `shared.tsx` pour une raison précise : ce fichier-là importe des
 * composants et l'alias `@/`, que la configuration de test du web ne résout
 * pas. Une règle métier qui décide d'un prix ne doit pas être intestable parce
 * qu'elle voisine avec un badge.
 *
 * Rappel non négociable du dépôt : tous les montants circulent en CENTIMES.
 */

/** « 12,5 » ou « 12.5 » → 12,5. Refuse le vide, le négatif et l'illisible. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** « 12,50 » (euros saisis) → 1250 centimes ; invalide → `null`. */
export function parseEurosToCents(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null ? null : Math.round(n * 100);
}

/** 1250 centimes → « 12,50 » (pré-remplissage d'un champ euros). */
export const centsToInput = (cents: number): string =>
  (cents / 100).toFixed(2).replace('.', ',');

/**
 * Le prix d'un supplément, tel que l'API l'attend.
 *
 * Chaîne vide → `null` : l'ingrédient sort du catalogue des suppléments, le
 * comptoir ne le propose plus. « 0 » → `0` : proposé, offert. Les deux
 * existent et ne veulent pas dire la même chose.
 *
 * Volontairement distincte de `parseEurosToCents` : le tiroir mappait la
 * chaîne vide sur `0`. Réutiliser ce chemin aurait transformé « désactiver ce
 * supplément » en « l'offrir à tout le monde » — un défaut invisible à
 * l'écran, qui se découvre sur la marge du mois.
 */
export function supplementDepuisSaisie(saisie: string): number | null {
  const net = saisie.trim();
  if (net === '') return null;
  return parseEurosToCents(net);
}
