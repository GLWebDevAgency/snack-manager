import { describe, expect, it } from "vitest";
import { SCENE_EXIT_MS, sceneMotionStyle } from "./scene-motion";

describe("the TV choreography leaves time to read, even on a four-second scene", () => {
  it.each([4000, 6000, 12000, 60000])("bounds the last price reveal at %i ms", (duration) => {
    const style = sceneMotionStyle(duration);
    const ms = (key: keyof typeof style) => Number.parseFloat(String(style[key]));
    // Eight products, with four successive copy beats after the first product.
    const introEnd = ms("--bd-intro-delay") + 11 * ms("--bd-beat-ms") + ms("--bd-reveal-ms");
    expect(duration - introEnd - SCENE_EXIT_MS).toBeGreaterThanOrEqual(duration * 0.6);
    expect(style["--bd-scene-ms"]).toBe(`${duration}ms`);
    expect(style["--bd-exit-ms"]).toBe(`${SCENE_EXIT_MS}ms`);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])("has safe timing for a stale invalid cache: %s", (duration) => {
    expect(sceneMotionStyle(duration)).toEqual(sceneMotionStyle(4000));
  });

  it("does not make a long scene spend its time revealing the menu", () => {
    expect(sceneMotionStyle(60000)["--bd-reveal-ms"]).toBe("850ms");
    expect(sceneMotionStyle(60000)["--bd-beat-ms"]).toBe("60ms");
  });
});
