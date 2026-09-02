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

/**
 * Applique un `$set` comme Mongo : un chemin pointé écrit DANS le sous-objet
 * au lieu de le remplacer. Partagé par `updateOne` et `findOneAndUpdate` — les
 * deux écritures doivent se comporter pareil, sans quoi le choix de l'une ou
 * l'autre dans un service changerait le résultat pour une raison invisible.
 */
function applySet(row: Row, $set: Row): void {
  for (const [path, value] of Object.entries($set)) {
    const segments = path.split('.');
    let target = row;
    for (const segment of segments.slice(0, -1)) {
      if (target[segment] === null || typeof target[segment] !== 'object') {
        target[segment] = {};
      }
      target = target[segment] as Row;
    }
    target[segments[segments.length - 1]!] = clone(value);
  }
}

/**
 * Lecture d'un chemin, pointé ou non — `deep(row, 'account.status')`.
 *
 * Mongo filtre sur des chemins pointés aussi bien qu'il écrit dessus, et une
 * doublure qui ne saurait que les écrire laisserait passer un filtre qui ne
 * matcherait JAMAIS en production. C'est exactement ce que fait la
 * réconciliation de fin d'essai : sa condition `account.status: 'trial'` voyage
 * avec l'écriture, et c'est elle qui la rend idempotente.
 */
function deep(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Row)[key];
  }, row);
}

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => same(deep(row, key), expected));
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

  /**
   * `findOneAndUpdate(filter, { $set }, options)`.
   *
   * Trois comportements de Mongo sont rejoués parce que des appelants réels en
   * dépendent :
   *
   * 1. `new: true` rend le document D'APRÈS (les révocations d'appareil et les
   *    modifications de tenant relisent ce qu'elles viennent d'écrire) ;
   *    `returnDocument: 'before'` rend celui d'AVANT. C'est cette seconde
   *    forme qui donne au journal des réglages de plateforme une image du
   *    passé prise AU MOMENT de l'écriture, et non un `findById` antérieur
   *    qu'une requête concurrente aurait pu périmer entre-temps.
   *
   * 2. L'UPSERT crée le document manquant, à partir des égalités du filtre —
   *    l'état du tout premier enregistrement des réglages.
   *
   * 3. LES CHEMINS POINTÉS écrivent DANS le sous-objet sans le remplacer,
   *    exactement comme dans `updateOne` : c'est toute la différence entre
   *    modifier un réseau et effacer les trois autres.
   */
  findOneAndUpdate(
    filter: Row,
    update: { $set?: Row },
    options?: { new?: boolean; returnDocument?: 'before' | 'after'; upsert?: boolean },
  ): FakeDocQuery<Row> {
    let row = this.rows.find((r) => matches(r, filter));
    let inserted = false;
    if (!row) {
      if (!options?.upsert) return new FakeDocQuery<Row>(null);
      row = { ...clone(filter) };
      this.rows.push(row);
      inserted = true;
    }

    const before = clone(row);
    applySet(row, update.$set ?? {});
    row.updatedAt = new Date();

    const wantsBefore = options?.returnDocument === 'before' || options?.new === false;
    // Sur un upsert qui INSÈRE, Mongo n'a pas d'état d'avant à rendre : c'est
    // `null`, et non le squelette issu du filtre. Rendre le squelette ferait
    // passer un premier enregistrement pour la modification d'un document
    // préexistant.
    if (wantsBefore) return new FakeDocQuery(inserted ? null : before);
    return new FakeDocQuery(clone(row));
  }

  /**
   * `updateOne(filter, { $set }, { upsert })` — la seule écriture des réglages
   * de plateforme.
   *
   * Deux comportements de Mongo sont rejoués ici parce que le service en
   * dépend, et qu'une doublure qui les ignorerait rendrait ses tests muets :
   *
   * 1. LES CHEMINS POINTÉS écrivent DANS le sous-objet sans le remplacer.
   *    `{ 'social.instagram': … }` ne doit toucher qu'Instagram ; c'est toute
   *    la différence entre modifier un réseau et effacer les trois autres.
   *    (`findOneAndUpdate` les écrit de la même façon, par la même fonction :
   *    la fin d'essai réécrit `account.status` sans effacer `account.trialEndsAt`,
   *    et ce chemin-là doit se comporter ici exactement comme en production.)
   *
   * 2. L'UPSERT crée le document quand il n'existe pas — l'état normal au
   *    tout premier enregistrement, celui où un `create()` marcherait et où
   *    tous les suivants échoueraient.
   *
   * `updatedAt` est posé comme le ferait l'option `timestamps` du schéma.
   */
  async updateOne(
    filter: Row,
    update: { $set?: Row },
    options?: { upsert?: boolean },
  ): Promise<{ acknowledged: true; matchedCount: number; upsertedCount: number }> {
    let row = this.rows.find((r) => matches(r, filter));
    let upserted = 0;
    if (!row) {
      if (!options?.upsert) {
        return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
      }
      // L'upsert part des égalités du filtre, comme Mongo : c'est ce qui donne
      // son `_id` au document créé.
      row = { ...clone(filter) };
      this.rows.push(row);
      upserted = 1;
    }

    applySet(row, update.$set ?? {});
    row.updatedAt = new Date();

    return { acknowledged: true, matchedCount: upserted ? 0 : 1, upsertedCount: upserted };
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
