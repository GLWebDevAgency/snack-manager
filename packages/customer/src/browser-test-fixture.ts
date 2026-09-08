import type { CustomerBrowserBinding } from './port';
import type { PostgresCustomerIdentityRepository } from './repository';

/** Explicit fixture bootstrap, using the real SQL operations (never raw seeded authority). */
export async function confirmCustomerTestBrowser(repo: PostgresCustomerIdentityRepository, input: CustomerBrowserBinding) {
  const { parentRef, tenantRef, browserRef, browserHash } = input;
  const binding = { parentRef, tenantRef, browserRef, browserHash };
  await repo.prepareBrowser({ parentRef, tenantRef, browserRef });
  await repo.issueBrowser({ ...binding, currentBrowserHash: null });
  await repo.confirmBrowser(binding);
}
