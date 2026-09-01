import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { model, type Model } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLATFORM_SETTINGS_ID,
  PlatformSettingsUpdateSchema,
  SOCIAL_NETWORKS,
  type JwtPayload,
  type PlatformSettingsUpdate,
} from '@sm/contracts';
import { AdminLogSchema, type AdminLog, type Device, type PlatformSettingsDoc, type Screen, type Staff, type Tenant, type User } from '@sm/db';
import { AuthGuard } from '../../common/auth';
import { SessionAccessService } from '../../common/session-access';
import { zod } from '../../common/zod.pipe';
import { AdminService } from './admin.service';
import { FakeCollection } from './admin.fakes';
import { PlatformController, PublicPlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * ═══ LES RÉGLAGES DE NOTRE PROPRE VITRINE ═══
 *
 * Ce que ces liens ont de particulier : ils partent sur la page d'accueil de
 * l'entreprise sans relecture. Ce qui est enregistré est publié. Les tests
 * portent donc sur ce qui fait mal — quelqu'un qui écrit sans en avoir le
 * droit, un lien qui mène ailleurs que là où le pictogramme le promet, un
 * champ vidé qui ne s'efface pas, et la lecture publique quand rien n'est
 * rempli (l'état du jour de la mise en ligne).
 */

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
  exp: 4_102_444_800,
};

const RESTO = '65f000000000000000000001';

/** Le gérant d'un restaurant client — jeton parfaitement valide, autre métier. */
const GERANT: JwtPayload = {
  sub: '65f00000000000000000ee01',
  tenantId: RESTO,
  role: 'owner',
  kind: 'user',
  exp: 4_102_444_800,
};

const INSTAGRAM = 'https://www.instagram.com/snackmanager';
const LINKEDIN = 'https://fr.linkedin.com/company/snackmanager';
const TIKTOK = 'https://www.tiktok.com/@snackmanager';

/** Le corps du PATCH tel qu'il ARRIVE : validé par la pipe, comme en vrai. */
const patch = (body: unknown): PlatformSettingsUpdate =>
  zod(PlatformSettingsUpdateSchema).transform(body) as PlatformSettingsUpdate;

describe('Réglages de plateforme — réseaux sociaux de la vitrine', () => {
  let settings: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let platform: PlatformService;
  let controller: PlatformController;
  let publicController: PublicPlatformController;

  beforeEach(() => {
    settings = new FakeCollection('platform');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });

    const admin = new AdminService(
      new FakeCollection('tenant').asModel<Tenant>(),
      new FakeCollection('device').asModel<Device>(),
      new FakeCollection('screen').asModel<Screen>(),
      logs.asModel<AdminLog>(),
      users.asModel<User>(),
    );
    platform = new PlatformService(settings.asModel<PlatformSettingsDoc>(), admin);
    controller = new PlatformController(platform);
    publicController = new PublicPlatformController(platform);
  });

  // ─────────────────────────────────────────────────────────────
  // Qui a le droit d'écrire
  // ─────────────────────────────────────────────────────────────

  /**
   * LES DROITS SE VÉRIFIENT SUR LES DÉCORATEURS RÉELS, PAS SUR UNE COPIE.
   *
   * Le guard est le vrai `AuthGuard`, le `Reflector` est celui de Nest, et les
   * métadonnées sont lues sur les classes de contrôleur elles-mêmes. Un test
   * qui se contenterait de vérifier une liste de rôles écrite à la main
   * resterait vert le jour où quelqu'un retire `@Roles('sm_admin')` du
   * contrôleur — c'est-à-dire le jour où le trou s'ouvre.
   */
  /** Une tentative d'appel : tel porteur de jeton, sur telle route réelle. */
  function attempt(
    route: { target: object; handler: unknown },
    token: JwtPayload | null,
  ): Promise<boolean> {
    const jwt = {
      verifyAsync: async (raw: string) => {
        if (raw !== 'jeton' || !token) throw new Error('jeton invalide');
        return token;
      },
    } as unknown as JwtService;

    // Le compte du gérant est ACTIF : le refus qu'on attend doit venir du
    // rôle, pas d'une suspension qui masquerait le vrai comportement.
    const tenants = {
      findById: () => ({ lean: async () => ({ account: { status: 'active' } }) }),
    } as unknown as Model<Tenant>;
    const staff = { findOne: () => ({ lean: async () => null }) } as unknown as Model<Staff>;
    const devices = { findOne: () => ({ lean: async () => null }) } as unknown as Model<Device>;

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: token ? { authorization: 'Bearer jeton' } : {},
          user: undefined,
        }),
      }),
      getHandler: () => route.handler,
      getClass: () => route.target,
    } as unknown as ExecutionContext;

    const sessions = new SessionAccessService(tenants, staff, devices);
    return new AuthGuard(jwt, new Reflector(), sessions).canActivate(context);
  }

  /** PATCH /crm/platform/settings — l'écriture. */
  const ECRITURE = {
    target: PlatformController,
    handler: PlatformController.prototype.update,
  };
  /** GET /public/platform/social — la lecture de la vitrine. */
  const LECTURE_PUBLIQUE = {
    target: PublicPlatformController,
    handler: PublicPlatformController.prototype.social,
  };

  describe('Droits d’accès', () => {
    it('refuse d’écrire sans jeton', async () => {
      await expect(attempt(ECRITURE, null)).rejects.toThrow(UnauthorizedException);
    });

    it('refuse d’écrire avec le jeton d’un GÉRANT de restaurant', async () => {
      // Le cas qui compte : le jeton est valide, le compte est actif, la
      // personne existe — elle n'a simplement rien à faire sur la vitrine de
      // l'entreprise qui lui vend le logiciel. C'est un 403, pas un 401.
      await expect(attempt(ECRITURE, GERANT)).rejects.toThrow(ForbiddenException);
    });

    it('laisse écrire l’équipe Snack Manager', async () => {
      await expect(attempt(ECRITURE, SM)).resolves.toBe(true);
    });

    it('laisse la vitrine LIRE sans aucun jeton', async () => {
      // Une page d'accueil n'a pas de session : exiger un jeton reviendrait à
      // ne jamais afficher les pictogrammes.
      await expect(attempt(LECTURE_PUBLIQUE, null)).resolves.toBe(true);
    });

    it('n’ouvre pas l’écriture en ouvrant la lecture', async () => {
      // Les deux routes vivent dans DEUX classes : rendre la lecture publique
      // ne doit pas rendre le PATCH public. Réunies dans une seule classe, un
      // `@Public()` mal placé ferait exactement cela — et rien ne le dirait.
      await expect(attempt(LECTURE_PUBLIQUE, null)).resolves.toBe(true);
      await expect(attempt(ECRITURE, null)).rejects.toThrow(UnauthorizedException);
      await expect(attempt(ECRITURE, GERANT)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Lecture publique
  // ─────────────────────────────────────────────────────────────

  describe('Lecture publique', () => {
    it('répond les quatre réseaux à null quand RIEN n’est rempli', async () => {
      // L'état du jour de la mise en ligne : aucun document en base. La route
      // doit répondre, pas tomber — sinon la page d'accueil tombe avec elle.
      const social = await publicController.social();

      expect(social).toEqual({
        instagram: null,
        tiktok: null,
        facebook: null,
        linkedin: null,
      });
      // Les quatre clés sont TOUJOURS présentes : sans elles, la vitrine ne
      // peut pas distinguer « pas encore chargé » de « pas de compte ».
      expect(Object.keys(social)).toEqual([...SOCIAL_NETWORKS]);
    });

    it('ne rend RIEN d’interne — ni date de modification, ni auteur', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      const social = await publicController.social();

      // Cette route répond sans authentification : tout ce qu'elle rend est
      // public. Une date de dernière modification n'a l'air de rien et raconte
      // pourtant notre activité interne à qui la relève.
      expect(Object.keys(social).sort()).toEqual([...SOCIAL_NETWORKS].sort());
      expect(social).not.toHaveProperty('updatedAt');
      expect(social).not.toHaveProperty('_id');
      expect(social.instagram).toBe(INSTAGRAM);
    });

    it('ne publie pas une chaîne vide trouvée en base', async () => {
      // Reprise de données, enregistrement antérieur à la règle : `''` est une
      // valeur PRÉSENTE. La vitrine afficherait un pictogramme cliquable qui
      // ne mène nulle part — le défaut exact qu'on veut éviter.
      settings.seed({ _id: PLATFORM_SETTINGS_ID, social: { instagram: '', tiktok: '   ' } });

      const social = await publicController.social();

      expect(social.instagram).toBeNull();
      expect(social.tiktok).toBeNull();
    });

    it('rend la date de modification au CRM, à lui seul', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      const view = await controller.settings();

      expect(view.social.instagram).toBe(INSTAGRAM);
      expect(view.updatedAt).not.toBeNull();
      expect(Date.parse(view.updatedAt!)).not.toBeNaN();
    });

    it('rend updatedAt à null tant que personne n’a rien enregistré', async () => {
      const view = await controller.settings();
      expect(view.updatedAt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Ce que la validation refuse d'écrire
  // ─────────────────────────────────────────────────────────────

  describe('Validation à l’entrée de l’API', () => {
    /** Les messages tels que le formulaire les recevra, chemin compris. */
    const issuesOf = (body: unknown): { path: string; message: string }[] => {
      try {
        patch(body);
        throw new Error('Le corps a été accepté alors qu’il devait être refusé.');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const payload = (error as BadRequestException).getResponse() as {
          issues?: { path: string; message: string }[];
        };
        return payload.issues ?? [];
      }
    };

    it('refuse une adresse TikTok collée dans le champ Instagram', async () => {
      const issues = issuesOf({ social: { instagram: TIKTOK } });

      // Le chemin porte le nom du réseau : c'est ce qui permet à l'écran de
      // poser le message SOUS le bon champ plutôt qu'en haut de page.
      expect(issues[0]!.path).toBe('social.instagram');
      // Et le message nomme les DEUX réseaux : c'est presque toujours une
      // inversion de champ, le lecteur doit comprendre quoi corriger.
      expect(issues[0]!.message).toContain('TikTok');
      expect(issues[0]!.message).toContain('Instagram');

      // Rien n'a été écrit : le refus intervient avant le service.
      expect(settings.size).toBe(0);
      expect(logs.size).toBe(0);
    });

    it('refuse un domaine qui IMITE celui du réseau', () => {
      const issues = issuesOf({ social: { instagram: 'https://instagram.com.exemple.fr/sm' } });
      expect(issues[0]!.path).toBe('social.instagram');
    });

    it('refuse tout le lot quand UN seul lien est fautif', async () => {
      // Accepter les bons et taire le mauvais afficherait « enregistré » sur
      // une saisie partiellement perdue.
      issuesOf({ social: { instagram: INSTAGRAM, linkedin: 'https://exemple.fr/sm' } });

      expect(await publicController.social()).toEqual({
        instagram: null,
        tiktok: null,
        facebook: null,
        linkedin: null,
      });
    });

    it('refuse un lien non sécurisé sur le BON domaine', () => {
      const issues = issuesOf({ social: { instagram: 'http://www.instagram.com/snackmanager' } });
      expect(issues[0]!.message).toContain('https');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Écriture
  // ─────────────────────────────────────────────────────────────

  describe('Enregistrement', () => {
    it('publie un lien et le rend immédiatement à la vitrine', async () => {
      const view = await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      expect(view.social.instagram).toBe(INSTAGRAM);
      expect((await publicController.social()).instagram).toBe(INSTAGRAM);
    });

    it('crée le document au PREMIER enregistrement (upsert), sous la clé constante', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      expect(settings.size).toBe(1);
      expect(settings.rows[0]!._id).toBe(PLATFORM_SETTINGS_ID);

      // Et le deuxième enregistrement modifie CE document, il n'en crée pas un
      // second — deux documents et la vitrine lirait l'un, le CRM l'autre.
      await controller.update(SM, patch({ social: { tiktok: TIKTOK } }));
      expect(settings.size).toBe(1);
    });

    it('ne touche PAS aux réseaux absents de la requête', async () => {
      await controller.update(
        SM,
        patch({ social: { instagram: INSTAGRAM, linkedin: LINKEDIN } }),
      );

      // Une requête qui ne parle que de TikTok ne doit pas effacer les deux
      // autres. C'est le défaut qu'un `$set: { social: objet }` produirait.
      const view = await controller.update(SM, patch({ social: { tiktok: TIKTOK } }));

      expect(view.social).toEqual({
        instagram: INSTAGRAM,
        tiktok: TIKTOK,
        facebook: null,
        linkedin: LINKEDIN,
      });
    });

    it('EFFACE le lien quand le champ est vidé', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      // Un <input> vidé transmet `""`, jamais `null` : c'est la forme réelle
      // qui arrive du formulaire.
      const view = await controller.update(SM, patch({ social: { instagram: '' } }));

      expect(view.social.instagram).toBeNull();
      expect((await publicController.social()).instagram).toBeNull();
      // `null` et non `''` en base : `''` est une valeur présente, et la
      // vitrine afficherait un pictogramme menant nulle part.
      const stored = settings.rows[0]!.social as Record<string, unknown>;
      expect(stored.instagram).toBeNull();
    });

    it('efface aussi sur un `null` explicite', async () => {
      await controller.update(SM, patch({ social: { linkedin: LINKEDIN } }));
      const view = await controller.update(SM, patch({ social: { linkedin: null } }));
      expect(view.social.linkedin).toBeNull();
    });

    it('n’écrit rien quand la requête ne demande rien', async () => {
      const view = await controller.update(SM, patch({}));

      expect(view.social.instagram).toBeNull();
      expect(settings.size).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Journal
  // ─────────────────────────────────────────────────────────────

  describe('Trace au journal', () => {
    it('date et attribue chaque publication', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      expect(logs.size).toBe(1);
      const entry = logs.rows[0]!;
      expect(entry.action).toBe('platform.social_change');
      expect(String(entry.actorId)).toBe(SM.sub);
      // Dénormalisé à l'écriture, comme le reste du journal : ce qui est écrit
      // reste écrit, même si le compte d'équipe est renommé plus tard.
      expect(entry.actorEmail).toBe('admin@snackmanager.fr');
      expect(Date.parse(String(entry.at))).not.toBeNaN();
    });

    it('ne rattache la ligne à AUCUN établissement', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      // Ce réglage est celui de la plateforme : lui inventer un tenant
      // salirait le journal d'un client qui n'y est pour rien.
      expect(logs.rows[0]!.tenantId).toBeNull();
    });

    it('dit ce qui a changé, dans une phrase qui se lit', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));
      await controller.update(
        SM,
        patch({ social: { instagram: '', linkedin: LINKEDIN } }),
      );

      const derniere = logs.rows[1]!;
      expect(derniere.reason).toBe('Instagram retiré, LinkedIn publié');
      // `meta` porte l'ancienne valeur : « ce lien pointait où, avant ? » doit
      // se répondre sans deviner.
      expect(derniere.meta).toEqual({
        changes: [
          { network: 'instagram', from: INSTAGRAM, to: null },
          { network: 'linkedin', from: null, to: LINKEDIN },
        ],
      });
    });

    it('ne journalise pas un enregistrement qui ne change rien', async () => {
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));
      await controller.update(SM, patch({ social: { instagram: INSTAGRAM } }));

      // Ouvrir l'écran et cliquer « Enregistrer » sans rien toucher est un
      // geste banal. Le tracer noierait les vraies modifications, et un
      // journal qu'on cesse de lire ne protège plus personne.
      expect(logs.size).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Le modèle lui-même
// ─────────────────────────────────────────────────────────────

describe('Le journal accepte une action de plateforme, et rien de plus', () => {
  const AdminLogModel = model('AdminLogPlatformTest', AdminLogSchema);

  it('accepte une ligne de plateforme SANS établissement', () => {
    const doc = new AdminLogModel({
      actorId: SM.sub,
      action: 'platform.social_change',
      reason: 'Instagram publié',
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('exige TOUJOURS un établissement pour une action qui vise un client', () => {
    // Le garde-fou qu'on aurait perdu en passant simplement `tenantId` à
    // `required: false` : une ligne « compte suspendu » qui ne dit pas de quel
    // compte il s'agit.
    const doc = new AdminLogModel({ actorId: SM.sub, action: 'tenant.suspend' });
    expect(doc.validateSync()?.errors.tenantId).toBeDefined();
  });

  it('refuse une action inconnue — l’enum recopie bien le contrat', () => {
    const doc = new AdminLogModel({ actorId: SM.sub, action: 'platform.inventée' });
    expect(doc.validateSync()?.errors.action).toBeDefined();
  });
});
