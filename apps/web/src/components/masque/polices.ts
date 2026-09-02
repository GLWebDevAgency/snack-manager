/**
 * LES DIX-HUIT FAMILLES DU MASQUE — déclarées ici, une fois, statiquement.
 *
 * next/font exige des appels au niveau module : on ne peut pas choisir une
 * famille à l'exécution. On les déclare donc TOUTES, avec `preload: false` —
 * next/font n'émet alors que des @font-face, et le navigateur ne télécharge
 * que les familles que le texte utilise réellement : celles de la paire du
 * tenant. Le résolveur (contracts) émet `var(--police-<slug>)`.
 *
 * Le test `polices.test.ts` garantit que FONT_FAMILIES (contracts) et les
 * familles déclarées ici ne divergent jamais — en LISANT CE FICHIER en texte
 * (next/font ne peut pas s'exécuter sous vitest), pas en l'important : `.variable`
 * sur un objet next/font est un nom de CLASSE généré (haché), jamais la chaîne
 * `--police-<slug>` — inutile d'en dériver quoi que ce soit au runtime.
 */
import {
  Alegreya_Sans, Archivo, Archivo_Black, Bricolage_Grotesque, Cormorant_Garamond,
  Familjen_Grotesk, Figtree, Fraunces, Instrument_Sans, JetBrains_Mono, Lato,
  Libre_Baskerville, Manrope, Nunito, Nunito_Sans, Outfit, Playfair_Display, Source_Sans_3,
} from "next/font/google";

// `next/font/google` analyse l'appel STATIQUEMENT (Turbopack/webpack) pour en
// extraire la configuration au moment du build : l'objet passé doit donc être
// un littéral, sans spread ni référence à une constante partagée — un
// `{ ...commun, … }` fait échouer le build avec « Unexpected spread ». D'où
// la répétition de `subsets`/`display`/`preload` sur chaque appel ci-dessous.

const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-fraunces" });
const sourceSans3 = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-source-sans-3" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-bricolage-grotesque" });
const archivo = Archivo({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-archivo" });
const alegreyaSans = Alegreya_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "700", "800"], variable: "--police-alegreya-sans" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-jetbrains-mono" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-outfit" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-manrope" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--police-cormorant-garamond" });
const figtree = Figtree({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-figtree" });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-nunito" });
const nunitoSans = Nunito_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-nunito-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-playfair-display" });
const familjen = Familjen_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-familjen-grotesk" });
const instrument = Instrument_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--police-instrument-sans" });
const libreBaskerville = Libre_Baskerville({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--police-libre-baskerville" });
const lato = Lato({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700", "900"], variable: "--police-lato" });
const archivoBlack = Archivo_Black({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--police-archivo-black" });

const TOUTES = [
  fraunces, sourceSans3, bricolage, archivo, alegreyaSans, jetbrains, outfit, manrope,
  cormorant, figtree, nunito, nunitoSans, playfair, familjen, instrument, libreBaskerville, lato, archivoBlack,
];

/** À poser sur la racine de chaque surface client, à côté de `styleDuMasque()`. */
export const classesPolices: string = TOUTES.map((f) => f.variable).join(" ");
