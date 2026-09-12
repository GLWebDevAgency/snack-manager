"use client";

/** Restaurant storefront and checkout shared by site, embed and the explicit
 * demo. Navigation keeps the live cart/recovery controllers mounted. The
 * embed retains its host resize protocol and guest-only account boundary. */

import { storefrontHighlights } from "./highlights";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSMTabTransition } from "@/components/ui/SMTabBar";
import { OrderHeader, OrderHero } from "./OrderHeader";
import { OrderTabBar } from "./OrderTabBar";
import { customerAppDestinations, customerAppViewFromPath, type CustomerAppView } from "@sm/client-core";
import { Recommendations } from "./Recommendations";
import { applyDevicePreferences } from "./device-preferences";
import { useDevicePreferences } from "./device-preferences-store";
import { DevicePreferencesSheet } from "../customer-account/DevicePreferencesSheet";
import { usePathname } from "next/navigation";
import { OrderInstall } from "./OrderInstall";
import { navigateOrderView, useEmbeddedOrderView, useOrderInstallationRequest, useOrderNavigationLock } from "./order-navigation";
import "./order-v2.css";
import { logoPour, TYPE_PAIRS, WebsiteUrlSchema, type LoyaltyPublicProgram } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon, Stars, Verrou, verrouPour } from "@/components/ui";
import { useMasqueDeCapture } from "@/components/masque/masqueDeCapture";
import { classesPolices } from "@/components/masque/polices";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { networkApi, type MenuCategory, type MenuProduct, type OrderingApi, type Site } from "./api";
import {
  setVariant,
  draftFromLine,
  draftToLine,
  indexMenu,
  newDraft,
  useCart,
  type CartLine,
  type Draft,
} from "./cart";
import {
  cityOf,
  nextOpeningLabel,
  telHref,
  weekSchedule,
} from "./helpers";
import { Checkout } from "./Checkout";
import { DeviceOrdersSheet } from "./DeviceOrdersSheet";
import { CustomerAccountPage } from "../customer-account/CustomerAccountPage";
import { CustomerOrdersPage } from "../customer-account/CustomerOrdersPage";
import { CustomerServiceNotice, type CustomerUnavailableService } from "../customer-account/CustomerServiceNotice";
import { LoyaltyCardApp } from "../loyalty/LoyaltyCardApp";
import { useCheckoutRecovery } from "./useCheckoutRecovery";
import { FideliteVitrine } from "./FideliteVitrine";
import type { VitrineFidelite } from "./fidelite";
import { armeFunnel, jalonFunnel } from "./funnel";
import { altDuHero, cadrageDuHero } from "./hero";
import { Highlights, MenuBoard } from "./MenuBoard";
import { ProductSheet } from "./ProductSheet";
import { apparenceStripeDe } from "./StripeCard";
import {
  Badge,
  Banner,
  BrandMark,
  Dot,
  Glyph,
  Money,
  Prix,
  Surface,
  Tap,
} from "./primitives";

/** Protocole postMessage avec le chargeur `w.js`. */
const WIDGET_ORIGIN_TAG = "snackmanager";

/** Hauteur de l’en-tête collant de l’embed — décale les éléments collants. */
const EMBED_HEADER_H = 58;

/**
 * La même barre AVEC un verrou : le sous-titre passe SOUS le bloc d’identité
 * au lieu d’être à côté de la tuile, donc une ligne de plus.
 *
 * Deux constantes plutôt qu’une mesure : ce nombre ne sert qu’à décaler le
 * rail de catégories collant, et le sens de l’erreur est asymétrique — trop
 * BAS, le rail glisserait sous l’en-tête ; trop haut, il reste un peu d’air.
 * Si le fichier du verrou est mort, `Verrou` replie sur la tuile et c’est ce
 * peu d’air qu’on voit : le défaut visible reste du bon côté.
 */
const EMBED_HEADER_VERROU_H = 76;

export function Storefront({
  site,
  mode = "site",
  showClose = false,
  api = networkApi,
  demo = false,
  loyalty = null,
  loyaltyCatalog,
  unavailableService,
}: {
  site: Site;
  mode?: "site" | "embed";
  /**
   * Croix de fermeture dans l’en-tête de l’embed. Désactivée par défaut : quand
   * le widget `w.js` pilote l’iframe, c’est LUI qui dessine la croix — deux
   * croix superposées font amateur. Un intégrateur qui pose l’iframe à la main
   * peut la réclamer avec `?close=1` et écouter le message `close`.
   */
  showClose?: boolean;
  /**
   * Client des routes publiques. Le RÉSEAU par défaut : seule la route de
   * démonstration (`/r/demo?demo=1`) en passe un autre, branché sur une
   * fixture en mémoire. Aucune page de restaurant ne peut le faire par
   * accident — il faut le donner explicitement.
   */
  api?: OrderingApi;
  /** Démonstration : bandeau d’avertissement et parcours sans paiement réel. */
  demo?: boolean;
  /**
   * Le programme de fidélité du restaurant, RÉSUMÉ — `null` pour l’immense
   * majorité des cartes, qui n’en ont pas.
   *
   * Il ne vient pas de la charge `/site`, qui n’en porte aucune trace : c’est
   * la page serveur qui appelle le catalogue public en parallèle et n’en
   * descend ici que cinq champs (voir `fidelite.ts`). L’embed ne le reçoit
   * jamais — il est délibérément amputé de tout ce qui n’est pas la carte et
   * le tunnel.
   */
  loyalty?: VitrineFidelite | null;
  loyaltyCatalog?: LoyaltyPublicProgram;
  unavailableService?: CustomerUnavailableService;
}) {
  const embed = mode === "embed";
  /*
   * `?masque=<direction>` — LEVIER RÉSERVÉ À LA MATRICE DE CAPTURES
   * (`scripts/capture-masque.mjs`). La démonstration ne porte qu'une seule
   * marque en fixture (Nuit) ; prouver les six directions exigerait sinon six
   * tenants. `useMasqueDeCapture` lit `?masque=` par `useSyncExternalStore` —
   * voir sa documentation pour le piège d'hydratation que ce choix évite.
   * Sans le paramètre (ou hors démo), elle rend `null` : aucun changement
   * pour la page d'un vrai restaurant.
   */
  const masqueCapture = useMasqueDeCapture(demo);
  const brand = masqueCapture ?? site.tenant.brand;
  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200 (~0,5 ms). Sans ce
   * `useMemo`, la facture était payée à CHAQUE rendu de la racine — donc à
   * chaque frappe dans le tunnel et à chaque tick du suivi — pour un objet
   * identique. Sa référence sert aussi de `style` : la recréer forçait React
   * à repeindre tout le sous-arbre.
   */
  const masque = useMemo(() => styleDuMasque(brand), [brand]);
  /*
   * `prixMono` est LU ICI, une seule fois, puis descendu en propriété. Deux
   * paires typographiques du masque sur dix posent les prix en chasse fixe :
   * laisser chaque composant relire la marque disperserait la règle dans dix
   * fichiers, où elle finirait par diverger.
   *
   * Lu dans TYPE_PAIRS et non via `resoudreMarque()` : `styleDuMasque()`
   * résout déjà la marque au-dessus, et refaire tous les mélanges de palette
   * pour un booléen serait payer une palette pour lire une police.
   */
  const { prixMono } = TYPE_PAIRS[brand.type.pair];
  /*
   * LE LOGO VIENT DU MASQUE, PAS DU CHAMP PLAT.
   *
   * `site.tenant.logoUrl` est un DÉRIVÉ de compatibilité (`logoUrlDe`) : il
   * rend toujours la déclinaison sombre en premier, quel que soit le fond
   * réellement peint. Un logo dessiné pour fond sombre disparaissait donc sur
   * Brasserie ou Soleil — précisément ce que les quatre emplacements de
   * `brand.logo` existent pour éviter. `logoPour()` suit le mode du masque,
   * puis retombe sur l'autre déclinaison, puis sur l'autre format.
   */
  const logoMarque = logoPour(brand, "mark");
  /*
   * LE VERROU — « logo avec le nom », posé ou non.
   *
   * `verrouPour` et non `logoPour(brand, "lockup")` : ce dernier retombe sur
   * la MARQUE quand aucun verrou n'est posé, et un pictogramme carré servi à
   * la place d'un verrou effacerait le nom écrit de l'en-tête. Rien de posé,
   * rien ne change — voir `components/ui/verrou`.
   */
  const verrouMarque = verrouPour(brand);
  /*
   * L'habillage du champ de carte est MÉMORISÉ : sa référence entre dans les
   * dépendances de l'effet qui monte le Payment Element. Un objet neuf à
   * chaque rendu le démonterait et le remonterait — le client verrait son
   * numéro de carte s'effacer sous ses doigts.
   */
  const stripeApparence = useMemo(
    // Le masque DÉJÀ résolu est réutilisé : `apparenceStripeDe` rappelait
    // `resoudreMarque()` juste après `styleDuMasque()`, soit deux palettes
    // complètes par marque et par rendu, pour cinq valeurs qui étaient déjà là.
    () => apparenceStripeDe(masque, brand),
    [masque, brand],
  );
  const [catalogue, setCatalogue] = useState({ source: site.categories, categories: site.categories });
  if (catalogue.source !== site.categories) setCatalogue({ source: site.categories, categories: site.categories });
  const categories = catalogue.source === site.categories ? catalogue.categories : site.categories;
  const updateCatalogue = useCallback((next: MenuCategory[]) => setCatalogue({ source: site.categories, categories: next }), [site.categories]);
  const index = useMemo(() => indexMenu(categories), [categories]);
  const cart = useCart(site.tenant.slug, index);
  const recovery = useCheckoutRecovery(site.tenant.slug, demo, !embed);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tunnel, setTunnel] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [ordersLocked, setNavigationLocked] = useState(false);
  const [privateOrdersLocked, setPrivateOrdersLocked] = useState(false);
  const [accountLocked, setAccountLocked] = useState(false);
  const [legacyLocked, setLegacyLocked] = useState(false);
  const navigationLocked = ordersLocked || privateOrdersLocked || accountLocked || legacyLocked;
  useOrderNavigationLock(navigationLocked);
  const devicePreferences = useDevicePreferences(site.tenant.slug, !demo);
  const pathname = usePathname();
  const panelId = useId();
  const embeddedView = useEmbeddedOrderView();
  const installRequested = useOrderInstallationRequest();
  const destinations = customerAppDestinations({ ordering: true, loyalty: !embed && !!loyaltyCatalog, account: !embed && !demo });
  const requestedTab = embed || demo ? embeddedView : customerAppViewFromPath(pathname ?? "");
  const activeTab = destinations.some(item => item.key === requestedTab) ? requestedTab : "menu";
  function setActiveTab(key: string) {
    if (navigationLocked || !destinations.some(item => item.key === key)) return;
    navigateOrderView(site.tenant.slug, key as CustomerAppView, embed || demo);
  }
  const [headerHeight, setHeaderHeight] = useState(72);
  const transition = useSMTabTransition({ activeKey: activeTab, onSelect: setActiveTab });
  const rootRef = useRef<HTMLDivElement>(null);

  // ── L'entonnoir : la visite au montage, le panier au premier article. ──
  // (Les deux jalons suivants partent du tunnel lui-même — voir Checkout.)
  useEffect(() => {
    armeFunnel(site.tenant.slug, mode, demo);
    jalonFunnel("visite");
  }, [site.tenant.slug, mode, demo]);
  useEffect(() => {
    if (cart.lines.length > 0) jalonFunnel("panier");
  }, [cart.lines.length]);

  const paused = site.ordering.paused;
  const blocked = paused || categories.length === 0;

  const inCart = useMemo(
    () =>
      cart.lines.reduce<Record<string, number>>((acc, line) => {
        acc[line.productId] = (acc[line.productId] ?? 0) + line.qty;
        return acc;
      }, {}),
    [cart.lines],
  );

  // La sélection du gérant est partagée avec les scènes TV.
  const highlights = useMemo(() => storefrontHighlights(categories, site.featuredConfigured), [categories, site.featuredConfigured]);

  // ── Lignes écartées à la réconciliation : on l’annonce, on ne l’escamote pas ──
  const notice =
    cart.dropped.length === 0
      ? null
      : cart.dropped.length === 1
        ? `« ${cart.dropped[0]} » n’est plus disponible avec ces choix et a été retiré de votre panier.`
        : `${cart.dropped.length} articles ne sont plus disponibles avec ces choix et ont été retirés de votre panier.`;

  // ── Embed : hauteur remontée à l’hôte, fermeture déléguée au chargeur ──
  useEffect(() => {
    if (!embed || typeof window === "undefined" || window.parent === window) return;
    const post = (payload: Record<string, unknown>) =>
      window.parent.postMessage({ source: WIDGET_ORIGIN_TAG, ...payload }, "*");
    post({ type: "ready" });
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      post({ type: "resize", height: Math.ceil(node.getBoundingClientRect().height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [embed]);

  function closeEmbed() {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage({ source: WIDGET_ORIGIN_TAG, type: "close" }, "*");
  }

  // ── Ouverture de la fiche produit ──
  function pick(product: MenuProduct, variantKey?: string) {
    if (blocked) return;
    // Produit sans option : ajout direct — un appui suffit, pas de feuille.
    if (!product.configurable) {
      const existing = cart.lines.find(
        (l) => l.productId === product.id && l.options.length === 0 && !l.note,
      );
      if (existing) cart.setQty(existing.lineId, existing.qty + 1);
      else cart.upsert(draftToLine(newDraft(product)));
      return;
    }
    const draft = variantKey ? setVariant(newDraft(product), variantKey) : newDraft(product);
    setDraft(applyDevicePreferences(draft, devicePreferences.preferences));
  }

  /** « Modifier » depuis le panier : la fiche rouvre pré-remplie. */
  function editLine(line: CartLine) {
    const product = index.get(line.productId);
    if (!product) return;
    setDraft(draftFromLine(line, product));
  }

  function scrollToMenu() {
    setTunnel(false);
    setActiveTab("menu");
    requestAnimationFrame(() => document.getElementById("carte")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
  }

  const cityName = cityOf(site.tenant.address);

  // La photo d’accueil choisie par le restaurateur prime sur les produits à l’affiche.
  // Le cadrage et le texte alternatif viennent de sa médiathèque.
  const hero = brand.hero ?? highlights.find(product => product.photoUrl)?.photoUrl ?? null;
  const heroCadrage = useMemo(() => cadrageDuHero(hero, site.medias), [hero, site.medias]);
  const heroAlt = useMemo(() => altDuHero(hero, site.medias), [hero, site.medias]);
  const deviceOrders = <DeviceOrdersSheet open presentation={embed ? "page" : "embedded"} slug={site.tenant.slug} tenantName={site.tenant.name} embed={embed}
    onClose={() => transition.selectTab("menu")} onCatalogVerified={updateCatalogue} onNavigationLockedChange={setNavigationLocked}
    onReordered={() => setTunnel(true)} />;

  return (
    <div
      ref={rootRef}
      onClickCapture={event => {
        // Existing public links enter the same shell without discarding a cart
        // or recovery controller. Modified clicks still open their real route.
        if (embed || demo || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
        if (!link || link.target || link.hasAttribute("download")) return;
        const url = new URL(link.href, window.location.href);
        const base = `/r/${encodeURIComponent(site.tenant.slug)}`;
        if (url.origin !== window.location.origin || url.hash || url.search ||
          !(url.pathname === base || destinations.some(item => url.pathname === `${base}/${item.suffix}`))) return;
        event.preventDefault();
        if (!navigationLocked) {
          setTunnel(false);
          transition.selectTab(customerAppViewFromPath(url.pathname));
        }
      }}
      style={masque}
      className={cx(
        classesPolices,
        // `clip` et non `hidden` : `overflow-x: hidden` force `overflow-y:
        // auto` et fait de cette racine un conteneur de défilement — les
        // barres collantes de la carte cesseraient alors de coller.
        "sm-order font-body min-h-dvh overflow-x-clip bg-bg text-ink",
        // Dégage la barre de panier flottante.
        cart.count > 0 || recovery.active || recovery.last ? "sm-order-with-cart" : "",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={brand} />
      {demo && <DemoRibbon />}

      {embed ? (
        <EmbedHeader
          name={site.tenant.name}
          logoUrl={logoMarque}
          verrouUrl={verrouMarque}
          openNow={site.openNow}
          onClose={showClose ? closeEmbed : null}
        />
      ) : (
        <OrderHeader onHeightChange={setHeaderHeight} site={site} logoUrl={logoMarque} lockupUrl={verrouMarque}
          account={!demo && <Tap className="sm-order-icon" aria-label="Mon compte" disabled={navigationLocked}
            onClick={() => transition.selectTab("account")}><Icon name="user" size={18} /></Tap>} />
      )}

      {/* Une seule borne, jamais un point de rupture : la colonne suit la
          fenêtre et la grille de la carte s'y remplit d'elle-même. */}
      <main className="mx-auto w-full max-w-[1080px] px-4">
        {unavailableService && <CustomerServiceNotice service={unavailableService} disabled={navigationLocked} />}
        <OrderInstall key={site.tenant.slug} slug={site.tenant.slug} name={site.tenant.name} disabled={demo || embed}
          eligible={!tunnel && (installRequested || recovery.active?.state === "received" || !!recovery.last)} />
        <div {...transition.contentProps} id={panelId} role="tabpanel" tabIndex={0}
          aria-label={destinations.find(item => item.key === activeTab)?.label ?? "Carte"}>
        {(activeTab === "account" || activeTab === "loyalty") && !embed && !demo && <CustomerAccountPage
          slug={site.tenant.slug} restaurantName={site.tenant.name} mode={brand.mode} loyaltyHref={loyaltyCatalog ? loyalty?.chemin : undefined}
          section={activeTab === "loyalty" ? "loyalty" : "profile"} onCatalogVerified={updateCatalogue}
          onBack={() => transition.selectTab(activeTab === "loyalty" ? "account" : "menu")}
          onLoyalty={loyaltyCatalog ? () => transition.selectTab("loyalty") : undefined}
          onOrders={() => transition.selectTab("orders")} onDevicePreferences={() => setPreferencesOpen(true)} onNavigationLockedChange={setAccountLocked} />}
        {activeTab === "loyalty" && loyaltyCatalog && <LoyaltyCardApp catalog={loyaltyCatalog} embedded legacyOnly
          onNavigationLockedChange={setLegacyLocked} />}
        {!embed && activeTab === "menu" && <OrderHero site={site} tagline={brand.tagline} taglineSub={brand.taglineSub} src={hero} position={heroCadrage} alt={heroAlt} onOrder={scrollToMenu} />}
        {activeTab === "orders" && !demo && (embed ? deviceOrders : <CustomerOrdersPage slug={site.tenant.slug}
          restaurantName={site.tenant.name} mode={brand.mode} deviceOrders={deviceOrders} navigationLocked={ordersLocked}
          onNavigationLockedChange={setPrivateOrdersLocked} onCatalogVerified={updateCatalogue} onReordered={() => setTunnel(true)}
          onAccount={() => transition.selectTab("account")} onBack={() => transition.selectTab("menu")} />)}
        {activeTab === "orders" && <div className="sm-order-orders-access">
          {demo ? <div className="sm-order-tab-page"><h2>Mes commandes</h2><p>La démonstration conserve le suivi dans le panier pendant cette visite.</p></div>
            : <><Tap className="sm-order-entry" onClick={() => setPreferencesOpen(true)} disabled={navigationLocked}>
                <Icon name="gear" size={22} /><span><b>Préférences de cet appareil</b><small>Coordonnées mémorisées et choix habituels</small></span><Icon name="arrow" size={18} />
              </Tap></>}
        </div>}
        <div hidden={activeTab !== "menu" && activeTab !== "search"}>
        {cart.persistenceError && <div className="pt-4">
          <Banner tone="alert" icon="bell" title="Panier non sauvegardé">{cart.persistenceError}</Banner>
        </div>}
        {notice && (
          <div className="pt-4">
            <Banner
              tone="prep"
              icon="bell"
              title="Panier mis à jour"
              action={
                <Tap
                  onClick={cart.clearDropped}
                  aria-label="Masquer"
                  className="grid size-11 place-items-center rounded-pill text-mut hover:text-ink"
                >
                  <Icon name="close" size={14} />
                </Tap>
              }
            >
              {notice}
            </Banner>
          </div>
        )}

        {paused && <PauseCard site={site} />}

        {!embed && activeTab === "menu" && (
          <Highlights
            products={highlights}
            inCart={inCart}
            disabled={blocked}
            prixMono={prixMono}
            onPick={pick}
            onBrowse={scrollToMenu}
          />
        )}

        {/*
          LA CARTE DE FIDÉLITÉ S'ATTEINT D'ICI — entre les incontournables et
          la carte, et nulle part ailleurs.

          Trois places étaient possibles ; celle-ci est la seule qui ne coûte
          rien au parcours. Dans l'en-tête, la bande repoussait le premier plat
          sous la ligne de flottaison (mesuré : +72 px sur un téléphone de
          390 px, sur un premier plateau déjà à 689 px du haut) — or le client
          vient commander. Dans le tunnel, elle serait une distraction au pire
          moment. Ici, elle occupe la respiration qui sépare le rail des
          incontournables du menu complet : quelqu'un qui descend a fini de
          regarder les photos et n'a pas encore commencé à choisir.

          Jamais dans l'embed : il est posé DANS le site du restaurateur et
          n'emporte ni avis, ni incontournables, ni mentions — la carte et le
          tunnel, rien d'autre.
        */}
        {!embed && activeTab === "menu" && loyalty && (
          <FideliteVitrine slug={site.tenant.slug} resume={loyalty} />
        )}

        <section id="carte" style={{ scrollMarginTop: embed ? EMBED_HEADER_H : headerHeight }}>
          {categories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
              <span className="grid size-11 place-items-center rounded-card bg-surface2 text-mut">
                <Icon name="grid" size={20} />
              </span>
              <p className="text-[15px] font-bold text-ink">
                La carte arrive très bientôt
              </p>
              <p className="text-[13px] text-mut">
                Le restaurant termine la mise en ligne de ses produits.
              </p>
            </div>
          ) : (
            <MenuBoard
              categories={categories}
              search={activeTab === "search"}
              onPick={pick}
              inCart={inCart}
              disabled={blocked}
              prixMono={prixMono}
              stickyTop={embed ? (verrouMarque ? EMBED_HEADER_VERROU_H : EMBED_HEADER_H) : headerHeight}
            />
          )}
        </section>

        {!embed && activeTab === "menu" && (
          <>
            {/* Sur grand écran, avis et infos pratiques se font face plutôt que
                de s’empiler sur 1 080 px de large. */}
            <div className="grid gap-x-6 lg:grid-cols-2 lg:items-start">
              {site.reviews.count > 0 && <Reviews site={site} />}
              <Practical site={site} cityName={cityName} />
            </div>
            <LegalFooter site={site} cityName={cityName} prixMono={prixMono} />
          </>
        )}
        </div>
        </div>
      </main>

      {/* ── Barre de panier flottante ── */}
      {(cart.count > 0 || recovery.active || recovery.last) && !tunnel && activeTab !== "account" && activeTab !== "loyalty" && (
        <div className="sm-order-cart">
          <div className="mx-auto max-w-[560px]">
            <Tap
              disabled={navigationLocked}
              onClick={() => { if (!navigationLocked) setTunnel(true); }}
              className="flex w-full animate-pop items-center gap-3 rounded-pill bg-accent px-3.5 py-3 text-onaccent shadow-deep"
            >
              {/*
                LA BULLE N'A PLUS D'APLAT — et c'est ce qui la rend juste dans
                les deux modes.

                Elle valait `bg-bg/25` : le fond de PAGE, posé sur l'accent.
                En mode sombre il l'assombrissait, en mode clair il
                l'ÉCLAIRCISSAIT — la sémantique s'inversait avec la peau du
                restaurant, et le chiffre `text-onaccent` tombait à 3,04:1 sur
                Marché, 3,38 sur Atelier. Un simple filet d'`onaccent` sur le
                fond du bouton laisse le couple onAccent/accent intact, celui
                que le résolveur garantit sur les six directions.
              */}
              <span className="sm-order-cart-count grid size-10 shrink-0 place-items-center rounded-pill border border-onaccent/35 text-[15px] font-extrabold tabular-nums">
                {recovery.active ? <Icon name="clock" size={16} /> : cart.count || <Icon name="clock" size={16} />}
              </span>
              <span className="flex-1 text-left text-[15px] font-extrabold uppercase tracking-[0.02em]">
                {recovery.active ? "Ma commande en cours" : cart.count ? "Voir mon panier" : "Retrouver ma commande"}
              </span>
              {!recovery.active && cart.count > 0 && <Money cents={cart.subtotal} mono={prixMono} className="text-[16px]" />}
              <Icon name="arrow" size={16} stroke={2.4} className="opacity-70" />
            </Tap>
          </div>
        </div>
      )}

      <div><OrderTabBar slug={site.tenant.slug} activeKey={activeTab} panelId={panelId} theme={brand.mode} hidden={tunnel}
        minimizable={!draft && !preferencesOpen} disabled={navigationLocked} loyaltyHref={!embed && (loyaltyCatalog || demo) ? loyalty?.chemin : null}
        accountEnabled={!embed && !demo} demo={demo} onSelect={key => transition.selectTab(key as CustomerAppView)} /></div>

      <ProductSheet
        draft={draft}
        recommendations={draft && !draft.lineId ? <Recommendations categories={categories} lines={cart.lines}
          onPick={pick} prixMono={prixMono} excludeProductId={draft.product.id} disabled={blocked} /> : null}
        blocked={blocked}
        prixMono={prixMono}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSubmit={(line) => {
          cart.upsert(line);
          setDraft(null);
        }}
      />

      {!demo && <DevicePreferencesSheet open={preferencesOpen} slug={site.tenant.slug} tenantName={site.tenant.name} categories={categories}
        loyaltyEnabled={!!loyalty} onClose={() => setPreferencesOpen(false)} />}

      <Checkout
        open={tunnel}
        recommendations={<Recommendations categories={categories} lines={cart.lines} onPick={pick} prixMono={prixMono} disabled={blocked} />}
        recovery={recovery}
        api={api}
        demo={demo}
        customerAccountEnabled={!embed}
        slug={site.tenant.slug}
        tenantName={site.tenant.name}
        tenantAddress={site.tenant.address}
        stripeApparence={stripeApparence}
        mode={brand.mode}
        prixMono={prixMono}
        cart={cart}
        paused={paused}
        pauseMessage={site.ordering.message}
        initialSlots={site.slots}
        delivery={site.delivery}
        embed={embed}
        loyalty={loyalty}
        onClose={() => setTunnel(false)}
        onBrowse={scrollToMenu}
        onEditLine={editLine}
      />
    </div>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Bandeau de démonstration.
 *
 * Le visiteur doit savoir en une seconde que « Le Comptoir » n’existe pas, que
 * les avis sont écrits pour l’exercice et que sa commande ne partira dans
 * aucune cuisine. Un bandeau discret mais permanent, jamais une modale : on ne
 * met pas une porte devant la vitrine qu’on veut faire visiter.
 */
function DemoRibbon() {
  return (
    <div className="border-b border-accent/25 bg-accentwash">
      <p className="mx-auto flex w-full max-w-[1080px] items-center justify-center gap-2 px-4 py-2 text-center text-[12px] font-semibold leading-snug text-mut">
        <Dot tone="prep" />
        <span>
          <span className="font-extrabold uppercase tracking-[0.14em] text-ink">
            Démonstration
          </span>{" "}
          · restaurant fictif, tout se passe dans votre navigateur — aucune
          commande n’est transmise, aucun paiement n’est encaissé.
        </span>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// En-têtes
// ─────────────────────────────────────────────────────────────

function hoursOfToday(site: Site): string {
  const entry = site.todayHours;
  if (!entry) return "fermé";
  const spans = [entry.lunch, entry.dinner]
    .filter((s): s is { open: string; close: string } => Boolean(s))
    .map((s) => `${s.open.replace(":", "h")}–${s.close.replace(":", "h")}`);
  return spans.length > 0 ? spans.join(" · ") : "fermé";
}

function EmbedHeader({
  name,
  logoUrl,
  verrouUrl,
  openNow,
  onClose,
}: {
  name: string;
  logoUrl: string | null;
  /** Le VERROU du masque — l’embarqué l’emploie comme la vitrine. */
  verrouUrl: string | null;
  openNow: boolean;
  onClose: (() => void) | null;
}) {
  /* L’état du service — sous le nom écrit comme sous le verrou. */
  const sousTitre = (
    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-mut">
      <Dot tone={openNow ? "ok" : "mut"} />
      {openNow ? "Ouvert" : "Fermé"}
    </p>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-ink/6 bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1080px] items-center gap-3 px-4 py-3">
        {/* 34 px : la hauteur de la tuile que le verrou remplace. La barre
            grandit alors d’une ligne, et c’est `EMBED_HEADER_VERROU_H` qui
            décale les éléments collants. */}
        <Verrou
          src={verrouUrl}
          nom={name}
          hauteur={34}
          sous={sousTitre}
          replier={
            <>
              <BrandMark name={name} logoUrl={logoUrl} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold tracking-[-0.02em] text-ink">
                  {name}
                </p>
                {sousTitre}
              </div>
            </>
          }
        />
        {onClose && (
          <Tap
            onClick={onClose}
            aria-label="Fermer la commande"
            className="grid size-11 shrink-0 place-items-center rounded-pill border border-ink/10 bg-surface2 text-ink hover:border-ink/30"
          >
            <Icon name="close" size={16} />
          </Tap>
        )}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Sections de la vitrine
// ─────────────────────────────────────────────────────────────

/**
 * Commande en ligne suspendue — l’état le plus délicat de la page.
 *
 * Le client arrive avec faim et sans savoir que le restaurant a coupé le
 * bouton. La page ne doit surtout pas ressembler à une panne : elle explique,
 * puis donne les deux choses qui restent utiles — le téléphone et l’heure de
 * réouverture — sans jamais cacher la carte, qui reste consultable dessous.
 */
function PauseCard({ site }: { site: Site }) {
  const phone = site.tenant.phones[0];
  const reopen = site.openNow ? null : nextOpeningLabel(site.tenant.hours);
  return (
    <div className="pt-5">
      <Surface className="overflow-hidden">
        <div className="flex items-start gap-3.5 p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-card bg-prep/15 text-prept">
            <Icon name="clock" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-extrabold tracking-[-0.025em] text-ink">
              Commande en ligne en pause
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-prep/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-prept">
                <Dot tone="prep" />
                Temporaire
              </span>
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-mut">
              {site.ordering.message ??
                "Le service est au coup de feu : la commande en ligne rouvre très vite."}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {phone && (
                <a
                  href={telHref(phone)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-accent px-4 text-[14px] font-extrabold text-onaccent transition-transform duration-fast ease-sm active:scale-[0.97] active:duration-snap"
                >
                  <Icon name="phone" size={16} stroke={2.3} />
                  Commander par téléphone
                </a>
              )}
              <span className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-ink/10 bg-surface2 px-4 text-[13.5px] font-semibold text-mut">
                <Icon name="clock" size={15} className="shrink-0" />
                {site.openNow
                  ? `Aujourd’hui : ${hoursOfToday(site)}`
                  : reopen
                    ? capitalize(reopen)
                    : "Voir les horaires plus bas"}
              </span>
            </div>
          </div>
        </div>
        <p className="border-t border-ink/6 bg-ink/[0.02] px-5 py-3 text-[13px] text-mut">
          La carte ci-dessous reste à jour&nbsp;: prix, recettes et suppléments
          sont ceux du comptoir.
        </p>
      </Surface>
    </div>
  );
}

function Reviews({ site }: { site: Site }) {
  return (
    <section aria-labelledby="avis" className="pt-11">
      <h2
        id="avis"
        className="font-display pb-3 text-[19px] font-extrabold uppercase leading-none tracking-[-0.01em] text-accentink"
      >
        Ce qu’en disent les clients
      </h2>
      <div aria-hidden className="sm-rule mb-4" />

      <Surface className="p-5">
        <div className="flex items-center gap-3.5">
          <span className="font-display text-[clamp(2rem,1.6rem+1.6vw,2.5rem)] font-black leading-none tracking-[-0.045em] tabular-nums text-accentink">
            {site.reviews.avg.toLocaleString("fr-FR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
          <div>
            <Stars value={site.reviews.avg} size={15} />
            <p className="mt-1 text-[13px] tabular-nums text-mut">
              {site.reviews.count} avis
            </p>
          </div>
        </div>

        <ul className="mt-4 flex flex-col gap-3.5 border-t border-ink/8 pt-4">
          {site.reviews.latest.map((review) => (
            <li key={review._id}>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-ink">
                  {review.author || "Client"}
                </span>
                <Stars value={review.rating} size={12} />
              </div>
              {review.text && (
                <p className="mt-1 text-[14px] leading-relaxed text-mut">
                  « {review.text} »
                </p>
              )}
              {review.reply?.text && (
                <p className="mt-2 rounded-card border-l-2 border-accent bg-ink/[0.03] px-3 py-2 text-[13px] leading-relaxed text-mut">
                  <span className="font-bold text-ink">Réponse du restaurant : </span>
                  {review.reply.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Surface>
    </section>
  );
}

function Practical({ site, cityName }: { site: Site; cityName: string }) {
  const week = weekSchedule(site.tenant.hours);
  const today = site.todayHours;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${site.tenant.name} ${site.tenant.address}`,
  )}`;

  return (
    <section aria-labelledby="infos" className="pt-11">
      <h2
        id="infos"
        className="font-display pb-3 text-[19px] font-extrabold uppercase leading-none tracking-[-0.01em] text-accentink"
      >
        Infos pratiques
      </h2>
      <div aria-hidden className="sm-rule mb-4" />

      <Surface className="divide-y divide-ink/6">
        {site.tenant.address && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-3.5 px-4 py-4 transition-colors duration-fast hover:bg-ink/[0.03]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-surface2 text-accentink">
              <Glyph name="pin" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
                Adresse
              </span>
              <span className="block text-[15px] font-semibold text-ink">
                {site.tenant.address}
              </span>
            </span>
            <Icon name="arrow" size={15} className="shrink-0 text-mut" />
          </a>
        )}

        {site.tenant.phones.map((phone) => (
          <a
            key={phone}
            href={telHref(phone)}
            className="flex min-h-11 items-center gap-3.5 px-4 py-4 transition-colors duration-fast hover:bg-ink/[0.03]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-surface2 text-accentink">
              <Icon name="phone" size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
                Téléphone
              </span>
              <span className="block text-[15px] font-semibold tabular-nums text-ink">
                {phone}
              </span>
            </span>
            <Icon name="arrow" size={15} className="shrink-0 text-mut" />
          </a>
        ))}

        <div className="px-4 py-4">
          <div className="flex items-center gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-card bg-surface2 text-accentink">
              <Icon name="clock" size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
                Horaires
              </span>
              <span className="block text-[15px] font-semibold text-ink">
                {site.openNow ? "Ouvert maintenant" : "Fermé actuellement"}
              </span>
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-ink/6 pt-3">
            {week.map((row) => (
              <li
                key={row.day}
                className={cx(
                  "flex items-baseline justify-between gap-4 text-[14px]",
                  today && Number(today.day) === row.day && "text-ink",
                )}
              >
                <span
                  className={cx(
                    today && Number(today.day) === row.day
                      ? "font-bold text-ink"
                      : "text-mut",
                  )}
                >
                  {row.label}
                </span>
                <span
                  className={cx(
                    "text-right font-semibold tabular-nums",
                    row.value === "Fermé" ? "text-mut" : "text-ink",
                  )}
                >
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Surface>

      {cityName && (
        <p className="mt-3 text-[13px] leading-relaxed text-mut">
          Click &amp; collect à {cityName} : commandez en ligne, payez sur place
          ou par carte, récupérez à l’heure choisie.
        </p>
      )}
    </section>
  );
}

function LegalFooter({
  site,
  cityName,
  prixMono,
}: {
  site: Site;
  cityName: string;
  prixMono: boolean;
}) {
  const year = new Date().getFullYear();
  const lowest = lowestPrice(site);
  const websiteUrl = WebsiteUrlSchema.safeParse(site.tenant.websiteUrl).data;
  return (
    <footer className="mt-12 border-t border-ink/6 pt-7 text-center">
      {lowest > 0 && (
        <p className="mb-4 inline-flex items-center gap-2 rounded-pill border border-ink/10 bg-surface2 px-3.5 py-2 text-[13px] text-mut">
          <Badge tone="hot">Dès</Badge>
          <Prix cents={lowest} mono={prixMono} className="font-extrabold text-ink" />
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-mut">
        {site.tenant.name} © {year}
        {cityName ? ` · ${cityName}` : ""} · Prix TTC, service compris
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-mut">
        Allergènes et composition&nbsp;: demandez au comptoir.
      </p>
      {websiteUrl && (
        <a href={websiteUrl} className="mt-3 inline-flex min-h-11 items-center rounded-ctrl px-3 text-[13px] font-bold text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Site du restaurant
        </a>
      )}
    </footer>
  );
}

/** Prix d’entrée de gamme — repris par le pied de page et le JSON-LD. */
function lowestPrice(site: Site): number {
  const prices = site.categories
    .flatMap((c) => c.products)
    .filter((p) => !p.outOfStock && p.fromPrice > 0)
    .map((p) => p.fromPrice);
  return prices.length > 0 ? Math.min(...prices) : 0;
}
