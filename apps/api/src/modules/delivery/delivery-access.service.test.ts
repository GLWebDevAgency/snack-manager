import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_SESSION_TTL_MS, DeliverySessionViewSchema } from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import {
  DeliveryAccessService, deriveDeliverySessionToken, hashDeliveryAccessSecret,
} from './delivery-access.service';

const TENANT = '65f000000000000000000001';
const OTHER = '65f000000000000000000002';
const OPERATOR = '65f000000000000000000003';
const STAFF = '65f000000000000000000004';
const NOW = new Date('2030-01-01T12:00:00Z');
const INPUT = { token: 'A'.repeat(43), nonce: 'B'.repeat(43) };
const SESSION_TOKEN = deriveDeliverySessionToken(INPUT);

function initial() {
  return {
    _id: OPERATOR, tenantId: TENANT, staffId: null as string | null,
    name: 'Livreur test', active: true, revision: 1, staffSessionVersion: null as string | null,
    sessionVersion: 'version-1',
    invite: { hash: hashDeliveryAccessSecret(INPUT.token), expiresAt: new Date(NOW.getTime() + 600_000) } as Record<string, unknown> | null,
    session: null as Record<string, unknown> | null,
    history: [] as Record<string, unknown>[],
  };
}
type Row = ReturnType<typeof initial>;
type AnyRow = Record<string, unknown>;
const field = (row: AnyRow, path: string): unknown => path.split('.').reduce<unknown>(
  (value, part) => value && typeof value === 'object' ? (value as AnyRow)[part] : undefined, row,
);
function matches(row: AnyRow, filter: AnyRow): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return (expected as AnyRow[]).some(part => matches(row, part));
    if (key === '$expr') return Number(field(row, 'invite.expiresAt')) > Date.now();
    const value = field(row, key);
    if (expected && typeof expected === 'object' && '$gt' in expected) {
      return Number(value) > Number((expected as { $gt: unknown }).$gt);
    }
    return value === expected;
  });
}

function harness({ linked = false, connected = false } = {}) {
  const state = {
    operator: initial() as Row | null,
    tenant: { _id: TENANT, name: 'Restaurant test', slug: 'fixture', plan: null, onlineDelivery: true,
      account: { status: 'active' } } as AnyRow | null,
    member: { _id: STAFF, tenantId: TENANT, active: true, sessionVersion: 'staff-1' } as AnyRow | null,
  };
  if (linked) Object.assign(state.operator!, { staffId: STAFF, staffSessionVersion: 'staff-1' });
  if (connected) {
    state.operator!.invite = null;
    state.operator!.session = { hash: hashDeliveryAccessSecret(SESSION_TOKEN), version: 'version-1',
      expiresAt: new Date(NOW.getTime() + DELIVERY_SESSION_TTL_MS),
      inviteHash: hashDeliveryAccessSecret(INPUT.token), nonceHash: hashDeliveryAccessSecret(INPUT.nonce),
      retryUntil: new Date(NOW.getTime() + 600_000) };
  }
  const reads: string[] = [];
  const concerns: string[] = [];
  const timeouts: number[] = [];
  const projections: string[] = [];
  let beforeWrite: (() => void) | undefined;
  let afterWrite: (() => void) | undefined;
  let afterTenant: (() => void) | undefined;
  function query<T>(execute: () => T | Promise<T>) {
    return {
      read(preference: string) { reads.push(preference); return this; },
      readConcern(concern: string) { concerns.push(concern); return this; },
      maxTimeMS(milliseconds: number) { timeouts.push(milliseconds); return this; },
      select(projection: string) { projections.push(projection); return this; },
      lean: async () => execute(),
      then(resolve: (value: T) => unknown, reject?: (cause: unknown) => unknown) {
        return Promise.resolve().then(execute).then(resolve, reject);
      },
    };
  }
  function mutate(filter: AnyRow, update: AnyRow): boolean {
    beforeWrite?.();
    if (!state.operator || !matches(state.operator, filter)) return false;
    Object.assign(state.operator, update.$set);
    state.operator.revision += (update.$inc as { revision: number }).revision;
    state.operator.history.push((update.$push as { history: AnyRow }).history);
    afterWrite?.();
    return true;
  }
  const operators = {
    findOne: vi.fn((filter: AnyRow) => query(() => state.operator && matches(state.operator, filter) ? structuredClone(state.operator) : null)),
    exists: vi.fn((filter: AnyRow) => query(() => state.operator && matches(state.operator, filter) ? { _id: OPERATOR } : null)),
    findOneAndUpdate: vi.fn((filter: AnyRow, update: AnyRow) => query(() => mutate(filter, update) ? structuredClone(state.operator) : null)),
    updateOne: vi.fn(async (filter: AnyRow, update: AnyRow) => ({ modifiedCount: mutate(filter, update) ? 1 : 0 })),
  };
  const tenants = { findById: vi.fn((id: string) => query(() => {
    const tenant = state.tenant && state.tenant._id === id ? structuredClone(state.tenant) : null;
    afterTenant?.();
    return tenant;
  })) };
  const staff = { findOne: vi.fn((filter: AnyRow) => query(() => state.member && matches(state.member, filter) ? structuredClone(state.member) : null)) };
  return {
    state, operators, tenants, staff, reads, concerns, timeouts, projections,
    service: new DeliveryAccessService(operators as never, tenants as never, staff as never),
    beforeWrite(fn: () => void) { beforeWrite = fn; },
    afterWrite(fn: () => void) { afterWrite = fn; },
    afterTenant(fn: () => void) { afterTenant = fn; },
  };
}

afterEach(() => vi.useRealTimers());
function clock() { vi.useFakeTimers(); vi.setSystemTime(NOW); }

describe('DeliveryAccessService — frontière livreur opaque', () => {
  it('ouvre un accès dédié avec delivery seul, sans offre POS/RH ni données privées', async () => {
    clock(); const h = harness();
    const result = await h.service.exchange(INPUT);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.token).not.toContain('.');
    expect(result.token).not.toBe(INPUT.token);
    expect(result.token).not.toBe(INPUT.nonce);
    expect(DeliverySessionViewSchema.parse(result.session)).toEqual(result.session);
    expect(result.session.expiresAt).toBe(new Date(NOW.getTime() + DELIVERY_SESSION_TTL_MS).toISOString());
    expect(h.state.operator?.invite).toBeNull();
    expect(h.state.operator?.history).toEqual([expect.objectContaining({ action: 'connected', actorKind: 'delivery', actorId: OPERATOR, revision: 2 })]);
    expect(JSON.stringify(h.state.operator)).not.toContain(INPUT.token);
    expect(JSON.stringify(h.state.operator)).not.toContain(INPUT.nonce);
    expect(JSON.stringify(h.state.operator)).not.toContain(result.token);
    expect(h.staff.findOne).not.toHaveBeenCalled();
    expect(h.reads.every(value => value === 'primary')).toBe(true);
    expect(h.concerns.length).toBeGreaterThan(0);
    expect(h.concerns.every(value => value === 'majority')).toBe(true);
    expect(h.timeouts.length).toBe(h.concerns.length);
    expect(h.timeouts.every(value => value === 10_000)).toBe(true);
    expect(h.projections.every(value => value.includes('+sessionVersion') && value.includes('+staffSessionVersion'))).toBe(true);
    expect(h.operators.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      _id: OPERATOR, tenantId: TENANT, active: true, revision: 1, sessionVersion: 'version-1',
      'invite.hash': hashDeliveryAccessSecret(INPUT.token), $expr: { $gt: ['$invite.expiresAt', '$$NOW'] },
    }), expect.any(Object), { new: true, runValidators: true, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } });
  });

  it('projette la marque et les coordonnées publiques sans exposer la configuration privée du restaurant', async () => {
    clock(); const h = harness({ connected: true });
    Object.assign(h.state.tenant!, { address: '1 rue de recette, Paris', phones: ['0100000000'], brandColor: '#cb241c',
      stripeAccountId: 'private-processor', settingsSecret: 'private-settings' });
    const result = await h.service.authenticate(SESSION_TOKEN);
    expect(DeliverySessionViewSchema.parse(result.session)).toEqual(result.session);
    expect(result.session).toMatchObject({ restaurantAddress: '1 rue de recette, Paris', restaurantPhones: ['0100000000'], brand: { palette: { accent: '#cb241c' } } });
    expect(JSON.stringify(result.session)).not.toMatch(/private-|sessionHash|tenantId|stripe|settingsSecret/);
  });

  it('récupère une réponse perdue avec le même nonce sans nouvelle écriture ni prolongation', async () => {
    clock(); const h = harness();
    h.state.operator!.invite!.expiresAt = new Date(NOW.getTime() + 1_000);
    const first = await h.service.exchange(INPUT);
    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    expect(await h.service.exchange(INPUT)).toEqual(first);
    expect(h.operators.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(h.state.operator?.history).toHaveLength(1);
  });

  it('ferme la fenêtre de reprise sans expirer la session déjà reçue', async () => {
    clock(); const h = harness({ connected: true });
    vi.setSystemTime(new Date(NOW.getTime() + 600_000));
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.authenticate(SESSION_TOKEN)).resolves.toMatchObject({ operatorId: OPERATOR });
  });

  it('reprend aussi un CAS écrit dont Mongo a perdu la réponse, sans nouvelle consommation', async () => {
    clock(); const h = harness();
    h.afterWrite(() => { throw new Error('synthetic lost write response'); });
    await expect(h.service.exchange(INPUT)).rejects.toThrow('synthetic lost write response');
    h.afterWrite(() => {});
    await expect(h.service.exchange(INPUT)).resolves.toMatchObject({ token: SESSION_TOKEN });
    expect(h.state.operator?.history).toHaveLength(1);
    expect(h.operators.findOneAndUpdate).toHaveBeenCalledOnce();
  });

  it('ne restitue pas une reprise expirée pendant les lectures de session', async () => {
    clock(); const h = harness({ connected: true });
    let reads = 0;
    h.afterTenant(() => {
      if (++reads === 2) vi.setSystemTime(new Date(NOW.getTime() + 600_000));
    });
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deux échanges concurrents identiques ont une seule consommation', async () => {
    clock(); const h = harness();
    const [a, b] = await Promise.all([h.service.exchange(INPUT), h.service.exchange(INPUT)]);
    expect(a).toEqual(b);
    expect(h.state.operator?.history).toHaveLength(1);
    expect(h.state.operator?.revision).toBe(2);
  });

  it('deux téléphones concurrents ne peuvent partager ni remplacer la session', async () => {
    clock(); const h = harness();
    const outcomes = await Promise.allSettled([
      h.service.exchange(INPUT), h.service.exchange({ ...INPUT, nonce: 'C'.repeat(43) }),
    ]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(h.state.operator?.history).toHaveLength(1);
  });

  it.each(['expired', 'missing', 'disabled', 'unknown', 'malformed', 'extra'])('refuse une invitation %s sans mutation', async reason => {
    clock(); const h = harness(); let input = INPUT;
    if (reason === 'expired') h.state.operator!.invite!.expiresAt = NOW;
    if (reason === 'missing') h.state.operator!.invite = null;
    if (reason === 'disabled') h.state.operator!.active = false;
    if (reason === 'unknown') input = { ...INPUT, token: 'Z'.repeat(43) };
    if (reason === 'malformed') input = { ...INPUT, token: 'secret-invalid' };
    if (reason === 'extra') input = { ...INPUT, tenantId: OTHER } as typeof INPUT;
    const error = await h.service.exchange(input).catch(value => value);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toEqual({ message: 'Accès livreur invalide ou expiré', error: 'Unauthorized', statusCode: 401 });
    expect(h.operators.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['expired', 'version', 'disabled', 'missing'])('refuse une session %s', async reason => {
    clock(); const h = harness({ connected: true });
    if (reason === 'expired') h.state.operator!.session!.expiresAt = NOW;
    if (reason === 'version') h.state.operator!.sessionVersion = 'version-2';
    if (reason === 'disabled') h.state.operator!.active = false;
    if (reason === 'missing') h.state.operator = null;
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['missing', 'suspended', 'no-delivery', 'wrong-tenant'])('ferme échange et session pour un tenant %s', async reason => {
    clock(); const h = harness();
    if (reason === 'missing') h.state.tenant = null;
    if (reason === 'suspended') h.state.tenant!.account = { status: 'suspended' };
    if (reason === 'no-delivery') h.state.tenant!.onlineDelivery = false;
    if (reason === 'wrong-tenant') h.state.operator!.tenantId = OTHER;
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.operators.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('relit la capacité et la suspension à chaque requête, sans dépendre de la pause commandes', async () => {
    clock(); const h = harness({ connected: true });
    h.state.tenant!.delivery = { enabled: false };
    await expect(h.service.authenticate(SESSION_TOKEN)).resolves.toBeDefined();
    h.state.tenant!.onlineDelivery = false;
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    h.state.tenant!.onlineDelivery = true;
    h.state.tenant!.account = { status: 'suspended' };
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('conserve le rôle/PIN/versions POS du Staff polyvalent', async () => {
    clock(); const h = harness({ linked: true });
    Object.assign(h.state.member!, { role: 'caisse', pinHash: 'private-pin' });
    const before = structuredClone(h.state.member);
    const result = await h.service.exchange(INPUT);
    const access = await h.service.authenticate(result.token);
    await h.service.logout(access);
    expect(h.state.member).toEqual(before);
    expect(h.staff.findOne).toHaveBeenCalledWith({ _id: STAFF, tenantId: TENANT }, { active: 1, sessionVersion: 1 });
    expect(JSON.stringify(result)).not.toMatch(/pinHash|sessionVersion|tenantId|hourlyCost/);
  });

  it.each(['inactive', 'deleted', 'version', 'foreign', 'missing-snapshot'])('refuse un lien Staff %s', async reason => {
    clock(); const h = harness({ linked: true, connected: true });
    if (reason === 'inactive') h.state.member!.active = false;
    if (reason === 'deleted') h.state.member = null;
    if (reason === 'version') h.state.member!.sessionVersion = 'staff-2';
    if (reason === 'foreign') h.state.member!.tenantId = OTHER;
    if (reason === 'missing-snapshot') h.state.operator!.staffSessionVersion = null;
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('désactiver/réactiver Staff ne ressuscite pas son ancienne session', async () => {
    clock(); const h = harness({ linked: true, connected: true });
    h.state.member!.active = false; h.state.member!.sessionVersion = 'staff-2';
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    h.state.member!.active = true; h.state.member!.sessionVersion = 'staff-3';
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('une révocation avant le CAS empêche toute consommation', async () => {
    clock(); const h = harness();
    h.beforeWrite(() => { h.state.operator!.active = false; h.state.operator!.revision++; });
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.state.operator?.session).toBeNull();
    expect(h.state.operator?.history).toHaveLength(0);
  });

  it('une expiration serveur au moment du CAS empêche la consommation', async () => {
    clock(); const h = harness();
    h.beforeWrite(() => vi.setSystemTime(new Date(NOW.getTime() + 600_000)));
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.state.operator?.session).toBeNull();
  });

  it('une révocation après le CAS ne rend pas de jeton utilisable ou récupérable', async () => {
    clock(); const h = harness();
    h.afterWrite(() => { h.state.operator!.sessionVersion = 'version-2'; });
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('une révocation pendant la lecture des dépendances ferme la garde', async () => {
    clock(); const h = harness({ connected: true });
    h.afterTenant(() => { h.state.operator!.session = null; h.state.operator!.revision++; });
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('une expiration pendant la lecture des dépendances ferme la garde', async () => {
    clock(); const h = harness({ connected: true });
    h.afterTenant(() => vi.setSystemTime(new Date(NOW.getTime() + DELIVERY_SESSION_TTL_MS)));
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout révoque uniquement la session courante et interdit la reprise de son invitation', async () => {
    clock(); const h = harness({ connected: true });
    await h.service.logout(await h.service.authenticate(SESSION_TOKEN));
    expect(h.state.operator?.history).toEqual([expect.objectContaining({ action: 'logout', actorKind: 'delivery' })]);
    await expect(h.service.authenticate(SESSION_TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.service.exchange(INPUT)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.operators.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: OPERATOR, tenantId: TENANT, revision: 1, sessionVersion: 'version-1',
      'session.hash': hashDeliveryAccessSecret(SESSION_TOKEN),
    }), expect.any(Object), { runValidators: true, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } });
  });

  it('un ancien logout ne détruit pas la nouvelle session du téléphone', async () => {
    clock(); const h = harness({ connected: true });
    const old = await h.service.authenticate(SESSION_TOKEN);
    h.state.operator!.session!.hash = 'new-session'; h.state.operator!.revision++;
    await expect(h.service.logout(old)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.state.operator?.session?.hash).toBe('new-session');
  });

  it('le vrai vérificateur JWT global rejette le jeton livreur même sans metadata Roles', async () => {
    clock();
    const guard = new AuthGuard(new JwtService({ secret: 'unit-test-only' }), new Reflector(), {} as never);
    const request = { headers: { authorization: `Bearer ${SESSION_TOKEN}` } };
    await expect(guard.canActivate({
      getHandler: () => function handler() {}, getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
