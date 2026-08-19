import type { Model } from 'mongoose';

/**
 * Doublures de test de l'administration client.
 *
 * `AdminService` parle à Mongoose avec un vocabulaire volontairement étroit —
 * `findById`, `findOneAndUpdate`, `create`, `find().sort().limit()`. Ces
 * doublures rejouent exactement ces appels-là, ce qui permet de vérifier sans
 * base ce qui compte vraiment : qu'une suspension écrit le statut ET le
 * journal, et qu'un appareil révoqué ne répond plus.
 *
 * Une doublure qui accepterait plus que le vrai modèle laisserait passer un
 * appel impossible en production : chaque opération non implémentée lève.
 */

export type Row = Record<string, unknown>;

/**
 * Copie en profondeur qui LAISSE PASSER les instances de classe.
 *
 * `structuredClone` aurait suffi pour des objets nus, mais il détruit les
 * prototypes : un `ObjectId` en ressortait comme un objet quelconque, si bien
 * que le journal ne se retrouvait plus par son tenant et que la doublure
 * mentait sur le comportement de Mongo. `Date`, `ObjectId` et `Buffer` sont
 * traités comme des valeurs — le service ne les mute jamais.
 */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as unknown as T;
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Row = {};
  for (const [key, item] of Object.entries(value)) out[key] = clone(item);
  return out as T;
}

/** Compare des identifiants venus tantôt d'un ObjectId, tantôt d'une chaîne. */
const same = (a: unknown, b: unknown): boolean => String(a) === String(b);

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => same(row[key], expected));
}

/** Dates comparées en millisecondes, identifiants en ordre lexicographique. */
function compare(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    return Number(new Date(a as Date)) - Number(new Date(b as Date));
  }
  return String(a).localeCompare(String(b));
}

class FakeDocQuery<T> {
  constructor(private readonly row: T | null) {}
  async lean(): Promise<T | null> {
    return this.row;
  }
  then<R>(resolve: (value: T | null) => R): Promise<R> {
    return Promise.resolve(resolve(this.row));
  }
}

class FakeListQuery {
  constructor(private rows: Row[]) {}

  /**
   * Tri multi-critères, appliqué dans l'ordre des clés — comme Mongo. Le
   * service s'en sert pour départager deux entrées de journal tombées dans la
   * même milliseconde ; une doublure qui n'honorerait que la première clé
   * masquerait précisément ce cas.
   */
  sort(spec: Record<string, 1 | -1>): this {
    const criteria = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [key, direction] of criteria) {
        const order = compare(a[key], b[key]) * (direction === -1 ? -1 : 1);
        if (order !== 0) return order;
      }
      return 0;
    });
    return this;
  }

  limit(n: number): this {
    this.rows = this.rows.slice(0, n);
    return this;
  }

  async lean(): Promise<Row[]> {
    return this.rows;
  }
}

/**
 * Collection en mémoire. Les documents sont CLONÉS en entrée comme en sortie :
 * un test qui muterait la valeur rendue par le service ne doit pas réécrire
 * l'état stocké — c'est ce que fait Mongo, et c'est ce qui rend les
 * assertions dignes de foi.
 */
export class FakeCollection {
  readonly rows: Row[] = [];
  private sequence = 0;

  constructor(private readonly prefix = 'row') {}

  seed(row: Row): Row {
    this.rows.push(clone(row));
    return row;
  }

  /** Nombre de documents — sert à vérifier qu'une action a bien écrit une ligne. */
  get size(): number {
    return this.rows.length;
  }

  findById(id: unknown, _projection?: unknown): FakeDocQuery<Row> {
    const row = this.rows.find((r) => same(r._id, id));
    return new FakeDocQuery(row ? clone(row) : null);
  }

  findOne(filter: Row): FakeDocQuery<Row> {
    const row = this.rows.find((r) => matches(r, filter));
    return new FakeDocQuery(row ? clone(row) : null);
  }

  findOneAndUpdate(
    filter: Row,
    update: { $set?: Row },
    _options?: unknown,
  ): FakeDocQuery<Row> {
    const row = this.rows.find((r) => matches(r, filter));
    if (!row) return new FakeDocQuery<Row>(null);
    for (const [key, value] of Object.entries(update.$set ?? {})) {
      if (key.includes('.')) {
        throw new Error(`Chemin pointé non géré par la doublure : ${key}`);
      }
      row[key] = clone(value);
    }
    return new FakeDocQuery(clone(row));
  }

  find(filter: Row = {}): FakeListQuery {
    return new FakeListQuery(this.rows.filter((r) => matches(r, filter)).map(clone));
  }

  async create(doc: Row): Promise<{ toObject: () => Row }> {
    const created: Row = { _id: `${this.prefix}-${++this.sequence}`, ...clone(doc) };
    this.rows.push(created);
    return { toObject: () => clone(created) };
  }

  /** Le service reçoit un `Model<T>` : la doublure en emprunte la forme. */
  asModel<T>(): Model<T> {
    return this as unknown as Model<T>;
  }
}
