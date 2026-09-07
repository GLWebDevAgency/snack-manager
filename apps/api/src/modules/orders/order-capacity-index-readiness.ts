import { ServiceUnavailableException } from '@nestjs/common';
import { ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES } from '@sm/db';

/** Port de lecture, compatible avec la collection native exposée par Mongoose. */
export interface CapacityIndexCollection {
  aggregate(pipeline: Record<string, unknown>[], options: {
    readPreference: 'primary'; maxTimeMS: number; timeoutMS: number;
  }): { toArray(): Promise<unknown[]> };
}

const MAX_INDEX_ROWS = 128;

function uncertain(): ServiceUnavailableException {
  // Aucun nom d'hôte, détail de privilège ou message du driver dans la réponse publique.
  return new ServiceUnavailableException({ code: 'ORDER_CAPACITY_UNCERTAIN',
    message: 'La réservation reste à vérifier. Conservez la même tentative de commande.' });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameKey(actual: unknown, expected: Record<string, number>): boolean {
  if (!record(actual)) return false;
  const entries = Object.entries(actual);
  const wanted = Object.entries(expected);
  return entries.length === wanted.length && entries.every(([key, value], i) =>
    key === wanted[i]![0] && value === wanted[i]![1]);
}

async function indexStats(collection: CapacityIndexCollection): Promise<Record<string, unknown>[]> {
  const rows: unknown = await collection.aggregate([
    { $indexStats: {} },
    { $project: { _id: 0, name: 1, key: 1, spec: 1, building: 1 } },
    { $limit: MAX_INDEX_ROWS + 1 },
  ], { readPreference: 'primary', maxTimeMS: 10_000, timeoutMS: 10_000 }).toArray();
  if (!Array.isArray(rows) || rows.length > MAX_INDEX_ROWS || !rows.every(record)) throw uncertain();
  return rows;
}

function requireIndex(rows: Record<string, unknown>[], name: string, key: Record<string, number>, seat?: string): void {
  const matches = rows.filter((row) => row.name === name);
  if (matches.length !== 1) throw uncertain();
  const entry = matches[0]!;
  const spec = entry.spec;
  if ((entry.building !== undefined && entry.building !== false) || !record(spec)
    || spec.name !== name || spec.unique !== true || !sameKey(entry.key, key) || !sameKey(spec.key, key)
    || (spec.sparse !== undefined && spec.sparse !== false) || spec.expireAfterSeconds !== undefined) throw uncertain();
  if (!seat) {
    if (spec.partialFilterExpression !== undefined) throw uncertain();
    return;
  }
  const partial = spec.partialFilterExpression;
  if (!record(partial) || Object.keys(partial).length !== 1 || !record(partial[seat])
    || Object.keys(partial[seat]).length !== 1 || partial[seat].$type !== 'number') throw uncertain();
}

/**
 * Une spec listIndexes ne prouve pas que l'index est terminé. MongoDB peut
 * tolérer des doublons pendant sa construction ; $indexStats porte building.
 * Pas de cache positif : chaque engagement relit les trois index sur le primaire.
 * Privilèges insuffisants, transport incertain ou réponse inattendue = refus,
 * jamais repli vers listIndexes ni élévation automatique des droits.
 */
export async function assertOrderCapacityIndexesReady(
  admissions: CapacityIndexCollection, calendar: CapacityIndexCollection,
): Promise<void> {
  try {
    const [admissionRows, calendarRows] = await Promise.all([indexStats(admissions), indexStats(calendar)]);
    requireIndex(calendarRows, ORDER_CAPACITY_DAY_INDEX, { tenantId: 1, day: 1 });
    for (const { name, field } of ORDER_CAPACITY_INDEXES) {
      const seat = `capacity.${field}`;
      requireIndex(admissionRows, name, { tenantId: 1, 'capacity.slot': 1, [seat]: 1 }, seat);
    }
  } catch {
    throw uncertain();
  }
}
