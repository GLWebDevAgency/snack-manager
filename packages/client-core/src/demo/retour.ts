/**
 * Le retour à la vitrine, depuis une démonstration ouverte en plein écran.
 *
 * ─── LE DÉFAUT QUE CE MODULE RÉPARE ───
 *
 * La vitrine embarque les démonstrations dans un châssis d'appareil, et propose
 * « Ouvrir en plein écran », qui les ouvre dans un NOUVEL ONGLET. Une fois
 * là-bas, rien ne ramenait au site : techniquement l'onglet se ferme, mais
 * rien ne le dit — et sur un téléphone, où les onglets sont un menu caché, le
 * visiteur est simplement perdu. On sortait un prospect de notre site de vente
 * pour le déposer dans une impasse.
 *
 * ─── CE QUE CE MODULE DÉCIDE, ET CE QU'IL NE DÉCIDE PAS ───
 *
 * Il ne dessine rien : les quatre surfaces ne partagent aucun composant (deux
 * sont en React Native, deux en React DOM). Il porte la DÉCISION et le
 * VOCABULAIRE, c'est-à-dire tout ce qui doit être identique d'une
 * démonstration à l'autre — sans quoi on donnerait l'impression de quatre
 * produits distincts alors qu'on vend une suite.
 *
 * ─── LES TROIS RÈGLES ───
 *
 * 1. HORS DÉMONSTRATION, RIEN. Une vraie caisse en service ne doit jamais
 *    afficher un lien vers notre site commercial : ce serait une porte de
 *    sortie posée sur l'écran de travail d'un commerçant, à portée de doigt
 *    d'un équipier en plein coup de feu. `retour.test.ts` l'épingle.
 *
 * 2. LA DESTINATION NE VIENT JAMAIS DE L'URL. Aucune fonction d'ici ne lit
 *    `location.search`, et aucune n'accepte d'adresse de retour en paramètre
 *    d'appel « libre » : la destination descend de la CONFIGURATION de
 *    l'application, et elle est re-validée par `destinationSure()`. Accepter
 *    un `?retour=…` reviendrait à publier une redirection ouverte — un
 *    tremplin pour déposer une victime sur un site pirate depuis un lien qui
 *    porte NOTRE nom de domaine, avec notre certificat et notre réputation.
 *
 * 3. DANS UN CADRE, RIEN. Quand la démonstration tourne dans l'iframe de la
 *    vitrine, le visiteur EST déjà sur le site : un « retour au site » y
 *    serait au mieux absurde, au pire inerte (le bac à sable de l'iframe
 *    n'autorise pas la navigation de la fenêtre parente). Le bandeau
 *    s'efface, et le châssis d'appareil de la vitrine reste tel quel.
 */

/** Le nom qu'on porte, à l'identique sur les quatre démonstrations. */
export const DEMO_MARQUE = 'Snack Manager';

/**
 * Ce que le visiteur regarde, dit en une ligne.
 *
 * Elle rassure celui qui hésite à toucher « Encaisser » et elle évite le
 * malentendu de quelqu'un qui croirait manipuler un vrai restaurant.
 */
export const DEMO_MENTION = 'Démonstration — données fictives, rien n’est enregistré';

/** La même chose, quand la barre n'a plus la place (téléphone, 390 px). */
export const DEMO_MENTION_COURTE = 'Données fictives';

/** Le visiteur vient de la vitrine : on le lui rend. */
export const LIBELLE_RETOUR = 'Retour au site';

/**
 * Le visiteur ne vient pas de la vitrine (lien partagé, favori) : lui parler
 * de « retour » l'enverrait vers une page dont il ne vient pas. On l'invite.
 */
export const LIBELLE_DECOUVERTE = 'Découvrir Snack Manager';

/**
 * Repli quand la configuration ne dit rien.
 *
 * Même parti pris que `DEFAULT_API` dans `apps/pos/src/client.ts` : une
 * constante de production plutôt qu'une valeur vide. Une tablette exportée
 * sans `EXPO_PUBLIC_SITE_URL` affiche alors un lien qui MARCHE, au lieu d'un
 * bouton mort — le pire des deux mondes, puisqu'il se voit sans rien faire.
 */
export const SITE_PAR_DEFAUT = 'https://web-production-99b58c.up.railway.app';

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
  /** Le mode démonstration est-il actif ? Vient de `isDemoRequested()`. */
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
  const brute = (configuree ?? '').trim();
  if (estDestinationSure(brute)) return brute;
  return estDestinationSure(repli.trim()) ? repli.trim() : SITE_PAR_DEFAUT;
}

function estDestinationSure(url: string): boolean {
  if (url === '') return false;
  // Chemin absolu de MÊME origine. `//ailleurs.fr` et `/\ailleurs.fr` sont
  // des URL absolues déguisées en chemins : les navigateurs les suivent hors
  // du site. Le second caractère décide.
  if (url === '/') return true;
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
 * indiscernable d'un visiteur venu d'un favori : les deux arrivent sans
 * référent. Il faut trancher, et on tranche pour le cas dominant — celui que
 * le défaut décrit, celui du prospect qu'on vient de sortir de notre site de
 * vente. Lui dire « Retour au site » est exact ; le dire à quelqu'un venu d'un
 * favori est, au pire, une formule un peu large pour un lien qui l'emmène de
 * toute façon au bon endroit.
 *
 * Un référent ÉTRANGER, lui, est une preuve positive : le lien a circulé
 * (message, réseau social, moteur). Là, « retour » serait faux, et on invite.
 *
 * Voir le rapport : rendre le cas exact ne demande qu'un `rel="noopener"` sans
 * `noreferrer` côté vitrine.
 */
export function vientDuSite(
  referrer: string | null | undefined,
  href: string,
  origine?: string | null,
): boolean {
  const brut = (referrer ?? '').trim();
  // Aucun référent : indécidable, on tranche pour le cas dominant.
  if (brut === '') return true;
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
 * La surface tourne-t-elle dans un cadre ?
 *
 * Hors navigateur (tablette native), `self` et `top` n'existent pas : la
 * réponse est `false`, ce qui est exact — une application native n'est dans le
 * cadre de personne.
 */
export function estEncadre(): boolean {
  const g = globalThis as { self?: unknown; top?: unknown };
  if (typeof g.self === 'undefined' || typeof g.top === 'undefined') return false;
  return g.self !== g.top;
}

/** `document.referrer`, ou `null` s'il est vide ou absent. */
export function referrerCourant(): string | null {
  const document = (globalThis as { document?: { referrer?: unknown } }).document;
  const valeur = document?.referrer;
  return typeof valeur === 'string' && valeur !== '' ? valeur : null;
}

/** Origine de la page courante, `null` hors navigateur. */
export function origineCourante(): string | null {
  const location = (globalThis as { location?: { origin?: unknown } }).location;
  return typeof location?.origin === 'string' ? location.origin : null;
}
