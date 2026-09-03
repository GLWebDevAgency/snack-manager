import { logoPour } from "@sm/contracts";
import { loadPublicLoyalty } from "@/components/loyalty/public-api";
import {
  dessinerIconeCarte,
  dessinerIconeLogo,
  formeDemandee,
} from "@/components/loyalty/icone-carte";
import { logoIncorpore } from "@/components/loyalty/logo-incorpore";

/**
 * L'ICÔNE DE LANCEMENT — le dessin vit dans `components/loyalty/icone-carte.ts`.
 *
 * Cette route n'est qu'une porte : elle lit le masque du restaurant, choisit le
 * RÔLE demandé et rend le fichier. Le dessin est ailleurs pour une raison
 * précise — sa géométrie (zone sûre masquable, contraste du liseré sur les six
 * directions) se prouve sans monter de serveur, et un test le fait.
 *
 * `?forme=masquable` rend la variante que le lanceur Android rogne ; tout le
 * reste, y compris l'absence de paramètre, rend la variante `plein`. C'est
 * volontairement le défaut : cette même URL nue sert de favicon à la page
 * (`generateMetadata`), et un favicon n'est jamais rogné.
 *
 * ═══ ET LE RÔLE MASQUABLE PORTE MAINTENANT LE LOGO ═══
 *
 * Chrome sur Android PRÉFÈRE l'icône masquable pour l'écran d'accueil. Tant que
 * ce rôle restait notre dessin, déposer son logo ne changeait pas l'icône du
 * lanceur — le restaurateur voyait son logo dans l'onglet et nulle part
 * ailleurs. La route récupère donc le logo, le vérifie et l'INCORPORE en
 * `data:` dans le SVG (`logo-incorpore.ts`), puis compose l'icône autour de lui
 * (`dessinerIconeLogo`). Un SVG servi comme image ne charge aucune ressource
 * externe : l'incorporation n'est pas une optimisation, c'est la seule voie.
 *
 * Le rôle `any` du manifeste, lui, ne change pas : il pointe toujours
 * DIRECTEMENT sur le fichier du logo, qui n'y est pas rogné. Le remplacer par
 * cette composition aurait ajouté notre fond et une marge de zone sûre là où
 * ni l'un ni l'autre n'a de raison d'être.
 *
 * Toute étape peut échouer — hôte hors liste, fichier trop lourd, réseau lent,
 * octets qui ne sont pas une image raster. Chacune retombe alors sur le dessin
 * généré, jamais sur du vide : une icône de lanceur ne se corrige plus après
 * l'installation.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });

  const brand = catalog.restaurant.brand;
  const forme = formeDemandee(new URL(request.url).searchParams.get("forme"));

  /*
   * Le logo n'est rapatrié que pour le rôle masquable : c'est le seul qu'il
   * change. Le rôle `plein` sert de favicon d'onglet à chaque ouverture de la
   * page — lui faire télécharger une image à chaque fois serait payer un appel
   * réseau pour un dessin que le manifeste ne lui demande même pas.
   */
  const adresseLogo = forme === "masquable" ? logoPour(brand, "mark") : null;
  const incorpore = adresseLogo ? await logoIncorpore(adresseLogo) : null;
  const compose = incorpore ? dessinerIconeLogo(brand, incorpore) : null;
  const svg = compose ?? dessinerIconeCarte(brand, forme);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      /*
       * `Vary: Accept` n'aurait aucun sens ici, mais la MISE EN CACHE doit
       * distinguer les deux rôles : ce sont deux URL différentes (le paramètre
       * de requête en fait partie), donc les caches intermédiaires les
       * séparent d'eux-mêmes.
       *
       * ═══ CE QUE LE LOGO CHANGE À CET EN-TÊTE ═══
       *
       * L'icône dépend désormais d'octets qu'on va chercher ailleurs, donc
       * d'une opération qui peut ÉCHOUER pour une raison passagère — API lente,
       * réseau coupé. Les deux cas ne méritent pas le même cache :
       *
       *  · une icône COMPOSÉE, ou une icône générée parce qu'aucun logo n'est
       *    posé, décrit un état stable du masque. Elle garde l'en-tête d'avant
       *    (5 min de fraîcheur, un jour de service en arrière-plan) ;
       *  · une icône générée alors qu'un logo EST posé est le résultat d'un
       *    repli. Le figer un jour entier dans les caches intermédiaires ferait
       *    payer une coupure de deux secondes à toutes les installations de la
       *    journée. Une minute, sans `stale-while-revalidate` : la prochaine
       *    demande retente.
       *
       * Rien de tout cela ne sauve une carte DÉJÀ installée — Android fige
       * l'icône à l'installation et ne la relit jamais (voir l'en-tête du
       * manifeste). C'est bien pour ça que le repli doit être court : la seule
       * fenêtre qui compte est celle où le client installe.
       */
      "Cache-Control":
        adresseLogo && !compose
          ? "public, max-age=60"
          : "public, max-age=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
