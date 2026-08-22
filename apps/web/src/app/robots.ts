import type { MetadataRoute } from "next";
import { urlAbsolue } from "@/lib/site";

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
 * ═══ UNE PARTICULARITÉ DES DOMAINES CLIENTS ═══
 *
 * Un domaine personnalisé (« laclassfood.fr ») est réécrit vers `/r/[slug]` par
 * `src/proxy.ts`, et sert donc CE fichier-ci. La ligne `Sitemap:` porte une URL
 * absolue vers snackmanager.fr, ce qui lève l'ambiguïté ; et le proxy ne
 * réécrit que la racine, jamais un chemin — les règles ci-dessous ne peuvent
 * donc bloquer aucune page du restaurateur.
 */
export default function robots(): MetadataRoute.Robots {
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
