import type { NextConfig } from "next";

/**
 * LES PHOTOS DE LA CARTE DOIVENT SURVIVRE À LA PERTE DE RÉSEAU.
 *
 * Les visuels hérités du pilote sont servis depuis `public/photos/`, que Next
 * rend par défaut en `max-age=0` : le navigateur les revalide à chaque
 * affichage. Sur la caisse, qui travaille hors ligne, cette revalidation
 * échoue et la vignette retombe sur son monogramme — alors que les octets
 * étaient là, dans le cache disque, à ne demander qu'à servir.
 *
 * Un an et `immutable` sont honnêtes ici : le nom d'un fichier de `public/`
 * ne change pas sans que son contenu change, puisque c'est un fichier
 * versionné dans le dépôt. C'est la même promesse que celle de la route qui
 * sert les médias déposés, où l'empreinte du contenu est DANS l'adresse.
 *
 * Rien d'autre n'est mis en cache ici : le reste de `public/` porte des noms
 * qu'on remplace parfois sans les renommer, et un an de cache sur une icône
 * remplacée serait un an d'icône fausse.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/photos/:fichier*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
