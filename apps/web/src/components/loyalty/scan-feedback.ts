import type { LoyaltyCustomerCard } from "@sm/contracts";
import { chiffre, unitePour, type Recompense } from "./paliers";

export function loyaltyScanSuccessAnnouncement(
  card: LoyaltyCustomerCard,
  unitSingular: string,
  unitPlural: string,
): string {
  const units = unitePour(card.member.balanceUnits, unitSingular, unitPlural);
  return `Carte de ${card.member.alias} chargée. Solde : ${chiffre(card.member.balanceUnits)} ${units}.`;
}

/**
 * LE MESSAGE VISIBLE APRÈS UNE MISE À JOUR — celui qui n'existait pas.
 *
 * La seule confirmation d'un scan réussi était le DÉMONTAGE du scanner : rien
 * ne disait ce qui venait de changer, et un client qui gagne six points voyait
 * une carte se substituer à une autre sans savoir laquelle des deux était la
 * bonne. Trois registres, du plus fort au plus faible :
 *
 *   1. un palier franchi — c'est l'événement, il passe avant tout ;
 *   2. un gain de solde — le chiffre, avec son signe ;
 *   3. rien de neuf — on le dit aussi, sinon « Actualiser » n'a pas de réponse.
 *
 * Un solde qui BAISSE (une récompense retirée au comptoir) est annoncé comme
 * tel : escamoter un débit ferait douter le client de son propre solde.
 */
export function messageDeMiseAJour(
  delta: number,
  franchis: readonly Recompense[],
  unitSingular: string,
  unitPlural: string,
): string {
  const premier = franchis[0];
  if (premier) {
    return franchis.length === 1
      ? `« ${premier.name} » est à vous !`
      : `${franchis.length} récompenses débloquées !`;
  }
  if (delta > 0) {
    return `+${chiffre(delta)} ${unitePour(delta, unitSingular, unitPlural)}`;
  }
  if (delta < 0) {
    return `−${chiffre(Math.abs(delta))} ${unitePour(delta, unitSingular, unitPlural)}`;
  }
  return "Solde à jour";
}

/**
 * L'ÉCHEC DU QR, NOMMÉ.
 *
 * La modale du QR n'avait ni état de chargement ni état d'échec : la route
 * peut répondre 404 (carte révoquée), 429 (quota de lecture) ou 503
 * (vérification indisponible), et le client voyait l'icône d'image cassée du
 * navigateur dans un cadre blanc — au comptoir, devant la caisse.
 *
 * Chaque statut a une CONDUITE différente : rescanner, attendre, réessayer.
 * Un message unique les confondrait, et c'est précisément le moment où
 * quelqu'un attend derrière.
 */
export function messageDEchecQr(statut: number | null): string {
  if (statut === null) {
    return "Le QR n’a pas pu être chargé : votre appareil semble hors ligne. Reconnectez-vous puis réessayez.";
  }
  if (statut === 404) {
    return "Cette carte n’est plus disponible. Demandez un nouveau QR au restaurant.";
  }
  if (statut === 429) {
    return "Trop de demandes en peu de temps. Patientez un instant puis réessayez.";
  }
  if (statut >= 500) {
    return "Le service fidélité est momentanément indisponible. Réessayez dans un instant.";
  }
  return "Le QR n’a pas pu être affiché. Réessayez.";
}
