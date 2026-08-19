"use client";

/**
 * Onglet Ingrédients : recherche + filtre catégorie, table stock/coût/
 * allergènes, rupture (Toggle danger → cascade produits), actions rapides
 * (réception, perte, inventaire, édition) et création.
 */

import { useMemo, useState } from "react";
import {
  INGREDIENT_CATEGORIES,
  type IngredientCategory,
  type MovementInputType,
  type SupplyIngredient,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { cx } from "@/lib/cx";
import {
  Btn,
  Card,
  EmptyState,
  Icon,
  IconBtn,
  Input,
  Select,
  Toggle,
  useToast,
} from "@/components/ui";
import {
  AllergenChips,
  CATEGORY_LABELS,
  CategoryPill,
  STORAGE_LABELS,
  StockGauge,
  Th,
  UNIT_LABELS,
  normalize,
} from "./shared";
import { IngredientDrawer } from "./ingredient-drawer";
import { MovementModal } from "./movement-modal";

export type IngredientAlertFilter = "out" | "belowPar" | null;

const ALERT_FILTER_LABELS: Record<Exclude<IngredientAlertFilter, null>, string> =
  {
    out: "En rupture",
    belowPar: "Sous le seuil",
  };

export function IngredientsTab({
  ingredients,
  alertFilter,
  onClearAlertFilter,
  onChanged,
  onRemoved,
  onReloadAlerts,
}: {
  ingredients: SupplyIngredient[];
  alertFilter: IngredientAlertFilter;
  onClearAlertFilter: () => void;
  onChanged: (ing: SupplyIngredient) => void;
  onRemoved: (id: string) => void;
  onReloadAlerts: () => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<IngredientCategory | "">("");
  const [drawer, setDrawer] = useState<
    { mode: "create" } | { mode: "edit"; ing: SupplyIngredient } | null
  >(null);
  const [movement, setMovement] = useState<{
    ing: SupplyIngredient;
    type: MovementInputType;
  } | null>(null);
  const [pendingOutId, setPendingOutId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return ingredients.filter((ing) => {
      if (alertFilter === "out" && !ing.isOut) return false;
      if (alertFilter === "belowPar" && !ing.belowPar) return false;
      if (category && ing.category !== category) return false;
      if (!q) return true;
      return (
        normalize(ing.name).includes(q) ||
        ing.brands.some((b) => normalize(b.name).includes(q))
      );
    });
  }, [ingredients, search, category, alertFilter]);

  /** Valeur du stock affiché : Σ coût/unité × stock (centimes). */
  const stockValueCents = useMemo(
    () =>
      Math.round(
        filtered.reduce(
          (s, i) => s + i.costPerUnitCents * Math.max(i.currentStock, 0),
          0,
        ),
      ),
    [filtered],
  );

  async function toggleOut(ing: SupplyIngredient) {
    if (pendingOutId) return;
    setPendingOutId(ing.id);
    const next = !ing.isOut;
    try {
      const res = await api.post<{
        ingredient: SupplyIngredient;
        productsUpdated: number;
      }>(`/supply/ingredients/${ing.id}/out`, { isOut: next });
      // La réponse ne porte pas les marques — on conserve celles connues.
      onChanged({ ...ing, ...res.ingredient, brands: ing.brands });
      const n = res.productsUpdated;
      toast(
        next
          ? n > 0
            ? `${n} produit${n > 1 ? "s" : ""} coupé${n > 1 ? "s" : ""}`
            : "Rupture déclarée — aucun produit affecté"
          : n > 0
            ? `Rupture levée — ${n} produit${n > 1 ? "s" : ""} réactivé${n > 1 ? "s" : ""}`
            : "Rupture levée",
        { icon: next ? undefined : "check" },
      );
      onReloadAlerts();
    } catch (err) {
      toast(
        err instanceof ApiError
          ? err.message
          : "Impossible de changer l'état de rupture",
      );
    } finally {
      setPendingOutId(null);
    }
  }

  const emptyBase = ingredients.length === 0;

  return (
    <div>
      {/* ── Barre d'outils ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un ingrédient ou une marque…"
            aria-label="Rechercher un ingrédient ou une marque"
            className="w-[280px] pl-9"
          />
        </div>
        <Select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as IngredientCategory | "")
          }
          aria-label="Filtrer par catégorie"
          className="w-[190px]"
        >
          <option value="">Toutes les catégories</option>
          {INGREDIENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        {alertFilter && (
          <button
            type="button"
            onClick={onClearAlertFilter}
            className={cx(
              "cf-press inline-flex items-center gap-1.5 rounded-pill border px-3 py-[7px] text-[13px] font-semibold",
              alertFilter === "out"
                ? "border-alert/60 bg-alert/10 text-alertt"
                : "border-prep/60 bg-prep/10 text-prept",
            )}
          >
            Filtre : {ALERT_FILTER_LABELS[alertFilter]}
            <Icon name="close" size={12} />
            <span className="sr-only">— retirer le filtre</span>
          </button>
        )}
        <Btn
          icon="plus"
          className="ml-auto"
          onClick={() => setDrawer({ mode: "create" })}
        >
          Nouvel ingrédient
        </Btn>
      </div>

      {/* ── Table ── */}
      <Card>
        {filtered.length === 0 ? (
          emptyBase ? (
            <EmptyState
              icon="fries"
              title="Aucun ingrédient"
              hint="Créez votre premier ingrédient pour suivre stocks, coûts matière et allergènes."
              action={
                <Btn
                  size="sm"
                  icon="plus"
                  onClick={() => setDrawer({ mode: "create" })}
                >
                  Nouvel ingrédient
                </Btn>
              }
            />
          ) : (
            <EmptyState
              title="Aucun résultat"
              hint="Modifiez la recherche, la catégorie ou retirez le filtre d'alerte."
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <Th>Ingrédient</Th>
                    <Th>Catégorie</Th>
                    <Th>Stock / seuil</Th>
                    <Th className="text-right">Coût / unité</Th>
                    <Th>Allergènes</Th>
                    <Th>Rupture</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ing) => (
                    <tr
                      key={ing.id}
                      className="border-b border-line2 transition-colors duration-200 ease-sm last:border-b-0 hover:bg-white/4"
                    >
                      <td className="px-4 py-3">
                        <div
                          className={cx(
                            "font-bold",
                            ing.isOut ? "text-alertt" : "text-ink",
                          )}
                        >
                          {ing.name}
                        </div>
                        {ing.brands.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {ing.brands.map((b) => (
                              <span
                                key={b.id}
                                title={b.notes ?? b.name}
                                className="inline-flex items-center gap-0.5 rounded-pill bg-white/6 px-1.5 py-0.5 text-[10px] font-semibold text-mut"
                              >
                                {b.preferred && (
                                  <Icon
                                    name="star"
                                    size={9}
                                    fill="currentColor"
                                    className="text-gold"
                                  />
                                )}
                                {b.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CategoryPill category={ing.category} />
                        <div className="mt-1 text-[11px] text-mut">
                          {STORAGE_LABELS[ing.storage]}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StockGauge
                          stock={ing.currentStock}
                          par={ing.parLevel}
                          unit={ing.unit}
                          isOut={ing.isOut}
                        />
                      </td>
                      <td className="cf-fig whitespace-nowrap px-4 py-3 text-right">
                        <span className="text-[15px] font-extrabold text-ink">
                          {fmtEuro(ing.costPerUnitCents)}
                        </span>
                        <span className="text-mut"> / {UNIT_LABELS[ing.unit]}</span>
                      </td>
                      <td className="max-w-[190px] px-4 py-3">
                        <AllergenChips allergens={ing.allergens} />
                      </td>
                      <td className="px-4 py-3">
                        <Toggle
                          danger
                          on={ing.isOut}
                          disabled={pendingOutId === ing.id}
                          label={
                            ing.isOut
                              ? `Lever la rupture de ${ing.name}`
                              : `Déclarer ${ing.name} en rupture`
                          }
                          onChange={() => void toggleOut(ing)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconBtn
                            icon="plus"
                            label={`Réception — ${ing.name}`}
                            size={30}
                            iconSize={14}
                            onClick={() =>
                              setMovement({ ing, type: "purchase" })
                            }
                          />
                          <IconBtn
                            icon="minus"
                            label={`Perte — ${ing.name}`}
                            size={30}
                            iconSize={14}
                            onClick={() => setMovement({ ing, type: "waste" })}
                          />
                          <IconBtn
                            icon="check"
                            label={`Inventaire — ${ing.name}`}
                            size={30}
                            iconSize={14}
                            onClick={() => setMovement({ ing, type: "count" })}
                          />
                          <IconBtn
                            icon="edit"
                            label={`Modifier ${ing.name}`}
                            size={30}
                            iconSize={14}
                            onClick={() => setDrawer({ mode: "edit", ing })}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cf-fig flex items-center justify-between gap-3 border-t border-line2 bg-black/20 px-4 py-3 text-[13px] text-mut">
              <span>
                {filtered.length} ingrédient{filtered.length > 1 ? "s" : ""}
                {filtered.length !== ingredients.length &&
                  ` sur ${ingredients.length}`}
              </span>
              <span>
                Valeur du stock affiché :{" "}
                <span className="text-[15px] font-extrabold text-ink">
                  {fmtEuro(stockValueCents)}
                </span>
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ── Panneaux ── */}
      {drawer && (
        <IngredientDrawer
          initial={drawer.mode === "edit" ? drawer.ing : null}
          onClose={() => setDrawer(null)}
          onSaved={(ing) => {
            onChanged(ing);
            onReloadAlerts();
          }}
          onDeleted={(id) => {
            onRemoved(id);
            onReloadAlerts();
          }}
        />
      )}
      {movement && (
        <MovementModal
          ingredient={movement.ing}
          type={movement.type}
          onClose={() => setMovement(null)}
          onDone={(currentStock, belowPar) => {
            onChanged({ ...movement.ing, currentStock, belowPar });
            onReloadAlerts();
          }}
        />
      )}
    </div>
  );
}
