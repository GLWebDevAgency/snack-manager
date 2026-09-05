import { describe, expect, it } from "vitest";
import { computeStage } from "./use-stage";

describe("computeStage — la scène de référence mise à l'échelle", () => {
  it("un paysage sur un 1280 × 720 est réduit aux deux tiers, sans rotation", () => {
    const stage = computeStage({ width: 1280, height: 720 }, "landscape");
    expect(stage.ready).toBe(true);
    expect(stage.rotated).toBe(false);
    expect(stage.style["--bd-scale"]).toBeCloseTo(2 / 3, 5);
    expect(stage.style["--bd-w"]).toBe("1920px");
  });

  it("un portrait configuré sur un signal paysage pivote de 90°, à l'échelle des dimensions échangées", () => {
    const stage = computeStage({ width: 1920, height: 1080 }, "portrait");
    expect(stage.rotated).toBe(true);
    expect(stage.style["--bd-rot"]).toBe("90deg");
    expect(stage.style["--bd-scale"]).toBeCloseTo(1080 / 1080, 5);
  });

  it("sans mesure, la scène n'est pas prête et l'orientation détectée est paysage", () => {
    const stage = computeStage({ width: 0, height: 0 }, null);
    expect(stage.ready).toBe(false);
    expect(stage.orientation).toBe("landscape");
  });

  it("un conteneur au ratio 9:16 rend un portrait droit, à l'échelle de sa largeur", () => {
    const stage = computeStage({ width: 270, height: 480 }, "portrait");
    expect(stage.rotated).toBe(false);
    expect(stage.style["--bd-scale"]).toBeCloseTo(0.25, 5);
  });
});
