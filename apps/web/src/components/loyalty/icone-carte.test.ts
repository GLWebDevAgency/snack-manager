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
  COTE_LOGO_MASQUABLE,
  FORMES_ICONE,
  RATIO_ZONE_SURE,
  TAILLE,
  boiteDuContenu,
  couleursDe,
  dessinerIconeCarte,
  dessinerIconeLogo,
  echelle,
  formeDemandee,
  hrefIncorporable,
  rayonDuContenu,
} from "./icone-carte";

/**
 * Les six directions, plus un tenant NON REPRIS (masque de repli) dont l'accent
 * est celui d'un vrai restaurant — le cas du pilote. Au niveau du module : les
 * deux dessins, la pile de cartes et l'icône composée, s'y mesurent.
 */
const masques: ReadonlyArray<[string, Brand]> = [
  ...PRESET_KEYS.map((cle) => [cle, DIRECTIONS[cle]] as [string, Brand]),
  ["repli · accent safran", marqueDeRepli("#e07a1f", null)],
  ["repli · accent sombre", marqueDeRepli("#2b1a10", null)],
];

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

/**
 * L'ICÔNE COMPOSÉE AVEC LE LOGO DU RESTAURATEUR.
 *
 * Ce qui se prouve ici est ce qu'aucun regard ne rattrape après coup : un logo
 * hors de la zone sûre est un logo tranché sur un téléphone qu'on ne verra
 * jamais, et un `href` mal borné est une injection dans un balisage qu'on
 * injecte nous-mêmes dans l'administration.
 */
describe("l’icône masquable composée avec le logo", () => {
  const LOGO = "data:image/webp;base64,UklGRhoAAABXRUJQ";
  const svg = (brand: Brand = DIRECTIONS.nuit, href = LOGO) => {
    const rendu = dessinerIconeLogo(brand, href);
    expect(rendu, "l’adresse aurait dû être acceptée").not.toBeNull();
    return rendu!;
  };

  it("inscrit le logo dans la zone sûre, coins compris", () => {
    /*
     * Le carré ne suffit pas : ce sont ses COINS qui sortent d'un cercle. On
     * mesure donc la demi-diagonale, seule distance qui décide.
     */
    const demiDiagonale = (COTE_LOGO_MASQUABLE * Math.SQRT2) / 2;
    expect(demiDiagonale).toBeLessThanOrEqual((TAILLE * RATIO_ZONE_SURE) / 2);
    // …et sans rapetisser le logo pour rien : même empreinte que notre dessin.
    expect(demiDiagonale).toBeCloseTo(rayonDuContenu() * echelle("masquable"), 6);
  });

  it("AJUSTE le logo, ne le recadre jamais", () => {
    /*
     * `meet` centre l'image dans sa boîte sans la couper ; `slice` la
     * remplirait en rognant. C'est la règle que l'éditeur de marque écrit déjà :
     * un logo recadré n'est plus un logo.
     */
    expect(svg()).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg()).not.toContain("slice");
  });

  it("remplit tout le canevas du fond du masque — aucun vide à rogner", () => {
    expect(svg()).toContain(
      `<rect width="512" height="512" fill="${DIRECTIONS.nuit.palette.ground}"/>`,
    );
    // Pas de tuile arrondie : c'est le lanceur qui découpe, pas nous.
    expect(svg()).not.toMatch(/<rect width="512" height="512" rx=/);
  });

  it("ne dépend d’aucune police non plus, et ne peint aucune carte", () => {
    for (const [, brand] of masques) {
      const rendu = svg(brand);
      expect(rendu).not.toMatch(/<text|font-family|font-size|textPath/);
      expect(rendu).not.toContain("NaN");
      // Le dessin généré occupe déjà tout le rayon sûr : pas de pile ici.
      expect(rendu).not.toContain("<path");
      expect(rendu.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(rendu.endsWith("</svg>")).toBe(true);
    }
  });

  it("refuse un SVG incorporé — un SVG dans un SVG rouvre tout le format", () => {
    expect(hrefIncorporable("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(false);
    expect(dessinerIconeLogo(DIRECTIONS.nuit, "data:image/svg+xml,%3Csvg/%3E")).toBeNull();
  });

  it("refuse tout ce qui n’est ni une image raster en ligne ni une adresse http(s)", () => {
    for (const refuse of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "data:text/html;base64,PGgxPg==",
      "data:image/png;base64,\"><script>alert(1)</script>",
      "data:image/png;utf8,AAAA",
      "/relatif/logo.png",
      "",
    ]) {
      expect(hrefIncorporable(refuse), refuse).toBe(false);
      expect(dessinerIconeLogo(DIRECTIONS.nuit, refuse), refuse).toBeNull();
    }
  });

  it("accepte l’adresse http(s) de l’aperçu, et l’échappe dans l’attribut", () => {
    /*
     * L'aperçu de l'administration injecte ce balisage DANS le document et
     * passe l'URL telle quelle : c'est la seule valeur non numérique du
     * fichier, donc la seule à échapper. Une esperluette d'URL signée ne doit
     * ni casser le XML ni ouvrir de balise.
     */
    const url = 'https://api.exemple.fr/public/medias/t1/9f2c?a=1&b=2"x';
    const rendu = svg(DIRECTIONS.nuit, url);
    expect(rendu).toContain("?a=1&amp;b=2&quot;x");
    expect(rendu).not.toContain('&b=2"x');
  });

  it("laisse le dessin généré intact — la pile de cartes n’a pas bougé", () => {
    // Les deux fonctions coexistent : le rôle `plein` et le repli s'en servent.
    expect(dessinerIconeCarte(DIRECTIONS.nuit, "masquable")).toContain("<path");
    expect(dessinerIconeCarte(DIRECTIONS.nuit, "masquable")).not.toContain("<image");
  });
});
