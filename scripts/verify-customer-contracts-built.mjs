import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each entry gets a fresh CommonJS cache. Importing only the barrel first can
// conceal undefined schemas captured by a circular dependency in another entry.
const cwd = fileURLToPath(new URL('../packages/contracts/', import.meta.url));
for (const entry of ['customer-orders', 'customer-account', 'order-input', 'index']) {
  const probe = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    require('./dist/${entry}.js');
    const contracts = require('./dist/index.js');
    for (const action of ['orders', 'order-detail', 'order-create', 'order-reorder']) {
      for (const map of ['CustomerAccountBrowserRequests', 'CustomerAccountEnvelopes', 'CustomerAccountResponses']) {
        assert.equal(typeof contracts[map][action]?.safeParse, 'function', map + '.' + action);
      }
    }
    assert.equal(contracts.CustomerAccountBrowserRequests.orders.safeParse({ filter: 'all', limit: 20, cursor: null }).success, true);
    assert.equal(contracts.CustomerAccountResponses.orders.safeParse({ expiresAt: 1, orders: [], nextCursor: null }).success, true);
    assert.equal(contracts.CustomerAccountResponses['order-create'].safeParse({ state: 'rejected', expiresAt: 1, reason: 'unavailable', message: 'Indisponible' }).success, true);
    assert.equal(contracts.CustomerAccountBrowserRequests['order-reorder'].safeParse({ orderId: 'a'.repeat(24) }).success, true);
    assert.equal(contracts.CustomerAccountResponses['order-reorder'].safeParse({ expiresAt: 1, orderId: 'a'.repeat(24), number: 1,
      lines: [{ productId: null, name: 'Ancien article', variantKey: null, variantName: null, qty: 1, unitPrice: 100, options: [], removed: [] }] }).success, true);
  `], { cwd, stdio: 'inherit', timeout: 10_000 });
  if (probe.error || probe.signal || probe.status !== 0) {
    throw new Error(`Customer contract CommonJS entry failed: ${entry}`);
  }
}
console.log('✓ contrats client CommonJS : quatre ordres de chargement valides');
