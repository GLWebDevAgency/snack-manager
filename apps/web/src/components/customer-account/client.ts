import { CustomerAccountBrowserRequests, CustomerAccountResponses, CustomerAccountSlugSchema,
  CustomerAccountViewSchema, CustomerAccountBrowserRefSchema, CustomerAccountPublicationSchema,
  CUSTOMER_ACCOUNT_BROWSER_REF_HEADER, CUSTOMER_ACCOUNT_OPERATION_HEADER, CUSTOMER_ACCOUNT_CHECK_HEADER,
  customerAccountResponseLimit, type CustomerAccountAction, type CustomerAccountView, type CustomerAccountPublication } from "@sm/contracts";
import { selectedCustomerBrowser, selectedCustomerPublication } from './browser-journal';

type Action = CustomerAccountAction;
const PRIVATE_ACTIONS: readonly Action[] = ['session', 'name', 'logout', 'orders', 'order-detail', 'order-create', 'order-reorder', 'loyalty'];
export type CustomerAccountSelection = { browserRef: string; publication: CustomerAccountPublication };
export type CustomerAccountAccess = { selection: CustomerAccountSelection; expiresAt: number };
export type CustomerAccountRequest = ((action: Action, body?: unknown, expectedSelection?: CustomerAccountSelection) => Promise<unknown>) & {
  selection?: () => Promise<CustomerAccountSelection | null>;
};
export type CustomerAccountState = Readonly<{
  status: "idle" | "loading" | "guest" | "authenticated" | "unavailable" | "error" | "offline";
  view: CustomerAccountView | null; available: boolean; busy: boolean; message: string | null;
  registrationAvailable?: boolean; accessAvailable?: boolean;
}>;
export const EMPTY_ACCOUNT: CustomerAccountState = Object.freeze({ status: "idle", view: null, available: false, busy: false, message: null });
const UNCONFIRMED = "L’action n’est pas confirmée. Actualisez votre compte avant de recommencer.";
const CHANGED = "Votre accès ou votre profil a changé. Actualisez votre compte avant de continuer.";
export class CustomerAccountHttpError extends Error {
  constructor(readonly status: number) { super("Customer account request failed"); }
}

/** Same-origin BFF only. Cookies stay HttpOnly; neither tokens nor upstream
 * error bodies reach the UI, analytics, browser storage or application logs. */
export function customerAccountRequest(slug: string, selected: () => Promise<string | null> = () => selectedCustomerBrowser(slug),
  publication: () => Promise<CustomerAccountPublication | null> = () => selectedCustomerPublication(slug)): CustomerAccountRequest {
  const valid = CustomerAccountSlugSchema.safeParse(slug).success && slug.length <= 63;
  const request: CustomerAccountRequest = async (action, body, expectedSelection) => {
    if (!valid) throw new CustomerAccountHttpError(400);
    if (['orders', 'order-detail', 'order-create', 'order-reorder', 'loyalty'].includes(action) && !expectedSelection) throw new CustomerAccountHttpError(409);
    const paths = { status: "capacites", browser: "navigateur", intent: "intention", start: "verification", check: "confirmation", recover: "resultat", protection: "protection", passkey: "cle-acces", recovery: "secours", session: "session", name: "profil", logout: "session", orders: 'commandes/recherche', 'order-detail': 'commandes/detail', 'order-create': 'commandes', 'order-reorder': 'commandes/recommander', loyalty: 'fidelite' };
    const methods = { status: "GET", browser: "POST", intent: "POST", start: "POST", check: "POST", recover: "POST", protection: "POST", passkey: "POST", recovery: "POST", session: "GET", name: "PATCH", logout: "DELETE", orders: 'POST', 'order-detail': 'POST', 'order-create': 'POST', 'order-reorder': 'POST', loyalty: 'POST' };
    let browserRef: string | null = null;
    let expected: CustomerAccountPublication | null = null;
    if (action !== 'status' && action !== 'browser') {
      try { browserRef = await selected(); } catch { throw new CustomerAccountHttpError(409); }
      if (browserRef === null) throw new CustomerAccountHttpError(401);
      if (!CustomerAccountBrowserRefSchema.safeParse(browserRef).success) throw new CustomerAccountHttpError(409);
    }
    if (PRIVATE_ACTIONS.includes(action)) {
      try { expected = await publication(); } catch { throw new CustomerAccountHttpError(409); }
      if (expected === null) throw new CustomerAccountHttpError(401);
      if (!CustomerAccountPublicationSchema.safeParse(expected).success) throw new CustomerAccountHttpError(409);
    }
    // Pin the publication which produced the displayed view, rather than
    // silently adopting whichever journal is selected after an async wait.
    if (expectedSelection && (browserRef !== expectedSelection.browserRef
      || !expected || !sameSelection({ browserRef, publication: expected }, expectedSelection))) throw new CustomerAccountHttpError(409);
    const unchanged = async () => {
      if ((browserRef !== null && await selected() !== browserRef)
        || (expected !== null && JSON.stringify(await publication()) !== JSON.stringify(expected))) throw new CustomerAccountHttpError(409);
    };
    const response = await fetch(`/r/${slug}/compte/${paths[action]}`, {
      method: methods[action], credentials: "same-origin", cache: "no-store", redirect: "error",
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(browserRef === null ? {} : { [CUSTOMER_ACCOUNT_BROWSER_REF_HEADER]: browserRef }),
        ...(expected === null ? {} : { [CUSTOMER_ACCOUNT_OPERATION_HEADER]: expected.expectedOperationId, [CUSTOMER_ACCOUNT_CHECK_HEADER]: expected.expectedCheckId }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok || (action === "logout" ? response.status !== 204 : response.status !== 200)) {
      void response.body?.cancel().catch(() => undefined);
      throw new CustomerAccountHttpError(response.status);
    }
    if (action === "logout") {
      await unchanged();
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
        bytes += next.value.byteLength; if (bytes > (['orders', 'order-detail', 'order-create', 'order-reorder', 'loyalty'].includes(action) ? customerAccountResponseLimit(action) : ['protection', 'passkey', 'recovery'].includes(action) ? 65_536 : 4_096)) throw new CustomerAccountHttpError(502);
        text += decoder.decode(next.value, { stream: true });
      }
      complete = true;
      // Clearing storage or selecting B while A was in flight cannot adopt A's
      // response. The server independently binds ref + cookies; neither side
      // tries to repair this ambiguity by choosing a different identity.
      await unchanged();
      return JSON.parse(text + decoder.decode()) as unknown;
    } finally { if (!complete) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
  request.selection = async () => {
    const browserRef = await selected(), expected = await publication();
    if (browserRef === null || expected === null) return null;
    return { browserRef: CustomerAccountBrowserRefSchema.parse(browserRef), publication: CustomerAccountPublicationSchema.parse(expected) };
  };
  return request;
}

function sameSelection(a: CustomerAccountSelection, b: CustomerAccountSelection) {
  return a.browserRef === b.browserRef && a.publication.expectedOperationId === b.publication.expectedOperationId
    && a.publication.expectedCheckId === b.publication.expectedCheckId;
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
  let viewedSelection: CustomerAccountSelection | null = null;
  let mutating = false; let reloadRequested = false;
  const listeners = new Set<() => void>();
  const now = port.now ?? Date.now;
  const active = port.active ?? (() => true);
  const publish = (patch: Partial<CustomerAccountState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const current = (run: number) => run === generation && active();
  async function selection() {
    if (!port.request.selection) throw new CustomerAccountHttpError(409);
    const selected = await port.request.selection();
    if (!selected) throw new CustomerAccountHttpError(401);
    return { browserRef: CustomerAccountBrowserRefSchema.parse(selected.browserRef),
      publication: CustomerAccountPublicationSchema.parse(selected.publication) };
  }
  const parse = (raw: unknown) => {
    const result = CustomerAccountViewSchema.parse(raw);
    if (result.expiresAt <= now() || result.expiresAt > now() + 7 * 86_400_000
      || result.profile.phoneVerifiedAt > now()) throw new CustomerAccountHttpError(401);
    return result;
  };
  function invalidate(status: "idle" | "offline" | "guest" = "idle") {
    generation++; reloadRequested = false; viewedSelection = null;
    publish({ status, view: null, available: false, registrationAvailable: false, accessAvailable: false,
      message: status === "offline" ? "Connectez-vous au réseau pour consulter votre compte." : null });
  }
  function fail(error: unknown, mutation = false) {
    viewedSelection = null;
    const status = error instanceof CustomerAccountHttpError ? error.status : 0;
    publish({ view: null, status: status === 401 ? "guest" : status === 503 ? "unavailable" : "error",
      message: mutation ? UNCONFIRMED : status === 401 ? null : status === 429 ? "Trop de demandes. Patientez avant de réessayer."
        : "Votre compte ne peut pas être vérifié pour le moment. La commande en invité reste disponible." });
  }
  async function refresh() {
    if (!active()) return;
    if (mutating || reading) { reloadRequested = true; return reading ?? undefined; }
    const run = ++generation; viewedSelection = null; publish({ status: "loading", view: null, message: null });
    const work = async () => {
      if (!current(run)) return;
      // Status is an SMS admission signal, never a session/revocation oracle.
      const closed = { available: false, registrationAvailable: false, accessAvailable: false };
      const availability = port.request("status").then(raw => {
        const caps = CustomerAccountResponses.status.parse(raw);
        return { available: caps.available, registrationAvailable: caps.registrationAvailable === true, accessAvailable: caps.accessAvailable === true };
      }, () => closed).catch(() => closed);
      try {
        const selected = await selection();
        if (!current(run)) return;
        const raw = await port.request("session", undefined, selected);
        const capabilities = await availability;
        if (!sameSelection(selected, await selection())) throw new CustomerAccountHttpError(409);
        if (current(run)) {
          const view = parse(raw); viewedSelection = selected;
          publish({ status: "authenticated", view, ...capabilities, message: null });
        }
      } catch (error) {
        const capabilities = await availability;
        if (current(run)) { publish(capabilities); fail(error); }
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
    const viewed = state.view, selected = viewedSelection;
    if (!active() || mutating || reading || !viewed || !selected || state.status !== "authenticated") return false;
    if (!port.lock) { publish({ message: "Ce navigateur ne permet pas de sécuriser les modifications entre onglets. Utilisez un navigateur à jour." }); return false; }
    const body = CustomerAccountBrowserRequests[action].safeParse(input);
    if (!body.success) { publish({ message: "Vérifiez le nom renseigné (120 caractères maximum)." }); return false; }
    mutating = true; const run = ++generation; viewedSelection = null; publish({ status: "loading", view: null, busy: true, message: null });
    let confirmed = false; let result: CustomerAccountView | null = null; let conflict = false;
    try {
      await port.lock(async () => {
        if (!current(run)) return;
        if (!sameSelection(selected, await selection())) { conflict = true; return; }
        if (!current(run)) return;
        port.announce?.();
        const fresh = parse(await port.request("session", undefined, selected));
        if (!sameSelection(selected, await selection())) { conflict = true; return; }
        if (!current(run)) return;
        if (!sameCustomerSession(viewed, fresh) || viewed.profile.revision !== fresh.profile.revision) { conflict = true; return; }
        const raw = await port.request(action, body.data, selected);
        if (!sameSelection(selected, await selection())) throw new CustomerAccountHttpError(409);
        if (action === "name") {
          result = parse(raw);
          if (!sameCustomerSession(fresh, result) || result.profile.revision <= fresh.profile.revision) throw new CustomerAccountHttpError(502);
        } else if (raw !== undefined) throw new CustomerAccountHttpError(502);
        confirmed = true;
      });
      if (current(run)) {
        if (conflict) publish({ status: "error", view: null, message: CHANGED });
        else if (confirmed) {
          viewedSelection = result ? selected : null;
          publish({ status: result ? "authenticated" : "guest", view: result, message: result ? "Votre nom a été mis à jour." : "Déconnexion confirmée." });
        }
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
    // Public correlation only, captured from the session which actually
    // produced this view. Consumers must still revalidate it before/after I/O.
    currentAccess: (): CustomerAccountAccess | null => active() && !mutating && state.status === 'authenticated'
      && state.view && state.view.expiresAt > now() && viewedSelection
      ? { selection: structuredClone(viewedSelection), expiresAt: state.view.expiresAt } : null,
    saveName: (name: string | null) => mutate("name", { name, expectedRevision: state.view?.profile.revision ?? -1 }),
    logout: (all = false) => mutate("logout", { all }),
    getSnapshot: () => state, getServerSnapshot: () => EMPTY_ACCOUNT,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
