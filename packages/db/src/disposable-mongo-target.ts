import type { Db } from 'mongodb';

class DisposableMongoRefusal extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DisposableMongoRefusal'; }
}

/** No environment/--force escape hatch. Call BEFORE opening a connection.
 * The name denotes a disposable, never-served database; it is not a maintenance
 * lock. A local proxy cannot turn the production database name into this name.
 * Callers also use directConnection:true to forbid replica-set discovery.
 */
export function assertDisposableMongoTarget(uri: unknown): { uri: string; databaseName: string } {
  const match = typeof uri === 'string'
    ? /^mongodb:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?\/(snackmanager_disposable_[a-z0-9][a-z0-9_]{7,31})$/.exec(uri)
    : null;
  if (!match || (match[1] && Number(match[1]) > 65_535) || match[0] !== uri) {
    throw new DisposableMongoRefusal('MONGO_DISPOSABLE_TARGET_REQUIRED',
      'Écriture refusée : une base locale jetable nommée snackmanager_disposable_<suffixe de 8 à 32 caractères> est obligatoire, sans identifiants ni options URI. Staging et production sont exclus ; aucun forçage n’est disponible.');
  }
  return { uri: uri as string, databaseName: match[2]! };
}

function durableDataPresent(): never {
  throw new DisposableMongoRefusal('MONGO_DURABLE_ORDER_DATA_PRESENT',
    'Écriture refusée : des preuves de commandes durables ou de capacité sont présentes. Cet outil jetable ne réalise aucune restauration ni aucun bootstrap C15.');
}

/** Diagnostic only, NOT a cross-document fence against a concurrent writer.
 * Destructive tools must already be isolated to a disposable, unserved target.
 * Existing C01 admissions are protected too: partial copies are not recoveries.
 * Native reads preserve capacityControl:null/malformed/select:false as present.
 */
export async function assertNoDurableOrderData(db: Db): Promise<void> {
  for (const [name, filter] of [
    ['tenants', { capacityControl: { $exists: true } }],
    ['public_order_admissions', {}], ['order_capacity_days', {}],
  ] as const) {
    let found: unknown;
    try {
      found = await db.collection(name).findOne(filter, { projection: { _id: 1 },
        readPreference: 'primary', readConcern: { level: 'majority' }, maxTimeMS: 5_000 });
    } catch {
      throw new DisposableMongoRefusal('MONGO_DURABLE_ORDER_CHECK_FAILED',
        'Écriture refusée : impossible de vérifier les preuves durables. Aucune autorisation de poursuivre n’est déduite de cette erreur.');
    }
    if (found !== null) durableDataPresent();
  }
}

/** Also inspect the exact batch about to be copied, not just an earlier scan. */
export function assertNoDurableOrderDocuments(name: string, documents: readonly Record<string, unknown>[]): void {
  if ((['public_order_admissions', 'order_capacity_days'].includes(name) && documents.length > 0)
    || (name === 'tenants' && documents.some((document) => Object.hasOwn(document, 'capacityControl')))) durableDataPresent();
}
