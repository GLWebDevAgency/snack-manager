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

describe("journal de checkout durable, IndexedDB natif", () => {
  it("crée et relit après recharge une identité cryptographique et un corps immuable", async () => {
    expect(await page.evaluate(() => window.checkoutJournal.readCheckoutAttempt("classfood"))).toBeNull();
    const created = await acquire();
    expect(created.acquired).toBe(true);
    expect(created.attempt).toMatchObject({ state: "prepared", payload, cartFingerprint: fingerprint, tenant: "classfood", origin, v: 1 });
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
    const received = await page.evaluate(({ id, receipt }) => window.checkoutJournal.recordCheckoutReceipt("classfood", id, receipt), { id: attempt.clientId, receipt });
    expect(received).toMatchObject({ clientId: attempt.clientId, state: "received", receipt, cartFingerprint: fingerprint });
    expect(received).not.toHaveProperty("payload");
    expect(received).not.toHaveProperty("recoveryProof");
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
