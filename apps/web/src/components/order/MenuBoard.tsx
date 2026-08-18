"use client";

/**
 * Carte du restaurant : recherche, navigation par catégories avec repérage au
 * défilement, et cartes produit.
 *
 * Le balisage est le même en rendu serveur qu’à l’écran : noms, descriptions et
 * prix sont dans le HTML livré à Google, pas seulement une fois le JavaScript
 * exécuté. C’est la page que le restaurateur met dans sa fiche Google Business.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import type { MenuCategory, MenuProduct } from "./api";
import { euros, fold } from "./helpers";
import { Money, Tap } from "./primitives";

/** Hauteur de la barre recherche + onglets, au-dessus de laquelle on repère. */
const SPY_BAR_H = 124;

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

  // Recentre l’onglet actif dans sa piste horizontale.
  useEffect(() => {
    const tab = tabsRef.current?.querySelector<HTMLElement>(
      `[data-cat="${active}"]`,
    );
    tab?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
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

  return (
    <div>
      {/* ── Recherche + onglets, collants sous l’en-tête ── */}
      <div
        style={{ top: stickyTop }}
        className="sticky z-30 -mx-4 border-b border-white/6 bg-bg/92 px-4 pb-2 pt-3 backdrop-blur-md"
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
            placeholder="Chercher un plat, une boisson…"
            aria-label="Rechercher dans la carte"
            className="w-full rounded-pill border border-white/8 bg-surface2 py-2.5 pl-10 pr-10 text-[15px] text-ink outline-none transition-colors duration-200 ease-sm placeholder:text-mut/75 focus:border-accent"
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
            className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                    "shrink-0 rounded-pill border px-3.5 py-[7px] text-[13px] font-bold whitespace-nowrap",
                    on
                      ? "border-accent bg-[color-mix(in_srgb,var(--cf-accent)_18%,transparent)] text-ink"
                      : "border-white/8 bg-surface2 text-mut hover:text-ink",
                  )}
                >
                  {category.name}
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
            Essayez «&nbsp;tacos&nbsp;», «&nbsp;menu&nbsp;» ou «&nbsp;boisson&nbsp;».
          </p>
        </div>
      ) : (
        filtered.map((category) => (
          <section
            key={category.id}
            id={`cat-${category.id}`}
            aria-labelledby={`cat-title-${category.id}`}
            className="scroll-mt-36 pt-7"
          >
            <div className="flex items-baseline justify-between gap-3 pb-3">
              <h2
                id={`cat-title-${category.id}`}
                className="text-[20px] font-extrabold tracking-[-0.03em] text-ink"
              >
                {category.name}
              </h2>
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-mut tabular-nums">
                {category.products.length}
                <span className="sr-only"> produits</span>
              </span>
            </div>
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
        "relative overflow-hidden rounded-panel border border-white/6 bg-surface bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_90px)] shadow-card",
        unavailable && "opacity-55",
      )}
    >
      <Tap
        onClick={onPick}
        disabled={!clickable}
        aria-label={`${product.name}${product.configurable ? " — composer" : " — ajouter au panier"}`}
        className={cx(
          "flex w-full items-stretch gap-3.5 p-3 text-left",
          !clickable && "cursor-default active:scale-100",
        )}
      >
        <Thumb product={product} />

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate text-[16px] font-bold tracking-[-0.01em] text-ink">
              {product.name}
            </h3>
            {product.isNew && !unavailable && (
              <span className="shrink-0 rounded-pill bg-accent px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.08em] text-onaccent">
                Nouveau
              </span>
            )}
          </div>

          {product.description && (
            <p className="line-clamp-2 text-[13px] leading-snug text-mut">
              {product.description}
            </p>
          )}

          <div className="mt-0.5 flex items-center gap-2">
            {unavailable ? (
              <span className="rounded-pill border border-white/12 px-2 py-px text-[11px] font-bold uppercase tracking-[0.08em] text-mut">
                Épuisé
              </span>
            ) : (
              <>
                {product.variants.length > 0 && (
                  <span className="text-[12px] font-semibold text-mut">dès</span>
                )}
                <Money cents={product.fromPrice} className="text-[15px] text-ink" />
                {product.configurable && (
                  <span className="text-[12px] font-semibold text-mut">
                    · à composer
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {clickable && (
          <span
            aria-hidden
            className={cx(
              "relative grid size-9 shrink-0 self-center place-items-center rounded-pill transition-colors duration-200 ease-sm",
              qty > 0
                ? "bg-accent text-onaccent"
                : "border border-white/12 bg-surface2 text-ink",
            )}
          >
            {qty > 0 ? (
              <span className="text-[14px] font-extrabold tabular-nums">{qty}</span>
            ) : (
              <Icon name="plus" size={17} stroke={2.4} />
            )}
          </span>
        )}
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
        className="size-[62px] shrink-0 rounded-card border border-white/8 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-[62px] shrink-0 place-items-center overflow-hidden rounded-card border border-white/8 bg-surface2 text-[19px] font-black uppercase tracking-[-0.03em] text-white/25"
    >
      {product.name.trim().slice(0, 2)}
    </span>
  );
}
