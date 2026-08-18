/**
 * Résultat de lecture de configuration d'un registrar — jamais une exception.
 *
 * Une configuration incomplète est un cas ORDINAIRE : la plupart des
 * installations n'ont pas de domaine personnalisé, et celles qui en veulent un
 * le branchent des semaines après la mise en service. `missing` sert à écrire
 * dans le journal de démarrage exactement quelles variables manquent — c'est ce
 * qui évite l'heure perdue à comparer deux `.env`.
 */
export type RegistrarConfig<T> =
  | { readonly configured: true; readonly value: T }
  | { readonly configured: false; readonly missing: readonly string[] };

export type { ConfigSource } from '../config-source';
