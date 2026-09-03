import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { TENANT_AUDIT_ACTIONS } from '@sm/contracts';
import { AdminLogSchema, AuditLogSchema } from './schemas';

/**
 * LES DEUX REGISTRES SONT INALTÉRABLES — vérifié, pas seulement promis.
 *
 * Un journal qu'on peut réécrire ne prouve rien : c'est l'unique propriété qui
 * distingue un registre à valeur probante d'une table de logs. Elle était
 * tenue par `adminLogs` (ce que fait l'équipe SM aux comptes de ses clients) et
 * seulement AFFICHÉE par `auditLogs` (ce que fait un restaurant dans sa propre
 * caisse) — alors que c'est le second qu'on ouvre devant un contrôle NF525.
 *
 * Le test porte sur les DEUX, avec la même liste d'opérations : le jour où
 * l'une des deux perdra un hook, il faudra que ça se voie ici.
 */

/** Les huit portes d'écriture de Mongoose, hors insertion. */
const MUTATIONS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;

const REGISTRES = [
  ['auditLogs — le registre du restaurant', AuditLogSchema],
  ['adminLogs — le registre de l’équipe Snack Manager', AdminLogSchema],
] as const;

describe.each(REGISTRES)('%s est append-only', (nom, schema) => {
  // Un modèle par registre, jamais connecté : les middlewares de requête
  // s'exécutent AVANT l'envoi à Mongo, ce qui suffit à prouver que le code
  // applicatif ne peut pas passer.
  const modele = mongoose.model(`Test${nom.slice(0, 6)}`, schema, 'test-registres');

  it.each(MUTATIONS)('refuse « %s »', async (operation) => {
    const appel = {
      updateOne: () => modele.updateOne({}, { $set: { action: 'order.cancel' } }),
      updateMany: () => modele.updateMany({}, { $set: { action: 'order.cancel' } }),
      replaceOne: () => modele.replaceOne({}, {}),
      findOneAndUpdate: () => modele.findOneAndUpdate({}, { $set: { action: 'order.cancel' } }),
      findOneAndReplace: () => modele.findOneAndReplace({}, {}),
      deleteOne: () => modele.deleteOne({}),
      deleteMany: () => modele.deleteMany({}),
      findOneAndDelete: () => modele.findOneAndDelete({}),
    }[operation];

    // Le message NOMME le registre et l'opération : au moment où ce refus
    // tombe en production, la trace doit dire lequel des deux journaux a été
    // approché et par quelle porte.
    await expect(appel()).rejects.toThrow(/append-only/);
  });
});

/**
 * L'ÉNUMÉRATION DU SCHÉMA EST LA SOURCE, PAS UNE RECOPIE.
 *
 * Le journal d'administration a payé cette leçon : une action déclarée au
 * contrat mais absente d'une enum recopiée dans le schéma est REFUSÉE à
 * l'écriture, et le geste passe sans laisser de trace — le pire des défauts,
 * celui qui ne se signale pas. `auditLogs` n'avait aucune enum du tout : elle
 * en a une, et elle est étalée depuis le contrat.
 */
describe('les actions acceptées par auditLogs', () => {
  it('sont exactement celles que déclare le contrat', () => {
    const chemin = AuditLogSchema.path('action') as unknown as {
      enumValues?: string[];
    };
    expect(chemin.enumValues).toEqual([...TENANT_AUDIT_ACTIONS]);
  });

  it('refuse une action inventée — elle ne doit pas s’écrire en silence', () => {
    const chemin = AuditLogSchema.path('action') as unknown as { enumValues?: string[] };
    expect(chemin.enumValues).not.toContain('product.rename');
  });
});

/**
 * L'AUTEUR EST STOCKÉ EN TEXTE, et c'est ce qui évitera une migration.
 *
 * `author.id` désigne un compte, un membre d'équipe, et demain peut-être une
 * clé de connecteur pour un assistant. Une clé n'aura pas la forme d'un
 * ObjectId : typer la colonne en `ObjectId` obligerait à migrer un registre
 * append-only, c'est-à-dire à ne pas pouvoir le faire.
 */
describe('la forme de l’auteur', () => {
  it('porte l’identifiant en texte, pas en ObjectId', () => {
    expect(AuditLogSchema.path('author.id').instance).toBe('String');
  });

  it('réserve déjà la place d’un assistant connecté, sans qu’aucun code ne l’écrive', () => {
    const chemin = AuditLogSchema.path('author.means') as unknown as { enumValues?: string[] };
    expect(chemin.enumValues).toEqual(['password', 'pin', 'connector']);
  });
});
