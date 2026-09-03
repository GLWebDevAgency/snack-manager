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
  const tabsRef = useRef<HTMLElement>(null);
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
            className="h-11 w-full rounded-pill border border-ink/8 bg-surface2 pl-10 pr-10 text-[15px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut focus:border-focus"
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
        {!query && categories.length > 1 && (
          <nav
            ref={tabsRef}
            aria-label="Catégories de la carte"
            className="sm-rail sm-fade-x -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-1"
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
            {/* Aucun point de rupture : la grille se remplit de colonnes
                d'une carte de large au minimum (`--container-carte`, déclarée
                dans `globals.css`) — une sur téléphone, trois ou quatre sur un
                écran large — et `min(100%,…)` empêche la colonne d'être plus
                large que la place disponible, donc jamais de barre
                horizontale. Une seule colonne de cartes au milieu d'un écran
                de bureau ressemblait à une capture de téléphone sur un mur.

                La piste LIT le jeton, elle ne le recopie pas : c'est le même
                chiffre que le seuil `@carte:` de la carte, et les deux doivent
                rester égaux (voir `ProductCard`). */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--container-carte)),1fr))] gap-2.5">
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
        //
        // ═══ LE FILET EST UN ANNEAU, ET C'EST LA CONDITION DU SEUIL ═══
        //
        // Une requête de conteneur mesure la boîte de CONTENU. Avec une
        // `border` de 1 px de chaque côté, une piste de 17 rem donnait un
        // conteneur de 17 rem − 2 px : la carte retombait en colonne alors
        // que la piste satisfaisait pile le minimum de la grille — une bande
        // de ~6 px de largeur de fenêtre par nombre de colonnes où trois
        // cartes serrées s'empilaient sans raison visible. `ring-inset` peint
        // exactement le même filet en `box-shadow`, hors du flux : la boîte de
        // contenu vaut désormais la piste, et les deux 17 rem sont vraiment
        // égaux.
        "@container relative h-full overflow-hidden rounded-panel ring-1 ring-inset bg-surface bg-[linear-gradient(180deg,var(--cf-surface-3),transparent_90px)] shadow-card transition-colors duration-fast ease-sm",
        qty > 0 ? "ring-accent/45" : "ring-ink/6",
        unavailable && "opacity-55",
      )}
    >
      <Tap
        onClick={onPick}
        disabled={!clickable}
        /* La disposition suit la COLONNE, pas l'écran — et le seuil vaut
           EXACTEMENT le minimum de piste de la grille, maintenant que le filet
           ne mange plus la boîte de contenu (voir ci-dessus). Les deux
           chiffres ne peuvent plus diverger : `@carte:` et la piste lisent le
           même `--container-carte`. Plus haut, la grille fabriquerait des
           colonnes que la disposition en ligne tient très bien mais que la
           carte refuserait ; plus bas, elle se serrerait dans une colonne trop
           étroite pour le nom du plat. */
        className={cx(
          "flex h-full w-full flex-col items-stretch gap-3 p-3 text-left @carte:flex-row @carte:gap-3.5",
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
          className="h-[136px] w-full @carte:h-[92px] @carte:w-[104px]"
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

          {/*
            LE NOM ACCESSIBLE VIENT DU CONTENU, PAS D'UN `aria-label`.

            La carte portait `aria-label="{nom} — ajouter au panier"`, qui
            REMPLACE tout ce qu'elle contient : le prix, le « dès », la
            description, le badge « Nouveau » et la quantité déjà au panier
            n'étaient JAMAIS lus — `AddButton` est `aria-hidden`, et le
            `sr-only` posé hors du bouton ne redisait que le nom et le prix.
            Sans `aria-label`, le lecteur d'écran annonce la carte telle
            qu'elle est écrite ; ce complément n'ajoute donc que les deux
            informations que la pastille porte en image.
          */}
          <span className="sr-only">
            {qty > 0 ? `, ${qty} déjà au panier` : ""}
            {clickable
              ? product.configurable
                ? ", composer"
                : ", ajouter au panier"
              : ""}
          </span>
        </div>
      </Tap>
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
                "relative w-[172px] shrink-0 overflow-hidden rounded-panel border bg-surface text-left shadow-card",
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
