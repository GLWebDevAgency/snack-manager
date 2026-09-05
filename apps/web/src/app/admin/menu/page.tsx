"use client";
import { useAdminCapabilities } from "../access";

/**
 * Vue « Menu & prix » — /admin/menu (spec backoffice-restaurant §7).
 *
 * Layout : bandeaux « {n} prix à définir » et « {n} sans photo » + « Importer
 * CSV / XML » (§7.1), puis deux colonnes — carte Catégories 268 px fixe (§7.2)
 * et carte Produits `flex: 1` (§7.3). La recherche cherche dans TOUTE la carte
 * et ignore alors la catégorie sélectionnée.
 *
 * Chaque ligne porte sa VIGNETTE, résolue par les adaptateurs du contrat
 * (`photoUrlDe`, `photoPointDe`) depuis le catalogue de médias que `GET /menu`
 * rend à plat : c'est ici que le gérant voit sa carte entière, donc ici que ce
 * qui manque doit se voir.
 *
 * Écritures : PATCH /products/:id (prix au blur/Enter, dispo), POST
 * /products/:id/stock (rupture 1-tap) — toutes optimistes avec rollback et
 * toast ; POST/PATCH/DELETE /categories via CategoriesCard (suppression
 * protégée : 409 → modale §7.4, `force=true` détache en « Non rattachés »).
 *
 * Temps réel : `menu.updated` recharge la carte, sauf pendant un drag, une
 * édition, un import ou une saisie de prix en cours (on ne casse jamais une
 * frappe utilisateur) — le rechargement est alors différé, puis rejoué dès
 * que la manipulation se termine, jamais jeté.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CostsResponse, SupplyIngredient } from "@sm/contracts";
import {
  catalogueMedias,
  featuredProductIdsOf,
} from "@sm/contracts";
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
import { ProductThumbnail } from "./ProductThumbnail";
import { FeaturedSelectionDialog } from "./FeaturedSelectionDialog";
import { normProduct, type RawMenu } from "./product-normalize";
import {
  UNCAT,
  effectivePrice,
  inputToCents,
  isPriceToDefine,
  priceToInput,
  type Category,
  type Mediatheque,
  type MenuData,
  type Product,
} from "./types";
import { produitsSansPhoto } from "./photos";

/**
 * Largeurs de colonnes exactes de la spec §7.3 (le titre prend le reste) —
 * colonnes à partir de `lg` seulement : en dessous, la ligne produit passe
 * sur deux étages et chaque cellule reprend sa taille naturelle.
 */
const COL = {
  // 96 px sous `lg` : avec les bascules étiquetées, 110 px faisaient sauter
  // « Rupture » à la ligne sur un écran de 390 px.
  price: "w-[96px] shrink-0 lg:w-[110px]",
  avail: "shrink-0 lg:w-[86px] lg:text-center",
  out: "shrink-0 lg:w-[86px] lg:text-center",
  edit: "shrink-0 lg:w-[92px] lg:pointer-fine:w-[68px]",
} as const;

/** Panneau d'édition ouvert : produit existant ou création dans une catégorie. */
type Editor =
  | { mode: "edit"; productId: string }
  | { mode: "create"; categoryId: string }
  | null;

/** Minuscules sans accents — recherche insensible à la casse (§7.3). */
const searchKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function MenuPage() {
  const capabilities = useAdminCapabilities();
  const hasStocks = capabilities.includes("stocks");
  const toast = useToast();

  const [menu, setMenu] = useState<MenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [featuredEditor, setFeaturedEditor] = useState<{ categoryId: string; productId?: string } | null>(null);
  /** Catégorie cliquée pendant qu'un panneau est ouvert — confirmation avant d'abandonner la saisie. */
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    cat: Category;
    attached: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** DELETE catégorie en vol — ignore le double-clic (cf. deleteCategory). */
  const deleteInFlight = useRef<Set<string>>(new Set());
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
          featuredProductIds: featuredProductIdsOf(c.featuredProductIds),
          featuredRevision: c.featuredRevision ?? 0,
          products: (c.products ?? []).map((p) => normProduct(p, String(c._id))),
        })),
        uncategorized: (data.uncategorized ?? []).map((p) => normProduct(p, null)),
        // Une API déployée avant la médiathèque ne rend pas ce champ : la
        // liste affiche alors les plats sans vignette, plutôt que de casser.
        medias: data.medias ?? [],
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : `load` normalise la réponse /menu vers la forme interne (catégories + non rattachés). Sans lui `menu` reste null, la carte est vide et `activeSel` — pourtant dérivé — n'a rien à sélectionner.
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

  /**
   * Le catalogue des photos, dans la forme qu'attendent les adaptateurs du
   * contrat (`photoUrlDe`, `photoPointDe`). Les médias voyagent à plat à la
   * racine de `GET /menu` : un cliché partagé par trois plats n'est transporté
   * qu'une fois, et c'est ici qu'on le retrouve.
   */
  const catalogue = useMemo(() => catalogueMedias(menu?.medias ?? []), [menu]);

  // ─── Coût matière / marge du lot (contexte supply) — best-effort ───
  const refsKey = useMemo(() => allProducts.map((p) => p._id).join(","), [allProducts]);

  useEffect(() => {
    if (!refsKey || !hasStocks) return;
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
  }, [refsKey, hasStocks]);

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

  /**
   * La médiathèque du restaurant, mutualisée comme les ingrédients.
   *
   * Elle est chargée par la PAGE et non par chaque panneau : ouvrir cinq
   * fiches d'affilée ne doit pas retélécharger cinq fois la bibliothèque, qui
   * est la même pour toute la carte. `forcer` la relit après un dépôt ou un
   * retrait — c'est le seul moment où elle change, et le quota avec elle.
   */
  const mediathequeRef = useRef<Promise<Mediatheque> | null>(null);
  const chargerMediatheque = useCallback((forcer = false) => {
    if (forcer) mediathequeRef.current = null;
    mediathequeRef.current ??= api.get<Mediatheque>("/medias").catch((e: unknown) => {
      mediathequeRef.current = null; // un échec ne doit pas être mis en cache
      throw e;
    });
    return mediathequeRef.current;
  }, []);

  // ─── Temps réel : on diffère tant que l'utilisateur manipule la vue ───
  const deferRef = useRef(false);
  /** `menu.updated` reçu pendant une manipulation : à rejouer, pas à jeter. */
  const pendingReload = useRef(false);
  const reloadTimer = useRef<number | undefined>(undefined);

  const scheduleReload = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => void load(), 700);
  }, [load]);

  useEffect(() => {
    deferRef.current =
      dragging ||
      editor !== null ||
      featuredEditor !== null ||
      importOpen ||
      deleteTarget !== null ||
      Object.keys(drafts).length > 0;
    // La manipulation vient de se terminer : rejouer le rechargement différé —
    // sans quoi une modification concurrente (autre tablette, import)
    // laisserait la carte périmée sans aucun signe.
    if (!deferRef.current && pendingReload.current) {
      pendingReload.current = false;
      scheduleReload();
    }
  });

  useTenantSocket({
    "menu.updated": () => {
      if (deferRef.current) {
        pendingReload.current = true;
        return;
      }
      scheduleReload();
    },
  });

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  // ─── Mutations locales (optimisme + rollback) ───
  const patchLocal = useCallback((id: string, patch: Partial<Product>) => {
    setMenu((m) => {
      if (!m) return m;
      const apply = (p: Product) => (p._id === id ? { ...p, ...patch } : p);
      return {
        ...m,
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
  async function createCategory(name: string): Promise<boolean> {
    try {
      const doc = await api.post<{ _id: string }>("/categories", {
        name,
        order: categories.length,
      });
      setSelected(String(doc._id));
      setQ("");
      toast("Catégorie créée", { icon: "check" });
      await load();
      return true;
    } catch (e) {
      fail(e, "Création impossible");
      return false;
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
    // Un double-clic sur la corbeille enverrait deux DELETE : le second (404)
    // afficherait « Suppression impossible » juste après le toast de succès.
    if (deleteInFlight.current.has(cat._id)) return;
    deleteInFlight.current.add(cat._id);
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
      deleteInFlight.current.delete(cat._id);
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
  /**
   * Les plats qui n'ont RIEN à montrer — comptés par le même adaptateur que
   * les surfaces clientes, donc sur ce que le mangeur voit réellement (les
   * dix-neuf photos héritées du pilote comptent, un média disparu ne compte
   * pas).
   */
  const sansPhoto = produitsSansPhoto(allProducts, catalogue);
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
    // L'enregistrement a pu attacher ou détacher des photos : le nombre de
    // plats qui emploient chaque média n'est donc plus celui qu'on a en cache.
    // On l'oublie sans le relire — la prochaine ouverture de fiche s'en
    // chargera, et rien n'a besoin de ce comptage entre-temps.
    mediathequeRef.current = null;
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
  if (error && !menu) return <div className="p-4 md:p-[26px]">{errorBox}</div>;

  if (!menu)
    return (
      <div className="p-4 md:p-[26px]">
        <Skeleton className="mb-4 h-[46px] w-full" />
        {/* Même gabarit responsive que la vraie page : empilé sous `lg` */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Skeleton className="h-[320px] w-full shrink-0 lg:w-[268px]" />
          <Skeleton className="h-[420px] w-full lg:flex-1" />
        </div>
      </div>
    );

  return (
    <div className="p-4 md:p-[26px]">
      {error && <div className="mb-4">{errorBox}</div>}

      {/* ── §7.1 Bandeau « prix à définir » + import ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3.5">
        {toDefine > 0 && (
          <div
            className="flex min-w-0 flex-1 basis-[280px] items-center gap-2.5 rounded-card border border-gold px-3.5 py-2.5"
            style={{
              background: "color-mix(in srgb, var(--cf-gold) 18%, var(--cf-surface))",
            }}
          >
            <Icon name="tag" size={17} className="shrink-0 text-gold" />
            <p className="text-sm text-ink">
              <b className="cf-fig">{toDefine} prix à définir</b> — ces produits
              n&apos;apparaissent pas encore à la commande client.
            </p>
          </div>
        )}
        {/*
          MÊME BANDEAU, TON DÉLIBÉRÉMENT PLUS BAS.

          Le laiton du bandeau voisin annonce un BLOCAGE : sans prix, le
          produit n'est pas vendable, il est absent de la commande client.
          Un plat sans photo, lui, se vend — moins bien, mais il se vend. Lui
          donner la même alarme diluerait le seul signal que le gérant doit
          traiter avant le service (DA §3 : le laiton se mérite). Même
          géométrie, même compteur, même phrase-conséquence ; ton neutre.
        */}
        {sansPhoto > 0 && (
          <div className="flex min-w-0 flex-1 basis-[280px] items-center gap-2.5 rounded-card border border-line bg-ink/5 px-3.5 py-2.5">
            <Icon name="fries" size={17} className="shrink-0 text-mut" />
            <p className="text-sm text-ink">
              <b className="cf-fig">{sansPhoto} sans photo</b> — ces produits
              s&apos;affichent avec leur nom seul, à la caisse comme sur votre page de
              commande.
            </p>
          </div>
        )}
        <Btn
          size="sm"
          icon="arrow"
          className={toDefine > 0 || sansPhoto > 0 ? undefined : "ml-auto"}
          onClick={() => setImportOpen(true)}
        >
          Importer CSV / XML
        </Btn>
      </div>

      {/* ── Deux colonnes : catégories 268 px + produits flex — empilées
          sous `lg`, où 268 px de catégories ne laisseraient rien aux produits ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <CategoriesCard
          categories={categories}
          uncategorizedCount={menu.uncategorized.length}
          selected={activeSel}
          onSelect={(id) => {
            // Un panneau ouvert porte une saisie bufferisée : on ne la jette
            // jamais sur un simple clic de navigation — confirmation d'abord.
            if (editor !== null) {
              setPendingSelect(id);
              return;
            }
            setSelected(id);
            setQ("");
          }}
          onCreate={createCategory}
          onSortAlpha={sortAlpha}
          onReorder={(ids) => void reorderCategories(ids)}
          onDelete={(cat) => void deleteCategory(cat, false)}
          onDragActive={setDragging}
        />

        <Card className="min-w-0 flex-1">
          {/* Recherche dans toute la carte + création à l'unité */}
          <div className="flex items-center gap-2 px-[18px] pt-3">
            {/* Gabarit standard des barres d'outils (cf. Ingrédients) : contrôle
                du DS pleine hauteur, loupe intégrée. Gelée pendant une édition :
                filtrer la liste démonterait le panneau et jetterait la saisie. */}
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
              />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un produit dans toute la carte…"
                aria-label="Rechercher un produit dans toute la carte"
                disabled={editor?.mode === "edit"}
                title={
                  editor?.mode === "edit"
                    ? "Recherche suspendue pendant l'édition — enregistre ou ferme le panneau"
                    : undefined
                }
                className="w-full pl-9"
              />
            </div>
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

          {selectedCat && !searching && <div className="mx-[18px] mt-3 flex flex-wrap items-center justify-between gap-3 rounded-ctrl border border-line bg-surface2 p-3">
            <div><p className="flex items-center gap-2 text-sm font-semibold"><Icon name="star" size={16}/>À l’affiche <span className="text-mut">{selectedCat.featuredProductIds?.length ?? 0}/3</span></p><p className="mt-1 text-xs text-mut">Une sélection commune aux écrans et aux Incontournables.</p></div>
            <Btn variant="ghost" size="sm" className="min-h-11" onClick={() => setFeaturedEditor({ categoryId: selectedCat._id })}>Choisir les produits</Btn>
          </div>}

          {/* En-tête de colonnes (§7.3) — sous `lg` seul le titre survit :
              en carte, chaque bascule porte sa propre étiquette. */}
          <div className="mt-3 flex items-center gap-2.5 bg-[image:var(--cf-elev-gradient)] px-[18px] py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
            <span className="min-w-0 flex-1 truncate">{listTitle}</span>
            <span className={cx(COL.price, "max-lg:hidden")}>Prix</span>
            <span className={cx(COL.avail, "max-lg:hidden")}>Dispo</span>
            <span className={cx(COL.out, "max-lg:hidden")}>Rupture</span>
            <span className={cx(COL.edit, "max-lg:hidden")} aria-hidden />
          </div>

          <div className="cf-scroll max-h-[540px] overflow-y-auto">
            {/* Création à l'unité — panneau au-dessus de la liste */}
            {editor?.mode === "create" && (
              <EditPanel
                mode="create"
                createCategoryId={editor.categoryId}
                categories={categories}
                loadIngredients={loadIngredients}
                chargerMediatheque={chargerMediatheque}
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
                  hint="Rattache des produits avec le bouton Modifier, ou importe un fichier."
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
                const featured = categories.find((c) => c._id === p.categoryId)?.featuredProductIds?.includes(p._id) ?? false;

                return (
                  <div key={p._id}>
                    {/*
                      Sous `lg`, la ligne devient une carte à deux étages :
                      nom + bouton Modifier, puis prix / Dispo / Rupture avec
                      leur étiquette. Les `lg:order-*` restaurent les colonnes
                      de la spec §7.3 sur grand écran.
                    */}
                    <div
                      className={cx(
                        "flex flex-wrap items-center gap-x-2.5 gap-y-2.5 border-t border-line2 px-[18px] py-3 transition-[opacity,background-color] duration-200 ease-sm hover:bg-white/3 lg:flex-nowrap lg:py-2.5",
                        p.outOfStock && "opacity-50",
                      )}
                    >
                      {/* La vignette — sans classe d'ordre : `order: 0` par
                          défaut la place avant le nom (`lg:order-1`) sur
                          grand écran comme en carte. */}
                      <ProductThumbnail produit={p} catalogue={catalogue} />

                      {/* Nom + pill de catégorie + composition */}
                      <div className="min-w-0 flex-1 lg:order-1">
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
                              <Pill className="max-w-[160px] shrink-0">
                                {/* l'ellipse doit porter sur le bloc de texte :
                                    `truncate` est inopérant sur la Pill (flex) */}
                                <span className="truncate">
                                  {catNameById.get(p.categoryId) ?? "—"}
                                </span>
                              </Pill>
                            ))}
                          {p.isNew && (
                            <Pill className="shrink-0 bg-accent text-onaccent">
                              Nouveau
                            </Pill>
                          )}
                          {featured && <span className="shrink-0 text-accent" title="Mis en avant sur les TV et en ligne"><Icon name="star" size={15}/><span className="sr-only">Mis en avant</span></span>}
                        </div>
                        {p.description && (
                          <p className="truncate text-xs text-mut">{p.description}</p>
                        )}
                      </div>

                      {/* Édition inline — dans le coin de la carte sur mobile */}
                      <div className="flex shrink-0 justify-end gap-1 lg:order-5">
                        <button type="button" onClick={() => { if (p.categoryId) setFeaturedEditor({ categoryId: p.categoryId, productId: p._id }); }} disabled={!p.categoryId}
                          aria-label={`${featured ? "Gérer la mise en avant de" : "Mettre en avant"} ${p.name}`}
                          title={p.categoryId ? "TV et Incontournables en ligne" : "Rattachez d’abord le produit à une catégorie"}
                          className={cx("cf-press grid size-11 place-items-center rounded-pill border lg:pointer-fine:size-8 disabled:opacity-30", featured ? "border-accent bg-accent text-onaccent" : "border-line text-mut hover:text-ink")}><Icon name="star" size={15}/></button>
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
                            // Rond comme IconBtn (spec §4.2) — bouton local car
                            // la taille doit rester adaptative : 44px au doigt
                            // (même sur iPad paysage, pile 1024px), 32px dense
                            // à la souris seulement.
                            "cf-press grid size-11 place-items-center rounded-pill border lg:pointer-fine:size-8",
                            isEditing
                              ? "border-accent bg-accent text-onaccent"
                              : "border-line bg-[image:var(--cf-elev-gradient)] text-ink hover:border-white/40 hover:bg-[image:var(--cf-elev-hover)]",
                          )}
                        >
                          <Icon name="edit" size={15} />
                        </button>
                      </div>

                      {/* Saut de ligne de la carte : prix et bascules en dessous. */}
                      <span className="h-0 basis-full lg:hidden" aria-hidden />

                      {/* Prix — PATCH au blur ou Enter (§7.3) */}
                      <div className={cx("relative", COL.price, "lg:order-2")}>
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
                              ? "Prix porté par les tailles — bouton Modifier, section « Tailles et formats »"
                              : undefined
                          }
                          className={cx(
                            "cf-fig py-[7px] pl-[10px] pr-[22px] text-[14px] font-bold",
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

                      {/* Dispo — gelée pendant une rupture : la lever d'abord (colonne voisine) */}
                      <div
                        className={cx(
                          "flex items-center gap-1.5 lg:justify-center",
                          COL.avail,
                          "lg:order-3",
                        )}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-mut lg:hidden">
                          Dispo
                        </span>
                        <Toggle
                          on={p.active && !p.outOfStock}
                          onChange={() => void toggleAvailable(p)}
                          // Gelée en rupture : la bascule s'afficherait éteinte
                          // avant comme après le clic — l'état changerait sans
                          // aucun retour visible, avec un toast contradictoire.
                          disabled={p.outOfStock}
                          label={
                            p.outOfStock
                              ? `Disponibilité de ${p.name} — lève d'abord la rupture`
                              : `Disponibilité de ${p.name}`
                          }
                          // Zone d'appui ~62×46 sans changer le dessin 46×26 :
                          // geste principal de la page, tapé debout en service.
                          className="after:absolute after:-inset-x-2 after:-inset-y-2.5"
                        />
                      </div>

                      {/* Rupture 1-tap — ou badge non togglable si cascade ingrédient */}
                      <div
                        className={cx(
                          "flex items-center gap-1.5 max-lg:ml-auto lg:justify-center",
                          COL.out,
                          "lg:order-4",
                        )}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-mut lg:hidden">
                          Rupture
                        </span>
                        {ingredientOut ? (
                          <Pill
                            variant="out"
                            title="Rupture héritée d'un ingrédient en rupture — lève-la depuis « Stocks »."
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
                            // idem Dispo : zone d'appui élargie au doigt
                            className="after:absolute after:-inset-x-2 after:-inset-y-2.5"
                          />
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <EditPanel
                        mode="edit"
                        product={p}
                        categories={categories}
                        initialCost={costs[p._id]}
                        loadIngredients={loadIngredients}
                        chargerMediatheque={chargerMediatheque}
                        onClose={() => setEditor(null)}
                        onSaved={(m) => void afterSaved(m)}
                        isFeatured={featured}
                        onManageFeatured={p.categoryId ? () => setFeaturedEditor({ categoryId: p.categoryId!, productId: p._id }) : undefined}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {featuredEditor && categories.find((c) => c._id === featuredEditor.categoryId) && <FeaturedSelectionDialog
        key={featuredEditor.categoryId}
        category={categories.find((c) => c._id === featuredEditor.categoryId)!}
        catalogue={catalogue}
        initialProductId={featuredEditor.productId}
        onClose={() => setFeaturedEditor(null)}
        onSaved={(selection) => {
          // Les références produits restent stables : une recette en cours
          // d'édition ne doit pas être rechargée par cette action indépendante.
          setMenu((current) => current && ({ ...current, categories: current.categories.map((c) => c._id === selection.categoryId ? { ...c, featuredProductIds: selection.featuredProductIds, featuredRevision: selection.featuredRevision } : c) }));
          setFeaturedEditor(null);
          toast("Sélection enregistrée · TV et en ligne", { icon: "star" });
        }}
      />}

      {/* ── Garde de navigation : un clic de catégorie ne jette jamais une
          saisie en cours dans un panneau ouvert ── */}
      <Modal
        open={pendingSelect !== null}
        onClose={() => setPendingSelect(null)}
        title="Modifications non enregistrées"
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setPendingSelect(null)}>
              Continuer l&apos;édition
            </Btn>
            <Btn
              size="sm"
              // Rouge fonctionnel : l'action abandonne la saisie en cours.
              style={{ background: "var(--cf-red)", color: "var(--cf-text)" }}
              onClick={() => {
                if (pendingSelect === null) return;
                setSelected(pendingSelect);
                setQ("");
                setEditor(null);
                setPendingSelect(null);
              }}
            >
              Quitter sans enregistrer
            </Btn>
          </>
        }
      >
        <p className="leading-[1.5] text-mut">
          Un panneau d&apos;édition est encore ouvert : changer de catégorie le
          ferme et abandonne ce qui y a été saisi sans l&apos;enregistrer.
        </p>
      </Modal>

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
          <b className="cf-fig text-ink">
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
