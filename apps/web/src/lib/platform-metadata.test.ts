import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter" }) }));
vi.mock("@/components/ErrorReporter", () => ({ ErrorReporter: () => null }));

const publicFile = (name: string) => fileURLToPath(new URL(`../../public/${name}`, import.meta.url));
const appDirectory = fileURLToPath(new URL("../app", import.meta.url));
const expectedManifest = {
  name: "Snack Manager",
  short_name: "Snack Manager",
  description: "La suite qui fait tourner votre snack — caisse, cuisine, commande en ligne et back-office.",
  lang: "fr",
  dir: "ltr",
  start_url: "/",
  scope: "/",
  display: "browser",
  background_color: "#000000",
  theme_color: "#000000",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

describe("métadonnées explicites de la plateforme", () => {
  it("ne laisse aucune convention racine réinjecter les icônes ou le manifeste chez un restaurant", () => {
    // Un test de l'objet Metadata seul manque le favicon que Next rajoute
    // séparément aux metadata enfants, même lorsque leurs icons sont redéfinies.
    expect(readdirSync(appDirectory, { withFileTypes: true }).filter((entry) =>
      entry.isFile()
      && /^(?:favicon|icon\d*|apple-icon\d*|manifest)\.(?:ico|svg|png|jpg|jpeg|json|webmanifest|tsx?|jsx?)$/.test(entry.name),
    ).map((entry) => entry.name)).toEqual([]);
    expect(existsSync(new URL("../app/manifest.webmanifest/route.ts", import.meta.url))).toBe(true);
  });

  it("garde un véritable favicon ICO de 32 pixels à son emplacement public", () => {
    const bytes = readFileSync(publicFile("favicon.ico"));
    expect([...bytes.subarray(0, 8)]).toEqual([0, 0, 1, 0, 1, 0, 32, 32]);
  });

  it("garde l'icône SVG à son emplacement public", () => {
    expect(readFileSync(publicFile("icon.svg"), "utf8")).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });

  it("garde l'icône Apple PNG de 180 pixels à son emplacement public", () => {
    const bytes = readFileSync(publicFile("apple-icon.png"));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([180, 180]);
  });

  it("déclare les mêmes URL et attributs, sans convention automatique", async () => {
    const { platformMetadata } = await import("./platform-metadata");
    expect(platformMetadata).toEqual({
      title: "Snack Manager",
      description: "La suite qui fait tourner votre snack — caisse, cuisine, commande en ligne.",
      manifest: "/manifest.webmanifest",
      icons: {
        icon: [
          { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
          { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
        apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
      },
    });
    const { metadata } = await import("../app/layout");
    expect(metadata).toBe(platformMetadata);
  });

  it("garde le manifeste plateforme non installable et ses trois icônes existantes", async () => {
    const { platformManifest } = await import("./platform-manifest");
    expect(platformManifest()).toEqual(expectedManifest);
    for (const icon of expectedManifest.icons) expect(existsSync(publicFile(icon.src.slice(1)))).toBe(true);
  });

  it("sert exactement le JSON du manifeste avec son MIME et sa politique de revalidation", async () => {
    const { GET } = await import("../app/manifest.webmanifest/route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(await response.text()).toBe(JSON.stringify(expectedManifest));
  });

  it("la fabrique ne recrée plus les conventions automatiques lors d'une mise à jour de marque", () => {
    const script = readFileSync(new URL("../../../../scripts/generate-brand-assets.mjs", import.meta.url), "utf8");
    for (const file of ["icon.svg", "favicon.ico", "apple-icon.png"]) {
      expect(script).toContain(`'apps/web/public/${file}'`);
      expect(script).not.toContain(`'apps/web/src/app/${file}'`);
    }
  });
});
