import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderRefundOperationView } from '@sm/contracts';
import {
  closeSupersededOrderRefundAllocationIntent, completeOrderRefundAllocationIntent, prepareOrderRefundAllocationIntent, readOrderRefundAllocationIntent, type OrderRefundAllocationIntent,
  completeOrderRefundIntent, ORDER_REFUND_STORAGE_KEY, prepareOrderRefundIntent,
  readOrderRefundIntent, type OrderRefundIntent,
} from './order-refund-journal';
import { webStore, type KeyValueStore } from './storage';

const tenant = '111111111111111111111111';
const author = '222222222222222222222222';
const ownerId = `${tenant}:user:${author}`;
const otherOwner = `${tenant}:user:333333333333333333333333`;
const orderId = '444444444444444444444444';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const intent = (n = 1): OrderRefundIntent => ({ ownerId, orderId: n === 1 ? orderId : n.toString(16).padStart(24, '0'),
  operationId: uuid(n), amountCents: 1250, reason: 'Article indisponible' });
const proof = (changes: Partial<OrderRefundOperationView> = {}): OrderRefundOperationView => ({
  orderId, operationId: uuid(1), amountCents: 1250, reason: 'Article indisponible',
  state: 'known', providerStatus: 'succeeded', canResume: false, preparedAt: '2026-09-20T10:00:00.000Z', ...changes,
});
const journal = (intents: unknown[]) => JSON.stringify({ version: 1, intents });

function stores() {
  const values = new Map<string, string>();
  const open = (): KeyValueStore => ({
    getItem: vi.fn(async key => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async key => { values.delete(key); }),
  });
  return { values, open, store: open() };
}

/** Two store instances use the same browser lock queue, as two tabs do. */
function browserLocks() {
  let tail = Promise.resolve<unknown>(undefined);
  const request = vi.fn((_name: string, _options: unknown, work: () => unknown) => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  });
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', { locks: { request } });
  return request;
}

afterEach(() => vi.unstubAllGlobals());

describe('journal durable des remboursements', () => {
  it('conserve uniquement le corps immuable après une nouvelle instance et permet sa reprise exacte', async () => {
    const { values, store, open } = stores();
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
    await expect(prepareOrderRefundIntent(store, intent())).resolves.toEqual(intent());
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
    const afterReload = open();
    expect(await readOrderRefundIntent(afterReload, ownerId, orderId)).toEqual({ state: 'pending', intent: intent() });
    expect(await prepareOrderRefundIntent(afterReload, intent())).toEqual(intent());
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('attend réellement la persistance avant de rendre la demande envoyable', async () => {
    const { store, values } = stores();
    let release!: () => void;
    store.setItem = async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); values.set(key, value); };
    let ready = false;
    const preparing = prepareOrderRefundIntent(store, intent()).then(() => { ready = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(ready).toBe(false);
    expect(values.size).toBe(0);
    release(); await preparing;
    expect(ready).toBe(true);
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'pending', intent: intent() });
  });

  it.each(['ownerId', 'operationId', 'amountCents', 'reason'] as const)('ne remplace jamais une intention par un autre %s', async field => {
    const { store, values } = stores();
    await prepareOrderRefundIntent(store, intent());
    const changed = { ...intent(), [field]: { ownerId: otherOwner, operationId: uuid(2), amountCents: 1000, reason: 'Autre motif' }[field] };
    await expect(prepareOrderRefundIntent(store, changed)).rejects.toThrow('reste à vérifier');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('bloque un autre auteur sans lui rendre ni le motif ni le montant ni l’opération', async () => {
    const { store } = stores();
    await prepareOrderRefundIntent(store, intent());
    expect(await readOrderRefundIntent(store, otherOwner, orderId)).toEqual({ state: 'blocked' });
    expect(await readOrderRefundIntent(store, 'aaaaaaaaaaaaaaaaaaaaaaaa:user:bbbbbbbbbbbbbbbbbbbbbbbb', orderId)).toEqual({ state: 'blocked' });
  });

  it.each([false, true])('sérialise deux onglets concurrents, autre auteur=%s', async differentAuthor => {
    const locks = browserLocks();
    const { store, open, values } = stores();
    const second = { ...intent(), operationId: uuid(2), ...(differentAuthor ? { ownerId: otherOwner } : {}) };
    const outcomes = await Promise.allSettled([prepareOrderRefundIntent(store, intent()), prepareOrderRefundIntent(open(), second)]);
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
    expect(locks).toHaveBeenCalledWith('sm.sync.state.v2.commit', { mode: 'exclusive' }, expect.any(Function));
  });

  it('accepte deux reprises concurrentes strictement identiques sans ajouter de ligne', async () => {
    browserLocks();
    const { store, open, values } = stores();
    await Promise.all([prepareOrderRefundIntent(store, intent()), prepareOrderRefundIntent(open(), intent())]);
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('utilise la mutation atomique du store natif/scopé sans verrou réentrant', async () => {
    const { store, values } = stores();
    const mutationCalled = vi.fn();
    const mutateItem: NonNullable<KeyValueStore['mutateItem']> = async (key, mutate) => {
      mutationCalled();
      const changed = await mutate(values.get(key) ?? null);
      if (changed.value === null) values.delete(key); else values.set(key, changed.value);
      return changed.result;
    };
    await prepareOrderRefundIntent({ ...store, mutateItem }, intent());
    expect(mutationCalled).toHaveBeenCalledOnce();
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('copie le corps avant les attentes et ne laisse pas une mutation appelant changer le journal', async () => {
    const { store } = stores();
    const requested = intent();
    const pending = prepareOrderRefundIntent(store, requested);
    requested.reason = 'Autre motif'; requested.amountCents = 1;
    const prepared = await pending;
    prepared.amountCents = 2;
    const read = await readOrderRefundIntent(store, ownerId, orderId);
    expect(read).toEqual({ state: 'pending', intent: intent() });
    if (read.state === 'pending') read.intent.reason = 'Encore modifié';
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'pending', intent: intent() });
  });

  it('borne à 128 intentions sans éviction et interdit le même UUID sur une autre commande', async () => {
    const { store, values } = stores();
    values.set(ORDER_REFUND_STORAGE_KEY, journal(Array.from({ length: 127 }, (_, i) => intent(i + 1))));
    await prepareOrderRefundIntent(store, intent(128));
    const before = values.get(ORDER_REFUND_STORAGE_KEY);
    await expect(prepareOrderRefundIntent(store, intent(129))).rejects.toThrow('reste à vérifier');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(before);
    values.set(ORDER_REFUND_STORAGE_KEY, journal([intent()]));
    await expect(prepareOrderRefundIntent(store, { ...intent(2), operationId: uuid(1) })).rejects.toThrow('reste à vérifier');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('borne également la taille sérialisée avant toute écriture', async () => {
    const { store, values } = stores();
    const longReason = `a${'\u0000'.repeat(198)}a`;
    const intents = Array.from({ length: 128 }, (_, i) => ({ ...intent(i + 1), reason: longReason }));
    let length = 0;
    while (journal(intents.slice(0, length + 1)).length <= 131_072) length++;
    values.set(ORDER_REFUND_STORAGE_KEY, journal(intents.slice(0, length)));
    const before = values.get(ORDER_REFUND_STORAGE_KEY);
    await expect(prepareOrderRefundIntent(store, intents[length]!)).rejects.toThrow('journal');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(before);
    expect(store.setItem).not.toHaveBeenCalled();
  });
});

describe('preuve serveur et acquittement', () => {
  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const)('acquitte uniquement l’opération connue %s, sans assimiler cela à un succès financier', async providerStatus => {
    const { store } = stores();
    await prepareOrderRefundIntent(store, intent());
    await completeOrderRefundIntent(store, intent(), proof({ providerStatus }));
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
  });

  it('tolère les deux ACK simultanés de deux onglets et conserve les autres commandes', async () => {
    browserLocks();
    const { store, open, values } = stores();
    await prepareOrderRefundIntent(store, intent()); await prepareOrderRefundIntent(store, intent(2));
    await Promise.all([completeOrderRefundIntent(store, intent(), proof()), completeOrderRefundIntent(open(), intent(), proof())]);
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent(2)]));
  });

  it('ne libère une demande jamais envoyée que sur le retrait terminal prouvé par le serveur', async () => {
    const { store } = stores();
    await prepareOrderRefundIntent(store, intent());
    const withdrawn = proof({ state: 'withdrawn', providerStatus: null });
    await completeOrderRefundIntent(store, intent(), withdrawn);
    await expect(completeOrderRefundIntent(store, intent(), withdrawn)).resolves.toBeUndefined();
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
  });

  it.each([
    undefined, null, {}, { summary: { refundedCents: 1250 } },
    proof({ orderId: intent(2).orderId }), proof({ operationId: uuid(2) }), proof({ amountCents: 1200 }),
    proof({ reason: 'Autre motif' }), proof({ reason: ' Article indisponible ' }), proof({ providerStatus: null }),
    proof({ state: 'prepared', providerStatus: null, canResume: true }),
    proof({ state: 'creating', providerStatus: null, canResume: true }),
    proof({ state: 'review_required', providerStatus: null }),
    proof({ state: 'creating' }), proof({ canResume: true }),
    proof({ state: 'withdrawn' }), proof({ state: 'withdrawn', providerStatus: null, canResume: true }),
    proof({ state: 'withdrawn', providerStatus: null, operationId: uuid(2) }),
    proof({ state: 'withdrawn', providerStatus: null, amountCents: 1200 }),
    proof({ state: 'withdrawn', providerStatus: null, reason: 'Autre motif' }),
    proof({ state: 'withdrawn', providerStatus: null, orderId: intent(2).orderId }),
    { ...proof(), providerStatus: 'unknown' }, { ...proof(), token: 'must-not-be-retained' },
  ])('une réponse non probante ne purge jamais le journal, cas %#', async response => {
    const { store, values } = stores();
    await prepareOrderRefundIntent(store, intent());
    await expect(completeOrderRefundIntent(store, intent(), response)).rejects.toThrow('ne confirme pas');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('une réponse ancienne ne supprime jamais la nouvelle demande ou celle d’un autre auteur', async () => {
    const { store, values } = stores();
    await prepareOrderRefundIntent(store, intent());
    await completeOrderRefundIntent(store, intent(), proof());
    const newer = { ...intent(), ownerId: otherOwner, operationId: uuid(2) };
    await prepareOrderRefundIntent(store, newer);
    await expect(completeOrderRefundIntent(store, intent(), proof())).rejects.toThrow('reste à vérifier');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([newer]));
  });

  it('valide même l’ACK idempotent absent : une réponse vide n’est pas une preuve', async () => {
    const { store } = stores();
    await expect(completeOrderRefundIntent(store, intent(), {})).rejects.toThrow('ne confirme pas');
    await expect(completeOrderRefundIntent(store, intent(), proof())).resolves.toBeUndefined();
  });
});

describe('stockage et données refusés', () => {
  it.each([
    { ...intent(), password: 'secret-fixture' }, { ...intent(), token: 'secret-fixture' },
    { ...intent(), ownerId: `${tenant}:staff:${author}` }, { ...intent(), ownerId: 'demo:user:demo' },
    { ...intent(), orderId: 'invalid' }, { ...intent(), operationId: 'invalid' },
    { ...intent(), operationId: uuid(1).replace('8000', '0000') },
    { ...intent(), operationId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
    { ...intent(), amountCents: 0 }, { ...intent(), amountCents: -1 }, { ...intent(), amountCents: 0.1 },
    { ...intent(), amountCents: 100_000_001 }, { ...intent(), amountCents: NaN },
    { ...intent(), reason: '  ' }, { ...intent(), reason: 'ab' }, { ...intent(), reason: 'a'.repeat(201) },
    { ...intent(), reason: ' Non normalisé ' },
  ])('rejette les données non conformes avant persistance, cas %#', async invalid => {
    const { store, values } = stores();
    await expect(prepareOrderRefundIntent(store, invalid)).rejects.toThrow('journal');
    expect(values.size).toBe(0);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each([
    '{invalid', 'null', '[]', '{}', JSON.stringify({ version: 2, intents: [] }),
    JSON.stringify({ version: 1, intents: [], password: 'secret-fixture' }),
    journal([{ ...intent(), token: 'secret-fixture' }]), journal([intent(), intent()]),
    journal([intent(), { ...intent(2), operationId: uuid(1) }]),
    journal(Array.from({ length: 129 }, (_, i) => intent(i + 1))), ' '.repeat(131_073),
  ])('un journal corrompu bloque lecture/préparation/ACK sans le remplacer, cas %#', async raw => {
    const { store, values } = stores(); values.set(ORDER_REFUND_STORAGE_KEY, raw);
    await expect(readOrderRefundIntent(store, ownerId, orderId)).rejects.toThrow('journal');
    await expect(prepareOrderRefundIntent(store, intent())).rejects.toThrow('journal');
    await expect(completeOrderRefundIntent(store, intent(), proof())).rejects.toThrow('journal');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(raw);
    expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled();
  });

  it('refuse préparation et ACK web sans Web Locks, même avec mutateItem', async () => {
    const { store, values } = stores();
    await prepareOrderRefundIntent(store, intent());
    const mutateItem = vi.fn();
    vi.stubGlobal('document', {}); vi.stubGlobal('navigator', {});
    await expect(prepareOrderRefundIntent({ ...store, mutateItem }, intent())).rejects.toThrow('navigateur');
    await expect(completeOrderRefundIntent(store, intent(), proof())).rejects.toThrow('navigateur');
    expect(mutateItem).not.toHaveBeenCalled();
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('un quota refusé empêche l’envoi ; une suppression refusée conserve la reprise', async () => {
    const { store, values } = stores();
    const write = store.setItem;
    store.setItem = vi.fn().mockRejectedValue(new Error('quota'));
    await expect(prepareOrderRefundIntent(store, intent())).rejects.toThrow('quota');
    expect(values.size).toBe(0);
    store.setItem = write;
    await prepareOrderRefundIntent(store, intent());
    store.removeItem = vi.fn().mockRejectedValue(new Error('unavailable'));
    await expect(completeOrderRefundIntent(store, intent(), proof())).rejects.toThrow('unavailable');
    expect(values.get(ORDER_REFUND_STORAGE_KEY)).toBe(journal([intent()]));
  });

  it('ne remplace jamais un localStorage indisponible par une mémoire temporaire', async () => {
    browserLocks(); vi.stubGlobal('localStorage', undefined);
    await expect(prepareOrderRefundIntent(webStore(), intent())).rejects.toThrow('Stockage local indisponible');
    await expect(readOrderRefundIntent(webStore(), ownerId, orderId)).rejects.toThrow('journal');
  });

  it('survit à la réouverture de vrais adaptateurs web et ne conserve aucun accès secret', async () => {
    browserLocks(); const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
    await prepareOrderRefundIntent(webStore(), intent());
    expect(await readOrderRefundIntent(webStore(), ownerId, orderId)).toEqual({ state: 'pending', intent: intent() });
    expect(JSON.parse(values.get(ORDER_REFUND_STORAGE_KEY)!)).toEqual({ version: 1, intents: [intent()] });
    await completeOrderRefundIntent(webStore(), intent(), proof());
    expect(await readOrderRefundIntent(webStore(), ownerId, orderId)).toEqual({ state: 'none' });
  });
});


describe('immutable refund allocations', () => {
  const allocation = { version: 1 as const, merchandiseCents: 1000, deliveryCents: 250 };
  const allocated = () => ({ ...intent(), allocation: { ...allocation } });
  const historical = (): OrderRefundAllocationIntent => ({ ...allocated(), kind: 'allocation', refundId: 're_fixture' });
  const receipt = () => ({ orderId, enabled: true,
    summary: { refundedCents: 1250, pendingRefundCents: 0, remainingCents: 0, status: 'refunded', refunds: [] }, operations: [],
    allocation: { basis: allocation, capacity: allocation, remaining: { version: 1, merchandiseCents: 0, deliveryCents: 0 }, unallocated: [] },
    allocations: [{ operationId: uuid(1), refundId: 're_fixture', allocation, reason: intent().reason, recordedAt: '2026-09-21T10:00:00.000Z' }],
  });
  it('persists a deep copy across reload and refuses a different split under the same UUID', async () => {
    const { store, open } = stores(); const request = allocated();
    await prepareOrderRefundIntent(store, request); request.allocation.merchandiseCents = 1;
    expect(await readOrderRefundIntent(open(), ownerId, orderId)).toEqual({ state: 'pending', intent: allocated() });
    await expect(prepareOrderRefundIntent(store, { ...allocated(), allocation: { ...allocation, merchandiseCents: 1250, deliveryCents: 0 } })).rejects.toThrow();
    await expect(completeOrderRefundIntent(store, allocated(), proof())).rejects.toThrow();
    await expect(completeOrderRefundIntent(store, allocated(), proof({ allocation: { ...allocation, merchandiseCents: 1250, deliveryCents: 0 } }))).rejects.toThrow();
    await completeOrderRefundIntent(store, allocated(), proof({ allocation }));
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
  });
  it('never invents a split for legacy intent and accepts only a legacy exact proof', async () => {
    const { store } = stores(); await prepareOrderRefundIntent(store, intent());
    await expect(prepareOrderRefundIntent(store, allocated())).rejects.toThrow();
    await expect(completeOrderRefundIntent(store, intent(), proof({ allocation }))).rejects.toThrow();
    await completeOrderRefundIntent(store, intent(), proof({ allocation: null }));
  });
  it.each([{ ...allocation, deliveryCents: 249 }, { ...allocation, merchandiseCents: -1 }, { ...allocation, version: 2 }, { ...allocation, token: 'secret' }])('fails closed for malformed allocation %#', async invalid => {
    const { store } = stores();
    await expect(prepareOrderRefundIntent(store, { ...intent(), allocation: invalid } as OrderRefundIntent)).rejects.toThrow();
  });
  it('keeps historical allocation durable, private and mutually exclusive with refund intents', async () => {
    browserLocks(); const { store, open } = stores();
    const result = await Promise.allSettled([prepareOrderRefundAllocationIntent(store, historical()), prepareOrderRefundIntent(open(), intent())]);
    expect(result.map(entry => entry.status)).toEqual(['fulfilled', 'rejected']);
    expect(await readOrderRefundAllocationIntent(open(), ownerId, orderId)).toEqual({ state: 'pending', intent: historical() });
    expect(await readOrderRefundIntent(store, ownerId, orderId)).toEqual({ state: 'blocked' });
    expect(await readOrderRefundAllocationIntent(store, otherOwner, orderId)).toEqual({ state: 'blocked' });
    await expect(completeOrderRefundIntent(store, historical(), proof({ allocation }))).rejects.toThrow();
  });
  it('acknowledges an exact withdrawn allocation without changing the saved split', async () => {
    const { store } = stores(); await prepareOrderRefundAllocationIntent(store, historical());
    const withdrawn = receipt();
    await completeOrderRefundAllocationIntent(store, historical(), { ...withdrawn, allocations: [{ ...withdrawn.allocations[0], state: 'withdrawn' }] });
    expect(await readOrderRefundAllocationIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
  });
  it('closes a losing allocation only on explicit same-refund immutable proof and preserves newer intents', async () => {
    const { store } = stores(); await prepareOrderRefundAllocationIntent(store, historical());
    const original = receipt();
    await expect(closeSupersededOrderRefundAllocationIntent(store, historical(), original)).rejects.toThrow();
    const winner = { ...original, allocations: [{ ...original.allocations[0], operationId: uuid(2) }] };
    await expect(closeSupersededOrderRefundAllocationIntent(store, historical(), { ...winner, orderId: 'f'.repeat(24) })).rejects.toThrow();
    await expect(closeSupersededOrderRefundAllocationIntent(store, historical(), { ...winner, allocations: [{ ...winner.allocations[0], refundId: 're_other' }] })).rejects.toThrow();
    await closeSupersededOrderRefundAllocationIntent(store, historical(), winner);
    expect(await readOrderRefundAllocationIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
    await prepareOrderRefundIntent(store, { ...intent(), operationId: uuid(3) });
    await expect(closeSupersededOrderRefundAllocationIntent(store, historical(), winner)).rejects.toThrow();
  });
  it('acknowledges only the enclosing order journal with an exact allocation receipt; absent is not proof', async () => {
    const { store, open } = stores(); await prepareOrderRefundAllocationIntent(store, historical());
    const valid = receipt();
    const invalid = [null, valid.allocations[0], { ...valid, orderId: 'f'.repeat(24) }, { ...valid, allocations: [] },
      { ...valid, allocations: [{ ...valid.allocations[0], reason: 'Other reason' }] },
      { ...valid, allocations: [{ ...valid.allocations[0], refundId: 're_other' }] },
      { ...valid, allocations: [{ ...valid.allocations[0], allocation: { ...allocation, merchandiseCents: 1250, deliveryCents: 0 } }] }];
    for (const other of invalid) await expect(completeOrderRefundAllocationIntent(store, historical(), other)).rejects.toThrow();
    expect((await readOrderRefundAllocationIntent(open(), ownerId, orderId)).state).toBe('pending');
    await completeOrderRefundAllocationIntent(store, historical(), valid);
    await completeOrderRefundAllocationIntent(open(), historical(), valid);
    expect(await readOrderRefundAllocationIntent(store, ownerId, orderId)).toEqual({ state: 'none' });
    await prepareOrderRefundIntent(store, { ...intent(), operationId: uuid(2) });
    await expect(completeOrderRefundAllocationIntent(store, historical(), valid)).rejects.toThrow();
  });
});
