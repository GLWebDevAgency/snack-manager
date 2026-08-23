import type { AnyBulkWriteOperation } from 'mongoose';
import type { Lead } from '@sm/db';

/**
 * LA LISTE DE PROSPECTION RÉELLE — à ne pas confondre avec `crm.seed.ts`.
 *
 * Le seed est une fiction de démonstration, réservée aux environnements où
 * `SM_DEMO_SEED=on`. Cette liste-ci est l'inverse : de vrais établissements,
 * relevés un par un dans des sources publiques (Pages Jaunes, pages Facebook
 * des établissements, annuaires, presse locale) le 23/08/2026, pour lancer la
 * prospection terrain. Elle n'est écrite QUE là où la démo est coupée — en
 * production — par `CrmService.ensureProspected`.
 *
 * Ciblage arrêté avec le fondateur : des snacks indépendants au profil de
 * Class'Food (kebab, tacos, burger, pizza à emporter, friterie), dans les
 * bourgs normands autour de Rouen où Uber Eats et Deliveroo ne livrent pas —
 * vallée de l'Andelle comme Perriers-sur-Andelle, Vexin normand, pays de
 * Bray, pays de Caux, sud de l'Eure. L'absence de plateforme est une
 * HEURISTIQUE (communes rurales hors zones de course), vérifiée quand une
 * source le permettait ; elle se confirme au premier appel.
 *
 * Règles de la liste :
 * - chaque établissement provient d'une source publique consultée — aucun
 *   nom « plausible », aucun numéro reconstitué : un téléphone absent reste
 *   vide, un numéro faux ferait perdre un appel et la face ;
 * - le modèle `leads` ne portant pas de champ « ville », la ville ouvre la
 *   note, suivie de la source entre parenthèses — même convention que le
 *   seed ;
 * - tout entre en étape « nouveau », sans séquence : le pipeline se joue au
 *   téléphone, pas dans un import.
 */

export type ProspectionLead = {
  restaurantName: string;
  contact: { name: string; phone: string; email: string };
  notes: string;
};

export const PROSPECTION_LEADS: readonly ProspectionLead[] = [];

/**
 * Les écritures de l'import, prêtes pour `bulkWrite`.
 *
 * Un upsert `$setOnInsert` par nom d'établissement, et RIEN d'autre : pas de
 * `$set`, donc pas d'écrasement possible — une fiche déjà présente garde son
 * étape, ses relances et ses notes, quoi que dise cette liste. Les horodatages
 * sont posés ici (`timestamps: false` sur l'opération) : sans cela, Mongoose
 * ajouterait `updatedAt` en `$set` et chaque démarrage « rafraîchirait » tous
 * les leads importés — le pipeline, trié par `updatedAt`, mentirait sur ce qui
 * vient de bouger.
 */
export function buildProspectionOps(now: Date = new Date()): AnyBulkWriteOperation<Lead>[] {
  return PROSPECTION_LEADS.map((lead) => ({
    updateOne: {
      filter: { restaurantName: lead.restaurantName },
      update: {
        $setOnInsert: {
          restaurantName: lead.restaurantName,
          contact: lead.contact,
          stage: 'nouveau',
          sequence: null,
          notes: lead.notes,
          founderSeatReserved: false,
          // Vide au sens du document, pas du `DocumentArray` hydraté que le
          // type `Lead` décrit : l'écriture passe par le driver, en POJO.
          touches: [] as unknown as Lead['touches'],
          createdAt: now,
          updatedAt: now,
        },
      },
      upsert: true,
      timestamps: false,
    },
  }));
}
