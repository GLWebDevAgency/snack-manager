"use client";

/**
 * Vue « Menu & prix » — /admin/menu (spec backoffice-restaurant §7).
 *
 * Layout : bandeau « {n} prix à définir » + « Importer CSV / XML » (§7.1),
 * puis deux colonnes — carte Catégories 268 px fixe (§7.2) et carte Produits
 * `flex: 1` (§7.3). La recherche cherche dans TOUTE la carte et ignore alors
 * la catégorie sélectionnée.
 *
 * Écritures : PATCH /products/:id (prix au blur/Enter, dispo), POST
 * /products/:id/stock (rupture 1-tap) — toutes optimistes avec rollback et
 * toast ; POST/PATCH/DELETE /categories via CategoriesCard (suppression
 * protégée : 409 → modale §7.4, `force=true` détache en « Non rattachés »).
 *
 * Temps réel : `menu.updated` recharge la carte, sauf pendant un drag, une
 * édition, un import ou une saisie de prix en cours (on ne casse jamais une
 * frappe utilisateur).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CostsResponse, SupplyIngredient } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { useTenantSocket } from "@/lib/ws";
import {
  Btn,
  Card,
  EmptyState,
  Icon,
  Input,
  Modal,
  Pill,
  Skeleton,
  Toggle,
  useToast,
} from "@/components/ui";
import { CategoriesCard } from "./CategoriesCard";
import { EditPanel } from "./EditPanel";
import { ImportModal } from "./ImportModal";
import {
  UNCAT,
  effectivePrice,
  inputToCents,
  isPriceToDefine,
  priceToInput,
  type Category,
  type MenuData,
  type Product,
} from "./types";

/** Largeurs de colonnes exactes de la spec §7.3 (le titre prend le reste). */
const COL = {
  price: "w-[110px] shrink-0",
  avail: "w-[86px] shrink-0 text-center",
  out: "w-[86px] shrink-0 text-center",
  edit: "w-11 shrink-0",
} as const;

/** Panneau d'édition ouvert : produit existant ou création dans une catégorie. */
type Editor =
  | { mode: "edit"; productId: string }
  | { mode: "create"; categoryId: string }
  | null;

/** Réponse brute de GET /menu (documents lean : champs potentiellement absents). */
type RawProduct = Partial<Omit<Product, "_id">> & { _id: string };
type RawMenu = {
  categories?: (Partial<Omit<Category, "_id" | "products">> & {
    _id: string;
    products?: RawProduct[];
  })[];
  uncategorized?: RawProduct[];
};

const normProduct = (p: RawProduct, categoryId: string | null): Product => ({
  _id: String(p._id),
  categoryId,
  name: p.name ?? "",
  description: p.description ?? "",
  price: typeof p.price === "number" ? p.price : 0,
  variants: p.variants ?? [],
  tags: p.tags ?? [],
  isNew: p.isNew === true,
  outOfStock: p.outOfStock === true,
  outOfStockSource: p.outOfStockSource ?? null,
  order: typeof p.order === "number" ? p.order : 0,
  active: p.active !== false,
});

/** Minuscules sans accents — recherche insensible à la casse (§7.3). */
const searchKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function MenuPage() {
  const toast = useToast();

  const [menu, setMenu] = useState<MenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    cat: Category;
    attached: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Saisies de prix en cours (id → texte brut), prioritaires sur l'état serveur. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<CostsResponse>({});

  // ─── Chargement ───
  const load = useCallback(async () => {
    try {
      const data = await api.get<RawMenu>("/menu");
      setMenu({
        categories: (data.categories ?? []).map((c) => ({
          _id: String(c._id),
          name: c.name ?? "",
          order: typeof c.order === "number" ? c.order : 0,
          active: c.active !== false,
          products: (c.products ?? []).map((p) => normProduct(p, String(c._id))),
        })),
        uncategorized: (data.uncategorized ?? []).map((p) => normProduct(p, null)),
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Sélection effective — dérivée, jamais stockée « corrigée » : une catégorie
   * supprimée (ou une rangée « Non rattachés » vidée) retombe d'elle-même sur
   * la première catégorie, sans aller-retour d'état.
   */
  const activeSel = useMemo(() => {
    if (!menu) return null;
    const valid =
      selected === UNCAT
        ? menu.uncategorized.length > 0
        : menu.categories.some((c) => c._id === selected);
    if (valid) return selected;
    return menu.categories[0]?._id ?? (menu.uncategorized.length > 0 ? UNCAT : null);
  }, [menu, selected]);

  const categories = useMemo(() => menu?.categories ?? [], [menu]);

  const allProducts = useMemo(
    () => [...categories.flatMap((c) => c.products), ...(menu?.uncategorized ?? [])],
    [categories, menu],
  );

  // ─── Coût matière / marge du lot (contexte supply) — best-effort ───
  const refsKey = useMemo(() => allProducts.map((p) => p._id).join(","), [allProducts]);

  useEffect(() => {
    if (!refsKey) return;
    let cancelled = false;
    const refs = refsKey.split(",").slice(0, 200).join(",");
    void api
      .get<CostsResponse>(`/supply/costs?refs=${encodeURIComponent(refs)}`)
      .then((r) => {
        if (!cancelled) setCosts(r ?? {});
      })
      .catch(() => {
        // le contexte supply est optionnel pour cette vue
      });
    return () => {
      cancelled = true;
    };
  }, [refsKey]);

  /** Liste d'ingrédients supply mutualisée entre ouvertures d'EditPanel. */
  const ingredientsRef = useRef<Promise<SupplyIngredient[]> | null>(null);
  const loadIngredients = useCallback(() => {
    ingredientsRef.current ??= api
      .get<SupplyIngredient[]>("/supply/ingredients")
      .catch((e: unknown) => {
        ingredientsRef.current = null; // un échec ne doit pas être mis en cache
        throw e;
      });
    return ingredientsRef.current;
  }, []);

  // ─── Temps réel : on diffère tant que l'utilisateur manipule la vue ───
  const deferRef = useRef(false);
  const reloadTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    deferRef.current =
      dragging ||
      editor !== null ||
      importOpen ||
      deleteTarget !== null ||
      Object.keys(drafts).length > 0;
  });

  useTenantSocket({
    "menu.updated": () => {
      if (deferRef.current) return;
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void load(), 700);
    },
  });

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  // ─── Mutations locales (optimisme + rollback) ───
  const patchLocal = useCallback((id: string, patch: Partial<Product>) => {
    setMenu((m) => {
      if (!m) return m;
      const apply = (p: Product) => (p._id === id ? { ...p, ...patch } : p);
      return {
        categories: m.categories.map((c) => ({ ...c, products: c.products.map(apply) })),
        uncategorized: m.uncategorized.map(apply),
      };
    });
  }, []);

  const fail = useCallback(
    (e: unknown, fallback: string) =>
      toast(e instanceof Error ? e.message : fallback),
    [toast],
  );

  async function commitPrice(p: Product, raw: string) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[p._id];
      return next;
    });
    if (p.variants.length > 0) return; // prix porté par les variantes
    const cents = inputToCents(raw);
    if (cents === null) {
      toast("Prix illisible — utilise le format 8,90");
      return;
    }
    if (cents === p.price) return;
    const before = p.price;
    patchLocal(p._id, { price: cents });
    try {
      await api.patch(`/products/${p._id}`, { price: cents });
      toast(cents === 0 ? "Prix remis à définir" : `Prix mis à jour — ${fmtEuro(cents)}`, {
        icon: "check",
      });
    } catch (e) {
      patchLocal(p._id, { price: before });
      fail(e, "Prix non enregistré");
    }
  }

  async function toggleAvailable(p: Product) {
    const next = !p.active;
    patchLocal(p._id, { active: next });
    try {
      await api.patch(`/products/${p._id}`, { active: next });
      toast(next ? "Produit remis à la carte" : "Produit retiré de la carte", {
        icon: "check",
      });
    } catch (e) {
      patchLocal(p._id, { active: p.active });
      fail(e, "Disponibilité non enregistrée");
    }
  }

  async function toggleStock(p: Product) {
    if (p.outOfStockSource === "ingredient") return; // cascade supply : non togglable
    const next = !p.outOfStock;
    patchLocal(p._id, {
      outOfStock: next,
      outOfStockSource: next ? "manual" : null,
    });
    try {
      await api.post(`/products/${p._id}/stock`, { outOfStock: next });
      toast(next ? "Produit en rupture" : "Rupture levée", { icon: "check" });
    } catch (e) {
      patchLocal(p._id, {
        outOfStock: p.outOfStock,
        outOfStockSource: p.outOfStockSource,
      });
      fail(e, "Rupture non enregistrée");
    }
  }

  // ─── Catégories ───
  async function createCategory(name: string) {
    try {
      const doc = await api.post<{ _id: string }>("/categories", {
        name,
        order: categories.length,
      });
      setSelected(String(doc._id));
      setQ("");
      toast("Catégorie créée", { icon: "check" });
      await load();
    } catch (e) {
      fail(e, "Création impossible");
    }
  }

  async function reorderCategories(ids: string[]) {
    const before = categories;
    const byId = new Map(before.map((c) => [c._id, c]));
    const next = ids
      .map((id) => byId.get(id))
      .filter((c): c is Category => c !== undefined);
    if (next.length !== before.length) return;
    setMenu((m) => (m ? { ...m, categories: next } : m));
    try {
      await api.post("/categories/reorder", { ids });
      toast("Ordre de la carte enregistré", { icon: "check" });
    } catch (e) {
      setMenu((m) => (m ? { ...m, categories: before } : m));
      fail(e, "Réordonnancement impossible");
    }
  }

  function sortAlpha() {
    if (categories.length < 2) return;
    void reorderCategories(
      [...categories]
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
        .map((c) => c._id),
    );
  }

  async function deleteCategory(cat: Category, force: boolean) {
    if (force) setDeleting(true);
    try {
      await api.del(`/categories/${cat._id}${force ? "?force=true" : ""}`);
      setDeleteTarget(null);
      if (activeSel === cat._id) setSelected(null); // la dérivation resélectionne
      if (editor?.mode === "create" && editor.categoryId === cat._id) setEditor(null);
      toast(
        force
          ? "Catégorie supprimée — produits en « Non rattachés »"
          : "Catégorie supprimée",
        { icon: "check" },
      );
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const attached =
          (e.body as { attached?: number } | null)?.attached ?? cat.products.length;
        setDeleteTarget({ cat, attached });
        return;
      }
      fail(e, "Suppression impossible");
    } finally {
      setDeleting(false);
    }
  }

  // ─── Liste affichée (§7.3 : la recherche ignore la catégorie sélectionnée) ───
  const query = q.trim();
  const searching = query.length > 0;
  const selectedCat = categories.find((c) => c._id === activeSel) ?? null;

  const visible = useMemo(() => {
    if (searching) {
      const key = searchKey(query);
      return allProducts.filter((p) => searchKey(p.name).includes(key));
    }
    if (activeSel === UNCAT) return menu?.uncategorized ?? [];
    return selectedCat?.products ?? [];
  }, [searching, query, allProducts, activeSel, menu, selectedCat]);

  const listTitle = searching
    ? "Résultats"
    : activeSel === UNCAT
      ? "Non rattachés"
      : (selectedCat?.name ?? "Produits");

  const toDefine = allProducts.filter(isPriceToDefine).length;
  const catNameById = useMemo(
    () => new Map(categories.map((c) => [c._id, c.name])),
    [categories],
  );

  const createCategoryId = selectedCat?._id ?? categories[0]?._id ?? "";

  function openCreate() {
    if (!createCategoryId) return;
    setEditor({ mode: "create", categoryId: createCategoryId });
  }

  async function afterSaved(message: string) {
    setEditor(null);
    toast(message, { icon: "check" });
    await load();
  }

  const errorBox = (
    <div className="flex flex-col items-start gap-3 rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3">
      <p className="text-sm text-alertt">{error}</p>
      <Btn variant="ghost" size="sm" onClick={() => void load()}>
        Réessayer
      </Btn>
    </div>
  );

  // ─── États de page ───
  // Un échec de rechargement ne doit pas effacer une carte déjà affichée :
  // pleine page seulement tant qu'on n'a rien, bandeau au-dessus sinon.
  if (error && !menu) return <div className="p-[26px]">{errorBox}</div>;

  if (!menu)
    return (
      <div className="p-[26px]">
        <Skeleton className="mb-4 h-[46px] w-full" />
        <div className="flex items-start gap-4">
          <Skeleton className="h-[320px] w-[268px] shrink-0" />
          <Skeleton className="h-[420px] flex-1" />
        </div>
      </div>
    );

  return (
    <div className="p-[26px]">
      {error && <div className="mb-4">{errorBox}</div>}

      {/* ── §7.1 Bandeau « prix à définir » + import ── */}
      <div className="mb-4 flex items-center gap-3.5">
        {toDefine > 0 && (
          <div
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-card border border-gold px-3.5 py-2.5"
            style={{
              background: "color-mix(in srgb, var(--cf-gold) 18%, var(--cf-surface))",
            }}
          >
            <Icon name="tag" size={17} className="shrink-0 text-gold" />
            <p className="text-sm text-ink">
              <b className="tabular-nums">{toDefine} prix à définir</b> — ces produits
              n&apos;apparaissent pas encore à la commande client.
            </p>
          </div>
        )}
        <Btn
          size="sm"
          icon="arrow"
          className={toDefine > 0 ? undefined : "ml-auto"}
          onClick={() => setImportOpen(true)}
        >
          Importer CSV / XML
        </Btn>
      </div>

      {/* ── Deux colonnes : catégories 268 px + produits flex ── */}
      <div className="flex items-start gap-4">
        <CategoriesCard
          categories={categories}
          uncategorizedCount={menu.uncategorized.length}
          selected={activeSel}
          onSelect={(id) => {
            setSelected(id);
            setQ("");
            setEditor(null);
          }}
          onCreate={(name) => void createCategory(name)}
          onSortAlpha={sortAlpha}
          onReorder={(ids) => void reorderCategories(ids)}
          onDelete={(cat) => void deleteCategory(cat, false)}
          onDragActive={setDragging}
        />

        <Card className="min-w-0 flex-1">
          {/* Recherche dans toute la carte + création à l'unité */}
          <div className="flex items-center gap-2 px-[18px] pt-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un produit dans toute la carte…"
              aria-label="Rechercher un produit dans toute la carte"
              className="min-w-0 flex-1 px-[12px] py-[9px] text-[13px]"
            />
            <Btn
              variant="ink"
              size="sm"
              icon="plus"
              onClick={openCreate}
              disabled={!createCategoryId}
              title={
                createCategoryId
                  ? "Créer un produit dans la catégorie sélectionnée"
                  : "Crée d'abord une catégorie"
              }
            >
              Produit
            </Btn>
          </div>

          {/* En-tête de colonnes (§7.3) */}
          <div className="mt-3 flex items-center gap-2.5 bg-surface2 px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
            <span className="min-w-0 flex-1 truncate">{listTitle}</span>
            <span className={COL.price}>Prix</span>
            <span className={COL.avail}>Dispo</span>
            <span className={COL.out}>Rupture</span>
            <span className={COL.edit} aria-hidden />
          </div>

          <div className="cf-scroll max-h-[540px] overflow-y-auto">
            {/* Création à l'unité — panneau au-dessus de la liste */}
            {editor?.mode === "create" && (
              <EditPanel
                mode="create"
                createCategoryId={editor.categoryId}
                categories={categories}
                loadIngredients={loadIngredients}
                onClose={() => setEditor(null)}
                onSaved={(m) => void afterSaved(m)}
              />
            )}

            {visible.length === 0 ? (
              searching ? (
                <EmptyState
                  icon="search"
                  title="Aucun résultat"
                  hint={`Aucun produit ne correspond à « ${query} ».`}
                  className="p-[26px]"
                />
              ) : (
                <EmptyState
                  icon="grid"
                  title="Aucun produit ici"
                  hint="Rattache des produits via ✎ ou importe un fichier."
                  action={
                    <Btn
                      variant="ink"
                      size="sm"
                      icon="plus"
                      onClick={openCreate}
                      disabled={!createCategoryId}
                    >
                      Produit
                    </Btn>
                  }
                  className="p-[26px]"
                />
              )
            ) : (
              visible.map((p) => {
                const isEditing =
                  editor?.mode === "edit" && editor.productId === p._id;
                const price = effectivePrice(p);
                const toDefinePrice = price === 0;
                const hasVariants = p.variants.length > 0;
                const showPill = searching || p.categoryId === null;
                const ingredientOut = p.outOfStockSource === "ingredient";

                return (
                  <div key={p._id}>
                    <div
                      className={cx(
                        "flex items-center gap-2.5 border-t border-line px-[18px] py-2.5 transition-opacity duration-200 ease-sm",
                        p.outOfStock && "opacity-50",
                      )}
                    >
                      {/* Nom + pill de catégorie + composition */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-[15px] font-bold text-ink">
                            {p.name}
                          </span>
                          {showPill &&
                            (p.categoryId === null ? (
                              <Pill
                                className="shrink-0"
                                // couleurs posées en style : elles doivent gagner
                                // sur les classes par défaut de la pilule
                                style={{
                                  background: "var(--cf-gold)",
                                  color: "var(--cf-bg)",
                                }}
                              >
                                Non rattaché
                              </Pill>
                            ) : (
                              <Pill className="max-w-[160px] shrink-0 truncate">
                                {catNameById.get(p.categoryId) ?? "—"}
                              </Pill>
                            ))}
                          {p.isNew && (
                            <Pill className="shrink-0 bg-accent text-onaccent">
                              Nouveau
                            </Pill>
                          )}
                        </div>
                        {p.description && (
                          <p className="truncate text-xs text-mut">{p.description}</p>
                        )}
                      </div>

                      {/* Prix — PATCH au blur ou Enter (§7.3) */}
                      <div className={cx("relative", COL.price)}>
                        <Input
                          value={drafts[p._id] ?? priceToInput(price)}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [p._id]: e.target.value.replace(/[^0-9.,]/g, ""),
                            }))
                          }
                          onBlur={(e) => void commitPrice(p, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") {
                              setDrafts((d) => {
                                const next = { ...d };
                                delete next[p._id];
                                return next;
                              });
                            }
                          }}
                          inputMode="decimal"
                          readOnly={hasVariants}
                          placeholder={toDefinePrice ? "à définir" : undefined}
                          aria-label={`Prix de ${p.name}`}
                          title={
                            hasVariants
                              ? "Prix porté par les variantes — édite-les via ✎"
                              : undefined
                          }
                          className={cx(
                            "py-[7px] pl-[10px] pr-[22px] text-[14px] tabular-nums",
                            hasVariants && "cursor-not-allowed text-mut",
                          )}
                          // État « à définir » (§7.3) : bord et fond gold posés
                          // en style pour primer sur le style de contrôle du DS.
                          style={
                            toDefinePrice
                              ? {
                                  borderColor: "var(--cf-gold)",
                                  background:
                                    "color-mix(in srgb, var(--cf-gold) 14%, var(--cf-surface))",
                                }
                              : undefined
                          }
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-[9px] top-[8px] text-sm text-mut"
                        >
                          €
                        </span>
                      </div>

                      {/* Dispo — l'affichage tient compte de la rupture, le clic non */}
                      <div className={cx("flex justify-center", COL.avail)}>
                        <Toggle
                          on={p.active && !p.outOfStock}
                          onChange={() => void toggleAvailable(p)}
                          label={`Disponibilité de ${p.name}`}
                        />
                      </div>

                      {/* Rupture 1-tap — ou badge non togglable si cascade ingrédient */}
                      <div className={cx("flex justify-center", COL.out)}>
                        {ingredientOut ? (
                          <Pill
                            variant="out"
                            title="Rupture héritée d'un ingrédient en rupture — lève-la depuis « Ingrédients & stocks »."
                            className="max-w-full whitespace-normal border-alert/60 text-center leading-[1.15] text-alertt"
                          >
                            rupture ingrédient
                          </Pill>
                        ) : (
                          <Toggle
                            on={p.outOfStock}
                            danger
                            onChange={() => void toggleStock(p)}
                            label={`Rupture de ${p.name}`}
                          />
                        )}
                      </div>

                      {/* Édition inline */}
                      <div className={cx("flex justify-end", COL.edit)}>
                        <button
                          type="button"
                          onClick={() =>
                            setEditor(
                              isEditing ? null : { mode: "edit", productId: p._id },
                            )
                          }
                          aria-label={`Modifier ${p.name}`}
                          aria-expanded={isEditing}
                          title="Modifier le produit"
                          className={cx(
                            "grid size-8 place-items-center rounded-xs border transition-colors duration-200 ease-sm",
                            isEditing
                              ? "border-accent bg-accent text-onaccent"
                              : "border-line bg-surface2 text-ink hover:border-white/50",
                          )}
                        >
                          <Icon name="edit" size={15} />
                        </button>
                      </div>
                    </div>

                    {isEditing && (
                      <EditPanel
                        mode="edit"
                        product={p}
                        categories={categories}
                        initialCost={costs[p._id]}
                        loadIngredients={loadIngredients}
                        onClose={() => setEditor(null)}
                        onSaved={(m) => void afterSaved(m)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* ── §7.4 Suppression de catégorie (produits détachés, jamais supprimés) ── */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        destructive
        title={
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-[38px] shrink-0 place-items-center rounded-ctrl text-alert"
              style={{
                background: "color-mix(in srgb, var(--cf-red) 22%, var(--cf-surface))",
              }}
            >
              <Icon name="trash" size={18} />
            </span>
            <span className="min-w-0 truncate">
              Supprimer «&nbsp;{deleteTarget?.cat.name}&nbsp;» ?
            </span>
          </span>
        }
        footer={
          <>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Annuler
            </Btn>
            <Btn
              size="sm"
              icon="trash"
              // Rouge fonctionnel imposé (§7.4) — jamais l'accent tenant.
              style={{ background: "var(--cf-red)", color: "var(--cf-text)" }}
              disabled={deleting}
              onClick={() =>
                deleteTarget && void deleteCategory(deleteTarget.cat, true)
              }
            >
              {deleting ? "Suppression…" : "Supprimer la catégorie"}
            </Btn>
          </>
        }
      >
        <p className="leading-[1.5] text-mut">
          Cette catégorie contient{" "}
          <b className="tabular-nums text-ink">
            {deleteTarget?.attached ?? 0} produit(s)
          </b>
          . Ils ne seront <b className="text-ink">pas supprimés</b> : ils passeront en
          «&nbsp;Non rattachés&nbsp;», prêts à être réaffectés à une autre catégorie.
        </p>
      </Modal>

      {/* ── §7.5 Import CSV / XML ── */}
      <ImportModal
        open={importOpen}
        categories={categories}
        onClose={() => setImportOpen(false)}
        onImported={() => void load()}
      />
    </div>
  );
}
