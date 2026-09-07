import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose, { type Connection, type Model } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS, type DeliveryOperator, type Staff, type Tenant } from '@sm/db';
import { DeliveryOperatorCreateSchema, DeliveryOperatorUpdateSchema, type JwtPayload } from '@sm/contracts';
import { CAPACITES_REQUISES, FONCTION_REQUISE } from '../../common/capacites';
import { IS_PUBLIC, ROLES } from '../../common/auth';
import { DeliveryOperatorsController } from './delivery-operators.controller';
import { deliveryOperatorId, DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryAccessService } from './delivery-access.service';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const STAFF = '507f1f77bcf86cd799439033';
const actor = { kind: 'user', role: 'owner', sub: '507f1f77bcf86cd799439044', tenantId: TENANT } as JwtPayload;
const PRIVATE = '+invite +session +history +sessionVersion +staffSessionVersion +creationHash';

export function deliveryTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_delivery_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('DELIVERY_OPERATOR_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.DELIVERY_OPERATOR_TEST_MONGO_URL ? deliveryTestDatabase(process.env.DELIVERY_OPERATOR_TEST_MONGO_URL) : null;

describe('frontières des accès livreurs', () => {
  it('autorise seulement gérant/propriétaire et capacité delivery, sans ouvrir RH', () => {
    expect(Reflect.getMetadata(ROLES, DeliveryOperatorsController)).toEqual(['owner', 'gerant']);
    expect(Reflect.getMetadata(CAPACITES_REQUISES, DeliveryOperatorsController)).toEqual(['delivery']);
    expect(Reflect.getMetadata(FONCTION_REQUISE, DeliveryOperatorsController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryOperatorsController)).not.toBe(true);
  });
  it.each([
    {}, { requestId: randomUUID() }, { requestId: randomUUID(), name: 'Alice', staffId: STAFF },
    { requestId: randomUUID(), name: 'Alice', tenantId: OTHER }, { requestId: randomUUID(), name: 'Alice', role: 'owner' },
  ])('rejette une création ambiguë ou une identité injectée %j', input => {
    expect(DeliveryOperatorCreateSchema.safeParse(input).success).toBe(false);
  });
  it('ne permet pas de PATCH les versions, secrets ou références de membre', () => {
    expect(DeliveryOperatorUpdateSchema.safeParse({ expectedRevision: 0, active: true, sessionVersion: '0' }).success).toBe(false);
    expect(DeliveryOperatorUpdateSchema.safeParse({ expectedRevision: -1, active: true }).success).toBe(false);
  });
  it('déduplique les équipiers par restaurant sans dépendre de l’index', () => {
    const a = { requestId: randomUUID(), staffId: STAFF };
    expect(String(deliveryOperatorId(TENANT, a))).toBe(String(deliveryOperatorId(TENANT, { ...a, requestId: randomUUID() })));
    expect(String(deliveryOperatorId(TENANT, a))).not.toBe(String(deliveryOperatorId(OTHER, a)));
  });
  it.each([
    'mongodb://remote.example/snackmanager_delivery_test_ci', 'mongodb://localhost/admin',
    'mongodb+srv://localhost/snackmanager_delivery_test_ci', 'mongodb://user:secret@localhost/snackmanager_delivery_test_ci',
    'mongodb://localhost/snackmanager_delivery_test_ci?replicaSet=prod', 'mongodb://localhost/snackmanager_delivery_test_ci#fragment',
  ])('refuse une cible de test dangereuse %s', value => expect(() => deliveryTestDatabase(value)).toThrow());
  it('isole chaque base par UUID', () => {
    const base = 'mongodb://127.0.0.1:27046/snackmanager_delivery_test_local';
    expect(deliveryTestDatabase(base)).not.toBe(deliveryTestDatabase(base));
  });
});

(uri ? describe : describe.skip)('livreurs — vraies écritures Mongo concurrentes', () => {
  let db: Connection; let operators: Model<DeliveryOperator>; let staff: Model<Staff>; let service: DeliveryOperatorsService;
  let tenants: Model<Tenant>; let access: DeliveryAccessService;
  beforeAll(async () => {
    db = await mongoose.createConnection(uri!).asPromise();
    operators = db.model(MODELS.DeliveryOperator.name, MODELS.DeliveryOperator.schema, MODELS.DeliveryOperator.collection);
    staff = db.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection);
    tenants = db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    await Promise.all([operators.init(), staff.init()]);
  });
  beforeEach(async () => {
    await Promise.all([operators.deleteMany({}), staff.deleteMany({}), tenants.deleteMany({})]);
    service = new DeliveryOperatorsService(operators, staff);
    access = new DeliveryAccessService(operators, tenants, staff);
    await tenants.create({ _id: TENANT, slug: 'delivery-fixture', name: 'Restaurant de recette livraison', plan: 'boost' });
  });
  afterAll(async () => { if (db) { await db.dropDatabase(); await db.close(); } });
  const create = () => service.create(TENANT, { name: 'Camille', requestId: randomUUID() }, actor);
  const stored = (id: string) => operators.findById(id).select(PRIVATE).lean();
  const member = (tenantId = TENANT, active = true) => staff.create({ _id: STAFF, tenantId, name: 'Alex', active,
    role: 'caisse', pinHash: 'fixture-not-a-real-pin', hourlyCostCents: 2400, sessionVersion: 'staff-v1' });

  it('crée une seule entrée et preuve pour deux créations concurrentes identiques', async () => {
    const input = { requestId: randomUUID(), name: 'Camille' };
    const [a, b] = await Promise.all([service.create(TENANT, input, actor), service.create(TENANT, input, actor)]);
    expect(a.id).toBe(b.id);
    expect(await operators.countDocuments()).toBe(1);
    expect((await stored(a.id))?.history).toHaveLength(1);
    expect(a).not.toHaveProperty('sessionVersion');
    expect(a).not.toHaveProperty('creationHash');
  });
  it('refuse de réutiliser une tentative pour un autre nom', async () => {
    const input = { requestId: randomUUID(), name: 'Camille' };
    await service.create(TENANT, input, actor);
    await expect(service.create(TENANT, { ...input, name: 'Autre' }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await operators.countDocuments()).toBe(1);
  });
  it('retrouve la création après une réponse perdue sans double inscription', async () => {
    const original = operators.create.bind(operators);
    const spy = vi.spyOn(operators, 'create').mockImplementationOnce(async (...args: unknown[]) => {
      await Reflect.apply(original, operators, args);
      throw new Error('fixture lost acknowledgement');
    });
    try {
      const result = await create();
      expect((await stored(result.id))?.name).toBe('Camille');
      expect(await operators.countDocuments()).toBe(1);
    } finally { spy.mockRestore(); }
  });
  it('habilite un équipier sans recopier PIN/salaire ni créer un autre Staff', async () => {
    await member();
    const result = await service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    const replay = await service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    expect(replay.id).toBe(result.id);
    expect(result).toMatchObject({ name: 'Alex', effectiveActive: true, staffId: STAFF });
    expect(await staff.countDocuments()).toBe(1);
    const listing = await service.list(TENANT);
    expect(JSON.stringify(listing)).not.toMatch(/pinHash|hourlyCost|sessionVersion|creationHash|fixture-not/);
    expect(listing.candidates).toHaveLength(0);
  });
  it('limite les candidats aux membres actifs du restaurant et à une projection minimale', async () => {
    await member();
    await staff.create({ tenantId: OTHER, name: 'Autre', role: 'cuisine', pinHash: 'fixture' });
    await staff.create({ tenantId: TENANT, name: 'Inactif', role: 'cuisine', pinHash: 'fixture', active: false });
    expect((await service.list(TENANT)).candidates).toEqual([{ id: STAFF, name: 'Alex' }]);
  });
  it('ne peut habiliter le membre d’un autre restaurant', async () => {
    await member(OTHER);
    await expect(service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor)).rejects.toMatchObject({ status: 404 });
    expect(await operators.countDocuments()).toBe(0);
  });
  it('isole aussi les lectures et mutations par tenant', async () => {
    const created = await create();
    expect((await service.list(OTHER)).operators).toHaveLength(0);
    await expect(service.update(OTHER, created.id, { expectedRevision: 0, active: false }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.invitation(OTHER, created.id, 0, actor)).rejects.toMatchObject({ status: 404 });
  });
  it('émet un lien10min hashé, journalisé atomiquement, sans retour de secret en liste', async () => {
    const created = await create();
    const invitation = await service.invitation(TENANT, created.id, 0, actor);
    const row = await stored(created.id);
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.invite?.hash).toBe(createHash('sha256').update(invitation.token).digest('hex'));
    expect(new Date(invitation.expiresAt).getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(row?.history.at(-1)).toMatchObject({ action: 'invited', revision: 1, actorId: actor.sub });
    expect(JSON.stringify(await service.list(TENANT))).not.toContain(invitation.token);
    expect(await operators.findById(created.id).lean()).not.toHaveProperty('invite');
  });
  it('ne publie jamais deux invitations concurrentes à la même révision', async () => {
    const created = await create();
    const results = await Promise.allSettled([service.invitation(TENANT, created.id, 0, actor), service.invitation(TENANT, created.id, 0, actor)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await stored(created.id))?.revision).toBe(1);
  });
  it('révoque l’invitation et toute session, sans changer le PIN de l’équipier', async () => {
    await member();
    const created = await service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    await service.invitation(TENANT, created.id, 0, actor);
    const before = await stored(created.id);
    const result = await service.update(TENANT, created.id, { expectedRevision: 1, active: false }, actor);
    const after = await stored(created.id);
    expect(result).toMatchObject({ active: false, effectiveActive: false, revision: 2, inviteExpiresAt: null });
    expect(after).toMatchObject({ invite: null, session: null });
    expect(after?.sessionVersion).not.toBe(before?.sessionVersion);
    expect((await staff.findById(STAFF).lean())?.sessionVersion).toBe('staff-v1');
    await expect(service.invitation(TENANT, created.id, 2, actor)).rejects.toMatchObject({ status: 409 });
  });
  it('rejoue la même révocation mais refuse une vieille action après réactivation', async () => {
    const created = await create();
    const input = { expectedRevision: 0, active: false };
    await service.update(TENANT, created.id, input, actor);
    expect((await service.update(TENANT, created.id, input, actor)).revision).toBe(1);
    await service.update(TENANT, created.id, { expectedRevision: 1, active: true }, actor);
    await expect(service.update(TENANT, created.id, input, actor)).rejects.toMatchObject({ status: 409 });
    expect((await stored(created.id))?.active).toBe(true);
  });
  it('ne ressuscite pas un accès quand Staff est réactivé ou son PIN changé', async () => {
    await member();
    const created = await service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    await staff.updateOne({ _id: STAFF }, { $set: { active: false, sessionVersion: 'staff-v2' } });
    expect((await service.list(TENANT)).operators[0]).toMatchObject({ effectiveActive: false, blockedReason: 'staff_inactive' });
    await staff.updateOne({ _id: STAFF }, { $set: { active: true, sessionVersion: 'staff-v3' } });
    expect((await service.list(TENANT)).operators[0]).toMatchObject({ effectiveActive: false, blockedReason: 'staff_changed' });
    await expect(service.invitation(TENANT, created.id, 0, actor)).rejects.toMatchObject({ status: 409 });
    const renewed = await service.update(TENANT, created.id, { expectedRevision: 0, active: true }, actor);
    expect(renewed).toMatchObject({ effectiveActive: true, sessionState: 'not_connected' });
  });

  async function invite() {
    const operator = await create();
    const invitation = await service.invitation(TENANT, operator.id, 0, actor);
    const input = { token: invitation.token, nonce: randomBytes(32).toString('base64url') };
    return { operator, input };
  }
  it('échange deux POST identiques en une seule session et preuve Mongo', async () => {
    const { operator, input } = await invite();
    const [a, b] = await Promise.all([access.exchange(input), access.exchange(input)]);
    expect(a.token).toBe(b.token);
    const row = await stored(operator.id);
    expect(row?.invite).toBeNull();
    expect(row?.history.filter(event => event.action === 'connected')).toHaveLength(1);
    expect(row?.revision).toBe(2);
    expect(JSON.stringify(row)).not.toContain(a.token);
    expect(await access.authenticate(a.token)).toMatchObject({ operatorId: operator.id, tenantId: TENANT });
  });
  it('n’autorise qu’un téléphone pour deux nonces concurrentes', async () => {
    const { operator, input } = await invite();
    const other = { ...input, nonce: randomBytes(32).toString('base64url') };
    const results = await Promise.allSettled([access.exchange(input), access.exchange(other)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await stored(operator.id))?.history.filter(event => event.action === 'connected')).toHaveLength(1);
  });
  it('récupère une réponse perdue sans rallonger l’expiration et ferme la fenêtre de reprise', async () => {
    const { operator, input } = await invite();
    const first = await access.exchange(input);
    const replay = await access.exchange(input);
    expect(replay).toEqual(first);
    await operators.updateOne({ _id: operator.id }, { $set: { 'session.retryUntil': new Date(0) } });
    await expect(access.exchange(input)).rejects.toMatchObject({ status: 401 });
    expect((await access.authenticate(first.token)).session).toEqual(first.session);
  });
  it('refuse un lien expiré sans session ni événement de connexion', async () => {
    const { operator, input } = await invite();
    await operators.updateOne({ _id: operator.id }, { $set: { 'invite.expiresAt': new Date(0) } });
    await expect(access.exchange(input)).rejects.toMatchObject({ status: 401 });
    expect((await stored(operator.id))?.session).toBeNull();
  });
  it('révoque puis réactive sans restaurer ancien bearer ni invitation consommée', async () => {
    const { operator, input } = await invite();
    const first = await access.exchange(input);
    await service.update(TENANT, operator.id, { expectedRevision: 2, active: false }, actor);
    await service.update(TENANT, operator.id, { expectedRevision: 3, active: true }, actor);
    await expect(access.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
    await expect(access.exchange(input)).rejects.toMatchObject({ status: 401 });
  });
  it('déconnecte côté serveur et empêche la reprise du lien de ressusciter la session', async () => {
    const { operator, input } = await invite();
    const first = await access.exchange(input);
    await access.logout(await access.authenticate(first.token));
    await expect(access.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
    await expect(access.exchange(input)).rejects.toMatchObject({ status: 401 });
    expect((await stored(operator.id))?.history.at(-1)?.action).toBe('logout');
  });
  it('relit suspension et abonnement pour une session déjà émise', async () => {
    const { input } = await invite();
    const first = await access.exchange(input);
    await tenants.updateOne({ _id: TENANT }, { $set: { 'account.status': 'suspended' } });
    await expect(access.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
    await tenants.updateOne({ _id: TENANT }, { $set: { 'account.status': 'active', plan: null, onlineDelivery: false } });
    await expect(access.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
  });
  it('réaffecter le téléphone invalide le précédent dès l’émission du QR', async () => {
    const { operator, input } = await invite();
    const first = await access.exchange(input);
    await service.invitation(TENANT, operator.id, 2, actor);
    await expect(access.authenticate(first.token)).rejects.toMatchObject({ status: 401 });
    await expect(access.exchange(input)).rejects.toMatchObject({ status: 401 });
  });
  it('permet de retrouver et révoquer une entrée au-delà de la première page', async () => {
    const fixture = await create();
    const template = (await stored(fixture.id))!;
    await operators.deleteMany({});
    await operators.insertMany(Array.from({ length: 201 }, (_, index) => ({
      tenantId: TENANT, name: `Livreur ${index}`, creationHash: createHash('sha256').update(String(index)).digest('hex'),
      sessionVersion: randomUUID(), active: true, revision: 0, history: template.history,
    })));
    const first = await service.list(TENANT);
    expect(first.operators).toHaveLength(200);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(TENANT, { after: first.nextCursor! });
    expect(second.operators).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const tail = second.operators[0]!;
    expect(first.operators.some(row => row.id === tail.id)).toBe(false);
    expect(await service.update(TENANT, tail.id, { expectedRevision: 0, active: false }, actor)).toMatchObject({ active: false });
  });
  it('exclut des candidats les équipiers déjà habilités hors de la page consultée', async () => {
    await member();
    const linked = await service.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    const pageAfter = await service.list(TENANT, { after: linked.id });
    expect(pageAfter.operators).toHaveLength(0);
    expect(pageAfter.candidates).toHaveLength(0);
  });
  it('demande la preuve majoritaire pour confirmer une révocation rejouée', async () => {
    const created = await create();
    await service.update(TENANT, created.id, { expectedRevision: 0, active: false }, actor);
    const original = operators.findOne.bind(operators);
    const spy = vi.spyOn(operators, 'findOne').mockImplementation((...args: unknown[]) => {
      const query = Reflect.apply(original, operators, args);
      const exec = query.exec.bind(query);
      query.exec = () => {
        expect(query.getOptions()).toMatchObject({ readConcern: { level: 'majority' }, maxTimeMS: 10_000 });
        return exec();
      };
      return query;
    });
    try {
      expect(await service.update(TENANT, created.id, { expectedRevision: 0, active: false }, actor)).toMatchObject({ active: false });
    } finally { spy.mockRestore(); }
  });
});
