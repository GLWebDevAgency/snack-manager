import { TenantSchema } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { REGLAGES_MODIFIABLES } from './tenants.service';

/**
 * La route des réglages prend un corps NU — aucun schéma Zod ne la valide
 * (`tenants.controller.ts`, `@Body()` sans pipe). La liste blanche du service
 * est donc le seul rempart, et elle a un angle mort : elle dit ce qu'on a le
 * droit d'écrire, jamais ce que la base sait recevoir.
 *
 * `dailyGoalCents` a vécu dans cette liste sans exister dans le schéma
 * Mongoose. Mongoose est en mode strict : le `$set` était jeté en silence, la
 * route répondait 200, et le gérant qui posait son objectif du jour depuis son
 * tableau de bord le voyait disparaître au rechargement. Aucune erreur, aucun
 * journal — le pire des défauts, celui qui ne se signale pas.
 *
 * Ce test relie les deux bouts. Il ne teste pas un champ : il teste que
 * l'ensemble des deux reste cohérent, aujourd'hui et à chaque ajout futur.
 */
describe('les réglages de service', () => {
  it('chaque réglage autorisé existe vraiment dans le schéma — sinon il est jeté en silence', () => {
    const absents = REGLAGES_MODIFIABLES.filter((clef) => !TenantSchema.path(`settings.${clef}`));
    expect(
      absents,
      `Ces réglages sont acceptés par l'API mais absents du schéma Mongoose : ` +
        `la route répondra 200 et rien ne sera enregistré. Ajoutez-les à ` +
        `TenantSchema.settings dans packages/db/src/schemas.ts.`,
    ).toEqual([]);
  });

  it('l’objectif du jour se stocke en centimes entiers, comme tous les montants du logiciel', () => {
    const chemin = TenantSchema.path('settings.dailyGoalCents');
    expect(chemin, 'settings.dailyGoalCents doit exister dans le schéma').toBeDefined();
    expect(chemin.instance).toBe('Number');
  });

  it('sans objectif posé, la valeur est absente — pas zéro', () => {
    // Zéro serait un objectif atteint dès l'ouverture, et le tableau de bord
    // afficherait 100 % avant la première commande. L'absence de valeur laisse
    // le front appliquer son propre défaut.
    //
    // On lit `options.default` et non `defaultValue` : le second n'est pas
    // exposé par les types de Mongoose, et un test qui ne compile pas est un
    // test qui finit par être supprimé.
    const chemin = TenantSchema.path('settings.dailyGoalCents');
    expect(chemin.options.default).toBeUndefined();
  });
});
