"use client";

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import {
  cadrageCss,
  type Brand,
  type ScreenContent,
  type ScreenProduct,
  type ScreenPromo,
  type ScreenScenePayload,
} from "@sm/contracts";
import { verrouPour } from "@/components/ui/verrou";
import { marqueSeule } from "../../board-header";
import { useRestaurantClock } from "../../board-runtime";
import type { ScenographyModule, ScenographyProps } from "../registry";
import { disposition, variablesDeScene, type Disposition } from "./composition";
import { dureeMs, FadeText } from "./FadeText";

/**
 * COMPTOIR — « le comptoir de nuit ».
 *
 * L'œil voit d'abord la nourriture : des boîtes photo pleines, posées sur un
 * fond profond, comme des plats sous la lampe du comptoir. Deuxième lecture,
 * le prix : étiquette collée en accent, un peu de travers, jamais discrète,
 * stable après son entrée. Troisième, le nom en capitales de titrage, puis la
 * composition en retrait. Le titre de scène ancre la catégorie ; son fantôme
 * tapisse le fond et donne de la matière sans rien ajouter.
 *
 * Le rythme : photo, nom, composition, étiquette ; puis seules les photos et
 * le décor dérivent lentement. Rien ne clignote,
 * rien ne saute quand un prix change (`FadeText`, clés par identifiant).
 *
 * Tout vient du masque et du contenu : aucune couleur, aucune police, aucune
 * durée ici. La même scénographie sert tous les restaurants.
 */

/** Le contrat plafonne à huit ; un panneau libre n'est pas paginé par le serveur. */
const MAX_PRODUITS = 8;
const MAX_OFFRES = 3;

/** L'entrée appartient à l'enveloppe, le fondu LIVE à son enfant : leurs
 * opacités ne se disputent jamais, même si une correction arrive en pleine entrée. */
function FilmText({ beat = 2, offer = false, ...props }: ComponentProps<typeof FadeText> & {
  beat?: 0 | 1 | 2 | 3 | 4;
  offer?: boolean;
}) {
  return (
    <div className={offer ? "ct-copy ct-offer-entry" : "ct-copy"} data-beat={beat}>
      <FadeText {...props} />
    </div>
  );
}

/** « Les », « La », « L' » ne font pas une initiale. */
function initiale(nom: string): string {
  return (
    nom
      .replace(/^\s*(les?|la|l')\s*/i, "")
      .trim()
      .charAt(0)
      .toUpperCase() || "?"
  );
}

export interface PhotoChargee {
  url: string;
  width: number;
  height: number;
}

// Only metadata is retained. An outgoing scene can remount its already decoded photo
// immediately; the browser remains responsible for the image cache itself.
const photosChargees = new Map<string, PhotoChargee>();

/** Une photo n'entre dans la scène qu'après chargement ET décodage. */
export function chargerPhoto(url: string, signal: AbortSignal): Promise<PhotoChargee | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (photo: PhotoChargee | null) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      if (photo) {
        if (photosChargees.size >= 64) photosChargees.delete(photosChargees.keys().next().value!);
        photosChargees.set(photo.url, photo);
      }
      resolve(photo);
    };
    const abort = () => finish(null);
    if (signal.aborted) return finish(null);
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      void image.decode().then(
        () => finish(
          image.naturalWidth > 0 && image.naturalHeight > 0 && !signal.aborted
            ? { url, width: image.naturalWidth, height: image.naturalHeight }
            : null,
        ),
        () => finish(null),
      );
    };
    image.onerror = () => finish(null);
    image.src = url;
  });
}

export function Photo({
  p,
  drift = false,
  durationMs = 0,
}: {
  p: ScreenProduct;
  drift?: boolean;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [photos, setPhotos] = useState<{
    current: PhotoChargee | null;
    previous: PhotoChargee | null;
  }>(() => ({ current: p.photoUrl ? photosChargees.get(p.photoUrl) ?? null : null, previous: null }));
  useEffect(() => {
    const controller = new AbortController();
    const next = p.photoUrl ? chargerPhoto(p.photoUrl, controller.signal) : Promise.resolve(null);
    void next.then((current) => {
      if (!controller.signal.aborted) {
        setPhotos((old) => old.current?.url === current?.url
          ? old
          : { current, previous: old.current });
      }
    });
    return () => controller.abort();
  }, [p.photoUrl]);

  useEffect(() => {
    if (!photos.previous) return;
    const delay = dureeMs(
      ref.current ? getComputedStyle(ref.current).getPropertyValue("--sm-t-fast") : "",
    );
    const timer = setTimeout(() => setPhotos((old) => ({ ...old, previous: null })), delay);
    return () => clearTimeout(timer);
  }, [photos.previous]);

  const detailed = photos.current && photos.current.width >= 1000 && photos.current.height >= 600;
  const picture = (photo: PhotoChargee, previous: boolean) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={photo.url}
      src={photo.url}
      alt=""
      decoding="async"
      className={previous ? (photos.current ? undefined : "ct-photo-out") : "ct-photo-in"}
      data-fit={photo.width < 1000 || photo.height < 600 ? "natural" : "cover"}
      style={{
        objectPosition: cadrageCss(p.photoPoint),
        "--ct-photo-width": `${photo.width}px`,
        "--ct-photo-height": `${photo.height}px`,
      } as CSSProperties}
      onError={() => setPhotos((old) => ({
        current: old.current?.url === photo.url ? null : old.current,
        previous: old.previous?.url === photo.url ? null : old.previous,
      }))}
    />
  );
  return (
    <span className="ct-photo-frame" data-state={photos.current || photos.previous ? "ready" : "empty"} ref={ref}>
      {!photos.current && !photos.previous ? <span className="ct-ghost">{initiale(p.name)}</span> : null}
      <span
        className={drift && detailed ? "ct-photo-motion ct-drift" : "ct-photo-motion"}
        style={drift && durationMs > 0 ? { "--ct-photo-scene-ms": `${durationMs}ms` } as CSSProperties : undefined}
      >
        {photos.previous ? picture(photos.previous, true) : null}
        {photos.current ? picture(photos.current, false) : null}
      </span>
    </span>
  );
}

const etat = (p: ScreenProduct) => ({
  "data-oos": p.outOfStock ? "1" : "0",
  "data-photo": p.photoUrl ? "1" : "0",
});

/** L'étiquette entre une fois. Sa valeur autoritaire change ensuite SANS fondu
 * ni compteur ; son enveloppe et son identifiant ne dépendent pas du montant. */
function Prix({ p, className = "ct-badge" }: { p: ScreenProduct; className?: string }) {
  const range = /^(.*?)\s+[–−-]\s+(.*?)$/.exec(p.priceLabel);
  return (
    <span className={className} data-range={range ? "1" : "0"}>
      <span className="ct-price-ink">
        {range ? <>
          <span className="ct-price-part">{range[1]}</span>{" "}
          <span className="ct-price-part">– {range[2]}</span>
        </> : p.priceLabel}
      </span>
    </span>
  );
}

function Etiquettes({ p }: { p: ScreenProduct }) {
  return (
    <>
      <span className="ct-new" hidden={!p.isNew}>
        Nouveau
      </span>
      <span className="ct-oos-tag">Épuisé</span>
    </>
  );
}

function Tuile({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-tile ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} drift />
        <div className="ct-dim" />
        <div className="ct-labels">
          <Prix p={p} />
          <span className="ct-new" hidden={!p.isNew}>Nouveau</span>
        </div>
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <div className="ct-tx">
        <FilmText as="h3" className="ct-name" value={p.name} />
        <FilmText as="p" className="ct-desc" value={p.description} beat={3} />
      </div>
    </article>
  );
}

function Ligne({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article
      className="ct-row ct-it"
      {...etat(p)}
      data-wide-price={p.priceMaxCents > p.priceCents ? "1" : "0"}
      style={{ "--i": i } as CSSProperties}
    >
      <div className="ct-ph">
        <Photo p={p} drift />
        <div className="ct-dim" />
        <Etiquettes p={p} />
      </div>
      <div className="ct-tx">
        <FilmText as="h3" className="ct-name" value={p.name} />
        <FilmText as="p" className="ct-desc" value={p.description} beat={3} />
      </div>
      <Prix p={p} />
    </article>
  );
}

function Heros({
  p,
  i,
  durationMs,
  echo = false,
}: {
  p: ScreenProduct;
  i: number;
  durationMs: number;
  /** Le produit porte le nom de la scène (« Le Boss » dans « Le Boss ») : on ne l'écrit pas deux fois. */
  echo?: boolean;
}) {
  return (
    <article className="ct-hero ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} drift durationMs={durationMs} />
        <div className="ct-dim" />
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <div className="ct-labels ct-labels-hero">
        <Prix p={p} className="ct-badge ct-badge-hero" />
        <span className="ct-new" hidden={!p.isNew}>Nouveau</span>
      </div>
      <div className="ct-cap">
        {echo ? null : <FilmText as="h3" className="ct-name ct-name-hero" value={p.name} />}
        <FilmText as="p" className="ct-desc" value={p.description} beat={3} />
      </div>
    </article>
  );
}

function LigneLaterale({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-srow ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-thumb">
        <Photo p={p} drift />
      </div>
      <div className="ct-tx">
        <FilmText as="h3" className="ct-name" value={p.name} />
        <span className="ct-new" hidden={!p.isNew}>
          Nouveau
        </span>
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <Prix p={p} className="ct-price" />
    </article>
  );
}

function Offre({ o, i }: { o: ScreenPromo; i: number }) {
  return (
    <article className="ct-promo ct-it" style={{ "--i": i } as CSSProperties}>
      <div className="ct-ptx">
        <FilmText as="h3" className="ct-ptitle" value={o.title} />
        <FilmText as="p" className="ct-pdesc" value={o.description} beat={3} />
      </div>
      <FilmText className="ct-plab" value={o.label} beat={4} offer />
    </article>
  );
}

/** Le verrou s'il est posé, sinon la marque, sinon le nom en titrage. */
function Marque({
  content,
  masque,
  grand = false,
}: {
  content: ScreenContent;
  masque: Brand;
  grand?: boolean;
}) {
  const verrou = verrouPour(masque);
  const src = verrou ?? marqueSeule(masque);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={grand ? "ct-logo ct-logo-big" : "ct-logo"}
        src={src}
        alt={content.brand.name}
        decoding="async"
      />
    );
  }
  return <div className={grand ? "ct-bname ct-bname-big" : "ct-bname"}>{content.brand.name}</div>;
}

/** « 2 / 3 » devient des points, le courant allongé en accent. */
function Puces({ subtitle }: { subtitle: string | null }) {
  if (!subtitle) return <div className="ct-sub" />;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(subtitle);
  if (!m) {
    return (
      <div className="ct-sub">
        <FadeText className="ct-subtxt" value={subtitle} />
      </div>
    );
  }
  const a = Number(m[1]);
  const n = Number(m[2]);
  return (
    <div className="ct-sub">
      <span className="ct-pips" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className="ct-pip" data-on={i + 1 === a ? "1" : "0"} />
        ))}
      </span>
      <span className="ct-subtxt">
        {a} / {n}
      </span>
    </div>
  );
}

function Entete({
  scene,
  content,
  masque,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
}) {
  const heure = useRestaurantClock(content.timezone);
  return (
    <header className="ct-hd ct-it" style={{ "--i": 0 } as CSSProperties}>
      <div className="ct-hd-l">
        <div className="ct-eyebrow">
          <FadeText value={content.serviceLabel} />
        </div>
        <FilmText as="h1" className="ct-title" value={scene.title} beat={1} />
        <Puces subtitle={scene.subtitle} />
      </div>
      <div className="ct-hd-r">
        <Marque content={content} masque={masque} />
        <div className="ct-svc">
          <span className="ct-dot" data-open={content.open ? "1" : "0"} />
          <span className="ct-clock">{heure}</span>
        </div>
      </div>
    </header>
  );
}

function Ferme({
  scene,
  content,
  masque,
  durationMs,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
  durationMs: number;
}) {
  const no = scene.nextOpening;
  return (
    <section className="ct-closed">
      <div className="ct-ring" style={{ "--ct-photo-scene-ms": `${durationMs}ms` } as CSSProperties} />
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} masque={masque} grand />
        <FilmText as="h1" className="ct-title" value={scene.title} beat={1} />
        {no ? (
          <>
            <div className="ct-reopen">Réouverture {no.dayLabel}</div>
            <div className="ct-wins">
              {no.windows.map((w) => (
                <span key={w} className="ct-win">
                  {w}
                </span>
              ))}
            </div>
          </>
        ) : (
          <FilmText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle ?? ""} beat={3} />
        )}
        <div className="ct-svc-line">{content.serviceLabel}</div>
      </div>
    </section>
  );
}

/** Panneau libre sans produit, carte vide : la plaque de marque, jamais un écran noir. */
function Vide({
  scene,
  content,
  masque,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
}) {
  return (
    <section className="ct-closed">
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} masque={masque} grand />
        <FilmText as="h1" className="ct-title" value={scene.title || content.brand.name} beat={1} />
        {scene.subtitle ? (
          <FilmText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle} beat={3} />
        ) : null}
      </div>
    </section>
  );
}

function Corps({
  d,
  scene,
  products,
  promos,
}: {
  d: Disposition;
  scene: ScreenScenePayload;
  products: ScreenProduct[];
  promos: ScreenPromo[];
}) {
  const dur = Math.max(0, Math.round(scene.durationMs));
  if (d === "hero") {
    const p = products[0]!;
    const echo = p.name.trim().toLowerCase() === scene.title.trim().toLowerCase();
    return <Heros p={p} i={0} durationMs={dur} echo={echo} />;
  }
  if (d === "list") {
    return (
      <div className="ct-grid" style={{ gridTemplateRows: products.map((p) => p.priceMaxCents > p.priceCents ? "minmax(0, 1.4fr)" : "minmax(0, 1fr)").join(" ") }}>
        {products.map((p, i) => (
          <Ligne key={p.id} p={p} i={i} />
        ))}
      </div>
    );
  }
  if (d === "featured") {
    return (
      <div className="ct-feat">
        <Heros p={products[0]!} i={0} durationMs={dur} />
        <div className="ct-side">
          {products.slice(1).map((p, i) => (
            <LigneLaterale key={p.id} p={p} i={i + 1} />
          ))}
        </div>
      </div>
    );
  }
  if (d === "promo") {
    return (
      <div className="ct-promos" data-count={String(promos.length)}>
        {promos.map((o, i) => (
          <Offre key={o.id} o={o} i={i} />
        ))}
      </div>
    );
  }
  return (
    <div className="ct-grid">
      {products.map((p, i) => (
        <Tuile key={p.id} p={p} i={i} />
      ))}
    </div>
  );
}

function ComptoirScene({ scene, content, masque, orientation }: ScenographyProps) {
  const products = scene.products.slice(0, MAX_PRODUITS);
  const promos = scene.promos.slice(0, MAX_OFFRES);
  const d = disposition(scene.kind, products.length, orientation);
  const style = variablesDeScene(orientation, d, products.length);
  const mot = scene.kind === "closed" ? content.brand.name : scene.title;

  return (
    <div className="ct" data-disposition={d} data-count={products.length} data-o={orientation} data-pair={masque.type.pair} style={style}>
      <div className="ct-bg" aria-hidden>
        <div className="ct-halo" />
        <div className="ct-bgword">{mot}</div>
      </div>
      <div className="ct-stage">
        {d === "closed" ? (
          <Ferme scene={scene} content={content} masque={masque} durationMs={scene.durationMs} />
        ) : d === "empty" ? (
          <Vide scene={scene} content={content} masque={masque} />
        ) : (
          <>
            <Entete scene={scene} content={content} masque={masque} />
            <section className="ct-body">
              <Corps d={d} scene={scene} products={products} promos={promos} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export const Comptoir: ScenographyModule = { Component: ComptoirScene, chrome: "none" };
