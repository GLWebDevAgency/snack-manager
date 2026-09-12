import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_LARGEUR_CIBLE } from "@sm/contracts";
import { apercuIllustration, creerFichierIllustration, FAMILLES_ILLUSTRATIONS, filtrerIllustrations, illustrations, svgIllustration } from "./illustrations";

afterEach(() => vi.unstubAllGlobals());

describe("bibliothèque d'illustrations", () => {
  it("propose les 41 illustrations du registre une seule fois dans leurs familles", () => {
    const cles = FAMILLES_ILLUSTRATIONS.flatMap((f) => [...f.cles]);
    expect(illustrations).toHaveLength(41);
    expect(new Set(cles).size).toBe(cles.length);
    expect([...cles].sort()).toEqual(illustrations.map((a) => a.id).sort());
  });

  it("recherche sans accents ni casse et combine recherche et famille", () => {
    expect(filtrerIllustrations("  THAI  ").map((a) => a.id)).toContain("pad-thai");
    expect(filtrerIllustrations("vegetarienne", "pizzas").map((a) => a.id)).toEqual(["pizza-vegetarian"]);
    expect(filtrerIllustrations("tiramisu", "boissons")).toEqual([]);
    expect(filtrerIllustrations("inconnue")).toEqual([]);
  });

  it("une recherche vide garde l'ensemble et une famille inconnue ne montre rien", () => {
    expect(filtrerIllustrations(" ")).toHaveLength(41);
    expect(filtrerIllustrations("", "inconnue")).toEqual([]);
  });

  it("garde des sources déterministes, sans source externe, et refuse les clés non autorisées", () => {
    expect(svgIllustration("samosa")).toBe(svgIllustration("samosa"));
    expect(apercuIllustration("burger")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    for (const asset of illustrations) {
      const svg = svgIllustration(asset.id);
      expect(svg).not.toMatch(/<script|foreignObject|\son[a-z]+=|https?:\/\/(?!www\.w3\.org)/i);
      expect(svg).toContain('viewBox="0 0 240 165"');
    }
    expect(() => svgIllustration("__proto__")).toThrow("pas disponible");
    expect(() => apercuIllustration("https://example.test/asset.svg")).toThrow("pas disponible");
  });
});

function navigateur({ echecImage = false, contexteAbsent = false, png = new Blob(["png-test"], { type: "image/png" }) }: {
  echecImage?: boolean;
  contexteAbsent?: boolean;
  png?: Blob | null;
} = {}) {
  const dessiner = vi.fn();
  const canevas = { width: 0, height: 0, getContext: vi.fn(() => contexteAbsent ? null : { drawImage: dessiner }), toBlob: vi.fn((done: BlobCallback) => done(png)) };
  const creerURL = vi.fn((source: Blob) => { void source; return "blob:illustration-locale"; }), retirerURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: creerURL, revokeObjectURL: retirerURL });
  vi.stubGlobal("document", { createElement: vi.fn(() => canevas) });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_valeur: string) { queueMicrotask(() => echecImage ? this.onerror?.() : this.onload?.()); }
  });
  return { canevas, dessiner, creerURL, retirerURL };
}

describe("préparation locale pour le dépôt existant", () => {
  it("produit un fichier PNG aux dimensions du contrat et libère la source SVG", async () => {
    const { canevas, dessiner, creerURL, retirerURL } = navigateur();
    const fichier = await creerFichierIllustration("pizza-chicken");
    expect(fichier).toBeInstanceOf(File);
    expect(fichier.name).toBe("illustration-pizza-chicken.png");
    expect(fichier.type).toBe("image/png");
    expect(canevas.width).toBe(MEDIA_LARGEUR_CIBLE);
    expect(canevas.height).toBe(MEDIA_LARGEUR_CIBLE * 165 / 240);
    expect(dessiner).toHaveBeenCalledOnce();
    expect(creerURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(retirerURL).toHaveBeenCalledWith("blob:illustration-locale");
  });

  it("ne prépare aucune URL pour une clé arbitraire", async () => {
    const { creerURL } = navigateur();
    await expect(creerFichierIllustration("<svg/>" )).rejects.toThrow("pas disponible");
    expect(creerURL).not.toHaveBeenCalled();
  });

  it.each([
    { echecImage: true },
    { contexteAbsent: true },
    { png: null },
    { png: new Blob(["autre"], { type: "image/jpeg" }) },
  ])("refuse une préparation incomplète et libère toujours la source (%o)", async (options) => {
    const { retirerURL } = navigateur(options);
    await expect(creerFichierIllustration("burger")).rejects.toThrow();
    expect(retirerURL).toHaveBeenCalledWith("blob:illustration-locale");
  });
});
