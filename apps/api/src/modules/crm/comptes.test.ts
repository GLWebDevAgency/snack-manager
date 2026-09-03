import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  COMPTES_PAR_FORMULE,
  COMPTES_SANS_FORMULE,
  comptesAutorises,
  type JwtPayload,
} from '@sm/contracts';
import type { AdminLog, Device, Screen, Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import { testOriginesImages } from '../tenants/tenants.fakes';
import { AdminService } from './admin.service';
import { FakeCollection } from './admin.fakes';
import { ComptesService } from './comptes.service';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LES COMPTES D'UN RESTAURANT — ce que le support peut, et ce qu'il ne    ║
 * ║  peut pas.                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Quatre propriétés se vérifient ici, et aucune ne se relit à l'œil :
 *  · l'empreinte du mot de passe n'approche AUCUNE réponse — prouvé avec un
 *    double qui rend le document ENTIER, projection Mongo comprise ;
 *  · le propriétaire ne se révoque pas et ne change pas de rôle ;
 *  · le plafond de la formule refuse en CHIFFRES, jamais par un 500 ;
 *  · une révocation coupe les sessions ouvertes.
 */

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';
const PATRON = '65f0000000000000000000a1';
const COGERANT = '65f0000000000000000000a2';
const CHEZ_LE_VOISIN = '65f0000000000000000000a3';

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
};

/**
 * L'EMPREINTE PIÈGE.
 *
 * Une vraie chaîne d'apparence Argon2, semée sur chaque compte : si elle
 * réapparaît quelque part dans une réponse sérialisée, le test le voit. Un
 * `expect(reponse.passwordHash).toBeUndefined()` ne prouverait rien — il ne
 * regarde qu'une clé, à la racine, et manquerait une empreinte recopiée sous un
 * autre nom ou dans un sous-objet.
 */
const EMPREINTE = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$PIEGE+A+NE+JAMAIS+SORTIR';

function build(plan: string | null = 'complet') {
  const tenants = new FakeCollection('tenant');
  const users = new FakeCollection('user');
  const logs = new FakeCollection('log');
  const devices = new FakeCollection('device');
  const screens = new FakeCollection('screen');

  tenants.seed({ _id: CLASSFOOD, slug: 'classfood', name: "Class'Food", plan });
  tenants.seed({ _id: VOISIN, slug: 'voisin', name: 'Le Voisin', plan: 'boost' });
  users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr', tenantId: null, role: 'sm_admin' });
  users.seed({
    _id: PATRON,
    tenantId: CLASSFOOD,
    email: 'patron@classfood.fr',
    name: 'Sofiane',
    role: 'owner',
    passwordHash: EMPREINTE,
    createdAt: new Date('2026-01-04T09:00:00Z'),
  });

  const hasher: SecretHasher = {
    providerName: 'test',
    hash: async (secret) => `hash(${secret})`,
    verify: async () => true,
  };

  const admin = new AdminService(
    tenants.asModel<Tenant>(),
    devices.asModel<Device>(),
    screens.asModel<Screen>(),
    logs.asModel<AdminLog>(),
    users.asModel<User>(),
    testOriginesImages(),
  );

  const revocations = { user: vi.fn(async () => {}) };
  const comptes = new ComptesService(
    tenants.asModel<Tenant>(),
    users.asModel<User>(),
    hasher,
    admin,
    revocations as never,
  );

  return { comptes, users, logs, tenants, revocations };
}

/** Un cogérant déjà en place chez Class'Food, empreinte comprise. */
function seedCogerant(users: FakeCollection, tenantId = CLASSFOOD, id = COGERANT) {
  users.seed({
    _id: id,
    tenantId,
    email: 'sarah@classfood.fr',
    name: 'Sarah',
    role: 'cogerant',
    passwordHash: EMPREINTE,
    createdAt: new Date('2026-03-01T09:00:00Z'),
  });
}

describe('Comptes d’un restaurant — la liste', () => {
  it('ne laisse JAMAIS sortir l’empreinte du mot de passe', async () => {
    // La doublure IGNORE la projection Mongo et rend le document entier : c'est
    // exactement la situation qu'on veut tester — la seconde ligne de défense
    // (`projeterCompte`) seule, sans la première.
    const { comptes, users } = build();
    seedCogerant(users);

    const vue = await comptes.list(CLASSFOOD);

    expect(JSON.stringify(vue)).not.toContain('argon2');
    expect(JSON.stringify(vue)).not.toContain(EMPREINTE);
    expect(JSON.stringify(vue)).not.toContain('passwordHash');
    // Et la liste blanche est bien une liste blanche : aucune clé de plus.
    expect(Object.keys(vue.comptes[0]!).sort()).toEqual([
      'creeLe',
      'email',
      'id',
      'nom',
      'proprietaire',
      'role',
      'roleLabel',
    ]);
  });

  it('met le propriétaire en tête et nomme les rôles en français', async () => {
    const { comptes, users } = build();
    seedCogerant(users);
    const vue = await comptes.list(CLASSFOOD);
    expect(vue.comptes.map((c) => c.role)).toEqual(['owner', 'cogerant']);
    expect(vue.comptes.map((c) => c.roleLabel)).toEqual(['Propriétaire', 'Cogérant']);
    expect(vue.comptes[0]!.proprietaire).toBe(true);
  });

  it('rend le plafond de la formule et ce qu’il en reste', async () => {
    const { comptes, users } = build('complet');
    expect(await comptes.list(CLASSFOOD)).toMatchObject({ max: 2, restants: 1 });
    seedCogerant(users);
    expect(await comptes.list(CLASSFOOD)).toMatchObject({ max: 2, restants: 0 });
  });

  it('ne rend jamais un solde négatif quand une offre a été redescendue', async () => {
    // Un client passé de Boost à Essentiel garde ses comptes — on ne coupe
    // l'accès de personne à l'occasion d'un changement de formule. L'écran doit
    // afficher « 0 restant », jamais « −2 restants ».
    const { comptes, users } = build('essentiel');
    seedCogerant(users);
    seedCogerant(users, CLASSFOOD, '65f0000000000000000000a9');
    const vue = await comptes.list(CLASSFOOD);
    expect(vue).toMatchObject({ max: 1, restants: 0 });
    expect(vue.comptes).toHaveLength(3);
  });

  it('ne voit que les comptes DE cet établissement', async () => {
    const { comptes, users } = build();
    seedCogerant(users, VOISIN, CHEZ_LE_VOISIN);
    const vue = await comptes.list(CLASSFOOD);
    expect(vue.comptes.map((c) => c.id)).toEqual([PATRON]);
  });

  it('refuse un identifiant d’établissement qui n’en est pas un', async () => {
    const { comptes } = build();
    await expect(comptes.list('copié-à-la-main')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Comptes d’un restaurant — ouvrir', () => {
  it('rend le mot de passe UNE fois, et jamais l’empreinte', async () => {
    const { comptes, users, logs } = build();

    const cree = await comptes.create(SM, CLASSFOOD, {
      email: 'Sarah@ClassFood.fr',
      nom: 'Sarah',
      role: 'cogerant',
    });

    expect(cree.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    // L'adresse est normalisée : la connexion cherche en minuscules.
    expect(cree.email).toBe('sarah@classfood.fr');
    expect(JSON.stringify(cree)).not.toContain('argon2');

    // En base, c'est l'EMPREINTE qui est stockée — jamais le secret en clair.
    const stocke = users.rows.find((r) => r.email === 'sarah@classfood.fr')!;
    expect(stocke.passwordHash).toBe(`hash(${cree.password})`);
    expect(Object.values(stocke)).not.toContain(cree.password);
    // Une génération de session neuve : `0` est la valeur de compatibilité des
    // comptes historiques, pas celle d'un compte créé aujourd'hui.
    expect(String(stocke.sessionVersion)).not.toBe('0');

    // Le journal porte l'adresse et le rôle, jamais le secret.
    const ligne = logs.rows.find((r) => r.action === 'tenant.compte_create')!;
    expect(ligne.targetId).toBe(cree.id);
    expect(JSON.stringify(ligne)).not.toContain(cree.password);
    expect(ligne.meta).toMatchObject({ email: 'sarah@classfood.fr', role: 'cogerant' });
  });

  it('refuse EN CHIFFRES quand la formule n’ouvre plus de place', async () => {
    const { comptes, users } = build('complet');
    seedCogerant(users);

    const refus = await comptes
      .create(SM, CLASSFOOD, { email: 'compta@classfood.fr', nom: 'Léa', role: 'comptable' })
      .catch((e: unknown) => e);

    expect(refus).toBeInstanceOf(ConflictException);
    // Le nombre, pas « limite atteinte » : c'est ce qui permet à l'opérateur de
    // dire au téléphone ce qu'il faut faire.
    expect((refus as ConflictException).message).toContain('2 comptes');
    expect((refus as ConflictException).message).toMatch(/révoquez|offre supérieure/);
    // Rien n'a été créé — un refus de quota ne laisse pas de compte orphelin.
    expect(users.rows.filter((r) => r.tenantId === CLASSFOOD)).toHaveLength(2);
  });

  it('refuse une adresse déjà prise, EN NOMMANT l’établissement qui la porte', async () => {
    const { comptes, users } = build('boost');
    seedCogerant(users, VOISIN, CHEZ_LE_VOISIN);

    const refus = await comptes
      .create(SM, CLASSFOOD, { email: 'sarah@classfood.fr', nom: 'Sarah', role: 'cogerant' })
      .catch((e: unknown) => e);

    expect(refus).toBeInstanceOf(ConflictException);
    // Nommer le restaurant n'est pas une fuite : ce message ne part que vers le
    // CRM, dont l'opérateur voit déjà tout le parc — et c'est l'information dont
    // il a besoin pour trancher.
    expect((refus as ConflictException).message).toContain('Le Voisin');
    expect((refus as ConflictException).message).toContain('sarah@classfood.fr');
  });

  it('nomme Snack Manager quand l’adresse est celle d’un compte d’équipe', async () => {
    const { comptes } = build('boost');
    const refus = await comptes
      .create(SM, CLASSFOOD, { email: 'admin@snackmanager.fr', nom: 'X', role: 'cogerant' })
      .catch((e: unknown) => e);
    expect((refus as ConflictException).message).toContain('Snack Manager');
  });

  it('n’ouvre pas un compte sur un établissement inexistant', async () => {
    const { comptes, users } = build();
    await expect(
      comptes.create(SM, '65f0000000000000000000ee', {
        email: 'x@y.fr',
        nom: 'X',
        role: 'cogerant',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.rows.some((r) => r.email === 'x@y.fr')).toBe(false);
  });
});

describe('Comptes d’un restaurant — changer de rôle', () => {
  it('change le rôle, coupe les sessions, et journalise le motif', async () => {
    const { comptes, users, logs, revocations } = build('boost');
    seedCogerant(users);
    const avant = String(users.rows.find((r) => r._id === COGERANT)!.sessionVersion ?? '0');

    const vue = await comptes.changeRole(SM, CLASSFOOD, COGERANT, {
      role: 'comptable',
      motif: 'Reprend la comptabilité, ne fait plus le service',
    });

    expect(vue.comptes.find((c) => c.id === COGERANT)!.role).toBe('comptable');
    const apres = users.rows.find((r) => r._id === COGERANT)!;
    expect(apres.role).toBe('comptable');
    // LA GÉNÉRATION CHANGE : les jetons déjà émis cessent d'être acceptés.
    expect(String(apres.sessionVersion)).not.toBe(avant);
    // Et les sockets déjà ouvertes sont coupées sans attendre la revalidation.
    expect(revocations.user).toHaveBeenCalledWith(CLASSFOOD, COGERANT);

    const ligne = logs.rows.find((r) => r.action === 'tenant.compte_role')!;
    expect(ligne.reason).toBe('Reprend la comptabilité, ne fait plus le service');
    expect(ligne.meta).toMatchObject({ roleAvant: 'cogerant', role: 'comptable' });
  });

  it('refuse de changer le rôle du propriétaire', async () => {
    const { comptes, users } = build('boost');
    const refus = await comptes
      .changeRole(SM, CLASSFOOD, PATRON, { role: 'comptable', motif: 'Essai' })
      .catch((e: unknown) => e);

    expect(refus).toBeInstanceOf(BadRequestException);
    expect((refus as BadRequestException).message).toContain('abonnement');
    // La garde vit dans le SERVICE : l'écran cache déjà le bouton, ce qui ne
    // garde rien. Le document n'a pas bougé.
    expect(users.rows.find((r) => r._id === PATRON)!.role).toBe('owner');
  });

  it('refuse un geste qui ne changerait rien', async () => {
    const { comptes, users, logs } = build('boost');
    seedCogerant(users);
    await expect(
      comptes.changeRole(SM, CLASSFOOD, COGERANT, { role: 'cogerant', motif: 'Pour voir' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Aucune ligne de journal : une ligne qui ne raconte rien salit le registre
    // qu'on ouvre au litige.
    expect(logs.rows.some((r) => r.action === 'tenant.compte_role')).toBe(false);
  });

  it('n’atteint pas le compte d’un autre établissement, même avec son identifiant', async () => {
    const { comptes, users, revocations } = build('boost');
    seedCogerant(users, VOISIN, CHEZ_LE_VOISIN);

    await expect(
      comptes.changeRole(SM, CLASSFOOD, CHEZ_LE_VOISIN, {
        role: 'comptable',
        motif: 'Tentative',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.rows.find((r) => r._id === CHEZ_LE_VOISIN)!.role).toBe('cogerant');
    expect(revocations.user).not.toHaveBeenCalled();
  });
});

describe('Comptes d’un restaurant — révoquer', () => {
  it('supprime le compte, coupe les sessions et garde la trace au journal', async () => {
    const { comptes, users, logs, revocations } = build('boost');
    seedCogerant(users);

    const vue = await comptes.revoke(SM, CLASSFOOD, COGERANT, {
      motif: 'A quitté l’établissement le 30/08',
    });

    // Le document est SUPPRIMÉ : l'adresse redevient libre pour son remplaçant,
    // et aucune empreinte de mot de passe ne dort en base.
    expect(users.rows.some((r) => r._id === COGERANT)).toBe(false);
    expect(vue.comptes.map((c) => c.id)).toEqual([PATRON]);
    expect(vue.restants).toBe(3);
    expect(revocations.user).toHaveBeenCalledWith(CLASSFOOD, COGERANT);

    // CE QUI SURVIT : la ligne de journal se comprend seule, sans jointure vers
    // un document qui n'existe plus.
    const ligne = logs.rows.find((r) => r.action === 'tenant.compte_revoke')!;
    expect(ligne.reason).toBe('A quitté l’établissement le 30/08');
    expect(ligne.meta).toMatchObject({ email: 'sarah@classfood.fr', role: 'cogerant' });
    expect(ligne.targetId).toBe(COGERANT);
  });

  it('refuse de révoquer le propriétaire', async () => {
    const { comptes, users, revocations } = build('boost');

    const refus = await comptes
      .revoke(SM, CLASSFOOD, PATRON, { motif: 'Ménage' })
      .catch((e: unknown) => e);

    expect(refus).toBeInstanceOf(BadRequestException);
    // Un restaurant sans propriétaire est un restaurant qu'on ne peut plus
    // facturer : le compte est toujours là, et aucune session n'a été coupée.
    expect(users.rows.some((r) => r._id === PATRON)).toBe(true);
    expect(revocations.user).not.toHaveBeenCalled();
  });

  it('n’atteint pas le compte d’un autre établissement', async () => {
    const { comptes, users } = build('boost');
    seedCogerant(users, VOISIN, CHEZ_LE_VOISIN);
    await expect(
      comptes.revoke(SM, CLASSFOOD, CHEZ_LE_VOISIN, { motif: 'Tentative' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.rows.some((r) => r._id === CHEZ_LE_VOISIN)).toBe(true);
  });
});

describe('Le plafond de comptes est une décision d’offre', () => {
  it('accorde un compte de plus à chaque palier, propriétaire compris', () => {
    // Les valeurs elles-mêmes sont épinglées ici — le tableau est un TARIF : le
    // changer doit se voir, et ne doit jamais se faire par inadvertance.
    expect(COMPTES_PAR_FORMULE.essentiel).toBe(1);
    expect(COMPTES_PAR_FORMULE.complet).toBe(2);
    expect(COMPTES_PAR_FORMULE.boost).toBe(4);
    expect(COMPTES_SANS_FORMULE).toBe(1);
  });

  it('donne au client sans formule exactement le compte que sa signature a créé', () => {
    // Ni zéro (le parc serait incohérent le jour même de la signature), ni deux
    // (ce serait distribuer gratuitement ce qu'Essentiel fait payer).
    expect(comptesAutorises(null)).toBe(1);
    expect(comptesAutorises(undefined)).toBe(1);
  });

  it('reste défini pour chaque formule de la grille', () => {
    const grille: Record<keyof typeof COMPTES_PAR_FORMULE, number> = COMPTES_PAR_FORMULE;
    for (const [formule, max] of Object.entries(grille)) {
      expect(max, formule).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(max), formule).toBe(true);
    }
  });
});
