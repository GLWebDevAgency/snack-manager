import { detecterImage } from "@sm/contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE LOGO DU RESTAURATEUR, RAPATRIÉ ET MIS EN LIGNE DANS L'ICÔNE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un SVG servi COMME IMAGE (icône de manifeste, `<img src>`, rastériseur de
 * lanceur Android) est en mode statique sécurisé : il ne charge aucune
 * sous-ressource. Un `<image href="https://…">` y rendrait du vide. Une adresse
 * `data:`, elle, n'est pas une ressource externe — elle est EN LIGNE. C'est
 * tout ce qu'il faut pour composer l'icône masquable autour du vrai logo, et
 * c'est ce que ce module fabrique : des octets récupérés côté serveur, vérifiés,
 * puis encodés en base64.
 *
 * Aucune bibliothèque de traitement d'images n'entre ici, et c'est le point :
 * on ne redimensionne rien, on ne rastérise rien. Le logo est POSÉ tel quel
 * dans la zone sûre, et c'est le rendu SVG qui l'ajuste.
 *
 * ─── CE MODULE NE TOURNE QUE SUR LE SERVEUR ───
 *
 * Il n'importe pas `server-only` pour rester testable sans navigateur — même
 * parti que `relay-proof.ts`, à côté. Il n'est atteignable que depuis la route
 * `icon.svg`, qui est un gestionnaire de route Node.
 */

/**
 * LE PLAFOND DE POIDS, et ce qui se passe au-delà.
 *
 * Le logo du pilote pèse 860 octets ; la médiathèque, elle, accepte jusqu'à
 * 2 Mio. Encodé en base64 (+ 33 %), un tel fichier ferait une icône de 2,7 Mo
 * — que le lanceur devrait télécharger et décoder pour peindre 48 px, et que
 * chaque cache intermédiaire garderait. Au-delà de ce plafond, on NE COMPOSE
 * PAS : la route retombe sur le dessin généré. C'est un repli visible et
 * assumé, pas un silence — le restaurateur voit notre dessin, jamais un carré
 * vide.
 *
 * 96 Kio est large pour ce qu'un logo est réellement (un aplat vectorisé
 * exporté en PNG ou WebP tient sous 30 Kio) et étroit pour ce qu'une PHOTO
 * déposée par erreur à cet emplacement serait. La frontière tombe donc entre
 * les deux, ce qui est exactement où on la veut.
 */
export const POIDS_MAX_LOGO = 96 * 1024;

/**
 * LE DÉLAI, et pourquoi il est court.
 *
 * Cette icône est demandée pendant l'installation d'une carte. Une icône qui
 * met trois secondes à venir est pire qu'une icône générique : le lanceur
 * abandonne, et le client garde une pastille grise pour toujours — un
 * manifeste n'est jamais relu après l'installation. On préfère notre dessin,
 * tout de suite.
 */
export const DELAI_MAX_LOGO_MS = 1500;

/**
 * L'hôte d'une URL, ou `null` si ce n'en est pas une.
 *
 * `new URL` fait le travail délicat : l'hôte de `https://mechant.fr@exemple.fr/x`
 * est `exemple.fr` (l'user-info n'est pas l'hôte), et un port ou une adresse
 * IPv6 littérale ne se retirent pas au premier `:`.
 */
function hoteDeLUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Une entrée de configuration ramenée à son hôte — URL complète ou hôte nu. */
function hoteDe(brut: string): string | null {
  const nettoye = brut.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (nettoye === "") return null;
  return hoteDeLUrl(nettoye) ?? hoteDeLUrl(`https://${nettoye}`);
}

/**
 * ═══ D'OÙ ON ACCEPTE DE RAPATRIER DES OCTETS ═══
 *
 * La règle est celle d'`origines-images.ts` côté API, et il faut dire pourquoi
 * elle est réécrite ici plutôt qu'importée : les deux applications ne partagent
 * que le paquet `contracts`, et ce paquet ne connaît ni le domaine public du
 * déploiement ni l'hôte du magasin d'images — c'est l'argument même que le
 * fichier de l'API écrit pour justifier sa propre position. Les deux listes ne
 * sont d'ailleurs pas identiques, et ne peuvent pas l'être : l'API y met SON
 * domaine de plateforme, le Web y met l'API qu'il interroge.
 *
 * Ce qu'on autorise :
 *
 *  - `NEXT_PUBLIC_API_URL`, l'API que ce Web interroge. C'est LÀ que les octets
 *    d'un média vivent : `urlMedia` rend `<base>/public/medias/<tenant>/<empreinte>`
 *    où `base` est l'origine de dépôt, déjà validée contre la liste de l'API au
 *    moment du dépôt. Le repli `localhost:3001` est celui de tous les autres
 *    modules d'ici : sans lui, le développement ne composerait jamais.
 *  - `PUBLIC_ROOT_DOMAIN` et `NEXT_PUBLIC_SITE_URL` et leurs sous-domaines —
 *    notre domaine public, sous lequel le logo hérité est servi
 *    (`/public/tenants/<slug>/logo`).
 *  - `SM_IMAGE_ORIGINS`, la même liste que l'API, pour le magasin d'images le
 *    jour où il sert sous son propre domaine.
 *
 * Et ce que ça ferme : un `owner` qui écrirait dans son masque l'adresse d'un
 * logo hébergé ailleurs ferait sinon partir une requête DE NOTRE SERVEUR vers
 * l'hôte de son choix, à chaque icône demandée. La lecture du masque, elle,
 * reste tolérante — comme côté API — : une URL hors liste ne casse rien, elle
 * ne s'incorpore simplement pas.
 *
 * Cette liste ne LÈVE PAS quand elle est vide, contrairement à celle de l'API :
 * ici, rien d'autorisé veut dire « on ne compose pas », et la route sert le
 * dessin généré. Faire tomber une icône de lanceur pour une variable
 * d'environnement absente serait la mauvaise moitié du marché.
 */
export function hotesDeLogos(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const declarees = [
    env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
    env.PUBLIC_ROOT_DOMAIN ?? "",
    env.NEXT_PUBLIC_SITE_URL ?? "",
    ...(env.SM_IMAGE_ORIGINS ?? "").split(","),
  ];
  return [...new Set(declarees.map(hoteDe).filter((h): h is string => h !== null))];
}

/**
 * L'URL vient-elle d'un hôte autorisé ?
 *
 * Le suffixe est comparé AVEC son point : sans lui, `evilexemple.fr` passerait
 * pour un sous-domaine d'`exemple.fr`. Ce qu'on n'a pas su lire, on ne le
 * télécharge pas.
 */
export function logoAutorise(url: string, hotes: readonly string[]): boolean {
  const hote = hoteDeLUrl(url);
  if (hote === null) return false;
  return hotes.some((autorise) => hote === autorise || hote.endsWith(`.${autorise}`));
}

type Options = {
  hotes?: readonly string[];
  poidsMax?: number;
  delaiMs?: number;
};

/**
 * LE LOGO, RAMENÉ À UNE ADRESSE `data:` — ou `null`, sans jamais lever.
 *
 * Six refus possibles, tous silencieux pour l'appelant et tous délibérés :
 * hôte non autorisé, requête en échec ou expirée, réponse non-200, poids
 * annoncé ou réel au-dessus du plafond, et enfin — le seul qui juge le
 * CONTENU — des octets dont la signature n'est pas celle d'une image raster.
 *
 * ═══ LE TYPE VIENT DES OCTETS, JAMAIS DE L'EXTENSION NI DU `Content-Type` ═══
 *
 * `detecterImage` (contrat) lit la signature et ne reconnaît que PNG, JPEG et
 * WebP. Un SVG n'y figure pas, et son en-tête l'explique : un SVG peut
 * embarquer du script. C'est exactement ce qu'il faut ici — le fichier qu'on
 * s'apprête à incorporer ENTRE dans notre balisage, ce n'est plus une image
 * qu'on affiche à côté, c'est un contenu qu'on adopte. Le `Content-Type` de
 * la réponse et l'extension de l'URL sont deux déclarations ; les douze
 * premiers octets sont un fait. La médiathèque sert d'ailleurs ses objets SANS
 * extension (`/public/medias/<tenant>/<empreinte>`), ce qui rend l'extension
 * inutilisable pour ce jugement de toute façon.
 */
export async function logoIncorpore(url: string, options: Options = {}): Promise<string | null> {
  const hotes = options.hotes ?? hotesDeLogos();
  if (!logoAutorise(url, hotes)) return null;

  const poidsMax = options.poidsMax ?? POIDS_MAX_LOGO;
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      /*
       * Le délai est porté par le signal, pas par une course de promesses :
       * `AbortSignal.timeout` ferme aussi la connexion, au lieu de laisser un
       * téléchargement de 2 Mio se poursuivre pour rien derrière un `null`
       * déjà rendu.
       *
       * Aucune directive `cache` : on laisse Next décider. Ce qui borne
       * vraiment le trafic est l'en-tête que la route émet elle-même, et les
       * octets d'un média sont adressés par leur empreinte — deux versions
       * d'un logo ne partagent jamais une URL.
       */
      signal: AbortSignal.timeout(options.delaiMs ?? DELAI_MAX_LOGO_MS),
      headers: { Accept: "image/png,image/jpeg,image/webp" },
    });
  } catch {
    return null;
  }
  if (!reponse.ok) return null;

  // Le poids ANNONCÉ, quand il l'est : refuser avant de lire deux mégaoctets.
  const annonce = Number(reponse.headers.get("Content-Length"));
  if (Number.isFinite(annonce) && annonce > poidsMax) return null;

  let octets: Uint8Array;
  try {
    octets = new Uint8Array(await reponse.arrayBuffer());
  } catch {
    return null;
  }
  // …puis le poids RÉEL : un `Content-Length` est une promesse, pas une mesure.
  if (octets.byteLength > poidsMax) return null;

  const type = detecterImage(octets);
  if (type === null) return null;
  return `data:${type};base64,${Buffer.from(octets).toString("base64")}`;
}
