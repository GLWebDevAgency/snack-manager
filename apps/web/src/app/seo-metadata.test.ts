import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

const requestState = vi.hoisted(() => ({ host: "snackmanager.fr" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: requestState.host }) }));
vi.mock("@/lib/site", () => ({
  SITE_URL: "https://snackmanager.fr",
  urlAbsolue: (path: string) => new URL(path, "https://snackmanager.fr").toString(),
}));
vi.mock("@/app/(marketing)/blog/_articles/registre", () => ({
  BLOG_PATH: "/blog",
  cheminArticle: (slug: string) => `/blog/${slug}`,
  ARTICLES: [
    { slug: "article-recent", publieLe: "2026-09-20" },
    { slug: "article-ancien-revise", publieLe: "2026-08-21", modifieLe: "2026-09-24" },
  ],
}));

beforeEach(() => {
  requestState.host = "snackmanager.fr";
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("SM_ENV", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("plan de site éditorial", () => {
  it("date les articles avec leur révision réelle et le blog avec la plus récente", () => {
    const pages = sitemap();
    const dateOf = (path: string) => pages.find((page) => page.url === `https://snackmanager.fr${path}`)?.lastModified;
    expect(dateOf("/blog/article-recent")).toBe("2026-09-20");
    expect(dateOf("/blog/article-ancien-revise")).toBe("2026-09-24");
    expect(dateOf("/blog")).toBe("2026-09-24");
    expect(dateOf("/")).toBeUndefined();
    expect(dateOf("/blog/la-redaction")).toBeUndefined();
  });

  it("référence les articles et la rédaction une fois, sans routes d’exploitation", () => {
    const urls = sitemap().map((page) => page.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("https://snackmanager.fr/blog/la-redaction");
    expect(urls.filter((url) => /\/(admin|sm|board|r|t|embed|api)(\/|$)/.test(new URL(url).pathname))).toEqual([]);
  });
});

describe("robots et découverte du sitemap", () => {
  it("annonce le sitemap public tout en laissant lire les noindex des pages internes", async () => {
    const result = await robots();
    expect(result.sitemap).toBe("https://snackmanager.fr/sitemap.xml");
    expect(result.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/api$", "/api/"] });
  });

  it.each(["web-staging-6f5f.up.railway.app", "staging.snackmanager.fr", "blog-preview.vercel.app",
    "commander.restaurant.example", "localhost:3000"])("n’annonce pas le sitemap commercial sur %s", async (host) => {
    requestState.host = host;
    expect((await robots()).sitemap).toBeUndefined();
  });

  it("retire le sitemap en staging même derrière le domaine public", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    expect((await robots()).sitemap).toBeUndefined();
  });

  it("résout www, la casse et le port sans traiter un suffixe trompeur comme le site public", async () => {
    requestState.host = "WWW.SNACKMANAGER.FR:443";
    expect((await robots()).sitemap).toBe("https://snackmanager.fr/sitemap.xml");
    requestState.host = "snackmanager.fr.attacker.example";
    expect((await robots()).sitemap).toBeUndefined();
  });
});
