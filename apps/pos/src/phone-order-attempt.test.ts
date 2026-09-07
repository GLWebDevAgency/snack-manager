import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateOrderSchema } from '@sm/contracts';
import { getStore, setStore, SmApiError, SyncQueue, type KeyValueStore } from '@sm/client-core';
import { priceOrderLines } from '../../api/src/modules/orders/price-order-lines';
import {
  PHONE_ORDER_ATTEMPT_KEY, preparePhoneOrderAttempt, readPhoneOrderAttempt,
  markPhoneOrderUncertain, recordPhoneOrderReceipt, archiveReceivedPhoneOrderAttempt,
  readLastPhoneOrderReceipt,
  recordPhoneOrderResult, releaseRejectedPhoneOrderAttempt, assertPhoneOrderPurgeSafe,
} from './phone-order-attempt';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439022';
const ORDER = '507f1f77bcf86cd799439033';
const body = () => ({
  channel: 'phone' as const, type: 'pickup' as const,
  lines: [{ productId: '507f1f77bcf86cd799439099', options: [{ groupKey: 'cheese', choiceKey: 'blue' }], removed: ['oignon'], qty: 1, note: 'Sans sel' }],
  pickup: { slot: '2026-09-06T18:30:00.000Z', customerName: 'Recette téléphone', customerPhone: '0000000000' },
  payment: { method: 'counter' as const, tender: null }, note: 'Recette uniquement',
});
function store() {
  const data = new Map<string, string>();
  const storage: KeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
  return { storage, data };
}
function serverOrder(clientId: string) {
  const input = body();
  return {
    _id: ORDER, tenantId: TENANT, clientId, number: 12, channel: 'phone', type: 'pickup', status: 'new',
    trackingToken: 'a'.repeat(32), pickup: input.pickup, note: input.note,
    lines: input.lines.map((line) => ({ ...line, variantKey: null, name: 'Produit serveur', unitPrice: 1400, lineTotal: 1400 })),
    totals: { subtotal: 1400, total: 1400, discount: null }, payment: { method: 'counter', status: 'pending', tender: null },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('journal durable de la prise de commande téléphone', () => {
  it('conserve le propriétaire du brouillon acquis, jamais celui du second onglet', async () => {
    const { storage } = store();
    const first = await preparePhoneOrderAttempt(storage, TENANT, body(), '11111111-1111-4111-8111-111111111111');
    const second = await preparePhoneOrderAttempt(storage, TENANT, body(), '22222222-2222-4222-8222-222222222222');
    expect(first.draftId).toBe('11111111-1111-4111-8111-111111111111');
    expect(second.draftId).toBe(first.draftId);
  });

  it('n’autorise une nouvelle clé qu’après un rejet serveur lié à cette tentative', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await expect(releaseRejectedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow();
    for (const result of [
      { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'invalid_order', message: 'Refus' },
      { tenantId: OTHER_TENANT, clientId: attempt.clientId, channel: 'phone', state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'invalid_order', message: 'Refus' },
      { tenantId: TENANT, clientId: attempt.clientId, channel: 'online', state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'invalid_order', message: 'Refus' },
    ]) await expect(recordPhoneOrderResult(storage, TENANT, attempt.clientId, result)).rejects.toThrow();
    const rejected = await recordPhoneOrderResult(storage, TENANT, attempt.clientId, {
      tenantId: TENANT, clientId: attempt.clientId, channel: 'phone', state: 'rejected',
      code: 'ORDER_ATTEMPT_REJECTED', reason: 'slot_unavailable', message: 'Créneau complet',
    });
    expect(rejected.state).toBe('rejected');
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow();
    await expect(recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId))).rejects.toThrow();
    await releaseRejectedPhoneOrderAttempt(storage, TENANT, attempt.clientId);
    expect(await readPhoneOrderAttempt(storage, TENANT)).toBeNull();
    expect((await preparePhoneOrderAttempt(storage, TENANT, body())).clientId).not.toBe(attempt.clientId);
  });

  it('bloque toute purge d’une tentative active ou illisible mais pas d’un reçu archivé', async () => {
    const { storage } = store();
    await expect(assertPhoneOrderPurgeSafe(storage)).resolves.toBeUndefined();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await expect(assertPhoneOrderPurgeSafe(storage)).rejects.toThrow();
    await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    await expect(assertPhoneOrderPurgeSafe(storage)).rejects.toThrow();
    await archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId);
    await expect(assertPhoneOrderPurgeSafe(storage)).resolves.toBeUndefined();
    await storage.setItem(PHONE_ORDER_ATTEMPT_KEY, '{broken');
    await expect(assertPhoneOrderPurgeSafe(storage)).rejects.toThrow();
  });
  it('ne publie la tentative et son UUID v4 qu’après la fin de la persistance', async () => {
    const { storage } = store();
    let unblock!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const write = storage.setItem;
    storage.setItem = async (key, value) => {
      entered();
      await new Promise<void>((resolve) => { unblock = resolve; });
      await write(key, value);
    };
    const network = vi.fn();
    const preparing = preparePhoneOrderAttempt(storage, TENANT, body()).then((attempt) => { network(attempt); return attempt; });
    await reached;
    expect(network).not.toHaveBeenCalled();
    unblock();
    const attempt = await preparing;
    expect(attempt.clientId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(attempt.state).toBe('prepared');
    expect(network).toHaveBeenCalledOnce();
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(attempt);
  });

  it('deux préparations concurrentes gardent le premier UUID et le premier corps', async () => {
    const { storage } = store();
    const changed = body(); changed.lines[0]!.qty = 2;
    const [first, second] = await Promise.all([
      preparePhoneOrderAttempt(storage, TENANT, body()), preparePhoneOrderAttempt(storage, TENANT, changed),
    ]);
    expect(second).toEqual(first);
    expect(first.body.lines[0]!.qty).toBe(1);
  });

  it('fige profondément l’entrée et ses sorties sans retenir la référence de l’appelant', async () => {
    const { storage } = store();
    const input = body();
    const pending = preparePhoneOrderAttempt(storage, TENANT, input);
    input.lines[0]!.qty = 3;
    input.pickup.customerName = 'Autre brouillon';
    const attempt = await pending;
    expect(attempt.body.lines[0]!.qty).toBe(1);
    expect(Object.isFrozen(attempt.body.lines[0]!.options[0])).toBe(true);
    expect(() => { (attempt.body.lines[0] as { qty: number }).qty = 4; }).toThrow();
    expect((await readPhoneOrderAttempt(storage, TENANT))?.body.pickup.customerName).toBe('Recette téléphone');
  });

  it.each([
    ['date sans heure', { pickup: { ...body().pickup, slot: '2026-09-06' } }],
    ['date invalide', { pickup: { ...body().pickup, slot: '2026-02-30T18:30:00.000Z' } }],
    ['slot absent', { pickup: { ...body().pickup, slot: undefined } }],
    ['carte déjà perçue', { payment: { method: 'counter', tender: 'card' } }],
    ['statut payé injecté', { payment: { method: 'counter', tender: null, status: 'paid' } }],
    ['livraison', { type: 'delivery' }],
    ['canal POS', { channel: 'pos' }],
    ['identifiant imposé', { clientId: 'a0173871-811a-43ee-ae1c-504163424661' }],
    ['secret étranger', { turnstileToken: 'secret' }],
  ])('refuse %s avant toute écriture', async (_label, patch) => {
    const { storage, data } = store();
    await expect(preparePhoneOrderAttempt(storage, TENANT, { ...body(), ...patch })).rejects.toThrow();
    expect(data.size).toBe(0);
  });

  it('n’invente pas la capacité ou l’expiration d’un créneau : seul le serveur tranche', async () => {
    const { storage } = store();
    const input = body(); input.pickup.slot = '2020-01-01T12:00:00.000Z';
    expect((await preparePhoneOrderAttempt(storage, TENANT, input)).body.pickup.slot).toBe(input.pickup.slot);
  });

  it.each(['2026-09-06T18:30:00Z', '2026-09-06T18:30:00.0Z'])('canonise %s avant persistance et retrouve le même instant sérialisé par Mongo', async (slot) => {
    const { storage, data } = store();
    const input = body(); input.pickup.slot = slot;
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, input);
    expect(attempt.body.pickup.slot).toBe('2026-09-06T18:30:00.000Z');
    expect(JSON.parse(data.get(PHONE_ORDER_ATTEMPT_KEY)!).active.body.pickup.slot).toBe(attempt.body.pickup.slot);
    const received = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    expect(received.receipt.slot).toBe(attempt.body.pickup.slot);
    expect((await readPhoneOrderAttempt(storage, TENANT))?.body).toEqual(attempt.body);
  });

  it('accepte le vrai résultat du pricing API : défauts [], retraits trimés, options enrichies et null serveur', async () => {
    const { storage } = store();
    const input = body();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, {
      ...input, lines: [
        { productId: '507f1f77bcf86cd799439099' },
        { ...input.lines[0], removed: [' oignon '], options: [
          { groupKey: 'cheese', choiceKey: 'blue' }, { groupKey: 'cheese', choiceKey: 'blue' },
        ] },
      ],
    });
    // Le service appelle ce helper avec des produits .lean() ; son type DB
    // inféré porte encore les méthodes DocumentArray absentes de ce JSON réel.
    const products = [{
      _id: '507f1f77bcf86cd799439099', name: 'Produit serveur', price: 1400, outOfStock: false,
      variants: [], optionGroups: [{ key: 'cheese', name: 'Fromage', type: 'multi', min: 0, max: 2,
        choices: [{ key: 'blue', name: 'Bleu', priceDelta: 100 }], perVariant: {} }],
    }] as unknown as Parameters<typeof priceOrderLines>[0];
    const priced = priceOrderLines(products, CreateOrderSchema.parse(attempt.body).lines);
    expect(priced.lines[0]).toMatchObject({ options: [], removed: [], variantKey: null, note: null });
    expect(priced.lines[1]?.removed).toEqual(['oignon']);
    expect(priced.lines[1]?.options.map((choice) => choice.choiceKey)).toEqual(['blue', 'blue']);
    const received = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, {
      ...serverOrder(attempt.clientId), lines: priced.lines, totals: { subtotal: priced.subtotal, total: priced.subtotal },
    });
    expect(received.receipt).toMatchObject({ items: 2, totalCents: 3000 });
  });

  it('un refus de stockage ne déclenche jamais le port réseau et un retry retrouve une écriture à résultat inconnu', async () => {
    const { storage } = store();
    const write = storage.setItem;
    const network = vi.fn();
    storage.setItem = async (key, value) => { await write(key, value); throw new Error('Résultat disque inconnu'); };
    await expect(preparePhoneOrderAttempt(storage, TENANT, body()).then(network)).rejects.toThrow('disque');
    expect(network).not.toHaveBeenCalled();
    const durable = await readPhoneOrderAttempt(storage, TENANT);
    storage.setItem = write;
    expect(await preparePhoneOrderAttempt(storage, TENANT, body())).toEqual(durable);
  });

  it('ne remplace pas une erreur de lecture ou un disque refusé par un journal vide en mémoire', async () => {
    const { storage, data } = store();
    const network = vi.fn();
    storage.getItem = async () => { throw new Error('Lecture refusée'); };
    await expect(preparePhoneOrderAttempt(storage, TENANT, body()).then(network)).rejects.toThrow('Lecture refusée');
    expect(data.size).toBe(0);
    storage.getItem = async () => null;
    storage.setItem = async () => { throw new Error('Disque refusé'); };
    await expect(preparePhoneOrderAttempt(storage, TENANT, body()).then(network)).rejects.toThrow('Disque refusé');
    expect(network).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });

  it('un timeout prolongé ne change jamais la clé, même après trente jours', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await markPhoneOrderUncertain(storage, TENANT, attempt.clientId);
    vi.spyOn(Date, 'now').mockReturnValue(attempt.createdAt + 30 * 86400_000);
    const retry = await preparePhoneOrderAttempt(storage, TENANT, body());
    expect(retry).toMatchObject({ clientId: attempt.clientId, createdAt: attempt.createdAt, state: 'uncertain', body: attempt.body });
  });

  it('un callback ancien ne peut marquer, enregistrer ou archiver une autre tentative', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const staleId = 'a0173871-811a-43ee-ae1c-504163424661';
    await expect(markPhoneOrderUncertain(storage, TENANT, staleId)).rejects.toThrow();
    await expect(recordPhoneOrderReceipt(storage, TENANT, staleId, serverOrder(staleId))).rejects.toThrow();
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, staleId)).rejects.toThrow();
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(attempt);
  });

  it.each(['{broken', '', 'null', '{"version":99}', '{"version":1,"active":{"state":"rejected"},"lastReceipt":null}'])('ne remplace pas un journal corrompu (%s)', async (raw) => {
    const { storage, data } = store(); data.set(PHONE_ORDER_ATTEMPT_KEY, raw);
    await expect(readPhoneOrderAttempt(storage, TENANT)).rejects.toThrow();
    await expect(preparePhoneOrderAttempt(storage, TENANT, body())).rejects.toThrow();
    expect(data.get(PHONE_ORDER_ATTEMPT_KEY)).toBe(raw);
  });

  it('ne transforme aucun HTTP 400/404/409 en reçu ou en libération de clé', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await markPhoneOrderUncertain(storage, TENANT, attempt.clientId);
    for (const status of [400, 404, 409]) {
      await expect(recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, new SmApiError('Refus', status, { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED' }))).rejects.toThrow();
    }
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow();
    expect((await preparePhoneOrderAttempt(storage, TENANT, body())).clientId).toBe(attempt.clientId);
    expect((await readPhoneOrderAttempt(storage, TENANT))?.state).toBe('uncertain');
  });

  it('conserve le corps après reçu pour réparer le journal puis archive un reçu minimal sans coordonnées', async () => {
    const { storage, data } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const received = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    expect(received.state).toBe('received');
    expect(received.receipt.totalCents).toBe(1400);
    expect(received.body).toEqual(attempt.body);
    expect(await preparePhoneOrderAttempt(storage, TENANT, body())).toEqual(received);
    await markPhoneOrderUncertain(storage, TENANT, attempt.clientId);
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(received);
    await archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId);
    expect(await readPhoneOrderAttempt(storage, TENANT)).toBeNull();
    expect(await readLastPhoneOrderReceipt(storage, TENANT)).toEqual(received.receipt);
    expect(data.get(PHONE_ORDER_ATTEMPT_KEY)).not.toMatch(/Recette|0000000000|Sans sel|oignon/);
    const next = await preparePhoneOrderAttempt(storage, TENANT, body());
    expect(next.clientId).not.toBe(attempt.clientId);
    expect(await readLastPhoneOrderReceipt(storage, TENANT)).toEqual(received.receipt);
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow();
    expect((await readPhoneOrderAttempt(storage, TENANT))?.clientId).toBe(next.clientId);
  });

  it('réhydrate strictement la preuve reçue et refuse une incohérence du journal', async () => {
    const { storage, data } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    const persisted = data.get(PHONE_ORDER_ATTEMPT_KEY)!;
    const altered = JSON.parse(persisted);
    altered.active.receipt.items = 9;
    data.set(PHONE_ORDER_ATTEMPT_KEY, JSON.stringify(altered));
    await expect(readPhoneOrderAttempt(storage, TENANT)).rejects.toThrow();
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow();
    expect(data.get(PHONE_ORDER_ATTEMPT_KEY)).toBe(JSON.stringify(altered));
  });

  it('n’enregistre pas les données étrangères du DTO staff et rend aussi le reçu profondément immutable', async () => {
    const { storage, data } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const result = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, {
      ...serverOrder(attempt.clientId), providerSecret: 'never-persist-this', customerProfile: { email: 'unrelated@example.invalid' },
    });
    expect(data.get(PHONE_ORDER_ATTEMPT_KEY)).not.toMatch(/never-persist-this|unrelated/);
    expect(Object.isFrozen(result.receipt.payment)).toBe(true);
    expect(() => { (result.receipt.payment as { status: string }).status = 'paid'; }).toThrow();
  });

  it.each([
    ['tenant', { tenantId: OTHER_TENANT }], ['canal', { channel: 'pos' }],
    ['commande', { _id: '' }], ['UUID', { clientId: 'a0173871-811a-43ee-ae1c-504163424661' }],
    ['numéro', { number: 1.5 }], ['token', { trackingToken: '' }],
    ['slot', { pickup: { ...body().pickup, slot: '2026-09-06T18:40:00.000Z' } }],
    ['quantité', { lines: [{ ...body().lines[0], qty: 2 }] }],
    ['montant', { totals: { total: -1 } }], ['total fractionnaire', { totals: { total: 0.2 } }],
    ['état', { status: 'unknown' }], ['Stripe', { payment: { method: 'online', status: 'paid' } }],
    ['pending avec tender', { payment: { method: 'counter', status: 'pending', tender: 'card' } }],
  ])('refuse un reçu dont %s ne correspond pas, sans toucher la tentative', async (_label, patch) => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    await expect(recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, { ...serverOrder(attempt.clientId), ...patch })).rejects.toThrow();
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(attempt);
  });

  it('accepte un prix serveur différent du panier et une reprise déjà payée sans inventer de nouveau paiement', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const result = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, {
      ...serverOrder(attempt.clientId), status: 'ready', totals: { total: 1500 },
      payment: { method: 'counter', status: 'paid', tender: 'cash', cashReceived: 2000, changeGiven: 500 },
    });
    expect(result.receipt).toMatchObject({ totalCents: 1500, payment: { status: 'paid', tender: 'cash', cashReceived: 2000, changeGiven: 500 } });
  });

  it('retrouve aussi une commande remboursée après création sans la déclarer à nouveau payable', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const result = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, {
      ...serverOrder(attempt.clientId), status: 'cancelled', payment: { method: 'counter', status: 'refunded', tender: 'card' },
    });
    expect(result.receipt.payment.status).toBe('refunded');
  });

  it('un reçu répété ne remplace jamais la première preuve immuable par un ancien statut', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const first = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    expect(await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, { ...serverOrder(attempt.clientId), payment: { method: 'counter', status: 'paid', tender: 'card' } })).toEqual(first);
    await expect(recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, { ...serverOrder(attempt.clientId), _id: OTHER_TENANT })).rejects.toThrow();
  });

  it('un échec de persistance du reçu ou de son archivage laisse une reprise exploitable', async () => {
    const { storage } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const write = storage.setItem;
    storage.setItem = async () => { throw new Error('Quota'); };
    await expect(recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId))).rejects.toThrow('Quota');
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(attempt);
    storage.setItem = write;
    const received = await recordPhoneOrderReceipt(storage, TENANT, attempt.clientId, serverOrder(attempt.clientId));
    storage.setItem = async () => { throw new Error('Quota'); };
    await expect(archiveReceivedPhoneOrderAttempt(storage, TENANT, attempt.clientId)).rejects.toThrow('Quota');
    expect(await readPhoneOrderAttempt(storage, TENANT)).toEqual(received);
  });

  it('refuse toute lecture ou mutation avec un tenant différent sans exposer le corps', async () => {
    const { storage, data } = store();
    const attempt = await preparePhoneOrderAttempt(storage, TENANT, body());
    const before = data.get(PHONE_ORDER_ATTEMPT_KEY);
    for (const action of [
      () => readPhoneOrderAttempt(storage, OTHER_TENANT), () => readLastPhoneOrderReceipt(storage, OTHER_TENANT),
      () => preparePhoneOrderAttempt(storage, OTHER_TENANT, body()),
      () => markPhoneOrderUncertain(storage, OTHER_TENANT, attempt.clientId),
    ]) await expect(action()).rejects.toThrow('établissement');
    expect(data.get(PHONE_ORDER_ATTEMPT_KEY)).toBe(before);
  });

  it('utilise la vraie frontière tenantStore : un ancien onglet ne peut réécrire après réappairage', async () => {
    const previous = getStore(); const { storage } = store(); setStore(storage);
    try {
      const a = new SyncQueue(vi.fn(), { requireScope: true });
      const stale = new SyncQueue(vi.fn(), { requireScope: true });
      await a.bindScope('phone-pairing-a', { freshPairing: true });
      await stale.bindScope('phone-pairing-a');
      const attempt = await preparePhoneOrderAttempt(a.scopedStore(), TENANT, body());
      await a.clear();
      await storage.removeItem(PHONE_ORDER_ATTEMPT_KEY); // normal appairage purge, base mémoire isolée
      await a.completeClear();
      await a.bindScope('phone-pairing-b', { freshPairing: true });
      await preparePhoneOrderAttempt(a.scopedStore(), OTHER_TENANT, body());
      await expect(markPhoneOrderUncertain(stale.scopedStore(), TENANT, attempt.clientId)).rejects.toThrow();
      expect((await readPhoneOrderAttempt(a.scopedStore(), OTHER_TENANT))?.tenantId).toBe(OTHER_TENANT);
    } finally { setStore(previous); }
  });
});
