"use client";

import { useMemo, useRef, useState } from "react";
import { FEATURED_PRODUCTS_MAX, featuredProductIdsOf, type CategoryFeaturedView, type MediaVue } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { Btn, Icon, Input, Modal, Pill } from "@/components/ui";
import { effectivePrice, type Category } from "./types";
import { ProductThumbnail } from "./ProductThumbnail";
import { recoverFeaturedConflict } from "./featured-conflict";
import type { RawMenu } from "./product-normalize";

const searchKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Une sélection ordonnée, enregistrée d'un seul geste sur les deux supports. */
export function FeaturedSelectionDialog({ category, catalogue, initialProductId, onClose, onSaved }: {
  category: Category;
  catalogue: ReadonlyMap<string, MediaVue>;
  initialProductId?: string;
  onClose: () => void;
  onSaved: (selection: CategoryFeaturedView) => void;
}) {
  const initial = featuredProductIdsOf(category.featuredProductIds);
  const [ids, setIds] = useState(() => initialProductId && !initial.includes(initialProductId) && initial.length < FEATURED_PRODUCTS_MAX
    ? [...initial, initialProductId] : initial);
  const [revision, setRevision] = useState(category.featuredRevision ?? 0);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof recoverFeaturedConflict>>["details"]>(null);
  const displayedCategory = details ?? category;
  const displayedCatalogue = details?.catalogue ?? catalogue;
  const products = useMemo(() => new Map(displayedCategory.products.map((p) => [p._id, p])), [displayedCategory.products]);
  const available = displayedCategory.products.filter((p) => !ids.includes(p._id) && searchKey(p.name).includes(searchKey(query)));
  const full = ids.length >= FEATURED_PRODUCTS_MAX;

  function move(index: number, delta: number) {
    setIds((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
      return next;
    });
  }

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put<CategoryFeaturedView>(`/categories/${category._id}/featured`, { productIds: ids, expectedRevision: revision });
      onSaved(saved);
    } catch (e) {
      const current = e instanceof ApiError && e.status === 409
        ? (e.body as { current?: CategoryFeaturedView })?.current : undefined;
      if (current?.categoryId === category._id && Number.isInteger(current.featuredRevision)) {
        const recovered = await recoverFeaturedConflict(current, () => api.get<RawMenu>("/menu"));
        setIds(recovered.selection.featuredProductIds);
        setRevision(recovered.selection.featuredRevision);
        if (recovered.details) setDetails(recovered.details);
        setError(recovered.details
          ? "La sélection a changé depuis un autre poste. La version actuelle est affichée : vérifiez-la avant d’enregistrer à nouveau."
          : "La sélection a changé depuis un autre poste. Ses références sont conservées, mais les informations des produits n’ont pas pu être actualisées. Vérifiez votre connexion avant de réessayer.");
      } else setError(e instanceof Error ? e.message : "La sélection n’a pas pu être enregistrée.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <Modal open title={`À l’affiche · ${displayedCategory.name}`} width={620}
    onClose={() => { if (!lock.current) onClose(); }}
    footer={<><Btn variant="ghost" size="sm" disabled={busy} onClick={onClose}>Annuler</Btn><Btn variant="ink" size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer la sélection"}</Btn></>}>
    <p className="mb-4 leading-relaxed text-mut">Choisissez jusqu’à trois produits, dans l’ordre souhaité. Ils apparaissent sur vos écrans et dans les <strong className="text-ink">Incontournables</strong> de la commande en ligne, avec leurs photos et leurs prix à jour.</p>
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">Votre sélection</h3><Pill>{ids.length} / {FEATURED_PRODUCTS_MAX}</Pill></div>
    <ol className="mb-4 space-y-2" aria-label="Produits mis en avant">
      {ids.map((id, index) => {
        const p = products.get(id);
        return <li key={id} className="flex flex-wrap items-center gap-2 rounded-ctrl border border-line bg-surface2 p-2">
          <span className="relative shrink-0">{p && <ProductThumbnail produit={p} catalogue={displayedCatalogue}/>}<span aria-hidden className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-accent text-xs font-bold text-onaccent">{index + 1}</span></span>
          <div className="min-w-0 flex-1"><p className="break-words font-semibold">{p?.name ?? "Informations du produit à actualiser"}</p>
            <p className="text-xs text-mut">{!p ? "Produit conservé dans votre sélection" : !displayedCategory.active || !p.active || p.outOfStock ? "Diffusion suspendue" : "Disponible"}</p></div>
          <div className="flex shrink-0 items-center">
            <button type="button" className="grid size-11 place-items-center rounded-ctrl disabled:opacity-30" disabled={busy || index === 0} aria-label={`Monter ${p?.name ?? "le produit"}`} onClick={() => move(index, -1)}><Icon name="arrow" className="-rotate-90" size={16}/></button>
            <button type="button" className="grid size-11 place-items-center rounded-ctrl disabled:opacity-30" disabled={busy || index === ids.length - 1} aria-label={`Descendre ${p?.name ?? "le produit"}`} onClick={() => move(index, 1)}><Icon name="arrow" className="rotate-90" size={16}/></button>
            <button type="button" className="grid size-11 place-items-center rounded-ctrl" disabled={busy} aria-label={`Retirer ${p?.name ?? "le produit"} de la sélection`} onClick={() => setIds(ids.filter((v) => v !== id))}><Icon name="close" size={16}/></button>
          </div>
        </li>;
      })}
    </ol>
    {ids.length === 0 && <p className="mb-4 rounded-ctrl border border-dashed border-line p-4 text-mut">Aucun produit sélectionné dans cette catégorie.</p>}
    <p className="mb-3 text-xs leading-relaxed text-mut">Les produits indisponibles restent sélectionnés et reviennent automatiquement quand ils sont disponibles. Les horaires de service s’appliquent aux écrans.</p>
    {full && <p role="status" className="mb-3 rounded-ctrl bg-surface2 p-3 text-sm">Votre sélection est complète. Retirez un produit pour en choisir un autre.</p>}
    <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un produit à mettre en avant" placeholder="Rechercher dans cette catégorie…" className="mb-3 w-full" disabled={busy}/>
    <ul className="space-y-1" aria-label="Produits à choisir">{available.map((p) => <li key={p._id}>
      <button type="button" disabled={busy || full} onClick={() => setIds([...ids, p._id])} aria-label={`Mettre en avant ${p.name}`} className="flex min-h-14 w-full items-center gap-3 rounded-ctrl border border-line2 px-3 py-2 text-left hover:bg-surface2 disabled:opacity-50">
        <ProductThumbnail produit={p} catalogue={displayedCatalogue}/><span className="min-w-0 flex-1"><span className="block break-words font-semibold">{p.name}</span>{(!p.active || p.outOfStock) && <span className="text-xs text-mut">Indisponible actuellement</span>}</span><span className="shrink-0 text-sm tabular-nums">{p.variants.length > 1 ? "Dès " : ""}{fmtEuro(effectivePrice(p))}</span><Icon name="plus" size={16}/>
      </button>
    </li>)}</ul>
    {available.length === 0 && <p className="py-3 text-sm text-mut">{query ? "Aucun produit ne correspond à votre recherche." : "Tous les produits de cette catégorie sont sélectionnés."}</p>}
    {error && <p role="alert" className="mt-4 rounded-ctrl border border-alert/60 p-3 text-alertt">{error}</p>}
  </Modal>;
}
