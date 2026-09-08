import { randomBytes } from 'node:crypto';
import type { CustomerIdentityCrypto } from './crypto';
import type { CustomerScope } from './port';

export class CustomerRecoveryCodeError extends Error {
  constructor() { super('Code de secours invalide.'); this.name = 'CustomerRecoveryCodeError'; }
}

/** Presentation aliases only: ASCII spaces/separators and case. Never silently
 * replace a look-alike character or interpret a six-digit SMS as a saved code. */
export function canonicalRecoveryCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 128 || !/^[A-Za-z0-9 \t\r\n-]+$/.test(raw)) {
    throw new CustomerRecoveryCodeError();
  }
  const value = raw.replace(/[ \t\r\n-]/g, '').toUpperCase();
  if (!/^SM1[A-F0-9]{32}$/.test(value)) throw new CustomerRecoveryCodeError();
  return value;
}

/** 128 random bits, formatted for occasional manual entry. The caller may show
 * it only during an explicit enrollment/rotation, with no logging, URL or
 * automatic browser persistence. Generation does NOT activate a recovery code. */
export function createRecoveryCode(): string {
  const bytes = randomBytes(16);
  try { return `SM1-${bytes.toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`; }
  finally { bytes.fill(0); }
}

/** Only this keyed, parent/tenant-scoped digest is suitable for durable storage.
 * It is not a proof of enrollment, save confirmation, rate-limit admission or
 * one-time use. The repository must atomically consume the exact active code
 * version and publish a session; a repeated hash call changes no state. */
export function recoveryCodeHash(crypto: CustomerIdentityCrypto, scope: CustomerScope, raw: unknown): string {
  try {
    if (!scope || typeof scope.parentRef !== 'string' || typeof scope.tenantRef !== 'string'
      || !/^[a-zA-Z0-9_-]{1,160}$/.test(scope.parentRef) || !/^[a-zA-Z0-9_-]{1,160}$/.test(scope.tenantRef)) {
      throw new CustomerRecoveryCodeError();
    }
    return crypto.hash('recovery-code', scope.tenantRef,
      JSON.stringify(['saved-recovery-code.v1', scope.parentRef, canonicalRecoveryCode(raw)]));
  } catch { throw new CustomerRecoveryCodeError(); }
}
