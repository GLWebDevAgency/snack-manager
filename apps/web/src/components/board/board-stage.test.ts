import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DIRECTIONS, type ScreenContent, type ScreenScenePayload } from "@sm/contracts";
vi.mock("@/components/masque/polices", () => ({ classesPolices: "test-fonts" }));
import { BoardStage } from "./board-stage";
import { computeStage } from "./use-stage";

const current: ScreenScenePayload = { id: "current", title: "Bienvenue", kind: "custom", subtitle: null, durationMs: 12000, products: [], promos: [], nextOpening: null };
const content: ScreenContent = {
  screenId: "s", name: "TV", orientation: "portrait", theme: "brand", scenography: "halo", masque: DIRECTIONS.neon,
  brand: { name: "Chez Nino", slug: "nino", logoUrl: null, accent: DIRECTIONS.neon.palette.accent }, service: "lunch", serviceLabel: "Service du midi", open: true,
  scenes: [current], contentHash: "x", generatedAt: "", dailyReloadAt: "", pollIntervalMs: 60000, timezone: "Europe/Paris",
};

describe("the same stage serves the TV and every preview", () => {
  it("keeps a single ambient background across an incoming and outgoing scene", () => {
    const html = renderToStaticMarkup(createElement(BoardStage, {
      content, current, leaving: { ...current, id: "previous", title: "À bientôt" }, stage: computeStage({ width: 1080, height: 1920 }, "portrait"), embed: true,
    }));
    expect(html.split('class="ss-atmosphere"')).toHaveLength(2);
    expect(html).toContain('data-phase="out"');
    expect(html).toContain('data-phase="in"');
    expect(html).toContain(`--cf-accent:${DIRECTIONS.neon.palette.accent}`);
    expect(html).toContain('data-pair="neon"');
    expect(html).toContain("test-fonts");
  });

  it.each(["ardoise", "comptoir", "affiche"] as const)("forwards still, pause and off to %s without a second identity", (scenography) => {
    const html = renderToStaticMarkup(createElement(BoardStage, {
      content: { ...content, scenography, presentation: { version: 1, corners: "square", priceScale: "large", motion: "off" } },
      current, leaving: null, stage: computeStage({ width: 1080, height: 1920 }, "portrait"), embed: true, still: true, paused: true,
    }));
    expect(html).toContain('data-still="1"');
    expect(html).toContain('data-paused="1"');
    expect(html).toContain('data-motion="off"');
    expect(html).toContain('data-corners="square"');
    expect(html).toContain("--bd-price-scale:1.14");
    expect(html).toContain(`--cf-bg:${DIRECTIONS.neon.palette.ground}`);
  });
});
