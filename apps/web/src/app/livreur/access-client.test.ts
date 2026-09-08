import { describe, expect, it, vi } from "vitest";
import { createDeliveryAccessClient, secureNonce, takeInvitation, type AccessBrowser } from "./access-client";

const TOKEN = "I".repeat(43);
const NONCE = "N".repeat(43);
const SESSION = { operatorId: "507f1f77bcf86cd799439011", name: "Maya", restaurantName: "Restaurant de test",
  restaurantSlug: "restaurant-test", expiresAt: "2030-09-14T10:00:00Z" };

function fixture(hash = `#invitation=${TOKEN}`) {
  let fragment = hash;
  let online = true;
  const calls: string[] = [];
  const browser = { fragment: () => { calls.push("read"); return fragment; },
    origin: () => "https://delivery.test",
    removeFragment: vi.fn(() => { calls.push("remove"); fragment = ""; }),
    online: () => online,
    nonce: vi.fn(() => NONCE),
    request: vi.fn<AccessBrowser["request"]>().mockResolvedValue(new Response(null, { status: 204 })),
  };
  return { browser, calls, client: createDeliveryAccessClient(browser), setOnline: (value: boolean) => { online = value; } };
}

describe("accès mobile livreur", () => {
  it("retire immédiatement l’identité sur révocation confirmée par une route mission", async () => {
    const f = fixture(); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    f.client.accessRejected();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "revoked", session: null });
  });
  it("une lecture d’accès antérieure ne restaure pas une identité révoquée entre-temps", async () => {
    const f = fixture(""); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    let finish!: (response: Response) => void;
    f.browser.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reading = f.client.refresh(); f.client.accessRejected();
    finish(Response.json(SESSION)); await reading;
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "revoked", session: null });
  });
  it("lit puis efface le fragment, sans appel d’association automatique ni secret dans l’état public", async () => {
    const f = fixture(); await f.client.start();
    expect(f.calls).toEqual(["read", "remove"]);
    expect(f.browser.request.mock.calls.map(([method]) => method)).toEqual(["GET"]);
    expect(f.client.getSnapshot()).toMatchObject({ phase: "invitation", hasInvitation: true });
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain(TOKEN);
    await f.client.start(); expect(f.browser.removeFragment).toHaveBeenCalledOnce();
  });

  it.each(["#invitation=short", `#invitation=${TOKEN}&other=1`, `#token=${TOKEN}`, "#invitation=%41" ])("efface et refuse un fragment non canonique", fragment => {
    const f = fixture(fragment);
    expect(takeInvitation(f.browser)).toEqual({ token: null, invalid: true });
    expect(f.browser.removeFragment).toHaveBeenCalledOnce();
  });

  it("ferme l’association si l’URL ne peut pas être nettoyée, même après remontage", async () => {
    const f = fixture(); f.browser.removeFragment.mockImplementation(() => { throw new Error("history unavailable"); });
    await f.client.start(); await f.client.start(); await f.client.associate();
    expect(f.client.importInvitation(`https://delivery.test/livreur#invitation=${TOKEN}`)).toBe(false);
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "browser", hasInvitation: false });
    expect(f.browser.request).not.toHaveBeenCalled();
  });

  it("génère 32 octets cryptographiques sous forme de nonce43", () => {
    const random = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
    const nonce = secureNonce({ getRandomValues: random } as unknown as Crypto);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(random.mock.calls[0]![0]).toHaveLength(32);
  });

  it.each(["lost", 403, 429, 503])("réutilise exactement token+nonce après %s, puis confirme le cookie", async cause => {
    const f = fixture(); await f.client.start();
    if (cause === "lost") f.browser.request.mockRejectedValueOnce(new Error("response lost"));
    else f.browser.request.mockResolvedValueOnce(new Response(null, { status: cause as number }));
    await f.client.associate();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", hasInvitation: true, exchangePending: true });
    f.browser.request.mockResolvedValueOnce(Response.json(SESSION)).mockResolvedValueOnce(Response.json(SESSION));
    await f.client.associate();
    expect(f.browser.request.mock.calls.filter(([method]) => method === "POST")).toEqual([
      ["POST", { token: TOKEN, nonce: NONCE }], ["POST", { token: TOKEN, nonce: NONCE }],
    ]);
    expect(f.browser.nonce).toHaveBeenCalledOnce();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "connected", session: SESSION, hasInvitation: false, exchangePending: false });
  });

  it("ne prétend pas être associé si le cookie n’est pas conservé", async () => {
    const f = fixture(); await f.client.start();
    f.browser.request.mockResolvedValueOnce(Response.json(SESSION)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await f.client.associate();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "exchange", exchangePending: true, session: null });
  });

  it("ne crée qu’une requête quand deux appuis se suivent", async () => {
    const f = fixture(); await f.client.start();
    let finish!: (response: Response) => void;
    f.browser.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.client.associate(); await f.client.associate();
    expect(f.browser.request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
    finish(new Response(null, { status: 503 })); await first;
  });

  it("demande un nouveau lien après un refus terminal", async () => {
    const f = fixture(); await f.client.start();
    f.browser.request.mockResolvedValueOnce(new Response(null, { status: 401 })); await f.client.associate();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "expired-link", hasInvitation: false, exchangePending: false });
  });

  it("ne remplace pas silencieusement un accès existant avec une nouvelle invitation", async () => {
    const f = fixture(); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    await f.client.associate();
    expect(f.browser.request.mock.calls.map(([method]) => method)).toEqual(["GET"]);
    expect(f.client.getSnapshot()).toMatchObject({ phase: "connected", session: SESSION, hasInvitation: true });
  });

  it("cache le succès hors ligne et ne lance aucune association sans réseau", async () => {
    const f = fixture(); f.setOnline(false); await f.client.start(); await f.client.associate();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "offline", online: false });
    expect(f.browser.request).not.toHaveBeenCalled();
  });

  it("ne repeint pas un succès si la connexion tombe pendant la confirmation", async () => {
    const f = fixture(); await f.client.start();
    f.browser.request.mockResolvedValueOnce(Response.json(SESSION)).mockImplementationOnce(async () => {
      f.setOnline(false); return Response.json(SESSION);
    });
    await f.client.associate();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "offline", online: false });
  });

  it("relit l’accès pour constater une révocation distante", async () => {
    const f = fixture(""); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    f.browser.request.mockResolvedValueOnce(new Response(null, { status: 401 })); await f.client.refresh();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "revoked", session: null });
  });

  it("garde une déconnexion incertaine à reprendre et n’efface l’identité qu’après confirmation", async () => {
    const f = fixture(""); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    f.browser.request.mockRejectedValueOnce(new Error("lost")); await f.client.logout();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "error", reason: "logout", session: SESSION, logoutPending: true });
    await f.client.refresh(); expect(f.browser.request).toHaveBeenCalledTimes(2);
    f.browser.request.mockResolvedValueOnce(new Response(null, { status: 204 })); await f.client.logout();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "missing", session: null, signedOut: true, logoutPending: false });
  });
});

describe("invitation collée explicitement dans l’application", () => {
  const link = (token = TOKEN) => `https://delivery.test/livreur#invitation=${token}`;
  it("expose exactement la garde d’import après révocation puis absence recontrôlée", async () => {
    const f = fixture(""); expect(f.client.canImportInvitation()).toBe(false);
    await f.client.start(); expect(f.client.canImportInvitation()).toBe(true);
    f.client.accessRejected(); expect(f.client.canImportInvitation()).toBe(false);
    expect(f.client.importInvitation(link())).toBe(false);
    await f.client.refresh(); expect(f.client.canImportInvitation()).toBe(true);
    expect(f.client.importInvitation(link())).toBe(true);
  });
  it("importe sans appel, navigation ni secret dans l’état, puis attend le geste d’association", async () => {
    const f = fixture(""); await f.client.start(); const calls = f.browser.request.mock.calls.length;
    expect(f.client.importInvitation(link())).toBe(true);
    expect(f.browser.request.mock.calls.length).toBe(calls); expect(f.browser.nonce).not.toHaveBeenCalled();
    expect(f.browser.removeFragment).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ phase: "invitation", hasInvitation: true });
    expect(JSON.stringify(f.client.getSnapshot()).includes(TOKEN)).toBe(false);
    f.browser.request.mockResolvedValueOnce(Response.json(SESSION)).mockResolvedValueOnce(Response.json(SESSION));
    await f.client.associate(); expect(f.browser.request.mock.calls.filter(([method]) => method === "POST").length).toBe(1);
    expect(f.client.getSnapshot().phase).toBe("connected");
  });
  it.each([
    ["autre origine", () => link().replace("delivery.test", "foreign.test")],
    ["HTTP", () => link().replace("https:", "http:")],
    ["origine trompeuse", () => link().replace("delivery.test", "delivery.test.foreign.test")],
    ["identifiants URL", () => link().replace("//", "//user:password@")],
    ["chemin voisin", () => link().replace("/livreur#", "/livreur-other#")],
    ["chemin normalisé", () => link().replace("/livreur#", "/a/../livreur#")],
    ["query", () => link().replace("#", "?secret=value#")],
    ["query vide", () => link().replace("#", "?#")],
    ["fragment seul", () => `#invitation=${TOKEN}`],
    ["lien relatif", () => link().replace("https://delivery.test", "")],
    ["secret court", () => link("short")],
    ["fragment supplémentaire", () => link() + "&extra=1"],
    ["fragment encodé", () => link().replace("invitation=", "invitation=%49")],
    ["contrôle invisible", () => link().replace("delivery.test", "delivery.\ntest")],
    ["taille excessive", () => link() + "a".repeat(2048)],
  ])("refuse %s sans requête ni état contenant le lien", async (_label, input) => {
    const f = fixture(""); await f.client.start();
    expect(f.client.importInvitation((input as () => string)())).toBe(false);
    expect(f.browser.request).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot().hasInvitation).toBe(false);
    expect(JSON.stringify(f.client.getSnapshot()).includes(TOKEN)).toBe(false);
  });
  it("accepte le slash final et les blancs autour, mais pas une origine runtime HTTP", async () => {
    const f = fixture(""); await f.client.start();
    expect(f.client.importInvitation(`  ${link().replace("#", "/#")}  `)).toBe(true);
    const insecure = fixture(""); insecure.browser.origin = () => "http://delivery.test"; await insecure.client.start();
    expect(insecure.client.importInvitation(link().replace("https:", "http:"))).toBe(false);
  });
  it("refuse avant start et pendant une lecture retenue, puis accepte après l’absence confirmée", async () => {
    const f = fixture(""); expect(f.client.importInvitation(link())).toBe(false);
    let finish!: (response: Response) => void;
    f.browser.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const starting = f.client.start(); expect(f.client.importInvitation(link())).toBe(false);
    finish(new Response(null, { status: 204 })); await starting; expect(f.client.importInvitation(link())).toBe(true);
  });
  it("refuse une session inconnue après erreur, même si une lecture antérieure était invitée", async () => {
    const f = fixture(""); await f.client.start();
    f.browser.request.mockRejectedValueOnce(new Error("Unavailable")); await f.client.refresh();
    expect(f.client.importInvitation(link())).toBe(false);
    await f.client.refresh(); expect(f.client.importInvitation(link())).toBe(true);
  });
  it("ne remplace pas une session déjà associée", async () => {
    const f = fixture(""); f.browser.request.mockResolvedValueOnce(Response.json(SESSION)); await f.client.start();
    expect(f.client.importInvitation(link())).toBe(false); expect(f.client.getSnapshot().session).toEqual(SESSION);
    expect(f.browser.request).toHaveBeenCalledTimes(1);
  });
  it.each(["lost", 429, 503] as const)("conserve le même token/nonce après %s malgré de nouveaux collages", async cause => {
    const f = fixture(""); await f.client.start(); expect(f.client.importInvitation(link())).toBe(true);
    if (cause === "lost") f.browser.request.mockRejectedValueOnce(new Error("Lost"));
    else f.browser.request.mockResolvedValueOnce(new Response(null, { status: cause }));
    await f.client.associate();
    expect(f.client.importInvitation(link())).toBe(false);
    expect(f.client.importInvitation(link("B".repeat(43)))).toBe(false);
    f.browser.request.mockResolvedValueOnce(Response.json(SESSION)).mockResolvedValueOnce(Response.json(SESSION));
    await f.client.associate();
    const posts = f.browser.request.mock.calls.filter(([method]) => method === "POST");
    expect(posts.length).toBe(2); expect(JSON.stringify(posts[0]) === JSON.stringify(posts[1])).toBe(true);
    expect(f.browser.nonce).toHaveBeenCalledOnce();
  });
  it("refuse pendant association retenue et pendant déconnexion incertaine même sans session visible", async () => {
    const f = fixture(""); await f.client.start(); f.client.importInvitation(link());
    let finish!: (response: Response) => void;
    f.browser.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const associating = f.client.associate(); expect(f.client.importInvitation(link())).toBe(false);
    finish(new Response(null, { status: 401 })); await associating;
    f.browser.request.mockRejectedValueOnce(new Error("Lost")); await f.client.logout();
    f.client.accessRejected(); expect(f.client.getSnapshot().session).toBeNull();
    expect(f.client.importInvitation(link())).toBe(false);
  });
  it("un refus terminal permet une nouvelle invitation, sans réutiliser l’ancienne tentative", async () => {
    const f = fixture(""); await f.client.start(); f.client.importInvitation(link());
    f.browser.request.mockResolvedValueOnce(new Response(null, { status: 401 })); await f.client.associate();
    expect(f.client.importInvitation(link("B".repeat(43)))).toBe(true);
    f.browser.request.mockResolvedValueOnce(new Response(null, { status: 401 })); await f.client.associate();
    expect(f.browser.nonce).toHaveBeenCalledTimes(2);
  });
  it("un import invalide ne détruit pas l’invitation déjà prête", async () => {
    const f = fixture(""); await f.client.start(); f.client.importInvitation(link());
    expect(f.client.importInvitation("invalid")).toBe(false);
    expect(f.client.getSnapshot()).toMatchObject({ phase: "invitation", hasInvitation: true });
  });
});
