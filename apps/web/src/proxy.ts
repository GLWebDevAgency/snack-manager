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
 * ─────────────────────────────────────────────────────────────
 * 1 bis · UN DOMAINE DE RESTAURANT NE SERT QUE LE RESTAURANT
 * ─────────────────────────────────────────────────────────────
 * Jusqu’au 22 août 2026, seule la RACINE était réécrite et TOUT LE RESTE
 * passait tel quel. Une seule application sert la vitrine commerciale, le
 * blog, le CRM interne et les sites des restaurants : sur `laclassfood.fr`,
 * `/offres` répondait donc avec NOTRE page tarifs, `/blog` avec notre blog,
 * `/sm` avec notre CRM, et `/robots.txt` annonçait le plan du site de
 * `snackmanager.fr`.
 *
 * Ce n’était pas une fuite théorique : un mangeur qui tape une adresse au
 * hasard tombait sur le site de vente du fournisseur de logiciel de son
 * restaurant, et un moteur de recherche indexait notre contenu commercial
 * sous le domaine du client.
 *
 * La règle est donc renversée — LISTE BLANCHE, PAS LISTE NOIRE. Sur un
 * domaine de restaurant, seuls les chemins qui SERVENT ce restaurant
 * répondent ; tout le reste est refusé. Une liste noire aurait été fausse dès
 * la première route ajoutée : c’est l’oubli qui fuit, et on n’oublie pas
 * d’ajouter à une liste blanche — on s’en aperçoit tout de suite, la page ne
 * répond plus.
 *
 * Voir `CHEMINS_RESTAURANT` plus bas pour la liste et la raison de chaque
 * entrée.
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QU’UN DOMAINE DE RESTAURANT A LE DROIT DE SERVIR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Chaque entrée porte sa raison. Ajouter une route à l’application ne l’ouvre
 * PAS ici : c’est délibéré, et c’est tout l’intérêt d’une liste blanche.
 *
 *   `/`                → la carte du restaurant (réécrite vers `/r/<slug>`).
 *   `/r/<son slug>`    → la même page à son adresse canonique. UNIQUEMENT son
 *                        slug : `laclassfood.fr/r/autre-resto` servirait le
 *                        site d’un CONCURRENT sous son nom de domaine.
 *   `/t/…`             → le suivi de commande. Le mangeur y arrive depuis le
 *                        tunnel, sur ce même domaine.
 *   `/embed/<son slug>`→ le tunnel embarqué. Même règle de slug, même raison.
 *   `/w.js`            → le chargeur du widget. Il DÉRIVE SON ORIGINE DE SON
 *                        PROPRE `src` (w.js:59-66) : embarqué depuis le site
 *                        du restaurant, il appelle `<son domaine>/embed/…`.
 *                        Fermer l’un des deux casse le widget.
 *   `/photos/…`        → les photos de la carte, référencées en chemins
 *                        RELATIFS par les produits (`photoUrl: "/photos/…"`).
 *                        Les fermer viderait la carte d’un client en service.
 *   `/robots.txt`      → servi, mais rendu conscient du domaine — voir
 *                        `app/robots.ts`.
 *
 * NE SONT PAS OUVERTS, ET C’EST VOULU : `/offres`, `/blog`, `/sm`, `/admin`,
 * `/board`, `/r/demo`, `/api/…`, notre favicon, nos icônes, notre manifeste
 * PWA et notre plan de site. Le back-office et l’écran de salle s’atteignent
 * par le domaine de la plateforme — voir la note sur `boardUrl` dans
 * `admin/screens/page.tsx`.
 */
type Verdict = "réécrire" | "laisser" | "refuser";

function verdictPourRestaurant(pathname: string, slug: string): Verdict {
  if (pathname === "/") return "réécrire";

  if (pathname === `/r/${slug}` || pathname === `/r/${slug}/`) return "laisser";
  if (pathname === "/w.js" || pathname === "/robots.txt") return "laisser";
  if (pathname === `/embed/${slug}` || pathname === `/embed/${slug}/`) return "laisser";
  if (pathname.startsWith("/t/") || pathname.startsWith("/photos/")) return "laisser";

  return "refuser";
}

/**
 * Deux façons de refuser, parce que deux choses très différentes sont
 * demandées.
 *
 * Une NAVIGATION (`/offres`, `/blog`) vient d’un humain qui s’est trompé
 * d’adresse ou d’un lien périmé : le renvoyer chez le restaurant est plus
 * utile qu’une page blanche, et un 308 dit au moteur de recherche que
 * l’adresse canonique est la racine — ce qui déindexe notre contenu de ce
 * domaine au lieu de le laisser en 404 pendant des mois.
 *
 * Un ACTIF (`/icon.svg`, `/manifest.webmanifest`) est demandé par le
 * navigateur, pas par une personne. Le rediriger vers `/` lui ferait recevoir
 * une page HTML là où il attend une image ou du JSON — au mieux une icône
 * cassée, au pire une erreur d’analyse. Un 404 sec est la réponse juste.
 */
/*
 * TROIS SIGNAUX POUR DISTINGUER UNE NAVIGATION D'UNE REQUÊTE DE MACHINE, et
 * chacun rattrape ce que les autres laissent passer.
 *
 * 1. `Sec-Fetch-Mode: navigate` — le signal le plus sûr, envoyé par tous les
 *    navigateurs modernes UNIQUEMENT quand l'utilisateur navigue. Un
 *    `fetch()`, une image ou un script portent `cors`, `no-cors` ou `same-origin`.
 * 2. `/api/…` — jamais une navigation, quel que soit l'en-tête. Un client
 *    HTTP sans `Sec-Fetch-Mode` (curl, un serveur, un vieux navigateur) doit
 *    tout de même recevoir un refus franc et non une page d'accueil.
 * 3. L'extension, en dernier recours pour ces mêmes clients.
 *
 * L'extension seule ne suffisait pas, et la première vérification par appels
 * réels l'a montré : la borne à huit caractères laissait passer
 * `.webmanifest`, qui en compte douze. Le navigateur recevait donc du HTML là
 * où il attendait du JSON — précisément la panne que cette distinction existe
 * pour éviter.
 */
const A_UNE_EXTENSION = /\.[a-z0-9]{1,12}$/i;

function estUneNavigation(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;

  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";

  return !A_UNE_EXTENSION.test(pathname);
}

function refus(request: NextRequest): NextResponse {
  if (!estUneNavigation(request)) return new NextResponse(null, { status: 404 });

  const accueil = request.nextUrl.clone();
  accueil.pathname = "/";
  accueil.search = "";
  return NextResponse.redirect(accueil, 308);
}

/** En-têtes d’embarquement — l’embed et son chargeur vivent dans un site tiers. */
function entetesEmbed(pathname: string): NextResponse | null {
  if (!pathname.startsWith("/embed/") && pathname !== "/w.js") return null;
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

/**
 * À quel restaurant ce domaine appartient-il ?
 *
 * `null` signifie « la plateforme » — notre domaine, un hôte de développement
 * ou de prévisualisation, ou un domaine qui ne résout vers aucun tenant. Dans
 * ce dernier cas on laisse passer plutôt que de fermer : un hôte inconnu est
 * plus souvent un alias mal configuré de la plateforme qu’une tentative, et
 * fermer rendrait le site inatteignable sans qu’on comprenne pourquoi.
 */
async function restaurantDuDomaine(request: NextRequest): Promise<string | null> {
  const host = normalizeHost(request.headers.get("host"));
  if (!host) return null;
  if (host === PRIMARY_DOMAIN) return null;
  if (PASSTHROUGH_SUFFIXES.some((s) => host === s || host.endsWith(s))) return null;

  // (b) Sous-domaine de la plateforme : `classfood.snackmanager.fr`
  if (host.endsWith(`.${PRIMARY_DOMAIN}`)) {
    const label = host.slice(0, -(PRIMARY_DOMAIN.length + 1));
    const estUnSlug = !label.includes(".") && !RESERVED.has(label) && SLUG_RE.test(label);
    return estUnSlug ? label : null;
  }

  // (c) Domaine personnalisé : `laclassfood.fr`
  const cached = cacheGet(host);
  if (cached) return cached.slug;

  const candidate = host.split(".")[0];
  if (!SLUG_RE.test(candidate) || RESERVED.has(candidate)) {
    cacheSet(host, null);
    return null;
  }

  const exists = await tenantExists(candidate);
  cacheSet(host, exists ? candidate : null);
  return exists ? candidate : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * L’HÔTE EST CLASSÉ AVANT LE CHEMIN, ET L’ORDRE COMPTE. L’ancienne version
   * testait `pathname !== "/"` en premier et sortait aussitôt : le domaine
   * n’était donc JAMAIS regardé pour les 99 % de requêtes qui ne visent pas la
   * racine. C’est précisément ce qui laissait passer tout le reste du site.
   */
  const slug = await restaurantDuDomaine(request);

  if (slug === null) return entetesEmbed(pathname) ?? NextResponse.next();

  switch (verdictPourRestaurant(pathname, slug)) {
    case "réécrire":
      return rewriteToRestaurant(request, slug);
    case "refuser":
      return refus(request);
    default:
      return entetesEmbed(pathname) ?? NextResponse.next();
  }
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
     * TOUT, SAUF LES RESSOURCES DE BUILD DE NEXT.
     *
     * Le filtre excluait auparavant `favicon.ico` et TOUT chemin portant une
     * extension (`.*\.[\w]+$`). Le proxy ne voyait donc jamais `/icon.svg`,
     * `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml` ni `/icons/*` —
     * autrement dit, il lui était structurellement impossible d’empêcher un
     * domaine de restaurant de servir NOTRE favicon et NOTRE manifeste PWA.
     * On ne pouvait pas corriger la fuite sans corriger ce filtre.
     *
     * `_next/` reste exclu, et doit le rester : ce sont les scripts et les
     * feuilles de style du site du restaurant lui-même. Les fermer sur son
     * domaine reviendrait à lui servir une page nue.
     *
     * Contrepartie assumée : le proxy s’exécute désormais sur chaque actif.
     * Sur le domaine de la plateforme il sort au premier test — une
     * comparaison de chaîne — et sur un domaine de restaurant, la résolution
     * est en cache mémoire. Le coût est réel mais constant ; l’alternative
     * était de laisser la fuite ouverte.
     */
    "/((?!_next/).*)",
  ],
};
