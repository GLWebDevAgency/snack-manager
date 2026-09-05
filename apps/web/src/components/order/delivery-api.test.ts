import { describe, expect, it, vi } from "vitest";
import { orderingApi } from "./api";

describe("transport public livraison", () => {
  it.each([
    ["https://restaurant.example/", "https://restaurant.example/"],
    ["javascript:alert(1)", null],
    ["https://secret@restaurant.example/", null],
    [undefined, null],
  ])("ne conserve qu'un lien vitrine HTTPS sans identifiants (%s)", async (websiteUrl, expected) => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: {
      tenant: { slug: "classfood", name: "Classfood", brandColor: "#c9a15a", logoUrl: null, address: "", websiteUrl },
      menu: { categories: [] },
    } });
    expect((await orderingApi({ send }).loadSite("classfood"))?.tenant.websiteUrl).toBe(expected);
  });

  it("transmet le mode pour les créneaux et conserve les appels retrait historiques", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const api = orderingApi({ send });
    await api.loadSlots("classfood", "2026-09-06", undefined, "delivery");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/public/tenants/classfood/slots?date=2026-09-06&fulfillment=delivery" }));
    await api.loadSlots("classfood", "2026-09-06");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/public/tenants/classfood/slots?date=2026-09-06" }));
  });
  it("demande un devis avec les références produits et une adresse, sans prix fourni", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: { feeCents: 250, totalCents: 2050 } });
    const request = { address: { line1: "12 rue des Fleurs", postalCode: "69001", city: "Lyon", country: "FR" as const }, lines: [{ productId: "burger", qty: 2, options: [], removed: [] }] };
    await expect(orderingApi({ send }).quoteDelivery("classfood", request)).resolves.toMatchObject({ totalCents: 2050 });
    expect(send).toHaveBeenCalledWith({ method: "POST", path: "/public/tenants/classfood/delivery/quote", body: request });
  });
});
