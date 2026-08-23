import type { MetadataRoute } from "next";
import { SITE_URL, urlAbsolue } from "@/lib/site";

/**
 * `/robots.txt` — CE QU'UN MOTEUR A LE DROIT D'ALLER CHERCHER.
 *
 * ═══ IL EXISTE SURTOUT POUR ANNONCER LE PLAN DE SITE ═══
 *
 * Sans lui, `/sitemap.xml` ne se découvre qu'en le déclarant à la main dans la
 * console de chaque moteur — c'est-à-dire une action humaine, à refaire, et
 * qu'on oublie. La ligne `Sitemap:` est la moitié utile de ce fichier.
 *
 * ═══ CE QU'ON REFUSE, ET CE QU'ON SE GARDE BIEN DE REFUSER ═══
 *
 * On ferme les surfaces d'EXPLOITATION : le back-office du restaurateur, notre
 * propre console, l'écran de salle, et l'API. Aucune n'a de contenu public,
 * toutes sont derrière une authentification, et une adresse d'administration
 * qui traîne dans un index est une invitation permanente.
 *
 * On NE ferme PAS `/r/`, `/embed/` ni `/t/`, et c'est le point qui se trompe le
 * plus souvent : `Disallow` interdit de LIRE la page, donc interdit de lire le
 * `noindex` qu'elle porte. Les trois routes qu'on veut tenir hors de l'index
 * (`/r/demo`, `/embed/[slug]`, `/t/[id]`) déclarent déjà `robots: { index:
 * false }` dans leurs métadonnées : les bloquer ici EMPÊCHERAIT cette consigne
 * d'être lue, et une URL bloquée peut tout de même être indexée sur la foi des
 * liens qui la visent. Le refus s'exprime dans la page, jamais dans ce fichier.
 *
 * `/r/[slug]` — la vitrine d'un restaurant client — est en revanche
 * délibérément indexable (`robots: { index: true }`, avec sa canonique propre) :
 * c'est la page de commande de notre client, on ne la cache pas.
 *
 * ═══ SUR LE DOMAINE D'UN CLIENT, CE FICHIER CHANGE ═══
 *
 * Un domaine personnalisé (« laclassfood.fr ») sert CE fichier-ci. Le
 * commentaire qui tenait ici affirmait que la ligne `Sitemap:`, portant une URL
 * absolue vers snackmanager.fr, « levait l'ambiguïté ». C'était l'inverse : sur
 * le domaine du restaurant, ce fichier annonçait NOTRE plan de site — donc nos
 * pages tarifs et notre blog — à tout moteur qui venait l'y lire.
 *
 * Deux versions sont donc servies, décidées par l'en-tête `Host` :
 *
 *   · plateforme  → règles complètes, et la ligne `Sitemap:` qui est la moitié
 *                   utile du fichier ;
 *   · restaurant  → AUCUN plan de site (le sien n'existe pas encore, et le
 *                   nôtre ne le regarde pas), et les refus réduits aux seules
 *                   surfaces que son domaine sert encore. Depuis le 22/08/2026
 *                   le proxy y ferme déjà `/admin`, `/sm` et `/board` en amont :
 *                   les répéter ici laisserait croire que ces adresses existent
 *                   sur son domaine.
 *
 * Lire l'en-tête bascule cette route en rendu dynamique. C'est le prix, et il
 * est juste : un `robots.txt` mis en cache à la construction ne PEUT pas dire
 * deux choses différentes selon le domaine qui le demande.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { headers } = await import("next/headers");
  const hote = (await headers()).get("host") ?? "";
  const domainePlateforme = new URL(SITE_URL).host.replace(/^www\./, "");
  const surLaPlateforme =
    hote.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "") === domainePlateforme ||
    // Les hôtes de développement et de prévisualisation servent la plateforme.
    /localhost|127\.0\.0\.1|\.up\.railway\.app$|\.vercel\.app$/.test(hote);

  if (!surLaPlateforme) {
    return {
      rules: { userAgent: "*", allow: "/" },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/", // back-office du restaurateur
        "/sm/", // notre console interne (CRM, facturation, signaux)
        "/board/", // écran de salle — s'appaire, ne se lit pas
        "/api/", // routes serveur, aucune n'a de contenu
      ],
    },
    sitemap: urlAbsolue("/sitemap.xml"),
  };
}
