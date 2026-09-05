/**
 * Frontière de LECTURE du menu Mongo historique.
 *
 * Mongoose émet `max: null` et `perVariant: null` pour des champs absents ;
 * le contrat d'écriture attend leur omission. Rééditer une option renvoie
 * tous les groupes, y compris ces anciens null, et rejetait alors le produit.
 *
 * Aucun défaut métier ici : zéro, règles non nulles, clés et prix restent
 * intacts. La validation d'écriture conserve son rôle (notamment max > 0).
 * Les règles d'une variante ne sont ni réinterprétées ni remplacées.
 */
type LegacyOptionFields = { key?: unknown; max?: unknown; perVariant?: unknown };

export type NormalizedLegacyOptionGroup<T extends LegacyOptionFields> = Omit<T, 'max' | 'perVariant'> & {
  max?: Exclude<T['max'], null | undefined>;
  perVariant?: Exclude<T['perVariant'], null | undefined>;
};

export function normalizeLegacyOptionGroup<T extends null | undefined>(group: T): T;
export function normalizeLegacyOptionGroup<T extends LegacyOptionFields>(group: T): NormalizedLegacyOptionGroup<T>;
export function normalizeLegacyOptionGroup(group: LegacyOptionFields | null | undefined) {
  // Un élément corrompu reste visible et refusé par le contrat d'écriture :
  // ne pas faire planter GET, ni supprimer silencieusement une donnée.
  if (group === null || group === undefined) return group;
  const normalized = { ...group };
  if (group.max === null || group.max === undefined) delete normalized.max;
  if (group.perVariant === null || group.perVariant === undefined) delete normalized.perVariant;
  return normalized;
}
