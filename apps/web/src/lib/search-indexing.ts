import { SITE_URL } from "./site";

/** HTML routes stay crawlable so the response's noindex can be read. */
const NON_INDEXABLE_ROUTES = [
  "/admin",
  "/sm",
  "/board",
  "/api",
  "/embed",
  "/t",
  "/r/demo",
  "/newsletter/confirmation",
] as const;

function normalizedHost(raw: string | null): string {
  return (raw ?? "").toLowerCase().split(",")[0].trim()
    .replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

function nonPublicDeployment(): boolean {
  // NODE_ENV is "production" for staging builds too. Deployment signals are
  // read per request; conflicting environment labels must never open indexing.
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return true;
  return [process.env.RAILWAY_ENVIRONMENT_NAME, process.env.VERCEL_ENV, process.env.SM_ENV]
    .some((value) => value?.trim() && value.trim().toLowerCase() !== "production");
}

function nonPublicHost(host: string): boolean {
  const primary = normalizedHost(process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? "snackmanager.fr");
  return !host
    || ["localhost", "127.0.0.1", "[::1]", `staging.${primary}`].includes(host)
    || [".localhost", ".local", ".vercel.app", ".up.railway.app", ".railway.internal",
      ".ngrok.io", ".ngrok-free.app", ".ngrok.app"].some((suffix) => host.endsWith(suffix));
}

/** Only the public platform origin advertises the marketing sitemap. */
export function isPublicSearchHost(rawHost: string | null): boolean {
  const host = normalizedHost(rawHost);
  return !nonPublicDeployment() && !nonPublicHost(host)
    && host === normalizedHost(new URL(SITE_URL).host);
}

/**
 * Reuse the proxy's tenant resolution instead of treating every non-platform
 * domain as a preview. A real restaurant domain remains indexable in production.
 * This policy changes discovery only, never authorization or tenant routing.
 */
export function preventSearchIndexing({ host, pathname, hostType }: {
  host: string | null;
  pathname: string;
  hostType: "plateforme" | "restaurant" | "inconnu";
}): boolean {
  if (NON_INDEXABLE_ROUTES.some((root) => pathname === root || pathname.startsWith(`${root}/`))) return true;
  if (nonPublicDeployment() || nonPublicHost(normalizedHost(host))) return true;
  if (hostType === "restaurant") return false;
  return hostType === "inconnu" || !isPublicSearchHost(host);
}
