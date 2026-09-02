import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LEAD = {
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

function request(body: unknown = LEAD) {
  return new Request("https://snackmanager.fr/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
    process.env.API_URL = "https://api.snackmanager.test";
    process.env.LEADS_ENDPOINT = "/public/leads";
    process.env.SM_CONTACT_INGEST_TOKEN = "contact-test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.API_URL;
    delete process.env.LEADS_ENDPOINT;
    delete process.env.SM_CONTACT_INGEST_TOKEN;
  });

  it("n'affiche le succès qu'après l'accusé d'une écriture durable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await route();

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer contact-test-token",
    });
  });

  it("ne perd pas un vrai lead si un gestionnaire d'autoremplissage ajoute company", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await route();

    const response = await POST(request({ ...LEAD, company: "AutoFill SARL" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, stored: true });
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
});
