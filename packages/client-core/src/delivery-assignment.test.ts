import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryMissionResult, DeliveryMissionView } from '@sm/contracts';
import {
  assertDeliveryAssignmentsSettled, completeDeliveryAssignment, deliveryAssignmentOwner,
  DELIVERY_ASSIGNMENT_REASON, DELIVERY_ASSIGNMENT_STORAGE_KEY, prepareDeliveryAssignment,
  readDeliveryAssignments, releaseChangedDeliveryAssignment, type DeliveryAssignmentOperation,
} from './delivery-assignment';
import { purgeKeysWithIdentityLast, setStore, type KeyValueStore } from './storage';
import { SyncQueue } from './sync-queue';

const tenant = '111111111111111111111111';
const staff = '222222222222222222222222';
const owner = `${tenant}:staff:${staff}`;
const missionId = '333333333333333333333333';
const operatorId = '444444444444444444444444';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function operation(n = 1): DeliveryAssignmentOperation {
  return { ownerId: owner, missionId: n === 1 ? missionId : n.toString(16).padStart(24, '0'),
    body: { operationId: uuid(n), expectedRevision: 4, operatorId, expectedOperatorRevision: 2, reason: DELIVERY_ASSIGNMENT_REASON } };
}
function mission(overrides: Partial<DeliveryMissionView> = {}): DeliveryMissionView {
  return { id: missionId, number: 3, createdAt: '2026-09-19T10:00:00.000Z', scheduledAt: null,
    orderStatus: 'ready', revision: 5, operator: { id: operatorId, name: 'Livreur test' }, assignmentId: uuid(99),
    assignedAt: '2026-09-19T10:05:00.000Z', dispatchedAt: null,
    paymentReady: true, canAssign: true, canDispatch: true,
    customer: { name: 'Client privé', phone: '+33000000000' },
    address: { line1: '10 rue des Tests', postalCode: '75001', city: 'Paris', country: 'FR' },
    instructions: 'Instruction privée', items: [{ name: 'Produit', variantName: null, qty: 1 }], ...overrides };
}
function result(overrides: Partial<DeliveryMissionResult> = {}): DeliveryMissionResult {
  return { outcome: 'applied', operationId: uuid(1), appliedRevision: 5, replay: false,
    refusalCode: null, mission: mission(), ...overrides } as DeliveryMissionResult;
}
function memory() {
  const values = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: vi.fn(async key => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async key => { values.delete(key); }),
  };
  return { values, store };
}
const journal = (operations: unknown[]) => JSON.stringify({ version: 1, operations });
afterEach(() => vi.unstubAllGlobals());

describe('identité locale de l’affectation', () => {
  const token = (payload: unknown) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  it.each(['user', 'staff'])('décode UTF-8 sans atob ni Buffer dans le module, avec kind %s', kind => {
    const encoded = token({ tenantId: tenant, kind, sub: staff, name: 'Équipe 🍽️' });
    vi.stubGlobal('atob', undefined);
    vi.stubGlobal('Buffer', undefined);
    expect(deliveryAssignmentOwner(encoded)).toBe(`${tenant}:${kind}:${staff}`);
  });
  it.each([
    {}, { tenantId: tenant, sub: staff }, { tenantId: tenant, sub: staff, kind: 'driver' },
    { tenantId: 'autre', sub: staff, kind: 'staff' }, { tenantId: tenant, sub: '', kind: 'staff' },
    { tenantId: tenant.toUpperCase().replace('1', 'A'), sub: staff, kind: 'staff' }, null,
  ])('refuse les portées non conformes %j', payload => {
    expect(deliveryAssignmentOwner(token(payload))).toBeNull();
  });
  it.each(['demo', '', 'x.%%%%.x', 'x.a.x', `x.${'a'.repeat(16_385)}.x`, 'x._w.x'])('refuse un token non décodable sans exposer sa valeur', tokenValue => {
    expect(deliveryAssignmentOwner(tokenValue)).toBeNull();
  });
});

describe('journal durable d’affectation', () => {
  it('est vide initialement ; conserve seulement les références et la raison fixe après redémarrage', async () => {
    const { store, values } = memory();
    expect(await readDeliveryAssignments(store)).toEqual([]);
    await expect(assertDeliveryAssignmentsSettled(store)).resolves.toBeUndefined();
    const prepared = await prepareDeliveryAssignment(store, operation());
    expect(prepared).toEqual(operation());
    expect(JSON.parse(values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY)!)).toEqual({ version: 1, operations: [operation()] });
    const restarted: KeyValueStore = { ...store };
    expect(await readDeliveryAssignments(restarted)).toEqual([operation()]);
    await expect(assertDeliveryAssignmentsSettled(restarted)).rejects.toThrow('reste à vérifier');
  });

  it('réutilise exactement la même tentative, sans dépendre de l’ordre des propriétés', async () => {
    const { store } = memory();
    await prepareDeliveryAssignment(store, operation());
    const op = operation();
    const replay = { body: { reason: op.body.reason, expectedOperatorRevision: 2, operatorId,
      expectedRevision: 4, operationId: op.body.operationId }, missionId, ownerId: owner };
    expect(await prepareDeliveryAssignment(store, replay)).toEqual(op);
    expect(await readDeliveryAssignments(store)).toEqual([op]);
  });

  it.each(['owner', 'uuid', 'revision', 'operator', 'operatorRevision'])('refuse le remplacement concurrent du champ %s', async field => {
    const { store, values } = memory();
    await prepareDeliveryAssignment(store, operation());
    const before = values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY);
    const changed = operation();
    if (field === 'owner') changed.ownerId = `${tenant}:user:${staff}`;
    if (field === 'uuid') changed.body.operationId = uuid(2);
    if (field === 'revision') changed.body.expectedRevision++;
    if (field === 'operator') changed.body.operatorId = '555555555555555555555555';
    if (field === 'operatorRevision') changed.body.expectedOperatorRevision = 3;
    await expect(prepareDeliveryAssignment(store, changed)).rejects.toThrow('reste à vérifier');
    expect(values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY)).toBe(before);
  });

  it('sérialise deux instances concurrentes ; un seul changement devient envoyable', async () => {
    const { store } = memory();
    const other = operation(); other.body.operationId = uuid(2);
    const outcomes = await Promise.allSettled([prepareDeliveryAssignment(store, operation()), prepareDeliveryAssignment({ ...store }, other)]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'rejected']);
    expect(await readDeliveryAssignments(store)).toEqual([operation()]);
  });

  it('utilise mutateItem du store scopé plutôt que réentrer dans son verrou', async () => {
    const { store, values } = memory();
    const mutationCalled = vi.fn();
    const mutateItem: NonNullable<KeyValueStore['mutateItem']> = async (key, mutate) => {
      mutationCalled();
      const mutation = await mutate(values.get(key) ?? null);
      if (mutation.value === null) values.delete(key); else values.set(key, mutation.value);
      return mutation.result;
    };
    await prepareDeliveryAssignment({ ...store, mutateItem }, operation());
    expect(mutationCalled).toHaveBeenCalledOnce();
    expect(store.getItem).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('refuse un nouvel envoi web sans Web Locks, avant toute écriture', async () => {
    const { store } = memory();
    vi.stubGlobal('document', {}); vi.stubGlobal('navigator', {});
    await expect(prepareDeliveryAssignment(store, operation())).rejects.toThrow('navigateur');
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('utilise Web Locks pour sérialiser le journal navigateur', async () => {
    const { store } = memory();
    const request = vi.fn(async (_name, _options, work: () => unknown) => work());
    vi.stubGlobal('document', {}); vi.stubGlobal('navigator', { locks: { request } });
    await prepareDeliveryAssignment(store, operation());
    expect(request).toHaveBeenCalledWith('sm.sync.state.v2.commit', { mode: 'exclusive' }, expect.any(Function));
  });

  it('conserve une confirmation en attente si le navigateur ne peut plus verrouiller son effacement', async () => {
    const { store } = memory(); await prepareDeliveryAssignment(store, operation());
    vi.stubGlobal('document', {}); vi.stubGlobal('navigator', {});
    await expect(completeDeliveryAssignment(store, operation(), result())).rejects.toThrow('navigateur');
    await expect(releaseChangedDeliveryAssignment(store, operation(), 'DELIVERY_MISSION_CHANGED', mission())).rejects.toThrow('navigateur');
    expect(await readDeliveryAssignments(store)).toEqual([operation()]);
  });

  it('refuse le POST si la sauvegarde échoue et ne prétend pas l’avoir préparé', async () => {
    const { store } = memory();
    store.setItem = vi.fn().mockRejectedValue(new Error('quota'));
    await expect(prepareDeliveryAssignment(store, operation())).rejects.toThrow('quota');
    expect(await readDeliveryAssignments(store)).toEqual([]);
  });

  it('accepte exactement 128 intentions, jamais une 129e ni un UUID sur une autre mission', async () => {
    const { store, values } = memory();
    values.set(DELIVERY_ASSIGNMENT_STORAGE_KEY, journal(Array.from({ length: 127 }, (_, index) => operation(index + 1))));
    await prepareDeliveryAssignment(store, operation(128));
    expect(await readDeliveryAssignments(store)).toHaveLength(128);
    await expect(prepareDeliveryAssignment(store, operation(129))).rejects.toThrow('reste à vérifier');
    values.set(DELIVERY_ASSIGNMENT_STORAGE_KEY, journal([operation()]));
    const reused = operation(2); reused.body.operationId = uuid(1);
    await expect(prepareDeliveryAssignment(store, reused)).rejects.toThrow('reste à vérifier');
  });

  it.each([
    '{cassé', 'null', '[]', '{}', JSON.stringify({ version: 2, operations: [] }),
    JSON.stringify({ version: 1, operations: [], token: 'private-fixture' }),
    journal([{ ...operation(), customer: 'private-fixture' }]),
    journal([{ ...operation(), ownerId: 'nom libre' }]),
    journal([{ ...operation(), body: { ...operation().body, reason: 'adresse privée' } }]),
    journal([{ ...operation(), body: { ...operation().body, token: 'private-fixture' } }]),
    journal([{ ...operation(), body: { ...operation().body, expectedOperatorRevision: null } }]),
    journal([operation(), operation()]),
    journal([operation(), { ...operation(2), body: operation().body }]),
    journal(Array.from({ length: 129 }, (_, index) => operation(index + 1))),
    ' '.repeat(131_073),
  ])('ne purge ni ne remplace un journal corrompu, cas %#', async raw => {
    const { store, values } = memory(); values.set(DELIVERY_ASSIGNMENT_STORAGE_KEY, raw);
    await expect(readDeliveryAssignments(store)).rejects.toThrow('journal');
    await expect(assertDeliveryAssignmentsSettled(store)).rejects.toThrow('journal');
    await expect(prepareDeliveryAssignment(store, operation(3))).rejects.toThrow('journal');
    expect(values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY)).toBe(raw);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });

  it('permet la fixture démo explicite sans déduire une identité de son faux token', async () => {
    const { store } = memory();
    await prepareDeliveryAssignment(store, { ...operation(), ownerId: 'demo:staff:demo' });
    expect((await readDeliveryAssignments(store))[0]?.ownerId).toBe('demo:staff:demo');
    expect(deliveryAssignmentOwner('demo')).toBeNull();
  });
});

describe('acquittement et conflits', () => {
  it.each(['applied', 'rejected'] as const)('retire seulement la tentative acquittée %s, sans persister la projection privée', async outcome => {
    const { store, values } = memory();
    await prepareDeliveryAssignment(store, operation()); await prepareDeliveryAssignment(store, operation(2));
    const raw = outcome === 'applied' ? result() : result({ outcome, refusalCode: 'DELIVERY_OPERATOR_CHANGED', replay: true });
    expect(await completeDeliveryAssignment(store, operation(), raw)).toEqual(raw);
    expect(await readDeliveryAssignments(store)).toEqual([operation(2)]);
    expect(values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY)).not.toContain('Client privé');
    expect(values.get(DELIVERY_ASSIGNMENT_STORAGE_KEY)).not.toContain('Instruction privée');
  });

  it('un replay renvoie l’état courant plus récent sans réaffecter la mission', async () => {
    const { store, values } = memory(); await prepareDeliveryAssignment(store, operation());
    const raw = result({ replay: true, mission: mission({ revision: 9, operator: null, canDispatch: false }) });
    expect((await completeDeliveryAssignment(store, operation(), raw)).mission.operator).toBeNull();
    expect(values.has(DELIVERY_ASSIGNMENT_STORAGE_KEY)).toBe(false);
    await expect(assertDeliveryAssignmentsSettled(store)).resolves.toBeUndefined();
  });

  it.each([
    null, mission(), result({ operationId: uuid(7) }), result({ mission: mission({ id: operatorId }) }),
    result({ appliedRevision: 4 }), result({ appliedRevision: 6, mission: mission({ revision: 5 }) }),
    result({ appliedRevision: 6, mission: mission({ revision: 6 }) }),
    { ...result(), token: 'private-fixture' },
  ])('conserve la tentative si l’acquittement est absent ou incohérent, cas %#', async raw => {
    const { store } = memory(); await prepareDeliveryAssignment(store, operation());
    await expect(completeDeliveryAssignment(store, operation(), raw)).rejects.toThrow('confirme');
    expect(await readDeliveryAssignments(store)).toEqual([operation()]);
  });

  it('ne supprime pas l’intention d’un autre propriétaire ni sa nouvelle opération', async () => {
    const { store, values } = memory(); await prepareDeliveryAssignment(store, operation());
    const replacement = operation(); replacement.ownerId = `${tenant}:user:${staff}`; replacement.body.operationId = uuid(2);
    values.set(DELIVERY_ASSIGNMENT_STORAGE_KEY, journal([replacement]));
    await expect(completeDeliveryAssignment(store, operation(), result())).rejects.toThrow('reste à vérifier');
    expect(await readDeliveryAssignments(store)).toEqual([replacement]);
  });

  it('garde la même référence si l’effacement local échoue après confirmation serveur', async () => {
    const { store } = memory(); await prepareDeliveryAssignment(store, operation());
    store.removeItem = vi.fn().mockRejectedValue(new Error('stockage indisponible'));
    await expect(completeDeliveryAssignment(store, operation(), result())).rejects.toThrow('stockage indisponible');
    expect(await prepareDeliveryAssignment(store, operation())).toEqual(operation());
  });

  it.each([
    ['UNKNOWN', mission()], ['DELIVERY_MISSION_OPERATION_CONFLICT', mission()], ['DELIVERY_OPERATOR_CHANGED', mission()],
    ['DELIVERY_MISSION_CHANGED', mission({ revision: 4 })], ['DELIVERY_MISSION_CHANGED', mission({ id: operatorId })],
    ['DELIVERY_MISSION_CHANGED', null],
  ])('ne libère pas un conflit sans preuve suffisante, cas %#', async (code, raw) => {
    const { store } = memory(); await prepareDeliveryAssignment(store, operation());
    await expect(releaseChangedDeliveryAssignment(store, operation(), code as string, raw)).rejects.toThrow('confirme');
    expect(await readDeliveryAssignments(store)).toEqual([operation()]);
  });

  it('libère seulement après conflit explicite puis vue plus récente de la même mission', async () => {
    const { store } = memory(); await prepareDeliveryAssignment(store, operation());
    expect(await releaseChangedDeliveryAssignment(store, operation(), 'DELIVERY_MISSION_CHANGED', mission())).toEqual(mission());
    expect(await readDeliveryAssignments(store)).toEqual([]);
  });

  it('interdit la purge avant résolution sous le verrou commun, puis permet le désappairage', async () => {
    const { store, values } = memory(); setStore(store);
    const queue = new SyncQueue(vi.fn(), { requireScope: true });
    await queue.bindScope('pairing-a', { freshPairing: true });
    await prepareDeliveryAssignment(queue.scopedStore(), operation());
    const before = [...values];
    await expect(queue.clear({ requireEmpty: true, beforeClear: assertDeliveryAssignmentsSettled })).rejects.toThrow('reste à vérifier');
    expect([...values]).toEqual(before);
    await completeDeliveryAssignment(queue.scopedStore(), operation(), result());
    await expect(queue.clear({ requireEmpty: true, beforeClear: assertDeliveryAssignmentsSettled })).resolves.toBeUndefined();
  });

  it('une ancienne portée ne peut plus préparer ou acquitter après un réappairage', async () => {
    const { store } = memory(); setStore(store);
    const old = new SyncQueue(vi.fn(), { requireScope: true });
    await old.bindScope('pairing-a', { freshPairing: true });
    const stale = old.scopedStore();
    const current = new SyncQueue(vi.fn(), { requireScope: true });
    await current.bindScope('pairing-a');
    await current.clear({ requireEmpty: true, beforeClear: assertDeliveryAssignmentsSettled });
    await current.completeClear();
    await current.bindScope('pairing-b', { freshPairing: true });
    await prepareDeliveryAssignment(current.scopedStore(), operation());
    await expect(prepareDeliveryAssignment(stale, operation())).rejects.toThrow();
    await expect(completeDeliveryAssignment(stale, operation(), result())).rejects.toThrow();
    expect(await readDeliveryAssignments(current.scopedStore())).toEqual([operation()]);
  });

  it('la purge de l’identité s’arrête avant toute suppression si le journal est corrompu', async () => {
    const { store, values } = memory(); values.set('identity', tenant); values.set(DELIVERY_ASSIGNMENT_STORAGE_KEY, '{cassé');
    await expect(purgeKeysWithIdentityLast(store, ['identity', DELIVERY_ASSIGNMENT_STORAGE_KEY], 'identity', assertDeliveryAssignmentsSettled)).rejects.toThrow('journal');
    expect(store.removeItem).not.toHaveBeenCalled(); expect(values.get('identity')).toBe(tenant);
  });
});
