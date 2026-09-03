import { LoyaltyCustomerCardSchema } from "@sm/contracts";

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
 * reste dans son cookie `HttpOnly` — hors de portée du JavaScript. La v2 ne
 * garde que trois faits : sa version, le solde et l'heure de la réponse. Ni
 * prénom, ni historique, ni catalogue, ni récompense ne sont persistés.
 *
 * Elles restent néanmoins des données personnelles : « Retirer la carte de cet
 * appareil » les efface, au même titre que le cookie, et c'est la raison pour
 * laquelle `oublier()` est appelé AVANT la requête de suppression et non après
 * — un réseau coupé ne doit pas laisser l'instantané derrière lui.
 */

/** Un instantané expiré n'est plus affichable et sera effacé à sa prochaine lecture. */
export const DUREE_DE_VIE_INSTANTANE_MS = 14 * 24 * 60 * 60 * 1_000;

/** Une petite dérive d'horloge est tolérée ; au-delà, la date n'est plus crédible. */
export const TOLERANCE_FUTUR_INSTANTANE_MS = 5 * 60 * 1_000;

export type InstantaneCarte = {
  version: 2;
  solde: number;
  /** Date ISO de la RÉPONSE serveur qui a produit cet instantané. */
  vuA: string;
};

export type LectureInstantane =
  | { etat: "valide"; instantane: InstantaneCarte }
  | { etat: "expire" | "absent" | "invalide"; instantane: null };

export type StockageInstantanes = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
 * une autre forme, et une extension peut y toucher. L'ancienne charge complète
 * `{ carte, vuA }` n'est acceptée que si la carte passe encore le contrat ; son
 * seul solde est alors extrait. L'accès au stockage la réécrit immédiatement
 * en v2 minimale.
 */
export function analyserInstantane(
  brut: string | null,
  maintenant = Date.now(),
): InstantaneCarte | null {
  const diagnostic = diagnostiquerInstantane(brut, maintenant);
  return diagnostic.etat === "valide" ? diagnostic.instantane : null;
}

function diagnostiquerInstantane(
  brut: string | null,
  maintenant: number,
): LectureInstantane {
  if (!brut) return { etat: "absent", instantane: null };
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return { etat: "invalide", instantane: null };
  }
  if (typeof lu !== "object" || lu === null) {
    return { etat: "invalide", instantane: null };
  }
  const charge = lu as {
    version?: unknown;
    solde?: unknown;
    vuA?: unknown;
    carte?: unknown;
  };
  const { vuA } = charge;
  if (typeof vuA !== "string") return { etat: "invalide", instantane: null };
  const horodatage = Date.parse(vuA);
  if (!Number.isFinite(horodatage) || !Number.isFinite(maintenant)) {
    return { etat: "invalide", instantane: null };
  }

  let solde: unknown;
  if (charge.version === 2) {
    if (Object.keys(charge).sort().join(",") !== "solde,version,vuA") {
      return { etat: "invalide", instantane: null };
    }
    solde = charge.solde;
  } else if (charge.version === undefined) {
    if (Object.keys(charge).sort().join(",") !== "carte,vuA") {
      return { etat: "invalide", instantane: null };
    }
    const ancienneCarte = LoyaltyCustomerCardSchema.safeParse(charge.carte);
    if (!ancienneCarte.success) return { etat: "invalide", instantane: null };
    solde = ancienneCarte.data.member.balanceUnits;
  } else {
    return { etat: "invalide", instantane: null };
  }
  if (!Number.isSafeInteger(solde) || (solde as number) < 0) {
    return { etat: "invalide", instantane: null };
  }

  if (horodatage - maintenant > TOLERANCE_FUTUR_INSTANTANE_MS) {
    return { etat: "invalide", instantane: null };
  }
  if (maintenant - horodatage > DUREE_DE_VIE_INSTANTANE_MS) {
    return { etat: "expire", instantane: null };
  }
  return {
    etat: "valide",
    instantane: { version: 2, solde: solde as number, vuA },
  };
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
  return lireEtatInstantane(slug).instantane;
}

export function lireEtatInstantane(slug: string): LectureInstantane {
  const magasin = stockage();
  if (!magasin) return { etat: "absent", instantane: null };
  return lireEtatInstantaneDepuisStockage(magasin, slug);
}

/** Exportée pour prouver migration et purge sans simuler tout le navigateur. */
export function lireInstantaneDepuisStockage(
  magasin: StockageInstantanes,
  slug: string,
  maintenant = Date.now(),
): InstantaneCarte | null {
  return lireEtatInstantaneDepuisStockage(magasin, slug, maintenant).instantane;
}

export function lireEtatInstantaneDepuisStockage(
  magasin: StockageInstantanes,
  slug: string,
  maintenant = Date.now(),
): LectureInstantane {
  const cle = cleInstantane(slug);
  try {
    const brut = magasin.getItem(cle);
    const lecture = diagnostiquerInstantane(brut, maintenant);
    if (lecture.etat !== "valide") {
      if (brut !== null) magasin.removeItem(cle);
      return lecture;
    }

    // Une ancienne charge perd ses champs détaillés avant que le lecteur ne
    // rende la main ; une v2 valide est remise dans l'ordre canonique.
    const minimal = JSON.stringify(lecture.instantane);
    if (brut !== minimal) {
      try {
        magasin.setItem(cle, minimal);
      } catch {
        // Une migration qui ne peut pas remplacer l'ancienne carte complète
        // préfère perdre le repli plutôt que conserver ses données détaillées.
        magasin.removeItem(cle);
        return { etat: "invalide", instantane: null };
      }
    }
    return lecture;
  } catch {
    return { etat: "invalide", instantane: null };
  }
}

export function ecrireInstantane(
  slug: string,
  solde: number,
  maintenant = Date.now(),
): InstantaneCarte {
  const magasin = stockage();
  if (!magasin) return creerInstantane(solde, maintenant);
  return ecrireInstantaneDansStockage(magasin, slug, solde, maintenant);
}

function creerInstantane(solde: number, maintenant: number): InstantaneCarte {
  if (!Number.isSafeInteger(solde) || solde < 0) {
    throw new Error("Solde fidélité local invalide");
  }
  return {
    version: 2,
    solde,
    vuA: new Date(maintenant).toISOString(),
  };
}

/** Exportée pour vérifier que l'écriture physique reste strictement minimale. */
export function ecrireInstantaneDansStockage(
  magasin: StockageInstantanes,
  slug: string,
  solde: number,
  maintenant = Date.now(),
): InstantaneCarte {
  const charge = creerInstantane(solde, maintenant);
  try {
    magasin.setItem(cleInstantane(slug), JSON.stringify(charge));
  } catch {
    // Quota atteint ou écriture refusée : l'application reste entièrement
    // fonctionnelle en ligne, elle perd seulement sa consultation hors ligne.
  }
  return charge;
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
  if (ecart < 0) return "à l'instant (horloge décalée)";
  if (ecart < 60_000) return "à l'instant";
  const minutes = Math.floor(ecart / 60_000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(ecart / 3_600_000);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(ecart / 86_400_000);
  return jours === 1 ? "hier" : `il y a ${jours} jours`;
}
