import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_ACCENT,
  accessibleTenantAccent,
  readableOnTenantAccent,
  tenantAccentContrastFloor,
  tenantColorContrast,
} from "./tenant-accent";

describe("accent tenant accessible", () => {
  it("normalise les couleurs valides et retombe sûrement sur le design system", () => {
    expect(accessibleTenantAccent("#CA8")).toMatch(/^#[0-9a-f]{6}$/);
    expect(accessibleTenantAccent("url(javascript:alert(1))")).toBe(DEFAULT_TENANT_ACCENT);
    expect(accessibleTenantAccent(null)).toBe(DEFAULT_TENANT_ACCENT);
  });

  it("éclaircit un accent sombre jusqu’au contraste AA sur les cartes et pills teintées", () => {
    const accent = accessibleTenantAccent("#000000");
    expect(accent).not.toBe("#000000");
    expect(tenantColorContrast(accent, "#353535")).toBeGreaterThanOrEqual(4.5);
    expect(tenantAccentContrastFloor(accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["#000000", "#777777", "#c9a15a", "#ffffff", "#5b1b74"])(
    "garantit un libellé AA sur l’aplat %s",
    (raw) => {
      const accent = accessibleTenantAccent(raw);
      expect(
        tenantColorContrast(readableOnTenantAccent(accent), accent),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
