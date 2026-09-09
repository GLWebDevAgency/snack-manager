import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CustomerAccountView } from '@sm/contracts';
import type { CustomerAccessBinding, CustomerIdentityCrypto, CustomerProtectedAccessRepository, CustomerSession } from '@sm/customer';
import type { PasskeyVerifier } from './passkey-verifier.port';

export type CustomerCredentialAccessPort = {
  repository: CustomerProtectedAccessRepository; crypto: CustomerIdentityCrypto; verifier: PasskeyVerifier;
  binding: CustomerAccessBinding; source: string; browserSecret: string; intentProof: string; origin: string;
  now: () => number; browser: () => Promise<{ expiresAt: number }>; intent: () => Promise<{ expiresAt: number }>;
  view: (session: CustomerSession) => Promise<CustomerAccountView>;
};
export class CustomerCredentialAccessError extends Error {
  constructor() { super('Accès personnel invalide ou expiré.'); this.name = 'CustomerCredentialAccessError'; }
}
export const refuseCredentialAccess = (): never => { throw new CustomerCredentialAccessError(); };
export const customerAccessNonce = () => randomBytes(32).toString('base64url');
export function customerCredentialContext(port: CustomerCredentialAccessPort) {
  const origin = new URL(port.origin);
  if (origin.protocol !== 'https:' || origin.origin !== port.origin || origin.username || origin.password) refuseCredentialAccess();
  const hash = (purpose: string, value: unknown) => port.crypto.hash('request', port.binding.tenantRef,
    JSON.stringify([purpose, port.binding.operationId, port.binding.attemptId,
      createHash('sha256').update(JSON.stringify(value)).digest('hex')]));
  return {
    scope: { origin: origin.origin, rpId: origin.hostname }, hash,
    sourceHash: port.crypto.hash('ip', port.binding.parentRef, JSON.stringify(['credential-access-source.v1', port.source])),
    token(method: 'passkey' | 'recovery', publicationId: string) {
      const token = port.crypto.tokenForProtectedPublication(port.binding.tenantRef, port.browserSecret,
        port.binding.operationId, port.intentProof, method, publicationId);
      return { token, sessionHash: port.crypto.hash('session', port.binding.tenantRef, token) };
    },
    async candidate(sessionHash: string) {
      const browser = await port.browser();
      return { sessionId: randomUUID(), sessionHash, sessionExpiresAt: Math.min(browser.expiresAt, port.now() + 604_800_000) };
    },
    async finished(session: CustomerSession | null, token: string, publicationId: string) {
      if (!session) return refuseCredentialAccess();
      return { state: 'authenticated' as const, operationId: port.binding.operationId, publicationId, token, view: await port.view(session) };
    },
  };
}
