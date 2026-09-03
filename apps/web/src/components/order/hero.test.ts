import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  POINT_CENTRE,
  ratioContraste,
  resoudreMarque,
  WCAG_AA,
  type MediaVue,
  type PresetKey,
} from "@sm/contracts";
import { altDuHero, cadrageDuHero, imageDePartage, mediaDuHero } from "./hero";

const BASE = "https://api.snackmanager.fr";
const ADRESSE = `${BASE}/public/medias/t1/0123456789abcdef0123456789abcdef`;

function media(partiel: Partial<MediaVue> & { id: string; urls: MediaVue["urls"] }): MediaVue {
  return {
    genre: "photo",
    empreinte: "0123456789abcdef0123456789abcdef",
    type: "image/webp",
    octets: 120_000,
    largeur: 1600,
    hauteur: 900,
    point: POINT_CENTRE,
    alt: "",
    stockage: "objet",
    origine: "depot",
    auteur: null,
    deposeLe: null,
    utilisePar: 0,
    ...partiel,
  };
}

const quatreUsages = (url: string): MediaVue["urls"] => ({
  vignette: url,
  carte: url,
  fiche: url,
  bandeau: url,
});

describe("le cadrage de l'image d'accueil", () => {
  it("suit le point du média du restaurant quand l'adresse est la sienne", () => {
    const medias = [
      media({ id: "m1", urls: quatreUsages(ADRESSE), point: { x: 0.2, y: 0.8 } }),
    ];
    expect(mediaDuHero(ADRESSE, medias)?.id).toBe("m1");
    expect(cadrageDuHero(ADRESSE, medias)).toBe("20% 80%");
  });

  it("retombe sur le centre pour une URL collée à la main", () => {
    const medias = [media({ id: "m1", urls: quatreUsages(ADRESSE), point: { x: 0, y: 0 } })];
    expect(mediaDuHero("https://cdn.exemple.fr/salle.jpg", medias)).toBeNull();
    expect(cadrageDuHero("https://cdn.exemple.fr/salle.jpg", medias)).toBe("50% 50%");
  });

  it("reconnaît le média même si les quatre usages divergent un jour", () => {
    // Aujourd'hui `urlMedia` rend la même adresse pour les quatre usages ; le
    // jour où un transformateur les fera diverger, une URL d'accueil déjà
    // stockée ne doit pas perdre son point en silence.
    const medias = [
      media({
        id: "m1",
        point: { x: 0.75, y: 0.35 },
        urls: {
          vignette: `${ADRESSE}?u=vignette`,
          carte: `${ADRESSE}?u=carte`,
          fiche: `${ADRESSE}?u=fiche`,
          bandeau: `${ADRESSE}?u=bandeau`,
        },
      }),
    ];
    expect(cadrageDuHero(`${ADRESSE}?u=fiche`, medias)).toBe("75% 35%");
  });

  it("sans image d'accueil, il n'y a rien à chercher", () => {
    expect(mediaDuHero(null, [media({ id: "m1", urls: quatreUsages(ADRESSE) })])).toBeNull();
  });
});

describe("le texte alternatif de la bande", () => {
  it("reprend celui que le restaurateur a saisi sur son média", () => {
    const medias = [
      media({ id: "m1", urls: quatreUsages(ADRESSE), alt: " La terrasse au coucher du soleil " }),
    ];
    expect(altDuHero(ADRESSE, medias)).toBe("La terrasse au coucher du soleil");
  });

  it("reste vide sans saisie — le nom du restaurant est déjà le h1", () => {
    expect(altDuHero(ADRESSE, [media({ id: "m1", urls: quatreUsages(ADRESSE), alt: "" })])).toBe("");
    expect(altDuHero(ADRESSE, [])).toBe("");
  });
});

describe("l'image de partage", () => {
  it("préfère la photo d'accueil, qui est en paysage", () => {
    expect(imageDePartage(ADRESSE, "https://cdn.exemple.fr/logo.png")).toEqual({
      url: ADRESSE,
      paysage: true,
    });
  });

  it("retombe sur le logo, en annonçant qu'il n'est pas en paysage", () => {
    expect(imageDePartage(null, "https://cdn.exemple.fr/logo.png")).toEqual({
      url: "https://cdn.exemple.fr/logo.png",
      paysage: false,
    });
  });

  it("rend null quand le restaurant n'a ni photo ni logo", () => {
    expect(imageDePartage(null, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Le contraste RÉEL du texte posé sur la bande d'accueil
// ─────────────────────────────────────────────────────────────

/**
 * Compose `rgba(r, g, b, a)` sur un fond opaque et rend le résultat en hex.
 *
 * C'est exactement ce que fait le navigateur quand `--cf-scrim` est peint sur
 * une photo : la composition se fait dans l'espace sRGB, canal par canal.
 */
function composer(voile: string, fond: string): string {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(voile);
  if (!m) throw new Error(`voile illisible : ${voile}`);
  const [r, v, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const sous = [1, 3, 5].map((i) => parseInt(fond.slice(i, i + 2), 16));
  const canal = (haut: number, bas: number) =>
    Math.round(haut * a + (bas ?? 0) * (1 - a))
      .toString(16)
      .padStart(2, "0");
  return `#${canal(r, sous[0] ?? 0)}${canal(v, sous[1] ?? 0)}${canal(b, sous[2] ?? 0)}`;
}

/** Les deux photos extrêmes : rien n'est plus clair, rien n'est plus sombre. */
const PHOTO_CLAIRE = "#ffffff";
const PHOTO_SOMBRE = "#000000";

const CLES = Object.keys(DIRECTIONS) as PresetKey[];

/** Les jetons de texte que porte la bande — état de service, note, rappel. */
const TEXTES = ["--cf-text", "--cf-mut", "--cf-green-t", "--cf-amber-t"] as const;

describe("lisibilité du texte posé sur la bande d'accueil", () => {
  /**
   * LA PLAQUE EST OPAQUE, ET CE TEST DIT POURQUOI.
   *
   * Les pastilles d'état et de note se posent SUR la photo d'accueil. Elles
   * portent `bg-surface` — un aplat plein — et non le voile seul, si bien que
   * le fond réel de leur texte est `--cf-surface` quelle que soit la photo
   * dessous : le couple redevient `ink/surface` et `inkMut/surface`, ceux que
   * `contraste()` vérifie déjà sur les six directions.
   */
  it("le texte des pastilles tient AA sur leur plaque, sur les six directions", () => {
    for (const cle of CLES) {
      const { vars } = resoudreMarque(DIRECTIONS[cle]);
      const surface = vars["--cf-surface"] ?? "";
      for (const jeton of TEXTES) {
        const ratio = ratioContraste(vars[jeton] ?? "", surface);
        expect(ratio, `${cle} · ${jeton} sur --cf-surface : ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(WCAG_AA);
      }
    }
  });

  /**
   * ET VOICI LA MESURE QUI INTERDIT LA PASTILLE TRANSLUCIDE.
   *
   * `--cf-scrim` ASSOMBRIT toujours — c'est son contrat — mais `--cf-text`
   * suit le MODE du restaurant. Sur une direction CLAIRE, l'encre est donc
   * sombre, et une encre sombre posée sur une photo sombre que le voile a
   * encore assombrie ne remonte jamais : 1,13:1 sur Brasserie, 1,31 sur
   * Atelier et Soleil, 1,70 sur Marché (photo noire). Le même couple passe
   * confortablement sur une photo BLANCHE (5,35 à 6,00) — c'est bien la photo,
   * qu'on ne choisit pas, qui décide, et c'est exactement ce qu'un rendu ne
   * peut pas se permettre.
   *
   * Le masque n'expose aucune couleur de texte garantie sur le voile ; d'où la
   * plaque opaque du test précédent. Si un tel jeton apparaît un jour, ce test
   * tombera : ce sera le signal qu'on peut alléger la bande.
   */
  it("le voile seul ne suffit pas — mesuré sur les deux photos extrêmes", () => {
    const mesures = CLES.map((cle) => {
      const { vars } = resoudreMarque(DIRECTIONS[cle]);
      const encre = vars["--cf-text"] ?? "";
      const voile = vars["--cf-scrim"] ?? "";
      const pire = Math.min(
        ...[PHOTO_CLAIRE, PHOTO_SOMBRE].map((photo) =>
          ratioContraste(encre, composer(voile, photo)),
        ),
      );
      return { cle, pire };
    });
    const sous = mesures.filter((m) => m.pire < WCAG_AA);
    expect(
      sous.map((m) => `${m.cle} : ${m.pire.toFixed(2)}:1`).join(", "),
      "aucune direction ne tombe sous AA à travers le voile : le masque a gagné une encre posable dessus, la plaque opaque peut être allégée",
    ).not.toBe("");
  });
});
