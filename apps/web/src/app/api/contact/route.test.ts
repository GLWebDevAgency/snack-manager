import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUEST_ID = "ace93230-8c0a-46ca-808b-8448097a3b54";
const ACK = { ok: true, stored: true, requestId: REQUEST_ID };

const LEAD = {
  requestId: REQUEST_ID,
  need: "menu-tv",
  name: "MARQUEUR_NOM_9f41",
  restaurant: "MARQUEUR_RESTAURANT_9f41",
  phone: "+33 6 99 88 77 66",
  email: "marqueur.9f41@example.invalid",
  callbackSlot: "entre-services",
  message: "MARQUEUR_MESSAGE_9f41",
  platforms: true,
};

const PII_MARKERS = [
  LEAD.name,
  LEAD.restaurant,
  LEAD.phone,
  LEAD.email,
  LEAD.message,
];

function request(body: unknown = LEAD, headers: Record<string, string> = {}) {
  return new Request("https://snackmanager.fr/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://snackmanager.fr",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
      // Un appelant peut falsifier ce champ : aucun contrôle critique ne doit
      // dépendre de sa première valeur dans cette route Next.
      "X-Forwarded-For": "198.51.100.41, 203.0.113.9",
    },
    body: JSON.stringify(body),
  });
}

async function route() {
  vi.resetModules();
  return import("./route");
}

function captureLogs() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  return {
    text: () => JSON.stringify([...warn.mock.calls, ...error.mock.calls]),
  };
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://snackmanager.fr";
    process.env.API_URL = "https://api.snackmanager.test";
    process.env.LEADS_ENDPOINT = "/public/leads";
    process.env.SM_CONTACT_INGEST_TOKEN = "contact-test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.API_URL;
    delete process.env.LEADS_ENDPOINT;
    delete process.env.SM_CONTACT_INGEST_TOKEN;
  });

  it("n'affiche le succès qu'après l'accusé d'une écriture durable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(ACK, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await route();

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ACK);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer contact-test-token",
    });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toMatchObject({ ...LEAD, source: "site-vitrine" });
  });

  it("ne perd pas un vrai lead si un gestionnaire d'autoremplissage ajoute company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(ACK, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await route();

    const response = await POST(request({ ...LEAD, company: "AutoFill SARL" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ACK);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([404, 405, 422, 500])(
    "refuse le faux succès et ne journalise aucune PII quand l'API répond %i",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      const logs = captureLogs();
      const { POST } = await route();

      const response = await POST(request());

      expect(response.ok).toBe(false);
      expect((await response.json()).ok).toBe(false);
      for (const marker of PII_MARKERS) expect(logs.text()).not.toContain(marker);
    },
  );

  it.each([
    new Error(`réseau indisponible ${LEAD.phone}`),
    new DOMException(`délai dépassé ${LEAD.email}`, "TimeoutError"),
  ])("ne recopie pas le message brut d'une erreur réseau dans les logs", async (failure) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    const logs = captureLogs();
    const { POST } = await route();

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect((await response.json()).ok).toBe(false);
    for (const marker of PII_MARKERS) expect(logs.text()).not.toContain(marker);
  });

  it("échoue fermé sans secret d'ingestion et n'envoie pas les coordonnées", async () => {
    delete process.env.SM_CONTACT_INGEST_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logs = captureLogs();
    const { POST } = await route();

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const marker of PII_MARKERS) expect(logs.text()).not.toContain(marker);
  });

  it.each([
    { Origin: "https://attacker.test" },
    { Origin: "" },
    { "Sec-Fetch-Site": "cross-site" },
    { "X-Forwarded-Host": "attacker.test", "X-Forwarded-Proto": "https", Origin: "https://attacker.test" },
  ] as Record<string, string>[])("refuse une origine étrangère ou manquante (%j)", async (headers) => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    expect((await POST(request(LEAD, headers))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { ...LEAD, name: "a".repeat(121) },
    { ...LEAD, restaurant: "a".repeat(161) },
    { ...LEAD, email: "invalide" },
    { ...LEAD, email: `${"a".repeat(148)}@example.test` },
    { ...LEAD, requestId: "invalide" },
    { ...LEAD, message: "a".repeat(2001) },
    { ...LEAD, need: "offre-inconnue" },
    { ...LEAD, callbackSlot: "inconnu" },
    { ...LEAD, message: { nested: true } },
    [LEAD], null,
  ])("rejette les données invalides sans troncature (%j)", async (body) => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    expect((await POST(request(body))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("borne les octets lus même si Content-Length est falsifié", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    expect((await POST(request({ ...LEAD, ignored: "界".repeat(6000) }, { "Content-Length": "100" }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuse les formats non JSON", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    expect((await POST(request(LEAD, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([{}, { ok: true }, { ...ACK, stored: false }, { ...ACK, requestId: "b0bb3e01-a7fa-47b4-bafd-2b3a41fd97c6" }])(
    "refuse un HTTP 201 sans accusé correspondant (%j)", async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 201 })));
      captureLogs();
      const { POST } = await route();
      expect((await POST(request())).status).toBe(502);
    },
  );

  it("garde le même identifiant transmis lors de deux tentatives", async () => {
    const send = vi.fn().mockImplementation(async () => Response.json(ACK, { status: 201 }));
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    await POST(request());
    await POST(request());
    expect(send.mock.calls.map(([, init]) => JSON.parse(init.body).requestId)).toEqual([REQUEST_ID, REQUEST_ID]);
  });

  it("accepte un ancien client sans identifiant ni e-mail ni besoin", async () => {
    const send = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      expect(input.email).toBeNull();
      expect(input.need).toBeNull();
      expect(input.requestId).toMatch(/^[0-9a-f-]{36}$/);
      return Response.json({ ...ACK, requestId: input.requestId }, { status: 201 });
    });
    vi.stubGlobal("fetch", send);
    const { POST } = await route();
    expect((await POST(request({ ...LEAD, requestId: undefined, need: undefined, email: "" }))).status).toBe(200);
  });

  it.each([409, 429])("conserve le refus métier HTTP %i sans exposer de détails", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(LEAD, { status })));
    captureLogs();
    const { POST } = await route();
    const response = await POST(request());
    expect(response.status).toBe(status);
    const text = await response.text();
    for (const marker of PII_MARKERS) expect(text).not.toContain(marker);
  });

});
