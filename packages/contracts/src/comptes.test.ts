import { describe, expect, it } from 'vitest';
import {
  COMPTES_PAR_FORMULE,
  COMPTES_SANS_FORMULE,
  CompteCreateSchema,
  CompteRevokeSchema,
  CompteRoleSchema,
  FORMULES,
  ROLES_ATTRIBUABLES,
  ROLES_COMPTE,
  ROLES_SUBSUMES,
  ROLE_COMPTE_HINTS,
  ROLE_COMPTE_LABELS,
  STAFF_ROLES,
  USER_ROLES,
  comptesAutorises,
  courrielDejaPris,
  projeterCompte,
  refusQuotaComptes,
  roleSatisfait,
  rolesEndosses,
} from './index';

/**
 * LE MODÈLE DE COMPTES, à sa source.
 *
 * Ce que ce fichier tient et qu'aucune relecture ne tiendrait : que les deux
 * familles de rôles ne se recouvrent pas, que le plafond est complet pour
 * chaque formule de la grille, et que la projection ne laisse RIEN passer
 * d'autre que ses sept champs.
 */

describe('les rôles de compte', () => {
  it('sépare strictement les comptes à mot de passe des codes sur tablette', () => {
    // `cogerant` et `gerant` sont deux mots voisins pour deux portes
    // différentes : le premier ouvre un back-office avec un mot de passe, le
    // second une tablette avec quatre chiffres. Les confondre rendrait
    // impossible de savoir ce qu'un `@Roles('owner', 'gerant')` autorise.
    for (const role of STAFF_ROLES) expect([...USER_ROLES]).not.toContain(role);
    for (const role of USER_ROLES) expect([...STAFF_ROLES]).not.toContain(role);
    expect([...USER_ROLES]).toContain('cogerant');
    expect([...STAFF_ROLES]).toContain('gerant');
  });

  it('n’ouvre à l’attribution que ce qui n’est pas le propriétaire', () => {
    // Le propriétaire naît à la signature et ne s'attribue pas : c'est lui qui
    // porte l'abonnement et l'encaissement.
    expect([...ROLES_ATTRIBUABLES]).not.toContain('owner');
    for (const role of ROLES_ATTRIBUABLES) expect([...ROLES_COMPTE]).toContain(role);
    expect([...ROLES_COMPTE]).not.toContain('sm_admin');
  });

  it('nomme et explique CHAQUE rôle de restaurant', () => {
    // Un rôle sans phrase s'afficherait comme une clé dans l'écran de création,
    // au moment précis où l'opérateur décide ce qu'il donne à quelqu'un.
    for (const role of ROLES_COMPTE) {
      expect(ROLE_COMPTE_LABELS[role], role).toMatch(/^[A-ZÉÈÀÇ]/);
      expect(ROLE_COMPTE_HINTS[role].length, role).toBeGreaterThan(40);
    }
  });
});

describe('la subsomption des rôles', () => {
  it('n’étend que `cogerant`, et seulement vers `gerant`', () => {
    expect(ROLES_SUBSUMES).toEqual({ cogerant: ['gerant'] });
    expect(rolesEndosses('cogerant')).toEqual(['cogerant', 'gerant']);
    for (const role of ['owner', 'comptable', 'sm_admin', 'gerant', 'caisse', 'cuisine']) {
      expect(rolesEndosses(role), role).toEqual([role]);
    }
  });

  it('satisfait un décorateur du gérant, jamais un décorateur du propriétaire', () => {
    expect(roleSatisfait('cogerant', ['owner', 'gerant'])).toBe(true);
    expect(roleSatisfait('cogerant', ['owner'])).toBe(false);
    expect(roleSatisfait('comptable', ['owner', 'gerant'])).toBe(false);
    // Un décorateur vide n'exige rien : le comportement d'avant, préservé.
    expect(roleSatisfait('cuisine', [])).toBe(true);
  });
});

describe('le nombre de comptes par formule', () => {
  it('couvre chaque formule de la grille, sans trou', () => {
    // Une formule ajoutée au catalogue sans ligne ici rendrait `undefined` au
    // calcul du plafond, et le quota ne refuserait plus rien.
    for (const formule of FORMULES) {
      expect(COMPTES_PAR_FORMULE[formule], formule).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(COMPTES_PAR_FORMULE).sort()).toEqual([...FORMULES].sort());
  });

  it('donne un compte — celui de la signature — au client sans formule', () => {
    expect(COMPTES_SANS_FORMULE).toBe(1);
    expect(comptesAutorises(null)).toBe(1);
    expect(comptesAutorises(undefined)).toBe(1);
  });

  it('refuse EN CHIFFRES, et accorde le pluriel', () => {
    expect(refusQuotaComptes(1)).toContain('1 compte ');
    expect(refusQuotaComptes(1)).not.toContain('comptes');
    expect(refusQuotaComptes(4)).toContain('4 comptes');
    // Le refus dit la SORTIE, pas seulement le mur.
    expect(refusQuotaComptes(2)).toMatch(/révoquez/);
    // Et il ne nomme aucune formule : la règle d'or vaut aussi pour les phrases.
    for (const formule of FORMULES) {
      expect(refusQuotaComptes(2).toLowerCase()).not.toContain(formule);
    }
  });

  it('nomme l’établissement qui détient déjà une adresse', () => {
    const message = courrielDejaPris('sarah@classfood.fr', 'Le Voisin');
    expect(message).toContain('sarah@classfood.fr');
    expect(message).toContain('Le Voisin');
    // Il dit ce qui BLOQUE, pas « c'est impossible » : le jour où
    // l'appartenance existera, ce refus deviendra un rattachement.
    expect(message).toMatch(/qu’à un établissement/);
  });
});

describe('la projection d’un compte', () => {
  it('ne laisse sortir que ses sept champs, empreinte comprise', () => {
    const compte = projeterCompte({
      _id: 'abc',
      email: 'sarah@classfood.fr',
      name: 'Sarah',
      role: 'cogerant',
      // Tout ce qui suit vit en base et ne doit atteindre AUCUNE réponse.
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$sel$empreinte',
      sessionVersion: 'e3b0c442',
      tenantId: '65f000000000000000000001',
      createdAt: new Date('2026-03-01T09:00:00Z'),
    });

    expect(Object.keys(compte).sort()).toEqual([
      'creeLe',
      'email',
      'id',
      'nom',
      'proprietaire',
      'role',
      'roleLabel',
    ]);
    expect(JSON.stringify(compte)).not.toContain('argon2');
    expect(JSON.stringify(compte)).not.toContain('e3b0c442');
    expect(compte).toMatchObject({
      id: 'abc',
      nom: 'Sarah',
      role: 'cogerant',
      roleLabel: 'Cogérant',
      proprietaire: false,
      creeLe: '2026-03-01T09:00:00.000Z',
    });
  });

  it('marque le propriétaire, seul compte que l’écran ne peut pas toucher', () => {
    expect(projeterCompte({ role: 'owner' }).proprietaire).toBe(true);
    expect(projeterCompte({ role: 'comptable' }).proprietaire).toBe(false);
  });

  it('survit à un document abîmé sans inventer un propriétaire', () => {
    // Un rôle illisible ne doit JAMAIS se replier sur `owner` : le repli
    // rendrait intouchable un compte qu'on cherche justement à révoquer.
    const compte = projeterCompte({ role: 'inconnu', createdAt: 'pas-une-date' });
    expect(compte.proprietaire).toBe(false);
    expect(compte.creeLe).toBeNull();
    expect(compte.email).toBe('');
    expect(projeterCompte(null).proprietaire).toBe(false);
  });
});

describe('ce que le support envoie', () => {
  it('exige une adresse, un nom et un rôle attribuable — et rien d’autre', () => {
    const ok = CompteCreateSchema.parse({
      email: '  Sarah@ClassFood.FR ',
      nom: '  Sarah  ',
      role: 'cogerant',
    });
    expect(ok).toEqual({ email: 'sarah@classfood.fr', nom: 'Sarah', role: 'cogerant' });

    // Aucun mot de passe reçu du client : il est FABRIQUÉ par le serveur.
    expect(
      CompteCreateSchema.safeParse({
        email: 'a@b.fr',
        nom: 'A',
        role: 'cogerant',
        password: 'choisi-a-la-main',
      }).success,
    ).toBe(false);
    // Pas de second propriétaire.
    expect(
      CompteCreateSchema.safeParse({ email: 'a@b.fr', nom: 'A', role: 'owner' }).success,
    ).toBe(false);
    // Un nom vide écrirait « » dans un registre à valeur probante.
    expect(CompteCreateSchema.safeParse({ email: 'a@b.fr', nom: ' ', role: 'cogerant' }).success)
      .toBe(false);
  });

  it('exige un motif pour changer un rôle et pour révoquer', () => {
    expect(CompteRoleSchema.safeParse({ role: 'comptable' }).success).toBe(false);
    expect(CompteRoleSchema.safeParse({ role: 'comptable', motif: 'ok' }).success).toBe(false);
    expect(
      CompteRoleSchema.safeParse({ role: 'comptable', motif: 'Passe à la compta' }).success,
    ).toBe(true);

    expect(CompteRevokeSchema.safeParse({}).success).toBe(false);
    expect(CompteRevokeSchema.safeParse({ motif: 'A quitté le 30/08' }).success).toBe(true);
    // Le motif est rédigé en français par le schéma : c'est lui que l'écran
    // affiche, `messageDeRefus` le remontant tel quel.
    const refus = CompteRevokeSchema.safeParse({ motif: 'x' });
    expect(refus.success).toBe(false);
    expect(refus.error?.issues[0]?.message).toBe('Motif obligatoire');
  });
});
