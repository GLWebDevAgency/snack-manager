import { describe, expect, it } from "vitest";
import {
  applyOrdersListMutation,
  applyOrdersListMutations,
  loadedStatusCountLabel,
  normalizeOrdersList,
  ORDERS_WINDOW_MAX,
} from "./list-response";
import type { Order } from "./types";

const rows = (length: number) =>
  Array.from({ length }, (_, index) => ({ _id: `order-${index}` })) as unknown as Order[];

const order = (id: string, status: Order["status"] = "new") =>
  ({ _id: id, status }) as Order;

describe("réponse de la liste des commandes", () => {
  it("conserve le total serveur au-delà du plafond de 200", () => {
    const snapshot = normalizeOrdersList({
      rows: rows(200),
      total: 247,
      truncated: true,
    });

    expect(snapshot.rows).toHaveLength(200);
    expect(snapshot.total).toBe(247);
    expect(snapshot.truncated).toBe(true);
  });

  it("déduit la troncature du total pendant un déploiement roulant", () => {
    expect(
      normalizeOrdersList({ rows: rows(200), total: 201 }).truncated,
    ).toBe(true);
  });

  it("ne présente un compteur de statut tronqué que comme un minimum", () => {
    expect(loadedStatusCountLabel(38, true)).toBe("≥ 38");
    expect(loadedStatusCountLabel(38, false)).toBe("38");
  });

  it("rejoue les événements plus récents sur un vieux snapshot", () => {
    const snapshot = normalizeOrdersList({
      rows: [order("ancienne")],
      total: 1,
    });

    const reconciled = applyOrdersListMutations(snapshot, [
      { kind: "replaced", order: order("ancienne", "preparing") },
      { kind: "created", order: order("nouvelle") },
    ]);

    expect(reconciled.rows.map(({ _id, status }) => [_id, status])).toEqual([
      ["nouvelle", "new"],
      ["ancienne", "preparing"],
    ]);
    expect(reconciled.total).toBe(2);
  });

  it("ne recompte pas une création déjà présente dans le snapshot serveur", () => {
    const nouvelle = order("nouvelle");
    const snapshot = normalizeOrdersList({ rows: [nouvelle], total: 1 });

    const reconciled = applyOrdersListMutation(snapshot, {
      kind: "created",
      order: nouvelle,
    });

    expect(reconciled.rows).toHaveLength(1);
    expect(reconciled.total).toBe(1);
  });

  it("maintient le plafond et le total quand le refresh suivant échoue", () => {
    const snapshot = normalizeOrdersList({
      rows: rows(ORDERS_WINDOW_MAX),
      total: ORDERS_WINDOW_MAX,
    });

    const local = applyOrdersListMutation(snapshot, {
      kind: "created",
      order: order("plus-recente"),
    });

    expect(local.rows).toHaveLength(ORDERS_WINDOW_MAX);
    expect(local.rows[0]?._id).toBe("plus-recente");
    expect(local.total).toBe(ORDERS_WINDOW_MAX + 1);
    expect(local.truncated).toBe(true);
  });
});
