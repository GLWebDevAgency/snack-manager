import type { Page } from 'playwright';

// Local browser recipes only: no account, cookie or provider is manufactured in
// runtime. Existing profile fixtures explicitly supply their public selector.
export const CUSTOMER_BROWSER_FIXTURE_REF = '10000000-0000-4000-8000-000000000001';
export async function seedCustomerBrowserFixture(page: Page, slug: string) {
  await page.evaluate(async ({ slug, browserRef }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('sm-customer-preparation-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('preparations');
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error('Fixture database unavailable'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('preparations', 'readwrite', { durability: 'strict' });
        tx.objectStore('preparations').put({ version: 1, browserRef, phase: 'ready' }, slug);
        tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Fixture journal unavailable'));
      });
    } finally { db.close(); }
  }, { slug, browserRef: CUSTOMER_BROWSER_FIXTURE_REF });
}
