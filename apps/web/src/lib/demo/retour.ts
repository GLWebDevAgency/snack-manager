/**
 * Le retour à la vitrine, côté web — back-office ET commande en ligne.
 *
 * ─── LE DÉFAUT QUE CE MODULE RÉPARE ───
 *
 * La vitrine propose « Ouvrir en plein écran », qui ouvre les démonstrations
 * dans un NOUVEL ONGLET. Une fois là-bas, rien ne ramenait au site : l'onglet
 * se ferme, mais rien ne le dit — et sur un téléphone, où les onglets sont un
 * menu caché, le visiteur est simplement perdu. On sortait un prospect de
 * notre site de vente pour le déposer dans une impasse.
 *
 * ─── POURQUOI CE FICHIER EST LE JUMEAU DE CELUI DE `@sm/client-core` ───
 *
 * La caisse et l'écran cuisine sont des applications Expo, déployées sur
 * d'autres origines ; elles ne partagent aucun composant avec Next.js et
 * `apps/web` ne dépend pas de `@sm/client-core`. La duplication est donc
 * assumée — mais elle porte sur le CODE, jamais sur les mots ni sur les
 * règles : quatre bandeaux différents donneraient l'impression de quatre
 * produits, alors qu'on vend une suite. Toute correction faite ici doit être
 * reportée dans `packages/client-core/src/demo/retour.ts`, et l'inverse.
 *
 * ─── LES TROIS RÈGLES, IDENTIQUES DES DEUX CÔTÉS ───
 *
 * 1. HORS DÉMONSTRATION, RIEN. Un back-office qui pilote un vrai restaurant ne
 *    doit jamais afficher de lien vers notre site commercial, et la page d'un
 *    vrai restaurant encore moins : ce serait une porte de sortie posée sur
 *    l'écran de travail d'un commerçant, ou pire, un lien vers un concurrent
 *    de son point de vue, sur SON domaine.
 *
 * 2. LA DESTINATION NE VIENT JAMAIS DE L'URL. Rien ici ne lit
 *    `location.search` : la destination descend de `NEXT_PUBLIC_SITE_URL` et
 *    passe par `destinationSure()`. Accepter un `?retour=…` publierait une
 *    redirection ouverte — un tremplin pour déposer une victime sur un site
 *    pirate depuis un lien qui porte NOTRE nom de domaine.
 *
 * 3. DANS UN CADRE, RIEN. Embarquée dans l'iframe de la vitrine, la
 *    démonstration est déjà sur le site : le retour y serait absurde, et de
 *    toute façon inerte (le bac à sable de l'iframe interdit la navigation de
 *    la fenêtre parente).
 */

/** Le nom qu'on porte, à l'identique sur les quatre démonstrations. */
export const DEMO_MARQUE = "Snack Manager";

/**
 * Ce que le visiteur regarde, dit en une ligne.
 *
 * Elle rassure celui qui hésite à toucher « Encaisser » ou « Payer », et elle
 * évite le malentendu de quelqu'un qui croirait manipuler un vrai restaurant.
 */
export const DEMO_MENTION =
  "Démonstration — données fictives, rien n’est enregistré";

/** La même chose, quand la barre n'a plus la place (téléphone, 390 px). */
export const DEMO_MENTION_COURTE = "Données fictives";

/** Le visiteur vient de la vitrine : on le lui rend. */
export const LIBELLE_RETOUR = "Retour au site";

/**
 * Le visiteur ne vient pas de la vitrine (lien partagé, favori) : lui parler
 * de « retour » l'enverrait vers une page dont il ne vient pas. On l'invite.
 */
export const LIBELLE_DECOUVERTE = "Découvrir Snack Manager";

/**
 * Repli quand la configuration ne dit rien.
 *
 * `/` et non une URL absolue : le back-office et la commande en ligne sont
 * SERVIS PAR LA VITRINE ELLE-MÊME. La racine de l'origine courante est donc la
 * bonne réponse par défaut, quelle que soit la préproduction, la production ou
 * le poste de développement — et elle ne peut, par construction, emmener nulle
 * part ailleurs.
 */
export const SITE_PAR_DEFAUT = "/";

/** Hauteur de la barre, en pixels. Identique sur les quatre démonstrations. */
export const DEMO_BAR_H = 44;

/** Ce qu'il faut pour dessiner le bandeau. `null` = pas de bandeau du tout. */
export interface RetourDemo {
  /** Destination, validée. Jamais issue de l'URL courante. */
  href: string;
  /** Texte du lien — « Retour au site » ou l'invitation. */
  libelle: string;
  /**
   * Vrai : le visiteur vient de chez nous, la flèche vers la gauche a un sens.
   * Faux : c'est une découverte, pas un retour — pas de flèche.
   */
  retour: boolean;
  marque: string;
  mention: string;
  mentionCourte: string;
}

export interface ContexteRetour {
  /** Le mode démonstration est-il actif sur CETTE surface ? */
  demo: boolean;
  /** La surface tourne-t-elle dans le cadre de la vitrine ? */
  encadre: boolean;
  /** `document.referrer`, ou `null`. Sert UNIQUEMENT à choisir un libellé. */
  referrer?: string | null;
  /** Destination lue dans la configuration de l'application. */
  site?: string | null;
  /** Repli si la configuration est absente ou refusée. */
  repli?: string;
  /** Origine de la page courante — utile quand `site` est un chemin. */
  origine?: string | null;
}

/**
 * Une destination acceptable, ou le repli.
 *
 * On ne fait pas confiance à la configuration les yeux fermés : une variable
 * d'environnement mal recopiée (`javascript:…` collé depuis un signet,
 * `//ailleurs.fr` qui ressemble à un chemin mais n'en est pas un) produirait
 * exactement le lien qu'on refuse d'écrire à la main.
 */
export function destinationSure(
  configuree: string | null | undefined,
  repli: string = SITE_PAR_DEFAUT,
): string {
  const brute = (configuree ?? "").trim();
  if (estDestinationSure(brute)) return brute;
  const secours = repli.trim();
  return estDestinationSure(secours) ? secours : SITE_PAR_DEFAUT;
}

function estDestinationSure(url: string): boolean {
  if (url === "") return false;
  // Chemin absolu de MÊME origine. `//ailleurs.fr` et `/\ailleurs.fr` sont des
  // URL absolues déguisées en chemins : les navigateurs les suivent hors du
  // site. Le second caractère décide.
  if (url === "/") return true;
  if (/^\/[^/\\]/.test(url)) return true;
  // Absolue : http(s) et rien d'autre. `javascript:`, `data:` et `blob:` sont
  // des vecteurs d'exécution, pas des destinations.
  return /^https?:\/\/[^/\\?#]+(?:[/?#]|$)/i.test(url);
}

/** Origine (schéma + hôte) d'une URL absolue, en minuscules. `null` sinon. */
function origineDe(url: string | null | undefined): string | null {
  if (!url) return null;
  const trouve = /^https?:\/\/[^/?#]+/i.exec(url.trim());
  return trouve ? trouve[0].toLowerCase() : null;
}

/**
 * Le visiteur arrive-t-il de chez nous ?
 *
 * ─── POURQUOI L'ABSENCE DE RÉFÉRENT COMPTE COMME « OUI » ───
 *
 * La vitrine ouvre les démonstrations avec `rel="noopener noreferrer"`, ce qui
 * EFFACE `document.referrer`. Un visiteur venu de la vitrine est donc
 * indiscernable d'un visiteur venu d'un favori : les deux arrivent nus. Il
 * faut trancher, et on tranche pour le cas dominant — celui que le défaut
 * décrit, celui du prospect qu'on vient de sortir de notre site de vente. Lui
 * dire « Retour au site » est exact ; le dire à quelqu'un venu d'un favori
 * est, au pire, une formule un peu large pour un lien qui l'emmène de toute
 * façon au bon endroit.
 *
 * Un référent ÉTRANGER, lui, est une preuve positive : le lien a circulé
 * (message, réseau social, moteur de recherche). Là, « retour » serait faux,
 * et on invite plutôt à découvrir.
 */
export function vientDuSite(
  referrer: string | null | undefined,
  href: string,
  origine?: string | null,
): boolean {
  const brut = (referrer ?? "").trim();
  // Aucun référent : indécidable, on tranche pour le cas dominant.
  if (brut === "") return true;
  const depuis = origineDe(brut);
  // Un référent qui n'est pas une adresse web (`android-app://com.whatsapp/`,
  // posé par les applications de messagerie) est une preuve positive : le lien
  // a circulé. Ce n'est pas un retour.
  if (depuis === null) return false;
  const vers = origineDe(href) ?? origineDe(origine);
  return vers !== null && depuis === vers;
}

/**
 * Que montrer, s'il faut montrer quelque chose.
 *
 * @returns `null` quand aucun bandeau ne doit exister — hors démonstration, ou
 *          dans le cadre de la vitrine.
 */
export function retourDemo(contexte: ContexteRetour): RetourDemo | null {
  const { demo, encadre, referrer, site, repli, origine } = contexte;
  // Règle 1, et elle passe avant tout le reste.
  if (!demo) return null;
  // Règle 3.
  if (encadre) return null;

  // Règle 2 : la destination sort de la configuration, puis d'un filtre.
  const href = destinationSure(site, repli ?? SITE_PAR_DEFAUT);
  const retour = vientDuSite(referrer, href, origine);

  return {
    href,
    libelle: retour ? LIBELLE_RETOUR : LIBELLE_DECOUVERTE,
    retour,
    marque: DEMO_MARQUE,
    mention: DEMO_MENTION,
    mentionCourte: DEMO_MENTION_COURTE,
  };
}

// ─────────────────────────────────────────────────────────────
// Lecture de l'environnement — jamais de l'URL
// ─────────────────────────────────────────────────────────────

/**
 * Ce que la configuration dit, ou rien.
 *
 * `NEXT_PUBLIC_SITE_URL` est déjà la variable qui porte l'adresse publique du
 * site (balises Open Graph, JSON-LD) : on ne lui invente pas de jumelle. Elle
 * est écrite EN TOUTES LETTRES — Next fait une substitution textuelle au
 * build, un accès calculé rendrait `undefined` dans le bundle.
 */
export function siteConfigure(): string | null {
  return process.env.NEXT_PUBLIC_SITE_URL ?? null;
}

/*
 * Les trois lectures ci-dessous passent par `globalThis` plutôt que par
 * `window` / `document` directement, exactement comme `currentHref()` dans
 * `mode.ts` : c'est ce qui les rend sûres au rendu serveur — où ces objets
 * n'existent pas — et vérifiables hors navigateur.
 */

/**
 * La surface tourne-t-elle dans un cadre ?
 *
 * Hors navigateur (rendu serveur), `self` et `top` n'existent pas : la réponse
 * est `false`, mais le bandeau ne se dessine de toute façon qu'après
 * hydratation.
 */
export function estEncadre(): boolean {
  const g = globalThis as { self?: unknown; top?: unknown };
  if (typeof g.self === "undefined" || typeof g.top === "undefined") return false;
  return g.self !== g.top;
}

/** `document.referrer`, ou `null` s'il est vide ou absent. */
export function referrerCourant(): string | null {
  const doc = (globalThis as { document?: { referrer?: unknown } }).document;
  const valeur = doc?.referrer;
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

/** Origine de la page courante, `null` hors navigateur. */
export function origineCourante(): string | null {
  const loc = (globalThis as { location?: { origin?: unknown } }).location;
  return typeof loc?.origin === "string" ? loc.origin : null;
}

/**
 * Contexte du navigateur, lu UNE fois par chargement de page.
 *
 * Le cache n'est pas une optimisation : `useSyncExternalStore` exige un
 * instantané STABLE — une nouvelle valeur à chaque appel ferait boucler le
 * rendu. Et cette lecture est effectivement figée : ni le cadre, ni le
 * référent, ni l'origine ne changent sous les pieds du visiteur.
 */
let contexte: Omit<ContexteRetour, "demo"> | null = null;

export function contexteNavigateur(): Omit<ContexteRetour, "demo"> {
  contexte ??= {
    encadre: estEncadre(),
    referrer: referrerCourant(),
    site: siteConfigure(),
    origine: origineCourante(),
  };
  return contexte;
}

/** Réservé aux tests : en production, un chargement de page a un seul contexte. */
export function resetContexteForTests(): void {
  contexte = null;
}
