import { describe, expect, it } from 'vitest';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { orderCapacityCalendarPlanHash } from './order-capacity-control';
import { planCapacityBootstrap } from './order-capacity-bootstrap';
import type { BootstrapAdmissionEvidence, BootstrapFrozenDay, BootstrapOrderEvidence, CapacityBootstrapInput,
  CapacityBootstrapIssueCode, CapacityBootstrapReport } from './order-capacity-bootstrap.types';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const DAY = '2030-05-02';
const SLOT = '2030-05-02T09:00:00.000Z';
const CUTOVER = '2030-05-02T16:00:00.000Z';
const PROOF = 'a'.repeat(64);
const PAYLOAD = 'b'.repeat(64);
const id = (value: number) => value.toString(16).padStart(24, '0');
const date = (iso: string) => new Date(iso);

function order(overrides: Partial<BootstrapOrderEvidence> = {}): BootstrapOrderEvidence {
  return { orderId: id(1), tenantId: TENANT, clientId: 'ancien-ticket:comptoir:1', channel: 'online', type: 'pickup',
    status: 'new', slot: date(SLOT), publicRecovery: null, ...overrides };
}
function protectedOrder(overrides: Partial<BootstrapOrderEvidence> = {}) {
  return order({ publicRecovery: { version: 1, proofHash: PROOF, payloadHash: PAYLOAD }, ...overrides });
}
function admission(evidence: BootstrapOrderEvidence, overrides: Partial<BootstrapAdmissionEvidence> = {}): BootstrapAdmissionEvidence {
  return { admissionId: orderAdmissionId(evidence.tenantId, evidence.clientId), tenantId: evidence.tenantId,
    clientId: evidence.clientId, version: 1, kind: 'public', channel: 'online', state: 'created',
    slot: evidence.slot ?? date(SLOT), orderId: evidence.orderId, proofHash: PROOF, payloadHash: PAYLOAD,
    snapshot: null, capacity: null, ...overrides };
}
function frozen(overrides: Partial<BootstrapFrozenDay> = {}): BootstrapFrozenDay {
  return { tenantId: TENANT, day: DAY, state: 'ready', sourceRevision: 3, closedReason: null,
    slots: [{ at: date(SLOT), kitchenCapacity: 2, deliveryCapacity: 1 }], ...overrides };
}
function input(orders: readonly BootstrapOrderEvidence[] = [], overrides: Partial<CapacityBootstrapInput> = {}): CapacityBootstrapInput {
  return { tenantId: TENANT, cutoverAt: date(CUTOVER), sourceRevision: 7, orders, admissions: [],
    settings: { hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
      lunch: { open: '11:00', close: '12:00' }, dinner: null })),
    settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 }, closures: [] }, ...overrides };
}
function checked(value: CapacityBootstrapInput): CapacityBootstrapReport {
  const report = planCapacityBootstrap(value);
  expect(report).toMatchObject({ mode: 'analysis_only', canActivate: false, requiresExclusiveRescan: true,
    tenantId: TENANT, cutoverAt: value.cutoverAt.toISOString() });
  expect(report.status).toBe(report.issues.length === 0 ? 'reviewed' : 'blocked');
  return report;
}
function issue(report: CapacityBootstrapReport, code: CapacityBootstrapIssueCode) {
  expect(report.status).toBe('blocked');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
}
function slot(report: CapacityBootstrapReport, at = SLOT) {
  return report.days.flatMap((day) => day.slots).find((entry) => entry.at === at);
}
function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}

describe('plan de bootstrap C15 — analyse pure, jamais une autorisation d’activation', () => {
  it('un inventaire vide reste un rapport d’analyse nécessitant un rescan exclusif', () => {
    const report = checked(input());
    expect(report).toMatchObject({ status: 'reviewed', fromInclusive: '2030-05-01T22:00:00.000Z', occupants: [], issues: [] });
    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({ day: DAY, frozen: false, sourceRevision: 7 });
    expect(report.days[0]!.slots.length).toBeGreaterThan(0);
    expect(report.days[0]!.slots.every((entry) => entry.kitchenUsed === 0 && entry.deliveryUsed === 0)).toBe(true);
  });

  it('compte une Order historique sans UUID ni preuve publique fabriquée', () => {
    const row = order();
    const report = checked(input([row]));
    expect(report.issues).toEqual([]);
    expect(report.occupants).toEqual([{ orderId: row.orderId, admissionId: null, channel: 'online', type: 'pickup', slot: SLOT, source: 'order' }]);
    expect(slot(report)).toMatchObject({ kitchenCapacity: 4, deliveryCapacity: 2, kitchenUsed: 1, deliveryUsed: 0 });
  });

  it.each(['new', 'preparing', 'ready', 'delivered'])('l’état %s non annulé ne libère pas une place cuisine', (status) => {
    const report = checked(input([order({ status })]));
    expect(report.issues).toEqual([]);
    expect(slot(report)?.kitchenUsed).toBe(1);
  });

  it.each(['online', 'pos', 'phone'].flatMap((channel) => ['pickup', 'delivery', 'surplace', 'emporter'].map((type) => ({ channel, type }))))(
    'une commande $channel/$type avec créneau compte dans la cuisine commune', ({ channel, type }) => {
      const report = checked(input([order({ channel, type })]));
      expect(report.issues).toEqual([]);
      expect(slot(report)).toMatchObject({ kitchenUsed: 1, deliveryUsed: type === 'delivery' ? 1 : 0 });
    },
  );

  it('ignore les commandes annulées et les ventes POS sans créneau', () => {
    const report = checked(input([order({ status: 'cancelled' }), order({ orderId: id(2), clientId: 'ticket-2', channel: 'pos', type: 'surplace', slot: null })]));
    expect(report).toMatchObject({ status: 'reviewed', occupants: [] });
    expect(report.days.map((day) => day.day)).toEqual([DAY]);
    expect(report.days[0]!.slots.every((entry) => entry.kitchenUsed === 0 && entry.deliveryUsed === 0)).toBe(true);
  });

  it('inclut le service avant l’heure de bascule dans le même jour Paris mais exclut la veille', () => {
    const report = checked(input([order(), order({ orderId: id(2), clientId: 'veille', slot: date('2030-05-01T21:59:59.999Z') })]));
    expect(report.issues).toEqual([]);
    expect(report.fromInclusive).toBe('2030-05-01T22:00:00.000Z');
    expect(report.occupants.map((entry) => entry.orderId)).toEqual([id(1)]);
    expect(report.days.map((day) => day.day)).toEqual([DAY]);
  });

  it('recense J+365 et J+10ans sans horizon ni génération de journées intermédiaires', () => {
    const report = checked(input([order(), order({ orderId: id(2), clientId: 'an-1', slot: date('2031-05-02T09:00:00.000Z') }),
      order({ orderId: id(3), clientId: 'an-10', slot: date('2040-05-02T09:00:00.000Z') })]));
    expect(report.issues).toEqual([]);
    expect(report.days.map((day) => day.day)).toEqual([DAY, '2031-05-02', '2040-05-02']);
    expect(report.occupants).toHaveLength(3);
  });

  it('déduplique une Order et son admission created exactement liées', () => {
    const row = protectedOrder(); const proof = admission(row);
    const report = checked(input([row], { admissions: [proof] }));
    expect(report.issues).toEqual([]);
    expect(report.occupants).toEqual([expect.objectContaining({ orderId: row.orderId, admissionId: proof.admissionId, source: 'order' })]);
    expect(slot(report)?.kitchenUsed).toBe(1);
  });

  it('préserve la compatibilité C01 des admissions sans kind ni channel', () => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, { kind: undefined, channel: undefined })] }));
    expect(report.issues).toEqual([]);
    expect(slot(report)?.kitchenUsed).toBe(1);
  });

  it('une admission created sans Order bloque au lieu d’inventer une matérialisation', () => {
    const report = checked(input([], { admissions: [admission(protectedOrder())] }));
    issue(report, 'missing_order');
  });

  it('un snapshot committing valide compte sa place et exige sa matérialisation', () => {
    const row = protectedOrder({ type: 'delivery' });
    const proof = admission(row, { state: 'committing', snapshot: row });
    const report = checked(input([], { admissions: [proof] }));
    issue(report, 'materialization_required');
    expect(report.occupants).toEqual([expect.objectContaining({ orderId: row.orderId, admissionId: proof.admissionId, source: 'committing_snapshot' })]);
    expect(slot(report)).toMatchObject({ kitchenUsed: 1, deliveryUsed: 1 });
  });

  it('un snapshot et son Order déjà écrite ne comptent pas deux places', () => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, { state: 'committing', snapshot: row })] }));
    expect(report.occupants).toHaveLength(1);
    expect(slot(report)?.kitchenUsed).toBe(1);
    issue(report, 'materialization_required');
  });

  it.each([null, undefined])('un committing sans snapshot %s est bloquant', (snapshot) => {
    const report = checked(input([], { admissions: [admission(protectedOrder(), { state: 'committing', snapshot })] }));
    issue(report, 'invalid_snapshot');
    expect(report.occupants).toEqual([]);
  });

  it.each([
    { orderId: id(9) }, { clientId: 'autre-client' }, { slot: date('2030-05-02T09:30:00.000Z') },
  ])('refuse l’identité discordante d’un snapshot committing structurellement valide %j', (patch) => {
    const row = protectedOrder();
    const report = checked(input([], { admissions: [admission(row, { state: 'committing', snapshot: { ...row, ...patch } })] }));
    issue(report, 'admission_identity_mismatch');
    expect(report.issues.some((entry) => entry.code === 'invalid_snapshot')).toBe(false);
  });

  it('refuse un snapshot téléphone portant une preuve publique réservée au canal online', () => {
    const row = protectedOrder();
    const report = checked(input([], { admissions: [admission(row, { state: 'committing', snapshot: { ...row, channel: 'phone' } })] }));
    issue(report, 'invalid_snapshot');
  });

  it.each([
    { slot: date('2030-05-02T09:30:00.000Z') }, { orderId: id(9) },
  ])('une liaison admission/Order discordante %j bloque', (patch) => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, patch)] }));
    issue(report, 'admission_identity_mismatch');
  });

  it('le canal phone d’une admission staff ne peut adopter une Order POS', () => {
    const row = order({ channel: 'pos' });
    const report = checked(input([row], { admissions: [admission(row, { kind: 'staff', channel: 'phone' })] }));
    issue(report, 'admission_identity_mismatch');
  });

  it.each([
    { proofHash: 'c'.repeat(64) }, { payloadHash: 'd'.repeat(64) },
  ])('une preuve publique différente de celle de l’Order bloque %j', (patch) => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, patch)] }));
    issue(report, 'recovery_binding_mismatch');
  });

  it.each([{ kind: null }, { kind: 'historical' }, { channel: 'pos' }, { version: 2 }, { proofHash: 'invalide' }])(
    'refuse une admission non prise en charge %j', (patch) => {
      const row = protectedOrder();
      issue(checked(input([row], { admissions: [admission(row, patch)] })), 'invalid_admission');
    },
  );

  it('une admissionId qui ne correspond pas au tenant/clientId est bloquante', () => {
    const row = protectedOrder();
    issue(checked(input([row], { admissions: [admission(row, { admissionId: orderAdmissionId(TENANT, 'autre') })] })), 'invalid_admission');
  });

  it('une validation en vol exige arbitrage exclusif, pas une expiration implicite', () => {
    const proof = admission(protectedOrder(), { state: 'validating', orderId: null });
    const report = checked(input([], { admissions: [proof] }));
    issue(report, 'pending_validation');
    expect(report.occupants).toEqual([]);
  });

  it('un rejet sans snapshot ni places ne réserve rien', () => {
    const report = checked(input([], { admissions: [admission(protectedOrder(), { state: 'rejected', orderId: null })] }));
    expect(report).toMatchObject({ status: 'reviewed', occupants: [], issues: [] });
  });

  it('une admission rejected face à une Order existante est un conflit terminal', () => {
    const row = protectedOrder();
    issue(checked(input([row], { admissions: [admission(row, { state: 'rejected', orderId: null })] })), 'terminal_admission_conflict');
  });

  it.each(['order', 'admission', 'calendar'] as const)('refuse une preuve %s d’un autre tenant', (source) => {
    const foreign = protectedOrder({ tenantId: OTHER_TENANT });
    const report = checked(input(source === 'order' ? [foreign] : [], {
      admissions: source === 'admission' ? [admission(foreign)] : [],
      frozenDays: source === 'calendar' ? [frozen({ tenantId: OTHER_TENANT })] : [],
    }));
    issue(report, 'foreign_tenant');
    expect(report.occupants).toEqual([]);
  });

  it.each(['orderId', 'clientId'] as const)('refuse deux Orders partageant %s sans choisir arbitrairement un gagnant', (field) => {
    const a = order(); const b = order({ orderId: id(2), clientId: 'ticket-2', [field]: a[field] });
    issue(checked(input([a, b])), 'duplicate_order_identity');
  });

  it('refuse deux admissions partageant la même identité', () => {
    const row = protectedOrder(); const proof = admission(row);
    issue(checked(input([row], { admissions: [proof, { ...proof }] })), 'duplicate_admission_identity');
  });

  it.each([{ orderId: 'pas-un-object-id' }, { status: 'inconnu' }, { channel: 'inconnu' }, { type: 'inconnu' }, { slot: new Date(NaN) }])(
    'signale une Order malformée %j au lieu de l’ignorer', (patch) => issue(checked(input([order(patch)])), 'invalid_order'),
  );

  it('conserve les capacités et la révision d’un jour prêt antérieur aux réglages courants', () => {
    const report = checked(input([order()], { frozenDays: [frozen()] }));
    expect(report.issues).toEqual([]);
    expect(report.days).toEqual([{ day: DAY, sourceRevision: 3, frozen: true, closedReason: null,
      slots: [{ at: SLOT, kitchenCapacity: 2, deliveryCapacity: 1, kitchenUsed: 1, deliveryUsed: 0 }] }]);
  });

  it('une journée explicitement fermée ne rouvre pas pour faire entrer un historique', () => {
    const report = checked(input([order()], { frozenDays: [frozen({ slots: [], closedReason: 'exceptional_closure' })] }));
    issue(report, 'closed_day_order');
    expect(report.days[0]).toMatchObject({ frozen: true, slots: [], closedReason: 'exceptional_closure' });
  });

  it.each([-1, 1])('un historique hors grille de %sms n’est pas arrondi dans un autre créneau', (offset) => {
    const at = new Date(new Date(SLOT).getTime() + offset);
    const report = checked(input([order({ slot: at })]));
    issue(report, 'off_grid_order');
    expect(report.days.flatMap((day) => day.slots).every((entry) => entry.kitchenUsed === 0)).toBe(true);
  });

  it('les deux occurrences du 02h30 d’automne restent des instants distincts dans une grille figée', () => {
    const first = '2030-10-27T00:30:00.000Z'; const second = '2030-10-27T01:30:00.000Z';
    const report = checked(input([order({ slot: date(first) }), order({ orderId: id(2), clientId: 'repli-hiver', slot: date(second) })], {
      frozenDays: [frozen({ day: '2030-10-27', slots: [first, second].map((at) => ({ at: date(at), kitchenCapacity: 1, deliveryCapacity: 1 })) })],
    }));
    expect(report.issues).toEqual([]);
    expect(report.days.find((day) => day.day === '2030-10-27')!.slots.map((entry) => [entry.at, entry.kitchenUsed])).toEqual([[first, 1], [second, 1]]);
    expect(report.occupants).toHaveLength(2);
  });

  it('ne déplace pas la première occurrence DST vers la seconde occurrence de la grille calculée', () => {
    const first = '2030-10-27T00:30:00.000Z'; const second = '2030-10-27T01:30:00.000Z';
    const evidence = input([order({ slot: date(first) }), order({ orderId: id(2), clientId: 'seconde-occurrence', slot: date(second) })]);
    const report = checked({ ...evidence, settings: { ...evidence.settings,
      hours: [{ day: 7, lunch: { open: '02:00', close: '03:00' }, dinner: null }] } });
    issue(report, 'off_grid_order');
    expect(report.issues).toEqual([expect.objectContaining({ code: 'off_grid_order', orderId: id(1), slot: first })]);
    expect(slot(report, first)).toBeUndefined();
    expect(slot(report, second)?.kitchenUsed).toBe(1);
    expect(report.occupants).toHaveLength(2);
  });

  it.each(['seeding', 'blocked'])('ne certifie pas un calendrier %s comme prêt', (state) => {
    issue(checked(input([order()], { frozenDays: [frozen({ state })] })), 'calendar_not_ready');
  });

  it('refuse deux calendriers du même jour', () => {
    issue(checked(input([order()], { frozenDays: [frozen(), frozen()] })), 'duplicate_calendar');
  });

  it.each([
    { sourceRevision: 8 }, { slots: [{ at: date(SLOT), kitchenCapacity: 0, deliveryCapacity: 1 }] },
    { slots: [{ at: date(SLOT), kitchenCapacity: 101, deliveryCapacity: 1 }] },
  ])('refuse un calendrier incohérent %j sans ramener ses valeurs dans les bornes', (patch) => {
    issue(checked(input([order()], { frozenDays: [frozen(patch)] })), 'invalid_calendar');
  });

  it('conserve le surbooking réel sans plafonner le nombre d’occupants à la capacité', () => {
    const rows = [1, 2, 3].map((number) => order({ orderId: id(number), clientId: `ticket-${number}`, type: 'delivery' }));
    const report = checked(input(rows, { frozenDays: [frozen()] }));
    issue(report, 'capacity_exceeded');
    expect(slot(report)).toMatchObject({ kitchenCapacity: 2, deliveryCapacity: 1, kitchenUsed: 3, deliveryUsed: 3 });
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'capacity_exceeded', dimension: 'kitchen' }),
      expect.objectContaining({ code: 'capacity_exceeded', dimension: 'delivery' }),
    ]));
  });

  it('une intention persistée exige rapprochement même quand son hash est correct', () => {
    const plan = { day: DAY, sourceRevision: 7, closedReason: null, slots: [{ at: date(SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }] };
    const dayIntent = { ...plan, operationId: '00000000-0000-4000-8000-000000000001', planHash: orderCapacityCalendarPlanHash(plan) };
    issue(checked(input([order()], { dayIntent })), 'pending_calendar_intent');
  });

  it('signale deux admissions revendiquant le même siège cuisine', () => {
    const rows = [1, 2].map((number) => protectedOrder({ orderId: id(number), clientId: `ticket-${number}` }));
    const admissions = rows.map((row) => admission(row, { capacity: { slot: date(SLOT), kitchenSeat: 0 } }));
    issue(checked(input(rows, { admissions })), 'capacity_seat_collision');
  });

  it('une commande annulée avec une place encore détenue exige une restitution, sans compter une nouvelle vente', () => {
    const row = protectedOrder({ status: 'cancelled' });
    const report = checked(input([row], { admissions: [admission(row, { capacity: { slot: date(SLOT), kitchenSeat: 0 } })] }));
    issue(report, 'capacity_release_required');
    expect(report.occupants).toEqual([]);
  });

  it.each([
    { type: 'pickup', capacity: { slot: date(SLOT) } },
    { type: 'pickup', capacity: { slot: date(SLOT), kitchenSeat: 0, deliverySeat: 0 } },
    { type: 'delivery', capacity: { slot: date(SLOT), kitchenSeat: 0 } },
    { type: 'delivery', capacity: { slot: date(SLOT), kitchenSeat: 0, deliverySeat: 2 } },
    { type: 'pickup', capacity: { slot: date(SLOT), kitchenSeat: 4 } },
    { type: 'pickup', capacity: { slot: date('2030-05-02T09:30:00.000Z'), kitchenSeat: 0 } },
  ])('refuse une réservation incohérente ou hors capacité effective : %j', ({ type, capacity }) => {
    const row = protectedOrder({ type });
    const report = checked(input([row], { admissions: [admission(row, { capacity })] }));
    issue(report, 'invalid_capacity_claim');
    expect(slot(report)?.kitchenUsed).toBe(1);
  });

  it('accepte une restitution prouvée sur une Order annulée sans inventer d’occupation', () => {
    const row = protectedOrder({ status: 'cancelled' });
    const report = checked(input([row], { admissions: [admission(row, {
      capacity: { slot: date(SLOT), releasedAt: date(CUTOVER) },
    })] }));
    expect(report.issues).toEqual([]);
    expect(report.occupants).toEqual([]);
  });

  it('ne prend pas une restitution pour preuve de capacité disponible si l’Order reste active', () => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, {
      capacity: { slot: date(SLOT), releasedAt: date(CUTOVER) },
    })] }));
    issue(report, 'invalid_capacity_claim');
    expect(slot(report)?.kitchenUsed).toBe(1);
  });

  it('ne divulgue aucune preuve privée ni clientId, même dans un rapport bloqué', () => {
    const row = protectedOrder();
    const report = checked(input([row], { admissions: [admission(row, { proofHash: 'c'.repeat(64) })] }));
    const serialized = JSON.stringify(report);
    for (const privateValue of [PROOF, PAYLOAD, 'c'.repeat(64), row.clientId]) expect(serialized).not.toContain(privateValue);
    for (const privateKey of ['proofHash', 'payloadHash', 'publicRecovery', 'snapshot', 'clientId']) expect(serialized).not.toContain(`"${privateKey}"`);
  });

  it('ne modifie aucune entrée et produit le même rapport sans horloge ni aléatoire', () => {
    const row = protectedOrder();
    const evidence = input([row], { admissions: [admission(row)], frozenDays: [frozen()] });
    const before = structuredClone(evidence);
    freezeDeep(evidence);
    const first = checked(evidence); const second = checked(evidence);
    expect(evidence).toEqual(before);
    expect(second).toEqual(first);
  });

  it('l’ordre des données valides ne change ni les occupants ni les capacités calculées', () => {
    const rows = [protectedOrder(), protectedOrder({ orderId: id(2), clientId: 'ticket-2', type: 'delivery' }),
      order({ orderId: id(3), clientId: 'ticket-futur', channel: 'phone', slot: date('2031-05-02T09:00:00.000Z') })];
    const admissions = [admission(rows[0]!), admission(rows[1]!)];
    const calendars = [frozen(), frozen({ day: '2031-05-02', slots: [{ at: date('2031-05-02T09:00:00.000Z'), kitchenCapacity: 2, deliveryCapacity: 1 }] })];
    const expected = checked(input(rows, { admissions, frozenDays: calendars }));
    expect(expected.issues).toEqual([]);
    expect(checked(input([...rows].reverse(), {
      admissions: [...admissions].reverse(), frozenDays: [...calendars].reverse(),
    }))).toEqual(expected);
  });
});
