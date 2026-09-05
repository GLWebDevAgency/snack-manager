import type { CSSProperties } from "react";
import type { ScreenOrientation, ScreenScenePayload } from "@sm/contracts";

/**
 * COMPTOIR — les règles de composition, pures.
 *
 * Tout est en pixels de la RÉSOLUTION DE RÉFÉRENCE (1920 × 1080 / 1080 × 1920) :
 * l'hôte met la scène à l'échelle, la scénographie ne connaît jamais le
 * téléviseur. La table des tailles respecte les planchers à huit lignes et
 * monte dès qu'il y a moins de produits — une catégorie de deux se lit d'un
 * mètre plus loin qu'une catégorie de huit.
 */

export type Disposition =
  | "closed"
  | "promo"
  | "empty"
  | "hero"
  | "featured"
  | "g2x1"
  | "g3x1"
  | "g4x1"
  | "g3x2"
  | "g4x2"
  | "stack2"
  | "g2x2"
  | "list";

export function disposition(
  kind: ScreenScenePayload["kind"],
  count: number,
  o: ScreenOrientation,
): Disposition {
  if (kind === "closed") return "closed";
  if (kind === "promo") return "promo";
  if (count <= 0) return "empty";
  if (count === 1) return "hero";
  if (kind === "featured") return "featured";
  if (o === "landscape") {
    if (count === 2) return "g2x1";
    if (count === 3) return "g3x1";
    if (count === 4) return "g4x1";
    return count <= 6 ? "g3x2" : "g4x2";
  }
  if (count === 2) return "stack2";
  return count <= 4 ? "g2x2" : "list";
}

export interface Tailles {
  nom: number;
  desc: number;
  prix: number;
  titre: number;
  libelle: number;
  nomHeros: number;
  prixHeros: number;
}

/** Les planchers du produit — huit lignes, lues à quatre mètres. */
export const PLANCHERS: Record<
  ScreenOrientation,
  { nom: number; desc: number; prix: number; titre: number }
> = {
  landscape: { nom: 42, desc: 24, prix: 46, titre: 76 },
  portrait: { nom: 56, desc: 30, prix: 62, titre: 96 },
};

type Ligne = [
  nom: number,
  desc: number,
  prix: number,
  titre: number,
  libelle: number,
  nomHeros?: number,
  prixHeros?: number,
];

const TABLE: Record<ScreenOrientation, Partial<Record<Disposition, Ligne>>> = {
  landscape: {
    g4x2: [42, 24, 46, 80, 20],
    g3x2: [46, 26, 52, 84, 20],
    g4x1: [54, 30, 60, 90, 22],
    g3x1: [58, 30, 64, 90, 22],
    g2x1: [66, 34, 72, 96, 24],
    hero: [96, 38, 110, 96, 26],
    featured: [42, 30, 46, 80, 20, 72, 84],
    promo: [44, 28, 52, 112, 26, 60, 84],
    closed: [56, 36, 46, 96, 26],
    empty: [42, 24, 46, 80, 20],
  },
  portrait: {
    list: [56, 30, 62, 96, 24],
    g2x2: [60, 32, 68, 100, 26],
    stack2: [72, 36, 80, 104, 28],
    hero: [104, 40, 120, 104, 30],
    featured: [56, 34, 62, 96, 24, 80, 96],
    promo: [56, 32, 62, 128, 30, 68, 96],
    closed: [64, 40, 62, 112, 30],
    empty: [56, 30, 62, 96, 24],
  },
};

export function tailles(o: ScreenOrientation, d: Disposition): Tailles {
  const ligne = TABLE[o][d] ?? TABLE[o].empty!;
  const [nom, desc, prix, titre, libelle, nomHeros, prixHeros] = ligne;
  return {
    nom,
    desc,
    prix,
    titre,
    libelle,
    nomHeros: nomHeros ?? nom,
    prixHeros: prixHeros ?? prix,
  };
}

/** Hauteur de référence du CORPS (sous l'en-tête, au-dessus de la marge basse). */
const CORPS: Record<ScreenOrientation, number> = { landscape: 740, portrait: 1522 };
/** En portrait, la sélection pose son héros sur 760 px, puis 24 px d'écart. */
const HEROS_PORTRAIT = 760 + 24;
const INTERLIGNE_LISTE = 16;
const INTERLIGNE_LATERALE = 12;

export function vignettes(
  o: ScreenOrientation,
  d: Disposition,
  count: number,
): { liste: number; laterale: number } {
  const corps = CORPS[o];
  const n = Math.max(1, count);
  const liste =
    d === "list" ? Math.min(240, Math.round((corps - (n - 1) * INTERLIGNE_LISTE) / n)) : 0;
  let laterale = 0;
  if (d === "featured") {
    const m = Math.max(1, n - 1);
    const cote = o === "landscape" ? corps : corps - HEROS_PORTRAIT;
    const rangee = (cote - (m - 1) * INTERLIGNE_LATERALE) / m;
    laterale = Math.max(56, Math.min(120, Math.round(rangee - 18)));
  }
  return { liste, laterale };
}

export function variablesDeScene(
  o: ScreenOrientation,
  d: Disposition,
  count: number,
): CSSProperties {
  const t = tailles(o, d);
  const v = vignettes(o, d, count);
  return {
    "--ct-fs-nom": `${t.nom}px`,
    "--ct-fs-desc": `${t.desc}px`,
    "--ct-fs-prix": `${t.prix}px`,
    "--ct-fs-titre": `${t.titre}px`,
    "--ct-fs-libelle": `${t.libelle}px`,
    "--ct-fs-heros-nom": `${t.nomHeros}px`,
    "--ct-fs-heros-prix": `${t.prixHeros}px`,
    "--ct-thumb": `${v.liste || 176}px`,
    "--ct-sthumb": `${v.laterale || 76}px`,
    "--ct-n": count,
    "--ct-m": Math.max(1, count - 1),
  } as CSSProperties;
}
