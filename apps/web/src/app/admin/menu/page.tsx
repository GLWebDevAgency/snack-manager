"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, euros } from "@/lib/api";

type Product = {
  _id: string;
  name: string;
  description: string;
  price: number;
  variants: { key: string; name: string; price: number }[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  active: boolean;
  categoryId: string;
};

type Category = {
  _id: string;
  name: string;
  order: number;
  active: boolean;
  products: Product[];
};

type Menu = { categories: Category[] };

type ProductDraft = {
  _id?: string;
  name: string;
  description: string;
  priceEuros: string;
  categoryId: string;
};

export default function MenuPage() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setMenu(await api.get<Menu>("/menu"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Catégories ───

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    await api.post("/categories", { name: newCat.trim(), order: menu?.categories.length ?? 0 });
    setNewCat("");
    await load();
  }

  async function moveCategory(index: number, dir: -1 | 1) {
    if (!menu) return;
    const ids = menu.categories.map((c) => c._id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await api.post("/categories/reorder", { ids });
    await load();
  }

  async function sortAlpha() {
    if (!menu) return;
    const ids = [...menu.categories]
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => c._id);
    await api.post("/categories/reorder", { ids });
    await load();
  }

  async function deleteCategory(cat: Category) {
    try {
      await api.del(`/categories/${cat._id}`);
    } catch (e) {
      // Suppression protégée : l'API refuse (409) si des produits sont rattachés
      if (e instanceof ApiError && e.status === 409) {
        const n = (e.body as { attached?: number })?.attached ?? cat.products.length;
        if (
          confirm(
            `« ${cat.name} » contient ${n} produit(s).\nSupprimer la catégorie ET ses produits ?`,
          )
        ) {
          await api.del(`/categories/${cat._id}?force=true`);
        } else {
          return;
        }
      } else {
        throw e;
      }
    }
    await load();
  }

  // ─── Produits ───

  async function toggleStock(p: Product) {
    // Rupture 1-tap, optimiste
    setMenu((m) =>
      m
        ? {
            categories: m.categories.map((c) => ({
              ...c,
              products: c.products.map((x) =>
                x._id === p._id ? { ...x, outOfStock: !p.outOfStock } : x,
              ),
            })),
          }
        : m,
    );
    try {
      await api.post(`/products/${p._id}/stock`, { outOfStock: !p.outOfStock });
    } catch {
      await load(); // rollback si l'API échoue
    }
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
    await api.del(`/products/${p._id}`);
    await load();
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const price = Math.round(parseFloat(draft.priceEuros.replace(",", ".")) * 100);
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        categoryId: draft.categoryId,
        ...(Number.isFinite(price) ? { price } : {}),
      };
      if (draft._id) await api.patch(`/products/${draft._id}`, body);
      else await api.post("/products", body);
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const priceLabel = (p: Product) =>
    p.variants.length > 0
      ? `dès ${euros(Math.min(...p.variants.map((v) => v.price)))}`
      : euros(p.price);

  if (error)
    return (
      <div className="p-8">
        <p className="rounded-ctrl border border-alert/40 bg-alert/10 px-4 py-3 text-alert">
          {error}
        </p>
      </div>
    );

  if (!menu)
    return (
      <div className="space-y-4 p-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-surface2" />
        ))}
      </div>
    );

  return (
    <div className="p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Menu &amp; prix</h1>
          <p className="text-sm text-ink2">
            {menu.categories.length} catégories ·{" "}
            {menu.categories.reduce((n, c) => n + c.products.length, 0)} produits
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sortAlpha}
            className="rounded-ctrl border border-line px-3.5 py-2 text-sm font-semibold text-ink2 transition hover:bg-surface2 hover:text-ink"
          >
            Trier A→Z
          </button>
          <form onSubmit={addCategory} className="flex gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="Nouvelle catégorie…"
              className="w-44 rounded-ctrl border border-line bg-surface2 px-3 py-2 text-sm outline-none transition focus:border-accent"
            />
            <button
              type="submit"
              className="rounded-ctrl bg-accent px-3.5 py-2 text-sm font-bold text-onaccent transition hover:bg-accenthover"
            >
              Ajouter
            </button>
          </form>
        </div>
      </header>

      <div className="space-y-5">
        {menu.categories.map((cat, i) => (
          <section
            key={cat._id}
            className="rounded-panel border border-line bg-surface"
          >
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <div className="flex flex-col">
                <button
                  onClick={() => moveCategory(i, -1)}
                  disabled={i === 0}
                  aria-label="Monter"
                  className="text-xs text-ink2 transition hover:text-ink disabled:opacity-25"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveCategory(i, 1)}
                  disabled={i === menu.categories.length - 1}
                  aria-label="Descendre"
                  className="text-xs text-ink2 transition hover:text-ink disabled:opacity-25"
                >
                  ▼
                </button>
              </div>
              <h2 className="text-base font-extrabold">{cat.name}</h2>
              <span className="text-sm text-ink2">({cat.products.length})</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() =>
                    setDraft({ name: "", description: "", priceEuros: "", categoryId: cat._id })
                  }
                  className="rounded-ctrl border border-line px-3 py-1.5 text-sm font-semibold text-ink2 transition hover:bg-surface2 hover:text-ink"
                >
                  + Produit
                </button>
                <button
                  onClick={() => deleteCategory(cat)}
                  aria-label={`Supprimer ${cat.name}`}
                  className="rounded-ctrl border border-line px-3 py-1.5 text-sm text-ink2 transition hover:border-alert/50 hover:text-alert"
                >
                  ✕
                </button>
              </div>
            </div>

            <ul className="divide-y divide-line">
              {cat.products.map((p) => (
                <li key={p._id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${p.outOfStock ? "text-ink2 line-through" : ""}`}>
                        {p.name}
                      </span>
                      {p.isNew && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                          Nouveau
                        </span>
                      )}
                      {p.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-ink2"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    {p.description && (
                      <p className="truncate text-sm text-ink2">{p.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {priceLabel(p)}
                  </span>
                  <button
                    onClick={() => toggleStock(p)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      p.outOfStock
                        ? "bg-alert text-white"
                        : "border border-line text-ink2 hover:border-alert/50 hover:text-alert"
                    }`}
                  >
                    {p.outOfStock ? "En rupture" : "Rupture"}
                  </button>
                  <button
                    onClick={() =>
                      setDraft({
                        _id: p._id,
                        name: p.name,
                        description: p.description,
                        priceEuros: (p.price / 100).toFixed(2).replace(".", ","),
                        categoryId: p.categoryId,
                      })
                    }
                    className="shrink-0 rounded-ctrl border border-line px-3 py-1.5 text-xs font-semibold text-ink2 transition hover:bg-surface2 hover:text-ink"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => deleteProduct(p)}
                    aria-label={`Supprimer ${p.name}`}
                    className="shrink-0 text-sm text-ink2 transition hover:text-alert"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {cat.products.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-ink2">
                  Aucun produit — ajoutez-en un.
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>

      {/* Modale produit (création / édition simple — l'éditeur complet
          variantes/options suivra la spec backoffice) */}
      {draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onClick={() => setDraft(null)}
        >
          <form
            onSubmit={saveDraft}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-panel border border-line bg-surface p-6"
          >
            <h2 className="mb-4 text-lg font-extrabold">
              {draft._id ? "Modifier le produit" : "Nouveau produit"}
            </h2>
            <label className="mb-1.5 block text-sm font-semibold text-ink2">Nom</label>
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mb-3 w-full rounded-ctrl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <label className="mb-1.5 block text-sm font-semibold text-ink2">
              Description (ingrédients affichés)
            </label>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="mb-3 w-full rounded-ctrl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mb-5 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink2">Prix (€)</label>
                <input
                  inputMode="decimal"
                  value={draft.priceEuros}
                  onChange={(e) => setDraft({ ...draft, priceEuros: e.target.value })}
                  placeholder="9,50"
                  className="w-full rounded-ctrl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink2">Catégorie</label>
                <select
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  className="w-full rounded-ctrl border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {menu.categories.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-ctrl border border-line px-4 py-2 text-sm font-semibold text-ink2 transition hover:bg-surface2"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-ctrl bg-accent px-4 py-2 text-sm font-bold text-onaccent transition hover:bg-accenthover disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
