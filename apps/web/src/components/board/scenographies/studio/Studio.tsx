"use client";

import type { CSSProperties } from "react";
import type { Brand, ScreenContent, ScreenProduct } from "@sm/contracts";
import { verrouPour } from "@/components/ui/verrou";
import { marqueSeule } from "../../board-header";
import type { ScenographyModule, ScenographyProps } from "../registry";
import { Photo } from "../comptoir/Comptoir";
import { FadeText } from "../comptoir/FadeText";
import { STUDIO_PROFILES, studioComposition, type StudioPreset } from "./profiles";
import "./studio.css";

/** Kept outside the scene layers: the light continues through a change of products. */
function Atmosphere({ preset }: { preset: StudioPreset }) {
  return (
    <div className="ss-atmosphere" data-atmosphere={STUDIO_PROFILES[preset].atmosphere} aria-hidden="true">
      <div className="ss-light ss-light-a ss-living" />
      <div className="ss-light ss-light-b" />
      <div className="ss-plane ss-plane-a ss-living" />
      <div className="ss-plane ss-plane-b" />
      <div className="ss-frame" />
    </div>
  );
}

function BrandMark({ content, masque }: { content: ScreenContent; masque: Brand }) {
  const src = verrouPour(masque) ?? marqueSeule(masque);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ss-logo" src={src} alt={content.brand.name} decoding="async" />
  ) : <span className="ss-brand-name">{content.brand.name}</span>;
}

export function StudioPrice({ product }: { product: ScreenProduct }) {
  const range = /^(.*?)\s+[–−-]\s+(.*?)$/.exec(product.priceLabel);
  return (
    <span className="ss-price" data-ss-part="price" data-range={range ? "1" : "0"}>
      {range ? <><span>{range[1]}</span>{" "}<span>– {range[2]}</span></> : <span>{product.priceLabel}</span>}
    </span>
  );
}

/** The outer reveal never owns FadeText's live opacity or changes its identity. */
function StudioText({ value, as, className, part }: {
  value: string; as: "h1" | "h2" | "p"; className: string; part: "title" | "name" | "detail";
}) {
  return <div className={className} data-ss-part={part}><FadeText as={as} className="ss-live-text" value={value} /></div>;
}

function Product({ product: p, index }: { product: ScreenProduct; index: number }) {
  // The full name remains in the DOM and on screen. Long names yield decorative image space.
  const long = p.name.length > 36;
  return (
    <article
      className="ss-product"
      data-product-id={p.id}
      data-oos={p.outOfStock ? "1" : "0"}
      data-photo={p.photoUrl ? "1" : "0"}
      data-long={long ? "1" : "0"}
      style={{ "--ss-i": index, "--ss-name-factor": long ? 0.84 : 1 } as CSSProperties}
    >
      <div className="ss-visual" data-ss-part="photo" aria-hidden="true">
        <span className="ss-product-halo" />
        {p.photoUrl ? <div className="ss-object ss-living"><Photo p={p} /></div> : null}
        <span className="ss-number">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <div className="ss-copy">
        <div className="ss-product-state" data-ss-part="detail">
          {p.isNew ? <span className="ss-new">Nouveau</span> : null}
          {p.outOfStock ? <span className="ss-oos">Épuisé</span> : null}
        </div>
        <StudioText as="h2" className="ss-name" part="name" value={p.name} />
        {p.description ? <StudioText as="p" className="ss-description" part="detail" value={p.description} /> : null}
        <StudioPrice product={p} />
      </div>
    </article>
  );
}

function StudioScene({ preset, scene, content, masque, orientation, phase = "in" }: ScenographyProps & { preset: StudioPreset }) {
  const profile = STUDIO_PROFILES[preset];
  const products = scene.products.slice(0, 8);
  const promos = scene.promos.slice(0, 3);
  const count = scene.kind === "promo" ? promos.length : products.length;
  const composition = studioComposition(count, orientation, profile.family);
  const special = scene.kind === "closed" || (products.length === 0 && scene.kind !== "promo");
  const sidebar = profile.layout === "sidebar" && !special && scene.kind !== "promo";
  const echo = products.length === 1 && products[0]!.name.trim().toLocaleLowerCase() === scene.title.trim().toLocaleLowerCase();
  const heading = echo ? content.serviceLabel : scene.title;
  const style = {
    "--ss-count": Math.max(1, count),
    "--ss-cols": composition.columns,
    "--ss-rows": composition.rows,
    "--ss-name-size": `${composition.name}px`,
    "--ss-price-size": `${composition.price}px`,
    "--ss-photo-beat": profile.beats.photo,
    "--ss-name-beat": profile.beats.name,
    "--ss-detail-beat": profile.beats.detail,
    "--ss-price-beat": profile.beats.price,
  } as CSSProperties;

  return (
    <section className="ss" data-preset={preset} data-family={profile.family} data-layout={profile.layout}
      data-entrance={profile.entrance} data-story={profile.story} data-camera={profile.camera} data-phase={phase} data-o={orientation} data-pair={masque.type.pair}
      data-count={count} data-dense={composition.dense ? "1" : "0"} data-kind={scene.kind}
      data-text-heavy={products.some((p) => p.name.length > 80) ? "1" : "0"} style={style}>
      <header className="ss-header">
        <div className="ss-header-copy">
          {!echo && <div className="ss-eyebrow" data-ss-part="label">{content.serviceLabel}</div>}
          {!sidebar && !special ? <StudioText as="h1" className="ss-heading" part="title" value={heading} /> : null}
          {scene.subtitle && !special ? <span className="ss-subtitle" data-ss-part="detail">{scene.subtitle}</span> : null}
        </div>
        <div className="ss-brand" data-ss-part="brand"><BrandMark content={content} masque={masque} /><span className="ss-status" data-open={content.open ? "1" : "0"} /></div>
      </header>

      {special ? (
        <div className="ss-message">
          <div className="ss-message-rule" data-ss-part="rule" />
          <StudioText as="h1" className="ss-message-title" part="title" value={scene.title || content.brand.name} />
          {scene.kind === "closed" && scene.nextOpening ? <>
            <p className="ss-reopening" data-ss-part="detail">Réouverture {scene.nextOpening.dayLabel}</p>
            <div className="ss-windows" data-ss-part="detail">{scene.nextOpening.windows.map((w) => <span key={w}>{w}</span>)}</div>
          </> : scene.subtitle ? <p className="ss-reopening" data-ss-part="detail">{scene.subtitle}</p> : null}
          <span className="ss-message-service" data-ss-part="label">{content.serviceLabel}</span>
        </div>
      ) : scene.kind === "promo" ? (
        <div className="ss-promos">
          {promos.map((promo, index) => <article className="ss-offer" key={promo.id} style={{ "--ss-i": index } as CSSProperties}>
            <span className="ss-offer-label" data-ss-part="price">{promo.label}</span>
            <StudioText as="h2" className="ss-name" part="name" value={promo.title} />
            {promo.description ? <StudioText as="p" className="ss-description" part="detail" value={promo.description} /> : null}
          </article>)}
          {promos.length === 0 ? <p className="ss-reopening">{scene.title}</p> : null}
        </div>
      ) : (
        <div className="ss-content">
          {sidebar ? <aside className="ss-intro"><div className="ss-intro-title" data-ss-part="title"><FadeText as="h1" value={scene.title} /></div><span className="ss-intro-rule" data-ss-part="rule" />
            {products[0]?.photoUrl ? <div className="ss-intro-photo" data-ss-part="photo"><div className="ss-object ss-living"><Photo p={products[0]} /></div></div> : null}
          </aside> : null}
          <div className="ss-products">{products.map((p, index) => <Product key={p.id} product={p} index={index} />)}</div>
        </div>
      )}
      <div className="ss-foot" aria-hidden="true"><span /><span className="ss-foot-mark" data-ss-part="rule" /></div>
    </section>
  );
}

export function studioModule(preset: StudioPreset): ScenographyModule {
  return {
    Component: function StudioProfile(props) { return <StudioScene {...props} preset={preset} />; },
    Background: function StudioBackground() { return <Atmosphere preset={preset} />; },
    chrome: "none",
    layered: true,
  };
}
