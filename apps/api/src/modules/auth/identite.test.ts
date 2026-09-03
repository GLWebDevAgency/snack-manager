import 'reflect-metadata';
import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Model } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { StaffSchema, UserSchema, type Staff, type User } from '@sm/db';
import { IS_PUBLIC, ROLES } from '../../common/auth';
import { AuthController } from './auth.controller';
import { IdentiteController } from './identite.controller';
import {
  IDENTITE_COMPTE_FIELDS,
  IDENTITE_EQUIPE_FIELDS,
  IdentiteService,
} from './identite.service';

const TENANT = '65f000000000000000000001';
const OWNER = '65f000000000000000000031';
const MEMBRE = '65f000000000000000000011';
const SM = '65f000000000000000000099';

/**
 * Le document tel qu'il DORT EN BASE — empreinte du mot de passe comprise.
 *
 * Le double de modèle rend volontairement TOUT le document, sans appliquer la
 * projection : c'est la seule façon de vérifier que la réponse est construite
 * champ par champ et ne recopie pas ce qu'on lui tend. Un service qui ferait
 * `{ ...compte }` passerait la projection et échouerait ici — ce qui est
 * exactement le défaut qu'on veut voir tomber.
 */
const COMPTE_EN_BASE = {
  _id: OWNER,
  email: 'patron@le-comptoir.fr',
  name: 'Camille Fournier',
  role: 'owner',
  tenantId: TENANT,
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2VjcmV0$empreinte-a-ne-jamais-rendre',
  sessionVersion: 'user-v1',
};

const MEMBRE_EN_BASE = {
  _id: MEMBRE,
  tenantId: TENANT,
  name: 'Sofia',
  role: 'caisse',
  pinHash: '$argon2id$v=19$m=65536,t=3,p=4$c2VsMg$empreinte-du-code',
  hourlyCostCents: 1_450,
  active: true,
  sessionVersion: 'staff-v1',
};

type Lecture = { filtre: unknown; projection: unknown };
type Ecriture = { id: unknown; maj: unknown; options: unknown };

/**
 * Service doublé, avec le JOURNAL des lectures : les tests ci-dessous
 * n'inspectent pas seulement la réponse, ils regardent AUSSI ce que le service
 * a demandé à Mongo. Une réponse propre obtenue en ramenant tout le document
 * laisserait l'empreinte traverser le réseau interne et les journaux de la
 * base ; ce n'est pas la même chose que ne jamais l'avoir lue.
 */
function service(
  docs: { compte?: Record<string, unknown> | null; membre?: Record<string, unknown> | null } = {},
): { service: IdentiteService; lectures: Lecture[]; ecritures: Ecriture[] } {
  const lectures: Lecture[] = [];
  const ecritures: Ecriture[] = [];
  const compte = docs.compte === undefined ? COMPTE_EN_BASE : docs.compte;
  const membre = docs.membre === undefined ? MEMBRE_EN_BASE : docs.membre;

  const users = {
    findById: (filtre: unknown, projection: unknown) => {
      lectures.push({ filtre, projection });
      return { lean: async () => compte };
    },
    // Même parti pris que la lecture : le double rend le document ENTIER, sans
    // appliquer la projection. Un service qui recopierait ce que Mongo lui tend
    // laisserait donc passer `passwordHash` — et c'est ce qu'on veut voir
    // tomber, sur le chemin d'écriture comme sur celui de lecture.
    findByIdAndUpdate: (id: unknown, maj: unknown, options: unknown) => {
      ecritures.push({ id, maj, options });
      const nom = (maj as { $set?: { name?: string } }).$set?.name;
      return { lean: async () => (compte ? { ...compte, name: nom } : null) };
    },
  } as unknown as Model<User>;

  const staff = {
    findOne: (filtre: unknown, projection: unknown) => {
      lectures.push({ filtre, projection });
      return { lean: async () => membre };
    },
  } as unknown as Model<Staff>;

  return { service: new IdentiteService(users, staff), lectures, ecritures };
}

const sessionCompte = (patch: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: OWNER,
  tenantId: TENANT,
  role: 'owner',
  kind: 'user',
  userSessionVersion: 'user-v1',
  exp: 4_102_444_800,
  ...patch,
});

const sessionEquipe = (patch: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: MEMBRE,
  tenantId: TENANT,
  role: 'caisse',
  kind: 'staff',
  staffSessionVersion: 'staff-v1',
  deviceId: '65f000000000000000000021',
  deviceSessionVersion: 'device-v1',
  exp: 4_102_444_800,
  ...patch,
});

describe('GET /auth/me — la personne derrière le jeton', () => {
  it('rend le propriétaire : nom, courriel, rôle, établissement', async () => {
    const { service: identite } = service();
    await expect(identite.moi(sessionCompte())).resolves.toEqual({
      id: OWNER,
      nom: 'Camille Fournier',
      role: 'owner',
      genre: 'user',
      email: 'patron@le-comptoir.fr',
      tenantId: TENANT,
    });
  });

  it('rend un membre d’équipe sans courriel — un code n’en a pas', async () => {
    const { service: identite } = service();
    await expect(identite.moi(sessionEquipe())).resolves.toEqual({
      id: MEMBRE,
      nom: 'Sofia',
      role: 'caisse',
      genre: 'staff',
      email: null,
      tenantId: TENANT,
    });
  });

  it('rend `tenantId: null` pour l’équipe Snack Manager', async () => {
    // `sm_admin` n'administre aucun restaurant : son document porte
    // `tenantId: null`, et la réponse doit le dire plutôt que d'inventer un
    // établissement — la coquille `/sm` s'en sert pour savoir qu'elle est chez
    // elle.
    const { service: identite } = service({
      compte: { _id: SM, email: 'equipe@snackmanager.fr', name: 'Ghassène', role: 'sm_admin', tenantId: null },
    });
    await expect(identite.moi(sessionCompte({ sub: SM, role: 'sm_admin', tenantId: null }))).resolves.toEqual(
      {
        id: SM,
        nom: 'Ghassène',
        role: 'sm_admin',
        genre: 'user',
        email: 'equipe@snackmanager.fr',
        tenantId: null,
      },
    );
  });

  it('lit le membre d’équipe DANS SON établissement, jamais ailleurs', async () => {
    // Le `tenantId` vient du jeton, comme partout : un identifiant emprunté à
    // un autre restaurant ne doit pas rendre le nom de son porteur.
    const { service: identite, lectures } = service();
    await identite.moi(sessionEquipe());
    expect(lectures[0]?.filtre).toEqual({ _id: MEMBRE, tenantId: TENANT });
  });

  it('rend un nom vide plutôt qu’un nom inventé', async () => {
    // `name` a `default: ''` dans le schéma : un compte historique peut n'en
    // porter aucun. L'API ne comble pas le trou — c'est l'écran qui décide
    // quoi montrer quand le nom manque, et il montre un état neutre.
    const { service: identite } = service({
      compte: { ...COMPTE_EN_BASE, name: '   ' },
    });
    await expect(identite.moi(sessionCompte())).resolves.toMatchObject({ nom: '' });
  });
});

/**
 * ─── L'EMPREINTE DU MOT DE PASSE NE SORT PAS ───
 *
 * C'est la raison d'être de la projection en liste blanche. Ces cas échouent
 * si quelqu'un la remplace par une projection par retrait, l'oublie, ou rend
 * le document tel quel.
 */
describe('ce que la réponse n’a pas le droit de porter', () => {
  it('ne rend jamais l’empreinte du mot de passe', async () => {
    const { service: identite } = service();
    const rendu = await identite.moi(sessionCompte());
    expect(JSON.stringify(rendu)).not.toContain('argon2');
    expect(rendu).not.toHaveProperty('passwordHash');
  });

  it('ne rend ni le code de la tablette ni le salaire du membre d’équipe', async () => {
    const { service: identite } = service();
    const rendu = await identite.moi(sessionEquipe());
    expect(rendu).not.toHaveProperty('pinHash');
    expect(rendu).not.toHaveProperty('hourlyCostCents');
    expect(JSON.stringify(rendu)).not.toContain('argon2');
  });

  it('rend exactement six champs — un de plus serait une fuite non relue', async () => {
    const { service: identite } = service();
    expect(Object.keys(await identite.moi(sessionCompte())).sort()).toEqual([
      'email',
      'genre',
      'id',
      'nom',
      'role',
      'tenantId',
    ]);
  });

  it('ne DEMANDE même pas l’empreinte à la base', async () => {
    const { service: identite, lectures } = service();
    await identite.moi(sessionCompte());
    expect(lectures[0]?.projection).toEqual(IDENTITE_COMPTE_FIELDS);
    expect(IDENTITE_COMPTE_FIELDS).not.toHaveProperty('passwordHash');
  });

  it('ne demande à la base ni `pinHash` ni `hourlyCostCents`', async () => {
    const { service: identite, lectures } = service();
    await identite.moi(sessionEquipe());
    expect(lectures[0]?.projection).toEqual(IDENTITE_EQUIPE_FIELDS);
    expect(IDENTITE_EQUIPE_FIELDS).not.toHaveProperty('pinHash');
    expect(IDENTITE_EQUIPE_FIELDS).not.toHaveProperty('hourlyCostCents');
  });

  it('reste une liste BLANCHE : que des `1`, jamais un `0`', () => {
    // Un seul `0` bascule Mongo en projection par RETRAIT : tous les autres
    // champs reviennent, y compris ceux ajoutés au schéma demain.
    for (const champs of [IDENTITE_COMPTE_FIELDS, IDENTITE_EQUIPE_FIELDS]) {
      expect(Object.values(champs)).not.toContain(0);
      expect(new Set(Object.values(champs))).toEqual(new Set([1]));
    }
  });

  it('ne nomme que des champs qui existent vraiment dans les schémas', () => {
    // Une projection sur un champ absent ne rend rien et ne dit rien : la
    // réponse se viderait en silence après un renommage de colonne.
    const absentsCompte = Object.keys(IDENTITE_COMPTE_FIELDS).filter((c) => !UserSchema.path(c));
    const absentsEquipe = Object.keys(IDENTITE_EQUIPE_FIELDS).filter((c) => !StaffSchema.path(c));
    expect(absentsCompte).toEqual([]);
    expect(absentsEquipe).toEqual([]);
  });
});

/**
 * ─── LE COMPTE QUI DISPARAÎT ENTRE L'ÉMISSION ET L'APPEL ───
 *
 * Le garde global relit la session à chaque requête (`SessionAccessService`) :
 * un compte supprimé, un salarié désactivé ou une tablette dépairée sont déjà
 * refusés avant d'arriver ici. Reste la disparition qui tombe ENTRE sa lecture
 * et la nôtre — le service ne fabrique alors aucune identité.
 */
describe('quand la personne n’existe plus', () => {
  it('refuse plutôt que de rendre une identité vide', async () => {
    await expect(service({ compte: null }).service.moi(sessionCompte())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service({ membre: null }).service.moi(sessionEquipe())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

/**
 * ─── POSER SON PROPRE NOM ───
 *
 * `users.name` n'avait qu'un seul auteur — la conversion d'un lead — et aucune
 * route ne le mettait à jour : laissé vide à la signature, il l'était pour
 * toujours, et se lisait comme un tiret en pied des deux barres.
 */
describe('PATCH /auth/me — le nom de la personne connectée', () => {
  it('écrit le nom et rend l’identité à jour', async () => {
    const { service: identite } = service();
    await expect(
      identite.poserMonNom(sessionCompte(), { nom: 'Camille F. Dupont' }),
    ).resolves.toEqual({
      id: OWNER,
      nom: 'Camille F. Dupont',
      role: 'owner',
      genre: 'user',
      email: 'patron@le-comptoir.fr',
      tenantId: TENANT,
    });
  });

  it('écrit SUR SOI, et seulement le nom', async () => {
    // Le sujet vient du jeton : aucun identifiant ne circule dans le corps, et
    // le `$set` ne porte qu'une clé — le rôle, l'établissement et l'empreinte
    // ne sont pas des champs que l'on se donne à soi-même.
    const { service: identite, ecritures } = service();
    await identite.poserMonNom(sessionCompte(), { nom: 'Camille' });
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0]?.id).toBe(OWNER);
    expect(ecritures[0]?.maj).toEqual({ $set: { name: 'Camille' } });
  });

  it('relit par la MÊME liste blanche que la lecture', async () => {
    // Sans cette projection, `findByIdAndUpdate` rend le document entier : la
    // réponse d'écriture ferait sortir l'empreinte par une porte que la
    // lecture, elle, tient fermée. `new: true` rend ce qui vient d'être écrit.
    const { service: identite, ecritures } = service();
    await identite.poserMonNom(sessionCompte(), { nom: 'Camille' });
    expect(ecritures[0]?.options).toEqual({ new: true, projection: IDENTITE_COMPTE_FIELDS });
  });

  it('ne rend jamais l’empreinte du mot de passe', async () => {
    const { service: identite } = service();
    const rendu = await identite.poserMonNom(sessionCompte(), { nom: 'Camille' });
    expect(JSON.stringify(rendu)).not.toContain('argon2');
    expect(rendu).not.toHaveProperty('passwordHash');
    expect(Object.keys(rendu).sort()).toEqual([
      'email',
      'genre',
      'id',
      'nom',
      'role',
      'tenantId',
    ]);
  });

  it('refuse une session ouverte au CODE — et n’écrit rien', async () => {
    // Un porteur de code n'a pas de compte dans `users` : son nom vit dans
    // `staff`, posé par celui qui l'embauche (`StaffController` porte
    // `@Roles('owner', 'gerant')`). Le laisser se renommer depuis la tablette
    // du comptoir donnerait à qui connaît quatre chiffres le pouvoir de
    // réécrire le nom qui signe le journal et les pointages.
    const { service: identite, ecritures } = service();
    await expect(identite.poserMonNom(sessionEquipe(), { nom: 'Sofia B.' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(ecritures).toEqual([]);
  });

  it('refuse plutôt que de nommer un compte disparu entre-temps', async () => {
    const { service: identite } = service({ compte: null });
    await expect(identite.poserMonNom(sessionCompte(), { nom: 'Camille' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

/**
 * ─── LA ROUTE ELLE-MÊME ───
 *
 * Ces trois cas ne testent pas du code, ils testent des DÉCISIONS : l'adresse
 * exacte, l'absence de restriction par rôle, et le fait qu'elle reste
 * authentifiée. Chacune se perdrait en silence sous un décorateur ajouté par
 * habitude.
 */
describe('la route d’identité', () => {
  it('répond à GET /auth/me', () => {
    expect(Reflect.getMetadata(PATH_METADATA, IdentiteController)).toBe('auth');
    const handler = IdentiteController.prototype.moi;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('me');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('écrit à la MÊME adresse — PATCH /auth/me', () => {
    // La même chose, lue et posée au même endroit : une route « /auth/nom » à
    // côté ferait deux vérités sur un seul champ.
    const handler = IdentiteController.prototype.poserMonNom;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('me');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
  });

  it('n’est réservée à AUCUN rôle — savoir qui l’on est n’est pas un privilège', () => {
    // Un `@Roles(...)` ici cacherait son propre nom à une session qui vient de
    // le prouver : la caisse et la cuisine ouvrent la même barre que le patron.
    // L'écriture suit la même règle : ce qui la borne est la NATURE de la
    // session (un code n'a pas de compte), pas un rôle.
    expect(Reflect.getMetadata(ROLES, IdentiteController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES, IdentiteController.prototype.moi)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES, IdentiteController.prototype.poserMonNom)).toBeUndefined();
  });

  it('reste authentifiée — jamais `@Public()`', () => {
    // Le garde global couvre tout ce qui n'est pas marqué public. Sans jeton
    // valide, il n'y a personne à nommer : la route n'a pas de sens ouverte.
    expect(Reflect.getMetadata(IS_PUBLIC, IdentiteController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC, IdentiteController.prototype.moi)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC, IdentiteController.prototype.poserMonNom),
    ).toBeUndefined();
  });

  it('vit hors du contrôleur de connexion, dont le plafond de débit n’est pas le sien', () => {
    // `AuthController` limite à dix appels par minute et par adresse pour
    // protéger la CONNEXION. Un restaurant sort par une seule adresse publique :
    // le comptoir, la cuisine et le bureau useraient ce quota en un service, et
    // les écrans perdraient leur identité sans que rien ne l'explique.
    expect(Object.getOwnPropertyNames(AuthController.prototype)).not.toContain('moi');
    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
  });
});
