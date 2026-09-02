/**
 * LES DIX-HUIT FAMILLES DU MASQUE — déclarées ici, une fois, statiquement.
 *
 * next/font exige des appels au niveau module : on ne peut pas choisir une
 * famille à l'exécution. On les déclare donc TOUTES, avec `preload: false` —
 * next/font n'émet alors que des @font-face, et le navigateur ne télécharge
 * que les familles que le texte utilise réellement : celles de la paire du
 * tenant. Le résolveur (contracts) émet `var(--police-<slug>)`.
 *
 * Le test `polices.test.ts` garantit que FONT_FAMILIES (contracts) et cette
 * liste ne divergent jamais.
 */
import {
  Alegreya_Sans, Archivo, Archivo_Black, Bricolage_Grotesque, Cormorant_Garamond,
  Familjen_Grotesk, Figtree, Fraunces, Instrument_Sans, JetBrains_Mono, Lato,
  Libre_Baskerville, Manrope, Nunito, Nunito_Sans, Outfit, Playfair_Display, Source_Sans_3,
} from "next/font/google";

// `subsets` doit rester un tableau MUTABLE (littéral, pas `readonly`) : chaque
// fonction next/font/google attend `Array<"latin" | ...>`, incompatible avec
// le tuple `readonly ["latin"]` que produirait `as const` ici.
const commun = { subsets: ["latin"] as Array<"latin">, display: "swap" as const, preload: false };

const fraunces = Fraunces({ ...commun, variable: "--police-fraunces" });
const sourceSans3 = Source_Sans_3({ ...commun, variable: "--police-source-sans-3" });
const bricolage = Bricolage_Grotesque({ ...commun, variable: "--police-bricolage-grotesque" });
const archivo = Archivo({ ...commun, variable: "--police-archivo" });
const alegreyaSans = Alegreya_Sans({ ...commun, weight: ["400", "500", "700", "800"], variable: "--police-alegreya-sans" });
const jetbrains = JetBrains_Mono({ ...commun, variable: "--police-jetbrains-mono" });
const outfit = Outfit({ ...commun, variable: "--police-outfit" });
const manrope = Manrope({ ...commun, variable: "--police-manrope" });
const cormorant = Cormorant_Garamond({ ...commun, weight: ["400", "500", "600", "700"], variable: "--police-cormorant-garamond" });
const figtree = Figtree({ ...commun, variable: "--police-figtree" });
const nunito = Nunito({ ...commun, variable: "--police-nunito" });
const nunitoSans = Nunito_Sans({ ...commun, variable: "--police-nunito-sans" });
const playfair = Playfair_Display({ ...commun, variable: "--police-playfair-display" });
const familjen = Familjen_Grotesk({ ...commun, variable: "--police-familjen-grotesk" });
const instrument = Instrument_Sans({ ...commun, variable: "--police-instrument-sans" });
const libreBaskerville = Libre_Baskerville({ ...commun, weight: ["400", "700"], variable: "--police-libre-baskerville" });
const lato = Lato({ ...commun, weight: ["400", "700", "900"], variable: "--police-lato" });
const archivoBlack = Archivo_Black({ ...commun, weight: "400", variable: "--police-archivo-black" });

const TOUTES = [
  fraunces, sourceSans3, bricolage, archivo, alegreyaSans, jetbrains, outfit, manrope,
  cormorant, figtree, nunito, nunitoSans, playfair, familjen, instrument, libreBaskerville, lato, archivoBlack,
];

/** Les slugs déclarés — pour le test de parité avec contracts. */
export const SLUGS_DECLARES: readonly string[] = TOUTES.map((f) => f.variable.replace("--police-", "")).sort();

/** À poser sur la racine de chaque surface client, à côté de `styleDuMasque()`. */
export const classesPolices: string = TOUTES.map((f) => f.variable).join(" ");
