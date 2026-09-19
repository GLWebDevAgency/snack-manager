import type { NextRequest } from "next/server";

/** Same proxy-aware boundary as delivery-bff, without coupling a public form to delivery contracts. */
function normalizedOrigin(raw: string | null): string | null {
  if (!raw || raw.includes(",")) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get("x-forwarded-host");
  const protocol = request.headers.get("x-forwarded-proto");
  if (host === null && protocol === null) {
    return normalizedOrigin(`${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`);
  }
  if (!host || (protocol !== "https" && protocol !== "http")) return null;
  return normalizedOrigin(`${protocol}://${host}`);
}

function configuredPlatformOrigin(origin: string): boolean {
  const configured = normalizedOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? null);
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const origins = new Set<string>(configured ? [configured] : []);
  if (environment === "staging") {
    origins.add("https://staging.snackmanager.fr");
    origins.add("https://web-staging-6f5f.up.railway.app");
  } else if (environment === "production") {
    origins.add("https://snackmanager.fr");
    origins.add("https://www.snackmanager.fr");
    origins.add("https://web-production-99b58c.up.railway.app");
  }
  if (origins.has(origin)) return true;
  if (process.env.NODE_ENV !== "production") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  }
  return false;
}

export function rejectsOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const expected = requestOrigin(request);
  return !expected || !configuredPlatformOrigin(expected)
    || (process.env.NODE_ENV === "production" && !expected.startsWith("https://"))
    || normalizedOrigin(request.headers.get("origin")) !== expected;
}

/** Bound both declared and actual UTF-8 bytes; never silently truncate an address. */
export async function boundedJson(request: NextRequest): Promise<unknown> {
  const limit = 1024;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    let size = 0;
    let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}
