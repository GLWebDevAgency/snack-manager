"use client";

/**
 * Vitrine + tunnel de commande d’un restaurant.
 *
 * Un seul composant sert les trois portes d’entrée :
 *   `mode="site"`  → /r/[slug] : page publique complète (en-tête, héro, carte,
 *                    avis, infos pratiques, pied de page) — c’est la page qu’on
 *                    référence dans Google Business ;
 *   `mode="embed"` → /embed/[slug] : la même carte et le même tunnel, sans
 *                    en-tête ni pied de page, calibrés pour une iframe.
 *
 * ─── POURQUOI L’EMBED NE PORTE PAS LA BANDE D’ACCUEIL ───
 *
 * Ce n’est ni la même page ni le même visiteur. L’embed est posé DANS le site
 * du restaurateur : celui qui le voit vient de traverser les photos, le logo
 * et le décor de ce site — la photo d’établissement, il l’a déjà vue, souvent
 * la même. Trois raisons de plus, dans l’ordre de leur poids :
 *   · l’iframe remonte sa hauteur à la page hôte (`postMessage`/`resize`) :
 *     une bande de plus, c’est 130 px poussés dans la mise en page de
 *     QUELQU’UN D’AUTRE, sans qu’il l’ait demandé ;
 *   · jusqu’à 2 Mo non redimensionnés seraient facturés au chargement d’une
 *     page qui n’est pas la nôtre, pour une image qu’elle affiche déjà ;
 *   · l’embed est délibérément amputé (ni incontournables, ni avis, ni
 *     mentions) : c’est la carte et le tunnel, rien d’autre. Une vitrine
 *     complète y serait un doublon, pas un service.
 * La bande vit donc dans `SiteHeader` seul, jamais dans `EmbedHeader`.
 *
 * Hiérarchie de la page (maquette `docs/specs/commande-en-ligne.md` §5.1) :
 *   en-tête de restaurant (identité + état + héro + appel à l’action)
 *   ├ bandeau d’état (pause, fermeture, panier réconcilié)
 *   ├ rail « Les incontournables »
 *   ├ carte : navigation collante + sections à double filet
 *   └ avis · infos pratiques · mentions
 *
 * Le rendu est identique côté serveur et côté client : noms, descriptions et
 * prix sont dans le HTML livré, sans attendre l’exécution du JavaScript.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { logoPour, TYPE_PAIRS, WebsiteUrlSchema } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon, Stars, Verrou, verrouPour } from "@/components/ui";
import { useMasqueDeCapture } from "@/components/masque/masqueDeCapture";
import { classesPolices } from "@/components/masque/polices";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { networkApi, type MenuProduct, type OrderingApi, type Site } from "./api";
import {
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
  hhmm,
  nextOpeningLabel,
  telHref,
  weekSchedule,
} from "./helpers";
import { Checkout } from "./Checkout";
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

/** Nombre de produits mis en avant sur la vitrine. */
const HIGHLIGHT_COUNT = 8;

export function Storefront({
  site,
  mode = "site",
  showClose = false,
  api = networkApi,
  demo = false,
  loyalty = null,
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
  const index = useMemo(() => indexMenu(site.categories), [site.categories]);
  const cart = useCart(site.tenant.slug, index);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tunnel, setTunnel] = useState(false);
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
  const blocked = paused || site.categories.length === 0;

  const inCart = useMemo(
    () =>
      cart.lines.reduce<Record<string, number>>((acc, line) => {
        acc[line.productId] = (acc[line.productId] ?? 0) + line.qty;
        return acc;
      }, {}),
    [cart.lines],
  );

  /**
   * Mise en avant : les produits **photographiés** d’abord.
   *
   * Aucun champ « populaire » n’étant exposé par l’API, l’ordre du menu — celui
   * que le restaurateur a lui-même arrangé — fait autorité ; à rang égal, le
   * plat qui a une photo passe devant. C’est le seul rail de la page où le
   * visuel occupe la moitié de la carte : le remplir de plats sans photo
   * reviendrait à ouvrir la vitrine sur une rangée de monogrammes.
   */
  const highlights = useMemo(() => {
    const all = site.categories.flatMap((c) => c.products).filter((p) => !p.outOfStock);
    const shot = all.filter((p) => p.photoUrl);
    const rest = all.filter((p) => !p.photoUrl);
    return [...shot, ...rest].slice(0, HIGHLIGHT_COUNT);
  }, [site.categories]);

  // ── Lignes écartées à la réconciliation : on l’annonce, on ne l’escamote pas ──
  const notice =
    cart.dropped.length === 0
      ? null
      : cart.dropped.length === 1
        ? `« ${cart.dropped[0]} » n’est plus disponible et a été retiré de votre panier.`
        : `${cart.dropped.length} articles ne sont plus disponibles et ont été retirés de votre panier.`;

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
  function pick(product: MenuProduct) {
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
    setDraft(newDraft(product));
  }

  /** « Modifier » depuis le panier : la fiche rouvre pré-remplie. */
  function editLine(line: CartLine) {
    const product = index.get(line.productId);
    if (!product) return;
    setDraft(draftFromLine(line, product));
  }

  function scrollToMenu() {
    setTunnel(false);
    document
      .getElementById("carte")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const cityName = cityOf(site.tenant.address);

  /*
   * L'IMAGE D'ACCUEIL — lue sur LE MASQUE, comme le logo juste au-dessus.
   *
   * `brand` et non `site.tenant.brand` : sous `?masque=<direction>`, la
   * matrice de captures rend une direction de référence, dont le `hero` est
   * `null` par construction (`DIRECTIONS`). Les six captures restent donc
   * exactement ce qu'elles étaient — la bande n'apparaît que sur la marque
   * réellement stockée par un restaurant.
   *
   * Le cadrage passe par la médiathèque de la charge `/site` : `brand.hero` ne
   * stocke qu'une URL, sans point d'intérêt (voir `hero.ts`).
   */
  const hero = brand.hero;
  const heroCadrage = useMemo(() => cadrageDuHero(hero, site.medias), [hero, site.medias]);
  const heroAlt = useMemo(() => altDuHero(hero, site.medias), [hero, site.medias]);

  return (
    <div
      ref={rootRef}
      style={masque}
      className={cx(
        classesPolices,
        // `clip` et non `hidden` : `overflow-x: hidden` force `overflow-y:
        // auto` et fait de cette racine un conteneur de défilement — les
        // barres collantes de la carte cesseraient alors de coller.
        "font-body min-h-dvh overflow-x-clip bg-bg text-ink",
        // Dégage la barre de panier flottante.
        cart.count > 0 ? "pb-28" : "pb-10",
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
        <SiteHeader
          site={site}
          hero={hero}
          heroCadrage={heroCadrage}
          heroAlt={heroAlt}
          logoUrl={logoMarque}
          verrouUrl={verrouMarque}
          cityName={cityName}
          paused={paused}
          onOrder={scrollToMenu}
        />
      )}

      {/* Une seule borne, jamais un point de rupture : la colonne suit la
          fenêtre et la grille de la carte s'y remplit d'elle-même. */}
      <main className="mx-auto w-full max-w-[1080px] px-4">
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

        {!embed && (
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
        {!embed && loyalty && (
          <FideliteVitrine slug={site.tenant.slug} resume={loyalty} />
        )}

        <section id="carte" className="scroll-mt-4">
          {site.categories.length === 0 ? (
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
              categories={site.categories}
              onPick={pick}
              inCart={inCart}
              disabled={blocked}
              prixMono={prixMono}
              stickyTop={embed ? (verrouMarque ? EMBED_HEADER_VERROU_H : EMBED_HEADER_H) : 0}
            />
          )}
        </section>

        {!embed && (
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
      </main>

      {/* ── Barre de panier flottante ── */}
      {cart.count > 0 && !tunnel && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[560px]">
            <Tap
              onClick={() => setTunnel(true)}
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
              <span className="grid size-8 shrink-0 place-items-center rounded-pill border-[1.5px] border-onaccent/50 text-[14px] font-extrabold tabular-nums">
                {cart.count}
              </span>
              <span className="flex-1 text-left text-[15px] font-extrabold uppercase tracking-[0.02em]">
                Voir mon panier
              </span>
              <Money cents={cart.subtotal} mono={prixMono} className="text-[16px]" />
              <Icon name="arrow" size={16} stroke={2.4} className="opacity-70" />
            </Tap>
          </div>
        </div>
      )}

      <ProductSheet
        draft={draft}
        blocked={blocked}
        prixMono={prixMono}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSubmit={(line) => {
          cart.upsert(line);
          setDraft(null);
        }}
      />

      <Checkout
        open={tunnel}
        api={api}
        demo={demo}
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

/**
 * En-tête de restaurant — le bloc qui donne son ton à la page.
 *
 * Deux étages, et c’est la maquette : une **barre d’identité** courte (logo,
 * nom, appel) puis une **carte d’accroche** — état de service, promesse en
 * trois lignes, appel à l’action. L’accroche est une CARTE et non une pleine
 * page : elle tient dans ~300 px, si bien que le premier plat de la carte
 * apparaît dès le premier écran d’un téléphone. Un site de restauration dont
 * le premier écran ne montre aucun plat perd le client avant la faim.
 *
 * Le nom du restaurant reste le `h1` (c’est la page référencée) ; la promesse
 * est une accroche, pas un titre de document.
 *
 * ═══ LA BANDE D’ACCUEIL NE COÛTE QUE SA DIFFÉRENCE ═══
 *
 * Quand le restaurant a posé une image d’accueil (`brand.hero`), elle prend la
 * tête de CETTE carte — pas un étage de plus au-dessus d’elle. Et les deux
 * pastilles (« c’est ouvert ? », « c’est bon ? ») descendent SUR la photo au
 * lieu d’ouvrir le corps de la carte : la bande ne coûte donc au premier écran
 * que sa hauteur MOINS la place qu’elles laissent (48 px sur une ligne, 88 sur
 * deux). Mesuré sur un téléphone de 390 px : une bande de 130 px alourdit
 * l’en-tête de 41 px, et le premier plateau du rail passe de 647 à 689 px du
 * haut — il reste au premier écran.
 *
 * Sans image, rien ne bouge — pas de réceptacle vide, pas de hauteur réservée :
 * l’immense majorité des restaurants n’en aura pas avant longtemps, et leur
 * vitrine reste au pixel celle d’hier.
 */
function SiteHeader({
  site,
  hero,
  heroCadrage,
  heroAlt,
  logoUrl,
  verrouUrl,
  cityName,
  paused,
  onOrder,
}: {
  site: Site;
  /** L’image d’accueil du masque — `null` pour l’immense majorité des cartes. */
  hero: string | null;
  /** `object-position` issu du point d’intérêt de la médiathèque. */
  heroCadrage: string;
  /** Vide tant que le restaurateur n’a rien saisi : la bande est décorative. */
  heroAlt: string;
  /** La déclinaison de `brand.logo` qui va avec le mode du masque. */
  logoUrl: string | null;
  /** Le VERROU du masque — « logo avec le nom » — ou `null` s’il n’y en a pas. */
  verrouUrl: string | null;
  cityName: string;
  /** Commande en ligne suspendue : l’appel à l’action ne promet plus rien. */
  paused: boolean;
  onOrder: () => void;
}) {
  const phone = site.tenant.phones[0];
  const lead = site.slots?.leadTimeMin ?? 15;
  const nextSlot = site.slots?.slots.find((s) => !s.full)?.iso ?? null;
  const reopen = site.openNow ? null : nextOpeningLabel(site.tenant.hours);

  /*
   * UNE IMAGE D’ACCUEIL QUI NE CHARGE PAS NE LAISSE PAS DE TROU.
   *
   * Même motif que `Plate` : l’état porte l’URL qu’il juge, et le nœud est
   * relu au montage — la page est rendue côté serveur, donc une image morte a
   * déjà échoué quand React s’attache et `onError` ne se déclenchera jamais.
   * L’enjeu est ici plus grand que sur un plateau de produit : la bande
   * retirée, les pastilles retournent DANS la carte et la vitrine redevient
   * exactement celle d’un restaurant sans photo, au lieu de garder un cadre
   * vide de 130 px en tête de page.
   */
  const [etat, setEtat] = useState({ url: hero, casse: false });
  if (etat.url !== hero) setEtat({ url: hero, casse: false });
  const bande = hero && !etat.casse ? hero : null;
  const casse = () => setEtat({ url: hero, casse: true });

  /*
   * Les deux questions que le client se pose avant de lire quoi que ce soit —
   * « c’est ouvert ? » et « c’est bon ? ». Elles restent visibles à 390 px, et
   * elles restent PREMIÈRES dans l’ordre de lecture, sur la photo comme dans
   * la carte.
   *
   * `bg-surface` quand elles se posent sur la photo : une plaque OPAQUE, et
   * c’est ce qui rend leur texte lisible sur n’importe quel cliché. Le voile
   * du masque assombrit toujours, mais `--cf-text` suit le MODE du restaurant :
   * sur les quatre directions claires, l’encre tombe entre 1,13:1 et 1,70:1
   * sur une photo SOMBRE voilée, et remonte à 5,35–6,00 sur une photo blanche
   * — c’est la photo qui déciderait, et on ne la choisit pas. Sur la plaque,
   * le couple redevient `ink/surface` : 9,10:1 au pire des six directions,
   * garanti par `contraste()` (mesures dans `hero.test.ts`).
   */
  const pastilles = (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cx(
          "inline-flex h-8 items-center gap-2 rounded-pill border px-3 text-[13px] font-bold",
          bande && "bg-surface",
          paused
            ? "border-prep/45 text-prept"
            : site.openNow
              ? "border-ok/40 text-okt"
              : "border-ink/14 text-mut",
        )}
      >
        <Dot tone={paused ? "prep" : site.openNow ? "ok" : "mut"} />
        {paused
          ? "Commande en ligne suspendue"
          : site.openNow
            ? "Ouvert maintenant"
            : "Fermé"}
        {!paused && site.openNow && nextSlot && (
          <span className="font-extrabold tabular-nums text-ink">
            · retrait {hhmm(nextSlot)}
          </span>
        )}
        {!paused && !site.openNow && reopen && (
          <span className="font-semibold text-mut">· {reopen}</span>
        )}
      </span>
      {site.reviews.count > 0 && (
        <span
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-pill border border-ink/12 px-3 text-[13px] font-bold text-ink",
            bande && "bg-surface",
          )}
        >
          <Stars value={site.reviews.avg} size={12} />
          <span className="tabular-nums">
            {site.reviews.avg.toLocaleString("fr-FR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
          <span className="font-semibold tabular-nums text-mut">
            ({site.reviews.count})
          </span>
        </span>
      )}
    </div>
  );

  /* La ville — écrite UNE fois : elle se pose sous le nom écrit comme sous le
     verrou, et doit rester lisible sous un verrou plus large qu’une tuile. */
  const sousTitre = (
    <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
      {cityName || "Click & collect"}
    </p>
  );

  return (
    <header className="relative">
      {/* ── Barre d’identité ──
          Avec un VERROU posé, l’en-tête l’emploie TEL QUEL à la place de la
          tuile plus le nom : le graphiste du restaurant a déjà composé les
          deux, les recomposer en police du produit défait son travail. Le nom
          reste lu — il est l’`alt` du verrou, et le verrou est posé DANS le
          `h1`, qui garde donc son rôle et son texte accessible.
          Sans verrou (l’immense majorité), rien ne change. */}
      <div className="mx-auto flex w-full max-w-[1080px] items-center gap-3 px-4 pb-3 pt-4">
        <Verrou
          src={verrouUrl}
          nom={site.tenant.name}
          hauteur={44}
          balise="h1"
          sous={sousTitre}
          replier={
            <>
              <BrandMark name={site.tenant.name} logoUrl={logoUrl} size={44} />
              <div className="min-w-0 flex-1">
                <h1 className="font-display truncate text-[19px] font-extrabold leading-tight tracking-[-0.03em] text-ink">
                  {site.tenant.name}
                </h1>
                {sousTitre}
              </div>
            </>
          }
        />
        {phone && (
          <a
            href={telHref(phone)}
            aria-label={`Appeler ${site.tenant.name} au ${phone}`}
            className="grid size-11 shrink-0 place-items-center rounded-pill border border-ink/12 bg-surface2 text-ink transition-transform duration-fast ease-sm active:scale-[0.97] active:duration-snap"
          >
            <Icon name="phone" size={18} />
          </a>
        )}
      </div>

      {/* ── Carte d’accroche ── */}
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-1">
        <div className="sm-hero sm-grain relative overflow-hidden rounded-wide border border-ink/8 shadow-card">
          {bande ? (
            /*
              La bande d’accueil. Rapport fixé et plafonné : 130 px sur un
              téléphone de 390 px, 220 px au plus sur un écran large. Le client
              vient commander, pas admirer — une photo pleine hauteur repousse
              le premier plat sous la ligne de flottaison.
            */
            <div className="relative aspect-[16/6] max-h-[220px] w-full">
              <div className="sm-hero-media absolute inset-0 overflow-hidden">
                {/*
                  Photo de restaurant : domaine non maîtrisé, `next/image`
                  imposerait une liste blanche — <img> volontaire, avec repli
                  à l’erreur, comme `Plate`.

                  CHARGEMENT DÉLIBÉRÉMENT EFFACÉ. C’est la plus grosse image de
                  la page — jusqu’à 2 Mo, et rien ne la redimensionne encore
                  (`MEDIA_LARGEUR_CIBLE` attend son transformateur). Elle ne
                  doit donc pas passer devant les photos de plats, ni devant le
                  script de paiement, sur la 4G d’un trottoir : `lazy` la fait
                  charger APRÈS la mise en page, `fetchPriority="low"` la range
                  derrière le reste, `decoding="async"` empêche son décodage de
                  bloquer le fil principal. Le cadre, lui, est déjà à sa
                  hauteur définitive : aucun décalage à l’arrivée, et pendant
                  l’attente c’est le dégradé de `.sm-hero` qu’on voit — la
                  carte d’hier, pas un trou gris.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bande}
                  /* Vide tant que le restaurateur n’a rien saisi : un `alt`
                     vide RETIRE l’image de l’arbre d’accessibilité, ce qui est
                     exactement ce qu’on veut d’un décor. Y recopier le nom du
                     restaurant le ferait annoncer deux fois — il est déjà le
                     `h1` deux lignes plus haut. */
                  alt={heroAlt}
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
                  onError={casse}
                  ref={(node) => {
                    if (node?.complete && node.naturalWidth === 0) casse();
                  }}
                  style={{ objectPosition: heroCadrage }}
                  className="size-full object-cover"
                />
                <span aria-hidden className="sm-hero-voile absolute inset-0" />
              </div>
              <div className="absolute inset-x-0 bottom-0 px-5 pb-4 lg:px-7">
                {pastilles}
              </div>
            </div>
          ) : (
            /* Nom en typographie fantôme — profondeur, jamais lu. Il tient le
               rôle que la photo tient quand elle existe : sous une vraie
               image, ce contour la salirait. */
            <span
              aria-hidden
              className="sm-ghost font-display absolute -left-2 top-14 text-[clamp(4.75rem,3.5rem+3.5vw,7rem)] font-black opacity-70"
            >
              {site.tenant.name}
            </span>
          )}

          <div className="relative flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between lg:p-7">
            <div className="min-w-0">
              {!bande && pastilles}

              {/* Promesse en trois temps — la copy de la maquette. */}
              {/* Corps fluide : la promesse grandit avec la fenêtre au lieu
                  de sauter d'un cran à 1 024 px. */}
              <p
                className={cx(
                  "font-display text-[clamp(1.875rem,1.4rem+2vw,2.5rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-ink",
                  // La marge séparait la promesse des pastilles ; parties sur
                  // la photo, elle n’a plus rien à écarter.
                  !bande && "mt-4",
                )}
              >
                Commandez.
                <br />
                Récupérez.
                <br />
                <span className="text-accentink">Régalez-vous.</span>
              </p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-mut">
                {paused
                  ? "La carte reste consultable — la commande rouvre très vite."
                  : site.openNow
                    ? `Click & collect · prêt en ~${lead} min, sans compte.`
                    : "Commandez dès maintenant pour un créneau au prochain service."}
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 lg:items-end">
              <div className="flex gap-2.5">
                <Tap
                  onClick={onOrder}
                  className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-pill bg-accent px-6 text-[15px] font-extrabold text-onaccent shadow-[0_12px_30px_-12px_var(--cf-accent)]"
                >
                  {paused ? "Voir la carte" : "Commander maintenant"}
                  <Icon name="arrow" size={17} stroke={2.6} />
                </Tap>
                {paused && phone && (
                  <a
                    href={telHref(phone)}
                    className="flex min-h-[52px] shrink-0 items-center gap-2 rounded-pill border border-ink/14 bg-surface2 px-5 text-[14px] font-bold text-ink transition-transform duration-fast ease-sm active:scale-[0.97] active:duration-snap"
                  >
                    <Icon name="phone" size={16} />
                    Appeler
                  </a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-mut lg:justify-end">
                {site.todayHours && (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="clock" size={14} className="shrink-0" />
                    Aujourd’hui&nbsp;: {hoursOfToday(site)}
                  </span>
                )}
                {site.tenant.address && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Glyph name="pin" size={14} className="shrink-0" />
                    <span className="truncate">{site.tenant.address}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

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
        Allergènes et composition&nbsp;: demandez au comptoir. Commande en ligne
        propulsée par Snack Manager.
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
