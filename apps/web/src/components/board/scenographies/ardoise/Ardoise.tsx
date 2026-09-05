"use client";

import type { CSSProperties } from "react";
import type { ScreenOrientation, ScreenProduct, ScreenScenePayload } from "@sm/contracts";
import type { ScenographyModule, ScenographyProps } from "../registry";
import { ProductRow } from "./product-row";
import { Photo } from "../comptoir/Comptoir";

/**
 * ARDOISE — la carte en lignes, sobre et dense.
 *
 * La scénographie d'origine de l'écran de salle : le nom, la description, le
 * prix ; une photo dominante quand la scène met un produit en avant. Elle
 * prend désormais toutes ses couleurs et ses polices dans le masque du
 * restaurant (`board.css` ne lit que des jetons), et laisse l'en-tête
 * persistant à l'hôte (`chrome: "header"`).
 *
 * Règle unique et non négociable : jamais plus de huit lignes. L'API pagine
 * déjà les catégories trop longues (« 2 / 3 ») ; ici on choisit seulement la
 * COMPOSITION — une colonne quand il y a de la place, deux quand la catégorie
 * est fournie, une photo dominante quand la scène met un produit en avant.
 */

/** Au-delà, une mise en avant redevient une liste : trois photos géantes se
 *  regardent, huit se subissent. */
const HERO_MAX = 3;

/**
 * Une catégorie d'un ou deux produits (« Class Bowl », « Assiettes ») passe
 * elle aussi en composition photo : deux lignes perdues au milieu d'un écran de
 * 1080 px de haut ressemblent à une carte qui n'a pas fini de charger.
 */
const LIST_MIN = 3;

function SceneHead({ scene }: { scene: ScreenScenePayload }) {
  return (
    <div className="bd-scene-head">
      <div className="bd-scene-title">
        <div className="bd-title">{scene.title}</div>
        <div className="bd-title-rule" />
      </div>
      {scene.subtitle ? <div className="bd-page">{scene.subtitle}</div> : null}
    </div>
  );
}

function ProductList({
  products,
  orientation,
  durationMs,
}: {
  products: ScreenProduct[];
  orientation: ScreenOrientation;
  durationMs: number;
}) {
  // En portrait la colonne unique est la seule composition lisible : la largeur
  // d'un écran vertical (1080 px de référence) ne supporte pas deux prix.
  const columns = orientation === "portrait" || products.length <= 4 ? 1 : 2;
  const rows = Math.ceil(products.length / columns);

  return (
    <div
      className="bd-list"
      data-cols={String(columns)}
      data-rows={String(rows)}
      style={{ "--bd-rows": rows, "--bd-cols": columns } as CSSProperties}
    >
      {products.map((product, index) => (
        <ProductRow
          key={product.id}
          product={product}
          index={index}
          durationMs={durationMs}
        />
      ))}
    </div>
  );
}

/** Une à trois références, photo dominante. */
function HeroProducts({
  products,
  durationMs,
}: {
  products: ScreenProduct[];
  durationMs: number;
}) {
  const solo = products.length === 1;
  // Dès qu'UNE carte porte un badge, toutes réservent la ligne : sinon la
  // photo de la carte étiquetée « Nouveau » est plus courte que ses voisines,
  // et l'œil accroche sur l'alignement avant de lire le prix.
  const reserveBadges = products.some((p) => p.isNew || p.outOfStock);

  return (
    <div
      className="bd-hero"
      data-solo={solo ? "1" : "0"}
      data-count={String(products.length)}
      style={{ "--bd-cols": products.length } as CSSProperties}
    >
      {products.map((product, index) => (
        <div
          key={product.id}
          className="bd-hero-card"
          data-solo={solo ? "1" : "0"}
          data-photo={product.photoUrl ? "1" : "0"}
          data-out={product.outOfStock ? "1" : "0"}
          style={{ "--bd-i": index, "--bd-ken": `${durationMs}ms` } as CSSProperties}
        >
          {product.photoUrl ? (
            <div className="bd-hero-photo">
              <Photo p={product} drift durationMs={durationMs} />
            </div>
          ) : null}
          <div className="bd-hero-body">
            <div className="bd-name-line" data-reserve={reserveBadges ? "1" : "0"}>
              {product.isNew && !product.outOfStock ? (
                <span className="bd-badge" data-kind="new">
                  Nouveau
                </span>
              ) : null}
              {product.outOfStock ? (
                <span className="bd-badge" data-kind="out">
                  Épuisé
                </span>
              ) : null}
            </div>
            <div className="bd-hero-name">{product.name}</div>
            {product.description ? (
              <div className="bd-hero-desc">{product.description}</div>
            ) : null}
            <div className="bd-hero-price">{product.priceLabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Les offres actives du moment — la remise est le héros de la scène. */
function PromoScene({ scene }: { scene: ScreenScenePayload }) {
  return (
    <>
      <SceneHead scene={scene} />
      <div
        className="bd-hero"
        data-solo={scene.promos.length === 1 ? "1" : "0"}
        data-count={String(Math.min(scene.promos.length, 3))}
        style={{ "--bd-cols": Math.min(scene.promos.length, 3) } as CSSProperties}
      >
        {scene.promos.slice(0, 3).map((promo, index) => (
          <div
            key={promo.id}
            className="bd-hero-card bd-promo-card"
            data-solo="0"
            data-photo="0"
            style={{ "--bd-i": index } as CSSProperties}
          >
            <div className="bd-hero-body">
              <div className="bd-promo-label">{promo.label}</div>
              <div className="bd-promo-text">
                <div className="bd-hero-name">{promo.title}</div>
                {promo.description ? (
                  <div className="bd-hero-desc">{promo.description}</div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Hors service.
 *
 * C'est l'écran que voit le passant derrière la vitrine à 15 h. Il ne doit
 * surtout pas rejouer la carte — ce serait inviter à pousser une porte fermée —
 * mais dire quand on rouvre, et rien d'autre.
 */
function ClosedScene({ scene, brandName }: { scene: ScreenScenePayload; brandName: string }) {
  const opening = scene.nextOpening;
  return (
    <div className="bd-plate">
      <div className="bd-plate-kicker">{brandName}</div>
      <div className="bd-plate-title">Fermé</div>
      {opening ? (
        <>
          <div className="bd-plate-line">Réouverture {opening.dayLabel}</div>
          <div className="bd-plate-hours">{opening.windows.join("  ·  ")}</div>
        </>
      ) : (
        <div className="bd-plate-line">{scene.subtitle ?? "Réouverture prochainement"}</div>
      )}
    </div>
  );
}

/** Panneau libre sans produit : la plaque de marque, plutôt qu'un écran noir. */
function PlateScene({
  scene,
  brandName,
  logoUrl,
}: {
  scene: ScreenScenePayload;
  brandName: string;
  logoUrl: string | null;
}) {
  return (
    <div className="bd-plate">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bd-plate-logo" src={logoUrl} alt="" decoding="async" />
      ) : null}
      <div className="bd-plate-title">{scene.title || brandName}</div>
      {scene.subtitle ? <div className="bd-plate-line">{scene.subtitle}</div> : null}
    </div>
  );
}

function ArdoiseScene({ scene, orientation, content }: ScenographyProps) {
  const brandName = content.brand.name;
  const logoUrl = content.brand.logoUrl;
  if (scene.kind === "closed") {
    return <ClosedScene scene={scene} brandName={brandName} />;
  }

  if (scene.kind === "promo") {
    return <PromoScene scene={scene} />;
  }

  if (scene.products.length === 0) {
    return <PlateScene scene={scene} brandName={brandName} logoUrl={logoUrl} />;
  }

  const hero =
    scene.products.length < LIST_MIN ||
    (scene.kind === "featured" && scene.products.length <= HERO_MAX);

  /**
   * Catégorie d'un seul produit qui porte le nom de la catégorie (« Compose ton
   * Tacos ») : afficher le titre PUIS le même nom en dessous ferait bégayer
   * l'écran. On supprime l'en-tête, la photo prend toute la scène.
   */
  const echoesTitle =
    hero &&
    scene.products.length === 1 &&
    scene.products[0]!.name.trim().toLowerCase() === scene.title.trim().toLowerCase();

  return (
    <>
      {echoesTitle ? null : <SceneHead scene={scene} />}
      {hero ? (
        <HeroProducts products={scene.products} durationMs={scene.durationMs} />
      ) : (
        <ProductList
          products={scene.products}
          orientation={orientation}
          durationMs={scene.durationMs}
        />
      )}
    </>
  );
}

export const Ardoise: ScenographyModule = { Component: ArdoiseScene, chrome: "header" };
