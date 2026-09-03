import { describe, expect, it } from "vitest";
import { catalogueMedias, type MediaVue } from "@sm/contracts";
import { deplacer, produitsSansPhoto } from "./photos";

describe("l'ordre des photos d'un plat", () => {
  const trois = ["a", "b", "c"] as const;

  it("promeut une photo en principale — c'est la première qui compte", () => {
    expect(deplacer(trois, 1, -1)).toEqual(["b", "a", "c"]);
    expect(deplacer(trois, 2, -1)).toEqual(["a", "c", "b"]);
  });

  it("recule une photo", () => {
    expect(deplacer(trois, 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("rend la liste inchangée plutôt que tronquée hors des bornes", () => {
    // Une flèche grisée reste atteignable au clavier : le pas doit être sûr.
    expect(deplacer(trois, 0, -1)).toEqual(["a", "b", "c"]);
    expect(deplacer(trois, 2, 1)).toEqual(["a", "b", "c"]);
    expect(deplacer(trois, 7, -1)).toEqual(["a", "b", "c"]);
  });
});

// ─────────────────────────────────────────────────────────────
// Le compteur du bandeau
// ─────────────────────────────────────────────────────────────

const media = (id: string): MediaVue => ({
  id,
  genre: "photo",
  empreinte: "0".repeat(32),
  type: "image/jpeg",
  octets: 120_000,
  largeur: 1600,
  hauteur: 1200,
  point: { x: 0.5, y: 0.5 },
  alt: "",
  stockage: "objet",
  origine: "depot",
  auteur: null,
  deposeLe: null,
  urls: {
    vignette: `https://api.test/public/medias/t1/${id}`,
    carte: `https://api.test/public/medias/t1/${id}`,
    fiche: `https://api.test/public/medias/t1/${id}`,
    bandeau: `https://api.test/public/medias/t1/${id}`,
  },
  utilisePar: 1,
});

describe("le compte des plats sans photo", () => {
  const catalogue = catalogueMedias([media("m1")]);

  it("compte les plats qui n'ont RIEN à montrer", () => {
    const n = produitsSansPhoto(
      [{ medias: ["m1"] }, { medias: [] }, { medias: [] }],
      catalogue,
    );
    expect(n).toBe(2);
  });

  it("ne compte pas les dix-neuf plats du pilote, qui ont bien une photo", () => {
    // Leur photo vit dans la chaîne héritée, pas dans un média. Les signaler
    // comme manquants enverrait le gérant chercher un problème inexistant.
    expect(produitsSansPhoto([{ medias: [], photoUrl: "/photos/kebab.webp" }], catalogue)).toBe(0);
  });

  it("compte un plat dont le média a disparu — c'est ce que le mangeur voit", () => {
    expect(produitsSansPhoto([{ medias: ["parti"] }], catalogue)).toBe(1);
  });

  it("ne se laisse pas berner par une adresse à protocole relatif", () => {
    // `//ailleurs.fr/x` commence par une barre oblique mais désigne un hôte
    // tiers : `photoHeritee` le refuse, ce plat n'a donc pas de photo servable.
    expect(produitsSansPhoto([{ medias: [], photoUrl: "//ailleurs.fr/x.jpg" }], catalogue)).toBe(1);
  });
});
