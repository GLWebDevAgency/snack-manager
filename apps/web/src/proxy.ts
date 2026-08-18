import { NextResponse, type NextRequest } from "next/server";

/**
 * Multi-tenant par domaine + en-têtes de l’embed.
 *
 * ⚠️ Next.js 16 : le fichier `middleware.ts` est déprécié et renommé `proxy.ts`
 * (même mécanisme, runtime Node.js, fonction exportée `proxy`). Voir
 * `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.
 *
 * ─────────────────────────────────────────────────────────────
 * 1 · Résolution du restaurant par le domaine
 * ─────────────────────────────────────────────────────────────
 * Trois formes d’adresse mènent au même site public :
 *
 *   a) `snackmanager.fr/r/classfood`      → aucune réécriture (URL canonique) ;
 *   b) `classfood.snackmanager.fr/`       → sous-domaine = slug, sans appel API ;
 *   c) `laclassfood.fr/`                  → domaine personnalisé du restaurant,
 *                                            résolu par l’API puis mis en cache.
 *
 * Seule la RACINE (`/`) est réécrite : sur un domaine personnalisé,
 * `laclassfood.fr/t/<id>` reste la page de suivi et `laclassfood.fr/embed/…`
 * reste l’embed. Réécrire tout le trafic casserait ces routes.
 *
 * ─────────────────────────────────────────────────────────────
 * 2 · Brancher un domaine personnalisé (procédure restaurateur)
 * ─────────────────────────────────────────────────────────────
 *   1. Chez son registrar, le restaurant crée un enregistrement :
 *        CNAME   www        →   <domaine-de-la-plateforme>.
 *      et, pour l’apex (`laclassfood.fr` sans `www`), soit un ALIAS/ANAME vers
 *      la même cible, soit les enregistrements A fournis par l’hébergeur
 *      (l’apex n’accepte pas de CNAME).
 *   2. Le domaine est déclaré dans l’hébergement du front (certificat TLS
 *      automatique).
 *   3. Le `slug` du tenant doit correspondre à l’étiquette du domaine
 *      (`laclassfood.fr` → slug `laclassfood`) OU le domaine doit être
 *      enregistré côté API (voir `issues` : un endpoint `GET /public/domains/:host`
 *      supprimerait cette convention).
 *
 * ─────────────────────────────────────────────────────────────
 * 3 · En-têtes
 * ─────────────────────────────────────────────────────────────
 * `/embed/*` et `/w.js` doivent pouvoir vivre dans le site d’un client :
 * `frame-ancestors *` est posé ici explicitement, plutôt que dans
 * `next.config.ts` (fichier partagé avec d’autres chantiers).
 */

/** Domaine principal de la plateforme (sans protocole). */
const PRIMARY_DOMAIN = (
  process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? "snackmanager.fr"
).toLowerCase();

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Sous-domaines de service : jamais un restaurant. */
const RESERVED = new Set(["www", "app", "api", "admin", "kds", "pos", "static"]);

/** Hôtes de développement et de prévisualisation — aucune réécriture. */
const PASSTHROUGH_SUFFIXES = [
  "localhost",
  "127.0.0.1",
  ".local",
  ".vercel.app",
  ".up.railway.app",
  ".ngrok.io",
  ".ngrok-free.app",
];

/**
 * Cache mémoire de la résolution domaine → slug.
 * Volontairement court : un domaine fraîchement branché doit fonctionner en
 * quelques minutes, sans redéploiement. Les échecs sont cachés plus brièvement.
 */
const TTL_HIT_MS = 5 * 60_000;
const TTL_MISS_MS = 60_000;
const resolved = new Map<string, { slug: string | null; until: number }>();

function cacheGet(host: string): { slug: string | null } | null {
  const entry = resolved.get(host);
  if (!entry) return null;
  if (Date.now() > entry.until) {
    resolved.delete(host);
    return null;
  }
  return { slug: entry.slug };
}

function cacheSet(host: string, slug: string | null) {
  // Garde-fou mémoire : un flot d’hôtes inconnus ne doit pas gonfler la carte.
  if (resolved.size > 500) resolved.clear();
  resolved.set(host, {
    slug,
    until: Date.now() + (slug ? TTL_HIT_MS : TTL_MISS_MS),
  });
}

/** Hôte nu, sans port ni `www.`. */
function normalizeHost(raw: string | null): string {
  return (raw ?? "")
    .toLowerCase()
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/** Un slug de tenant : minuscules, chiffres, tirets. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/**
 * Vérifie l’existence du restaurant auprès de l’API. C’est un appel très court
 * (identité tenant seule) et le résultat est mis en cache : la page n’attend
 * jamais deux fois pour le même domaine.
 */
async function tenantExists(slug: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_URL}/public/tenants/${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    return res.ok;
  } catch {
    return false; // API injoignable : on laisse passer plutôt que de servir un 404
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── En-têtes d’embarquement ──
  if (pathname.startsWith("/embed/") || pathname === "/w.js") {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", "frame-ancestors *");
    response.headers.delete("X-Frame-Options");
    if (pathname === "/w.js") {
      // Le chargeur change rarement : cache navigateur court + revalidation CDN.
      response.headers.set(
        "Cache-Control",
        "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      );
    }
    return response;
  }

  // ── Résolution par domaine : uniquement sur la racine ──
  if (pathname !== "/") return NextResponse.next();

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return NextResponse.next();
  if (host === PRIMARY_DOMAIN) return NextResponse.next();
  if (PASSTHROUGH_SUFFIXES.some((s) => host === s || host.endsWith(s))) {
    return NextResponse.next();
  }

  // (b) Sous-domaine de la plateforme : `classfood.snackmanager.fr`
  if (host.endsWith(`.${PRIMARY_DOMAIN}`)) {
    const label = host.slice(0, -(PRIMARY_DOMAIN.length + 1));
    if (!label.includes(".") && !RESERVED.has(label) && SLUG_RE.test(label)) {
      return rewriteToRestaurant(request, label);
    }
    return NextResponse.next();
  }

  // (c) Domaine personnalisé : `laclassfood.fr`
  const cached = cacheGet(host);
  if (cached) {
    return cached.slug
      ? rewriteToRestaurant(request, cached.slug)
      : NextResponse.next();
  }

  const candidate = host.split(".")[0];
  if (!SLUG_RE.test(candidate) || RESERVED.has(candidate)) {
    cacheSet(host, null);
    return NextResponse.next();
  }

  const exists = await tenantExists(candidate);
  cacheSet(host, exists ? candidate : null);
  return exists ? rewriteToRestaurant(request, candidate) : NextResponse.next();
}

function rewriteToRestaurant(request: NextRequest, slug: string) {
  const url = request.nextUrl.clone();
  url.pathname = `/r/${slug}`;
  const response = NextResponse.rewrite(url);
  // Utile au débogage d’un branchement DNS chez un client.
  response.headers.set("x-sm-tenant", slug);
  return response;
}

export const config = {
  matcher: [
    /*
     * Tout sauf les ressources internes Next, les fichiers statiques et les
     * chemins qui n’ont jamais besoin d’une résolution de tenant.
     */
    "/((?!_next/|favicon.ico|.*\\.[\\w]+$).*)",
    // Réintégré explicitement : le chargeur du widget porte ses propres en-têtes.
    "/w.js",
  ],
};
