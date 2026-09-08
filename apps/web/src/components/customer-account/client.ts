import { CustomerAccountBrowserRequests, CustomerAccountResponses, CustomerAccountSlugSchema,
  CustomerAccountViewSchema, CustomerAccountBrowserRefSchema, CUSTOMER_ACCOUNT_BROWSER_REF_HEADER, type CustomerAccountView } from "@sm/contracts";
import { selectedCustomerBrowser } from './browser-journal';

type Action = "status" | "browser" | "session" | "name" | "logout";
export type CustomerAccountRequest = (action: Action, body?: unknown) => Promise<unknown>;
export type CustomerAccountState = Readonly<{
  status: "idle" | "loading" | "guest" | "authenticated" | "unavailable" | "error" | "offline";
  view: CustomerAccountView | null; available: boolean; busy: boolean; message: string | null;
}>;
export const EMPTY_ACCOUNT: CustomerAccountState = Object.freeze({ status: "idle", view: null, available: false, busy: false, message: null });
const UNCONFIRMED = "L’action n’est pas confirmée. Actualisez votre compte avant de recommencer.";
const CHANGED = "Votre accès ou votre profil a changé. Actualisez votre compte avant de continuer.";
export class CustomerAccountHttpError extends Error {
  constructor(readonly status: number) { super("Customer account request failed"); }
}

/** Same-origin BFF only. Cookies stay HttpOnly; neither tokens nor upstream
 * error bodies reach the UI, analytics, browser storage or application logs. */
export function customerAccountRequest(slug: string, selected: () => Promise<string | null> = () => selectedCustomerBrowser(slug)): CustomerAccountRequest {
  const valid = CustomerAccountSlugSchema.safeParse(slug).success && slug.length <= 63;
  return async (action, body) => {
    if (!valid) throw new CustomerAccountHttpError(400);
    const paths = { status: "capacites", browser: "navigateur", session: "session", name: "profil", logout: "session" };
    const methods = { status: "GET", browser: "POST", session: "GET", name: "PATCH", logout: "DELETE" };
    let browserRef: string | null = null;
    if (action !== 'status' && action !== 'browser') {
      try { browserRef = await selected(); } catch { throw new CustomerAccountHttpError(409); }
      if (browserRef === null) throw new CustomerAccountHttpError(401);
      if (!CustomerAccountBrowserRefSchema.safeParse(browserRef).success) throw new CustomerAccountHttpError(409);
    }
    const response = await fetch(`/r/${slug}/compte/${paths[action]}`, {
      method: methods[action], credentials: "same-origin", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(browserRef === null ? {} : { [CUSTOMER_ACCOUNT_BROWSER_REF_HEADER]: browserRef }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok || (action === "logout" ? response.status !== 204 : response.status !== 200)) {
      void response.body?.cancel().catch(() => undefined);
      throw new CustomerAccountHttpError(response.status);
    }
    if (action === "logout") {
      if (browserRef !== null && await selected() !== browserRef) throw new CustomerAccountHttpError(409);
      return undefined;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => undefined); throw new CustomerAccountHttpError(502);
    }
    const reader = response.body?.getReader(); if (!reader) throw new CustomerAccountHttpError(502);
    let bytes = 0; let text = ""; let complete = false;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength; if (bytes > 4_096) throw new CustomerAccountHttpError(502);
        text += decoder.decode(next.value, { stream: true });
      }
      complete = true;
      // Clearing storage or selecting B while A was in flight cannot adopt A's
      // response. The server independently binds ref + cookies; neither side
      // tries to repair this ambiguity by choosing a different identity.
      if (browserRef !== null && await selected() !== browserRef) throw new CustomerAccountHttpError(409);
      return JSON.parse(text + decoder.decode()) as unknown;
    } finally { if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
}

type Port = {
  request: CustomerAccountRequest;
  lock?: (job: () => Promise<void>) => Promise<void>;
  announce?: () => void;
  active?: () => boolean;
  now?: () => number;
};
export function sameCustomerSession(a: CustomerAccountView, b: CustomerAccountView) {
  return a.expiresAt === b.expiresAt && a.profile.phoneE164 === b.profile.phoneE164
    && a.profile.phoneVerifiedAt === b.profile.phoneVerifiedAt;
}

/** Read/profil/logout only. Opening signup will require the separate durable
 * browser/challenge receipt protocol; do not add cookie-writing OTP calls here. */
export function createCustomerAccountClient(port: Port) {
  let state = EMPTY_ACCOUNT; let generation = 0; let reading: Promise<void> | null = null;
  let mutating = false; let reloadRequested = false;
  const listeners = new Set<() => void>();
  const now = port.now ?? Date.now;
  const active = port.active ?? (() => true);
  const publish = (patch: Partial<CustomerAccountState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const current = (run: number) => run === generation && active();
  const parse = (raw: unknown) => {
    const result = CustomerAccountViewSchema.parse(raw);
    if (result.expiresAt <= now() || result.expiresAt > now() + 7 * 86_400_000
      || result.profile.phoneVerifiedAt > now()) throw new CustomerAccountHttpError(401);
    return result;
  };
  function invalidate(status: "idle" | "offline" | "guest" = "idle") {
    generation++; reloadRequested = false;
    publish({ status, view: null, available: false, message: status === "offline" ? "Connectez-vous au réseau pour consulter votre compte." : null });
  }
  function fail(error: unknown, mutation = false) {
    const status = error instanceof CustomerAccountHttpError ? error.status : 0;
    publish({ view: null, status: status === 401 ? "guest" : status === 503 ? "unavailable" : "error",
      message: mutation ? UNCONFIRMED : status === 401 ? null : status === 429 ? "Trop de demandes. Patientez avant de réessayer."
        : "Votre compte ne peut pas être vérifié pour le moment. La commande en invité reste disponible." });
  }
  async function refresh() {
    if (!active()) return;
    if (mutating || reading) { reloadRequested = true; return reading ?? undefined; }
    const run = ++generation; publish({ status: "loading", view: null, message: null });
    const work = async () => {
      if (!current(run)) return;
      // Status is an SMS admission signal, never a session/revocation oracle.
      const availability = port.request("status").then(raw => CustomerAccountResponses.status.parse(raw).available, () => false).catch(() => false);
      try {
        const raw = await port.request("session");
        const available = await availability;
        if (current(run)) publish({ status: "authenticated", view: parse(raw), available, message: null });
      } catch (error) {
        const available = await availability;
        if (current(run)) { publish({ available }); fail(error); }
      }
    };
    reading = (port.lock ? port.lock(work) : work()).catch(error => { if (current(run)) fail(error); });
    try { await reading; }
    finally {
      reading = null;
      if (reloadRequested) { reloadRequested = false; if (active()) void refresh(); }
    }
  }
  async function mutate(action: "name" | "logout", input: unknown) {
    const viewed = state.view;
    if (!active() || mutating || reading || !viewed || state.status !== "authenticated") return false;
    if (!port.lock) { publish({ message: "Ce navigateur ne permet pas de sécuriser les modifications entre onglets. Utilisez un navigateur à jour." }); return false; }
    const body = CustomerAccountBrowserRequests[action].safeParse(input);
    if (!body.success) { publish({ message: "Vérifiez le nom renseigné (120 caractères maximum)." }); return false; }
    mutating = true; const run = ++generation; publish({ status: "loading", view: null, busy: true, message: null });
    let confirmed = false; let result: CustomerAccountView | null = null; let conflict = false;
    try {
      await port.lock(async () => {
        if (!current(run)) return;
        port.announce?.();
        const fresh = parse(await port.request("session"));
        if (!current(run)) return;
        if (!sameCustomerSession(viewed, fresh) || viewed.profile.revision !== fresh.profile.revision) { conflict = true; return; }
        const raw = await port.request(action, body.data);
        if (action === "name") {
          result = parse(raw);
          if (!sameCustomerSession(fresh, result) || result.profile.revision <= fresh.profile.revision) throw new CustomerAccountHttpError(502);
        } else if (raw !== undefined) throw new CustomerAccountHttpError(502);
        confirmed = true;
      });
      if (current(run)) {
        if (conflict) publish({ status: "error", view: null, message: CHANGED });
        else if (confirmed) publish({ status: result ? "authenticated" : "guest", view: result, message: result ? "Votre nom a été mis à jour." : "Déconnexion confirmée." });
      }
    } catch (error) { if (current(run)) fail(error, true); }
    finally {
      // Other tabs clear again even if the caller disappeared or lost its reply.
      try { port.announce?.(); } catch { /* The start notification was required before sending. */ }
      mutating = false; publish({ busy: false });
      // A visibility/focus request received while the write was pending must
      // not disappear. This only rereads authority, never retries the write.
      if (reloadRequested) { reloadRequested = false; if (active()) void refresh(); }
    }
    return confirmed && current(run);
  }
  return { refresh, invalidate,
    saveName: (name: string | null) => mutate("name", { name, expectedRevision: state.view?.profile.revision ?? -1 }),
    logout: (all = false) => mutate("logout", { all }),
    getSnapshot: () => state, getServerSnapshot: () => EMPTY_ACCOUNT,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
