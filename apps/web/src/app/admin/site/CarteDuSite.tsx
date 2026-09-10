"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { catalogueMedias } from "@sm/contracts";
import { api } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { Btn, Field, Input, Panel, Select, Skeleton } from "@/components/ui";
import { FeaturedSelectionDialog } from "../menu/FeaturedSelectionDialog";
import { ProductThumbnail } from "../menu/ProductThumbnail";
import { effectivePrice, type MenuData } from "../menu/types";
import type { RawMenu } from "../menu/product-normalize";
import type { ProductPreviewChanges } from "./ApercuCommande";
import { menuForPresentation, presentationOf, presentationPatch, readPresentationDrafts, type StoredPresentation, type PresentationDraft } from "./menu-presentation";
import { useSiteEditScope } from "./site-scope";
import styles from "./pilotage.module.css";

export function CarteDuSite({ tenantId, active, onSaved, onDrafts, onDirty, onBusy }: {
  tenantId: string; active: boolean; onSaved: () => void; onDrafts: (changes: ProductPreviewChanges) => void; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const scope = useSiteEditScope();
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(""), [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, PresentationDraft>>({});
  const [conflicts, setConflicts] = useState<Record<string, StoredPresentation>>({});
  const [busy, setBusy] = useState<string | null>(null), [saved, setSaved] = useState<string | null>(null);
  const [featured, setFeatured] = useState<string | null>(null);
  const lock = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!active || menu || !scope.current()) return;
    const abort = new AbortController();
    void api.get<RawMenu>("/menu", { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) { setMenu(menuForPresentation(data)); setError(null);
        try {
          const parsed = readPresentationDrafts(sessionStorage.getItem(`sm.admin.site.card-draft.v1:${tenantId}`));
          const current = menuForPresentation(data).categories.flatMap(cat => cat.products), next: Record<string, PresentationDraft> = {}, conflicted: Record<string, StoredPresentation> = {};
          for (const [id, record] of Object.entries(parsed)) {
            const product = current.find(item => item._id === id); if (!product) continue;
            if (JSON.stringify(record.base) === JSON.stringify(presentationOf(product))) next[id] = record.draft;
            else if (Object.keys(presentationPatch(product, record.draft)).length) conflicted[id] = record;
          }
          setDrafts(next); setConflicts(conflicted);
        } catch {} }
    }).catch(() => { if (!abort.signal.aborted) setError("Votre carte n’a pas pu être chargée."); });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, menu, attempt, tenantId]);
  const catalogue = useMemo(() => catalogueMedias(menu?.medias ?? []), [menu?.medias]);
  const categories = menu?.categories ?? [];
  const products = categories.flatMap(cat => cat.products);
  const dirtyIds = products.filter(product => Object.keys(presentationPatch(product, drafts[product._id] ?? presentationOf(product))).length > 0).map(product => product._id);
  useEffect(() => { onDirty(dirtyIds.length > 0); onBusy(!!busy || featured !== null); }, [dirtyIds.length, busy, featured, onDirty, onBusy]);
  useEffect(() => {
    const changes: ProductPreviewChanges = {};
    for (const [id, draft] of Object.entries(drafts)) { const product = menu?.categories.flatMap(cat => cat.products).find(item => item._id === id); if (!product || !Object.keys(presentationPatch(product, draft)).length) continue; changes[id] = { photoKind: draft.photoKind, photoCover: draft.photoKind === "cover", ...(draft.popularOverride !== null ? { popular: draft.popularOverride } : {}) }; }
    onDrafts(changes);
    if (menu) { try {
      const records: Record<string, StoredPresentation> = { ...conflicts };
      for (const product of menu.categories.flatMap(cat => cat.products)) {
        const draft = drafts[product._id]; if (draft && Object.keys(presentationPatch(product, draft)).length) records[product._id] = { base: presentationOf(product), draft, at: Date.now() };
      }
      sessionStorage.setItem(`sm.admin.site.card-draft.v1:${tenantId}`, JSON.stringify(records));
    } catch {} }
  }, [drafts, onDrafts, menu, tenantId, conflicts]);
  const visible = products.filter(product => (!category || product.categoryId === category) && product.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr")));
  async function save(id: string) {
    const product = products.find(item => item._id === id), draft = drafts[id];
    if (!product || !draft || lock.current || !scope.current()) return;
    const patch = presentationPatch(product, draft); if (!Object.keys(patch).length) return;
    lock.current = true; setBusy(id); setError(null); setSaved(null);
    try {
      await api.patch(`/products/${id}`, patch);
      if (!alive.current || !scope.current()) return;
      setMenu(current => current && ({ ...current, categories: current.categories.map(cat => ({ ...cat, products: cat.products.map(item => item._id === id ? { ...item, ...patch } : item) })) }));
      setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
      setSaved(product.name); onSaved();
    } catch { if (alive.current) setError("Enregistrement non confirmé. Vos choix restent ici ; vous pouvez réessayer."); }
    finally { lock.current = false; if (alive.current) setBusy(null); }
  }
  if (!scope.valid) return null;
  if (!menu) return error ? <Panel title="Votre carte"><p role="alert" className="text-sm text-mut">{error}</p><Btn variant="ghost" onClick={() => setAttempt(attempt + 1)}>Réessayer la carte</Btn></Panel> : active ? <Skeleton className="h-64" /> : null;
  return <div className={styles.catalog} onClickCapture={event => { if (!scope.current()) { event.preventDefault(); event.stopPropagation(); } }} onSubmitCapture={event => { if (!scope.current()) { event.preventDefault(); event.stopPropagation(); } }}>
    <Panel title="Une carte qui donne envie" sub="La photo et le badge se règlent ici. Les prix, recettes et stocks restent ceux de Menu & prix.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Catégorie" htmlFor="site-category"><Select id="site-category" value={category} disabled={!!busy} onChange={event => setCategory(event.target.value)}><option value="">Toute la carte</option>{categories.map(cat => <option key={cat._id} value={cat._id}>{cat.name}{!cat.active ? " · masquée" : ""}</option>)}</Select></Field>
        <Field label="Trouver un produit" htmlFor="site-product-search"><Input id="site-product-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nom du produit" /></Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{categories.filter(cat => cat.active).map(cat => <Btn key={cat._id} variant="ghost" size="sm" className="min-h-11" icon="star" disabled={!!busy} onClick={() => setFeatured(cat._id)}>À l’affiche · {cat.name}</Btn>)}</div>
      <p className="mt-3 text-xs leading-relaxed text-mut">« À l’affiche » est votre sélection éditoriale commune au site et aux écrans. Le badge « Populaire » reste distinct et peut suivre les ventes des 30 derniers jours.</p>
    </Panel>
    {Object.entries(conflicts).map(([id, record]) => <Panel key={id} title={`Brouillon de ${products.find(product => product._id === id)?.name ?? "produit"}`} sub="La présentation a changé ailleurs. Le choix actuel est conservé dans l’aperçu."><div className="flex flex-wrap gap-2">
      <Btn variant="ghost" onClick={() => setConflicts(current => { const next = { ...current }; delete next[id]; return next; })}>Garder la version en ligne</Btn>
      <Btn onClick={() => { setDrafts(current => ({ ...current, [id]: record.draft })); setConflicts(current => { const next = { ...current }; delete next[id]; return next; }); }}>Reprendre mon brouillon</Btn>
    </div></Panel>)}
    {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
    {saved && <p role="status" className="text-sm text-mut">Présentation de {saved} enregistrée.</p>}
    <p className="text-xs text-mut">{visible.length} produit{visible.length > 1 ? "s" : ""} · L’aperçu suit le cadrage choisi. Le mode automatique du badge est recalculé après enregistrement.</p>
    {visible.map(product => {
      const draft = drafts[product._id] ?? presentationOf(product), dirty = dirtyIds.includes(product._id);
      return <article key={product._id} className={styles.product}>
        <div className={styles.productHead}><ProductThumbnail produit={product} catalogue={catalogue} /><div><strong>{product.name}</strong><small>{fmtEuro(effectivePrice(product))}{!product.active ? " · non publié" : product.outOfStock ? " · indisponible" : ""}</small></div></div>
        <fieldset disabled={!!busy} className={styles.productFields}>
          <div><label htmlFor={`photo-${product._id}`}>Présentation photo</label><select id={`photo-${product._id}`} value={draft.photoKind} onChange={event => setDrafts(current => ({ ...current, [product._id]: { ...draft, photoKind: event.target.value as PresentationDraft["photoKind"] } }))}><option value="cutout">Produit détouré</option><option value="cover">Photo plein cadre</option></select></div>
          <div><label htmlFor={`popular-${product._id}`}>Badge « Populaire »</label><select id={`popular-${product._id}`} value={draft.popularOverride === null ? "auto" : String(draft.popularOverride)} onChange={event => setDrafts(current => ({ ...current, [product._id]: { ...draft, popularOverride: event.target.value === "auto" ? null : event.target.value === "true" } }))}><option value="auto">Automatique · ventes sur 30 jours</option><option value="true">Toujours afficher</option><option value="false">Ne pas afficher</option></select></div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-mut">{dirty ? "Choix non enregistrés" : "Présentation enregistrée"}</span><div className="flex gap-2">
          {dirty && <Btn variant="ghost" size="sm" className="min-h-11" disabled={!!busy} onClick={() => setDrafts(current => { const next = { ...current }; delete next[product._id]; return next; })}>Annuler</Btn>}
          <Btn size="sm" className="min-h-11" disabled={!dirty || !!busy} onClick={() => void save(product._id)}>{busy === product._id ? "Enregistrement…" : "Enregistrer ce produit"}</Btn>
        </div></div>
      </article>;
    })}
    {featured && categories.find(cat => cat._id === featured) && <FeaturedSelectionDialog category={categories.find(cat => cat._id === featured)!} catalogue={catalogue} onClose={() => setFeatured(null)} onSaved={selection => {
      setMenu(current => current && ({ ...current, categories: current.categories.map(cat => cat._id === selection.categoryId ? { ...cat, featuredProductIds: selection.featuredProductIds, featuredRevision: selection.featuredRevision } : cat) }));
      setFeatured(null); setSaved(null); onSaved();
    }} />}
  </div>;
}
