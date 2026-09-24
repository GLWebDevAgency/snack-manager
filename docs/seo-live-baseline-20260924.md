# Baseline HTTP SEO — 24 septembre 2026

Relevé du **24/09/2026 à 14:42:46 UTC**, avant publication de la refonte SEO : 36 GET anonymes via `fetch` Node, sans navigateur ni exécution JavaScript. **36 réponses HTTP 200, aucune redirection HTTP, aucun `X-Robots-Tag`.** Révision Git servie non déterminée par ce relevé. Tailles ci-dessous : corps décompressé en octets, hors ressources liées et en-têtes ; ce ne sont pas des mesures de performance.

**P** = `https://snackmanager.fr` ; **S** = `https://staging.snackmanager.fr` ; **SR** = `https://web-staging-6f5f.up.railway.app` ; **PR** = `https://web-production-99b58c.up.railway.app`.

| Route (statut 200 partout) | P | S | SR | PR |
|---|---:|---:|---:|---:|
| `/` | 169232 | 172528 | 172528 | 169232 |
| `/blog` | 42292 | 42296 | 42352 | 42348 |
| Article G | 64607 | 64571 | 64627 | 64607 |
| Article A | 62214 | 62178 | 62234 | 62214 |
| Article C | 65233 | 65197 | 65253 | 65233 |
| `/robots.txt` | 136 | 144 | 144 | 136 |
| `/sitemap.xml` | 1487 | 1567 | 1567 | 1487 |
| `/admin` | 9264 | 9496 | 9496 | 9264 |
| `/sm` | 9967 | 10185 | 10185 | 9967 |

Articles : **G** = `/blog/lien-de-commande-sur-votre-fiche-google` ; **A** = `/blog/pourquoi-les-prix-sont-plus-chers-sur-les-applis` ; **C** = `/blog/ouvrir-le-click-and-collect-sans-se-tromper`.

Les titres et H1 suivants sont identiques sur les quatre hôtes. Chaque page éditoriale comporte exactement un H1. Pour G, A et C, le `<title>` est le H1 suivi de ` — Snack Manager`.

| Page | H1 | `<title>` si différent de cette règle |
|---|---|---|
| `/` | Gérez votre restaurant. Faites vivre votre carte. | Snack Manager — Logiciels et accompagnement pour les restaurateurs |
| `/blog` | Des repères pour gérer votre restaurant | Le blog — Snack Manager |
| G | Mettre votre lien de commande sur votre fiche Google, et le marquer comme préféré | — |
| A | Pourquoi un même repas peut coûter plus cher sur une appli | — |
| C | Ouvrir le click and collect sans se tromper | — |

**Métadonnées :** `/`, `/blog` et les trois articles déclarent `robots: index, follow` partout. Sur P et PR, leur canonical est P + chemin ; sur S et SR, il est S + chemin, donc staging se désigne lui-même. La canonical de l’accueil omet la barre finale. `/admin` et `/sm` ont le titre `Snack Manager`, sans H1, canonical ou meta robots dans le HTML reçu. Robots et sitemap n’ont ni titre HTML, ni H1, ni canonical.

**Exploration :** les quatre robots servent `User-Agent: *`, `Allow: /`, et les mêmes `Disallow: /admin/`, `/sm/`, `/board/`, `/api/`. Le sitemap annoncé appartient à P sur P/PR, à S sur S/SR. Chaque sitemap contient 10 URL : accueil, offres, caisse, cuisine, commande en ligne, atelier, blog et trois articles. Les quatre `lastmod` publiés valent encore `2026-08-21`.

**Cache observé :** pages éditoriales `s-maxage=60, stale-while-revalidate=31535940` ; `/admin` et `/sm` `s-maxage=31536000` ; robots et sitemap `public, max-age=0, must-revalidate`.

**Conclusion limitée au HTTP :** staging est publiquement accessible et ne fournit aucune exclusion d’indexation sur les routes éditoriales auditées ; il annonce même ses propres canonicals et sitemap. Les deux alias Railway ne redirigent pas. Les racines `/admin` et `/sm` n’ont pas de `noindex` ; les règles robots avec barre finale ne couvrent pas ces racines exactes. Ces observations ne prouvent ni présence dans Google/Bing, ni classement, ni défaut d’autorisation API. Aucun parcours authentifié, index moteur ou mesure de trafic n’a été consulté.
