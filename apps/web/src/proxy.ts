import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_LABELS } from "@sm/domain";

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
 *   b) `classfood.snackmanager.fr/`       → sous-domaine de la plateforme ;
 *   c) `commander.classfood.fr/`          → domaine personnalisé du restaurant.
 *
 * Dans les cas (b) et (c), le restaurant est RÉSOLU par l’API
 * (`GET /public/resolve?host=…`), jamais déduit du nom d’hôte — voir « 1 ter ».
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
 * Voir `verdictPourRestaurant` plus bas pour la liste et la raison de chaque
 * entrée.
 *
 * ─────────────────────────────────────────────────────────────
 * 1 ter · UN HÔTE QUI NE RÉSOUT VERS RIEN EST REFUSÉ
 * ─────────────────────────────────────────────────────────────
 * Le défaut est INVERSÉ depuis le 22 août 2026, et l’ancien raisonnement
 * mérite d’être écrit pour qu’on ne le refasse pas.
 *
 * ANCIEN CODE : le slug était deviné (`host.split(".")[0]`), puis on vérifiait
 * si un restaurant portait ce nom. Le commentaire justifiait de laisser passer
 * un hôte inconnu : « plus souvent un alias mal configuré qu’une tentative ».
 *
 * CE QUE ÇA PRODUISAIT : `commander.classfood.fr` donne le candidat
 * « commander ». Aucun restaurant ne s’appelle « commander », donc `slug` valait
 * `null`, donc l’hôte était classé COMME LA PLATEFORME — et `/offres`, `/blog`
 * et `/sm` répondaient sur le domaine du client. La liste blanche du 1 bis ne
 * rattrapait rien : elle ne s’exécute QUE lorsqu’un slug a été trouvé. La fuite
 * qu’on venait de fermer restait donc grande ouverte pour tout domaine dont
 * l’étiquette ne ressemble pas au slug — c’est-à-dire la forme même que nous
 * recommandons aux restaurateurs.
 *
 * POURQUOI LE DÉFAUT PEUT S’INVERSER SANS RISQUE : l’edge de l’hébergeur répond
 * 404 (`x-railway-fallback: true`) à tout hôte qui ne lui est pas déclaré,
 * AVANT que l’application ne le voie. Un hôte qui arrive jusqu’ici est donc un
 * hôte que NOUS avons attaché exprès. « Alias mal configuré » n’est plus une
 * hypothèse plausible : c’est un domaine attaché à l’edge mais pas enregistré
 * en base, autrement dit une configuration à moitié faite — et un 404 franc la
 * signale, là où un passage silencieux la laissait pourrir en publiant nos
 * pages commerciales.
 *
 * TROIS FAMILLES D’HÔTES NE PASSENT JAMAIS PAR LA RÉSOLUTION, et c’est ce qui
 * évite de s’enfermer dehors :
 *   · le domaine de la plateforme lui-même (`snackmanager.fr`) ;
 *   · les hôtes de développement et de prévisualisation (`PASSTHROUGH_HOSTS`) ;
 *   · les sous-domaines de RÔLE (`hq`, `tv`, `board`… — `RESERVED_LABELS`),
 *     qui sont à nous et servent la plateforme.
 *
 * ─────────────────────────────────────────────────────────────
 * 2 · Brancher un domaine personnalisé (procédure restaurateur)
 * ─────────────────────────────────────────────────────────────
 *   1. Chez son registrar, le restaurant crée un enregistrement :
 *        CNAME   commander   →   <domaine-de-la-plateforme>.
 *      (l’apex `laclassfood.fr` sans sous-domaine n’accepte pas de CNAME et
 *      casserait sa messagerie — `PublicDomain.create` le refuse d’ailleurs.)
 *   2. Le domaine est déclaré dans l’hébergement du front (certificat TLS
 *      automatique) ET enregistré côté API depuis l’écran « Site web ».
 *   3. Il n’y a plus AUCUNE convention de nommage à respecter : l’étiquette du
 *      domaine n’a pas à ressembler au slug, c’est l’API qui fait le lien.
 *
 * ─────────────────────────────────────────────────────────────
 * 3 · En-têtes
 * ─────────────────────────────────────────────────────────────
 * Par défaut, toute page ne peut vivre que dans une page de la même origine :
 * cela protège les interfaces authentifiées tout en conservant les démos de
 * la vitrine. Seuls `/embed/<slug>` et `/w.js` restent ouverts à un site tiers.
 * La politique est posée ici, sur la réponse finale de chaque branche, plutôt
 * que partagée entre `next.config.ts` et les exceptions du proxy.
 */

/** Domaine principal de la plateforme (sans protocole). */
const PRIMARY_DOMAIN = (
  process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? "snackmanager.fr"
).toLowerCase();

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Hôtes de développement et de prévisualisation — ils servent la plateforme,
 * sans jamais interroger l’API.
 *
 * La comparaison est STRICTE, et elle ne l’était pas : l’ancien test
 * `host === s || host.endsWith(s)` faisait passer « faux-localhost » pour
 * localhost. Tant que l’inconnu passait, c’était sans conséquence ; maintenant
 * que l’inconnu est refusé, une entrée trop large est le seul moyen de rouvrir
 * la fuite du 1 bis. Une entrée qui commence par un point est un suffixe, les
 * autres sont des égalités.
 */
const PASSTHROUGH_HOSTS = [
  "localhost",
  ".localhost", // `classfood.localhost:3000` — le multi-tenant en local
  "127.0.0.1",
  "[::1]",
  ".local",
  ".vercel.app",
  ".up.railway.app",
  ".railway.internal", // réseau privé de l’hébergeur (sondes, appels internes)
  ".ngrok.io",
  ".ngrok-free.app",
  ".ngrok.app",
];

function estUnHoteDePassage(host: string): boolean {
  return PASSTHROUGH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

/**
 * Cache mémoire de la résolution hôte → slug.
 *
 * Volontairement court : un domaine fraîchement branché doit fonctionner en
 * quelques minutes, sans redéploiement. Les échecs sont cachés plus brièvement,
 * parce qu’ils précèdent souvent une activation.
 *
 * Les entrées PÉRIMÉES ne sont pas supprimées à la lecture : elles servent de
 * dernier recours quand l’API est injoignable (voir `resoudre`). C’est la seule
 * différence avec la version précédente, et elle est délibérée.
 */
const TTL_HIT_MS = 5 * 60_000;
const TTL_MISS_MS = 60_000;
/** Garde-fou mémoire : un flot d’hôtes inconnus ne doit pas gonfler la carte. */
const CACHE_MAX = 500;

type Entree = { readonly slug: string | null; readonly jusqua: number };
type Lecture = { readonly slug: string | null; readonly frais: boolean };

const resolus = new Map<string, Entree>();

function lireCache(host: string): Lecture | null {
  const entree = resolus.get(host);
  if (!entree) return null;
  return { slug: entree.slug, frais: Date.now() <= entree.jusqua };
}

function ecrireCache(host: string, slug: string | null): void {
  /*
   * Éviction du plus ancien plutôt que vidage complet : `Map` conserve l’ordre
   * d’insertion, donc la première clé est la plus vieille. L’ancien code
   * appelait `clear()`, ce qui jetait aussi les entrées périmées — or ce sont
   * elles qui tiennent les restaurants debout pendant une panne d’API.
   * Le `delete` préalable remet l’hôte en fin de file : sans lui, `set` sur une
   * clé existante garde sa position d’origine et un hôte très actif finirait
   * par être évincé avant un hôte vu une seule fois.
   */
  resolus.delete(host);
  if (resolus.size >= CACHE_MAX) {
    const plusAncien = resolus.keys().next();
    if (!plusAncien.done) resolus.delete(plusAncien.value);
  }
  resolus.set(host, { slug, jusqua: Date.now() + (slug ? TTL_HIT_MS : TTL_MISS_MS) });
}

/** Hôte nu, sans port ni `www.`. */
function normalizeHost(raw: string | null): string {
  return (raw ?? "")
    .toLowerCase()
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** Un slug de tenant : minuscules, chiffres, tirets. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/**
 * Trois natures d’hôte, et elles ne se ramènent PAS à deux.
 *
 * L’ancien code renvoyait `string | null`, où `null` voulait dire à la fois
 * « la plateforme » et « je ne sais pas » — c’est cette confusion qui servait
 * nos pages commerciales sur le domaine d’un client (1 ter).
 */
type Hote =
  | { readonly type: "plateforme" }
  | { readonly type: "restaurant"; readonly slug: string }
  | { readonly type: "inconnu" };

const PLATEFORME: Hote = { type: "plateforme" };
const INCONNU: Hote = { type: "inconnu" };

/**
 * Délai maximal accordé à la résolution.
 *
 * Ce `fetch` est sur le chemin critique de CHAQUE requête non mise en cache,
 * page et image comprises. Sans borne, une API qui accepte la connexion mais ne
 * répond jamais gèlerait le site entier au lieu de tomber sur le repli.
 */
const DELAI_RESOLUTION_MS = 1_500;

/**
 * Requêtes de résolution en vol, par hôte.
 *
 * Le `matcher` couvre désormais tous les actifs : un premier affichage de page
 * déclenche vingt requêtes en parallèle, toutes sur le même hôte, toutes avec
 * un cache encore vide. Sans cette table, ce sont vingt appels simultanés à
 * l’API pour une seule réponse — précisément la rafale que le cache existe pour
 * éviter.
 */
const enVol = new Map<string, Promise<Hote>>();

/**
 * À quel restaurant cet hôte appartient-il ?
 *
 * Le slug renvoyé est celui que l’API donne, JAMAIS celui qu’on lirait dans le
 * nom d’hôte : c’est toute la différence entre résoudre et deviner.
 */
async function resoudre(host: string): Promise<Hote> {
  const cache = lireCache(host);
  if (cache?.frais) return depuisSlug(cache.slug);

  const dejaEnVol = enVol.get(host);
  if (dejaEnVol) return dejaEnVol;

  const promesse = interrogerApi(host, cache).finally(() => enVol.delete(host));
  enVol.set(host, promesse);
  return promesse;
}

async function interrogerApi(host: string, perime: Lecture | null): Promise<Hote> {
  try {
    const reponse = await fetch(
      `${API_URL}/public/resolve?host=${encodeURIComponent(host)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(DELAI_RESOLUTION_MS),
      },
    );

    // 404 est une RÉPONSE, pas une panne : l’API affirme ne servir personne ici.
    if (reponse.status === 404) {
      ecrireCache(host, null);
      return INCONNU;
    }
    if (!reponse.ok) return replier(perime);

    const corps = (await reponse.json()) as { slug?: unknown };
    if (typeof corps.slug !== "string" || !SLUG_RE.test(corps.slug)) {
      return replier(perime);
    }

    ecrireCache(host, corps.slug);
    return { type: "restaurant", slug: corps.slug };
  } catch {
    // Réseau coupé, délai dépassé, JSON illisible : l’API n’a rien AFFIRMÉ.
    return replier(perime);
  }
}

/**
 * L’API est injoignable — ce qu’on fait, et pourquoi.
 *
 * DEUX MAUVAISES RÉPONSES, écartées toutes les deux :
 *
 *  · Laisser passer comme plateforme. C’est ce que faisait `tenantExists`
 *    (« API injoignable : on laisse passer plutôt que de servir un 404 »). Ça
 *    rouvre exactement la fuite du 1 bis, et au pire moment : pendant une panne,
 *    le domaine de chaque client se met à servir notre page tarifs, et les
 *    moteurs qui passent là indexent ça.
 *  · Refuser sèchement. Correct mais brutal : une coupure de trois secondes
 *    éteindrait tous les sites clients, alors que nous SAVIONS encore, trois
 *    minutes plus tôt, à qui appartenait ce domaine.
 *
 * CE QU’ON FAIT : on rejoue la dernière réponse connue, même périmée. Le TTL
 * borne la FRAÎCHEUR, il ne borne pas la CONNAISSANCE — un domaine ne change
 * pas de restaurant pendant une panne d’API. Et si l’on n’a jamais rien su de
 * cet hôte, on refuse : ne pas savoir n’a jamais été une raison d’ouvrir.
 *
 * L’entrée périmée n’est pas rafraîchie ici, volontairement : elle resterait
 * sinon éternellement en vie sur une API durablement morte, et la première
 * réponse réelle après le rétablissement serait retardée d’autant.
 */
function replier(perime: Lecture | null): Hote {
  return perime ? depuisSlug(perime.slug) : INCONNU;
}

function depuisSlug(slug: string | null): Hote {
  return slug ? { type: "restaurant", slug } : INCONNU;
}

/** Classe l’hôte entrant. Un seul appel par requête. */
async function classerHote(request: NextRequest): Promise<Hote> {
  const host = normalizeHost(request.headers.get("host"));

  // Pas d’en-tête `Host` : requête interne ou client antique, jamais un client.
  if (!host) return PLATEFORME;
  if (host === PRIMARY_DOMAIN) return PLATEFORME;
  if (estUnHoteDePassage(host)) return PLATEFORME;

  if (host.endsWith(`.${PRIMARY_DOMAIN}`)) {
    const label = host.slice(0, -(PRIMARY_DOMAIN.length + 1));

    /*
     * `demo.classfood.snackmanager.fr` : deux niveaux sous la racine. Nous ne
     * servons pas cette forme (l’API ne la résout pas non plus), et l’accepter
     * ouvrirait une seconde adresse par restaurant.
     */
    if (label.includes(".")) return INCONNU;

    /*
     * SOUS-DOMAINE DE RÔLE : `hq`, `tv`, `board`, `caisse`… La liste vient de
     * `@sm/domain` — c’est la MÊME que celle qui interdit ces slugs à la
     * création, et c’est tout l’objet de la source unique. Ces adresses sont à
     * nous : elles servent la plateforme entière, `/sm` compris.
     */
    if (RESERVED_LABELS.has(label)) return PLATEFORME;

    if (!SLUG_RE.test(label)) return INCONNU;
  }

  /*
   * Sous-domaine de la plateforme comme domaine personnalisé : même chemin,
   * même route, aucune convention de nommage. L’API sait résoudre les deux
   * formes (`ResolveTenantByHost` : sous-domaine, puis domaine actif).
   */
  return resoudre(host);
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

  if (
    pathname === `/r/${slug}` ||
    pathname === `/r/${slug}/` ||
    pathname === `/r/${slug}/icon.svg` ||
    pathname === `/r/${slug}/fidelite` ||
    pathname.startsWith(`/r/${slug}/fidelite/`)
  ) {
    return "laisser";
  }
  if (pathname === "/w.js" || pathname === "/robots.txt") return "laisser";
  if (pathname === `/embed/${slug}` || pathname === `/embed/${slug}/`) return "laisser";
  if (pathname.startsWith("/t/") || pathname.startsWith("/photos/")) return "laisser";

  return "refuser";
}

/**
 * Deux façons de refuser SUR UN DOMAINE DE RESTAURANT, parce que deux choses
 * très différentes sont demandées.
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

/**
 * Refus d’un hôte qui ne résout vers aucun restaurant.
 *
 * TOUJOURS 404, JAMAIS DE REDIRECTION — et ce n’est pas un détail de style :
 * sur un domaine de restaurant, `refus` renvoie une navigation vers `/`, où la
 * carte l’attend. Ici, `/` est refusé exactement comme le reste. Rediriger
 * `/offres` vers `/` produirait donc une boucle 308 → 308 → 308 que le
 * navigateur finirait par couper sur une erreur illisible.
 *
 * `Cache-Control: no-store` parce que ce 404 est presque toujours temporaire —
 * un domaine en cours d’activation. Le laisser se figer dans un cache
 * intermédiaire ferait durer la panne bien après sa correction.
 *
 * Le corps nomme l’hôte : c’est la seule information utile au support quand un
 * restaurateur appelle en disant « mon site ne marche pas ».
 */
function refusHoteInconnu(host: string): NextResponse {
  return new NextResponse(`Aucun établissement n’est servi sur « ${host} ».\n`, {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "x-sm-host": "inconnu",
    },
  });
}

const EMBED_PATH = /^\/embed\/[^/]+\/?$/;

/** Une seule politique, appliquée aux passages, réécritures, redirections et refus. */
function appliquerPolitiqueCadre(pathname: string, response: NextResponse): NextResponse {
  const embeddable = pathname === "/w.js" || EMBED_PATH.test(pathname);
  if (embeddable) {
    response.headers.set("Content-Security-Policy", "frame-ancestors *");
    response.headers.delete("X-Frame-Options");
  } else {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  if (pathname === "/w.js" && !response.headers.has("Cache-Control")) {
    // Le chargeur change rarement : cache navigateur court + revalidation CDN.
    // Un refus temporaire d'hôte porte déjà `no-store` et doit le conserver.
    response.headers.set(
      "Cache-Control",
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * L’HÔTE EST CLASSÉ AVANT LE CHEMIN, ET L’ORDRE COMPTE. L’ancienne version
   * testait `pathname !== "/"` en premier et sortait aussitôt : le domaine
   * n’était donc JAMAIS regardé pour les 99 % de requêtes qui ne visent pas la
   * racine. C’est précisément ce qui laissait passer tout le reste du site.
   */
  const hote = await classerHote(request);

  let response: NextResponse;
  if (hote.type === "inconnu") {
    response = refusHoteInconnu(normalizeHost(request.headers.get("host")));
  } else if (hote.type === "plateforme") {
    response = NextResponse.next();
  } else {
    switch (verdictPourRestaurant(pathname, hote.slug)) {
      case "réécrire":
        response = rewriteToRestaurant(request, hote.slug);
        break;
      case "refuser":
        response = refus(request);
        break;
      default:
        response = NextResponse.next();
    }
  }
  return appliquerPolitiqueCadre(pathname, response);
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
     * comparaison de chaîne, sans aucun appel réseau — et sur un domaine de
     * restaurant, la résolution est en cache mémoire, les requêtes simultanées
     * du premier affichage étant mutualisées par `enVol`. Le coût est réel mais
     * constant ; l’alternative était de laisser la fuite ouverte.
     */
    "/((?!_next/).*)",
  ],
};
