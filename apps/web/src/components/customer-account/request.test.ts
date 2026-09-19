import { afterEach, describe, expect, it, vi } from "vitest";
import { customerAccountRequest, CustomerAccountHttpError } from "./client";
const browserRef = '10000000-0000-4000-8000-000000000001';
const selected = async () => browserRef;
const publication = async () => ({ expectedOperationId: browserRef, expectedCheckId: browserRef });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Compte client — transport privé same-origin", () => {
  it('binds private requests to the journal selector, never adopting a cookie alone', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ result: 'fixture' })); vi.stubGlobal('fetch', fetch);
    await expect(customerAccountRequest('classfood', async () => null)('session')).rejects.toMatchObject({ status: 401 });
    await expect(customerAccountRequest('classfood', async () => 'bad')('session')).rejects.toMatchObject({ status: 409 });
    await expect(customerAccountRequest('classfood', async () => { throw Error('Storage refused'); })('session')).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
    await customerAccountRequest('classfood', selected, publication)('session');
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-sm-customer-browser-ref')).toBe(browserRef);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-sm-customer-operation-id')).toBe(browserRef);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('x-sm-customer-check-id')).toBe(browserRef);
  });
  it.each(['session', 'logout'] as const)('rejects a late %s result after the selected preparation changed', async action => {
    const read = vi.fn().mockResolvedValueOnce(browserRef).mockResolvedValueOnce('20000000-0000-4000-8000-000000000002');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(action === 'logout' ? new Response(null, { status: 204 }) : Response.json({ result: 'fixture' })));
    await expect(customerAccountRequest('classfood', read, publication)(action, action === 'logout' ? { all: false } : undefined)).rejects.toMatchObject({ status: 409 });
  });
  it.each(['session', 'name', 'logout'] as const)('never adopts a cookie for %s without a completed journal publication', async action => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(customerAccountRequest('classfood', selected, async () => null)(action)).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['session', 'logout'] as const)('rejects a late %s result when the selected publication changed within the same browser', async action => {
    const pub = vi.fn().mockResolvedValueOnce(await publication()).mockResolvedValueOnce({
      expectedOperationId: '20000000-0000-4000-8000-000000000002', expectedCheckId: browserRef });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(action === 'logout' ? new Response(null, { status: 204 }) : Response.json({ result: 'fixture' })));
    await expect(customerAccountRequest('classfood', selected, pub)(action)).rejects.toMatchObject({ status: 409 });
  });
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
    vi.stubGlobal("fetch", fetch); const request = customerAccountRequest("classfood", selected, publication);
    await request("name", { name: "Camille", expectedRevision: 2 }); await request("logout", { all: false });
    expect(fetch).toHaveBeenNthCalledWith(1, "/r/classfood/compte/profil", expect.objectContaining({ method: "PATCH", body: '{"name":"Camille","expectedRevision":2}' }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/r/classfood/compte/session", expect.objectContaining({ method: "DELETE", body: '{"all":false}' }));
    fetch.mockResolvedValue(Response.json({ message: "looks successful" }));
    await expect(request("logout", { all: false })).rejects.toBeInstanceOf(CustomerAccountHttpError);
  });
  it("une erreur ne reflète jamais le corps amont", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "private-value" }, { status: 503 })));
    const error = await customerAccountRequest("classfood", selected, publication)("session").catch(error => error);
    expect(error).toMatchObject({ status: 503 });
    if (!(error instanceof CustomerAccountHttpError)) throw new Error("Expected sanitized HTTP error");
    expect(error.message).not.toContain("private-value");
  });
  it.each([new Response("<h1>Proxy error</h1>", { headers: { "content-type": "text/html" } }),
    Response.json({ value: "x".repeat(4_100) }), new Response("{invalid", { headers: { "content-type": "application/json" } })])("refuse contenu non JSON, surdimensionné ou invalide", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(customerAccountRequest("classfood", selected, publication)("session")).rejects.toThrow();
  });
});

describe('verification browser budgets', () => {
  function clock() {
    vi.useFakeTimers();
    return vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const abort = new AbortController(); setTimeout(() => abort.abort(), ms); return abort.signal;
    });
  }
  it.each([['start', 70_000], ['check', 50_000], ['status', 12_000]] as const)(
    'bounds a silent %s request at %s ms and never retries it', async (action, budget) => {
      clock(); const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
      })); vi.stubGlobal('fetch', fetch);
      const pending = customerAccountRequest('classfood', selected)(action).catch(error => error);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(budget);
      expect(await pending).toMatchObject({ message: 'interrupted' });
      expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
    });
  it.each(['start', 'check'] as const)('accepts %s beyond the former twelve seconds while keeping selection pinned', async action => {
    clock(); let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    const read = vi.fn().mockResolvedValue(browserRef);
    const pending = customerAccountRequest('classfood', read)(action);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(15_000);
    resolve(Response.json({ challengeId: browserRef, expiresAt: Date.now() + 60_000 }));
    expect(await pending).toMatchObject({ challengeId: browserRef });
    expect(read).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a delayed start result if another preparation replaced its identity', async () => {
    clock(); let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetch);
    const read = vi.fn().mockResolvedValue(browserRef);
    const pending = customerAccountRequest('classfood', read)('start').catch(error => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(15_000);
    read.mockResolvedValue('20000000-0000-4000-8000-000000000002');
    resolve(Response.json({ challengeId: browserRef, expiresAt: Date.now() + 60_000 }));
    expect(await pending).toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
