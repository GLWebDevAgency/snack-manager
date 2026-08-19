"use client";

/**
 * Carte du restaurant : recherche, navigation par catégories avec repérage au
 * défilement, et cartes produit.
 *
 * Structure reprise de la maquette (`docs/specs/commande-en-ligne.md` §5.2) :
 *   barre collante (recherche + rail de catégories)
 *   ├ section : en-tête à double filet — titre accent, note, compteur
 *   └ cartes produit denses : vignette, nom + badges, description, prix, action
 *
 * Le balisage est le même en rendu serveur qu’à l’écran : noms, descriptions et
 * prix sont dans le HTML livré à Google, pas seulement une fois le JavaScript
 * exécuté. C’est la page que le restaurateur met dans sa fiche Google Business.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import type { MenuCategory, MenuProduct } from "./api";
import { euros, fold } from "./helpers";
import {
  AddButton,
  Badge,
  PriceTag,
  Rail,
  SectionHead,
  Tap,
} from "./primitives";

/** Hauteur de la barre recherche + rail de catégories. */
const SPY_BAR_H = 118;

export function MenuBoard({
  categories,
  onPick,
  /** Quantité déjà au panier, par produit — badge sur la carte. */
  inCart,
  disabled = false,
  stickyTop = 0,
}: {
  categories: MenuCategory[];
  onPick: (product: MenuProduct) => void;
  inCart: Record<string, number>;
  /** Commande suspendue ou restaurant fermé : la carte reste consultable. */
  disabled?: boolean;
  /** Décalage vertical du bloc collant (en-tête d’embed au-dessus). */
  stickyTop?: number;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const tabsRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef(0);
  const spyOffset = stickyTop + SPY_BAR_H;

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return categories;
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter((p) =>
          fold(`${p.name} ${p.description} ${p.tags.join(" ")}`).includes(needle),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, query]);

  // ── Repérage au défilement : la catégorie visible pilote l’onglet actif ──
  useEffect(() => {
    if (query) return;
    const onScroll = () => {
      // Après un clic d’onglet, le défilement doux ne doit pas voler la sélection.
      if (Date.now() < lockRef.current) return;
      let current = categories[0]?.id ?? "";
      for (const category of categories) {
        const node = document.getElementById(`cat-${category.id}`);
        if (!node) continue;
        if (node.getBoundingClientRect().top - spyOffset <= 0) current = category.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [categories, query, spyOffset]);

  /**
   * Recentre l’onglet actif dans sa piste horizontale.
   *
   * On pilote le défilement du rail lui-même plutôt que `scrollIntoView` :
   * celui-ci fait défiler TOUS les ancêtres, y compris la page — il entrait en
   * concurrence avec l’ancrage de section et l’un des deux mouvements restait
   * en plan. Et pendant que la page s’anime vers une section, le rail se recale
   * sèchement : deux défilements doux simultanés s’annulent.
   */
  useEffect(() => {
    const rail = tabsRef.current;
    const tab = rail?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!rail || !tab) return;
    const offset =
      tab.getBoundingClientRect().left -
      rail.getBoundingClientRect().left +
      rail.scrollLeft;
    const left = offset - (rail.clientWidth - tab.offsetWidth) / 2;
    rail.scrollTo({
      left: Math.max(0, left),
      behavior: Date.now() < lockRef.current ? "auto" : "smooth",
    });
  }, [active]);

  const goTo = useCallback(
    (id: string) => {
      const node = document.getElementById(`cat-${id}`);
      if (!node) return;
      // Le défilement doux dure ~500 ms : on gèle le repérage le temps qu’il
      // se termine, sinon la catégorie survolée volerait la sélection.
      lockRef.current = Date.now() + 700;
      setActive(id);
      window.scrollTo({
        top: window.scrollY + node.getBoundingClientRect().top - spyOffset + 8,
        behavior: "smooth",
      });
    },
    [spyOffset],
  );

  const anchor = { "--sm-anchor": `${spyOffset + 8}px` } as CSSProperties;

  return (
    <div style={anchor}>
      {/* ── Recherche + rail de catégories, collants sous l’en-tête ── */}
      <div
        style={{ top: stickyTop }}
        className="sticky z-30 -mx-4 border-b border-white/6 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur-md"
      >
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mut"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Un kebab ? Un tacos gratiné ?"
            aria-label="Rechercher dans la carte"
            className="h-11 w-full rounded-pill border border-white/8 bg-surface2 pl-10 pr-10 text-[15px] text-ink outline-none transition-colors duration-200 ease-sm placeholder:text-mut/75 focus:border-accent"
          />
          {query && (
            <Tap
              onClick={() => setQuery("")}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-pill bg-white/8 text-mut hover:text-ink"
            >
              <Icon name="close" size={13} />
            </Tap>
          )}
        </div>

        {!query && categories.length > 1 && (
          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Catégories de la carte"
            className="sm-rail sm-fade-x -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-1"
          >
            {categories.map((category) => {
              const on = active === category.id;
              return (
                <Tap
                  key={category.id}
                  role="tab"
                  aria-selected={on}
                  data-cat={category.id}
                  onClick={() => goTo(category.id)}
                  className={cx(
                    "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 text-[13px] font-bold",
                    on
                      ? "border-accent bg-accent text-onaccent"
                      : "border-white/8 bg-surface2 text-mut hover:text-ink",
                  )}
                >
                  {category.name}
                  <span
                    className={cx(
                      "text-[11px] font-extrabold tabular-nums",
                      on ? "opacity-65" : "text-white/30",
                    )}
                  >
                    {category.products.length}
                  </span>
                </Tap>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Sections ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="grid size-11 place-items-center rounded-card bg-surface2 text-mut">
            <Icon name="search" size={20} />
          </span>
          <p className="text-[15px] font-bold text-ink">
            Aucun résultat pour «&nbsp;{query.trim()}&nbsp;»
          </p>
          <p className="text-[13px] text-mut">
            Essayez «&nbsp;tacos&nbsp;», «&nbsp;kebab&nbsp;» ou «&nbsp;boisson&nbsp;».
          </p>
        </div>
      ) : (
        filtered.map((category) => (
          <section
            key={category.id}
            id={`cat-${category.id}`}
            aria-labelledby={`cat-title-${category.id}`}
            className="sm-anchor pt-8"
          >
            <SectionHead
              id={`cat-title-${category.id}`}
              title={category.name}
              note={categoryNote(category)}
            />
            <div className="flex flex-col gap-2.5">
              {category.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  qty={inCart[product.id] ?? 0}
                  disabled={disabled}
                  onPick={() => onPick(product)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * Note de section — la maquette porte une accroche rédigée par catégorie
 * (« Servis avec crudités & frites »). L’API n’expose pas encore ce champ :
 * on affiche la fourchette de prix, seule information juste que l’on possède,
 * plutôt qu’une phrase inventée.
 */
function categoryNote(category: MenuCategory): string | null {
  const prices = category.products
    .filter((p) => !p.outOfStock && p.fromPrice > 0)
    .map((p) => p.fromPrice);
  if (prices.length === 0) return null;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? `Tous à ${euros(low)}` : `De ${euros(low)} à ${euros(high)}`;
}

// ─────────────────────────────────────────────────────────────
// Carte produit
// ─────────────────────────────────────────────────────────────

/**
 * Densité de la carte (maquette §5.2.3) : vignette 68, nom 16/700, description
 * sur deux lignes maximum, pied prix + action. Le rythme vertical est le même
 * pour toutes les cartes, avec ou sans description — c’est ce qui fait qu’une
 * liste de vingt produits se parcourt au pouce sans fatigue.
 */
function ProductCard({
  product,
  qty,
  disabled,
  onPick,
}: {
  product: MenuProduct;
  qty: number;
  disabled: boolean;
  onPick: () => void;
}) {
  const unavailable = product.outOfStock;
  const clickable = !unavailable && !disabled;

  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-panel border bg-surface bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_90px)] shadow-card transition-colors duration-200 ease-sm",
        qty > 0 ? "border-accent/45" : "border-white/6",
        unavailable && "opacity-55",
      )}
    >
      <Tap
        onClick={onPick}
        disabled={!clickable}
        aria-label={`${product.name}${product.configurable ? " — composer" : " — ajouter au panier"}`}
        className={cx(
          "flex w-full items-center gap-3.5 p-3 text-left",
          !clickable && "cursor-default active:scale-100",
        )}
      >
        <Thumb product={product} />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-[16px] font-bold leading-tight tracking-[-0.015em] text-ink">
              {product.name}
            </h3>
            {product.isNew && !unavailable && <Badge tone="new">Nouveau</Badge>}
          </div>

          {product.description && (
            <p className="line-clamp-2 text-[13px] leading-snug text-mut">
              {product.description}
            </p>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {unavailable ? (
              <Badge tone="out">Bientôt</Badge>
            ) : (
              <PriceTag cents={product.fromPrice} from={product.variants.length > 0} />
            )}
          </div>
        </div>

        {clickable && <AddButton qty={qty} compose={product.configurable} />}
      </Tap>

      {/* Prix lisible par les moteurs (microdonnées portées par le JSON-LD). */}
      <span className="sr-only">
        {product.name} — {euros(product.fromPrice)}
      </span>
    </article>
  );
}

/** Vignette : photo du restaurant, sinon monogramme sur surface niveau 3. */
function Thumb({ product }: { product: MenuProduct }) {
  if (product.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.photoUrl}
        alt=""
        loading="lazy"
        className="size-[68px] shrink-0 rounded-card border border-white/8 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-[68px] shrink-0 place-items-center overflow-hidden rounded-card border border-white/8 bg-surface2 text-[20px] font-black uppercase tracking-[-0.03em] text-white/25"
    >
      {product.name.trim().slice(0, 2)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Rail « Les incontournables » (accueil de la vitrine)
// ─────────────────────────────────────────────────────────────

/**
 * Mise en avant horizontale (maquette §5.1.4). Elle n’existe que sur la page
 * publique : dans l’embed, l’encart doit aller droit à la carte.
 */
export function Highlights({
  products,
  inCart,
  disabled,
  onPick,
  onBrowse,
}: {
  products: MenuProduct[];
  inCart: Record<string, number>;
  disabled: boolean;
  onPick: (product: MenuProduct) => void;
  onBrowse: () => void;
}) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="incontournables" className="pt-8">
      <SectionHead
        id="incontournables"
        title="Les incontournables"
        note="Les plats que le restaurant met en avant"
        aside={
          <Tap
            onClick={onBrowse}
            className="shrink-0 pb-0.5 text-[13px] font-bold text-mut hover:text-ink"
          >
            Tout voir →
          </Tap>
        }
      />

      <Rail label="Sélection du restaurant" className="pb-1">
        {products.map((product) => {
          const qty = inCart[product.id] ?? 0;
          return (
            <Tap
              key={product.id}
              onClick={() => !disabled && onPick(product)}
              disabled={disabled}
              aria-label={`${product.name} — ${euros(product.fromPrice)}`}
              className={cx(
                "w-[158px] shrink-0 overflow-hidden rounded-panel border bg-surface text-left shadow-card",
                qty > 0 ? "border-accent/45" : "border-white/6",
              )}
            >
              <span className="relative block h-[96px] w-full overflow-hidden bg-surface2">
                {product.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.photoUrl}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-[26px] font-black uppercase tracking-[-0.03em] text-white/15">
                    {product.name.trim().slice(0, 2)}
                  </span>
                )}
                {product.isNew && (
                  <span className="absolute left-2 top-2">
                    <Badge tone="new">Nouveau</Badge>
                  </span>
                )}
              </span>
              <span className="block px-2.5 pb-2.5 pt-2">
                <span className="block truncate text-[14px] font-bold leading-tight text-ink">
                  {product.name}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <PriceTag
                    cents={product.fromPrice}
                    from={product.variants.length > 0}
                    size="sm"
                  />
                  <span
                    aria-hidden
                    className={cx(
                      "grid size-7 shrink-0 place-items-center rounded-pill",
                      qty > 0 ? "bg-accent text-onaccent" : "bg-white/10 text-ink",
                    )}
                  >
                    {qty > 0 ? (
                      <span className="text-[12px] font-extrabold tabular-nums">{qty}</span>
                    ) : (
                      <Icon name="plus" size={14} stroke={2.8} />
                    )}
                  </span>
                </span>
              </span>
            </Tap>
          );
        })}
      </Rail>
    </section>
  );
}
