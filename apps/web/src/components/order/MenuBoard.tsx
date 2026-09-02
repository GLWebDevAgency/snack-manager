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
  prixMono,
}: {
  categories: MenuCategory[];
  onPick: (product: MenuProduct) => void;
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
        className="sticky z-30 -mx-4 border-b border-ink/6 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur-md"
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
            className="h-11 w-full rounded-pill border border-ink/8 bg-surface2 pl-10 pr-10 text-[15px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut/75 focus:border-accent"
          />
          {query && (
            <Tap
              onClick={() => setQuery("")}
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
                    // Onglet actif : filet blanc, pas d'aplat de marque. L'accent
                    // reste réservé aux boutons d'ajout (DA §3) — sinon vingt
                    // pastilles d'ajout et un onglet doré se disputent l'œil.
                    "flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-4 text-[13.5px] font-bold",
                    on
                      ? "border-ink/45 bg-surface2 text-ink"
                      : "border-transparent bg-surface2 text-mut hover:text-ink",
                  )}
                >
                  {category.name}
                  <span
                    className={cx(
                      "text-[11px] font-extrabold tabular-nums",
                      on ? "text-mut" : "text-ink/30",
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
            {/* Aucun point de rupture : la grille se remplit de colonnes de
                17 rem minimum — une sur téléphone, trois ou quatre sur un
                écran large — et `min(100%,…)` empêche la colonne d'être plus
                large que la place disponible, donc jamais de barre
                horizontale. Une seule colonne de cartes au milieu d'un écran
                de bureau ressemblait à une capture de téléphone sur un mur. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-2.5">
              {category.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  qty={inCart[product.id] ?? 0}
                  disabled={disabled}
                  prixMono={prixMono}
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
 * Carte produit — la brique la plus vue de tout le produit.
 *
 * Trois quarts de la surface sont donnés au couple **visuel + prix** : c'est un
 * site de restauration, l'appétit passe avant la mise en page. Le plateau fait
 * 92 px (contre 68 auparavant) et reçoit le visuel détouré en `contain` ; le
 * prix descend au pied de la carte, sur la même ligne que le bouton d'ajout,
 * comme dans la maquette. Un produit sans photo garde exactement le même
 * gabarit — le monogramme occupe le plateau, la liste ne « saute » pas.
 */
function ProductCard({
  product,
  qty,
  disabled,
  prixMono,
  onPick,
}: {
  product: MenuProduct;
  qty: number;
  disabled: boolean;
  prixMono: boolean;
  onPick: () => void;
}) {
  const unavailable = product.outOfStock;
  const clickable = !unavailable && !disabled;

  return (
    <article
      className={cx(
        // `@container` sur la CARTE : c'est SA colonne qu'elle interroge,
        // pas la largeur de la grille — deux cartes de la même page peuvent
        // ainsi tenir des dispositions différentes si la grille le veut.
        "@container relative h-full overflow-hidden rounded-panel border bg-surface bg-[linear-gradient(180deg,var(--cf-surface-3),transparent_90px)] shadow-card transition-colors duration-fast ease-sm",
        qty > 0 ? "border-accent/45" : "border-ink/6",
        unavailable && "opacity-55",
      )}
    >
      <Tap
        onClick={onPick}
        disabled={!clickable}
        aria-label={`${product.name}${product.configurable ? " — composer" : " — ajouter au panier"}`}
        /* La disposition suit la COLONNE, pas l'écran — et le seuil vaut
           EXACTEMENT le minimum de piste de la grille (17 rem). Les deux
           chiffres doivent rester égaux : plus haut, la grille fabriquerait
           des colonnes que la disposition en ligne tient très bien mais que
           la carte refuserait ; plus bas, elle se serrerait dans une colonne
           trop étroite pour le nom du plat. Une colonne ne peut donc jamais
           être plus étroite que ce que la ligne demande — et le seul cas qui
           bascule est `min(100%, 17rem)`, quand la place manque vraiment. */
        className={cx(
          "flex h-full w-full flex-col items-stretch gap-3 p-3 text-left @[17rem]:flex-row @[17rem]:gap-3.5",
          !clickable && "cursor-default active:scale-100",
        )}
      >
        <Plate
          photoUrl={product.photoUrl}
          name={product.name}
          mono={28}
          pad="p-[3%]"
          /* Plateau LÉGÈREMENT paysage : les visuels détourés de la carte le
             sont presque tous (582×395, 665×329…). Dans un carré, ils
             s'inscrivent par la largeur et laissent deux bandes vides. */
          className="h-[136px] w-full @[17rem]:h-[92px] @[17rem]:w-[104px]"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <h3 className="font-display min-w-0 flex-1 text-[16.5px] font-bold leading-tight tracking-[-0.02em] text-ink">
              {product.name}
            </h3>
            {product.isNew && !unavailable && (
              <span className="mt-px">
                <Badge tone="new">Nouveau</Badge>
              </span>
            )}
          </div>

          {product.description && (
            <p className="line-clamp-2 text-[13px] leading-snug text-mut">
              {product.description}
            </p>
          )}

          {/* Pied : le prix et l'action se lisent sur la même ligne — l'œil
              n'a jamais à traverser la carte pour savoir combien ça coûte. */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            {unavailable ? (
              <Badge tone="out">Bientôt</Badge>
            ) : (
              // Pas de mention « à composer » : sur cette carte, presque tout
              // se compose — la pastille à curseurs le dit déjà, un libellé
              // répété vingt fois n'informe plus, il encombre.
              <PriceTag
                cents={product.fromPrice}
                from={product.variants.length > 0}
                mono={prixMono}
              />
            )}
            {clickable && <AddButton qty={qty} compose={product.configurable} />}
          </div>
        </div>
      </Tap>

      {/* Prix lisible par les moteurs (microdonnées portées par le JSON-LD). */}
      <span className="sr-only">
        {product.name} — {euros(product.fromPrice)}
      </span>
    </article>
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
  prixMono,
  onPick,
  onBrowse,
}: {
  products: MenuProduct[];
  inCart: Record<string, number>;
  disabled: boolean;
  /** Paire typographique du masque — obligatoire, comme sur `MenuBoard`. */
  prixMono: boolean;
  onPick: (product: MenuProduct) => void;
  onBrowse: () => void;
}) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby="incontournables" className="pt-8">
      <SectionHead
        id="incontournables"
        title="Les incontournables"
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
                "w-[172px] shrink-0 overflow-hidden rounded-panel border bg-surface text-left shadow-card",
                qty > 0 ? "border-accent/45" : "border-ink/6",
              )}
            >
              {/* Le visuel occupe la moitié de la carte : c'est le rail qui
                  doit donner faim, pas le convaincre de lire. */}
              <span className="relative block">
                <Plate
                  photoUrl={product.photoUrl}
                  name={product.name}
                  mono={46}
                  pad="p-[9%]"
                  radius="rounded-none"
                  className="h-[130px] w-full border-0 border-b border-ink/6"
                />
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
              </span>
            </Tap>
          );
        })}
      </Rail>
    </section>
  );
}
