import type { DomainError } from './errors';

/**
 * Résultat d'une opération dont l'échec est un cas prévu du métier.
 *
 * On ne lève pas d'exception pour « le client a mal configuré son tacos » :
 * c'est une information à afficher, pas un incident. Les exceptions restent
 * réservées aux invariants (cf. `InvariantViolation`).
 */
export type Result<T, E extends DomainError = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E extends DomainError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export const isOk = <T, E extends DomainError>(
  r: Result<T, E>,
): r is { ok: true; value: T } => r.ok;

/** Déballe ou lève — réservé aux cas où l'échec est déjà exclu (tests, garanties amont). */
export function unwrap<T, E extends DomainError>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}

/** Combine plusieurs résultats : le premier échec l'emporte. */
export function all<T, E extends DomainError>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

export function map<T, U, E extends DomainError>(
  r: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}
