"use client";

/**
 * QUI EST DEVANT L'ÉCRAN — lu sur le jeton, sans appel réseau.
 *
 * Le back-office `/admin` sert quatre rôles très différents sur le même URL :
 * le propriétaire, son gérant, la caisse et la cuisine. Le rôle est déjà dans
 * le jeton depuis toujours — l'API le pose à la connexion et le relit à chaque
 * requête — mais aucune surface du restaurateur ne le lisait. La barre de
 * navigation affichait donc les mêmes entrées à tout le monde : une session
 * ouverte au code sur la tablette du comptoir voyait « Encaissement en ligne »,
 * cliquait, et recevait un 403 de la route qui porte `@Roles('owner')`.
 *
 * CE N'EST PAS LA SÉCURITÉ, et il faut le dire ici pour que personne ne s'y
 * trompe : la garde qui compte est `@Roles(...)` côté API, qui refuse quoi
 * qu'affiche le navigateur. Un jeton se lit, se recopie et se fabrique — ce
 * fichier ne décide de RIEN, il évite seulement de proposer à quelqu'un une
 * porte qu'on lui fermera au nez.
 *
 * Le précédent est `app/sm/crm.ts`, qui fait le même geste pour la surface de
 * l'équipe Snack Manager (`sm_admin`). Il n'est pas partagé avec celui-ci pour
 * deux raisons : les deux surfaces ont leur propre emplacement de jeton (cf.
 * `TOKEN_KEYS` dans `lib/api.ts`), et importer le client du CRM depuis
 * `/admin` ferait entrer tout le back-office interne dans le paquet du
 * restaurateur pour trois lignes de décodage.
 *
 * EN DÉMONSTRATION (`?demo=1`), `getToken()` rend `null` — délibérément, cf.
 * `lib/api.ts`. Ces fonctions rendent donc `null` elles aussi : l'appelant qui
 * s'en sert pour peindre une barre de navigation doit décider ce que voit le
 * visiteur, et le masquer entièrement serait montrer un logiciel vide à qui
 * vient le regarder.
 */

import { getToken } from "@/lib/api";

/**
 * Les quatre rôles qui entrent dans `/admin`.
 *
 * `sm_admin` n'en fait PAS partie : c'est l'équipe Snack Manager, elle
 * travaille sur `/sm`, et son jeton dort dans un autre emplacement. Un jeton
 * d'équipe présenté ici n'est pas une session de restaurateur — il rend `null`
 * comme n'importe quel autre rôle inconnu.
 */
export const ROLES_ADMIN = ["owner", "gerant", "caisse", "cuisine"] as const;
export type RoleAdmin = (typeof ROLES_ADMIN)[number];

/**
 * COMMENT la session a été ouverte, ce qui n'est pas la même question que
 * « par qui » :
 *
 *  - `user`  : e-mail et mot de passe. C'est le propriétaire, sur son
 *    téléphone ou son ordinateur, chez lui comme au restaurant.
 *  - `staff` : un code à quatre chiffres sur une TABLETTE APPAIRÉE. La
 *    personne est identifiée, l'appareil aussi, et l'écran est posé sur un
 *    comptoir où passent les clients.
 *
 * La distinction se voit à l'écran : ce qu'on affiche volontiers sur le
 * téléphone du patron n'a rien à faire sur une tablette que tout le monde
 * regarde par-dessus l'épaule.
 */
export type GenreDeSession = "user" | "staff";

export type SessionAdmin = { role: RoleAdmin; genre: GenreDeSession };

/** Ce que le jeton porte et qui nous intéresse — le reste ne se lit pas ici. */
type Revendications = { role?: unknown; kind?: unknown; exp?: unknown };

/**
 * La session courante, ou `null` — jamais une exception.
 *
 * `null` couvre TOUS les cas où l'on ne sait pas, et ils arrivent en vrai :
 * pas encore connecté, jeton effacé par un autre onglet, jeton expiré depuis
 * la nuit dernière, jeton d'une autre surface, jeton tronqué par un stockage
 * plein, mode démonstration. Aucun ne doit faire tomber le rendu : une barre
 * de navigation qui plante ferme le back-office entier, alors que ne pas
 * connaître le rôle ne coûte au pire qu'une entrée affichée en trop — que
 * l'API refusera de toute façon.
 *
 * L'expiration est vérifiée ici, et pas seulement au premier 401 : un jeton
 * périmé désigne toujours un rôle, et s'y fier ferait peindre une barre pour
 * une session qui n'existe plus.
 */
export function sessionAdmin(token: string | null = getToken()): SessionAdmin | null {
  const claims = revendications(token);
  if (!claims) return null;

  const role = ROLES_ADMIN.find((r) => r === claims.role);
  if (!role) return null;

  // Le genre est DÉDUIT du rôle quand le jeton ne le porte pas : `owner` est
  // un compte e-mail, les trois autres n'existent que derrière un code sur
  // tablette appairée (`DevicePinLogin`). Les jetons d'avant le champ `kind`
  // se lisent donc comme les autres, plutôt que de se voir refuser une barre.
  const genre: GenreDeSession =
    claims.kind === "user" || claims.kind === "staff"
      ? claims.kind
      : role === "owner"
        ? "user"
        : "staff";

  return { role, genre };
}

/** Le rôle seul, pour l'appelant qui n'a pas besoin du genre de session. */
export const roleAdmin = (token: string | null = getToken()): RoleAdmin | null =>
  sessionAdmin(token)?.role ?? null;

/**
 * Décode la charge utile du JWT — sans vérifier la signature, ce qui serait
 * impossible côté navigateur et inutile : c'est l'API qui la vérifie.
 *
 * Tout est enveloppé : un jeton sans point, une charge utile qui n'est pas du
 * base64url, du base64 qui n'est pas de l'UTF-8, de l'UTF-8 qui n'est pas du
 * JSON, du JSON qui n'est pas un objet. Chacun de ces cas existe dès qu'un
 * stockage local est partagé entre deux applications, et aucun ne justifie un
 * écran blanc.
 */
function revendications(token: string | null): Revendications | null {
  const charge = token?.split(".")[1];
  if (!charge) return null;
  try {
    // base64url → base64, et le remplissage que la norme JWT omet : `atob`
    // refuse une longueur qui n'est pas un multiple de quatre.
    const base64 = charge.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: unknown = JSON.parse(json);
    if (typeof claims !== "object" || claims === null) return null;
    if (expire((claims as Revendications).exp)) return null;
    return claims as Revendications;
  } catch {
    return null;
  }
}

/**
 * `exp` est en SECONDES Unix (norme JWT), pas en millisecondes.
 *
 * Un jeton sans `exp` n'est PAS traité comme expiré : notre API en pose un,
 * mais l'absence de date de fin est une question d'autorité serveur, pas
 * d'affichage — et refuser d'afficher une barre de navigation pour ça
 * n'apporterait rien à personne.
 */
function expire(exp: unknown): boolean {
  return typeof exp === "number" && Number.isFinite(exp) && exp * 1000 <= Date.now();
}
