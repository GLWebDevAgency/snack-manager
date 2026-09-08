import type { CustomerBrowserBinding, CustomerIntentBinding } from './port';
import type { PostgresCustomerIdentityRepository } from './repository';

/** Explicit fixture bootstrap, using the real SQL operations (never raw seeded authority). */
export async function confirmCustomerTestBrowser(repo: PostgresCustomerIdentityRepository, input: CustomerBrowserBinding) {
  const { parentRef, tenantRef, browserRef, browserHash } = input;
  const binding = { parentRef, tenantRef, browserRef, browserHash };
  await repo.prepareBrowser({ parentRef, tenantRef, browserRef });
  await repo.issueBrowser({ ...binding, currentBrowserHash: null });
  await repo.confirmBrowser(binding);
}

export async function prepareCustomerTestIntent(repo: PostgresCustomerIdentityRepository, input: CustomerIntentBinding) {
  const { parentRef, tenantRef, browserRef, browserHash, operationId, proofHash } = input;
  return repo.prepareIntent({ parentRef, tenantRef, browserRef, browserHash, operationId, proofHash });
}
