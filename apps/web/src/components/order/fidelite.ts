import type { LoyaltyCustomerCard, LoyaltyPublicProgram } from "@sm/contracts";
/*
 * Import RELATIF et non `@/…` : ce module est couvert par un test, et le
 * lanceur de tests du dépôt ne résout pas l'alias de chemin de Next.
 */
import { prochainPalier, unitePour } from "../loyalty/paliers";
import { fraicheur } from "../loyalty/carte-locale";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE LA VITRINE SAIT DU PROGRAMME DE FIDÉLITÉ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ POURQUOI LA VITRINE NE SAVAIT RIEN ═══
 *
 * La charge `/site` — celle qui alimente `/r/<slug>` — ne porte AUCUN champ de
 * fidélité : la vitrine ignorait jusqu'à l'existence d'un programme chez le
 * restaurant qu'elle affiche. Le lien n'existait que dans un sens (la carte
 * pointait vers la vitrine), et rien ne ramenait un client vers sa carte.
 *
 * ═══ ET POURQUOI ON N'A PAS TOUCHÉ AU CONTRAT ═══
 *
 * Le catalogue public existe déjà, à sa propre route
 * (`GET /public/tenants/:slug/loyalty`), et il est mémorisé par `cache()` avec
 * une revalidation de 60 s. Le composant SERVEUR de la vitrine peut donc
 * l'appeler en parallèle de `/site` sans rendre la page dynamique, sans
 * l'alourdir d'un champ que quatre autres consommateurs auraient à ignorer, et
 * sans qu'aucun schéma partagé ne bouge.
 *
 * Ce qui traverse ensuite la frontière serveur → client est ce RÉSUMÉ, et pas
 * le catalogue : la vitrine est la page la plus servie du produit, et y pousser
 * une marque complète plus vingt récompenses coûterait des kilo-octets à
 * chaque visiteur pour une bande de deux lignes.
 */

export type VitrineFidelite = {
  /** L'adresse de la carte — calculée une fois, côté serveur. */
  chemin: string;
  programme: string;
  uniteSingulier: string;
  unitePluriel: string;
  /** La récompense la MOINS chère : celle qui donne envie de commencer. */
  premiere: { nom: string; cout: number } | null;
};

/**
 * La récompense d'appel est la moins chère, jamais la première du tableau.
 *
 * L'ordre d'un catalogue est celui de sa saisie : le restaurateur y met souvent
 * son avantage phare — le plus coûteux — en tête. Montrer « menu offert à
 * 300 points » à quelqu'un qui n'a pas encore de carte décourage au lieu
 * d'inviter ; « boisson offerte à 8 points », non.
 */
export function resumeFidelite(
  catalogue: LoyaltyPublicProgram | null,
): VitrineFidelite | null {
  if (!catalogue) return null;
  let moinsChere: LoyaltyPublicProgram["rewards"][number] | null = null;
  for (const recompense of catalogue.rewards) {
    if (!moinsChere || recompense.costUnits < moinsChere.costUnits) {
      moinsChere = recompense;
    }
  }
  return {
    chemin: `/r/${encodeURIComponent(catalogue.restaurant.slug)}/fidelite`,
    programme: catalogue.program.name,
    uniteSingulier: catalogue.program.unitLabelSingular,
    unitePluriel: catalogue.program.unitLabelPlural,
    premiere: moinsChere
      ? { nom: moinsChere.name, cout: moinsChere.costUnits }
      : null,
  };
}

/**
 * LA PROMESSE, EN UNE PHRASE — « ce qu'il gagne ».
 *
 * Un lien « Programme fidélité » sans contenu ne se clique pas : il faut dire
 * l'avantage ET son prix. Sans récompense publiée, on ne promet rien de
 * chiffré — le programme existe, c'est déjà une information.
 */
export function promesseFidelite(resume: VitrineFidelite): string {
  if (!resume.premiere) {
    return "Découvrez les avantages du programme. Carte gratuite, avec votre compte ou un QR existant.";
  }
  const unite = unitePour(
    resume.premiere.cout,
    resume.uniteSingulier,
    resume.unitePluriel,
  );
  return `« ${resume.premiere.nom} » dès ${resume.premiere.cout.toLocaleString("fr-FR")} ${unite}. Carte gratuite, avec votre compte ou un QR existant.`;
}

/** Ce que la bande affiche quand ce navigateur porte déjà une carte ici. */
export type SoldeVitrine = {
  solde: number;
  unite: string;
  /** « Encore 6 points pour « Menu signature » » — ou l'absence de palier. */
  reste: { nom: string; manque: number } | null;
};

export function soldeVitrine(carte: LoyaltyCustomerCard): SoldeVitrine {
  const palier = prochainPalier(carte.rewards, carte.member.balanceUnits);
  return {
    solde: carte.member.balanceUnits,
    unite: unitePour(
      carte.member.balanceUnits,
      carte.program.unitLabelSingular,
      carte.program.unitLabelPlural,
    ),
    reste: palier
      ? { nom: palier.name, manque: palier.costUnits - carte.member.balanceUnits }
      : null,
  };
}

export type EtatSoldeVitrine =
  | (SoldeVitrine & {
      source: "reseau";
      vuA: string;
    })
  | {
      source: "cache";
      solde: number;
      unite: string;
      vuA: string;
      rafraichissement: "en-cours" | "echec";
    };

export function soldeVitrineDepuisReseau(
  carte: LoyaltyCustomerCard,
  vuA: string,
): EtatSoldeVitrine {
  return { source: "reseau", vuA, ...soldeVitrine(carte) };
}

/**
 * Un cache minimal ne connaît ni le catalogue complet ni son ordre courant.
 * Il n'a donc volontairement aucun champ `reste` à interpréter comme un palier.
 */
export function soldeVitrineDepuisCache(
  solde: number,
  uniteSingulier: string,
  unitePluriel: string,
  vuA: string,
  rafraichissement: "en-cours" | "echec" = "en-cours",
): EtatSoldeVitrine {
  return {
    source: "cache",
    solde,
    unite: unitePour(solde, uniteSingulier, unitePluriel),
    vuA,
    rafraichissement,
  };
}

export function detailSoldeVitrine(
  etat: EtatSoldeVitrine,
  resume: VitrineFidelite,
): string {
  if (etat.source === "cache") {
    return "Ouvrez votre carte pour consulter les récompenses à jour.";
  }
  if (!etat.reste) return "Vous atteignez tous les paliers publiés.";
  const unite = unitePour(
    etat.reste.manque,
    resume.uniteSingulier,
    resume.unitePluriel,
  );
  return `Encore ${etat.reste.manque.toLocaleString("fr-FR")} ${unite} pour « ${etat.reste.nom} »`;
}

export function provenanceSoldeVitrine(
  etat: EtatSoldeVitrine,
  maintenant = Date.now(),
): string {
  const age = fraicheur(etat.vuA, maintenant);
  if (etat.source === "reseau") {
    return `Source : réseau · vérifié ${age}`;
  }
  return etat.rafraichissement === "echec"
    ? `Source : copie locale · solde vu ${age} · échec du rafraîchissement`
    : `Source : copie locale · solde vu ${age} · vérification en cours`;
}

export const CONSEIL_FIDELITE_APRES_COMMANDE =
  "Retrouvez votre carte, les récompenses et votre solde dans l’espace fidélité du restaurant. Le solde affiché reste celui confirmé par le programme ; ouvrir une carte ne rattache pas rétroactivement cette commande.";
