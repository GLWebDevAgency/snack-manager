import {
  DeliveryMissionAssignSchema, DeliveryMissionResultSchema, DeliveryMissionViewSchema,
  type DeliveryMissionAssign, type DeliveryMissionResult, type DeliveryMissionView,
} from '@sm/contracts';
import { mutateStoreItem, requireCrossContextStoreLock, type KeyValueStore } from './storage';

export const DELIVERY_ASSIGNMENT_STORAGE_KEY = 'sm.delivery-assignment.v1';
export const DELIVERY_ASSIGNMENT_REASON = 'Affectation depuis la caisse';
const MAX_OPERATIONS = 128;
const MAX_JOURNAL_LENGTH = 131_072;
const objectId = /^[a-f0-9]{24}$/;
const ownerPattern = /^[a-f0-9]{24}:(?:user|staff):[a-f0-9]{24}$/;

export interface DeliveryAssignmentOperation {
  ownerId: string;
  missionId: string;
  body: DeliveryMissionAssign;
}

const storageError = () => new Error('Le journal des affectations est illisible ou indisponible. Conservez le stockage et vérifiez les actions avant de continuer.');
const pendingError = () => new Error('Une affectation reste à vérifier. Reprenez la même action avant d’en créer une autre.');
const confirmationError = () => new Error('Cette réponse ne confirme pas l’affectation. Reprenez la même vérification.');

/** Repère local uniquement : la signature, la révocation et les droits restent vérifiés par l’API. */
export function deliveryAssignmentOwner(token: string): string | null {
  try {
    // Pas de Buffer/atob : même décodage UTF-8 sur Hermes et dans le navigateur.
    const encoded = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (!encoded.length || encoded.length > 16_384 || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]+$/.test(encoded)) return null;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, value = 0, decoded = '';
    for (const char of encoded) {
      value = (value << 6) | alphabet.indexOf(char); bits += 6;
      if (bits >= 8) { bits -= 8; decoded += `%${((value >> bits) & 255).toString(16).padStart(2, '0')}`; value &= (1 << bits) - 1; }
    }
    const payload: unknown = JSON.parse(decodeURIComponent(decoded));
    if (!isRecord(payload) || typeof payload.tenantId !== 'string' || !objectId.test(payload.tenantId)
      || typeof payload.sub !== 'string' || !objectId.test(payload.sub) || !['user', 'staff'].includes(String(payload.kind))) return null;
    return `${payload.tenantId}:${payload.kind}:${payload.sub}`;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOperation(value: unknown): DeliveryAssignmentOperation {
  if (!isRecord(value) || Object.keys(value).sort().join() !== 'body,missionId,ownerId'
    || typeof value.ownerId !== 'string' || (!ownerPattern.test(value.ownerId) && value.ownerId !== 'demo:staff:demo')
    || typeof value.missionId !== 'string' || !objectId.test(value.missionId)) throw storageError();
  const body = DeliveryMissionAssignSchema.safeParse(value.body);
  if (!body.success || body.data.reason !== DELIVERY_ASSIGNMENT_REASON) throw storageError();
  return { ownerId: value.ownerId, missionId: value.missionId, body: body.data };
}

function parseJournal(raw: string | null): DeliveryAssignmentOperation[] {
  if (raw === null) return [];
  try {
    if (raw.length > MAX_JOURNAL_LENGTH) throw storageError();
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || Object.keys(value).sort().join() !== 'operations,version' || value.version !== 1
      || !Array.isArray(value.operations) || value.operations.length > MAX_OPERATIONS) throw storageError();
    const operations = value.operations.map(parseOperation);
    if (new Set(operations.map(op => op.missionId)).size !== operations.length
      || new Set(operations.map(op => op.body.operationId)).size !== operations.length) throw storageError();
    return operations;
  } catch { throw storageError(); }
}

function serialize(operations: DeliveryAssignmentOperation[]): string | null {
  return operations.length ? JSON.stringify({ version: 1, operations }) : null;
}

function sameOperation(a: DeliveryAssignmentOperation, b: DeliveryAssignmentOperation): boolean {
  return a.ownerId === b.ownerId && a.missionId === b.missionId
    && a.body.operationId === b.body.operationId && a.body.expectedRevision === b.body.expectedRevision
    && a.body.operatorId === b.body.operatorId && a.body.expectedOperatorRevision === b.body.expectedOperatorRevision
    && a.body.reason === b.body.reason;
}

/** Le store doit être tenantStore/scopedStore ; aucune PII ni clé d’accès n’est enregistrée. */
export async function readDeliveryAssignments(store: KeyValueStore): Promise<DeliveryAssignmentOperation[]> {
  return parseJournal(await store.getItem(DELIVERY_ASSIGNMENT_STORAGE_KEY));
}

function requireMutationLock(): void {
  if (typeof document !== 'undefined') {
    try { requireCrossContextStoreLock(); }
    catch { throw new Error('Ce navigateur ne peut pas sécuriser une affectation. Utilisez un navigateur compatible sur une connexion sécurisée.'); }
  }
}

/** Persiste avant tout POST. Un timeout ne change jamais l’UUID ni le corps de cette intention. */
export async function prepareDeliveryAssignment(store: KeyValueStore, operation: DeliveryAssignmentOperation): Promise<DeliveryAssignmentOperation> {
  requireMutationLock();
  const requested = parseOperation(operation);
  return mutateStoreItem(store, DELIVERY_ASSIGNMENT_STORAGE_KEY, raw => {
    const operations = parseJournal(raw);
    const current = operations.find(op => op.missionId === requested.missionId);
    if (current) {
      if (!sameOperation(current, requested)) throw pendingError();
      return { value: raw, result: current };
    }
    if (operations.length >= MAX_OPERATIONS || operations.some(op => op.body.operationId === requested.body.operationId)) throw pendingError();
    return { value: serialize([...operations, requested]), result: requested };
  });
}

async function removeConfirmed(store: KeyValueStore, requested: DeliveryAssignmentOperation): Promise<void> {
  requireMutationLock();
  await mutateStoreItem(store, DELIVERY_ASSIGNMENT_STORAGE_KEY, raw => {
    const operations = parseJournal(raw);
    const current = operations.find(op => op.missionId === requested.missionId);
    if (!current || !sameOperation(current, requested)) throw pendingError();
    return { value: serialize(operations.filter(op => op.missionId !== requested.missionId)), result: undefined };
  });
}

/** Un refus journalisé est acquitté aussi ; un GET seul ou une erreur réseau ne le sont jamais. */
export async function completeDeliveryAssignment(store: KeyValueStore, operation: DeliveryAssignmentOperation, raw: unknown): Promise<DeliveryMissionResult> {
  const requested = parseOperation(operation);
  const parsed = DeliveryMissionResultSchema.safeParse(raw);
  if (!parsed.success) throw confirmationError();
  const result = parsed.data;
  if (result.operationId !== requested.body.operationId || result.mission.id !== requested.missionId
    || result.appliedRevision !== requested.body.expectedRevision + 1 || result.mission.revision < result.appliedRevision) throw confirmationError();
  await removeConfirmed(store, requested);
  return result;
}

/** Seul le conflit explicite suivi d’une version plus récente ferme une intention sans acquittement. */
export async function releaseChangedDeliveryAssignment(store: KeyValueStore, operation: DeliveryAssignmentOperation, code: string, raw: unknown): Promise<DeliveryMissionView> {
  const requested = parseOperation(operation);
  const parsed = DeliveryMissionViewSchema.safeParse(raw);
  if (code !== 'DELIVERY_MISSION_CHANGED' || !parsed.success || parsed.data.id !== requested.missionId
    || parsed.data.revision <= requested.body.expectedRevision) throw confirmationError();
  await removeConfirmed(store, requested);
  return parsed.data;
}

/** Précondition de purge : passer le store brut reçu sous le verrou, jamais un scopedStore imbriqué. */
export async function assertDeliveryAssignmentsSettled(store: KeyValueStore): Promise<void> {
  if ((await readDeliveryAssignments(store)).length) throw new Error('Une affectation reste à vérifier. Son identité et le stockage du poste doivent être conservés.');
}
