import type { Money } from '../shared/money';

/**
 * PORT — sortir un ticket papier.
 *
 * Le ticket est décrit ICI, dans le domaine, et pas dans l'adaptateur ESC/POS,
 * pour une raison très concrète : ce qui doit figurer sur un ticket n'est pas
 * une question d'imprimante, c'est une question de loi et de comptoir. NF525
 * impose la ligne annulée qui reste visible avec son motif ; le comptoir impose
 * le numéro de retrait en gros et le « sans oignons » lisible depuis le plan de
 * travail. Une imprimante 58 mm, une imprimante 80 mm, un PDF envoyé par mail ou
 * un écran de secours doivent tous rendre CES informations-là.
 *
 * L'adaptateur, lui, ne décide que de la mise en page et des octets.
 */

/**
 * Comment le client récupère sa commande.
 * Ce n'est pas cosmétique : « Sur place » n'imprime pas de numéro d'appel,
 * « Retrait » imprime une heure, et la cuisine ne priorise pas pareil.
 */
export type PickupMode = 'dine_in' | 'takeaway' | 'scheduled_pickup';

/**
 * Deux tickets pour une même commande.
 * Le bon cuisine ne porte AUCUN prix : un cuisinier qui lit un total se met à
 * arbitrer ce qu'il prépare en premier selon le montant, ce que personne ne lui
 * a demandé — et le client qui regarde par-dessus le comptoir voit une remise
 * qu'on ne voulait pas lui montrer.
 */
export type TicketKind = 'customer' | 'kitchen';

export interface TicketHeader {
  readonly restaurantName: string;
  readonly address: string | null;
  readonly phone: string | null;
  /** Mentions de pied de ticket (TVA, remerciements, code de suivi). */
  readonly footer: string | null;
}

export interface TicketLine {
  readonly quantity: number;
  /** « Tacos XXL » — produit et format déjà réunis. */
  readonly label: string;
  /** Choix retenus : « Kebab », « Kefta », « Sauce algérienne ». */
  readonly options: readonly string[];
  /** Retraits, imprimés au même rang que les options : « sans oignons ». */
  readonly removals: readonly string[];
  /** Consigne libre du client (« bien cuit »). */
  readonly note: string | null;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
  /**
   * Motif d'annulation si la ligne a été retirée.
   * Elle reste imprimée, barrée : la faire disparaître transformerait une
   * annulation tracée en écart de caisse inexpliqué.
   */
  readonly cancellation: string | null;
}

export interface TicketTotals {
  readonly subtotal: Money;
  readonly discount: { readonly amount: Money; readonly reason: string } | null;
  readonly total: Money;
  /** Déjà réglé ? La caisse doit savoir si elle réclame quelque chose. */
  readonly paid: boolean;
  /** « Payé en ligne » / « À régler au comptoir ». */
  readonly paymentLabel: string;
}

/** Tout ce qu'un ticket doit porter, quelle que soit l'imprimante. */
export interface PrintableTicket {
  readonly kind: TicketKind;
  readonly header: TicketHeader;
  /** « 042 » — trois chiffres, lisibles de loin (cf. `OrderNumber.format`). */
  readonly pickupNumber: string;
  readonly pickupMode: PickupMode;
  /** Heure murale du créneau, « 19:30 ». `null` hors retrait programmé. */
  readonly pickupTime: string | null;
  readonly customerName: string | null;
  readonly placedAt: Date;
  /** Lignes ANNULÉES COMPRISES — voir `TicketLine.cancellation`. */
  readonly lines: readonly TicketLine[];
  readonly totals: TicketTotals;
  /** Consigne portant sur la commande entière. */
  readonly note: string | null;
}

/**
 * Une impression rate tout le temps, et ce n'est presque jamais un bug : rouleau
 * fini, imprimante débranchée par le ménage, Wi-Fi de la cuisine coupé. On
 * renvoie donc l'échec au lieu de lever — la commande, elle, est bien prise.
 * `retryable` distingue « remets du papier et rappuie » de « cette imprimante
 * n'existe plus dans la configuration ».
 */
export type PrintResult =
  | { readonly printed: true }
  | { readonly printed: false; readonly reason: string; readonly retryable: boolean };

export interface TicketPrinter {
  /** Nom lisible de l'implémentation (journalisation, écran d'administration). */
  readonly providerName: string;

  print(ticket: PrintableTicket): Promise<PrintResult>;
}
