import {
  LoyaltyCustomerCardSchema,
  type LoyaltyCustomerCard,
} from "@sm/contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'INSTANTANÉ LOCAL DE LA CARTE — hors ligne, et lien avec la vitrine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ CE QUE CE FICHIER RÈGLE ═══
 *
 * 1. HORS LIGNE, LE SOLDE N'ÉTAIT JAMAIS CONSULTABLE. Le service worker sert
 *    bien la coquille de l'application installée, mais l'appel de session
 *    échoue et le client tombe sur l'état vide plus un bandeau d'erreur — dans
 *    une application qu'il a lui-même posée sur son écran d'accueil. Un
 *    instantané du DERNIER état connu, daté et annoncé comme tel, vaut
 *    infiniment mieux qu'un écran qui prétend qu'il n'y a pas de carte.
 *
 * 2. LA VITRINE NE SAVAIT PAS QU'UNE CARTE EXISTAIT. Le cookie de session est
 *    limité au chemin `/r/<slug>/fidelite` : la page `/r/<slug>` ne le reçoit
 *    pas, donc son composant serveur ne peut rien en dire. `localStorage`, lui,
 *    est porté par l'ORIGINE et non par un chemin : la vitrine lit le même
 *    instantané, sans qu'aucun secret n'ait à voyager plus loin qu'aujourd'hui.
 *
 * ═══ CE QU'IL Y A DEDANS, ET CE QU'IL N'Y A PAS ═══
 *
 * Le secret QR de 43 caractères N'Y EST PAS, et ne doit jamais y entrer. Il
 * reste dans son cookie `HttpOnly` — hors de portée du JavaScript, aujourd'hui
 * comme demain. Ce qui est stocké ici est EXACTEMENT ce que la page affiche
 * déjà à l'écran : un prénom d'usage, un solde, un catalogue public et vingt
 * lignes d'historique. Aucune de ces données n'ouvre quoi que ce soit — elles
 * ne sont qu'une copie de l'affichage, pas une clé.
 *
 * Elles restent néanmoins des données personnelles : « Retirer la carte de cet
 * appareil » les efface, au même titre que le cookie, et c'est la raison pour
 * laquelle `oublier()` est appelé AVANT la requête de suppression et non après
 * — un réseau coupé ne doit pas laisser l'instantané derrière lui.
 */

/** Un instantané expiré n'est plus affichable : deux semaines, puis oubli. */
export const DUREE_DE_VIE_INSTANTANE_MS = 14 * 24 * 60 * 60 * 1_000;

export type InstantaneCarte = {
  carte: LoyaltyCustomerCard;
  /** Date ISO de la RÉPONSE serveur qui a produit cet instantané. */
  vuA: string;
};

/**
 * Une clé par restaurant. Le préfixe `sm_fidelite_` dit le produit ET le
 * domaine : un même navigateur peut porter les cartes de plusieurs snacks, et
 * l'origine est partagée par toutes les vitrines de la plateforme.
 */
export function cleInstantane(slug: string): string {
  return `sm_fidelite_${slug}`;
}

/**
 * Le contrôleur de forme, séparé du stockage pour être PROUVABLE sans
 * navigateur.
 *
 * Le contenu de `localStorage` est une entrée non fiable comme une autre :
 * l'utilisateur peut l'écrire, une ancienne version du produit a pu y laisser
 * une autre forme, et une extension peut y toucher. On le repasse donc par le
 * schéma du contrat — le même que la réponse réseau. Un instantané douteux
 * n'est pas réparé : il est ignoré, et l'application repart du réseau.
 */
export function analyserInstantane(
  brut: string | null,
  maintenant = Date.now(),
): InstantaneCarte | null {
  if (!brut) return null;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof lu !== "object" || lu === null) return null;
  const { carte, vuA } = lu as { carte?: unknown; vuA?: unknown };
  if (typeof vuA !== "string") return null;
  const horodatage = Date.parse(vuA);
  if (!Number.isFinite(horodatage)) return null;
  if (maintenant - horodatage > DUREE_DE_VIE_INSTANTANE_MS) return null;
  // Un instantané daté du futur vient d'une horloge déréglée : on le garde
  // plutôt que de perdre la carte, mais sa fraîcheur sera dite « à l'instant ».
  const verdict = LoyaltyCustomerCardSchema.safeParse(carte);
  if (!verdict.success) return null;
  return { carte: verdict.data, vuA };
}

/**
 * L'accès au stockage, TOUJOURS sous garde.
 *
 * `localStorage` lève — il ne rend pas `null` — en navigation privée Safari,
 * sous une politique d'entreprise, ou quand le quota est plein. Une carte de
 * fidélité ne peut pas tomber en panne parce qu'un navigateur refuse d'écrire
 * une commodité : chaque accès échoue en silence et l'application continue sur
 * le réseau, exactement comme avant l'existence de ce fichier.
 */
function stockage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function lireInstantane(slug: string): InstantaneCarte | null {
  const magasin = stockage();
  if (!magasin) return null;
  try {
    const instantane = analyserInstantane(magasin.getItem(cleInstantane(slug)));
    if (!instantane) magasin.removeItem(cleInstantane(slug));
    return instantane;
  } catch {
    return null;
  }
}

export function ecrireInstantane(slug: string, carte: LoyaltyCustomerCard): void {
  const magasin = stockage();
  if (!magasin) return;
  try {
    const charge: InstantaneCarte = { carte, vuA: new Date().toISOString() };
    magasin.setItem(cleInstantane(slug), JSON.stringify(charge));
  } catch {
    // Quota atteint ou écriture refusée : l'application reste entièrement
    // fonctionnelle en ligne, elle perd seulement sa consultation hors ligne.
  }
}

export function oublierInstantane(slug: string): void {
  const magasin = stockage();
  if (!magasin) return;
  try {
    magasin.removeItem(cleInstantane(slug));
  } catch {
    // Rien à rattraper : l'appelant efface déjà le cookie, qui est le seul
    // élément porteur de droit.
  }
}

/**
 * LA FRAÎCHEUR, DITE HONNÊTEMENT.
 *
 * « Actualisée à 14 h 32 » était affiché même quand la valeur venait d'un
 * cache : la carte affirmait une heure qui ne voulait rien dire. Trois
 * registres, et le premier est le plus important — en dessous d'une minute, on
 * ne dit pas une heure, on dit « à l'instant ».
 */
export function fraicheur(vuA: string, maintenant = Date.now()): string {
  const horodatage = Date.parse(vuA);
  if (!Number.isFinite(horodatage)) return "date inconnue";
  const ecart = maintenant - horodatage;
  if (ecart < 60_000) return "à l'instant";
  const minutes = Math.floor(ecart / 60_000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(ecart / 3_600_000);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(ecart / 86_400_000);
  return jours === 1 ? "hier" : `il y a ${jours} jours`;
}
