import { afterEach, describe, expect, it, vi } from "vitest";
import { customerAccountRequest, CustomerAccountHttpError } from "./client";

afterEach(() => vi.unstubAllGlobals());
describe("Compte client — transport privé same-origin", () => {
  it("impose le BFF, no-store, aucun referrer et aucun jeton JavaScript", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ available: false })); vi.stubGlobal("fetch", fetch);
    await customerAccountRequest("classfood")("status");
    expect(fetch).toHaveBeenCalledWith("/r/classfood/compte/capacites", expect.objectContaining({ method: "GET", cache: "no-store",
      credentials: "same-origin", redirect: "error", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } }));
    expect(fetch.mock.calls[0]![1]).not.toHaveProperty("body");
  });
  it.each(["../../other", "classfood?x=1", "classfood#x", "https://external.test", "a".repeat(64)])("refuse slug %s avant réseau", async slug => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(customerAccountRequest(slug)("session")).rejects.toBeInstanceOf(CustomerAccountHttpError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("PATCH nom et DELETE session ont un corps JSON ; seul un 204 confirme logout", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch); const request = customerAccountRequest("classfood");
    await request("name", { name: "Camille", expectedRevision: 2 }); await request("logout", { all: false });
    expect(fetch).toHaveBeenNthCalledWith(1, "/r/classfood/compte/profil", expect.objectContaining({ method: "PATCH", body: '{"name":"Camille","expectedRevision":2}' }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/r/classfood/compte/session", expect.objectContaining({ method: "DELETE", body: '{"all":false}' }));
    fetch.mockResolvedValue(Response.json({ message: "looks successful" }));
    await expect(request("logout", { all: false })).rejects.toBeInstanceOf(CustomerAccountHttpError);
  });
  it("une erreur ne reflète jamais le corps amont", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "private-value" }, { status: 503 })));
    const error = await customerAccountRequest("classfood")("session").catch(error => error);
    expect(error).toMatchObject({ status: 503 });
    if (!(error instanceof CustomerAccountHttpError)) throw new Error("Expected sanitized HTTP error");
    expect(error.message).not.toContain("private-value");
  });
  it.each([new Response("<h1>Proxy error</h1>", { headers: { "content-type": "text/html" } }),
    Response.json({ value: "x".repeat(4_100) }), new Response("{invalid", { headers: { "content-type": "application/json" } })])("refuse contenu non JSON, surdimensionné ou invalide", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(customerAccountRequest("classfood")("session")).rejects.toThrow();
  });
});
