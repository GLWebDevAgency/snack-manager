import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, logoPour, type Brand } from "@sm/contracts";
import { verrouPour } from "./verrou";

const MARQUE = "https://exemple.test/marque.webp";
const VERROU_SOMBRE = "https://exemple.test/verrou-sombre.webp";
const VERROU_CLAIR = "https://exemple.test/verrou-clair.webp";

/** Une marque de référence, dont on ne change que les quatre emplacements. */
function marque(
  mode: "light" | "dark",
  logo: Partial<{
    markLight: string | null;
    markDark: string | null;
    lockupLight: string | null;
    lockupDark: string | null;
  }> = {},
): Brand {
  const socle = mode === "dark" ? DIRECTIONS.nuit : DIRECTIONS.brasserie;
  return {
    ...socle,
    mode,
    logo: {
      mark: { light: logo.markLight ?? null, dark: logo.markDark ?? null },
      lockup: { light: logo.lockupLight ?? null, dark: logo.lockupDark ?? null },
    },
  };
}

describe("verrouPour", () => {
  it("suit le mode du masque", () => {
    const b = marque("dark", { lockupDark: VERROU_SOMBRE, lockupLight: VERROU_CLAIR });
    expect(verrouPour(b)).toBe(VERROU_SOMBRE);
    expect(verrouPour({ ...b, mode: "light" })).toBe(VERROU_CLAIR);
  });

  it("retombe sur l'autre déclinaison quand celle du mode manque", () => {
    expect(verrouPour(marque("dark", { lockupLight: VERROU_CLAIR }))).toBe(VERROU_CLAIR);
    expect(verrouPour(marque("light", { lockupDark: VERROU_SOMBRE }))).toBe(VERROU_SOMBRE);
  });

  /*
   * LE POINT QUI JUSTIFIE CETTE FONCTION.
   *
   * `logoPour(brand, "lockup")` rend ici la MARQUE : ses deux dernières sondes
   * changent de format. C'est ce qu'il faut pour remplir une tuile, et jamais
   * pour un verrou — un pictogramme carré ne porte aucun nom, et il remplacerait
   * le nom écrit de l'en-tête. Sans verrou posé : `null`, donc rien ne change.
   */
  it("ne retombe JAMAIS sur la marque, là où `logoPour` le fait", () => {
    const b = marque("dark", { markDark: MARQUE });
    expect(logoPour(b, "lockup")).toBe(MARQUE);
    expect(verrouPour(b)).toBeNull();
  });

  it("rend null quand les quatre emplacements sont vides", () => {
    expect(verrouPour(marque("dark"))).toBeNull();
  });
});

/*
 * ═══ UN LOGO NE SE RECADRE PAS — le garde, et non la consigne ═══
 *
 * La règle était écrite une seule fois, dans un commentaire de la rangée
 * d'images de l'éditeur d'identité (« contain : un logo recadré n'est plus un
 * logo »), pendant que les DEUX primitives client peignaient `object-cover` :
 * la vitrine amputait du haut et du bas le logo plus large que haut du
 * fondateur, et l'aperçu du back-office montrait le même fichier entier dans
 * une vignette et rogné dans la voisine, à huit pixels de distance.
 *
 * Ce test lit la source des pièces qui peignent un logo de restaurant. Il ne
 * juge PAS l'image d'accueil, qui se recadre volontairement (elle a pour cela
 * un point d'intérêt piloté depuis la médiathèque) — d'où la liste nominative.
 */
const SRC = join(__dirname, "..", "..");

/*
 * Le garde juge du CODE, pas de la prose : ces fichiers EXPLIQUENT pourquoi
 * `object-cover` est proscrit, et citer la forme dans son explication faisait
 * échouer le test — il punissait sa propre documentation (même piège, même
 * remède que `couleurs-brutes.test.ts`).
 */
function code(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}
/*
 * LA LISTE COUVRE AUSSI L'ENDROIT D'OÙ LE DÉFAUT VENAIT.
 *
 * Elle ne nommait que les deux fichiers où le correctif a été posé. Or
 * l'`object-cover` d'origine vivait dans `primitives.tsx`, et les deux aperçus
 * du back-office peignent le même logo : une régression réintroduite là serait
 * passée au vert. Un garde qui ne protège que le lieu du remède, et pas celui
 * de la maladie, ne protège rien.
 */
const PIECES_DE_LOGO = [
  "components/ui/identite.tsx",
  "components/loyalty/carte-visuelle.tsx",
  "components/order/primitives.tsx",
  "app/admin/settings/ApercuInstalle.tsx",
];

/*
 * `ApercuDeMarque.tsx` N'EST PAS DANS LA LISTE, ET C'EST DÉLIBÉRÉ.
 *
 * Il porte bien un `object-cover` — mais sur la PHOTO D'ACCUEIL, qui doit
 * couvrir : c'est un bandeau, pas une marque. Son logo, lui, passe par la
 * primitive partagée et n'est plus peint ici. L'y ajouter aurait fait échouer
 * le garde sur un cadrage juste, et la façon de faire taire un garde qui a
 * tort est de le corriger, pas de l'élargir jusqu'à ce qu'il ne dise plus rien.
 */

describe("les pièces qui peignent un logo l'ajustent", () => {
  for (const rel of PIECES_DE_LOGO) {
    it(`${rel} n'écrit pas object-cover`, () => {
      expect(code(rel)).not.toMatch(/\bobject-cover\b/);
    });
  }

  /*
   * Et il n'y a plus de second dessin : l'en-tête de la carte de fidélité
   * peignait sa propre balise `<img>` pour le même fichier que la vitrine, avec
   * quatre écarts accumulés. Une balise qui reviendrait ici serait la même
   * divergence qui recommence.
   */
  it("l'en-tête de la carte de fidélité ne peint plus son propre <img>", () => {
    expect(code("components/loyalty/carte-visuelle.tsx")).not.toMatch(/<img\b/);
  });
});
