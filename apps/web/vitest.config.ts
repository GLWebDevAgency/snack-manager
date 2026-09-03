import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * L'ALIAS `@/`, POUR VITEST AUSSI.
 *
 * `tsconfig.json` le déclare et Next l'applique ; Vitest, lui, ne lit pas les
 * `paths` de TypeScript. Jusqu'ici cela ne se voyait pas : les seuls modules
 * importés en `@/` par du code testé étaient MOQUÉS (`vi.mock`), et un module
 * moqué n'est jamais résolu. La première route qui importe un vrai module en
 * `@/` — `icon.svg`, qui compose l'icône du lanceur — échouait donc au
 * chargement, avec un message qui accuse le fichier au lieu de l'outil.
 *
 * Une seule ligne de configuration, et rien d'autre : les valeurs par défaut de
 * Vitest (les fichiers collectés, l'environnement) restent celles sous
 * lesquelles les cinquante-deux fichiers de tests existants passent déjà.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
