import { describe, expect, it } from "vitest";
import {
  MEDIA_LARGEUR_CIBLE,
  MEDIA_MAX_OCTETS,
  type QuotaMedias,
} from "@sm/contracts";
import {
  cotesReduites,
  etatDuQuota,
  nomDeSortie,
  planifierDepot,
  poids,
  reduirePourEnvoi,
} from "./photos";

/*
 * DES IMAGES HONNÊTES, AVEC DES COTES CONNUES.
 *
 * Mêmes en-têtes que `medias.test.ts` côté API, et c'est délibéré : les deux
 * surfaces jugent les mêmes octets avec la même fonction, un fichier admis
 * ici doit l'être là-bas. Ce ne sont pas des images valides pour un décodeur —
 * elles n'ont pas à l'être : `detecterImage` et `dimensionsImage` ne lisent
 * que l'en-tête, et c'est tout ce que la décision de dépôt regarde.
 */
function png(largeur: number, hauteur: number, octets = 32) {
  const entete = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(entete, 0);
  entete.writeUInt32BE(13, 8);
  entete.write("IHDR", 12, "latin1");
  entete.writeUInt32BE(largeur, 16);
  entete.writeUInt32BE(hauteur, 20);
  // `Uint8Array.from` et non le Buffer brut : un `Buffer` n'est pas un
  // `BlobPart` aux yeux de TypeScript (son tampon peut être partagé), et ces
  // octets servent aussi à fabriquer un `File`.
  return Uint8Array.from(Buffer.concat([entete, Buffer.alloc(octets, 1)]));
}

function jpeg(largeur: number, hauteur: number, octets = 16) {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(hauteur, 5);
  sof.writeUInt16BE(largeur, 7);
  return Uint8Array.from(Buffer.concat([app0, sof, Buffer.alloc(octets, 7)]));
}

/** Un JPEG dont la trame n'arrive jamais : format sûr, cotes inconnues. */
function jpegSansTrame() {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(0xffd8, 0);
  b.writeUInt16BE(0xffe0, 2);
  b.writeUInt16BE(16, 4);
  return Uint8Array.from(b);
}

function webp(largeur: number, hauteur: number) {
  const b = Buffer.alloc(29);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(21, 4);
  b.write("WEBP", 8, "latin1");
  b.write("VP8L", 12, "latin1");
  b.writeUInt32LE(9, 16);
  b.writeUInt8(0x2f, 20);
  b.writeUInt32LE(((hauteur - 1) << 14) | (largeur - 1), 21);
  return Uint8Array.from(b);
}

describe("les cotes visées par la réduction", () => {
  it("ramène un cliché de téléphone à la largeur cible en gardant le ratio", () => {
    // 4032 × 3024, le capteur d'un iPhone en 4:3 — le cas de référence.
    expect(cotesReduites({ largeur: 4032, hauteur: 3024 })).toEqual({
      largeur: MEDIA_LARGEUR_CIBLE,
      hauteur: 1200,
    });
  });

  it("garde le portrait debout : c'est la largeur qui est bornée, pas le grand côté", () => {
    // Le même capteur tenu verticalement. Borner le GRAND côté produirait une
    // photo de 1600 de haut et 1200 de large : deux fois moins de définition
    // que la même scène en paysage, pour la même surface affichée.
    expect(cotesReduites({ largeur: 3024, hauteur: 4032 })).toEqual({
      largeur: MEDIA_LARGEUR_CIBLE,
      hauteur: 2133,
    });
  });

  it("N'AGRANDIT JAMAIS une image déjà plus petite", () => {
    // Étirer n'ajoute aucune information : ça alourdit le fichier que tous les
    // clients téléchargent et rend flou ce qui était net.
    expect(cotesReduites({ largeur: 800, hauteur: 600 })).toEqual({ largeur: 800, hauteur: 600 });
    expect(cotesReduites({ largeur: MEDIA_LARGEUR_CIBLE, hauteur: 900 })).toEqual({
      largeur: MEDIA_LARGEUR_CIBLE,
      hauteur: 900,
    });
  });

  it("ne rend jamais une hauteur nulle, même sur un panorama extrême", () => {
    // 8000 × 300 donnerait 60 px par la règle de trois — mais 8000 × 3 donne
    // 0,6, arrondi à zéro : un canevas de hauteur nulle ne rend aucun blob.
    expect(cotesReduites({ largeur: 8000, hauteur: 3 })).toEqual({
      largeur: MEDIA_LARGEUR_CIBLE,
      hauteur: 1,
    });
  });

  it("laisse passer une cote absurde plutôt que d'inventer un nombre", () => {
    expect(cotesReduites({ largeur: 0, hauteur: 0 })).toEqual({ largeur: 0, hauteur: 0 });
  });
});

describe("le plan de dépôt", () => {
  it("refuse ce qui n'est pas une image AVANT tout décodage", () => {
    const plan = planifierDepot(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "carte.pdf");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/PNG, JPEG ou WebP/);
  });

  it("nomme le vrai problème d'un HEIC d'iPhone plutôt que « format non reconnu »", () => {
    // Le format par défaut du téléphone du restaurateur. « Non reconnu » le
    // laisserait sans issue ; le réglage qui le débloque tient en une phrase.
    const plan = planifierDepot(new Uint8Array(16), "IMG_4821.HEIC");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/Plus compatible/);
  });

  it("reconnaît les trois formats admis par leurs octets, pas par leur nom", () => {
    // Le fichier s'appelle « .txt » : seuls les octets décident.
    expect(planifierDepot(png(1200, 900), "photo.txt")).toMatchObject({
      ok: true,
      type: "image/png",
    });
    expect(planifierDepot(jpeg(640, 480), "photo.txt")).toMatchObject({
      ok: true,
      type: "image/jpeg",
    });
    expect(planifierDepot(webp(800, 600), "photo.txt")).toMatchObject({
      ok: true,
      type: "image/webp",
    });
  });

  it("laisse une photo déjà aux cotes partir INTACTE", () => {
    // Ré-encoder dégraderait pour rien — et changerait l'empreinte, donc le
    // dédoublonnage ne reconnaîtrait plus un fichier déjà déposé.
    const plan = planifierDepot(png(1200, 900), "plat.png");
    expect(plan).toMatchObject({
      ok: true,
      reduire: false,
      source: { largeur: 1200, hauteur: 900 },
      cible: { largeur: 1200, hauteur: 900 },
    });
  });

  it("réduit un cliché trop LARGE, même s'il est léger", () => {
    const plan = planifierDepot(jpeg(4032, 3024), "IMG_4821.jpg");
    expect(plan).toMatchObject({
      ok: true,
      reduire: true,
      cible: { largeur: MEDIA_LARGEUR_CIBLE, hauteur: 1200 },
    });
  });

  it("réduit un fichier trop LOURD, même s'il tient déjà dans la largeur", () => {
    // Un PNG de 1200 px peut peser trois mégaoctets : la largeur est bonne,
    // le poids ne l'est pas, et c'est le poids qui part sur le forfait mobile.
    const lourd = png(1200, 900, MEDIA_MAX_OCTETS);
    const plan = planifierDepot(lourd, "plat.png");
    expect(plan).toMatchObject({ ok: true, reduire: true });
  });

  it("ne bloque pas un dépôt parce qu'on n'a pas su lire les cotes", () => {
    // L'en-tête ne livre pas toujours la taille (WebP animé, trame lointaine).
    // Ce n'est pas une erreur : léger, le fichier part tel quel ; lourd, le
    // décodage tranchera.
    expect(planifierDepot(jpegSansTrame(), "plat.jpg")).toMatchObject({
      ok: true,
      source: null,
      cible: null,
      reduire: false,
    });
    const lourd = Buffer.concat([jpegSansTrame(), Buffer.alloc(MEDIA_MAX_OCTETS, 3)]);
    expect(planifierDepot(lourd, "plat.jpg")).toMatchObject({ ok: true, reduire: true });
  });
});

/*
 * LES DEUX CHEMINS QUI NE TOUCHENT AUCUN CANEVAS.
 *
 * `reduirePourEnvoi` a besoin d'un navigateur pour DESSINER, mais ses deux
 * sorties les plus importantes n'y arrivent jamais : le refus d'un format, et
 * le fichier qu'on ne réduit pas. Ce sont précisément celles qu'il faut tenir
 * — la seconde porte le dédoublonnage de toute la médiathèque.
 */
describe("l'envoi sans réduction", () => {
  it("rend le fichier d'origine, la MÊME instance, quand rien n'est à réduire", async () => {
    // Pas « un fichier équivalent » : le même. Ré-encoder une image déjà aux
    // cotes lui donnerait d'autres octets, donc une autre empreinte, et la
    // médiathèque cesserait de reconnaître un cliché déjà déposé — le gérant
    // paierait deux fois le même et verrait deux vignettes identiques.
    const fichier = new File([png(1200, 900)], "plat.png", { type: "image/png" });
    const resultat = await reduirePourEnvoi(fichier);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.reduit).toBe(false);
      expect(resultat.fichier).toBe(fichier);
      expect(resultat.cotes).toEqual({ largeur: 1200, hauteur: 900 });
    }
  });

  it("refuse un fichier qui n'est pas une image sans rien décoder", async () => {
    // Aucun canevas n'existe dans cet environnement : si le refus n'arrivait
    // pas AVANT le décodage, ce cas planterait au lieu de rendre un message.
    const resultat = await reduirePourEnvoi(new File([new Uint8Array(16)], "carte.pdf"));
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.message).toMatch(/PNG, JPEG ou WebP/);
  });
});

describe("le nom du fichier envoyé", () => {
  it("porte l'extension du format réellement encodé", () => {
    expect(nomDeSortie("IMG_4821.HEIC", "image/jpeg")).toBe("IMG_4821.jpg");
    expect(nomDeSortie("plat.png", "image/webp")).toBe("plat.webp");
    expect(nomDeSortie("plat.jpeg", "image/jpeg")).toBe("plat.jpg");
  });

  it("retombe sur un nom quand le fichier n'en porte pas", () => {
    expect(nomDeSortie("", "image/png")).toBe("photo.png");
    expect(nomDeSortie(".gitkeep", "image/png")).toBe("photo.png");
  });
});

describe("l'état du quota", () => {
  const quota = (utilises: number): QuotaMedias => ({
    octetsUtilises: utilises,
    octetsMax: 256 * 1024 * 1024,
    medias: 12,
  });

  it("reste muet tant qu'il reste de la place", () => {
    expect(etatDuQuota(quota(10 * 1024 * 1024)).serre).toBe(false);
  });

  it("avertit AVANT la limite, pas au refus", () => {
    expect(etatDuQuota(quota(205 * 1024 * 1024)).serre).toBe(true);
  });

  it("dit deux nombres, pas une jauge", () => {
    expect(etatDuQuota(quota(18 * 1024 * 1024)).phrase).toBe("12 photos · 18 Mo sur 256 Mo");
  });

  it("borne la part et ne rend jamais NaN", () => {
    expect(etatDuQuota({ octetsUtilises: 5, octetsMax: 0, medias: 1 }).part).toBe(1);
    expect(etatDuQuota({ octetsUtilises: 0, octetsMax: 0, medias: 0 }).part).toBe(0);
  });
});

describe("le poids affiché", () => {
  it("parle en kilo-octets sous le mégaoctet, en méga au-dessus", () => {
    expect(poids(384_000)).toBe("375 Ko");
    expect(poids(3_400_000)).toBe("3,2 Mo");
    expect(poids(MEDIA_MAX_OCTETS)).toBe("2 Mo");
  });

  it("ne rend pas un nombre qu'on n'a pas", () => {
    expect(poids(Number.NaN)).toBe("—");
  });
});
