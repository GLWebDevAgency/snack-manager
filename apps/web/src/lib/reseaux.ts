import { RESEAUX, type ReseauPublié } from "@/components/marketing/content";

/**
 * LES RÉSEAUX SOCIAUX, LUS DEPUIS LE BACK-OFFICE — côté serveur uniquement.
 *
 * ═══ POURQUOI CE MODULE EXISTE ═══
 *
 * `RESEAUX_PUBLIÉS` (content.ts) filtrait une table écrite EN DUR, à la portée
 * du module — donc à la compilation. Pour ajouter un compte, il fallait un
 * déploiement. Les adresses vivent maintenant en base, saisies dans `/sm/reseaux`,
 * et une constante de module ne peut pas dépendre d'un appel réseau : d'où cette
 * fonction, appelée par chaque page serveur qui rend la rangée.
 *
 * ═══ LA RÈGLE QUI PRIME SUR TOUTES LES AUTRES ═══
 *
 * UNE PAGE D'ACCUEIL NE TOMBE PAS PARCE QU'UN RÉGLAGE EST INJOIGNABLE. API
 * éteinte, base en maintenance, réponse malformée, délai dépassé : on rend la
 * liste VIDE, c'est-à-dire exactement l'état d'aujourd'hui — pas de rangée, pas
 * de filet orphelin, rien. Un réseau social absent est invisible ; une vitrine
 * en erreur se voit de loin.
 *
 * C'est aussi pourquoi rien n'est journalisé en cas d'échec au-delà d'une trace
 * de développement : quatre pages appellent cette fonction, une API muette
 * remplirait les journaux de production sans rien apprendre à personne.
 *
 * ═══ LE LIBELLÉ NE VIENT PAS DE LA BASE ═══
 *
 * L'API ne rend que les URL. Le nom affiché (« Instagram », « TikTok ») et
 * l'ORDRE restent dans `RESEAUX`, côté vitrine : ce sont des décisions
 * éditoriales, pas des données. On croise donc les deux — la table donne la
 * forme, la base donne le contenu — ce qui a un effet utile au passage : une
 * clé inconnue renvoyée par l'API est ignorée sans qu'on ait à la filtrer.
 */

/** Ce que rend `GET /public/platform/social` : les quatre clés, `null` compris. */
type Reponse = Partial<Record<string, unknown>>;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Une minute de cache.
 *
 * Le compromis est simple : ces adresses changent quelques fois par an, mais
 * quand le fondateur vient d'en saisir une, il va vérifier la vitrine dans la
 * minute. Une heure de cache le laisserait douter d'avoir enregistré ; aucun
 * cache ferait un aller-retour vers l'API à chaque visite de la page d'accueil,
 * pour une donnée qui ne bouge pas.
 */
const REVALIDATION_S = 60;

/** Le délai au-delà duquel on renonce — la page ne l'attend pas. */
const DELAI_MS = 2500;

export async function lireReseaux(): Promise<readonly ReseauPublié[]> {
  let brut: Reponse;
  try {
    const res = await fetch(`${API_URL}/public/platform/social`, {
      next: { revalidate: REVALIDATION_S },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!res.ok) return [];
    brut = (await res.json()) as Reponse;
    if (brut === null || typeof brut !== "object") return [];
  } catch {
    // Réseau, délai, JSON illisible : voir l'en-tête. La vitrine continue.
    return [];
  }

  return RESEAUX.flatMap((reseau) => {
    const url = brut[reseau.id];
    // Le contrat garantit `null` ou une URL valide, jamais une chaîne vide —
    // mais cette fonction lit une réponse HTTP, pas une valeur typée. On revérifie
    // ici parce qu'un `""` qui passerait produirait un pictogramme cliquable
    // menant nulle part, soit le défaut exact qu'on cherche à rendre impossible.
    if (typeof url !== "string" || url.trim() === "") return [];
    return [{ ...reseau, url }];
  });
}
