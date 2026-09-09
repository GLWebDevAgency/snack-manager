import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Journal from "./checkout-attempt";

declare global {
  interface Window { checkoutJournal: typeof Journal }
}

const payload = {
  lines: [{ productId: "507f1f77bcf86cd799439011", options: [], removed: [], qty: 1 }],
  payment: { method: "online" as const },
  pickup: { slot: "2030-01-10T12:00:00.000Z", customerName: "Client Test", customerPhone: "0600000000" },
  note: "Sans oignons",
};
const fingerprint = "a".repeat(64);
const receipt = { orderId: "507f1f77bcf86cd799439012", trackingToken: "local-test-tracking-token", number: 42 };
const deliveryPayload = { ...payload, fulfillment: "delivery" as const, delivery: { address: { line1: "1 rue de Test", postalCode: "27910", city: "Ville Test", country: "FR" as const } } };
const dbName = "sm.checkout-attempts";
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;

// Real browser IndexedDB: no memory adapter, no Next server, no remote API.
beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("./checkout-attempt.ts", import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/journal.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>Checkout journal native tests</title><script type="module">import * as journal from "/journal.js";window.checkoutJournal=journal;</script>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local test port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: "block" });
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => !!window.checkoutJournal);
});
afterEach(async () => { await context?.close(); });
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const acquire = (target = page, tenant = "classfood") => target.evaluate(
  ({ tenant, payload, fingerprint }) => window.checkoutJournal.acquireCheckoutAttempt(tenant, { payload, cartFingerprint: fingerprint }),
  { tenant, payload, fingerprint },
);
const acquireDelivery = () => page.evaluate(({ payload, fingerprint }) => window.checkoutJournal.acquireCheckoutAttempt("classfood", { payload, cartFingerprint: fingerprint }), { payload: deliveryPayload, fingerprint });

function visibleReceipt(value: Journal.ReceivedCheckoutAttempt | Journal.PrivateSettledCheckoutAttempt): Journal.ReceivedCheckoutAttempt {
  if (value.state !== "received") throw new Error("Expected the guest receipt to remain visible");
  return value;
}

describe("suivis de commandes sur cet appareil, IndexedDB natif", () => {
  const read = (target = page, tenant = "classfood") => target.evaluate(tenant => window.checkoutJournal.readDeviceCheckoutReceipts(tenant), tenant);
  const receive = async (delivery = false, orderId = receipt.orderId) => {
    const { attempt } = await (delivery ? acquireDelivery() : acquire());
    return visibleReceipt(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), {
      id: attempt.clientId, receipt: { ...receipt, orderId, type: delivery ? "delivery" as const : "pickup" as const },
    }));
  };
  const archive = (received: Journal.ReceivedCheckoutAttempt) => page.evaluate(id => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), received.clientId);

  it("conserve retrait et livraison après recharge, sans corps ni capacité privée dans le magasin ou sa projection", async () => {
    const pickup = await receive(); await archive(pickup);
    const delivery = await receive(true, "d".repeat(24));
    await page.reload(); await page.waitForFunction(() => !!window.checkoutJournal);
    const rows = await read();
    expect(rows.map(row => row.receipt.orderId)).toEqual([delivery.receipt.orderId, pickup.receipt.orderId]);
    expect(rows.every(row => !("payload" in row) && !("recoveryProof" in row.receipt))).toBe(true);
    expect(await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts");
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction("device-receipts");
        const get = tx.objectStore("device-receipts").getAll();
        get.onsuccess = () => resolve(get.result.every(row => !("payload" in row) && !("recoveryProof" in row.receipt)));
        tx.oncomplete = () => db.close(); tx.onabort = () => { db.close(); reject(tx.error); };
      }; open.onerror = () => reject(open.error);
    }))).toBe(true);
    expect(await read(page, "other")).toEqual([]);
    const otherOrigin = await context.newPage(); await otherOrigin.goto(origin.replace("127.0.0.1", "localhost"));
    await otherOrigin.waitForFunction(() => !!window.checkoutJournal);
    expect(await read(otherOrigin)).toEqual([]);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(delivery);
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), delivery.receipt.orderId)).toEqual(delivery);
  });

  it("refuse l’oubli actif avec conflict puis oublie le suivi et son alias, jamais l’accès privé ni la tentative suivante", async () => {
    const received = await receive(true);
    expect(await page.evaluate(async id => {
      try { await window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id); return null; }
      catch (error) { return { code: (error as Journal.CheckoutAttemptStorageError).code, message: (error as Error).message }; }
    }, received.receipt.orderId)).toEqual({ code: "conflict", message: "Commencez une nouvelle commande avant d’oublier ce suivi encore actif." });
    await archive(received);
    const pending = await acquire();
    await page.evaluate(id => window.checkoutJournal.markCheckoutAttemptUncertain("classfood", id), pending.attempt.clientId);
    const uncertain = await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"));
    await page.evaluate(id => window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id), received.receipt.orderId);
    await page.reload(); await page.waitForFunction(() => !!window.checkoutJournal);
    expect(await read()).toEqual([]);
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toBeNull();
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(uncertain);
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), received.receipt.orderId)).toEqual(received);
  });

  it("annule reçu actif, suivi et accès de remise si l’écriture du suivi échoue avant le commit", async () => {
    const { attempt } = await acquireDelivery();
    const result = await page.evaluate(async ({ id, receipt }) => {
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        const request = original.apply(this, args);
        if (this.name === "device-receipts") request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let wouldClearCart = false;
      try { await window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt); wouldClearCart = true; }
      catch { /* Required atomic refusal. */ }
      finally { IDBObjectStore.prototype.add = original; }
      return { wouldClearCart, active: await window.checkoutJournal.readCheckoutAttempt("classfood"), rows: await window.checkoutJournal.readDeviceCheckoutReceipts("classfood"), proof: await window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", receipt.orderId) };
    }, { id: attempt.clientId, receipt });
    expect(result).toEqual({ wouldClearCart: false, active: attempt, rows: [], proof: null });
  });

  it.each([1, 2])("migre v%i : seulement active/last reçus, sans modifier les originaux ni importer les accès privés", async version => {
    const now = Date.now();
    const base = { v: 1 as const, tenant: "classfood", origin, clientId: "11111111-1111-4111-8111-111111111111", cartFingerprint: fingerprint, createdAt: now - 100, updatedAt: now, state: "received" as const };
    const active = { ...base, receipt: { ...receipt, recoveryProof: "b".repeat(64) } };
    const last = { ...base, clientId: "22222222-2222-4222-8222-222222222222", receipt: { ...receipt, orderId: "e".repeat(24) } };
    const imported = { v: 1, state: "imported", tenant: "classfood", origin, clientId: base.clientId, updatedAt: now, receipt: { orderId: "f".repeat(24), recoveryProof: "c".repeat(64) } };
    await page.evaluate(({ version, active, last, imported }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts", version);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("active", { keyPath: "tenant" }).put(active);
        open.result.createObjectStore("last-receipt", { keyPath: "tenant" }).put(last);
        if (version === 2) {
          const proofs = open.result.createObjectStore("delivery-receipts", { keyPath: ["tenant", "receipt.orderId"] });
          proofs.put(imported); proofs.put({ ...active, receipt: { ...active.receipt, orderId: "a".repeat(24) } });
        }
      };
      open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
    }), { version, active, last, imported });
    const rows = await read();
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.receipt.orderId).sort()).toEqual([active.receipt.orderId, last.receipt.orderId].sort());
    expect(rows.every(row => !("recoveryProof" in row.receipt))).toBe(true);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(active);
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toEqual(last);
    if (version === 2) expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), imported.receipt.orderId)).toEqual(imported);
  });

  it("la rétention dure sept jours depuis le reçu, passe minuit et n’est prolongée ni par replay, ni par archive/reload", async () => {
    await page.clock.setFixedTime(new Date("2030-01-01T23:59:00Z"));
    const received = await receive();
    await page.clock.setFixedTime(new Date(received.updatedAt + 60_000));
    expect(await read()).toHaveLength(1);
    await page.clock.setFixedTime(new Date(received.updatedAt + 6 * 86_400_000));
    const replayed = await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), {
      id: received.clientId, receipt: received.receipt,
    });
    expect(replayed.updatedAt).toBe(received.updatedAt);
    await archive(received); await page.reload(); await page.waitForFunction(() => !!window.checkoutJournal);
    await page.clock.setFixedTime(new Date(received.updatedAt + 7 * 86_400_000 - 1));
    expect((await read())[0].updatedAt).toBe(received.updatedAt);
    const pending = await acquire();
    await page.evaluate(id => window.checkoutJournal.markCheckoutAttemptUncertain("classfood", id), pending.attempt.clientId);
    const before = await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"));
    await page.clock.setFixedTime(new Date(received.updatedAt + 7 * 86_400_000));
    expect(await read()).toEqual([]);
    expect(await page.evaluate(orderId => new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts");
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction("device-receipts");
        const get = tx.objectStore("device-receipts").get(["classfood", orderId]);
        tx.oncomplete = () => { db.close(); resolve(get.result === undefined); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      }; open.onerror = () => reject(open.error);
    }), received.receipt.orderId)).toBe(true);
    // Shortcut expiry is not reconciliation or erasure of the last/active receipt.
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toEqual(received);
    await page.clock.setFixedTime(new Date(received.updatedAt + 60 * 86_400_000));
    expect((await acquire()).attempt).toEqual(before);
  });

  it("réserve le 128e suivi avant admission entre deux onglets et refuse le 129e sans perdre les précédents", async () => {
    const first = await receive(); await archive(first);
    await page.evaluate(received => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts");
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction("device-receipts", "readwrite");
        for (let index = 1; index <= 126; index++) tx.objectStore("device-receipts").add({ ...received, receipt: { ...received.receipt, orderId: index.toString(16).padStart(24, "0") } });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      }; open.onerror = () => reject(open.error);
    }), first);
    const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => !!window.checkoutJournal);
    const attempts = await Promise.all([acquire(), acquire(second)]);
    expect(attempts.filter(item => item.acquired)).toHaveLength(1);
    expect(attempts[0].attempt.clientId).toBe(attempts[1].attempt.clientId);
    const received = visibleReceipt(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), {
      id: attempts[0].attempt.clientId, receipt: { ...receipt, orderId: "f".repeat(24) },
    }));
    await archive(received);
    const before = await read(); expect(before).toHaveLength(128);
    const denied = await Promise.allSettled([acquire(), acquire(second)]);
    expect(denied.every(item => item.status === "rejected" && (item.reason as Error).message.includes("128"))).toBe(true);
    expect(await read()).toEqual(before);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    await page.evaluate(id => window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id), first.receipt.orderId);
    expect((await acquire(second)).acquired).toBe(true);
    expect(await read()).toHaveLength(127);
  });

  it("sérialise oubli et nouveau reçu entre deux onglets sans effacer le nouveau suivi ni ressusciter l’ancien", async () => {
    const previous = await receive(true); await archive(previous);
    const next = await acquire();
    const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => !!window.checkoutJournal);
    const [, recorded] = await Promise.all([
      second.evaluate(id => window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id), previous.receipt.orderId),
      page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), {
        id: next.attempt.clientId, receipt: { ...receipt, orderId: "f".repeat(24) },
      }),
    ]);
    const current = visibleReceipt(recorded);
    expect((await read(second)).map(row => row.receipt.orderId)).toEqual([current.receipt.orderId]);
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), previous.receipt.orderId)).toEqual(previous);
    await archive(current); await second.reload(); await second.waitForFunction(() => !!window.checkoutJournal);
    expect((await read(second)).map(row => row.receipt.orderId)).toEqual([current.receipt.orderId]);
    expect(await second.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toEqual(current);
  });

  it("l’oubli interrompu annule aussi la suppression de l’alias et ne touche jamais une tentative prepared", async () => {
    const received = await receive(); await archive(received); const pending = await acquire();
    const result = await page.evaluate(async id => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        const request = original.apply(this, args);
        if (this.name === "device-receipts") request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let forgotten = false;
      try { await window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id); forgotten = true; }
      catch { /* Must preserve both shortcuts on abort. */ }
      finally { IDBObjectStore.prototype.delete = original; }
      return { forgotten, rows: await window.checkoutJournal.readDeviceCheckoutReceipts("classfood"), last: await window.checkoutJournal.readLastCheckoutReceipt("classfood"), active: await window.checkoutJournal.readCheckoutAttempt("classfood") };
    }, received.receipt.orderId);
    expect(result.forgotten).toBe(false); expect(result.rows).toEqual([received]);
    expect(result.last).toEqual(received); expect(result.active).toEqual(pending.attempt);
  });

  it.each(["proof", "payload", "future", "origin"])("une projection corrompue (%s) bloque lecture et admission sans effacement", async fault => {
    const received = await receive(); await archive(received);
    await page.evaluate(({ fault, received }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts");
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction("device-receipts", "readwrite");
        const row = structuredClone(received) as unknown as Record<string, unknown>;
        if (fault === "proof") row.receipt = { ...received.receipt, recoveryProof: "a".repeat(64) };
        if (fault === "payload") row.payload = { note: "must-not-exist" };
        if (fault === "future") row.updatedAt = Date.now() + 86_400_000;
        if (fault === "origin") row.origin = "https://other.invalid";
        tx.objectStore("device-receipts").put(row);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      }; open.onerror = () => reject(open.error);
    }), { fault, received });
    await expect(read()).rejects.toThrow("endommagé");
    await expect(acquire()).rejects.toThrow("endommagé");
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
      const open = indexedDB.open("sm.checkout-attempts");
      open.onsuccess = () => { const db = open.result; const tx = db.transaction("device-receipts"); const count = tx.objectStore("device-receipts").count(); count.onsuccess = () => resolve(count.result); tx.oncomplete = () => db.close(); };
      open.onerror = () => reject(open.error);
    }))).toBe(1);
  });

  it("notifie les ajouts et oublis après commit, sans notification de lecture ni données du reçu", async () => {
    const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => !!window.checkoutJournal);
    await second.evaluate(() => {
      const events: string[] = []; Object.assign(window, { deviceReceiptEvents: events });
      window.checkoutJournal.subscribeCheckoutAttempts(tenant => events.push(tenant));
    });
    const received = await receive(); await archive(received);
    await second.waitForFunction(() => (window as unknown as { deviceReceiptEvents: string[] }).deviceReceiptEvents.length === 3);
    await read(); await read(second);
    await page.evaluate(id => window.checkoutJournal.forgetDeviceCheckoutReceipt("classfood", id), received.receipt.orderId);
    await second.waitForFunction(() => (window as unknown as { deviceReceiptEvents: string[] }).deviceReceiptEvents.length === 4);
    expect(await second.evaluate(() => (window as unknown as { deviceReceiptEvents: string[] }).deviceReceiptEvents)).toEqual(Array(4).fill("classfood"));
    expect(await read(second)).toEqual([]);
  });

  it("une migration interrompue restaure la version v2, sa tentative incertaine et ses alias intacts", async () => {
    const now = Date.now();
    const old = { v: 1, tenant: "classfood", origin, clientId: "11111111-1111-4111-8111-111111111111", cartFingerprint: fingerprint, createdAt: now, updatedAt: now, state: "uncertain", recoveryProof: "b".repeat(64), payload };
    const last = { v: 1, tenant: "classfood", origin, clientId: "22222222-2222-4222-8222-222222222222", cartFingerprint: fingerprint, createdAt: now, updatedAt: now, state: "received", receipt };
    const after = await page.evaluate(async ({ old, last }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("sm.checkout-attempts", 2);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("active", { keyPath: "tenant" }).put(old);
          open.result.createObjectStore("last-receipt", { keyPath: "tenant" }).put(last);
          open.result.createObjectStore("delivery-receipts", { keyPath: ["tenant", "receipt.orderId"] });
        };
        open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
      });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === "device-receipts") request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let failed = false;
      try { await window.checkoutJournal.readDeviceCheckoutReceipts("classfood"); }
      catch { failed = true; }
      finally { IDBObjectStore.prototype.put = put; }
      return new Promise<{ failed: boolean; version: number; hasStore: boolean; active: unknown; last: unknown }>((resolve, reject) => {
        const open = indexedDB.open("sm.checkout-attempts");
        open.onsuccess = () => {
          const db = open.result; const tx = db.transaction(["active", "last-receipt"]);
          const active = tx.objectStore("active").get("classfood"); const last = tx.objectStore("last-receipt").get("classfood");
          tx.oncomplete = () => { const result = { failed, version: db.version, hasStore: db.objectStoreNames.contains("device-receipts"), active: active.result, last: last.result }; db.close(); resolve(result); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        }; open.onerror = () => reject(open.error);
      });
    }, { old, last });
    expect(after).toEqual({ failed: true, version: 2, hasStore: false, active: old, last });
    expect(await read()).toEqual([last]);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(old);
  });
});

describe("journal de checkout durable, IndexedDB natif", () => {
  const importedAccess = { clientId: "a0010000-0000-4000-8000-000000000001", recoveryProof: "9".repeat(64) };
  const confirmation = { missionId: receipt.orderId, proofId: "a0010000-0000-4000-8000-000000000002", pin: "654321",
    qr: `sm-handoff:v1:${receipt.orderId}:a0010000-0000-4000-8000-000000000002:${"b".repeat(43)}`, expiresAt: "2030-09-07T13:00:00.000Z" };
  it("importe un accès vérifié sur une nouvelle origine sans créer une tentative et le restaure après reload", async () => {
    const other = await context.newPage(); await other.goto(origin.replace("127.0.0.1", "localhost"));
    await other.waitForFunction(() => !!window.checkoutJournal);
    await other.evaluate(({ access, confirmation }) => window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", confirmation.missionId, access, confirmation), { access: importedAccess, confirmation });
    await other.reload(); await other.waitForFunction(() => !!window.checkoutJournal);
    const saved = await other.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId);
    expect(saved).toMatchObject({ state: "imported", clientId: importedAccess.clientId, receipt: { orderId: receipt.orderId, recoveryProof: importedAccess.recoveryProof } });
    expect(JSON.stringify(saved)).not.toContain(confirmation.pin); expect(saved).not.toHaveProperty("payload"); expect(saved).not.toHaveProperty("cartFingerprint");
    expect(await other.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    expect(await other.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toBeNull();
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId)).toBeNull();
    expect(await other.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("other", id), receipt.orderId)).toBeNull();
    await other.close();
  });
  it("refuse un import non concordant ou contenant un secret supplémentaire avant écriture", async () => {
    await expect(page.evaluate(({ access, confirmation }) => window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", "f".repeat(24), access, confirmation), { access: importedAccess, confirmation })).rejects.toThrow("invalide");
    await expect(page.evaluate(({ access, confirmation }) => window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", confirmation.missionId, { ...access, pin: confirmation.pin }, confirmation), { access: importedAccess, confirmation })).rejects.toThrow();
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId)).toBeNull();
  });
  it("un reçu importé expiré ne confirme pas un nouvel import et ne prolonge pas sa rétention", async () => {
    await page.evaluate(({ access, confirmation }) => window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", confirmation.missionId, access, confirmation), { access: importedAccess, confirmation });
    await page.clock.install({ time: Date.now() + 7 * 86_400_000 });
    await expect(page.evaluate(({ access, confirmation }) => window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", confirmation.missionId, access, confirmation), { access: importedAccess, confirmation })).rejects.toThrow("stockage");
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId)).toBeNull();
  });
  it("l’attestation C01 avant paiement exige ordre, type et jeton de suivi exacts, sans fabriquer de preuve PIN", async () => {
    const result = { state: "created", order: { _id: receipt.orderId, number: 42, status: "new", type: "delivery", trackingToken: receipt.trackingToken,
      payment: { method: "online", status: "pending" }, totals: { total: 1500 }, pickup: { slot: "2030-01-10T12:00:00.000Z" } } };
    for (const invalid of [{ state: "pending" }, { ...result, order: { ...result.order, _id: "f".repeat(24) } },
      { ...result, order: { ...result.order, type: "pickup" } }, { ...result, order: { ...result.order, trackingToken: "other" } }]) {
      await expect(page.evaluate(({ access, receipt, result }) => window.checkoutJournal.importRecoveredDeliveryReceipt("classfood", receipt.orderId, receipt.trackingToken, access, result), { access: importedAccess, receipt, result: invalid })).rejects.toThrow();
    }
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId)).toBeNull();
    await page.evaluate(({ access, receipt, result }) => window.checkoutJournal.importRecoveredDeliveryReceipt("classfood", receipt.orderId, receipt.trackingToken, access, result), { access: importedAccess, receipt, result });
    expect(await page.evaluate(id => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), receipt.orderId)).toMatchObject({ state: "imported", clientId: importedAccess.clientId });
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
  });
  it("un import ne consomme jamais la place réservée à une livraison incertaine et ne purge pas les 127 autres", async () => {
    await acquireDelivery();
    const result = await page.evaluate(async ({ access, confirmation }) => {
      for (let index = 0; index < 127; index++) {
        const id = index.toString(16).padStart(24, "0");
        const proof = { ...confirmation, missionId: id, qr: confirmation.qr.replace(confirmation.missionId, id) };
        await window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", id, access, proof);
      }
      const before = await window.checkoutJournal.readCheckoutAttempt("classfood");
      let refused = false;
      try { await window.checkoutJournal.importVerifiedDeliveryReceipt("classfood", confirmation.missionId, access, confirmation); } catch { refused = true; }
      return { refused, unchanged: JSON.stringify(before) === JSON.stringify(await window.checkoutJournal.readCheckoutAttempt("classfood")), first: await window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", "0".repeat(24)) };
    }, { access: importedAccess, confirmation });
    expect(result.refused).toBe(true); expect(result.unchanged).toBe(true); expect(result.first?.state).toBe("imported");
  });
  it("crée et relit après recharge une identité cryptographique et un corps immuable", async () => {
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    const created = await acquire();
    expect(created.acquired).toBe(true);
    expect(created.attempt).toMatchObject({ state: "prepared", payload, cartFingerprint: fingerprint, tenant: "classfood", origin, v: 2, provenance: { kind: "guest" } });
    expect(created.attempt.clientId).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
    expect("recoveryProof" in created.attempt && created.attempt.recoveryProof).toMatch(/^[a-f\d]{64}$/);
    expect(await page.evaluate(async () => {
      const saved = await window.checkoutJournal.readCheckoutAttempt("classfood");
      return saved && "payload" in saved && Object.isFrozen(saved) && Object.isFrozen(saved.payload) && Object.isFrozen(saved.payload.lines[0]);
    })).toBe(true);
    await page.reload();
    await page.waitForFunction(() => !!window.checkoutJournal);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(created.attempt);
    const next = await page.evaluate(({ payload, fingerprint }) => window.checkoutJournal.acquireCheckoutAttempt("classfood", {
      payload: { ...payload, note: "Une autre commande" }, cartFingerprint: fingerprint,
    }), { payload, fingerprint });
    expect(next).toEqual({ acquired: false, attempt: created.attempt });
  });

  it("acquiert atomiquement une seule tentative entre deux onglets", async () => {
    const second = await context.newPage();
    await second.goto(origin);
    await second.waitForFunction(() => !!window.checkoutJournal);
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => acquire(i % 2 ? page : second)));
    expect(attempts.filter((result) => result.acquired)).toHaveLength(1);
    expect(new Set(attempts.map((result) => result.attempt.clientId)).size).toBe(1);
    expect(new Set(attempts.map((result) => "recoveryProof" in result.attempt ? result.attempt.recoveryProof : "")).size).toBe(1);
  });

  it("isole les établissements et les origines", async () => {
    const first = await acquire();
    const other = await acquire(page, "pizza-vita");
    expect(other.attempt.clientId).not.toBe(first.attempt.clientId);
    const otherOrigin = await context.newPage();
    await otherOrigin.goto(origin.replace("127.0.0.1", "localhost"));
    await otherOrigin.waitForFunction(() => !!window.checkoutJournal);
    expect(await otherOrigin.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
  });

  it("conserve indéfiniment une tentative incertaine et refuse son archivage", async () => {
    const { attempt } = await acquire();
    await page.evaluate((id) => window.checkoutJournal.markCheckoutAttemptUncertain("classfood", id), attempt.clientId);
    await page.clock.install({ time: new Date("2099-01-01T00:00:00Z") });
    const reused = await acquire();
    expect(reused.attempt).toMatchObject({ clientId: attempt.clientId, state: "uncertain", payload });
    await expect(page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId)).rejects.toThrow("réconciliée");
    expect((await acquire()).attempt.clientId).toBe(attempt.clientId);
  });

  it("enregistre le reçu puis supprime le corps et la preuve ; archive explicitement sans perdre le suivi", async () => {
    const { attempt } = await acquire();
    const received = visibleReceipt(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt }));
    expect(received).toMatchObject({ clientId: attempt.clientId, state: "received", receipt, cartFingerprint: fingerprint });
    expect(received).not.toHaveProperty("payload");
    expect(received).not.toHaveProperty("recoveryProof");
    expect(received.receipt).toEqual(receipt);
    expect(JSON.stringify(received)).not.toContain(payload.pickup.customerName);
    expect((await acquire()).acquired).toBe(false);
    await page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toEqual(received);
    const next = await acquire();
    expect(next.acquired).toBe(true);
    expect(next.attempt.clientId).not.toBe(attempt.clientId);
    await expect(page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId)).rejects.toThrow("autre tentative");
    expect((await acquire()).attempt.clientId).toBe(next.attempt.clientId);
  });

  it("ne remplace jamais un reçu connu par une autre commande ou un autre jeton", async () => {
    const { attempt } = await acquire();
    await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    for (const mismatch of [{ ...receipt, orderId: "another-order" }, { ...receipt, trackingToken: "other-token" }]) {
      await expect(page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt: mismatch })).rejects.toThrow("autre commande");
    }
    expect(await page.evaluate((id) => window.checkoutJournal.markCheckoutAttemptUncertain("classfood", id), attempt.clientId)).toMatchObject({ state: "received", receipt });
  });

  it("conserve uniquement la capacité privée initiale de livraison dans le reçu, y compris après recharge et archivage", async () => {
    const { attempt } = await acquireDelivery();
    if (!("recoveryProof" in attempt)) throw new Error("Expected pending attempt");
    const received = await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    expect(received).toMatchObject({ clientId: attempt.clientId, state: "received", receipt: { ...receipt, recoveryProof: attempt.recoveryProof } });
    expect(received).not.toHaveProperty("payload");
    expect(received).not.toHaveProperty("recoveryProof");
    for (const privateText of ["Client Test", "Sans oignons", "1 rue de Test", "Ville Test", "0600000000"]) expect(JSON.stringify(received)).not.toContain(privateText);
    await page.reload();
    await page.waitForFunction(() => !!window.checkoutJournal);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(received);
    expect(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt })).toEqual(received);
    await page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId);
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toEqual(received);
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("other-restaurant"))).toBeNull();
    const otherOrigin = await context.newPage();
    await otherOrigin.goto(origin.replace("127.0.0.1", "localhost"));
    await otherOrigin.waitForFunction(() => !!window.checkoutJournal);
    expect(await otherOrigin.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toBeNull();
  });

  it("retrouve chaque reçu privé après plusieurs commandes, sans mélanger restaurant, ordre ni origine", async () => {
    const saved: Journal.ReceivedCheckoutAttempt[] = [];
    for (let index = 1; index <= 3; index++) {
      const { attempt } = await acquireDelivery();
      const nextReceipt = { ...receipt, orderId: index.toString(16).padStart(24, "0") };
      saved.push(visibleReceipt(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt: nextReceipt })));
      await page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId);
    }
    await page.reload(); await page.waitForFunction(() => !!window.checkoutJournal);
    for (const expected of saved) {
      expect(await page.evaluate((id) => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), expected.receipt.orderId)).toEqual(expected);
      expect(await page.evaluate((id) => window.checkoutJournal.readDeliveryCheckoutReceipt("other", id), expected.receipt.orderId)).toBeNull();
    }
    expect(await page.evaluate(() => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", "f".repeat(24)))).toBeNull();
  });

  it("refuse une nouvelle livraison avant POST à 128 reçus privés puis purge seulement les reçus anciens", async () => {
    const { attempt } = await acquireDelivery();
    const received = visibleReceipt(await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt }));
    await page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId);
    await page.evaluate(({ dbName, received }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("delivery-receipts", "readwrite");
        const store = tx.objectStore("delivery-receipts");
        for (let index = 1; index <= 126; index++) store.put({ ...received, receipt: { ...received.receipt, orderId: index.toString(16).padStart(24, "0") } });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      open.onerror = () => reject(open.error);
    }), { dbName, received });
    const available = await acquireDelivery();
    expect(available.acquired).toBe(true);
    await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: available.attempt.clientId, receipt: { ...receipt, orderId: "e".repeat(24) } });
    await page.evaluate(id => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), available.attempt.clientId);
    await expect(acquireDelivery()).rejects.toThrow("128");
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    await page.clock.install({ time: new Date(Date.now() + 8 * 86_400_000) });
    expect(await page.evaluate((id) => window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", id), received.receipt.orderId)).toBeNull();
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).not.toHaveProperty("receipt.recoveryProof");
    const next = await acquireDelivery();
    expect(next.acquired).toBe(true);
    await page.evaluate((id) => window.checkoutJournal.markCheckoutAttemptUncertain("classfood", id), next.attempt.clientId);
    await page.clock.setSystemTime(new Date(Date.now() + 60 * 86_400_000));
    expect((await acquireDelivery()).attempt.clientId).toBe(next.attempt.clientId);
    expect((await acquireDelivery()).attempt.state).toBe("uncertain");
  });

  it.each([1, 2])("migre v%i sans perdre une tentative incertaine ni recréer son identité", async version => {
    const old = { v: 1, tenant: "classfood", origin, clientId: "11111111-1111-4111-8111-111111111111", recoveryProof: "b".repeat(64), cartFingerprint: fingerprint, createdAt: 1, updatedAt: 1, state: "uncertain", payload };
    await page.evaluate(({ dbName, old, version }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(dbName, version);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("active", { keyPath: "tenant" }).put(old);
        open.result.createObjectStore("last-receipt", { keyPath: "tenant" });
        if (version === 2) open.result.createObjectStore("delivery-receipts", { keyPath: ["tenant", "receipt.orderId"] });
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => reject(open.error);
    }), { dbName, old, version });
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(old);
    expect(await acquire()).toEqual({ acquired: false, attempt: old });
  });

  it("ne confirme pas le reçu si la copie privée par commande échoue : toute la transaction est annulée", async () => {
    const { attempt } = await acquireDelivery();
    const after = await page.evaluate(async ({ id, receipt }) => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        const request = add.apply(this, args);
        if (this.name === "delivery-receipts") request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let receiptSaved = false;
      try { await window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt); receiptSaved = true; } catch { /* Atomic rollback expected. */ }
      finally { IDBObjectStore.prototype.add = add; }
      return { receiptSaved, current: await window.checkoutJournal.readCheckoutAttempt("classfood"), private: await window.checkoutJournal.readDeliveryCheckoutReceipt("classfood", receipt.orderId) };
    }, { id: attempt.clientId, receipt });
    expect(after).toEqual({ receiptSaved: false, current: attempt, private: null });
  });

  it("refuse toute preuve injectée dans le reçu serveur et conserve l’original privé intact", async () => {
    const { attempt } = await acquire();
    await expect(page.evaluate(({ id, receipt }) => {
      const injected = { ...receipt, recoveryProof: "b".repeat(64) };
      return window.checkoutJournal.recordCheckoutReceipt("classfood", id, injected);
    }, { id: attempt.clientId, receipt })).rejects.toThrow("invalide");
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toEqual(attempt);
  });

  it("relit les reçus historiques sans capacité et refuse une capacité corrompue sans effacement", async () => {
    const { attempt } = await acquire();
    await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toMatchObject({ state: "received", receipt });
    await page.evaluate((dbName) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("active", "readwrite");
        const store = tx.objectStore("active");
        const get = store.get("classfood");
        get.onsuccess = () => { store.put({ ...get.result, receipt: { ...get.result.receipt, recoveryProof: "invalid" } }); };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), dbName);
    await expect(page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).rejects.toThrow("endommagé");
    await expect(page.evaluate((id) => window.checkoutJournal.archiveCheckoutAttempt("classfood", id), attempt.clientId)).rejects.toThrow("endommagé");
  });

  it("ne libère un rejet qu’après preuve serveur enregistrée, et efface ses données détaillées", async () => {
    const { attempt } = await acquire();
    await expect(page.evaluate((id) => window.checkoutJournal.releaseRejectedCheckoutAttempt("classfood", id), attempt.clientId)).rejects.toThrow("rejet");
    const rejected = await page.evaluate((id) => window.checkoutJournal.recordCheckoutRejection("classfood", id, {
      reason: "slot_unavailable", message: "Ce créneau n’est plus disponible.",
    }), attempt.clientId);
    expect(rejected).toMatchObject({ state: "rejected", clientId: attempt.clientId, rejection: { reason: "slot_unavailable" } });
    expect(rejected).not.toHaveProperty("payload");
    expect(rejected).not.toHaveProperty("recoveryProof");
    expect((await acquire()).attempt.clientId).toBe(attempt.clientId);
    await expect(page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt })).rejects.toThrow("rejet");
    await page.evaluate((id) => window.checkoutJournal.releaseRejectedCheckoutAttempt("classfood", id), attempt.clientId);
    const next = await acquire();
    expect(next.attempt.clientId).not.toBe(attempt.clientId);
    await expect(page.evaluate((id) => window.checkoutJournal.releaseRejectedCheckoutAttempt("classfood", id), attempt.clientId)).rejects.toThrow("autre tentative");
    expect((await acquire()).attempt.clientId).toBe(next.attempt.clientId);
    expect(await page.evaluate(() => window.checkoutJournal.readLastCheckoutReceipt("classfood"))).toBeNull();
  });

  it("refuse d’effacer un reçu créé avec un rejet tardif contradictoire", async () => {
    const { attempt } = await acquire();
    await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    await expect(page.evaluate((id) => window.checkoutJournal.recordCheckoutRejection("classfood", id, {
      reason: "abandoned", message: "Tentative abandonnée.",
    }), attempt.clientId)).rejects.toThrow("reçu");
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toMatchObject({ state: "received", receipt });
  });

  it("notifie le document et un autre onglet après commit, uniquement avec le tenant", async () => {
    const second = await context.newPage();
    await second.goto(origin);
    await second.waitForFunction(() => !!window.checkoutJournal);
    const register = (target: Page) => target.evaluate(() => {
      const events: string[] = [];
      Object.assign(window, { journalTestEvents: events });
      window.checkoutJournal.subscribeCheckoutAttempts((tenant) => { events.push(tenant); });
    });
    await Promise.all([register(page), register(second)]);
    await acquire();
    await second.waitForFunction(() => (window as unknown as { journalTestEvents: string[] }).journalTestEvents.length === 1);
    for (const target of [page, second]) {
      expect(await target.evaluate(() => (window as unknown as { journalTestEvents: string[] }).journalTestEvents)).toEqual(["classfood"]);
      expect(await target.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toMatchObject({ state: "prepared" });
    }
  });

  it("attend le commit strict, pas le succès de la requête ; un abort interdit le POST", async () => {
    const result = await page.evaluate(async ({ payload, fingerprint }) => {
      const events: string[] = [];
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        const request = original.apply(this, args);
        request.addEventListener("success", () => {
          events.push("request-success");
          this.transaction.abort();
        });
        return request;
      };
      try {
        await window.checkoutJournal.acquireCheckoutAttempt("classfood", { payload, cartFingerprint: fingerprint });
        events.push("would-POST");
      } catch { events.push("failed-closed"); }
      IDBObjectStore.prototype.add = original;
      return { events, after: await window.checkoutJournal.readCheckoutAttempt("classfood") };
    }, { payload, fingerprint });
    expect(result).toEqual({ events: ["request-success", "failed-closed"], after: null });
  });

  it("un échec d’écriture du reçu conserve la tentative et sa preuve de reprise", async () => {
    const { attempt } = await acquire();
    const result = await page.evaluate(async ({ id, receipt }) => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args);
        request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let cartCleared = false;
      try { await window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt); cartCleared = true; } catch { /* Expected durable refusal. */ }
      IDBObjectStore.prototype.put = original;
      return { cartCleared, after: await window.checkoutJournal.readCheckoutAttempt("classfood") };
    }, { id: attempt.clientId, receipt });
    expect(result.cartCleared).toBe(false);
    expect(result.after).toEqual(attempt);
  });

  it("un archivage interrompu garde le reçu actif et interdit une nouvelle identité", async () => {
    const { attempt } = await acquire();
    await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    const result = await page.evaluate(async (id) => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (...args) {
        const request = original.apply(this, args);
        request.addEventListener("success", () => this.transaction.abort());
        return request;
      };
      let archived = false;
      try { await window.checkoutJournal.archiveCheckoutAttempt("classfood", id); archived = true; } catch { /* Expected rollback. */ }
      IDBObjectStore.prototype.delete = original;
      return { archived, current: await window.checkoutJournal.readCheckoutAttempt("classfood"), last: await window.checkoutJournal.readLastCheckoutReceipt("classfood") };
    }, attempt.clientId);
    expect(result).toMatchObject({ archived: false, current: { state: "received", receipt }, last: null });
    expect((await acquire()).attempt.clientId).toBe(attempt.clientId);
  });

  it("refuse un stockage interdit sans fallback mémoire", async () => {
    await page.evaluate(() => { Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } }); });
    await expect(acquire()).rejects.toThrow("stockage");
    await expect(page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).rejects.toThrow("stockage");
  });

  it("refuse le mode de durabilité relâchée et l’absence de crypto fiable", async () => {
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode) { return original.call(this, stores, mode, { durability: "relaxed" }); };
    });
    await expect(acquire()).rejects.toThrow("stockage");
    await page.reload();
    await page.waitForFunction(() => !!window.checkoutJournal);
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    await page.evaluate(() => { Object.defineProperty(window, "crypto", { value: {}, configurable: true }); });
    await expect(acquire()).rejects.toThrow("stockage");
  });

  it("détecte un schéma physique endommagé sans effacer le reçu actif", async () => {
    await page.evaluate((dbName) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("active", { keyPath: "tenant" });
        request.result.createObjectStore("last-receipt", { keyPath: "wrong" });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    }), dbName);
    await expect(acquire()).rejects.toThrow("endommagé");
  });

  it.each(["version", "payload", "tenant", "proof", "extra-secret"])("bloque une ligne corrompue (%s) sans la supprimer", async (fault) => {
    await acquire();
    await page.evaluate(({ dbName, fault }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("active", "readwrite");
        const store = tx.objectStore("active");
        const get = store.get("classfood");
        get.onsuccess = () => {
          const row = get.result;
          if (fault === "version") row.v = 99;
          if (fault === "payload") row.payload.lines = [];
          if (fault === "tenant") row.origin = "https://wrong-origin.invalid";
          if (fault === "proof") row.recoveryProof = "not-crypto";
          if (fault === "extra-secret") row.turnstileToken = "should-never-exist";
          store.put(row);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { dbName, fault });
    await expect(acquire()).rejects.toThrow("endommagé");
    await expect(page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).rejects.toThrow("endommagé");
  });

  it("ne journalise ni Turnstile ni secrets Stripe passés par erreur", async () => {
    for (const forbidden of ["turnstileToken", "clientSecret", "stripeAccount", "recoveryProof", "clientId"]) {
      await expect(page.evaluate(({ payload, fingerprint, forbidden }) => window.checkoutJournal.acquireCheckoutAttempt("classfood", {
        payload: { ...payload, [forbidden]: "private-value" }, cartFingerprint: fingerprint,
      }), { payload, fingerprint, forbidden })).rejects.toThrow("invalide");
    }
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
  });

  it("produit une empreinte SHA-256 canonique sans conserver les notes personnelles", async () => {
    const results = await page.evaluate(async () => Promise.all([
      window.checkoutJournal.checkoutCartFingerprint({ note: "Confidentiel", lines: [{ qty: 1, id: "line-1" }] }),
      window.checkoutJournal.checkoutCartFingerprint({ lines: [{ id: "line-1", qty: 1 }], note: "Confidentiel" }),
      window.checkoutJournal.checkoutCartFingerprint({ lines: [{ id: "line-1", qty: 2 }], note: "Confidentiel" }),
    ]));
    expect(results[0]).toMatch(/^[a-f\d]{64}$/);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).not.toBe(results[2]);
    expect(results[0]).not.toContain("Confidentiel");
  });
});
