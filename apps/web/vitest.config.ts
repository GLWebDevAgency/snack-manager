import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Vitest doit résoudre le même alias que Next et tsconfig.json. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
