import { DeliveryAccessSecretSchema, DeliverySessionViewSchema, type DeliverySessionView } from "@sm/contracts";
import { capturedInvitation } from "./invitation-bootstrap";

type Phase = "checking" | "invitation" | "missing" | "connected" | "associating" | "disconnecting" | "error";
type Reason = "invalid" | "browser" | "offline" | "network" | "revoked" | "exchange" | "logout" | "expired-link" | "rate" | null;
export type AccessState = Readonly<{ phase: Phase; reason: Reason; session: DeliverySessionView | null;
  hasInvitation: boolean; online: boolean; exchangePending: boolean; logoutPending: boolean; signedOut: boolean }>;
const INITIAL: AccessState = { phase: "checking", reason: null, session: null,
  hasInvitation: false, online: true, exchangePending: false, logoutPending: false, signedOut: false };

export type AccessBrowser = {
  fragment: () => string;
  removeFragment: () => void;
  online: () => boolean;
  nonce: () => string;
  request: (method: "GET" | "POST" | "DELETE", body?: unknown) => Promise<Response>;
};

/** Read once, erase before interpreting, and retain only in this page's memory. */
export function takeInvitation(browser: Pick<AccessBrowser, "fragment" | "removeFragment">) {
  const fragment = browser.fragment();
  if (!fragment) return { token: null, invalid: false };
  browser.removeFragment();
  const match = /^#invitation=([A-Za-z0-9_-]{43})$/.exec(fragment);
  return { token: match?.[1] ?? null, invalid: !match };
}

export function secureNonce(crypto: Pick<Crypto, "getRandomValues">): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const browserPort: AccessBrowser = {
  fragment: capturedInvitation,
  removeFragment: () => window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search),
  online: () => navigator.onLine !== false,
  nonce: () => secureNonce(window.crypto),
  request: (method, body) => fetch("/livreur/acces", {
    method, credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000),
  }),
};

/** State contains only the public identity. Invitation and nonce stay in this closure. */
export function createDeliveryAccessClient(browser: AccessBrowser = browserPort) {
  let state = INITIAL;
  let invitation: string | null = null;
  let nonce: string | null = null;
  let captured = false;
  let captureFailure: Reason = null;
  let busy = false;
  let revocation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AccessState>) => {
    state = { ...state, ...patch, hasInvitation: invitation !== null };
    listeners.forEach(listener => listener());
  };
  const fail = (reason: Reason) => publish({ phase: "error", reason, online: browser.online() });
  const ready = () => publish({ phase: invitation ? "invitation" : "missing", session: null, reason: null });
  const connected = (session: DeliverySessionView) => {
    if (!browser.online()) { fail("offline"); return; }
    publish({ phase: "connected", reason: null, session, online: true, signedOut: false });
  };
  const readSession = async () => {
    const response = await browser.request("GET");
    if (response.status === 204) return null;
    if (response.status === 401) return "revoked" as const;
    if (!response.ok) throw new Error("Session unavailable");
    const parsed = DeliverySessionViewSchema.safeParse(await response.json());
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) throw new Error("Session unavailable");
    return parsed.data;
  };

  async function refresh() {
    if (busy || state.exchangePending || state.logoutPending) return;
    if (captureFailure) { fail(captureFailure); return; }
    if (!browser.online()) { fail("offline"); return; }
    busy = true;
    const observedRevocation = revocation;
    publish({ phase: "checking", reason: null, online: true });
    try {
      const session = await readSession();
      if (observedRevocation !== revocation) return;
      if (session && session !== "revoked") connected(session);
      else if (session === "revoked") { publish({ session: null }); fail("revoked"); }
      else ready();
    } catch { if (observedRevocation === revocation) fail(browser.online() ? "network" : "offline"); }
    finally { busy = false; }
  }

  async function start() {
    if (!captured) {
      captured = true;
      try {
        const found = takeInvitation(browser);
        invitation = found.token;
        if (found.invalid) { captureFailure = "invalid"; fail(captureFailure); return; }
      } catch { captureFailure = "browser"; fail(captureFailure); return; }
    }
    await refresh();
  }

  async function associate() {
    if (busy || !invitation || state.session) return;
    if (!browser.online()) { fail("offline"); return; }
    try {
      nonce ??= browser.nonce();
      if (!DeliveryAccessSecretSchema.safeParse(nonce).success) throw new Error("Secure browser required");
    } catch { fail("browser"); return; }
    busy = true;
    publish({ phase: "associating", reason: null, online: true, exchangePending: true });
    try {
      const response = await browser.request("POST", { token: invitation, nonce });
      // The BFF maps terminal invitation errors to 401. Its own 403 origin
      // rejection has not consumed the invitation: retain the same attempt.
      if ([400, 401, 409, 410].includes(response.status)) {
        invitation = null; nonce = null;
        publish({ exchangePending: false }); fail("expired-link"); return;
      }
      if (response.status === 429) { fail("rate"); return; }
      if (!response.ok) { fail("exchange"); return; }
      // Prove that this browser retained its HttpOnly cookie before claiming success.
      const session = await readSession();
      if (!session || session === "revoked") { fail("exchange"); return; }
      invitation = null; nonce = null;
      publish({ exchangePending: false });
      connected(session);
    } catch { fail(browser.online() ? "exchange" : "offline"); }
    finally { busy = false; }
  }

  async function logout() {
    if (busy) return;
    if (!browser.online()) { fail("offline"); return; }
    busy = true;
    publish({ phase: "disconnecting", reason: null, online: true, logoutPending: true });
    try {
      const response = await browser.request("DELETE");
      if (response.status !== 204) { fail("logout"); return; }
      publish({ session: null, signedOut: true, logoutPending: false });
      ready();
    } catch { fail(browser.online() ? "logout" : "offline"); }
    finally { busy = false; }
  }

  function connectivityChanged() {
    if (!browser.online()) fail("offline");
    else {
      publish({ online: true });
      if (state.exchangePending) fail("exchange");
      else if (state.logoutPending) fail("logout");
      else void refresh();
    }
  }

  return { start, refresh, associate, logout, connectivityChanged,
    accessRejected: () => { revocation++; publish({ session: null }); fail("revoked"); },
    getSnapshot: () => state, getServerSnapshot: () => INITIAL,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
