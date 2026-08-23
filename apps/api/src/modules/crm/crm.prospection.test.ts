import { describe, expect, it } from 'vitest';
import { LeadCreateSchema } from '@sm/contracts';
import { PROSPECTION_LEADS, buildProspectionOps } from './crm.prospection';

/**
 * La liste de prospection est de la DONNÉE DE PRODUCTION committée : ces
 * invariants sont le seul filet entre une faute de saisie et cinquante vraies
 * fiches fausses dans le pipeline du fondateur.
 */

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('Liste de prospection', () => {
  it('passe le contrat de création de lead, fiche par fiche', () => {
    for (const lead of PROSPECTION_LEADS) {
      // Le même zod que `POST /crm/leads` : ce qui n'entrerait pas par
      // l'API n'entre pas non plus par l'import.
      expect(
        () => LeadCreateSchema.parse({ restaurantName: lead.restaurantName, contact: lead.contact, notes: lead.notes }),
        lead.restaurantName,
      ).not.toThrow();
    }
  });

  it('ne porte jamais deux fois le même établissement', () => {
    // L'upsert filtre par nom : un doublon de saisie s'écraserait lui-même
    // en silence — la liste doit le rendre impossible.
    const names = PROSPECTION_LEADS.map((l) => l.restaurantName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('écrit les téléphones au format cadencé français, ou pas du tout', () => {
    // Dix chiffres par paires : le format qu'on lit à voix haute en
    // composant. Un numéro absent reste vide — jamais inventé.
    for (const lead of PROSPECTION_LEADS) {
      if (lead.contact.phone === '') continue;
      expect(lead.contact.phone, lead.restaurantName).toMatch(/^0[1-9](?: \d\d){4}$/);
    }
  });

  it('ouvre chaque note par la ville et cite sa source', () => {
    // Le modèle `leads` n'a pas de champ « ville » : la note est le seul
    // endroit où le commercial la lit. Et une fiche sans source est une
    // fiche qu'on ne peut pas défendre.
    for (const lead of PROSPECTION_LEADS) {
      expect(lead.notes, lead.restaurantName).toMatch(/^[A-ZÉÈ]/);
      expect(lead.notes, lead.restaurantName).toMatch(/[( ]source/i);
    }
  });
});

describe('Écritures de l’import', () => {
  it('ne fait que des upserts $setOnInsert — jamais de $set', () => {
    // C'est LA garantie d'idempotence : une fiche existante (étape avancée,
    // relances, notes du fondateur) ne peut pas être retouchée par un
    // redémarrage, parce qu'aucune écriture ne vise les documents trouvés.
    for (const op of buildProspectionOps(NOW)) {
      expect('updateOne' in op).toBe(true);
      if (!('updateOne' in op)) continue;
      expect(op.updateOne.upsert).toBe(true);
      expect(Object.keys(op.updateOne.update)).toEqual(['$setOnInsert']);
    }
  });

  it('filtre chaque écriture par le nom qu’elle insère', () => {
    for (const op of buildProspectionOps(NOW)) {
      if (!('updateOne' in op)) continue;
      const inserted = (op.updateOne.update as { $setOnInsert: { restaurantName: string } })
        .$setOnInsert;
      expect(op.updateOne.filter).toEqual({ restaurantName: inserted.restaurantName });
    }
  });

  it('pose les horodatages lui-même, Mongoose tenu à l’écart', () => {
    // Sans `timestamps: false`, Mongoose ajouterait `updatedAt` en `$set` à
    // chaque démarrage : tous les leads importés remonteraient en tête du
    // pipeline (trié par `updatedAt`) sans qu'on les ait touchés.
    for (const op of buildProspectionOps(NOW)) {
      if (!('updateOne' in op)) continue;
      expect(op.updateOne.timestamps).toBe(false);
      const doc = (op.updateOne.update as { $setOnInsert: Record<string, unknown> }).$setOnInsert;
      expect(doc.createdAt).toEqual(NOW);
      expect(doc.updatedAt).toEqual(NOW);
      expect(doc.stage).toBe('nouveau');
      expect(doc.sequence).toBeNull();
      expect(doc.founderSeatReserved).toBe(false);
      expect(doc.touches).toEqual([]);
    }
  });
});
