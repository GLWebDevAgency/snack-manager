import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// ENCAISSEMENT EN LIGNE — le restaurateur encaisse CHEZ LUI.
//
// Jusqu'ici, le paiement des commandes en ligne passait par une clé Stripe
// UNIQUE, celle de la plateforme : l'argent des clients de tous les
// restaurants serait arrivé sur le compte de l'éditeur, à charge pour lui de
// le reverser. C'est très exactement la définition d'un service de paiement,
// réservé aux établissements agréés — un éditeur de logiciel qui s'y livre
// exerce illégalement, et la sanction est pénale.
//
// La sortie n'est pas contractuelle, elle est ARCHITECTURALE : chaque
// restaurant raccorde SON compte Stripe, et le paiement est créé SUR ce compte
// (charges directes, en-tête `Stripe-Account`). Les fonds ne touchent jamais
// le solde de la plateforme. C'est ce que ce contrat décrit.
//
// Et AUCUNE commission de plateforme n'est prélevée — pas par oubli, par
// stratégie : « zéro commission sur vos ventes » est l'argument qui sépare
// Snack Manager des caisses qui se rémunèrent sur chaque encaissement. Le
// logiciel se facture au mois ; la vente du restaurateur ne se taxe jamais.
// ─────────────────────────────────────────────────────────────

/**
 * Les états d'un raccordement, du point de vue de l'écran.
 *
 * Ils se DÉDUISENT des drapeaux de Stripe (`etatDuCompte`) et ne se stockent
 * jamais : Stripe est seul juge de la capacité d'un marchand à encaisser, et
 * un état recopié en base divergerait au premier changement chez lui — le
 * restaurant lirait « actif » pendant que ses paiements sont refusés.
 */
export const ENCAISSEMENT_ETATS = ['absent', 'en_cours', 'restreint', 'actif'] as const;
export const EncaissementEtatSchema = z.enum(ENCAISSEMENT_ETATS);
export type EncaissementEtat = z.infer<typeof EncaissementEtatSchema>;

export const ENCAISSEMENT_ETAT_LABELS: Record<EncaissementEtat, string> = {
  absent: 'Non raccordé',
  en_cours: 'Inscription à terminer',
  restreint: 'Vérification en cours chez Stripe',
  actif: 'Encaissement en ligne actif',
};

/**
 * Le compte connecté d'un restaurant, tel qu'on le conserve.
 *
 * On ne stocke QUE ce que Stripe nous dit de lui : son identifiant et ses
 * drapeaux. Aucune clé, aucun secret, aucune donnée bancaire — tout cela vit
 * chez Stripe, qui porte l'identification du marchand et la lutte
 * anti-blanchiment. C'est précisément ce transfert de responsabilité qui rend
 * le montage tenable pour un éditeur seul.
 *
 * `acct_…` et rien d'autre : le motif refuse une clé secrète (`sk_…`) collée
 * par erreur dans le mauvais champ — une clé en base serait une fuite, et le
 * jour où elle arriverait par une route mal gardée, le motif est la dernière
 * barrière avant l'écriture.
 */
export const EncaissementCompteSchema = z.object({
  accountId: z.string().trim().regex(/^acct_[A-Za-z0-9]+$/, 'Identifiant de compte Stripe attendu'),
  /**
   * Les trois drapeaux sont à FAUX par défaut, et c'est la règle qui compte :
   * un document écrit avant ce champ, ou une synchronisation manquée, doit se
   * lire « pas encore autorisé ». Un défaut permissif ferait croire qu'un
   * restaurant encaisse alors que Stripe refuse ses paiements.
   */
  chargesEnabled: z.boolean().default(false),
  payoutsEnabled: z.boolean().default(false),
  detailsSubmitted: z.boolean().default(false),
  /** ISO 8601 — quand le raccordement a été engagé. */
  raccordeLe: z.string(),
  /** ISO 8601 — dernière relecture des drapeaux chez Stripe. */
  synchroniseLe: z.string(),
});
export type EncaissementCompte = z.infer<typeof EncaissementCompteSchema>;

/**
 * L'état affiché, dérivé des seuls drapeaux de Stripe.
 *
 * `restreint` est le cas qui coûte cher à mal nommer : le dossier est déposé,
 * Stripe vérifie encore (pièce d'identité en revue, justificatif rejeté), et
 * l'encaissement est refusé entre-temps. Le dire « en cours » enverrait le
 * restaurateur remplir un formulaire déjà rempli ; le dire « actif » lui
 * ferait perdre des commandes sans comprendre pourquoi.
 */
export function etatDuCompte(compte: EncaissementCompte | null): EncaissementEtat {
  if (!compte) return 'absent';
  if (compte.chargesEnabled) return 'actif';
  return compte.detailsSubmitted ? 'restreint' : 'en_cours';
}

/**
 * LA question du service : ce restaurant peut-il encaisser en ligne, là,
 * maintenant ? Seul `chargesEnabled` y répond — les virements peuvent être
 * suspendus (ils se débloquent souvent après la première transaction) sans
 * que le client final ait à en pâtir : son argent est bien encaissé.
 */
export const peutEncaisserEnLigne = (compte: EncaissementCompte | null): boolean =>
  compte !== null && compte.chargesEnabled;

/**
 * POURQUOI le paiement en ligne n'est pas proposé — une phrase destinée au
 * RESTAURATEUR, sur son écran. Le client final, lui, ne voit jamais ces
 * raisons : sa page de commande se contente de proposer le paiement au
 * comptoir, sans expliquer les affaires du restaurant.
 */
export function raisonIndisponibilite(etat: EncaissementEtat): string | null {
  switch (etat) {
    case 'actif':
      return null;
    case 'absent':
      return 'Raccordez votre compte pour encaisser les commandes en ligne. Vos clients règlent au comptoir en attendant.';
    case 'en_cours':
      return 'Votre inscription Stripe n’est pas terminée — reprenez-la pour ouvrir l’encaissement en ligne.';
    case 'restreint':
      return 'Stripe vérifie encore votre dossier. L’encaissement s’ouvrira sans action de votre part dès que ce sera fait.';
  }
}

/* ── Ce que l'écran du restaurateur reçoit ──────────────────── */

/**
 * La fiche d'encaissement, telle que la sert l'API.
 *
 * `peutEncaisser` est calculé côté serveur et non déduit de l'état par
 * l'écran : deux lectures de la même règle finiraient par diverger, et c'est
 * la règle qui décide si un client peut payer.
 */
export type EncaissementFiche = {
  etat: EncaissementEtat;
  etatLabel: string;
  peutEncaisser: boolean;
  /** `null` quand tout va bien — sinon la phrase à afficher au gérant. */
  raison: string | null;
  compte: EncaissementCompte | null;
  /**
   * `false` quand la plateforme elle-même n'est pas configurée (clé absente,
   * paquet Stripe non installé). L'écran dit alors « bientôt disponible »
   * plutôt que d'inviter à un raccordement qui échouerait.
   */
  disponible: boolean;
};

/**
 * Le lien à ouvrir pour reprendre l'inscription chez Stripe.
 *
 * Il EXPIRE (quelques minutes) et ne se stocke donc jamais : on le redemande
 * à chaque clic. Un lien mis en cache enverrait le restaurateur sur une page
 * morte, et il croirait le service cassé.
 */
export type EncaissementLien = { url: string; expireLe: string };
