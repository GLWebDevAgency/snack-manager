/**
 * CE QUI SE PASSE EN CUISINE APRÈS QU'ON A VALIDÉ — la logique, sans écran.
 *
 * Jusqu'ici, une commande validée à la caisse ne laissait AUCUNE trace visible.
 * « Nouvelle commande » la faisait disparaître ; elle ne reparaissait que dans
 * un compteur qui ne comptait que ce poste, et dans son journal local, sans
 * statut cuisine ni minuteur. Le caissier ne pouvait répondre
 * ni à « c'est prêt ? », ni à « ça fait combien de temps ? ».
 *
 * Tout était pourtant déjà là : `GET /orders` répond SANS projection — chaque
 * ligne porte `status`, `statusHistory[]`, `lines`, `totals`, `payment`,
 * `pickup`, `createdAt`. La caisse n'en typait que sept champs et ne lisait
 * `status` qu'une fois, pour un ancien récapitulatif serveur.
 *
 * Ce module est PUR (aucun import react-native) — c'est ce qui le rend
 * testable par le harnais vitest du poste, comme `layout.ts` et `pos-state.ts`.
 */
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  REMISE_PLAFOND_CENTS,
  STAFF_ROLES,
  plafondRemiseLabel,
  type PaymentTender,
  type StaffRole,
  type OrderDelivery,
  type OrderDining,
} from '@sm/contracts';
import {
  type OrderChannel,
  type OrderLine,
  type OrderStatus,
  type OrderType,
} from '@sm/client-core';
/**
 * Une ligne de `GET /orders`, telle qu'elle sert VRAIMENT au poste.
 *
 * Tout est facultatif au-delà de l'identité : une réponse d'une API plus
 * ancienne, ou une commande créée avant un champ, ne doit pas faire tomber
 * l'écran en plein coup de feu.
 */
export interface ServerOrderRow {
  _id: string;
  number: number;
  clientId: string;
  createdAt?: string;
  status?: string;
  payment?: { status?: string; method?: 'online' | 'counter'; tender?: PaymentTender | null; cashReceived?: number | null; changeGiven?: number | null };
  trackingToken?: string | null;
  channel?: OrderChannel;
  type?: OrderType;
  lines?: OrderLine[];
  statusHistory?: { status: OrderStatus; at: string; by?: string }[];
  pickup?: { slot: string; customerName: string; customerPhone?: string | null } | null;
  delivery?: OrderDelivery | null;
  dining?: OrderDining | null;
  note?: string | null;
  /** La vue détaillée relit aussi le sous-total et le motif de remise. */
  totals?: {
    subtotal?: number;
    deliveryFee?: number;
    total?: number;
    discount?: { amount?: number; reason?: string } | null;
  };
}

/**
 * LES STATUTS « EN COURS », dans l'ordre où le COMPTOIR les regarde.
 *
 * Ce n'est pas l'ordre de la cuisine (`new` → `preparing` → `ready`), et c'est
 * délibéré. La question du caissier n'est pas « qu'est-ce qui vient d'arriver »
 * — il vient de la saisir lui-même — mais « qu'est-ce que j'appelle
 * maintenant ». Les commandes PRÊTES passent donc en tête : c'est le seul
 * groupe qui demande un geste au comptoir, et c'est le motif retenu par toutes
 * les caisses professionnelles qui affichent un état de service.
 */
export const SERVICE_STATUSES: readonly OrderStatus[] = ['ready', 'preparing', 'new'];

/**
 * Une commande est-elle « en cours » ?
 *
 * Ni remise (`delivered` : le client est parti avec), ni annulée (`cancelled` :
 * elle n'a jamais existé pour le service). Écrit en liste BLANCHE : un statut
 * ajouté demain au contrat ne se retrouvera pas « en cours » par défaut, ce qui
 * gonflerait la pastille sans que personne ne comprenne pourquoi.
 */
export function estEnCours(status: string | undefined): boolean {
  return status === 'new' || status === 'preparing' || status === 'ready';
}

export function isOperationalOrder(row: ServerOrderRow): boolean {
  return row.type !== 'delivery' || row.payment?.status === 'paid';
}

export function serviceReadyLabel(row: ServerOrderRow): string {
  if (row.dining) return row.dining.servedAt ? 'SERVIE À TABLE' : 'À SERVIR';
  return row.type !== 'delivery' ? 'À APPELER' : row.delivery?.dispatchedAt ? 'EN LIVRAISON' : 'À EXPÉDIER';
}

export interface ServiceCommande {
  id: string;
  number: number;
  status: OrderStatus;
  /** Millisecondes — base du minuteur ET clé de tri. */
  createdAtMs: number;
  channelLabel: string;
  typeLabel: string;
  statusLabel: string;
  /** Total remise déduite, en centimes. */
  totalCents: number;
  /** Déjà encaissée ? Une commande prête et non payée s'annonce autrement. */
  paid: boolean;
  /**
   * De quoi RECONNAÎTRE la commande à l'appel : le nom du client, ou le
   * créneau de retrait, ou rien — auquel cas il ne reste que le numéro, ce qui
   * est le cas normal d'une vente au comptoir.
   */
  reperage: string | null;
  /** La ligne serveur complète — la vue détaillée en vit. */
  row: ServerOrderRow;
}

/** Horodatage ISO → ms, ou `null` si la date est absente ou illisible. */
function msDe(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** « 12:45 » — créneau de retrait tel qu'on l'annonce au comptoir. */
export function heureCourte(iso: string | undefined | null): string | null {
  const ms = msDe(iso);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function reperageDe(row: ServerOrderRow): string | null {
  if (row.dining?.tableLabel) return `Table · ${row.dining.tableLabel}`;
  const nom = row.pickup?.customerName?.trim();
  if (nom) return nom;
  const creneau = heureCourte(row.pickup?.slot);
  return creneau ? `${row.type === 'delivery' ? 'Arrivée estimée' : 'Retrait'} ${creneau}` : null;
}

/**
 * Projette une ligne serveur en commande affichable.
 *
 * `createdAtMs` retombe sur `secours` (l'horloge du rendu) quand la date est
 * absente : un minuteur qui partirait de 1970 afficherait « 29 000 000 min » en
 * rouge vif sur une commande qui vient d'arriver.
 */
export function versCommande(row: ServerOrderRow, secours: number): ServiceCommande {
  const status = (row.status ?? 'new') as OrderStatus;
  const channel = (row.channel ?? 'pos') as OrderChannel;
  const type = (row.type ?? 'surplace') as OrderType;
  const total = Math.round(row.totals?.total ?? 0);
  return {
    id: row._id,
    number: row.number ?? 0,
    status,
    createdAtMs: msDe(row.createdAt) ?? secours,
    channelLabel: ORDER_CHANNEL_LABELS[channel] ?? channel,
    typeLabel: ORDER_TYPE_LABELS[type] ?? type,
    statusLabel: ORDER_STATUS_LABELS[status] ?? status,
    totalCents: total,
    paid: row.payment?.status === 'paid',
    reperage: reperageDe(row),
    row,
  };
}

/**
 * LES COMMANDES ENCORE ACTIVES, LA PLUS URGENTE EN TÊTE.
 *
 * Deux décisions, et ce sont elles qui font la lisibilité de l'écran :
 *
 * 1. **Regroupement par statut, pas par heure.** Trié à plat par ancienneté,
 *    l'écran mélange une commande prête depuis 30 s et une commande reçue il y
 *    a 12 min — deux gestes différents, deux interlocuteurs différents. Groupé,
 *    le caissier lit « ce que j'appelle », puis « ce qui cuit », puis « ce qui
 *    attend ». L'ordre des groupes vient de `SERVICE_STATUSES` : PRÊTES
 *    d'abord.
 *
 * 2. **Tri interne sur `createdAtMs`, jamais sur le minuteur.** Le minuteur
 *    change chaque seconde ; s'en servir comme clé de tri ferait ressauter la
 *    liste sous le doigt à chaque battement, ce qui est exactement la façon de
 *    faire appuyer sur la mauvaise ligne. `createdAtMs` ne bouge JAMAIS, donc
 *    l'ordre à l'intérieur d'un groupe est stable pour toute la durée de vie de
 *    la commande. Le seul mouvement possible est un changement de statut, qui
 *    déplace UNE carte d'un groupe à l'autre sans toucher aux autres.
 *
 * La plus ancienne d'abord à l'intérieur d'un groupe : c'est celle qui attend
 * depuis le plus longtemps, donc la plus urgente.
 */
export function commandesEnCours(
  rows: readonly ServerOrderRow[],
  maintenant: number,
): ServiceCommande[] {
  const retenues: ServiceCommande[] = [];
  for (const row of rows) {
    if (!estEnCours(row.status) || !isOperationalOrder(row)) continue;
    const commande = versCommande(row, maintenant);
    // Aucun reset du journal local ne découpe le travail restant. Une commande
    // web ou ancienne encore prête doit rester visible jusqu'à son vrai statut.
    retenues.push(commande);
  }
  return retenues.sort((a, b) => {
    const rang = SERVICE_STATUSES.indexOf(a.status) - SERVICE_STATUSES.indexOf(b.status);
    if (rang !== 0) return rang;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    // Départage déterministe : deux commandes peuvent partager la seconde, et
    // un tri instable ferait permuter deux cartes à chaque rafraîchissement.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface GroupeService {
  status: OrderStatus;
  label: string;
  commandes: ServiceCommande[];
}

/**
 * Découpe la liste triée en sections, dans l'ordre de `SERVICE_STATUSES`.
 *
 * Les groupes VIDES sont conservés : un « Prêtes · 0 » qui disparaît puis
 * réapparaît fait sauter tout ce qui est en dessous, et c'est précisément ce
 * qu'on veut éviter sur un écran qu'on touche. Un en-tête à zéro coûte une
 * ligne ; une liste qui bouge coûte une erreur de service.
 */
export function grouperParStatut(commandes: readonly ServiceCommande[]): GroupeService[] {
  return SERVICE_STATUSES.map((status) => ({
    status,
    label: ORDER_STATUS_LABELS[status] ?? status,
    commandes: commandes.filter((c) => c.status === status),
  }));
}

// ─────────────────────────────────────────────────────────────
// Le plafond de remise du rôle
// ─────────────────────────────────────────────────────────────

/**
 * CE QUE LE CODE DE LA SESSION AUTORISE — et pourquoi ce n'est pas un verrou.
 *
 * `REMISE_PLAFOND_CENTS` et `plafondRemiseLabel` existent dans `@sm/contracts`
 * et AUCUN client ne les importait. La modale de remise proposait « − 20 % » :
 * sur une commande à 100 €, cela fait 20 € — au-dessus des 15 € qu'autorise un
 * code `caisse`. Le bouton validait, le serveur refusait après coup, et le
 * caissier l'apprenait devant le client.
 *
 * MAIS le plafond qui s'applique n'est PAS celui de la session : le serveur
 * juge le rôle du PIN RE-SAISI (`orders.controller.ts` : « C'est le PIN
 * re-saisi qui décide, pas la session ouverte »), précisément pour que le
 * gérant puisse venir autoriser un geste sur une tablette ouverte en caisse.
 *
 * L'écran ne peut donc pas savoir à l'avance quel plafond s'appliquera. Il
 * annonce celui de la session — le cas ordinaire — et signale le dépassement
 * comme ce qu'il est : « il faudra le code du gérant », jamais « c'est
 * interdit ». Bloquer ici casserait le geste que l'API autorise exprès.
 */
export interface PlafondRemise {
  /** Plafond du rôle de la session, `null` = sans plafond (gérant). */
  cents: number | null;
  /** Le plafond en toutes lettres, tel que le serveur le formulerait. */
  label: string;
  /** Ce rôle ne peut accorder aucune remise (cuisine). */
  aucun: boolean;
}

/**
 * Le rôle de la session est un `string` (`Session.staffRole`), pas un
 * `StaffRole` : il vient d'une réponse serveur. Un rôle inconnu — API plus
 * récente, session persistée par un ancien bundle — est traité comme le plus
 * RESTREINT, jamais comme le plus permissif : c'est le sens de la prudence
 * quand l'inconnu porte sur un plafond d'argent.
 */
export function roleStaff(role: string | null | undefined): StaffRole {
  return STAFF_ROLES.includes(role as StaffRole) ? (role as StaffRole) : 'cuisine';
}

export function plafondRemise(role: string | null | undefined): PlafondRemise {
  const staffRole = roleStaff(role);
  const cents = REMISE_PLAFOND_CENTS[staffRole];
  return { cents, label: plafondRemiseLabel(staffRole), aucun: cents === 0 };
}

/** Le montant proposé dépasse-t-il ce que le code de la session autorise ? */
export function depasseLePlafond(amountCents: number, plafond: PlafondRemise): boolean {
  return plafond.cents !== null && amountCents > plafond.cents;
}

/**
 * Le pourcentage le plus fort qui tienne encore sous le plafond de la session.
 *
 * Sert à PRÉSÉLECTIONNER une proposition acceptable plutôt qu'à retirer les
 * autres : sur une commande à 100 €, la modale s'ouvre sur « − 5 % » (5 €) au
 * lieu de « − 10 % » (10 €)… et garde « − 20 % » à portée, pour le gérant.
 * `null` quand aucun pourcentage ne passe — c'est alors le montant libre, avec
 * l'avertissement, qui prend le relais.
 */
export function pourcentageParDefaut(
  totalCents: number,
  pourcentages: readonly number[],
  plafond: PlafondRemise,
): number | null {
  const tenables = pourcentages.filter(
    (p) => !depasseLePlafond(Math.round((totalCents * p) / 100), plafond),
  );
  return tenables.length > 0 ? Math.max(...tenables) : null;
}
