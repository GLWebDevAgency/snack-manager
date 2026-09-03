import { loadPublicLoyalty } from "@/components/loyalty/public-api";
import { dessinerIconeCarte, formeDemandee } from "@/components/loyalty/icone-carte";

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
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });

  const forme = formeDemandee(new URL(request.url).searchParams.get("forme"));
  const svg = dessinerIconeCarte(catalog.restaurant.brand, forme);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      /*
       * `Vary: Accept` n'aurait aucun sens ici, mais la MISE EN CACHE doit
       * distinguer les deux rôles : ce sont deux URL différentes (le paramètre
       * de requête en fait partie), donc les caches intermédiaires les
       * séparent d'eux-mêmes.
       */
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
