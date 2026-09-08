import { LOYALTY_SLUG_PATTERN } from "./card-session/session-cookie";

/**
 * OÙ RENVOYER QUELQU'UN DONT LA CARTE N'EXISTE PAS.
 *
 * `not-found.tsx` ne reçoit aucun `params` : le slug ne peut venir que du
 * CHEMIN demandé. Cette fonction est la seule chose à prouver dans ce
 * parcours, et elle l'est ici, sans navigateur — la page, elle, n'est plus
 * qu'un lien autour de son résultat.
 *
 * Le slug est repassé par le MÊME motif que celui des routes de session
 * (`LOYALTY_SLUG_PATTERN`) et non simplement réinjecté : un chemin est une
 * entrée utilisateur, et un lien construit sans contrôle depuis une adresse
 * est exactement la forme d'une redirection ouverte. Ce qui ne correspond pas
 * retombe sur l'accueil — le seul repli qui ne mène nulle part de faux.
 */
export function retourDepuisCheminFidelite(
  chemin: string | null,
): { href: string; libelle: string } {
  /*
   * Découpage STRICT, sans `filter(Boolean)` : sur `/r//fidelite`, écarter le
   * segment vide décalait la lecture et prenait « fidelite » pour le slug. La
   * forme attendue est exactement `/r/<slug>/fidelite[/…]`, et rien d'autre
   * n'est un chemin de carte.
   */
  const segments = (chemin ?? "").split("/");
  const slug = segments[1] === "r" && segments[3] === "fidelite" ? segments[2] : undefined;
  if (!slug || !LOYALTY_SLUG_PATTERN.test(slug)) {
    return { href: "/", libelle: "Retour à l’accueil" };
  }
  return {
    href: `/r/${encodeURIComponent(slug)}`,
    libelle: "Voir le menu du restaurant",
  };
}
