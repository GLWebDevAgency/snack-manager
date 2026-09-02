import type { Model } from 'mongoose';
import type { AuditLog, Staff, User } from '@sm/db';
import { AuditService } from './audit.module';

/**
 * DOUBLURES DU REGISTRE DU RESTAURANT.
 *
 * Le `AuditService` rendu ici est le VRAI service, posé sur trois collections
 * en mémoire. C'est délibéré : une doublure du service laisserait sa pièce la
 * plus délicate — la résolution de l'auteur, le nom et le rôle recopiés dans
 * la ligne — hors de portée des tests, alors que c'est précisément ce qu'un
 * registre doit prouver. Les tests des émetteurs vérifient donc le CONTENU
 * réel des lignes, auteur compris, et pas seulement qu'un appel a eu lieu.
 *
 * Le vocabulaire Mongoose employé par le service est étroit (`create`,
 * `findById().lean()`, `find().sort().limit().lean()`) : ces doublures rejouent
 * exactement celui-là. Tout le reste lève plutôt que de mentir.
 */
type Ligne = Record<string, unknown>;

const memeId = (a: unknown, b: unknown) => String(a) === String(b);

/** `find({ _id: { $in: [...] } })` — la seule forme composée que le service émet. */
function correspond(ligne: Ligne, filtre: Ligne): boolean {
  return Object.entries(filtre).every(([clef, attendu]) => {
    if (attendu !== null && typeof attendu === 'object' && '$in' in attendu) {
      const valeurs = (attendu as { $in: unknown[] }).$in;
      return valeurs.some((v) => memeId(ligne[clef], v));
    }
    return memeId(ligne[clef], attendu);
  });
}

class CollectionEnMemoire {
  readonly rows: Ligne[] = [];
  private sequence = 0;

  constructor(private readonly prefixe: string) {}

  seed(row: Ligne): Ligne {
    this.rows.push(row);
    return row;
  }

  async create(doc: Ligne): Promise<Ligne> {
    const cree = { _id: `${this.prefixe}-${++this.sequence}`, ...doc };
    this.rows.push(cree);
    return cree;
  }

  findById(id: unknown) {
    const row = this.rows.find((r) => memeId(r._id, id)) ?? null;
    return { lean: async () => row };
  }

  find(filtre: Ligne = {}) {
    let rows = this.rows.filter((r) => correspond(r, filtre));
    const chaine = {
      sort: (spec: Record<string, 1 | -1>) => {
        const criteres = Object.entries(spec);
        rows = [...rows].sort((a, b) => {
          for (const [clef, sens] of criteres) {
            const ga = a[clef];
            const gb = b[clef];
            const ordre =
              ga instanceof Date || gb instanceof Date
                ? Number(new Date(ga as Date)) - Number(new Date(gb as Date))
                : String(ga).localeCompare(String(gb));
            if (ordre !== 0) return sens === -1 ? -ordre : ordre;
          }
          return 0;
        });
        return chaine;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return chaine;
      },
      lean: async () => rows,
    };
    return chaine;
  }

  asModel<T>(): Model<T> {
    return this as unknown as Model<T>;
  }
}

export interface JournalDeTest {
  audit: AuditService;
  /** Les lignes écrites, dans l'ordre d'écriture. */
  lignes: Ligne[];
  staff: CollectionEnMemoire;
  users: CollectionEnMemoire;
}

/**
 * Un registre vide, avec les comptes et les équipiers qu'on veut voir nommés.
 *
 * Les identifiants sont des ObjectId VALIDES : le service refuse de résoudre
 * un `sub` qui n'en est pas un (`Types.ObjectId.isValid`), et une doublure qui
 * accepterait n'importe quelle chaîne masquerait ce garde-fou.
 */
export function journalDeTest(
  seed: { staff?: Ligne[]; users?: Ligne[] } = {},
): JournalDeTest {
  const logs = new CollectionEnMemoire('log');
  const staff = new CollectionEnMemoire('staff');
  const users = new CollectionEnMemoire('user');
  for (const row of seed.staff ?? []) staff.seed(row);
  for (const row of seed.users ?? []) users.seed(row);
  return {
    audit: new AuditService(
      logs.asModel<AuditLog>(),
      staff.asModel<Staff>(),
      users.asModel<User>(),
    ),
    lignes: logs.rows,
    staff,
    users,
  };
}

/**
 * Un registre dont aucun test ne lit le contenu — pour les suites qui
 * construisent un service journalisant sans que le journal soit leur sujet.
 */
export const journalMuet = (): AuditService => journalDeTest().audit;
