import type { DeliveryMissionRefusalCode } from "@sm/contracts";

const REFUSALS: Record<DeliveryMissionRefusalCode, string> = {
  "delivery.mission.invalid": "Cette commande ne permet pas cette action. Vérifiez la livraison avec le restaurant.",
  "delivery.mission.closed": "Cette commande est terminée ou annulée. Aucune nouvelle action n’a été appliquée.",
  "delivery.mission.departed": "Le départ est déjà enregistré. L’affectation ne peut plus être modifiée ici.",
  "delivery.mission.unassigned": "Un gérant doit attribuer un accès livreur avant le départ.",
  "delivery.mission.not_ready": "La cuisine n’a pas encore terminé la préparation. Aucun départ n’a été ajouté.",
  "delivery.mission.payment_blocked": "Le paiement doit être confirmé par le restaurant avant le départ. Aucun départ n’a été ajouté.",
  DELIVERY_OPERATOR_CHANGED: "L’accès ou l’affectation du livreur a changé. Vérifiez les accès avec le restaurant avant un nouveau choix.",
};
export function missionRefusalMessage(code: DeliveryMissionRefusalCode): string { return REFUSALS[code]; }
