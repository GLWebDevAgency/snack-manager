import type { OrderNumber } from '../ordering/order-number';
import type { OrderStatus } from '../ordering/order-status';
import type { TenantSlug } from '../tenancy/public-domain';

/**
 * PORT — prévenir le client que c'est prêt.
 *
 * Le port existe AVANT l'adaptateur, volontairement. Le besoin, lui, est déjà
 * là : un client qui commande à 19h10 pour 19h30 ne reste pas planté devant la
 * vitrine, il va faire ses courses — et revient trop tard ou trop tôt. Tant que
 * personne ne l'a prévenu, c'est le comptoir qui absorbe l'attente.
 *
 * Déclarer le port maintenant garde la règle « on prévient au passage à prête »
 * dans le domaine, testable avec un notifieur factice, le jour où l'on branchera
 * un envoyeur de SMS. L'inverse — attendre l'adaptateur — finit toujours par
 * coller la règle dans le service d'envoi.
 */

/**
 * Canal d'envoi. Le SMS n'est pas un luxe ici : le client d'un snack donne son
 * numéro, pas son adresse mail, et il ne garde pas l'onglet de suivi ouvert.
 */
export type NotificationChannel = 'sms' | 'email' | 'push';

export interface CustomerContact {
  readonly name: string;
  /** Format libre : la normalisation E.164 est l'affaire de l'adaptateur. */
  readonly phone: string | null;
  readonly email: string | null;
}

/** Ce qu'il y a à dire au client — le texte, lui, appartient à l'adaptateur. */
export interface CustomerNotification {
  readonly tenant: TenantSlug;
  readonly restaurantName: string;
  readonly orderNumber: OrderNumber;
  readonly status: OrderStatus;
  readonly customer: CustomerContact;
  /** Heure murale du retrait, « 19:30 ». */
  readonly pickupTime: string | null;
  /** Page de suivi publique, à glisser dans le message. */
  readonly trackingUrl: string | null;
}

/**
 * Un envoi raté ne remet jamais la commande en cause : numéro erroné, crédit
 * épuisé chez l'opérateur, client sur liste rouge. On le constate, on le
 * journalise, le comptoir prend le relais à la voix.
 */
export type NotificationResult =
  | { readonly sent: true; readonly channel: NotificationChannel; readonly providerId: string }
  | { readonly sent: false; readonly reason: string };

/**
 * ⚠ AUCUN ADAPTATEUR N'EXISTE ENCORE (constaté le 28/08/2026).
 *
 * Ce port est déclaré, documenté, et n'a jamais été branché : `notifyCustomer`
 * n'a aucune implémentation dans le dépôt, et aucun appelant. Le tunnel de
 * commande promettait pourtant au client « vous êtes prévenu par SMS dès que
 * c'est prêt » — une promesse que rien ne tenait, et qui faisait attendre un
 * message qui ne partirait jamais. Les deux écrans disent désormais ce qui
 * existe vraiment : la page de suivi.
 *
 * Le jour où un adaptateur sera écrit, ce sont ces deux libellés
 * (`Checkout.tsx`, écran des coordonnées et écran de confirmation) qu'il faudra
 * remettre à la promesse.
 */
export interface Notifier {
  /** Nom lisible de l'implémentation (journalisation, écran d'administration). */
  readonly providerName: string;

  notifyCustomer(
    order: CustomerNotification,
    channel: NotificationChannel,
  ): Promise<NotificationResult>;
}
