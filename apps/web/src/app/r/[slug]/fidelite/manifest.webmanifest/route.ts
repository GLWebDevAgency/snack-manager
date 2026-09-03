import { logoPour } from "@sm/contracts";
import { loadPublicLoyalty } from "@/components/loyalty/public-api";

/**
 * Le type MIME d'une icône — DÉCLARÉ SEULEMENT QUAND ON LE SAIT.
 *
 * Le manifeste déclarait tout logo comme `image/png` en `512x512` : un SVG y
 * était annoncé raster, et un logo de 300 px annoncé 512. Android refuse
 * l'icône dont le type déclaré ne correspond pas au fichier servi — le client
 * installait la carte du restaurant et retrouvait une pastille grise.
 *
 * LE CORRECTIF SUIVANT ÉTAIT LUI-MÊME FAUX, ET IL L'ÉTAIT SUR LE PILOTE.
 *
 * Il traitait toute extension inconnue en PNG, « le format que produit notre
 * chaîne de dépôt ». C'est inexact : `detecterImage` admet PNG, JPEG ET WebP,
 * et la médiathèque sert les octets d'origine tels quels, sous une adresse
 * SANS extension (`/public/medias/<établissement>/<empreinte>`). Le logo du
 * pilote est un WebP de 860 octets : il était donc déclaré `image/png` — très
 * exactement le refus que ce commentaire décrit trois lignes plus haut.
 *
 * On ne devine donc plus. Quand l'extension ne dit rien, `type` et `sizes`
 * sont OMIS : la spécification ne rend obligatoire que `src`, et le navigateur
 * lit alors les octets. Déclarer faux est pire que ne rien déclarer.
 */
function iconeDe(src: string): { src: string; sizes?: string; type?: string; purpose: string } {
  const chemin = src.split("?")[0] ?? src;
  const ext = /\.([a-z0-9]+)$/i.exec(chemin)?.[1]?.toLowerCase();
  if (ext === "svg") return { src, sizes: "any", type: "image/svg+xml", purpose: "any" };
  const type =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : null;
  // Sans type sûr, pas de `sizes` non plus : la taille était devinée dans le
  // même mouvement, et un logo de 300 px annoncé 512 est le second mensonge.
  return type ? { src, sizes: "512x512", type, purpose: "any" } : { src, purpose: "any" };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CE FICHIER EST LU UNE FOIS, À L'INSTALLATION — ET PLUS JAMAIS APRÈS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * À l'ajout à l'écran d'accueil, Android FIGE ce que le manifeste dit : le nom
 * court, l'icône de lanceur, la couleur d'écran d'ouverture (`background_color`)
 * et la couleur de barre système (`theme_color`) sont recopiés dans le système
 * et ne sont plus relus. Chrome ne revient pas chercher ce fichier ; iOS non
 * plus.
 *
 * LA CONSÉQUENCE, ÉCRITE ICI PARCE QUE C'EST ICI QU'ELLE SE DÉCIDE : changer
 * l'identité d'un restaurant NE MET PAS À JOUR LES CARTES DÉJÀ INSTALLÉES. Un
 * client qui a installé la carte quand l'accent était doré gardera une icône
 * dorée et une barre système dorée, quoi qu'on serve ensuite — jusqu'à ce
 * qu'il désinstalle et réinstalle. Ce n'est pas un défaut du produit et aucun
 * code d'ici ne peut le contourner : c'est le contrat de la plateforme.
 *
 * Ce qui suit L'IDENTITÉ EN DIRECT, en revanche, c'est tout le reste : la page
 * elle-même, son `theme_color` de document (`generateViewport`), le favicon
 * d'onglet et les icônes servies par `icon.svg` — parce que ceux-là sont relus
 * à chaque ouverture. L'écart visible après un changement d'identité se limite
 * donc à trois choses : l'icône du lanceur, l'écran d'ouverture, et la barre
 * système de l'application installée.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });
  const path = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
  // L'installation prend le masque du restaurant, pas la marque grise de Snack Manager.
  const brand = catalog.restaurant.brand;
  const ground = brand.palette.ground;
  const logo = logoPour(brand, "mark");
  /*
   * ═══ DEUX ENTRÉES GÉNÉRÉES, ET PAS UNE « any maskable » ═══
   *
   * `purpose: "any maskable"` sur une seule image est un compromis perdant, et
   * la spécification le dit à sa façon : une icône MASQUABLE doit réserver
   * environ 20 % de marge tout autour, parce que le lanceur y applique SA
   * découpe (cercle, carré arrondi, goutte) ; une icône ANY n'est pas rognée
   * du tout, et cette même marge la fait simplement paraître plus petite que
   * ses voisines sur l'écran d'accueil. Un seul fichier ne peut pas être juste
   * dans les deux rôles — l'ancienne icône était donc soit rognée, soit
   * rabougrie, selon le lanceur.
   *
   * `icon.svg` rend donc deux dessins, choisis par `?forme=` : la même
   * géométrie, deux échelles et deux fonds (voir `icone-carte.ts`).
   *
   * ═══ ET LE LOGO EST DANS LES DEUX, MAIS PAS DE LA MÊME FAÇON ═══
   *
   * Quand le restaurateur a déposé un vrai logo, c'est LUI qu'on veut voir.
   *
   * En rôle `any`, il reste seul et POINTÉ DIRECTEMENT : cette icône n'est
   * jamais rognée, elle n'a donc besoin ni de notre fond ni d'une marge, et le
   * fichier du restaurateur est ce qu'il y a de plus juste à y mettre. On
   * n'ajoute pas la variante `plein` derrière lui — deux entrées `any`
   * mettraient Chrome en position d'arbitrer, et un SVG en `sizes: "any"`
   * l'emporte souvent sur un PNG de 512.
   *
   * En rôle `maskable`, l'entrée ne change pas d'adresse : c'est toujours
   * `icon.svg?forme=masquable`. Mais ce que cette route rend, elle, a changé —
   * elle COMPOSE l'icône autour du logo (fond du masque sur tout le canevas,
   * logo ajusté dans la zone sûre) au lieu de servir seulement notre dessin.
   * La marge que « le logo d'un tiers » ne pouvait pas recevoir, le SVG la lui
   * donne sans toucher au fichier ni rastériser quoi que ce soit. C'est ce qui
   * met enfin le logo sur l'écran d'accueil, que Chrome sur Android peint
   * depuis le rôle masquable. Le repli, quand la composition échoue, reste ce
   * même dessin généré — l'entrée du manifeste est vraie dans les deux cas.
   */
  const genere = (forme: "plein" | "masquable", purpose: string) => ({
    src: `${path}/icon.svg?forme=${forme}`,
    sizes: "any",
    type: "image/svg+xml",
    purpose,
  });
  const masquable = genere("masquable", "maskable");
  return Response.json(
    {
      id: path,
      name: `${catalog.restaurant.name} · Fidélité`,
      short_name: catalog.restaurant.name.slice(0, 30),
      description: `Carte et récompenses fidélité ${catalog.restaurant.name}.`,
      lang: "fr",
      dir: "ltr",
      start_url: path,
      scope: path,
      display: "standalone",
      background_color: ground,
      theme_color: ground,
      icons: logo
        ? [iconeDe(logo), masquable]
        : [genere("plein", "any"), masquable],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
