import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes, CustomerAccountResponses,
  CustomerAccountBrowserRefSchema, CustomerAccountPublicationSchema, CUSTOMER_ACCOUNT_BROWSER_REF_HEADER,
  CUSTOMER_ACCOUNT_OPERATION_HEADER, CUSTOMER_ACCOUNT_CHECK_HEADER, customerAccountRequestLimit, customerAccountResponseLimit,
  type CustomerEnrollment, type CustomerAccountAction } from '@sm/contracts';
import { customerRelayHeaders } from './customer-relay';
import { parseCustomerOrdersPage, parseCustomerOrderDetail } from '../../../../components/customer-account/orders-response';

type Action = CustomerAccountAction;
const PRIVATE_ACTIONS: readonly Action[] = ['session', 'name', 'logout', 'orders', 'order-detail', 'order-create'];
export type CustomerContext = { params: Promise<{ slug: string }> };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const TIMEOUT_MS = 10_000;
const SESSION_MAX_MS = 7 * 86_400_000;
const PATHS: Record<Action, string> = { status: 'capacites', browser: 'navigateur', intent: 'intention', start: 'verification',
  check: 'confirmation', recover: 'resultat', protection: 'protection', passkey: 'cle-acces', recovery: 'secours', session: 'session', name: 'profil', logout: 'session',
  orders: 'commandes/recherche', 'order-detail': 'commandes/detail', 'order-create': 'commandes' };
const METHODS: Record<Action, string> = { status: 'GET', browser: 'POST', intent: 'POST', start: 'POST', check: 'POST',
  recover: 'POST', protection: 'POST', passkey: 'POST', recovery: 'POST', session: 'GET', name: 'PATCH', logout: 'DELETE',
  orders: 'POST', 'order-detail': 'POST', 'order-create': 'POST' };

function privateResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Vary', 'Cookie, Origin');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
function failure(status: number, code: string, message: string) {
  return privateResponse(NextResponse.json({ code, message }, { status }));
}
const unavailable = () => failure(503, 'CUSTOMER_UNAVAILABLE', 'Le compte client est indisponible. Vous pouvez continuer à commander en invité.');
const invalid = () => failure(400, 'CUSTOMER_INVALID_REQUEST', 'Cette demande de compte est invalide.');
const unauthorized = () => failure(401, 'CUSTOMER_UNAUTHORIZED', 'Cet accès au compte est invalide ou expiré.');
const closed = () => privateResponse(NextResponse.json({ available: false }));

function originOf(raw: string | null): string | null {
  if (!raw || raw.includes(',')) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === raw && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
function requestOrigin(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host');
  const protocol = request.headers.get('x-forwarded-proto');
  if (host !== null || protocol !== null) {
    return host && protocol === 'https' ? originOf(`https://${host}`) : null;
  }
  return request.nextUrl.protocol === 'https:'
    ? originOf(`https://${request.headers.get('host') ?? request.nextUrl.host}`) : null;
}
function list(raw: string | undefined, valid: (item: string) => boolean): string[] | null {
  if (!raw || raw.length > 4_096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.length > 0 && value.length <= 32
      && value.every(item => typeof item === 'string' && valid(item))
      && new Set(value).size === value.length ? value : null;
  } catch { return null; }
}
function configuration(slug: string, origin: string) {
  const env = process.env;
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || (env.SM_ENV !== undefined && env.SM_ENV !== 'staging')
    || (env.SM_CUSTOMER_ACCOUNT_MODE !== 'closed_trial' && env.SM_CUSTOMER_ACCOUNT_MODE !== 'closed_paid_pilot')
    || !UUID.test(env.RAILWAY_ENVIRONMENT_ID ?? '') || !UUID.test(env.RAILWAY_PROJECT_ID ?? '')
    || env.SM_CUSTOMER_PILOT_ENVIRONMENT_ID !== env.RAILWAY_ENVIRONMENT_ID
    || env.SM_CUSTOMER_PILOT_PROJECT_ID !== env.RAILWAY_PROJECT_ID) return null;
  const origins = list(env.SM_CUSTOMER_PILOT_ORIGINS, item => originOf(item) !== null);
  const slugs = list(env.SM_CUSTOMER_PILOT_SLUGS, item => item.length <= 63 && SLUG.test(item));
  const rawKey = env.SM_CUSTOMER_RELAY_SIGNING_KEY;
  const apiOrigin = originOf(env.NEXT_PUBLIC_API_URL ?? null);
  if (!apiOrigin || !origins?.includes(origin) || !slugs?.includes(slug)
    || !rawKey || !/^[A-Za-z0-9+/]{43}=$/.test(rawKey)) return null;
  const key = Buffer.from(rawKey, 'base64');
  if (key.byteLength !== 32 || key.toString('base64') !== rawKey) return null;
  return { key, apiOrigin };
}

/** Deployment prerequisite: Railway must overwrite x-real-ip at its trusted
 * ingress. This software does not attest infrastructure. XFF and arbitrary
 * request-id headers cannot substitute for that operational verification. */
function clientIp(request: NextRequest): string | null {
  const raw = request.headers.get('x-real-ip');
  if (!raw || raw !== raw.trim() || raw.includes('%') || !isIP(raw)) return null;
  if (isIP(raw) === 4) return raw;
  const canonical = new URL(`http://[${raw}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16), lo = parseInt(mapped[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return canonical;
}
function cookieName(slug: string, kind: 'browser' | 'session') {
  return `__Host-sm_customer_${kind}_${slug}`;
}
function intentCookieName(slug: string, operationId: string) {
  // Separate names prevent delayed proof(A) headers from overwriting proof(B).
  // SQL limits three unexpired proofs per browser; expiry is absolute/short.
  return `__Host-sm_customer_intent_${slug}_${operationId}`;
}
function cookieOptions() {
  // __Host- prevents a sibling subdomain from planting a Domain cookie. Path=/
  // is mandatory for that browser-enforced boundary; the name and API remain
  // tenant-scoped. The existing presentation QR cookie is never changed.
  return { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', priority: 'high' as const };
}
function readCookie(request: NextRequest, slug: string, kind: 'browser' | 'session') {
  return readNamedCookie(request, cookieName(slug, kind));
}
function readNamedCookie(request: NextRequest, name: string) {
  const copies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.split('=', 1)[0] === name);
  if (!copies.length) return { kind: 'absent' } as const;
  const value = copies[0]!.slice(name.length + 1);
  if (copies.length !== 1 || !SECRET.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) {
    return { kind: 'invalid' } as const;
  }
  return { kind: 'valid', value } as const;
}
/** Covers the entire response body, not just receiving the HTTP headers. */
async function within<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('Customer request interrupted'));
      signal.addEventListener('abort', cancel, { once: true });
    })]);
  } finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
async function boundedJson(message: Request | Response, signal: AbortSignal, limit: number): Promise<unknown> {
  const size = message.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > limit)) throw new Error('Invalid body');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(message.headers.get('content-type') ?? '')) throw new Error('Invalid body');
  const reader = message.body?.getReader();
  if (!reader) throw new Error('Invalid body');
  let complete = false;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const next = await within(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error('Invalid body');
      text += decoder.decode(next.value, { stream: true });
    }
    complete = true;
    return JSON.parse(text + decoder.decode());
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function discard(response: Response) { if (response.body) void response.body.cancel().catch(() => undefined); }
function validEnrollment(enrollment: CustomerEnrollment, selected: { operationId: string; checkId: string | null }) {
  const remaining = enrollment.expiresAt - Date.now();
  return enrollment.operationId === selected.operationId && enrollment.checkId === selected.checkId
    && remaining > 0 && remaining <= 600_000;
}

export async function customerAccount(request: NextRequest, context: CustomerContext, action: Action): Promise<NextResponse> {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  try {
    const { slug } = await within(context.params, signal);
    if (slug.length > 63 || !SLUG.test(slug) || request.nextUrl.search
      || request.nextUrl.pathname !== `/r/${slug}/compte/${PATHS[action]}` || request.method !== METHODS[action]) return invalid();
    const origin = requestOrigin(request);
    const site = request.headers.get('sec-fetch-site');
    const statedOrigin = request.headers.get('origin');
    if (!origin || (site !== null && site !== 'same-origin' && site !== 'none')
      || ((request.method !== 'GET' || statedOrigin !== null) && originOf(statedOrigin) !== origin)) {
      return failure(403, 'CUSTOMER_RELAY_REFUSED', 'Cette demande doit venir du site du restaurant.');
    }
    const config = configuration(slug, origin);
    if (!config) return action === 'status' ? closed() : unavailable();
    const ip = clientIp(request);
    if (!ip) return action === 'status' ? closed() : unavailable();
    let browserRequest: unknown = {};
    try {
      if (request.method !== 'GET') browserRequest = await boundedJson(request, signal, customerAccountRequestLimit(action));
    } catch { return signal.aborted ? unavailable() : invalid(); }
    const apiAction = action;
    const parsed = CustomerAccountBrowserRequests[apiAction].safeParse(browserRequest);
    if (!parsed.success) return invalid();
    const browser = readCookie(request, slug, 'browser');
    const session = readCookie(request, slug, 'session');
    if (browser.kind === 'invalid' || session.kind === 'invalid') {
      return failure(409, 'CUSTOMER_CONFLICT', 'Les accès enregistrés sont ambigus. Fermez les autres accès avant de réessayer.');
    }
    if (['intent', 'start', 'check', 'recover', 'protection', 'passkey', 'recovery'].includes(action) && browser.kind !== 'valid') {
      return failure(409, 'CUSTOMER_CONFLICT', 'Le navigateur doit confirmer son accès avant de continuer.');
    }
    if (PRIVATE_ACTIONS.includes(action)
      && (session.kind !== 'valid' || browser.kind !== 'valid')) return unauthorized();
    // A non-secret selector comes from the durable client journal, never from
    // whichever cookie happened to arrive last. The signed API validates its
    // immutable association with the HttpOnly credential on every private use.
    const selectedBrowser = CustomerAccountBrowserRefSchema.safeParse(request.headers.get(CUSTOMER_ACCOUNT_BROWSER_REF_HEADER));
    if (action !== 'status' && action !== 'browser' && !selectedBrowser.success) {
      return failure(409, 'CUSTOMER_CONFLICT', 'La préparation de cet accès doit être vérifiée avant de continuer.');
    }
    const publication = PRIVATE_ACTIONS.includes(action) ? CustomerAccountPublicationSchema.safeParse({
      expectedOperationId: request.headers.get(CUSTOMER_ACCOUNT_OPERATION_HEADER), expectedCheckId: request.headers.get(CUSTOMER_ACCOUNT_CHECK_HEADER),
    }) : null;
    if (publication && !publication.success) return failure(409, 'CUSTOMER_CONFLICT', 'La connexion attendue doit être vérifiée.');
    const preparationRequest = action === 'browser' ? CustomerAccountBrowserRequests.browser.parse(parsed.data) : null;
    if ((preparationRequest?.step === 'confirm' || preparationRequest?.step === 'restore')
      && browser.kind !== 'valid') return unauthorized();
    const candidateSecret = preparationRequest?.step === 'issue' ? randomBytes(32).toString('base64url') : null;
    const intentRequest = action === 'intent' ? CustomerAccountBrowserRequests.intent.parse(parsed.data) : null;
    const candidateProof = intentRequest?.step === 'prepare' ? randomBytes(32).toString('base64url') : null;
    const selectedOperation = 'operationId' in parsed.data ? parsed.data.operationId : null;
    const proof = ['start', 'check', 'recover', 'protection', 'passkey', 'recovery'].includes(action) && selectedOperation
      ? readNamedCookie(request, intentCookieName(slug, selectedOperation)) : null;
    if (proof?.kind === 'absent') return unauthorized();
    if (proof?.kind === 'invalid') return failure(409, 'CUSTOMER_CONFLICT', 'La preuve de cette tentative est ambiguë.');

    // Platform paths may serve any pilot tenant; a custom domain must resolve
    // freshly to this exact tenant. Never adopt the proxy's stale cache or a
    // caller-supplied x-sm-tenant header as account authority.
    const platforms = new Set(['https://staging.snackmanager.fr', 'https://web-staging-6f5f.up.railway.app']);
    if (!platforms.has(origin)) {
      const resolution = await within(fetch(`${config.apiOrigin}/public/resolve?host=${encodeURIComponent(new URL(origin).host)}`, {
        cache: 'no-store', redirect: 'error', signal, headers: { Accept: 'application/json' },
      }), signal);
      if (resolution.status !== 200) { discard(resolution); return action === 'status' ? closed() : unavailable(); }
      const resolved = await boundedJson(resolution, signal, 1_024);
      if (!resolved || typeof resolved !== 'object' || !('slug' in resolved) || resolved.slug !== slug) {
        return failure(403, 'CUSTOMER_RELAY_REFUSED', 'Ce domaine ne correspond pas au restaurant.');
      }
    }
    const envelope = { request: parsed.data,
      ...(preparationRequest ? { candidateSecret,
        browserSecret: preparationRequest.step !== 'prepare' && browser.kind === 'valid' ? browser.value : null } : {}),
      ...(action !== 'status' && action !== 'browser' && selectedBrowser.success ? { browserRef: selectedBrowser.data } : {}),
      ...(intentRequest ? { candidateProof } : {}),
      ...(publication?.success ? publication.data : {}),
      ...(proof?.kind === 'valid' ? { intentProof: proof.value } : {}),
      ...((['intent', 'start', 'check', 'recover', 'protection', 'passkey', 'recovery'].includes(action) || PRIVATE_ACTIONS.includes(action))
        && browser.kind === 'valid' ? { browserSecret: browser.value } : {}),
      ...(action === 'check' ? { sessionToken: session.kind === 'valid' ? session.value : null }
        : PRIVATE_ACTIONS.includes(action) && session.kind === 'valid' ? { sessionToken: session.value } : {}),
    };
    const validated = CustomerAccountEnvelopes[apiAction].safeParse(envelope);
    if (!validated.success) return invalid();
    const body = JSON.stringify(validated.data);
    const response = await within(fetch(`${config.apiOrigin}/public/customer/${slug}/${apiAction}`, {
      method: 'POST', body, cache: 'no-store', redirect: 'error', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json',
        ...customerRelayHeaders({ key: config.key, slug, action: apiAction, origin, clientIp: ip, body }) },
    }), signal);
    if (action === 'logout' && response.status === 204) {
      discard(response);
      // Revocation is server-side. A late logout(A) must not erase a cookie(B)
      // installed meanwhile by another successful confirmation. The now inert
      // opaque token remains HttpOnly until its expiry or replacement.
      return privateResponse(new NextResponse(null, { status: 204 }));
    }
    if (response.status !== 200) {
      discard(response);
      if (action === 'status') return closed();
      // A late GET 401 can describe a token replaced by a concurrent successful
      // confirmation. It must not erase the browser's newer session cookie.
      if (response.status === 401) return unauthorized();
      if (response.status === 404 && (action === 'orders' || action === 'order-detail')) return failure(404, 'CUSTOMER_ORDER_UNAVAILABLE', 'Cette commande ne peut pas être consultée depuis ce compte.');
      if (response.status === 400) return invalid();
      if (response.status === 409) return failure(409, 'CUSTOMER_CONFLICT', 'Le compte a changé. Actualisez avant de réessayer.');
      if (response.status === 429) {
        const result = failure(429, 'CUSTOMER_RATE_LIMITED', 'Trop de tentatives. Patientez avant de réessayer.');
        const after = response.headers.get('retry-after');
        if (after && /^\d{1,3}$/.test(after)) result.headers.set('Retry-After', String(Math.max(1, Math.min(300, Number(after)))));
        return result;
      }
      return unavailable();
    }
    if (action === 'logout') { discard(response); return unavailable(); }
    const raw = await boundedJson(response, signal, customerAccountResponseLimit(action));
    const output = CustomerAccountResponses[apiAction].safeParse(raw);
    if (!output.success || output.data === undefined) return action === 'status' ? closed() : unavailable();
    if (action === 'orders') return privateResponse(NextResponse.json(parseCustomerOrdersPage(output.data, CustomerAccountBrowserRequests.orders.parse(parsed.data))));
    if (action === 'order-detail') return privateResponse(NextResponse.json(parseCustomerOrderDetail(output.data, CustomerAccountBrowserRequests['order-detail'].parse(parsed.data).orderId)));
    if (action === 'browser') {
      if (!('preparation' in output.data) || !('emitCookie' in output.data)
        || !preparationRequest || (preparationRequest.step !== 'restore'
          && output.data.preparation.browserRef !== preparationRequest.browserRef)) return unavailable();
      const { preparation, emitCookie } = output.data;
      // Restore has no client selector to compare: the API attests only the
      // exact received credential's confirmed preparation. It must never issue,
      // renew or delete any cookie, nor return a session/publication/profile.
      if (preparationRequest.step === 'restore' && (preparation.state !== 'confirmed' || emitCookie)) return unavailable();
      if (preparation.expiresAt > Date.now() + SESSION_MAX_MS
        || preparation.admissionExpiresAt > Date.now() + 600_000
        || (preparation.state !== 'expired' && preparation.expiresAt <= Date.now())
        || (preparation.state === 'confirmed' && preparationRequest.step === 'confirm' && browser.kind !== 'valid')) return unavailable();
      if (emitCookie && (preparationRequest.step !== 'issue' || !candidateSecret
        || preparation.admissionExpiresAt <= Date.now() || preparation.state !== 'issued')) return unavailable();
      const result = privateResponse(NextResponse.json(preparation));
      // Exactly one admitted issue may emit the candidate. Retrying prepare or
      // confirming receipt never rewrites cookies. Absolute expiry cannot slide
      // when an HTTP response arrives late (Max-Age would take precedence).
      if (emitCookie && candidateSecret) result.cookies.set(cookieName(slug, 'browser'), candidateSecret,
        { ...cookieOptions(), expires: new Date(preparation.expiresAt) });
      return result;
    }
    if (action === 'intent') {
      if (!('intent' in output.data) || !('emitCookie' in output.data)
        || output.data.intent.operationId !== intentRequest?.operationId) return unavailable();
      const { intent, emitCookie } = output.data;
      if (intent.expiresAt > Date.now() + 600_000
        || (intent.state === 'open' && intent.expiresAt <= Date.now())
        || (intentRequest.step === 'close' && intent.state !== 'closed' && intent.state !== 'expired')) return unavailable();
      if (emitCookie && (intentRequest.step !== 'prepare' || !candidateProof
        || intent.state !== 'open' || intent.expiresAt <= Date.now())) return unavailable();
      const result = privateResponse(NextResponse.json(intent));
      if (emitCookie && candidateProof) result.cookies.set(intentCookieName(slug, intent.operationId), candidateProof,
        { ...cookieOptions(), expires: new Date(intent.expiresAt) });
      if (intentRequest.step === 'close') result.cookies.set(intentCookieName(slug, intent.operationId), '',
        { ...cookieOptions(), expires: new Date(0) });
      return result;
    }
    if (action === 'recover') {
      const recovered = CustomerAccountResponses.recover.parse(output.data);
      const selected = CustomerAccountBrowserRequests.recover.parse(parsed.data);
      if (recovered.operationId !== selected.operationId || recovered.checkId !== selected.checkId
        || recovered.expiresAt > Date.now() + 600_000
        || (!['expired', 'closed', 'failed'].includes(recovered.state) && recovered.expiresAt <= Date.now())) return unavailable();
      if (recovered.state === 'enrollment' && !validEnrollment(recovered.enrollment, selected)) return unavailable();
      if (recovered.state !== 'approved') return privateResponse(NextResponse.json(recovered));
      const { token, ...publicResult } = recovered;
      const remaining = recovered.view.expiresAt - Date.now();
      if (remaining < 1_000 || remaining > SESSION_MAX_MS) return unavailable();
      const result = privateResponse(NextResponse.json(publicResult));
      result.cookies.set(cookieName(slug, 'session'), token, { ...cookieOptions(), expires: new Date(recovered.view.expiresAt) });
      return result;
    }
    if (action === 'check') {
      const checked = CustomerAccountResponses.check.parse(output.data);
      const selected = CustomerAccountBrowserRequests.check.parse(parsed.data);
      if (checked.state === 'enrollment') return validEnrollment(checked.enrollment, selected)
        ? privateResponse(NextResponse.json(checked)) : unavailable();
      const { token, view } = checked;
      const remaining = view.expiresAt - Date.now();
      if (remaining < 1_000 || remaining > SESSION_MAX_MS) return unavailable();
      const result = privateResponse(NextResponse.json({ state: 'authenticated', view }));
      result.cookies.set(cookieName(slug, 'session'), token, { ...cookieOptions(), expires: new Date(view.expiresAt) });
      return result;
    }
    if (action === 'passkey' || action === 'recovery') {
      const result = action === 'passkey' ? CustomerAccountResponses.passkey.parse(output.data) : CustomerAccountResponses.recovery.parse(output.data);
      const selected = action === 'passkey' ? CustomerAccountBrowserRequests.passkey.parse(parsed.data) : CustomerAccountBrowserRequests.recovery.parse(parsed.data);
      if (result.state === 'authenticated') {
        const publicationId = action === 'passkey' && (selected.step === 'assert' || selected.step === 'result') ? selected.attemptId
          : (selected.step === 'activate' || selected.step === 'activation-result') ? selected.activationId : null;
        if (!publicationId || result.operationId !== selected.operationId || result.publicationId !== publicationId) return unavailable();
        const remaining = result.view.expiresAt - Date.now();
        if (remaining < 1_000 || remaining > SESSION_MAX_MS) return unavailable();
        const { token, ...publicResult } = result;
        const response = privateResponse(NextResponse.json(publicResult));
        response.cookies.set(cookieName(slug, 'session'), token, { ...cookieOptions(), expires: new Date(result.view.expiresAt) });
        return response;
      }
      const metadata = 'recovery' in result ? result.recovery : result;
      if (metadata.operationId !== selected.operationId || metadata.attemptId !== selected.attemptId
        || metadata.expiresAt > Date.now() + 600_000 || (result.state !== 'failed' && metadata.expiresAt <= Date.now())) return unavailable();
      if (result.state === 'options' && (action !== 'passkey' || selected.step !== 'options' || result.options.allowCredentials.length !== 0)) return unavailable();
      if (result.state === 'registration-options' && (selected.step !== 'registration-options' || result.registrationId !== selected.registrationId)) return unavailable();
      if (result.state === 'assertion-options' && (selected.step !== 'assertion-options' || result.assertionId !== selected.assertionId)) return unavailable();
      if (result.state === 'recovery-code' && (selected.step !== 'recovery-code' || result.recovery.recoveryVersion !== selected.expectedVersion + 1)) return unavailable();
      // A repair grant never authenticates or projects the existing account.
      return privateResponse(NextResponse.json(result));
    }
    if (action === 'protection') {
      const protectedResult = CustomerAccountResponses.protection.parse(output.data);
      const selected = CustomerAccountBrowserRequests.protection.parse(parsed.data);
      if (protectedResult.state === 'authenticated') {
        if ((selected.step !== 'activate' && selected.step !== 'activation-result')
          || protectedResult.operationId !== selected.operationId || protectedResult.activationId !== selected.activationId) return unavailable();
        const { token, ...publicResult } = protectedResult;
        const remaining = publicResult.view.expiresAt - Date.now();
        if (remaining < 1_000 || remaining > SESSION_MAX_MS) return unavailable();
        const result = privateResponse(NextResponse.json(publicResult));
        result.cookies.set(cookieName(slug, 'session'), token, { ...cookieOptions(), expires: new Date(publicResult.view.expiresAt) });
        return result;
      }
      if (!validEnrollment(protectedResult.enrollment, selected)) return unavailable();
      if (protectedResult.state === 'registration-options' && (selected.step !== 'registration-options'
        || protectedResult.registrationId !== selected.registrationId)) return unavailable();
      if (protectedResult.state === 'assertion-options' && (selected.step !== 'assertion-options'
        || protectedResult.assertionId !== selected.assertionId)) return unavailable();
      if (protectedResult.state === 'recovery-code' && selected.step !== 'recovery-code') return unavailable();
      // Provisional enrollment contains no profile or session. Only the exact
      // activation receipt above may publish a personal credential.
      return privateResponse(NextResponse.json(protectedResult));
    }
    if ('expiresAt' in output.data && (output.data.expiresAt <= Date.now()
      || output.data.expiresAt - Date.now() > (action === 'start' ? 600_000 : SESSION_MAX_MS))) return unavailable();
    return privateResponse(NextResponse.json(output.data));
  } catch { return action === 'status' ? closed() : unavailable(); }
}
