/**
 * CE QUE LA SIGNATURE ENVOIE — dérivé, jamais ressaisi.
 *
 * ─── LE DÉFAUT QUE CE MODULE FERME ───
 *
 * Le panneau de conversion pré-remplissait bien ses champs depuis la
 * proposition, mais il en laissait les CONTRÔLES ouverts : formule, engagement,
 * module, services de l'Atelier et place fondateur se rejouaient au moment de
 * signer. Trois conséquences, toutes vues sur staging :
 *
 *  · on redemandait ce qui avait déjà été négocié, imprimé sur un devis PDF et
 *    accepté par le prospect — la modale invitait à le contredire ;
 *  · la place fondateur était offerte DEUX fois, ici et dans le tiroir du
 *    prospect, sur deux états qui pouvaient diverger d'un clic ;
 *  · sans proposition, la formule retombait sur un défaut : signer sans avoir
 *    rien proposé INVENTAIT une offre, et les brouillons de factures s'en
 *    dérivaient aussitôt.
 *
 * Les termes se calculent donc ici, à partir du lead seul. Le panneau les
 * affiche en lecture et les envoie tels quels.
 *
 * ─── POURQUOI UN MODULE À PART ───
 *
 * C'est une DÉCISION commerciale (que signe-t-on, et peut-on signer ?), pas un
 * morceau d'interface : elle se relit et se teste sans monter React, comme les
 * tables de navigation des deux coques. Et le panneau, lui, n'a plus d'état
 * d'offre du tout — donc plus rien à resynchroniser quand la proposition change
 * pendant qu'il est ouvert.
 */

import type { CrmLead, LeadServices, PlanChoice, ProposalBilling } from "@sm/contracts";

/**
 * Les termes signés — exactement les champs d'offre de `LeadConvertSchema`.
 *
 * L'adresse publique, le courriel et le nom du gérant n'en font PAS partie :
 * ils ne viennent pas de la proposition, ils se saisissent à la signature, et
 * ce sont les seuls champs que la modale garde ouverts.
 */
export type TermesSignes = {
  plan: PlanChoice;
  onlineOrdering: boolean;
  billing: ProposalBilling;
  services: LeadServices;
  /**
   * La place fondateur vient du TIROIR du prospect, son seul lieu. Elle se
   * réserve pendant la prospection, elle se relit à la signature — elle ne se
   * décide pas dans la modale qui crée le restaurant.
   */
  founderSeat: boolean;
};

/**
 * Ce que la signature enverra, ou `null` quand il n'y a rien à signer.
 *
 * ─── PAS DE PROPOSITION, PAS DE SIGNATURE ───
 *
 * `null` n'est pas une précaution, c'est la seule réponse vraie : la modale ne
 * porte plus aucun contrôle d'offre, donc sans proposition elle n'a
 * strictement rien à envoyer. Le contrat le refuserait de toute façon —
 * `LeadConvertSchema` rejette une signature sans formule, sans module et sans
 * service (`propositionNonVide`) — mais un « Validation failed » après le clic
 * vaut moins qu'une phrase avant.
 *
 * Et ce n'est PAS la formule qui manque : `plan: null` est parfaitement
 * légitime, un client de l'Atelier seul signe sans logiciel. Ce qui manque,
 * c'est le document qu'on lui a présenté et qu'il a accepté. Signer sans lui
 * ferait naître un client dont l'offre n'existe nulle part — et c'est
 * exactement l'inversion qui a produit ce défaut.
 */
export function termesSignes(
  lead: Pick<CrmLead, "proposal" | "founderSeatReserved">,
): TermesSignes | null {
  const p = lead.proposal;
  if (!p) return null;
  return {
    // Aucun `??` : une proposition sans formule signe sans formule.
    plan: p.plan,
    onlineOrdering: p.onlineOrdering,
    billing: p.billing,
    services: p.services,
    founderSeat: lead.founderSeatReserved,
  };
}
