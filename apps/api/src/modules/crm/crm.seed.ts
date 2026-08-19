import type { LeadCreate, LeadSequence, LeadStage, LeadTouchType } from '@sm/contracts';

/**
 * Amorce du pipeline — 8 prospects de la vallée de la Seine (Rouen, Évreux,
 * Vernon, Louviers), répartis sur les six étapes.
 *
 * Ce n'est pas de la donnée de test : c'est le pipeline qu'on montre en
 * démonstration tant que le vrai n'est pas saisi. Elle n'est écrite QU'UNE
 * FOIS, quand la collection est vide — dès qu'un premier lead réel existe,
 * cette liste ne s'exécute plus jamais.
 *
 * Le modèle `leads` ne porte pas de champ « ville » ni de MRR potentiel
 * (schémas @sm/db) : la ville ouvre donc la note, à l'endroit où le commercial
 * la lit de toute façon.
 */

type SeedTouch = {
  /** Ancienneté de la relance, en jours avant maintenant. */
  daysAgo: number;
  type: LeadTouchType;
  note: string;
};

export type LeadSeed = Omit<LeadCreate, 'stage' | 'sequence'> & {
  stage: LeadStage;
  sequence: LeadSequence | null;
  touches: SeedTouch[];
};

export const SEED_LEADS: readonly LeadSeed[] = [
  {
    restaurantName: 'Chick & Go',
    contact: { name: 'S. Diallo', phone: '06 41 22 18 07', email: '' },
    stage: 'nouveau',
    sequence: null,
    notes: "Louviers — a vu la page Instagram de Class'Food, demande une démo rapide.",
    founderSeatReserved: false,
    touches: [],
  },
  {
    restaurantName: 'La Broche Dorée',
    contact: { name: 'M. Aksoy', phone: '07 82 44 09 31', email: '' },
    stage: 'nouveau',
    sequence: null,
    notes: 'Elbeuf — 3 employés, gros volume kebab le vendredi soir. Passé au comptoir, carte laissée.',
    founderSeatReserved: false,
    touches: [],
  },
  {
    restaurantName: 'Smash Bros Burger',
    contact: { name: 'K. Lemaire', phone: '06 12 55 70 44', email: 'contact@smashbros-rouen.fr' },
    stage: 'contacte',
    sequence: 'B',
    notes: "Rouen — visite sans démo, deux créneaux proposés pour la semaine prochaine.",
    founderSeatReserved: false,
    touches: [
      { daysAgo: 6, type: 'visite', note: 'Passage au comptoir à 15h, hors service. Intéressé par la caisse.' },
      { daysAgo: 5, type: 'sms', note: 'B1 — 2 créneaux de démo proposés (mardi 15h / jeudi 15h).' },
    ],
  },
  {
    restaurantName: "O'Tacos City",
    contact: { name: 'Y. Benali', phone: '07 55 13 62 90', email: '' },
    stage: 'contacte',
    sequence: 'B',
    notes: 'Vernon — compare avec un concurrent, veut voir le mode hors-ligne de la caisse.',
    founderSeatReserved: false,
    touches: [
      { daysAgo: 9, type: 'appel', note: "Premier contact, demande de rappeler après le service du soir." },
      { daysAgo: 2, type: 'sms', note: 'B2 — preuve sociale locale : 30 jours sans retour au papier chez le pilote.' },
    ],
  },
  {
    restaurantName: 'Le Comptoir Grec',
    contact: { name: 'N. Papas', phone: '06 77 30 12 58', email: 'lecomptoirgrec27@gmail.com' },
    stage: 'demo',
    sequence: 'A',
    notes: 'Évreux — démo faite sur place, carte photographiée pour import IA. Attend le devis.',
    founderSeatReserved: true,
    touches: [
      { daysAgo: 12, type: 'appel', note: 'Rendez-vous de démo calé pour le mardi suivant, 15h.' },
      { daysAgo: 5, type: 'demo', note: 'Démo sur place — caisse + cuisine. Menu photographié (42 produits).' },
      { daysAgo: 5, type: 'sms', note: "A1 — SMS du soir même : récapitulatif et place fondateur n° 3 réservée." },
    ],
  },
  {
    restaurantName: 'Pizza Vita',
    contact: { name: 'A. Ricci', phone: '06 30 88 41 26', email: 'a.ricci@pizzavita.fr' },
    stage: 'proposition',
    sequence: 'A',
    notes: 'Louviers — proposition Complet + installation envoyée. Relance J+7 prévue.',
    founderSeatReserved: true,
    touches: [
      { daysAgo: 18, type: 'demo', note: 'Démo au comptoir entre deux services.' },
      { daysAgo: 11, type: 'email', note: 'Proposition envoyée : Complet 119 €/mois + 290 € de mise en place.' },
      { daysAgo: 4, type: 'appel', note: 'A2 — appel J+3 : lit le devis ce week-end, question sur le sans-engagement.' },
    ],
  },
  {
    restaurantName: 'Green House',
    contact: { name: 'L. Fontaine', phone: '07 21 47 03 15', email: 'contact@greenhouse-evreux.fr' },
    stage: 'signe',
    sequence: null,
    notes: "Évreux — signé sur la formule Complet, place fondateur n° 2. Installation à planifier.",
    founderSeatReserved: true,
    touches: [
      { daysAgo: 34, type: 'demo', note: 'Démo sur place, gérant et second de cuisine présents.' },
      { daysAgo: 27, type: 'email', note: 'Proposition envoyée.' },
      { daysAgo: 21, type: 'appel', note: 'Signature confirmée — place fondateur n° 2 posée.' },
    ],
  },
  {
    restaurantName: 'Le Bosphore',
    contact: { name: 'H. Yilmaz', phone: '06 58 90 22 74', email: '' },
    stage: 'perdu',
    sequence: 'C',
    notes: "Rouen rive gauche — vient de réengager 24 mois chez son prestataire. À reprendre en nurture (séquence C), rappel dans 30 jours.",
    founderSeatReserved: false,
    touches: [
      { daysAgo: 40, type: 'visite', note: 'Passage au comptoir, discussion courte.' },
      { daysAgo: 33, type: 'appel', note: "Sous contrat jusqu'à l'an prochain — pas de fenêtre avant." },
      { daysAgo: 3, type: 'email', note: 'C1 — email de nurture mensuel (chiffre + leçon + porte ouverte).' },
    ],
  },
];

/** Documents prêts pour `insertMany`, horodatés par rapport à `now`. */
export function buildSeedLeads(now: Date = new Date()) {
  const DAY_MS = 86_400_000;
  return SEED_LEADS.map((lead) => {
    const touches = lead.touches.map((t) => ({
      at: new Date(now.getTime() - t.daysAgo * DAY_MS),
      type: t.type,
      note: t.note,
    }));
    // Le lead existe forcément avant sa première relance : sans cela la fiche
    // afficherait un prospect « créé aujourd'hui » relancé il y a six semaines.
    const stamps = touches.map((t) => t.at.getTime());
    const createdAt = new Date(Math.min(now.getTime(), ...stamps) - 2 * DAY_MS);
    return {
      restaurantName: lead.restaurantName,
      contact: lead.contact,
      stage: lead.stage,
      sequence: lead.sequence,
      notes: lead.notes,
      founderSeatReserved: lead.founderSeatReserved,
      touches,
      createdAt,
      updatedAt: stamps.length > 0 ? new Date(Math.max(...stamps)) : createdAt,
    };
  });
}
