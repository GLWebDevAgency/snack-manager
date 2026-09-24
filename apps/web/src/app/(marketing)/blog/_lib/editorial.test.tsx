import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { urlAbsolue } from "@/lib/site";
import { ARTICLES, articleParSlug, cheminArticle } from "../_articles/registre";
import { articleSchema, blogSchema, breadcrumbs, jsonLd, REDACTION_PATH } from "./metadata";

// Navigation belongs to Next. Keep its actual href/children contract while
// avoiding its bundled React instance in this server-rendering unit test.
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ children, ...props }: PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement>>) => createElement("a", props, children),
  };
});

/** These checks render the real editorial modules, not fixtures mirroring their content. */
const PUBLIC_DIRECTORY = new URL("../../../../../public/", import.meta.url);
const slugs = ARTICLES.map((article) => article.slug);
const rendered = ARTICLES.map((article) => ({ article, html: renderToStaticMarkup(article.corps()) }));

function expectIsoDate(value: string) {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${value}T00:00:00Z`);
  expect(Number.isNaN(date.getTime())).toBe(false);
  expect(date.toISOString().slice(0, 10)).toBe(value);
}

describe("contrat de publication du carnet", () => {
  it("conserve les URL déjà publiées sans collisions avec la rédaction", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(expect.arrayContaining([
      "lien-de-commande-sur-votre-fiche-google",
      "pourquoi-les-prix-sont-plus-chers-sur-les-applis",
      "ouvrir-le-click-and-collect-sans-se-tromper",
    ]));
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(cheminArticle(slug)).not.toBe(REDACTION_PATH);
    }
    expect(articleParSlug("ce-guide-n-existe-pas")).toBeUndefined();
  });

  it.each(rendered)("relie chaque entrée du sommaire à un vrai titre : $article.slug", ({ article, html }) => {
    const headings = [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g)].map((match) => ({
      id: match[1].match(/\bid="([^"]+)"/)?.[1],
      titreHtml: match[2],
    }));
    expect(headings.length).toBeGreaterThan(0);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(headings.length);
    expect(headings).toEqual(article.sections.map((section) => ({
      id: section.id,
      titreHtml: renderToStaticMarkup(section.titre),
    })));
  });

  it.each(ARTICLES)("publie des dates, sources et ressources exploitables : $slug", (article) => {
    expectIsoDate(article.publieLe);
    if (article.modifieLe) {
      expectIsoDate(article.modifieLe);
      expect(article.modifieLe >= article.publieLe).toBe(true);
    }
    expect(article.sources.length).toBeGreaterThan(0);
    expect(new Set(article.sources.map((source) => source.url)).size).toBe(article.sources.length);
    for (const source of article.sources) {
      expectIsoDate(source.consulteLe);
      expect(new URL(source.url).protocol).toBe("https:");
      expect(source.titre.trim().length).toBeGreaterThan(0);
    }
    expect(article.reponseCourte.trim().length).toBeGreaterThan(0);
    expect(article.categorie.trim().length).toBeGreaterThan(0);
    expect(article.minutes).toBeGreaterThan(0);
    expect(article.photo.src).toMatch(/^\/(photos|illustrations)\//);
    const image = new URL(article.photo.src.slice(1), PUBLIC_DIRECTORY);
    expect(existsSync(fileURLToPath(image))).toBe(true);
  });

  it.each(rendered)("ne laisse aucun renvoi éditorial sans destination : $article.slug", ({ article, html }) => {
    expect(new Set(article.lies).size).toBe(article.lies.length);
    for (const lie of article.lies) {
      expect(lie).not.toBe(article.slug);
      expect(articleParSlug(lie)).toBeDefined();
    }
    for (const [, slug] of html.matchAll(/href="\/blog\/([^"#?]+)(?:[#?][^"]*)?"/g)) {
      expect(articleParSlug(slug)).toBeDefined();
    }
  });

  it("permet d'atteindre au clavier chaque tableau défilant et annonce sa légende", () => {
    const tables = rendered.flatMap(({ html }) => [...html.matchAll(/<div\b([^>]*class="bl-tablewrap"[^>]*)>\s*<table\b[^>]*>\s*<caption>([\s\S]*?)<\/caption>/g)]);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.length).toBe(rendered.reduce((total, { html }) => total + [...html.matchAll(/<table\b/g)].length, 0));
    for (const [, attributes, caption] of tables) {
      expect(attributes).toMatch(/\btabindex="0"/);
      expect(attributes).toMatch(/\brole="region"/);
      expect(attributes.match(/\baria-label="([^"]+)"/)?.[1]).toBe(caption);
    }
  });
});

describe("contrat des données structurées du carnet", () => {
  it("échappe une fermeture de script tout en conservant les données après lecture JSON", () => {
    const value = { titre: '</script><script>alert("test")</script>', exemple: "2 < 3", texte: "Équipe & restaurant" };
    const serialized = jsonLd(value);
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it.each(ARTICLES)("décrit les mêmes informations que le guide : $slug", (article) => {
    const schema = articleSchema(article);
    const url = urlAbsolue(cheminArticle(article.slug));
    expect(schema).toMatchObject({
      "@type": "BlogPosting",
      url,
      mainEntityOfPage: { "@id": url },
      headline: article.titre,
      description: article.chapo,
      articleSection: article.categorie,
      datePublished: article.publieLe,
      dateModified: article.modifieLe ?? article.publieLe,
      image: `${url}/partage`,
      author: { "@type": "Organization", name: "Équipe Snack Manager", url: urlAbsolue(REDACTION_PATH) },
      citation: article.sources.map((source) => source.url),
    });
    expect(schema).not.toHaveProperty("aggregateRating");
    const trail = breadcrumbs(article).itemListElement;
    expect(trail.at(-1)).toMatchObject({ name: article.titre, item: url });
    expect(trail.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(JSON.parse(jsonLd(schema))).toEqual(schema);
  });

  it("référence exactement les guides publiés depuis le schéma du blog", () => {
    const schema = blogSchema("Description éditoriale");
    expect(schema.description).toBe("Description éditoriale");
    expect(schema.blogPost.map((article) => article.url)).toEqual(ARTICLES.map((article) => urlAbsolue(cheminArticle(article.slug))));
    expect(new Set(schema.blogPost.map((article) => article["@id"])).size).toBe(ARTICLES.length);
  });
});
