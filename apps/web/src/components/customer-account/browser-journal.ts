import { z } from 'zod';
import { CustomerAccountBrowserRefSchema, CustomerAccountSlugSchema, type CustomerAccountPublication } from '@sm/contracts';

export const CustomerProtectionJournalSchema = z.strictObject({
  stage: z.enum(['registration_required', 'assertion_required', 'recovery_required']),
  recoveryVersion: z.number().int().min(0).max(3),
  pending: z.enum(['registration-options', 'register', 'assertion-options', 'assert', 'recovery-code', 'activate']).nullable(),
  registrationId: CustomerAccountBrowserRefSchema.optional(), assertionId: CustomerAccountBrowserRefSchema.optional(),
  rotationId: CustomerAccountBrowserRefSchema.optional(), activationId: CustomerAccountBrowserRefSchema.optional(),
});
export type CustomerProtectionJournal = z.infer<typeof CustomerProtectionJournalSchema>;
export const CustomerVerificationJournalSchema = z.strictObject({
  operationId: CustomerAccountBrowserRefSchema,
  phase: z.enum(['preparing', 'prepared', 'starting', 'code', 'checking', 'incorrect', 'protecting', 'completed', 'closing', 'closed', 'expired', 'failed']),
  challengeId: CustomerAccountBrowserRefSchema.nullable(), checkId: CustomerAccountBrowserRefSchema.nullable(),
  expiresAt: z.number().int().positive().nullable(),
  protection: CustomerProtectionJournalSchema.optional(),
});
export type CustomerVerificationJournal = z.infer<typeof CustomerVerificationJournalSchema>;
export const CustomerBrowserJournalSchema = z.strictObject({
  version: z.literal(1), browserRef: CustomerAccountBrowserRefSchema,
  phase: z.enum(['preparing', 'issuing', 'confirming', 'ready']),
  verification: CustomerVerificationJournalSchema.optional(),
});
export type CustomerBrowserJournal = z.infer<typeof CustomerBrowserJournalSchema>;
export type CustomerBrowserJournalStore = {
  read(): Promise<CustomerBrowserJournal | null>;
  write(value: CustomerBrowserJournal, expected: CustomerBrowserJournal | null): Promise<void>;
};
const DATABASE = 'sm-customer-preparation-v1';
const STORE = 'preparations';
export class CustomerBrowserJournalError extends Error {
  constructor() { super('La préparation de cet accès ne peut pas être conservée sur ce navigateur.'); }
}
function decode(value: unknown): CustomerBrowserJournal | null {
  if (value === undefined) return null;
  const result = CustomerBrowserJournalSchema.safeParse(value);
  if (!result.success) throw new CustomerBrowserJournalError();
  return result.data;
}

/** Separate from checkout, loyalty and device history. Only a public selector
 * and an uncertainty phase are durable; no OTP, phone, token, name or receipt.
 * Transaction completion precedes mutation network calls. Corrupt storage is
 * never repaired from cookies or account responses. An explicit restore may
 * recover only a confirmed browser selector into a strictly absent journal;
 * it never restores verification, publication or personal-account authority. */
export function customerBrowserJournal(slug: string): CustomerBrowserJournalStore {
  async function open(create: boolean): Promise<IDBDatabase | null> {
    if (!CustomerAccountSlugSchema.safeParse(slug).success || slug.length > 63
      || typeof indexedDB === 'undefined') throw new CustomerBrowserJournalError();
    return new Promise((resolve, reject) => {
      let settled = false; let absent = false;
      const request = indexedDB.open(DATABASE, 1);
      const timeout = setTimeout(fail, 3_000);
      function fail() { if (!settled) { settled = true; clearTimeout(timeout); reject(new CustomerBrowserJournalError()); } }
      request.onupgradeneeded = () => {
        // Merely looking for a personal selector must not create persistent
        // storage for every guest. Only an explicit preparation creates it.
        if (settled || !create) { absent = true; request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onblocked = fail;
      request.onerror = () => {
        if (!settled && absent && !create) { settled = true; clearTimeout(timeout); resolve(null); }
        else fail();
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timeout);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function transaction(next?: { value: CustomerBrowserJournal; expected: CustomerBrowserJournal | null }) {
    const db = await open(Boolean(next));
    if (!db) return null;
    try {
      return await new Promise<CustomerBrowserJournal | null>((resolve, reject) => {
        const tx = next ? db.transaction(STORE, 'readwrite', { durability: 'strict' }) : db.transaction(STORE, 'readonly');
        if (next && tx.durability !== 'strict') { tx.abort(); reject(new CustomerBrowserJournalError()); return; }
        let result: CustomerBrowserJournal | null = null;
        const timeout = setTimeout(() => { try { tx.abort(); } catch { /* Transaction already ended. */ } }, 3_000);
        tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(new CustomerBrowserJournalError()); };
        tx.oncomplete = () => { clearTimeout(timeout); resolve(result); };
        const store = tx.objectStore(STORE);
        const read = store.get(slug);
        read.onsuccess = () => {
          try {
            result = decode(read.result);
            if (next) {
              const value = CustomerBrowserJournalSchema.parse(next.value);
              const expected = next.expected === null ? null : CustomerBrowserJournalSchema.parse(next.expected);
              if (JSON.stringify(result) !== JSON.stringify(expected)) { tx.abort(); return; }
              store.put(value, slug); result = value;
            }
          } catch { tx.abort(); }
        };
      });
    } catch { throw new CustomerBrowserJournalError(); }
    finally { db.close(); }
  }
  return { read: () => transaction(), write: async (value, expected) => { await transaction({ value, expected }); } };
}

export async function selectedCustomerBrowser(slug: string): Promise<string | null> {
  const record = await customerBrowserJournal(slug).read();
  return record?.phase === 'ready' ? record.browserRef : null;
}

export async function selectedCustomerPublication(slug: string): Promise<CustomerAccountPublication | null> {
  const record = await customerBrowserJournal(slug).read();
  const verification = record?.verification;
  return record?.phase === 'ready' && verification?.phase === 'completed' && verification.checkId
    ? { expectedOperationId: verification.operationId, expectedCheckId: verification.protection?.activationId ?? verification.checkId } : null;
}
