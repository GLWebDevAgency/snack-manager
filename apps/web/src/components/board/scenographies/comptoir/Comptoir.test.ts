import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  type ScreenContent,
  type ScreenProduct,
  type ScreenScenePayload,
} from "@sm/contracts";
import { Comptoir } from "./Comptoir";

/**
 * Les six cas de Comptoir, RENDUS — pas seulement leur disposition. Le rendu
 * statique suffit à prouver la structure : quelle composition, combien de
 * boîtes, ce qui est dit d'une rupture, et que le prix n'entre jamais dans un
 * fondu.
 */

let seq = 0;
function produit(patch: Partial<ScreenProduct> = {}): ScreenProduct {
  seq += 1;
  return {
    id: `p${seq}`,
    name: `Produit ${seq}`,
    description: "Steak, cheddar, oignons",
    priceLabel: "9,50 €",
    priceCents: 950,
    priceMaxCents: 950,
    photoUrl: null,
    photoPoint: null,
    isNew: false,
    outOfStock: false,
    ...patch,
  };
}

function scene(patch: Partial<ScreenScenePayload> = {}): ScreenScenePayload {
  return {
    id: "s1",
    kind: "category",
    title: "Nos burgers",
    subtitle: null,
    durationMs: 10_000,
    products: [],
    promos: [],
    nextOpening: null,
    ...patch,
  };
}

const CONTENU: ScreenContent = {
  screenId: "s",
  name: "Comptoir",
  orientation: "landscape",
  theme: "brand",
  scenography: "comptoir",
  masque: DIRECTIONS.nuit,
  brand: { slug: "demo", name: "Chez Nino", logoUrl: null, accent: DIRECTIONS.nuit.palette.accent },
  service: "dinner",
  serviceLabel: "Service du soir",
  open: true,
  scenes: [],
  contentHash: "x",
  generatedAt: "2026-09-05T18:00:00.000Z",
  dailyReloadAt: "2026-09-06T02:00:00.000Z",
  pollIntervalMs: 60_000,
  timezone: "Europe/Paris",
};

function rendre(s: ScreenScenePayload, orientation: "landscape" | "portrait" = "landscape"): string {
  return renderToStaticMarkup(
    createElement(Comptoir.Component, {
      scene: s,
      content: CONTENU,
      masque: DIRECTIONS.nuit,
      orientation,
      prixMono: false,
    }),
  );
}

const compter = (html: string, motif: string) => html.split(motif).length - 1;

describe("Comptoir — les six cas, rendus", () => {
  it("huit produits en paysage : une grille 4 × 2, huit boîtes, huit prix", () => {
    const html = rendre(scene({ products: Array.from({ length: 8 }, () => produit()) }));
    expect(html).toContain('data-disposition="g4x2"');
    expect(compter(html, 'class="ct-tile ct-it"')).toBe(8);
    expect(compter(html, 'class="ct-badge"')).toBe(8);
  });

  it("neuf produits sur un panneau libre : les huit premiers, jamais une neuvième ligne", () => {
    const html = rendre(scene({ kind: "custom", products: Array.from({ length: 9 }, () => produit()) }));
    expect(compter(html, 'class="ct-tile ct-it"')).toBe(8);
  });

  it("une sélection de cinq : un héros et quatre lignes latérales", () => {
    const html = rendre(scene({ kind: "featured", products: Array.from({ length: 5 }, () => produit()) }));
    expect(html).toContain('data-disposition="featured"');
    expect(compter(html, 'class="ct-hero ct-it"')).toBe(1);
    expect(compter(html, 'class="ct-srow ct-it"')).toBe(4);
  });

  it("un produit qui porte le nom de la scène ne l'écrit pas deux fois", () => {
    const html = rendre(scene({ title: "Le Boss", products: [produit({ name: "Le Boss" })] }));
    expect(html).toContain('data-disposition="hero"');
    expect(html).not.toContain("ct-name-hero");
    expect(html).toContain("Steak, cheddar, oignons");
  });

  it("une rupture reste affichée, atténuée et dite — jamais retirée", () => {
    const html = rendre(scene({ products: [produit({ name: "Black Burger", outOfStock: true }), produit()] }));
    expect(html).toContain("Black Burger");
    expect(html).toContain('data-oos="1"');
    expect(html).toContain("Épuisé");
  });

  it("les offres : au plus trois, en aplat vert", () => {
    const promos = Array.from({ length: 5 }, (_, i) => ({
      id: `o${i}`,
      title: `Offre ${i}`,
      description: "",
      label: "−20 %",
    }));
    const html = rendre(scene({ kind: "promo", title: "Offres du moment", promos }));
    expect(html).toContain('data-disposition="promo"');
    expect(compter(html, 'class="ct-promo ct-it"')).toBe(3);
  });

  it("fermé : le nom, la réouverture et ses créneaux", () => {
    const html = rendre(
      scene({
        kind: "closed",
        title: "Fermé",
        nextOpening: { dayLabel: "Demain", date: "2026-09-06", windows: ["11:30 – 14:30"], opensAt: "" },
      }),
    );
    expect(html).toContain('data-disposition="closed"');
    expect(html).toContain("Réouverture Demain");
    expect(html).toContain("11:30 – 14:30");
    expect(html).toContain("Chez Nino");
  });

  it("une liste vide : la plaque de marque, jamais un écran noir", () => {
    const html = rendre(scene({ kind: "custom", title: "Bienvenue", subtitle: "Carte en cours de préparation" }));
    expect(html).toContain('data-disposition="empty"');
    expect(html).toContain("Bienvenue");
    expect(html).toContain("Carte en cours de préparation");
  });

  it("en portrait, huit produits font une liste de huit lignes", () => {
    const html = rendre(scene({ products: Array.from({ length: 8 }, () => produit()) }), "portrait");
    expect(html).toContain('data-disposition="list"');
    expect(compter(html, 'class="ct-row ct-it"')).toBe(8);
  });

  it("le prix ne passe jamais par le fondu : un span nu, sans data-fade", () => {
    const html = rendre(scene({ products: [produit({ priceLabel: "12,50 €" }), produit()] }));
    expect(html).toContain('<span class="ct-badge">12,50 €</span>');
    // Le nom, lui, est un texte fondu.
    expect(html).toMatch(/<h3 class="ct-name" data-fade="0">Produit \d+<\/h3>/);
  });
});
