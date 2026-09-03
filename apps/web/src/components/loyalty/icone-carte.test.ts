import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  PRESET_KEYS,
  WCAG_AA,
  WCAG_AA_NON_TEXTE,
  luminance,
  marqueDeRepli,
  ratioContraste,
  type Brand,
} from "@sm/contracts";
import {
  FORMES_ICONE,
  RATIO_ZONE_SURE,
  TAILLE,
  boiteDuContenu,
  couleursDe,
  dessinerIconeCarte,
  echelle,
  formeDemandee,
  rayonDuContenu,
} from "./icone-carte";

/**
 * CE QUI SE PROUVE SANS NAVIGATEUR — et c'est presque tout.
 *
 * Une icône de lanceur ne se relit jamais après l'installation : on ne peut pas
 * la corriger chez le client. Ce qui la rendrait illisible se mesure donc ici,
 * avant la livraison — la géométrie (est-elle dans la zone que le lanceur
 * promet de ne pas rogner ?) et le contraste (la carte se détache-t-elle de son
 * propre fond sur les SIX directions ?).
 *
 * Ce que ce fichier ne peut PAS juger, et qu'il ne prétend pas juger : est-ce
 * que c'est beau. Cela s'est regardé à l'écran, aux tailles réelles.
 */
describe("l’icône de lancement de la carte", () => {
  it("tient dans la zone sûre que la spécification masquable garantit", () => {
    /*
     * Le lanceur Android applique SA découpe — cercle, carré arrondi, goutte.
     * Seul le cercle centré de 80 % du côté est garanti visible. Tout le
     * dessin, ombre portée et liseré compris, doit y tenir.
     */
    const rayonSur = (TAILLE * RATIO_ZONE_SURE) / 2;
    const rayonPeint = rayonDuContenu() * echelle("masquable");
    expect(rayonPeint).toBeLessThanOrEqual(rayonSur);
    // …et sans y perdre l'icône : moins de 10 % de retrait sous la garantie.
    expect(rayonPeint).toBeGreaterThan(rayonSur * 0.9);
  });

  it("dessine PLUS GRAND en rôle `any` — c’est toute la raison des deux entrées", () => {
    /*
     * Une icône `any` n'est pas rognée : lui laisser la marge masquable la
     * ferait paraître plus petite que ses voisines sur l'écran d'accueil. Si
     * cet écart disparaissait, les deux entrées du manifeste ne serviraient
     * plus à rien.
     */
    expect(echelle("plein")).toBeGreaterThan(echelle("masquable") * 1.1);
  });

  it("ne déborde jamais de sa propre tuile en rôle `any`", () => {
    const boite = boiteDuContenu();
    const k = echelle("plein");
    expect(boite.largeur * k).toBeLessThanOrEqual(TAILLE);
    expect(boite.hauteur * k).toBeLessThanOrEqual(TAILLE);
  });

  /**
   * Les six directions, plus un tenant NON REPRIS (masque de repli) dont
   * l'accent est celui d'un vrai restaurant — le cas du pilote.
   */
  const masques: ReadonlyArray<[string, Brand]> = [
    ...PRESET_KEYS.map((cle) => [cle, DIRECTIONS[cle]] as [string, Brand]),
    ["repli · accent safran", marqueDeRepli("#e07a1f", null)],
    ["repli · accent sombre", marqueDeRepli("#2b1a10", null)],
  ];

  it.each(masques)("détache la carte de son fond sur %s", (_nom, brand) => {
    const c = couleursDe(brand);
    /*
     * LE COUPLE QUI PORTE L'OBJET. Sans liseré, l'accent Soleil (safran) sur
     * le fond Soleil (sable) mesure 2,2:1 : la carte se dissout dans le
     * canevas et il ne reste qu'une tache. Le liseré est un ÉLÉMENT, pas du
     * texte — 3:1 est son plancher (WCAG 1.4.11).
     */
    expect(ratioContraste(c.liseré, c.fond)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXTE);
  });

  it.each(masques)("garde les tampons lisibles sur la carte, sur %s", (_nom, brand) => {
    const c = couleursDe(brand);
    /*
     * Les tampons sont la seule FIGURE du dessin : s'ils s'effacent, il ne
     * reste qu'un rectangle coloré. Ils sont peints en `onAccent`, dont le
     * contrat prouve déjà l'AA sur l'accent — mais la carte est un DÉGRADÉ,
     * donc on mesure sur ses deux extrémités réelles, pas sur l'accent nu.
     */
    expect(ratioContraste(c.tampon, c.hautDeCarte)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(ratioContraste(c.tampon, c.basDeCarte)).toBeGreaterThanOrEqual(WCAG_AA);
  });

  it.each(masques)("sépare la carte du dessous du fond, sur %s", (_nom, brand) => {
    const c = couleursDe(brand);
    /*
     * La pile est la « matière » de l'icône : si la carte du dessous a la
     * valeur du fond, il n'y a plus de pile, juste une carte. C'est le cas de
     * Marché, dont `surface` (#f4f8f4) et `ground` (#ffffff) sont presque
     * égaux. 1,08 est le seuil que le masque s'impose déjà entre deux surfaces
     * adjacentes (`marque.test.ts`, tuile/fond).
     */
    expect(ratioContraste(c.dessous, c.fond)).toBeGreaterThanOrEqual(1.08);
  });

  it.each(masques)("éclaire le haut et ombre le bas, sur %s", (_nom, brand) => {
    const c = couleursDe(brand);
    /*
     * La lumière tombe d'en haut, sur les six directions — y compris celles
     * dont l'encre est CLAIRE (Néon, Nuit). C'est la raison pour laquelle
     * `couleursDe` déduit ses pôles des luminances et non de `mode` : avec
     * l'étiquette, la « lumière » de Néon serait devenue une ombre.
     */
    expect(luminance(c.hautDeCarte)).toBeGreaterThan(luminance(c.basDeCarte));
  });

  it.each(masques)("ne dépend d’AUCUNE police, sur %s", (_nom, brand) => {
    for (const forme of FORMES_ICONE) {
      const svg = dessinerIconeCarte(brand, forme);
      /*
       * Le défaut d'origine : l'initiale du restaurant posée en `system-ui`.
       * Un lanceur qui ne charge pas de fonte rendait alors un disque nu. Il
       * ne doit plus rester ni `<text>`, ni `font-`, ni `textPath`.
       */
      expect(svg).not.toMatch(/<text|font-family|font-size|textPath/);
    }
  });

  it("rend deux fichiers DIFFÉRENTS, tous deux bien formés", () => {
    const brand = DIRECTIONS.nuit;
    const plein = dessinerIconeCarte(brand, "plein");
    const masquable = dessinerIconeCarte(brand, "masquable");
    expect(plein).not.toBe(masquable);
    for (const svg of [plein, masquable]) {
      expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      // Aucune valeur `NaN` échappée d'un calcul de géométrie.
      expect(svg).not.toContain("NaN");
    }
    /*
     * Le fond MASQUABLE couvre tout le carré : un lanceur qui rogne en goutte
     * ne doit jamais tomber sur de la transparence. Le fond `plein`, lui,
     * porte sa propre tuile arrondie — donc un `rx`.
     */
    expect(masquable).toContain(`<rect width="512" height="512" fill="${DIRECTIONS.nuit.palette.ground}"/>`);
    expect(plein).toMatch(/<rect width="512" height="512" rx="[\d.]+"/);
  });

  it("suit la FORME du masque — un restaurant `net` n’a pas les angles d’un `rond`", () => {
    const angles = (shape: Brand["shape"]) =>
      dessinerIconeCarte({ ...DIRECTIONS.nuit, shape }, "plein");
    expect(angles("net")).not.toBe(angles("rond"));
    expect(angles("doux")).not.toBe(angles("rond"));
  });

  it("ne prend le rôle masquable que sur le mot exact", () => {
    expect(formeDemandee("masquable")).toBe("masquable");
    // Tout le reste retombe sur `plein` : cette URL nue sert aussi de favicon.
    for (const entree of [null, "", "plein", "MASQUABLE", "any", "../../etc"]) {
      expect(formeDemandee(entree)).toBe("plein");
    }
  });
});
