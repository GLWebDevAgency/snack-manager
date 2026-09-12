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
  Plate,
  PriceTag,
  Rail,
  SectionHead,
  TAP,
  Tap,
} from "./primitives";

/** Hauteur de la barre recherche + rail de catégories. */
const SPY_BAR_H = 54;

export function MenuBoard({
  categories,
  onPick,
  /** Quantité déjà au panier, par produit — badge sur la carte. */
  inCart,
  disabled = false,
  stickyTop = 0,
  prixMono,
  search = false,
}: {
  search?: boolean;
  categories: MenuCategory[];
  onPick: (product: MenuProduct, variantKey?: string) => void;
  inCart: Record<string, number>;
  /** Commande suspendue ou restaurant fermé : la carte reste consultable. */
  disabled?: boolean;
  /** Décalage vertical du bloc collant (en-tête d’embed au-dessus). */
  stickyTop?: number;
  /**
   * Paire typographique du masque qui pose les prix en chasse fixe.
   * OBLIGATOIRE : une valeur par défaut laisse un oubli passer en silence,
   * et un prix retombé en police de corps ne se voit qu'à l'œil.
   */
  prixMono: boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const lockRef = useRef(0);
  const spyOffset = stickyTop + SPY_BAR_H;

  const filtered = useMemo(() => {
    const needle = search ? fold(query.trim()) : "";
    if (!needle) return categories;
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter((p) =>
          fold(`${category.name} ${p.name} ${p.description} ${p.tags.join(" ")}`).includes(needle),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, query, search]);

  // ── Repérage au défilement : la catégorie visible pilote l’onglet actif ──
  useEffect(() => {
    if (search) return;
    const doc = boardRef.current?.ownerDocument, view = doc?.defaultView;
    if (!doc || !view) return;
    const onScroll = () => {
      // Après un clic d’onglet, le défilement doux ne doit pas voler la sélection.
      if (Date.now() < lockRef.current) return;
      let current = categories[0]?.id ?? "";
      for (const category of categories) {
        const node = doc.getElementById(`cat-${category.id}`);
        if (!node) continue;
        if (node.getBoundingClientRect().top - spyOffset <= 0) current = category.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    onScroll();
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => view.removeEventListener("scroll", onScroll);
  }, [categories, query, search, spyOffset]);

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
      const doc = boardRef.current?.ownerDocument, view = doc?.defaultView;
      const node = doc?.getElementById(`cat-${id}`);
      if (!node || !view) return;
      // Le défilement doux dure ~500 ms : on gèle le repérage le temps qu’il
      // se termine, sinon la catégorie survolée volerait la sélection.
      lockRef.current = Date.now() + 700;
      setActive(id);
      view.scrollTo({
        top: view.scrollY + node.getBoundingClientRect().top - spyOffset + 8,
        behavior: view.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    },
    [spyOffset],
  );

  const discoveries = categories.flatMap(category => category.products).filter(product => !product.outOfStock && (product.popular || product.isNew)).slice(0, 6);
  const searchLanding = search && !query.trim();
  const anchor = { "--sm-anchor": `${spyOffset + 8}px` } as CSSProperties;

  return (
    <div ref={boardRef} style={anchor}>
      {/* ── Recherche + rail de catégories, collants sous l’en-tête ── */}
      <div
        style={{ top: stickyTop }}
        className={search ? "sm-order-search" : "sm-order-categories sticky z-30 -mx-4 border-b border-ink/6 bg-bg/95 px-4 backdrop-blur-md"}
      >
        {search && <h2>Rechercher</h2>}
        {search && <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mut"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Un kebab ? Un tacos gratiné ?"
            aria-label="Rechercher dans la carte"
            className="h-11 w-full rounded-pill border border-ink/8 bg-surface2 pl-10 pr-14 text-[15px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut focus:border-focus"
          />
          {query && (
            <Tap
              onClick={() => { setQuery(""); searchRef.current?.focus({ preventScroll: true }); }}
              aria-label="Effacer la recherche"
              /* La cible fait 44 px, la pastille visible 28 : le pouce vise
                 large sans qu'une gomme énorme s'installe dans le champ. */
              className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-pill text-mut hover:text-ink"
            >
              <span className="grid size-7 place-items-center rounded-pill bg-ink/8">
                <Icon name="close" size={13} />
              </span>
            </Tap>
          )}
        </div>}

        {/*
          ═══ CE N'EST PAS UN JEU D'ONGLETS, C'EST UNE NAVIGATION DE PAGE ═══

          C'était un `role="tablist"` de `role="tab"` : sans `aria-controls`,
          sans tabindex tournant, sans flèches. Un lecteur d'écran annonçait
          donc vingt onglets qui ne commandaient aucun `tabpanel`, et la
          tabulation s'arrêtait sur chacun d'eux. Or rien ici ne montre ni ne
          cache un panneau — la carte entière reste affichée et la barre suit
          le DÉFILEMENT. La forme juste est celle d'un sommaire : des liens
          d'ancre dans un `<nav>` nommé, dont un porte `aria-current`.

          Les liens gardent leur `href` : sans JavaScript, le saut d'ancre
          fonctionne quand même (`.sm-anchor` porte déjà la marge de
          défilement sous la barre collante). `goTo` ne fait qu'y substituer un
          défilement doux et geler le repérage le temps du trajet.
        */}
        {!search && categories.length > 1 && (
          <nav
            ref={tabsRef}
            aria-label="Catégories de la carte"
            className="sm-rail sm-fade-x -mx-4 flex gap-2 overflow-x-auto px-4"
          >
            {categories.map((category) => {
              const on = active === category.id;
              return (
                <a
                  key={category.id}
                  href={`#cat-${category.id}`}
                  aria-current={on ? "true" : undefined}
                  data-cat={category.id}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(category.id);
                  }}
                  className={cx(
                    TAP,
                    // Catégorie visible : filet blanc, pas d'aplat de marque.
                    // L'accent reste réservé aux boutons d'ajout (DA §3) —
                    // sinon vingt pastilles d'ajout et un onglet doré se
                    // disputent l'œil.
                    "flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-4 text-[13.5px] font-bold",
                    // Le filet FERME : c'est lui qui dit quelle catégorie
                    // est à l'écran. À 45 % d'encre il tombait à 2,22
                    // (Marché) et 2,48 (Soleil) — cinq directions sur six
                    // sous le seuil de 1.4.11 pour un état de contrôle.
                    on
                      ? "border-linefirm bg-surface2 text-ink"
                      : "border-transparent bg-surface2 text-mut hover:text-ink",
                  )}
                >
                  {category.name}
                  {/* `text-mut` dans les deux états : le compteur d'une
                      catégorie non courante était en `text-ink/30` à 11 px,
                      soit 1,5 à 2,5:1 selon la direction — « 24 » et « 8 »
                      quasi effacés (1.4.3). Ce sont le filet et l'encre du
                      libellé qui distinguent la catégorie visible. */}
                  <span className="text-[11px] font-extrabold tabular-nums text-mut">
                    {category.products.length}
                  </span>
                </a>
              );
            })}
          </nav>
        )}
      </div>

      {searchLanding && <div className="sm-order-search-landing">
        {discoveries.length > 0 && <section aria-label="À découvrir"><h3>À découvrir</h3><div>{discoveries.map(product => <Tap key={product.id} onClick={() => setQuery(product.name)}><Icon name="plus" size={14} />{product.name}</Tap>)}</div></section>}
        <section aria-label="Catégories à rechercher"><h3>Catégories</h3><div>{categories.map(category => <Tap key={category.id} onClick={() => setQuery(category.name)}>{category.name}<span>{category.products.length}</span></Tap>)}</div></section>
      </div>}
      {/* ── Sections ── */}
      {!searchLanding && (filtered.length === 0 ? (
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
            className="sm-order-category sm-anchor"
          >
            <SectionHead
              id={`cat-title-${category.id}`}
              title={category.name}
              note={categoryNote(category)}
            />
            <div className={photoGrid(category) && !search ? "sm-order-product-grid" : "sm-order-product-list"}>
              {category.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  grid={photoGrid(category) && !search}
                  qty={inCart[product.id] ?? 0}
                  disabled={disabled}
                  prixMono={prixMono}
                  onPick={(variantKey) => onPick(product, variantKey)}
                />
              ))}
            </div>
          </section>
        ))
      ))}
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
  const products = category.products.filter((p) => !p.outOfStock && p.fromPrice > 0);
  const prices = products.map((p) => p.fromPrice);
  if (prices.length === 0) return null;
  const low = Math.min(...prices);
  // fromPrice is a minimum: a larger format can exceed every base price.
  if (products.some((p) => p.variants.length > 0)) return `À partir de ${euros(low)}`;
  const high = Math.max(...prices);
  return low === high ? `Tous à ${euros(low)}` : `De ${euros(low)} à ${euros(high)}`;
}

// ─────────────────────────────────────────────────────────────
// Carte produit
// ─────────────────────────────────────────────────────────────

/** A category becomes a photo grid only when its real media coverage permits it. */
function photoGrid(category: MenuCategory): boolean {
  return category.products.length >= 2 && category.products.filter(product => product.photoUrl).length / category.products.length >= .6;
}

function ProductCard({ product, qty, disabled, prixMono, onPick, grid }: {
  product: MenuProduct; qty: number; disabled: boolean; prixMono: boolean; onPick: (variantKey?: string) => void; grid: boolean;
}) {
  const clickable = !product.outOfStock && !disabled;
  const badge = !product.outOfStock && (product.isNew ? <Badge tone="new">Nouveau</Badge>
    : product.popular ? <span className="sm-order-popular">Populaire</span> : null);
  const price = product.outOfStock ? <Badge tone="out">Bientôt</Badge>
    : <PriceTag cents={product.fromPrice} from={product.variants.length > 0} mono={prixMono} size={grid ? "sm" : "md"} />;
  return <article aria-label={product.name} data-photo={product.photoUrl ? "" : undefined} className={cx(grid ? "sm-order-product-card" : "sm-order-product-row", product.outOfStock && "opacity-55")}>
    <Tap onClick={() => onPick()} disabled={!clickable} className="sm-order-product-button">
      {grid && <span className="sm-order-product-visual">
        <Plate photoUrl={product.photoUrl} cover={product.photoCover} name={product.name} pad="p-[8%]" radius="rounded-none" className="sm-order-product-photo" />
        {badge && <span className="sm-order-product-badge">{badge}</span>}
      </span>}
      <span className="sm-order-product-copy">
        <span className="sm-order-product-name">{product.name}{!grid && badge}</span>
        {product.description && <span className="sm-order-product-description">{product.description}</span>}
        {product.tags.length > 0 && <span className="sm-order-product-tags">{product.tags.slice(0, 2).join(" · ")}</span>}
        {!grid && product.photoUrl && <span className="sm-order-product-price">{price}</span>}
      </span>
      <span className="sm-order-product-footer">
        {(grid || !product.photoUrl) && <span className="sm-order-product-price">{price}</span>}
        {!grid && product.photoUrl && <Plate photoUrl={product.photoUrl} cover={product.photoCover} name={product.name} pad="p-[6%]" className="sm-order-product-thumbnail" />}
        {clickable && <AddButton qty={qty} compose={product.configurable} compact={grid} />}
      </span>
      <span className="sr-only">{qty > 0 ? `, ${qty} déjà au panier` : ""}{clickable ? product.configurable ? ", composer" : ", ajouter au panier" : ""}</span>
    </Tap>
    {product.variants.length > 0 && product.variants.length <= 4 && <div className="sm-order-variants" data-count={product.variants.length} role="group" aria-label={`Choisir ${product.name}`}>
      {product.variants.map(variant => <Tap key={variant.key} disabled={!clickable} onClick={() => onPick(variant.key)}>{variant.name}<span>{euros(variant.price)}</span></Tap>)}
    </div>}
  </article>;
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
  prixMono,
  onPick,
  onBrowse,
}: {
  products: MenuProduct[];
  inCart: Record<string, number>;
  disabled: boolean;
  /** Paire typographique du masque — obligatoire, comme sur `MenuBoard`. */
  prixMono: boolean;
  onPick: (product: MenuProduct, variantKey?: string) => void;
  onBrowse: () => void;
}) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="incontournables" className="sm-order-highlights">
      <SectionHead
        id="incontournables"
        title="Les incontournables"
        aside={
          <Tap
            onClick={onBrowse}
            /* 44 px de haut comme tout contrôle client (spec §7) : le lien
               faisait 17 px, sous le minimum de 2.5.8 lui-même. La marge
               négative reprend la hauteur ajoutée pour que le filet de
               l'en-tête reste calé sur la ligne de base du titre — la cible
               grandit, la mise en page ne bouge presque pas. */
            className="-my-2.5 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-bold text-mut hover:text-ink"
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
              className={cx(
                /* `sr-only` est positionné en absolu. Sans ce contenant, ses
                   huit libellés prennent le rail entier comme repère et
                   élargissent invisiblement le document mobile. */
                "sm-order-highlight relative w-[164px] shrink-0 overflow-hidden rounded-panel border bg-surface text-left shadow-card",
                qty > 0 ? "border-accent/45" : "border-ink/6",
              )}
            >
              {/* Le visuel occupe la moitié de la carte : c'est le rail qui
                  doit donner faim, pas le convaincre de lire. */}
              <span className="relative block">
                {product.photoUrl && <Plate
                  photoUrl={product.photoUrl}
                  cover={product.photoCover}
                  name={product.name}
                  mono={46}
                  pad="p-[9%]"
                  radius="rounded-none"
                  className="h-[118px] w-full border-0 border-b border-ink/6"
                />}
                {product.isNew && (
                  <span className="absolute left-2 top-2">
                    <Badge tone="new">Nouveau</Badge>
                  </span>
                )}
              </span>
              <span className="block px-3 pb-3 pt-2.5">
                <span className="font-display block truncate text-[14.5px] font-bold leading-tight tracking-[-0.02em] text-ink">
                  {product.name}
                </span>
                <span className="mt-2.5 flex items-center justify-between gap-2">
                  <PriceTag
                    cents={product.fromPrice}
                    from={product.variants.length > 0}
                    size="sm"
                    mono={prixMono}
                  />
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-pill bg-accent text-onaccent"
                  >
                    {qty > 0 ? (
                      <span className="text-[13px] font-extrabold tabular-nums">{qty}</span>
                    ) : (
                      <Icon name="plus" size={17} stroke={2.8} />
                    )}
                  </span>
                </span>
                {/* Même règle que sur la carte : le contenu porte le nom et le
                    prix, le complément n'ajoute que ce que la pastille dit en
                    image. L'`aria-label` d'avant les effaçait tous les deux —
                    ni le « dès » d'un produit à variantes, ni la quantité déjà
                    au panier n'étaient annoncés. */}
                <span className="sr-only">
                  {qty > 0 ? `, ${qty} déjà au panier` : ""}
                  {disabled ? "" : product.configurable ? ", composer" : ", ajouter au panier"}
                </span>
              </span>
            </Tap>
          );
        })}
      </Rail>
    </section>
  );
}
