import {
  DiningTableCreateSchema, DiningTableUpdateSchema,
  type AuthMe, type DiningTableCreate, type DiningTableUpdate,
} from "@sm/contracts";

export type OperationSalle = {
  version: 1;
  auteur: string;
  tenantId: string;
  libelle: string;
} & (
  | { action: "create"; body: DiningTableCreate }
  | { action: "update"; tableId: string; body: DiningTableUpdate }
);

export const auteurSalle = (moi: AuthMe) => `${moi.genre}:${moi.id}`;
export const cleSalle = (tenantId: string) => `sm.admin.salle.operation.v1:${tenantId}`;
export const peutLireSalle = (role: string) => ["owner", "cogerant", "gerant", "caisse", "cuisine"].includes(role);
export const peutGererSalle = (role: string) => ["owner", "cogerant", "gerant"].includes(role);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Une référence illisible n'est jamais assimilée à un journal vide. */
export function lireOperationSalle(raw: string | null, tenantId: string): OperationSalle | null {
  if (raw === null) return null;
  try {
    const op = JSON.parse(raw) as OperationSalle;
    if (op.version !== 1 || op.tenantId !== tenantId || typeof op.auteur !== "string" || !op.auteur
      || typeof op.libelle !== "string" || !op.libelle) throw Error();
    if (op.action === "create") return { ...op, body: DiningTableCreateSchema.parse(op.body) };
    if (op.action === "update" && typeof op.tableId === "string" && uuid.test(op.tableId)) {
      return { ...op, body: DiningTableUpdateSchema.parse(op.body) };
    }
    throw Error();
  } catch {
    throw Error("La référence d’une opération de salle est illisible. Conservez le stockage de ce navigateur et faites vérifier l’opération.");
  }
}

export function preparerOperationSalle(storage: Pick<Storage, "getItem" | "setItem">, op: OperationSalle): OperationSalle {
  const valid = lireOperationSalle(JSON.stringify(op), op.tenantId)!;
  const pending = lireOperationSalle(storage.getItem(cleSalle(op.tenantId)), op.tenantId);
  if (pending && JSON.stringify(pending) !== JSON.stringify(valid)) {
    throw Error("Une opération de salle reste à vérifier. Reprenez-la avant un autre changement.");
  }
  const serialized = JSON.stringify(pending ?? valid);
  storage.setItem(cleSalle(op.tenantId), serialized);
  if (storage.getItem(cleSalle(op.tenantId)) !== serialized) throw Error("La référence de l’opération n’a pas été conservée. Aucun changement n’a été envoyé.");
  return pending ?? valid;
}

/** Retirer seulement la référence confirmée, sans effacer un autre onglet. */
export function terminerOperationSalle(storage: Pick<Storage, "getItem" | "removeItem">, op: OperationSalle) {
  const current = lireOperationSalle(storage.getItem(cleSalle(op.tenantId)), op.tenantId);
  if (current?.body.operationId === op.body.operationId && current.auteur === op.auteur) {
    storage.removeItem(cleSalle(op.tenantId));
  }
}

export const cheminOperationSalle = (op: OperationSalle) => op.action === "create" ? "/dining/tables" : `/dining/tables/${op.tableId}`;

/** Un délai ne signifie pas un échec : le corps reste durablement rejouable. */
export async function delaiSalle<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("La réponse tarde. Vérifiez cette opération avec la même référence.")), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}
