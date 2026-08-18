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
 * Le rendu est identique côté serveur et côté client : noms, descriptions et
 * prix sont dans le HTML livré, sans attendre l’exécution du JavaScript.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { Icon, Stars } from "@/components/ui";
import type { MenuProduct, Site } from "./api";
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
  euros,
  initial,
  nextOpeningLabel,
  onAccent,
  safeColor,
  telHref,
  weekSchedule,
} from "./helpers";
import { Checkout } from "./Checkout";
import { MenuBoard } from "./MenuBoard";
import { ProductSheet } from "./ProductSheet";
import { Banner, BrandMark, Dot, Money, Surface, Tap } from "./primitives";

/** Protocole postMessage avec le chargeur `w.js`. */
const WIDGET_ORIGIN_TAG = "snackmanager";

/** Hauteur de l’en-tête collant de l’embed — décale les éléments collants. */
const EMBED_HEADER_H = 58;

export function Storefront({
  site,
  mode = "site",
  showClose = false,
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
}) {
  const embed = mode === "embed";
  const accent = safeColor(site.tenant.brandColor);
  const index = useMemo(() => indexMenu(site.categories), [site.categories]);
  const cart = useCart(site.tenant.slug, index);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tunnel, setTunnel] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const paused = site.ordering.paused;
  const blocked = paused || site.categories.length === 0;

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

  // Marque grise : SEUL l’accent change d’un restaurant à l’autre. Les couleurs
  // fonctionnelles (vert prêt / rouge alerte / ambre préparation) restent fixes.
  const themed = {
    "--cf-accent": accent,
    "--cf-accent-hover": accent,
    "--cf-on-accent": onAccent(accent),
  } as CSSProperties;

  const cityName = cityOf(site.tenant.address);
  const letter = initial(site.tenant.name);

  return (
    <div
      ref={rootRef}
      style={themed}
      className={cx(
        "min-h-dvh bg-bg text-ink",
        // Dégage la barre de panier flottante.
        cart.count > 0 ? "pb-28" : "pb-10",
      )}
    >
      {embed ? (
        <EmbedHeader
          name={site.tenant.name}
          letter={letter}
          logoUrl={site.tenant.logoUrl}
          openNow={site.openNow}
          onClose={showClose ? closeEmbed : null}
        />
      ) : (
        <SiteHeader
          site={site}
          letter={letter}
          cityName={cityName}
          onOrder={scrollToMenu}
        />
      )}

      <main className="mx-auto w-full max-w-[560px] px-4">
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
                  className="grid size-7 place-items-center rounded-pill text-mut hover:text-ink"
                >
                  <Icon name="close" size={14} />
                </Tap>
              }
            >
              {notice}
            </Banner>
          </div>
        )}

        {paused && (
          <div className="pt-4">
            <Banner tone="prep" icon="clock" title="Commande en ligne suspendue">
              {site.ordering.message ??
                "Victimes de notre succès — la commande en ligne rouvre très vite. La carte reste consultable."}
            </Banner>
          </div>
        )}

        {!paused && !site.openNow && (
          <div className="pt-4">
            <Banner tone="info" icon="clock" title="Le restaurant est fermé">
              {nextOpeningLabel(site.tenant.hours)
                ? `${capitalize(nextOpeningLabel(site.tenant.hours)!)} — vous pouvez commander dès maintenant pour un créneau à venir.`
                : "Consultez la carte, la commande rouvrira au prochain service."}
            </Banner>
          </div>
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
              inCart={cart.lines.reduce<Record<string, number>>((acc, line) => {
                acc[line.productId] = (acc[line.productId] ?? 0) + line.qty;
                return acc;
              }, {})}
              disabled={blocked}
              stickyTop={embed ? EMBED_HEADER_H : 0}
            />
          )}
        </section>

        {!embed && (
          <>
            {site.reviews.count > 0 && <Reviews site={site} />}
            <Practical site={site} cityName={cityName} />
            <LegalFooter site={site} cityName={cityName} />
          </>
        )}
      </main>

      {/* ── Barre de panier flottante ── */}
      {cart.count > 0 && !tunnel && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[560px]">
            <Tap
              onClick={() => setTunnel(true)}
              className="flex w-full animate-pop items-center gap-3 rounded-pill bg-accent px-4 py-3.5 text-onaccent shadow-[0_14px_34px_rgba(0,0,0,0.55)]"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-pill bg-black/25 text-[13px] font-extrabold tabular-nums">
                {cart.count}
              </span>
              <span className="flex-1 text-left text-[15px] font-extrabold tracking-[-0.01em]">
                Voir mon panier
              </span>
              <Money cents={cart.subtotal} className="text-[16px]" />
              <Icon name="arrow" size={16} stroke={2.4} />
            </Tap>
          </div>
        </div>
      )}

      <ProductSheet
        draft={draft}
        blocked={blocked}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSubmit={(line) => {
          cart.upsert(line);
          setDraft(null);
        }}
      />

      <Checkout
        open={tunnel}
        slug={site.tenant.slug}
        tenantName={site.tenant.name}
        accent={accent}
        cart={cart}
        paused={paused}
        pauseMessage={site.ordering.message}
        initialSlots={site.slots}
        embed={embed}
        onClose={() => setTunnel(false)}
        onBrowse={scrollToMenu}
        onEditLine={editLine}
      />
    </div>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// ─────────────────────────────────────────────────────────────
// En-têtes
// ─────────────────────────────────────────────────────────────

function SiteHeader({
  site,
  letter,
  cityName,
  onOrder,
}: {
  site: Site;
  letter: string;
  cityName: string;
  onOrder: () => void;
}) {
  const phone = site.tenant.phones[0];
  return (
    <header className="border-b border-white/6 bg-[linear-gradient(180deg,#111,#000)]">
      <div className="mx-auto w-full max-w-[560px] px-4 pb-7 pt-6">
        <div className="flex items-center gap-3.5">
          <BrandMark
            name={site.tenant.name}
            logoUrl={site.tenant.logoUrl}
            letter={letter}
            size={52}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-[-0.035em] text-ink">
              {site.tenant.name}
            </h1>
            {cityName && (
              <p className="truncate text-[13px] font-semibold uppercase tracking-[0.1em] text-mut">
                {cityName}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className={cx(
              "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[13px] font-bold",
              site.openNow
                ? "border-ok/40 text-okt"
                : "border-white/12 text-mut",
            )}
          >
            <Dot tone={site.openNow ? "ok" : "mut"} />
            {site.openNow ? "Ouvert maintenant" : "Fermé"}
          </span>
          {site.reviews.count > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/10 px-3 py-1.5 text-[13px] font-bold text-ink">
              <Stars value={site.reviews.avg} size={13} />
              <span className="tabular-nums">
                {site.reviews.avg.toLocaleString("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
              </span>
              <span className="font-semibold text-mut tabular-nums">
                ({site.reviews.count})
              </span>
            </span>
          )}
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-mut">
          Commandez en ligne, récupérez sur place. Sans compte, sans attente au
          comptoir.
        </p>

        <div className="mt-5 flex gap-2.5">
          <Tap
            onClick={onOrder}
            className="flex flex-1 items-center justify-center gap-2 rounded-pill bg-accent px-5 py-3.5 text-[15px] font-extrabold text-onaccent"
          >
            <Icon name="cart" size={17} stroke={2.4} />
            Commander en ligne
          </Tap>
          {phone && (
            <a
              href={telHref(phone)}
              aria-label={`Appeler ${site.tenant.name} au ${phone}`}
              className="grid size-[50px] shrink-0 place-items-center rounded-pill border border-white/12 bg-surface2 text-ink transition-transform duration-200 ease-sm active:duration-75 active:scale-[0.97]"
            >
              <Icon name="phone" size={18} />
            </a>
          )}
        </div>

        {site.todayHours && (
          <p className="mt-4 flex items-center gap-2 text-[13px] text-mut">
            <Icon name="clock" size={14} />
            Aujourd’hui&nbsp;: {hoursOfToday(site)}
          </p>
        )}
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
  letter,
  logoUrl,
  openNow,
  onClose,
}: {
  name: string;
  letter: string;
  logoUrl: string | null;
  openNow: boolean;
  onClose: (() => void) | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/6 bg-bg/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 px-4 py-3">
        <BrandMark name={name} logoUrl={logoUrl} letter={letter} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-[-0.02em] text-ink">
            {name}
          </p>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-mut">
            <Dot tone={openNow ? "ok" : "mut"} />
            {openNow ? "Ouvert" : "Fermé"}
          </p>
        </div>
        {onClose && (
          <Tap
            onClick={onClose}
            aria-label="Fermer la commande"
            className="grid size-9 shrink-0 place-items-center rounded-pill border border-white/10 bg-surface2 text-ink hover:border-white/30"
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

function Reviews({ site }: { site: Site }) {
  return (
    <section aria-labelledby="avis" className="pt-10">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2
          id="avis"
          className="text-[20px] font-extrabold tracking-[-0.03em] text-ink"
        >
          Ce qu’en disent les clients
        </h2>
      </div>

      <Surface className="p-5">
        <div className="flex items-center gap-3">
          <span className="text-[38px] font-black leading-none tracking-[-0.04em] tabular-nums text-accent">
            {site.reviews.avg.toLocaleString("fr-FR", {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
          <div>
            <Stars value={site.reviews.avg} size={15} />
            <p className="mt-0.5 text-[13px] text-mut tabular-nums">
              {site.reviews.count} avis
            </p>
          </div>
        </div>

        <ul className="mt-4 flex flex-col gap-3.5 border-t border-white/8 pt-4">
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
                <p className="mt-2 rounded-card border-l-2 border-accent bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed text-mut">
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
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${site.tenant.name} ${site.tenant.address}`,
  )}`;

  return (
    <section aria-labelledby="infos" className="pt-10">
      <h2
        id="infos"
        className="pb-3 text-[20px] font-extrabold tracking-[-0.03em] text-ink"
      >
        Infos pratiques
      </h2>

      <Surface className="divide-y divide-white/6">
        {site.tenant.address && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3.5 px-4 py-4 transition-colors duration-200 hover:bg-white/[0.03]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-card bg-surface2 text-accent">
              <Icon name="home" size={17} />
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
            className="flex items-center gap-3.5 px-4 py-4 transition-colors duration-200 hover:bg-white/[0.03]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-card bg-surface2 text-accent">
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
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
            Horaires
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {week.map((row) => (
              <li
                key={row.day}
                className="flex items-baseline justify-between gap-4 text-[14px]"
              >
                <span className="text-mut">{row.label}</span>
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

function LegalFooter({ site, cityName }: { site: Site; cityName: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-white/6 pt-6 text-center">
      <p className="text-[12px] leading-relaxed text-mut">
        {site.tenant.name} © {year}
        {cityName ? ` · ${cityName}` : ""} · Prix TTC, service compris
      </p>
      <p className="mt-1 text-[12px] text-mut">
        Allergènes et composition&nbsp;: demandez au comptoir. Commande en ligne
        propulsée par Snack Manager.
      </p>
      <p className="mt-3 text-[12px] text-mut">
        À partir de{" "}
        <span className="font-bold text-ink">
          {euros(lowestPrice(site))}
        </span>
      </p>
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
