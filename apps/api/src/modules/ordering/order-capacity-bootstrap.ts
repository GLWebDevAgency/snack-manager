import { orderAdmissionChannel, orderAdmissionId, isPublicOrderAdmission } from '../orders/order-admission-identity';
import { sameRecoveryHash } from '../orders/order-recovery';
import { buildOrderCapacityCalendar } from './order-capacity-calendar';
import { orderCapacityCalendarPlanHash, validatePlan, validRevision, type Plan } from './order-capacity-control';
import { formatDay, parisWallToUtc, parisYmd, parseDay } from './paris-time';
import type {
  BootstrapAdmissionEvidence, BootstrapOrderEvidence, CapacityBootstrapDay, CapacityBootstrapInput,
  CapacityBootstrapIssue, CapacityBootstrapOccupant, CapacityBootstrapReport,
} from './order-capacity-bootstrap.types';

const ID = /^[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CHANNELS = ['online', 'pos', 'phone'];
const TYPES = ['surplace', 'emporter', 'pickup', 'delivery'];
const STATUSES = ['new', 'preparing', 'ready', 'delivered', 'cancelled'];
const STATES = ['validating', 'committing', 'created', 'rejected'];

export class InvalidCapacityBootstrapInput extends Error {
  readonly code = 'INVALID_CAPACITY_BOOTSTRAP_INPUT';
  constructor() {
    super('Contexte d’analyse de capacité invalide. Aucune migration ne peut être déduite de ce résultat.');
    this.name = 'InvalidCapacityBootstrapInput';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function date(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime()) && Boolean(parseDay(formatDay(parisYmd(value))));
}
function identifier(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function hash(value: unknown): value is string { return typeof value === 'string' && HASH.test(value); }
function clientKey(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function recovery(value: unknown): boolean {
  return record(value) && value.version === 1 && hash(value.proofHash) && hash(value.payloadHash);
}
function orderEvidence(value: unknown): value is BootstrapOrderEvidence {
  return record(value) && identifier(value.orderId) && identifier(value.tenantId) && clientKey(value.clientId)
    && CHANNELS.includes(value.channel as string) && TYPES.includes(value.type as string) && STATUSES.includes(value.status as string)
    && (value.slot === null || date(value.slot))
    // Les anciennes commandes staff peuvent être sans créneau, y compris
    // channel=online. Seule l'origine publique prouvée (ou la livraison)
    // impose un créneau pour une commande qui n'est pas annulée.
    && (value.status === 'cancelled' || (value.type !== 'delivery' && value.publicRecovery == null) || date(value.slot))
    && (value.publicRecovery == null || (value.channel === 'online' && recovery(value.publicRecovery)));
}
/** Imported terminal claims have no C01 compatibility/default. Validate their
 * shape even when old; the contextual Order/type/release checks remain below. */
function historicalCapacity(value: unknown, slot: Date): boolean {
  if (!record(value) || !date(value.slot) || value.slot.getTime() !== slot.getTime()) return false;
  if (value.releasedAt !== undefined) {
    return date(value.releasedAt) && value.kitchenSeat === undefined && value.deliverySeat === undefined;
  }
  return typeof value.kitchenSeat === 'number' && Number.isInteger(value.kitchenSeat)
    && value.kitchenSeat >= 0 && value.kitchenSeat <= 99
    && (value.deliverySeat === undefined || (typeof value.deliverySeat === 'number'
      && Number.isInteger(value.deliverySeat) && value.deliverySeat >= 0 && value.deliverySeat <= 49));
}
function admissionEvidence(value: unknown): value is BootstrapAdmissionEvidence {
  if (!record(value) || !identifier(value.tenantId) || !clientKey(value.clientId) || value.version !== 1
    || !hash(value.admissionId) || value.admissionId !== orderAdmissionId(value.tenantId, value.clientId)
    || !date(value.slot)
    || !STATES.includes(value.state as string) || (value.orderId != null && !identifier(value.orderId))) return false;
  if (value.kind === 'historical') {
    const source = value.historicalImport;
    return value.state === 'created' && identifier(value.orderId) && CHANNELS.includes(value.channel as string)
      && value.proofHash === undefined && value.payloadHash === undefined && value.snapshot === undefined
      && value.validationOwner === undefined && value.rejection === undefined && historicalCapacity(value.capacity, value.slot)
      && record(source) && source.version === 1 && typeof source.bootstrapId === 'string' && UUID.test(source.bootstrapId) && date(source.importedAt);
  }
  if (!hash(value.proofHash) || !hash(value.payloadHash) || value.historicalImport !== undefined) return false;
  try { orderAdmissionChannel(value); return true; } catch { return false; }
}
function sameIdentity(admission: BootstrapAdmissionEvidence, order: BootstrapOrderEvidence): boolean {
  return order.orderId === admission.orderId && order.tenantId === admission.tenantId && order.clientId === admission.clientId
    && order.channel === (admission.kind === 'historical' ? admission.channel : orderAdmissionChannel(admission)) && order.slot?.getTime() === admission.slot.getTime();
}
function sameBinding(admission: BootstrapAdmissionEvidence, order: BootstrapOrderEvidence): boolean {
  const stored = order.publicRecovery;
  return isPublicOrderAdmission(admission)
    ? Boolean(stored && stored.version === 1 && admission.proofHash && admission.payloadHash && sameRecoveryHash(stored.proofHash, admission.proofHash)
      && sameRecoveryHash(stored.payloadHash, admission.payloadHash))
    : stored == null;
}
function copyPlan(plan: Plan): Plan {
  return { day: plan.day, sourceRevision: plan.sourceRevision, closedReason: plan.closedReason,
    slots: plan.slots.map((slot) => ({ at: new Date(slot.at), kitchenCapacity: slot.kitchenCapacity, deliveryCapacity: slot.deliveryCapacity })) };
}
function readPlan(value: unknown): Plan {
  // Frontière de lecture de données persistées : assertion après validation
  // réelle, aucune valeur absente convertie en défaut de capacité.
  validatePlan(value as Plan);
  return copyPlan(value as Plan);
}

/**
 * Analyse PURE d'empreintes explicitement fournies, jamais un bootstrap exécutable.
 * Ne lit ni DB, ni heure courante ; ne produit aucun write, siège à importer,
 * prix, hash de reprise ou instruction de remboursement. Une absence d'anomalie
 * ne prouve PAS l'exhaustivité/cohérence temporelle du scan ni l'arrêt des writers.
 * Le futur applicateur devra relire sous exclusion, vérifier les index et garder
 * les snapshots complets : cette projection ne certifie pas leur matérialisabilité.
 */
export function planCapacityBootstrap(input: CapacityBootstrapInput): CapacityBootstrapReport {
  if (!record(input) || !identifier(input.tenantId) || !date(input.cutoverAt) || !validRevision(input.sourceRevision)
    || !record(input.settings) || !Array.isArray(input.orders) || !Array.isArray(input.admissions)
    || (input.frozenDays !== undefined && !Array.isArray(input.frozenDays))) throw new InvalidCapacityBootstrapInput();
  const from = parisWallToUtc(parisYmd(input.cutoverAt));
  const firstDay = formatDay(parisYmd(from));
  const issues: CapacityBootstrapIssue[] = [];
  const occupants: CapacityBootstrapOccupant[] = [];
  const days = new Set<string>([firstDay]);
  const inScope = (slot: Date) => slot.getTime() >= from.getTime();
  const remember = (slot: Date) => { if (inScope(slot)) days.add(formatDay(parisYmd(slot))); };
  const linkedScope = (value: unknown) => {
    if (value == null) return false;
    // Une référence malformée ne peut pas être déclarée ancienne. L'autre
    // date du document ne doit pas masquer sa période inconnue/future.
    if (!record(value) || !date(value.slot)) return true;
    remember(value.slot);
    return inScope(value.slot);
  };
  const ordersById = new Map<string, BootstrapOrderEvidence>();
  const ordersByClient = new Map<string, BootstrapOrderEvidence>();
  const admissionsByClient = new Map<string, BootstrapAdmissionEvidence>();
  const admissionsByOrder = new Map<string, BootstrapAdmissionEvidence>();

  for (const [index, order] of input.orders.entries()) {
    if (!orderEvidence(order)) { issues.push({ code: 'invalid_order', source: 'order', index }); continue; }
    if (order.tenantId !== input.tenantId) { issues.push({ code: 'foreign_tenant', source: 'order', index }); continue; }
    if (ordersById.has(order.orderId) || ordersByClient.has(order.clientId)) {
      issues.push({ code: 'duplicate_order_identity', source: 'order', orderId: order.orderId });
    }
    // Ne pas compter deux fois une même ligne de scan répétée ; deux vrais IDs
    // restent deux ventes, même si leur clé métier est corrompue (plan bloqué).
    if (!ordersById.has(order.orderId)) ordersById.set(order.orderId, order);
    if (!ordersByClient.has(order.clientId)) ordersByClient.set(order.clientId, order);
    if (order.slot) remember(order.slot);
  }

  const seatOwners = new Map<string, string>();
  function checkCapacity(admission: BootstrapAdmissionEvidence, order: BootstrapOrderEvidence | undefined, persisted: boolean) {
    const claim = admission.capacity;
    if (claim == null) return; // Admission C01 antérieure aux places, ne pas en inventer.
    const reference = { source: 'admission' as const, admissionId: admission.admissionId };
    const invalid = () => issues.push({ code: 'invalid_capacity_claim', ...reference });
    if (!record(claim) || !date(claim.slot) || claim.slot.getTime() !== admission.slot.getTime() || !order) { invalid(); return; }
    const released = claim.releasedAt !== undefined;
    const hasKitchen = claim.kitchenSeat !== undefined;
    const hasDelivery = claim.deliverySeat !== undefined;
    if (released) {
      if (!date(claim.releasedAt) || hasKitchen || hasDelivery || !persisted || order.status !== 'cancelled') invalid();
      return;
    }
    if (!hasKitchen || !Number.isInteger(claim.kitchenSeat) || claim.kitchenSeat! < 0 || claim.kitchenSeat! > 99
      || (order.type === 'delivery' ? !hasDelivery : hasDelivery)
      || (hasDelivery && (!Number.isInteger(claim.deliverySeat) || claim.deliverySeat! < 0 || claim.deliverySeat! > 49))) {
      invalid(); return;
    }
    if (persisted && order.status === 'cancelled') issues.push({ code: 'capacity_release_required', ...reference });
    for (const [dimension, seat] of [['kitchen', claim.kitchenSeat], ['delivery', claim.deliverySeat]] as const) {
      if (seat === undefined) continue;
      const key = `${admission.slot.toISOString()}:${dimension}:${seat}`;
      if (seatOwners.has(key)) issues.push({ code: 'capacity_seat_collision', ...reference, dimension });
      else seatOwners.set(key, admission.admissionId);
    }
  }

  for (const [index, admission] of input.admissions.entries()) {
    if (!admissionEvidence(admission)) { issues.push({ code: 'invalid_admission', source: 'admission', index }); continue; }
    if (admission.tenantId !== input.tenantId) { issues.push({ code: 'foreign_tenant', source: 'admission', index }); continue; }
    if (admissionsByClient.has(admission.clientId)) {
      issues.push({ code: 'duplicate_admission_identity', source: 'admission', admissionId: admission.admissionId }); continue;
    }
    admissionsByClient.set(admission.clientId, admission);
    if (admission.orderId != null && ['committing', 'created'].includes(admission.state)) {
      const owner = admissionsByOrder.get(admission.orderId);
      // Deux snapshots individuellement valides ne peuvent matérialiser deux
      // ventes différentes sous le même _id. Conserver les occupations de
      // prudence, mais signaler le conflit sans élire de gagnant automatique.
      if (owner && owner.clientId !== admission.clientId) {
        issues.push({ code: 'admission_identity_mismatch', source: 'admission', admissionId: admission.admissionId });
      } else admissionsByOrder.set(admission.orderId, admission);
    }
    remember(admission.slot);
    const byId = admission.orderId ? ordersById.get(admission.orderId) : undefined;
    const byClient = ordersByClient.get(admission.clientId);
    // Examiner les deux références même si le slot principal est déjà futur.
    const snapshotRelevant = linkedScope(admission.snapshot);
    const claimRelevant = linkedScope(admission.capacity);
    const relevant = inScope(admission.slot) || snapshotRelevant || claimRelevant
      || Boolean(byId?.slot && inScope(byId.slot)) || Boolean(byClient?.slot && inScope(byClient.slot));
    if (!relevant) continue;
    const reference = { source: 'admission' as const, admissionId: admission.admissionId };
    if (admission.state === 'validating' || admission.state === 'rejected') {
      if (admission.state === 'validating') issues.push({ code: 'pending_validation', ...reference });
      if (admission.orderId != null || admission.snapshot != null || admission.capacity != null || byId || byClient) {
        issues.push({ code: 'terminal_admission_conflict', ...reference });
      }
      continue;
    }
    const snapshot = admission.snapshot;
    const validSnapshot = orderEvidence(snapshot) && snapshot.status !== 'cancelled';
    if (admission.state === 'created' && snapshot != null) issues.push({ code: 'terminal_admission_conflict', ...reference });
    // Même si l'Order existe déjà, le committing reste à rapprocher/acquitter
    // par le helper complet avant activation. L'Order n'est jamais réinitialisée.
    if (admission.state === 'committing') issues.push({ code: 'materialization_required', ...reference });
    if (admission.state === 'committing' && !validSnapshot) issues.push({ code: 'invalid_snapshot', ...reference });
    if (admission.orderId == null || (byId && !sameIdentity(admission, byId)) || (byClient && byClient !== byId)
      || (snapshot != null && (!validSnapshot || !sameIdentity(admission, snapshot)))
      || (byId && validSnapshot && byId.type !== snapshot.type)) issues.push({ code: 'admission_identity_mismatch', ...reference });
    if ((byId && !sameBinding(admission, byId)) || (validSnapshot && !sameBinding(admission, snapshot))) {
      issues.push({ code: 'recovery_binding_mismatch', ...reference });
    }
    if (admission.state === 'created' && !byId) issues.push({ code: 'missing_order', ...reference });
    const exactOrder = byId && sameIdentity(admission, byId) ? byId : undefined;
    const exactSnapshot = validSnapshot && sameIdentity(admission, snapshot) ? snapshot : undefined;
    checkCapacity(admission, exactOrder ?? exactSnapshot, Boolean(exactOrder));
    if (admission.state === 'committing' && !byId && exactSnapshot && inScope(exactSnapshot.slot!)) {
      // Un snapshot engagé occupe déjà la place, mais reste à matérialiser avant
      // la bascule. Jamais de fabrication d'Order depuis cette empreinte réduite.
      occupants.push({ orderId: exactSnapshot.orderId, admissionId: admission.admissionId, channel: exactSnapshot.channel,
        type: exactSnapshot.type, slot: exactSnapshot.slot!.toISOString(), source: 'committing_snapshot' });
    }
  }

  for (const order of ordersById.values()) {
    if (!order.slot || !inScope(order.slot) || order.status === 'cancelled') continue;
    const admission = admissionsByClient.get(order.clientId);
    if (order.publicRecovery && !admission) issues.push({ code: 'missing_admission', source: 'order', orderId: order.orderId });
    occupants.push({ orderId: order.orderId, admissionId: admission && sameIdentity(admission, order) ? admission.admissionId : null,
      channel: order.channel, type: order.type, slot: order.slot.toISOString(), source: 'order' });
  }

  const frozen = new Map<string, Plan>();
  const invalidDays = new Set<string>();
  for (const [index, stored] of (input.frozenDays ?? []).entries()) {
    if (!record(stored) || typeof stored.day !== 'string' || !parseDay(stored.day)) {
      issues.push({ code: 'invalid_calendar', source: 'calendar', index }); continue;
    }
    if (stored.tenantId !== input.tenantId) { issues.push({ code: 'foreign_tenant', source: 'calendar', index }); continue; }
    if (stored.day < firstDay) continue;
    days.add(stored.day);
    if (frozen.has(stored.day) || invalidDays.has(stored.day)) {
      issues.push({ code: 'duplicate_calendar', source: 'calendar', day: stored.day }); invalidDays.add(stored.day); continue;
    }
    try {
      const plan = readPlan(stored);
      if (plan.sourceRevision > input.sourceRevision || !['ready', 'seeding', 'blocked'].includes(stored.state as string)) throw new Error('invalid');
      frozen.set(stored.day, plan);
      if (stored.state !== 'ready') issues.push({ code: 'calendar_not_ready', source: 'calendar', day: stored.day });
    } catch { issues.push({ code: 'invalid_calendar', source: 'calendar', day: stored.day }); invalidDays.add(stored.day); }
  }
  if (input.dayIntent != null) {
    const intent = input.dayIntent;
    issues.push({ code: 'pending_calendar_intent', source: 'intent' });
    try {
      validatePlan(intent);
      if (!UUID.test(intent.operationId) || intent.sourceRevision > input.sourceRevision || intent.day < firstDay
        || !hash(intent.planHash) || intent.planHash !== orderCapacityCalendarPlanHash(intent)) throw new Error('invalid');
      days.add(intent.day);
      const existing = frozen.get(intent.day);
      if (existing && orderCapacityCalendarPlanHash(existing) !== intent.planHash) {
        issues.push({ code: 'calendar_intent_mismatch', source: 'intent', day: intent.day }); invalidDays.add(intent.day);
      } else if (!invalidDays.has(intent.day)) frozen.set(intent.day, copyPlan(intent));
    } catch {
      issues.push({ code: 'invalid_calendar', source: 'intent' });
      if (record(intent) && typeof intent.day === 'string' && parseDay(intent.day)) invalidDays.add(intent.day);
    }
  }

  const occupantsByDay = new Map<string, CapacityBootstrapOccupant[]>();
  for (const occupant of occupants) {
    const day = formatDay(parisYmd(new Date(occupant.slot)));
    days.add(day);
    const values = occupantsByDay.get(day) ?? [];
    values.push(occupant); occupantsByDay.set(day, values);
  }
  const claimsByDay = new Map<string, BootstrapAdmissionEvidence[]>();
  for (const admission of admissionsByClient.values()) {
    if (!admission.capacity || !date(admission.capacity.slot)) continue;
    const day = formatDay(parisYmd(admission.capacity.slot));
    const values = claimsByDay.get(day) ?? [];
    values.push(admission); claimsByDay.set(day, values);
  }
  const reportDays: CapacityBootstrapDay[] = [];
  for (const day of [...days].sort()) {
    if (invalidDays.has(day)) continue; // Ne jamais remplacer un plan invalide par les réglages du jour.
    let plan = frozen.get(day);
    if (!plan) {
      try {
        const grid = buildOrderCapacityCalendar(input.settings, day);
        plan = { day, sourceRevision: input.sourceRevision, closedReason: grid.emptyReason,
          slots: grid.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at, kitchenCapacity, deliveryCapacity })) };
      } catch { issues.push({ code: 'invalid_calendar', source: 'calendar', day }); continue; }
    }
    const slots = plan.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at: at.toISOString(),
      kitchenCapacity, deliveryCapacity, kitchenUsed: 0, deliveryUsed: 0 }));
    const bySlot = new Map(slots.map((slot) => [slot.at, slot]));
    for (const occupant of occupantsByDay.get(day) ?? []) {
      const slot = bySlot.get(occupant.slot);
      if (!slot) {
        issues.push({ code: slots.length ? 'off_grid_order' : 'closed_day_order', source: 'order', day,
          orderId: occupant.orderId, slot: occupant.slot }); continue;
      }
      slot.kitchenUsed += 1;
      if (occupant.type === 'delivery') slot.deliveryUsed += 1;
    }
    for (const slot of slots) {
      for (const dimension of ['kitchen', 'delivery'] as const) {
        if (slot[`${dimension}Used`] > slot[`${dimension}Capacity`]) {
          issues.push({ code: 'capacity_exceeded', source: 'slot', day, slot: slot.at, dimension });
        }
      }
    }
    // Une place historique réservée au-delà de la grille effective est aussi
    // incohérente, même si le simple nombre d'occupants semble acceptable.
    for (const admission of claimsByDay.get(day) ?? []) {
      const claim = admission.capacity!;
      const slot = bySlot.get(claim.slot.toISOString());
      if (!slot) continue; // Déjà signalé pour l'occupant ; une libération peut rester à rapprocher.
      for (const dimension of ['kitchen', 'delivery'] as const) {
        const seat = claim[`${dimension}Seat`];
        if (typeof seat === 'number' && seat >= slot[`${dimension}Capacity`]) {
          issues.push({ code: 'invalid_capacity_claim', source: 'admission', admissionId: admission.admissionId, day, dimension });
        }
      }
    }
    reportDays.push({ day, sourceRevision: plan.sourceRevision, frozen: frozen.has(day), closedReason: plan.closedReason, slots });
  }
  // Aucun hash de preuve, snapshot, clientId ou donnée personnelle ne sort.
  const compare = (a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en');
  return { mode: 'analysis_only', canActivate: false, requiresExclusiveRescan: true, status: issues.length ? 'blocked' : 'reviewed',
    tenantId: input.tenantId, cutoverAt: input.cutoverAt.toISOString(), fromInclusive: from.toISOString(),
    days: reportDays, occupants: occupants.sort(compare), issues: issues.sort(compare) };
}
