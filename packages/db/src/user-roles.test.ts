import { describe, expect, it } from 'vitest';
import { ROLES_COMPTE, USER_ROLES } from '@sm/contracts';
import { StaffSchema, UserSchema } from './schemas';

/**
 * LA BASE ET LE CONTRAT DISENT LA MÊME CHOSE SUR LES RÔLES.
 *
 * L'énumération vivait en dur dans le schéma (`['owner', 'sm_admin']`). Ajouter
 * un rôle au contrat sans l'ajouter ici produit le pire des refus : la création
 * passe la validation zod, atteint Mongo, et échoue en `ValidationError` — un
 * 500 sur un geste parfaitement légitime, avec un message que personne ne lit.
 */
describe('les rôles des comptes en base', () => {
  it('reprend l’énumération du contrat, sans en inventer ni en oublier', () => {
    const path = UserSchema.path('role');
    expect(path.options.enum).toEqual([...USER_ROLES]);
    expect(path.options.required).toBe(true);
  });

  /**
   * LE MOT « GÉRANT » RESTE AU CODE SUR TABLETTE.
   *
   * Le compte s'appelle `cogerant`, le porteur de code `gerant` : deux mots
   * voisins pour deux portes différentes. S'ils se confondaient un jour, aucun
   * décorateur `@Roles('owner', 'gerant')` ne dirait plus laquelle il ouvre.
   */
  it('ne laisse aucun rôle porter les deux sens à la fois', () => {
    const comptes = new Set<string>(USER_ROLES);
    const tablette = new Set<string>(
      (StaffSchema.path('role').options.enum ?? []) as readonly string[],
    );
    expect(tablette.has('gerant')).toBe(true);
    expect(comptes.has('gerant')).toBe(false);
    for (const role of tablette) expect(comptes.has(role)).toBe(false);
  });

  it('n’ouvre les rôles de restaurant qu’aux comptes rattachés à un tenant', () => {
    // `sm_admin` est le seul rôle SANS établissement : il ne doit jamais
    // apparaître dans la liste que la fiche client propose.
    expect([...ROLES_COMPTE]).not.toContain('sm_admin');
    for (const role of ROLES_COMPTE) expect([...USER_ROLES]).toContain(role);
  });
});
