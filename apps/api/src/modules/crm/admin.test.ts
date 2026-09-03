import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { model, type Model } from 'mongoose';
import {
  EMPTY_SERVICES,
  ACCOUNT_SUSPENDED_MESSAGE,
  ADMIN_LOG_ACTIONS,
  ADMIN_LOG_ACTION_LABELS,
  ADMIN_PLANS,
  DEVICE_REVOKE_REASONS,
  DIRECTIONS,
  COMPTE_LOG_ACTIONS,
  INVOICE_LOG_ACTIONS,
  PAIRING_CODE_TTL_MS,
  PLANS,
  PUBLIC_ORDERING_SUSPENDED_MESSAGE,
  TENANT_ACCOUNT_STATUSES,
  TENANT_LOG_ACTIONS,
  TenantCapaciteSchema,
  TenantChurnSchema,
  TenantSuspendSchema,
  isAccessBlocked,
  isPairingCodeShape,
  publicOrderingState,
  PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE,
  type AdminInvoiceGesture,
  type AdminLogQuery,
  type JwtPayload,
} from '@sm/contracts';
import { AdminLogSchema, type AdminLog, type Device, type Screen, type Tenant, type User } from '@sm/db';
import { requirePairedDevice } from '../devices/device-access';
import type { DevicesRepository } from '../devices/devices.repository';
import { testOriginesImages } from '../tenants/tenants.fakes';
import { AdminService } from './admin.service';
import { FakeCollection } from './admin.fakes';

const CLASSFOOD = '65f000000000000000000001';
const AUTRE_RESTO = '65f000000000000000000002';
const CAISSE = '65f0000000000000000000a1';
const ECRAN = '65f0000000000000000000b1';
const CAISSE_DU_VOISIN = '65f0000000000000000000a2';
const FACTURE = '65f0000000000000000000f1';
const COMPTE = '65f0000000000000000000c1';

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
};

const TOUT = { limit: 200 } satisfies AdminLogQuery;

describe('Administration client', () => {
  let tenants: FakeCollection;
  let devices: FakeCollection;
  let screens: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let admin: AdminService;

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    devices = new FakeCollection('device');
    screens = new FakeCollection('screen');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');

    tenants.seed({
      _id: CLASSFOOD,
      slug: 'classfood',
      name: "Class'Food",
      plan: 'essentiel',
      founderSeat: true,
      createdAt: new Date('2026-01-04T09:00:00Z'),
    });
    tenants.seed({ _id: AUTRE_RESTO, slug: 'voisin', name: 'Le Voisin', plan: 'complet' });
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });

    admin = new AdminService(
      tenants.asModel<Tenant>(),
      devices.asModel<Device>(),
      screens.asModel<Screen>(),
      logs.asModel<AdminLog>(),
      users.asModel<User>(),
      testOriginesImages(),
    );
  });

  const seedCaisse = () =>
    devices.seed({
      _id: CAISSE,
      tenantId: CLASSFOOD,
      name: 'Caisse comptoir',
      kind: 'pos',
      paired: true,
      deviceToken: 'jeton-de-la-tablette-volée',
      pairingCode: null,
      lastSeenAt: new Date('2026-08-19T11:30:00Z'),
      active: true,
    });

  /** Le dépôt d'appareils tel que le voit la caisse qui appelle l'API. */
  const deviceRepository = (): DevicesRepository =>
    ({
      findByDeviceToken: async (token: string) =>
        (devices.rows.find((r) => r.deviceToken === token && r.paired === true) as never) ?? null,
    }) as unknown as DevicesRepository;

  // ─── Statut de compte ───

  describe('Suspension et réactivation', () => {
    it('déconnecte le temps réel dès que la suspension est enregistrée', async () => {
      const revocations = { tenant: vi.fn().mockResolvedValue(undefined) };
      const avecEvenements = new AdminService(
        tenants.asModel<Tenant>(),
        devices.asModel<Device>(),
        screens.asModel<Screen>(),
        logs.asModel<AdminLog>(),
        users.asModel<User>(),
        testOriginesImages(),
        revocations as never,
      );

      await avecEvenements.suspend(SM, CLASSFOOD, { reason: 'Impayé' });

      expect(revocations.tenant).toHaveBeenCalledWith(CLASSFOOD);
    });

    it('publie la suspension même si le journal échoue ensuite', async () => {
      const revocations = { tenant: vi.fn().mockResolvedValue(undefined) };
      const logsIndisponibles = {
        create: vi.fn().mockRejectedValue(new Error('journal indisponible')),
      } as unknown as Model<AdminLog>;
      const avecEvenements = new AdminService(
        tenants.asModel<Tenant>(),
        devices.asModel<Device>(),
        screens.asModel<Screen>(),
        logsIndisponibles,
        users.asModel<User>(),
        testOriginesImages(),
        revocations as never,
      );

      await expect(
        avecEvenements.suspend(SM, CLASSFOOD, { reason: 'Impayé' }),
      ).rejects.toThrow(/journal indisponible/);

      expect(revocations.tenant).toHaveBeenCalledWith(CLASSFOOD);
      expect((tenants.rows[0]?.account as { status?: string })?.status).toBe('suspended');
    });

    it('suspend un établissement en enregistrant le motif et la date', async () => {
      const view = await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé — relance 3 sans réponse' });

      expect(view.account.status).toBe('suspended');
      expect(view.accessBlocked).toBe(true);
      expect(view.statusLabel).toBe('Suspendu');
      expect(view.account.reason).toBe('Impayé — relance 3 sans réponse');
      expect(view.account.suspendedAt).not.toBeNull();
      // `since` marque le début du statut COURANT, pas l'entrée dans le parc.
      expect(view.account.since).toBe(view.account.suspendedAt);
    });

    it('ne détruit rien : suspendre ne touche ni au nom, ni à la formule', async () => {
      // « Un restaurant suspendu ne doit pas perdre ses données, seulement
      // l'accès. » Le document reste entier, prêt à rouvrir.
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      const row = tenants.rows.find((r) => r._id === CLASSFOOD)!;

      expect(row.name).toBe("Class'Food");
      expect(row.slug).toBe('classfood');
      expect(row.plan).toBe('essentiel');
      expect(row.founderSeat).toBe(true);
    });

    it('rouvre l’accès et efface la trace de blocage — mais pas celle du journal', async () => {
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      const view = await admin.reactivate(SM, CLASSFOOD, { reason: 'Facture réglée' });

      expect(view.account.status).toBe('active');
      expect(view.accessBlocked).toBe(false);
      expect(view.account.suspendedAt).toBeNull();

      // L'épisode reste lisible : c'est tout l'intérêt d'un journal append-only.
      const journal = await admin.journal(CLASSFOOD, TOUT);
      expect(journal.map((e) => e.action)).toContain('tenant.suspend');
      expect(journal.map((e) => e.action)).toContain('tenant.reactivate');
    });

    it('exige un motif pour suspendre, jamais pour réactiver', () => {
      // Fermer la porte d'un commerçant se justifie ; la rouvrir se raconte.
      expect(TenantSuspendSchema.safeParse({ reason: '' }).success).toBe(false);
      expect(TenantSuspendSchema.safeParse({ reason: 'Impayé' }).success).toBe(true);
    });
  });

  describe('Départ d’un client', () => {
    it('acte le départ avec son motif — SANS couper l’accès', async () => {
      const view = await admin.churn(SM, CLASSFOOD, { cause: 'prix', reason: 'Revend le fonds de commerce' });

      expect(view.account.status).toBe('churned');
      expect(view.statusLabel).toBe('Parti');
      // `isAccessBlocked` ne bloque QUE `suspended` : partir n'est pas une
      // sanction, la porte reste ouverte — couper resterait un geste explicite.
      expect(view.accessBlocked).toBe(false);
      expect(view.account.reason).toBe('Revend le fonds de commerce');

      const entry = (await admin.journal(CLASSFOOD, TOUT))[0]!;
      expect(entry.action).toBe('tenant.churn');
      expect(entry.actionLabel).toBe('Départ du client');
      expect(entry.reason).toBe('Revend le fonds de commerce');
    });

    it('ne détruit rien : le compte garde son nom, sa formule, ses données', async () => {
      // « On garde tout, on ne coupe rien de force » — le départ est un
      // constat commercial, pas une purge.
      await admin.churn(SM, CLASSFOOD, { cause: 'prix', reason: 'Fermeture définitive' });
      const row = tenants.rows.find((r) => r._id === CLASSFOOD)!;

      expect(row.name).toBe("Class'Food");
      expect(row.slug).toBe('classfood');
      expect(row.plan).toBe('essentiel');
      expect(row.founderSeat).toBe(true);
    });

    it('solde une suspension en cours — la trace reste au journal', async () => {
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      const view = await admin.churn(SM, CLASSFOOD, { cause: 'prix', reason: 'Ne règle pas, ferme boutique' });

      // Le statut courant n'est plus « suspendu » : `suspendedAt` s'efface,
      // l'épisode se relit au journal, qui ne s'efface pas.
      expect(view.account.status).toBe('churned');
      expect(view.account.suspendedAt).toBeNull();
      const actions = (await admin.journal(CLASSFOOD, TOUT)).map((e) => e.action);
      expect(actions).toContain('tenant.suspend');
      expect(actions).toContain('tenant.churn');
    });

    /**
     * LA CAUSE ET LE DÉTAIL, tous deux exigés.
     *
     * Un motif en texte libre ne s'agrège pas : six départs donnent six phrases
     * et aucun tableau. Or c'est la question qu'un éditeur doit pouvoir se
     * poser au bout d'un an — prix, complexité, fonction manquante ? La cause
     * structurée y répond ; le détail porte le cas particulier, et c'est lui
     * qu'on relit avant d'appeler pour tenter de récupérer le client.
     */
    it('exige un motif — « pourquoi est-il parti ? » doit se lire au journal', () => {
      expect(TenantChurnSchema.safeParse({ cause: 'prix', reason: '' }).success).toBe(false);
      expect(
        TenantChurnSchema.safeParse({ cause: 'concurrent', reason: 'Racheté par une chaîne' })
          .success,
      ).toBe(true);
    });

    it('exige aussi la CAUSE — sans elle, un an de départs ne se compte pas', () => {
      expect(TenantChurnSchema.safeParse({ reason: 'Racheté par une chaîne' }).success).toBe(false);
      // Et une cause inventée ne passe pas : la liste est courte pour rester
      // agrégeable, un menu de quinze causes se remplit au hasard.
      expect(
        TenantChurnSchema.safeParse({ cause: 'pas-content', reason: 'Racheté' }).success,
      ).toBe(false);
    });

    it('enregistre la cause SUR le compte et AU journal', async () => {
      await admin.churn(SM, CLASSFOOD, { cause: 'usage', reason: 'Ne s’en servait plus' });
      const compte = tenants.rows[0]!.account as { churnCause?: string };
      // Sur le compte : c'est l'état courant, lu par la fiche.
      expect(compte.churnCause).toBe('usage');
      // Au journal : c'est l'histoire, et c'est elle qu'on relit pour compter.
      const ligne = logs.rows.find((l) => l.action === 'tenant.churn');
      expect((ligne?.meta as { cause?: string })?.cause).toBe('usage');
    });
  });

  describe('Changement de formule', () => {
    it('journalise l’ancienne et la nouvelle formule', async () => {
      const view = await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'boost',
        onlineOrdering: false,
        billing: 'mensuel',
        services: EMPTY_SERVICES,
        reason: 'Upsell démo',
      });

      expect(view.plan).toBe('boost');
      const entry = (await admin.journal(CLASSFOOD, TOUT)).find(
        (e) => e.action === 'tenant.plan_change',
      );
      // Sans l'ancienne valeur, impossible de dire si le client a monté ou
      // descendu en gamme six mois plus tard.
      expect(entry?.meta).toMatchObject({ from: 'essentiel', to: 'boost' });
      expect(entry?.reason).toBe('Upsell démo');
    });

    /**
     * L'OFFRE ENTIÈRE, PAS SEULEMENT LA FORMULE.
     *
     * `changePlan` n'écrivait que `plan`. Le module de commande en ligne et les
     * services de l'Atelier n'étaient ni activables ni retirables après la
     * signature : un restaurateur qui prenait les réseaux sociaux six mois plus
     * tard n'avait aucun chemin dans le logiciel, et sa facture ne bougeait pas.
     */
    it('écrit le module, l’engagement et les services — pas seulement le plan', async () => {
      const view = await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'complet',
        onlineOrdering: true,
        billing: 'annuel',
        services: { ...EMPTY_SERVICES, presenceInternet: true, reseauxSociaux: 'hebdo' },
        reason: 'Le gérant ajoute les réseaux.',
      });
      expect(view.plan).toBe('complet');
      expect(view.onlineOrdering).toBe(true);
      expect(view.billingCycle).toBe('annuel');
      expect(view.atelier).toMatchObject({ presenceInternet: true, reseauxSociaux: 'hebdo' });
    });

    it('sait RETIRER la formule — un client peut redescendre à l’Atelier seul', async () => {
      const view = await admin.changeOffre(SM, CLASSFOOD, {
        plan: null,
        onlineOrdering: false,
        billing: 'mensuel',
        services: { ...EMPTY_SERVICES, presenceInternet: true },
        reason: 'Garde la présence internet, arrête le logiciel.',
      });
      expect(view.plan).toBeNull();
      expect(view.atelier).toMatchObject({ presenceInternet: true });
    });

    it('retirer tous les services efface l’Atelier — l’absence se lit comme une absence', async () => {
      const view = await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'complet',
        onlineOrdering: false,
        billing: 'mensuel',
        services: EMPTY_SERVICES,
        reason: '',
      });
      expect(view.atelier).toBeNull();
    });

    it('le journal dit ce qui a changé, pas seulement la formule', async () => {
      await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'boost',
        onlineOrdering: true,
        billing: 'mensuel',
        services: EMPTY_SERVICES,
        reason: 'Upsell',
      });
      const entry = (await admin.journal(CLASSFOOD, TOUT)).find(
        (e) => e.action === 'tenant.plan_change',
      );
      expect(entry?.meta).toMatchObject({ from: 'essentiel', to: 'boost' });
      expect(entry?.reason).toBe('Upsell');
    });

    it('ne touche pas au statut de compte', async () => {
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      const view = await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'complet',
        onlineOrdering: false,
        billing: 'mensuel',
        services: EMPTY_SERVICES,
        reason: '',
      });

      // Changer de formule n'est pas une décision d'accès : un client suspendu
      // qu'on repasse en « Complet » reste suspendu.
      expect(view.account.status).toBe('suspended');
      expect(view.accessBlocked).toBe(true);
    });
  });

  // ─── Dérogations de capacité ───

  /**
   * L'EXCEPTION COMMERCIALE, ENFIN ÉCRITE PAR UNE ROUTE.
   *
   * `derogationsCapacite` vivait en base, lue par tout le produit et écrite par
   * personne : la seule façon d'ouvrir la fidélité au pilote ou l'éditeur de
   * carte à un client sans formule était d'ouvrir Mongo. Ces tests vérifient le
   * COMPORTEMENT — ce que le geste change dans les capacités effectives — et
   * pas qu'une méthode existe.
   */
  describe('Dérogations de capacité', () => {
    /** Le geste courant : ouvrir la fidélité à un client qui n'y a pas droit. */
    const pilote = {
      capacite: 'loyalty',
      geste: 'accordee',
      motif: 'Pilote fidélité — vendue en Boost, tournée en Complet',
    } as const;

    it('ouvre une capacité hors formule — le cas du pilote', async () => {
      // Class'Food est en « essentiel » : la fidélité ne lui est pas vendue.
      const avant = await admin.account(SM, CLASSFOOD);
      expect(avant.capacites.find((c) => c.capacite === 'loyalty')).toMatchObject({
        acquise: false,
        origine: null,
      });

      const view = await admin.changeCapacite(SM, CLASSFOOD, pilote);

      expect(view.capacites.find((c) => c.capacite === 'loyalty')).toMatchObject({
        acquise: true,
        origine: 'derogation',
      });
      // La formule n'a PAS bougé : une dérogation n'est pas un changement
      // d'offre, et la facture du client ne doit pas se mettre à mentir.
      expect(view.plan).toBe('essentiel');
    });

    it('ouvre l’éditeur de carte à un client SANS formule', async () => {
      // L'autre cas connu du déploiement : un client Atelier seul, qui n'a
      // aucune colonne dans la grille, et qui doit pourtant tenir sa carte.
      tenants.rows[0]!.plan = null;
      const view = await admin.changeCapacite(SM, CLASSFOOD, {
        capacite: 'menu',
        geste: 'accordee',
        motif: 'Client Atelier seul — tient sa carte chez nous',
      });
      expect(view.capacites.find((c) => c.capacite === 'menu')?.acquise).toBe(true);
    });

    it('ferme une capacité MALGRÉ la formule — et le retrait l’emporte', async () => {
      await admin.changeCapacite(SM, CLASSFOOD, pilote);
      const view = await admin.changeCapacite(SM, CLASSFOOD, {
        capacite: 'loyalty',
        geste: 'retiree',
        motif: 'Pilote suspendu le temps du litige',
      });

      expect(view.capacites.find((c) => c.capacite === 'loyalty')).toMatchObject({
        acquise: false,
        origine: 'derogation',
      });
      // UNE SEULE LIGNE en base : le geste remplace au lieu de s'empiler. Sans
      // ce remplacement, accorder ensuite ne rendrait rien — le retrait
      // l'emporte quel que soit l'ordre des lignes.
      expect(tenants.rows[0]!.derogationsCapacite).toHaveLength(1);
    });

    it('lève une dérogation posée par erreur, et rend la capacité à la formule', async () => {
      // « complet » comprend le coût matière : le retrait a donc un effet, et
      // sa levée doit rendre la capacité à la formule — pas la laisser fermée.
      tenants.rows[0]!.plan = 'complet';
      await admin.changeCapacite(SM, CLASSFOOD, {
        capacite: 'stocks',
        geste: 'retiree',
        motif: 'Mauvais client — erreur de saisie',
      });
      expect((await admin.account(SM, CLASSFOOD)).capacites.find((c) => c.capacite === 'stocks')
        ?.acquise).toBe(false);

      const view = await admin.changeCapacite(SM, CLASSFOOD, {
        capacite: 'stocks',
        geste: 'levee',
        motif: 'Dérogation posée sur le mauvais client',
      });

      expect(view.capacites.find((c) => c.capacite === 'stocks')).toMatchObject({
        acquise: true,
        origine: 'formule',
      });
      expect(tenants.rows[0]!.derogationsCapacite).toEqual([]);
    });

    it('refuse d’accorder une capacité déjà comprise dans la formule', async () => {
      // L'écran ne bougerait pas, l'opérateur croirait avoir agi, et le journal
      // porterait une ligne qui ne raconte rien. Le refus NOMME la source.
      await expect(
        admin.changeCapacite(SM, CLASSFOOD, {
          capacite: 'pos',
          geste: 'accordee',
          motif: 'Geste commercial',
        }),
      ).rejects.toThrow(/déjà comprise dans sa formule/);
      expect(tenants.rows[0]!.derogationsCapacite).toBeUndefined();
    });

    it('refuse de retirer une capacité qu’il n’a pas souscrite', async () => {
      await expect(
        admin.changeCapacite(SM, CLASSFOOD, {
          capacite: 'loyalty',
          geste: 'retiree',
          motif: 'Litige',
        }),
      ).rejects.toThrow(/ne l’a pas souscrite/);
    });

    it('refuse de reposer deux fois la même dérogation', async () => {
      // La ligne existe déjà : l'écran ne bougerait pas, et le journal
      // porterait une seconde ligne qui ne raconte rien. Le refus dit le
      // chemin — lever, puis reposer.
      await admin.changeCapacite(SM, CLASSFOOD, pilote);
      await expect(admin.changeCapacite(SM, CLASSFOOD, pilote)).rejects.toThrow(
        /porte déjà cette dérogation/,
      );
      expect(tenants.rows[0]!.derogationsCapacite).toHaveLength(1);
    });

    it('refuse de lever une dérogation qui n’existe pas', async () => {
      await expect(
        admin.changeCapacite(SM, CLASSFOOD, {
          capacite: 'loyalty',
          geste: 'levee',
          motif: 'Nettoyage',
        }),
      ).rejects.toThrow(/rien à lever/);
    });

    it('refuse une capacité inconnue AVANT d’atteindre le service', () => {
      // La garde est au contrat : une capacité inventée ne doit pas descendre
      // jusqu'à une écriture qui l'accepterait faute d'énumération en base.
      expect(
        TenantCapaciteSchema.safeParse({ ...pilote, capacite: 'fidelite' }).success,
      ).toBe(false);
      expect(TenantCapaciteSchema.safeParse({ ...pilote, motif: '' }).success).toBe(false);
    });

    it('écrit au journal la capacité, le sens, et l’état avant/après', async () => {
      await admin.changeCapacite(SM, CLASSFOOD, pilote);

      const entry = (await admin.journal(CLASSFOOD, TOUT)).find(
        (e) => e.action === 'tenant.capacite_change',
      );
      expect(entry?.actionLabel).toBe('Dérogation de capacité');
      // Le motif EST la phrase du journal : c'est elle qu'on relit au litige.
      expect(entry?.reason).toBe(pilote.motif);
      expect(entry?.meta).toMatchObject({ capacite: 'loyalty', geste: 'accordee' });
      const meta = entry?.meta as { avant: string[]; apres: string[] };
      // L'état complet des deux côtés : « loyalty accordée » seul obligerait à
      // reconstituer de tête ce que le client avait ce jour-là.
      expect(meta.avant).not.toContain('loyalty');
      expect(meta.apres).toContain('loyalty');
    });

    it('signe la dérogation de l’auteur du JETON, jamais d’une valeur transmise', async () => {
      await admin.changeCapacite(SM, CLASSFOOD, pilote);
      const [ligne] = tenants.rows[0]!.derogationsCapacite as {
        auteur: string;
        motif: string;
        le: string;
      }[];
      expect(ligne!.auteur).toBe('admin@snackmanager.fr');
      expect(ligne!.motif).toBe(pilote.motif);
      expect(Date.parse(ligne!.le)).not.toBeNaN();
    });

    it('rend 404 sur un établissement inconnu', async () => {
      await expect(admin.changeCapacite(SM, AUTRE_RESTO + 'x', pilote)).rejects.toThrow(
        /introuvable/,
      );
    });
  });

  // ─── Fin d'essai ───

  /**
   * L'ESSAI QUI S'ACHÈVE — la réconciliation de ce que la lecture dit déjà.
   *
   * Elle ne décide rien : `statutEffectif` rend « actif » dès le terme, partout,
   * sans écrire. Ce geste aligne la colonne, et il est appelé par la seule passe
   * qui parcourt tout le parc (`BillingService.runMensuel`).
   */
  describe('Fin de la période d’essai', () => {
    const TERME = new Date('2026-07-31T09:00:00Z');
    const enEssai = () => {
      tenants.rows[0]!.account = {
        status: 'trial',
        since: new Date('2026-07-01T09:00:00Z'),
        reason: 'Créé depuis le pipeline',
        suspendedAt: null,
        trialEndsAt: TERME,
      };
    };

    it('bascule le compte en actif, daté du TERME et non du jour de la passe', async () => {
      enEssai();
      expect(await admin.acterFinEssai(SM, CLASSFOOD, TERME)).toBe(true);

      const compte = tenants.rows[0]!.account as { status: string; since: Date };
      expect(compte.status).toBe('active');
      // Le compte est devenu payant au jour convenu : la date affichée sur la
      // fiche ne saute donc pas le jour où la passe tourne.
      expect(compte.since).toEqual(TERME);
    });

    it('garde le terme en base — c’est la preuve de ce qu’on vient d’appliquer', async () => {
      enEssai();
      await admin.acterFinEssai(SM, CLASSFOOD, TERME);
      expect((tenants.rows[0]!.account as { trialEndsAt: Date }).trialEndsAt).toEqual(TERME);
    });

    it('est IDEMPOTENT : relancé, il n’écrit pas une seconde ligne', async () => {
      enEssai();
      expect(await admin.acterFinEssai(SM, CLASSFOOD, TERME)).toBe(true);
      expect(await admin.acterFinEssai(SM, CLASSFOOD, TERME)).toBe(false);

      const lignes = (await admin.journal(CLASSFOOD, TOUT)).filter(
        (e) => e.action === 'tenant.trial_end',
      );
      expect(lignes).toHaveLength(1);
      expect(lignes[0]?.meta).toMatchObject({ trialEndsAt: TERME.toISOString() });
    });

    it('ne touche NI un compte suspendu NI un compte parti', async () => {
      // La condition voyage avec l'écriture : un compte qui n'est plus en essai
      // n'est même pas trouvé. Une suspension motivée ne se lève pas parce
      // qu'une date est passée.
      for (const status of ['suspended', 'churned', 'active'] as const) {
        tenants.rows[0]!.account = { status, since: new Date(), trialEndsAt: TERME };
        expect(await admin.acterFinEssai(SM, CLASSFOOD, TERME)).toBe(false);
        expect((tenants.rows[0]!.account as { status: string }).status).toBe(status);
      }
    });

    it('ne ferme rien : le compte reste ouvert, il devient seulement facturable', async () => {
      enEssai();
      await admin.acterFinEssai(SM, CLASSFOOD, TERME);
      const view = await admin.account(SM, CLASSFOOD);
      expect(view.accessBlocked).toBe(false);
      expect(view.statusLabel).toBe('Actif');
    });
  });

  describe('Le masque d’identité (CRM)', () => {
    it('hérite le logo legacy à la première pose — persisté, pas seulement rendu', async () => {
      // Le tenant porte un logo d'AVANT le masque (`logoUrl`, champ racine) ;
      // `DIRECTIONS.marche` n'en porte aucun dans ses quatre emplacements.
      // Sous le domaine public — la seule origine que la liste blanche
      // accepte de greffer (`OriginesImages`).
      tenants.rows[0]!.logoUrl = 'https://api.snackmanager.fr/public/tenants/classfood/logo?v=3';

      await admin.changeMarque(SM, CLASSFOOD, DIRECTIONS.marche);

      // Vérifié sur le DOCUMENT PERSISTÉ, pas seulement sur la vue rendue :
      // c'est ce qui sera relu à la prochaine ouverture de la fiche.
      const persiste = tenants.rows.find((r) => r._id === CLASSFOOD)!;
      const brand = persiste.brand as { logo: { mark: { light: unknown; dark: unknown } } };
      expect(brand.logo.mark.dark).toBe(
        'https://api.snackmanager.fr/public/tenants/classfood/logo?v=3',
      );
      expect(brand.logo.mark.light).toBeNull();
    });

    it('consigne d’où l’on part et où l’on va — y compris sur un masque sur mesure', async () => {
      // La ligne ne portait que `meta.preset`. Sur un masque SUR MESURE
      // (`preset: null`) elle ne disait donc rien du tout : ni la direction
      // d'origine, ni ce qui avait bougé. Un registre append-only qu'on ne
      // peut pas relire au litige ne protège personne — `changeOffre`, le
      // motif que ce service reprend, consigne `from`/`to` depuis toujours.
      tenants.rows[0]!.brand = DIRECTIONS.nuit;
      const surMesure = {
        ...DIRECTIONS.marche,
        preset: null,
        palette: { ...DIRECTIONS.marche.palette, accent: '#1b5e20' },
      };

      await admin.changeMarque(SM, CLASSFOOD, surMesure);

      const [ligne] = await admin.journal(CLASSFOOD, TOUT);
      expect(ligne?.action).toBe('tenant.brand_change');
      expect(ligne?.meta?.from).toMatchObject({ preset: 'nuit', mode: 'dark' });
      expect(ligne?.meta?.to).toMatchObject({ preset: null, pair: 'marche' });
      // La palette EN ENTIER : un litige d'identité visuelle porte sur des
      // couleurs, et « accent seul » ne dirait rien d'un fond changé.
      expect((ligne?.meta?.to as { palette: { accent: string } }).palette.accent).toBe('#1b5e20');
      expect(ligne?.meta?.logosModifies).toBe(false);
    });

    it('signale une retouche de logo, sans dérouler quatre URL versionnées', async () => {
      // Ce qui compte au litige est « on y a touché », pas laquelle des quatre
      // déclinaisons : les URL portent un `?v=` illisible dans un journal.
      tenants.rows[0]!.brand = DIRECTIONS.nuit;
      const avecLogo = {
        ...DIRECTIONS.nuit,
        logo: {
          ...DIRECTIONS.nuit.logo,
          mark: { light: null, dark: 'https://api.snackmanager.fr/public/tenants/classfood/logo?v=9' },
        },
      };

      await admin.changeMarque(SM, CLASSFOOD, avecLogo);

      const [ligne] = await admin.journal(CLASSFOOD, TOUT);
      expect(ligne?.meta?.logosModifies).toBe(true);
    });

    /**
     * UN MASQUE CORROMPU SE VOIT SUR LA FICHE, PAS SEULEMENT DANS LES LOGS.
     *
     * Le repli était muet : un restaurant dont le masque ne passe plus le
     * contrat s'affichait en Nuit sur toutes ses surfaces clientes, sur un
     * 200, et la fiche client montrait un Nuit indiscernable d'un Nuit
     * choisi. `brandRepli` dit d'où vient ce Nuit-là.
     */
    it('dit POURQUOI la fiche montre Nuit — choisi, pas encore repris, ou illisible', async () => {
      // Pas encore repris : normal, et à ne pas confondre avec un incident.
      expect((await admin.account(SM, CLASSFOOD)).brandRepli).toBe('absent');

      tenants.rows[0]!.brand = DIRECTIONS.soleil;
      expect((await admin.account(SM, CLASSFOOD)).brandRepli).toBeNull();

      // `mode` hors de l'énumération : `BrandSchema` refuse, le repli tombe.
      tenants.rows[0]!.brand = { ...DIRECTIONS.soleil, mode: 'crepuscule' };
      const vue = await admin.account(SM, CLASSFOOD);
      expect(vue.brandRepli).toBe('invalide');
      expect(vue.brand.preset).toBe('nuit');
    });

    it('refuse en 400 une image venue d’ailleurs, et n’écrit rien', async () => {
      // Les DEUX routes `PATCH …/marque` écrivent `logo.*` et `hero` dans le
      // même document, servi aux mêmes clients : une garde posée du seul côté
      // restaurateur ne garderait rien — l'équipe SM passerait par ici.
      const espion = {
        ...DIRECTIONS.nuit,
        hero: 'https://cdn.mechant.fr/pixel.png',
      };
      await expect(admin.changeMarque(SM, CLASSFOOD, espion)).rejects.toThrow(BadRequestException);
      expect(tenants.rows.find((r) => r._id === CLASSFOOD)!.brand ?? null).toBeNull();
      expect(logs.size).toBe(0);
    });

    it('refuse en 400 un masque qui échoue AA, et n’écrit rien au journal', async () => {
      const pale = {
        ...DIRECTIONS.marche,
        palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' },
      };
      // Même registre qui ne doit pas mentir que pour les autres gestes :
      // un masque refusé ne doit laisser aucune trace d'un changement qui
      // n'a pas eu lieu.
      await expect(admin.changeMarque(SM, CLASSFOOD, pale)).rejects.toThrow(
        BadRequestException,
      );
      expect(logs.size).toBe(0);
    });
  });

  describe('Notes internes', () => {
    it('écrit la note dans le journal, sans collection parallèle', async () => {
      const entry = await admin.addNote(SM, CLASSFOOD, { note: 'Gérant promet de régler vendredi' });

      expect(entry.action).toBe('tenant.note');
      expect(entry.reason).toBe('Gérant promet de régler vendredi');
      expect((await admin.journal(CLASSFOOD, TOUT))[0]?._id).toBe(entry._id);
    });
  });

  // ─── Gestes de facturation ───

  describe('Gestes de facturation', () => {
    const facture = (over: Partial<AdminInvoiceGesture> = {}): AdminInvoiceGesture => ({
      action: 'invoice.pay',
      invoiceId: FACTURE,
      summary: 'Facture SM-2026-0007 encaissée — 139,00 € par chèque le 14/08/2026.',
      meta: {
        number: 'SM-2026-0007',
        kind: 'abonnement',
        period: '2026-08',
        amountCents: 13_900,
        method: 'cheque',
      },
      ...over,
    });

    it('trace un encaissement sous SON nom, jamais sous « Note interne »', async () => {
      const entry = await admin.recordInvoiceGesture(SM, CLASSFOOD, facture());

      // Le fond de l'affaire : 139 € encaissés ne peuvent pas s'afficher comme
      // un commentaire libre dans le registre qu'on ouvre en cas de litige.
      expect(entry.action).toBe('invoice.pay');
      expect(entry.actionLabel).toBe('Encaissement d’une facture');
      expect(entry.actionLabel).not.toBe(ADMIN_LOG_ACTION_LABELS['tenant.note']);
      // Rattaché à la PIÈCE, ce qu'une note ne portait pas : on relit ainsi
      // l'histoire d'une facture précise, pas seulement celle du client.
      expect(entry.targetId).toBe(FACTURE);
      expect(entry.reason).toMatch(/encaissée/);
      expect(entry.meta).toMatchObject({ number: 'SM-2026-0007', method: 'cheque' });
    });

    it('donne un intitulé français distinct à chacun des trois gestes', async () => {
      await admin.recordInvoiceGesture(SM, CLASSFOOD, facture({ action: 'invoice.issue' }));
      await admin.recordInvoiceGesture(SM, CLASSFOOD, facture({ action: 'invoice.pay' }));
      await admin.recordInvoiceGesture(SM, CLASSFOOD, facture({ action: 'invoice.cancel' }));

      const labels = (await admin.journal(CLASSFOOD, TOUT)).map((e) => e.actionLabel);
      expect(new Set(labels)).toEqual(
        new Set([
          'Émission d’une facture',
          'Encaissement d’une facture',
          'Annulation d’une facture',
        ]),
      );
    });

    it('se filtre comme les autres actions du journal', async () => {
      await admin.addNote(SM, CLASSFOOD, { note: 'Rappelé le gérant' });
      await admin.recordInvoiceGesture(SM, CLASSFOOD, facture({ action: 'invoice.issue' }));

      // Isoler les gestes comptables des commentaires d'équipe est précisément
      // ce que `tenant.note` interdisait.
      const emissions = await admin.journal(CLASSFOOD, { limit: 200, action: 'invoice.issue' });
      expect(emissions).toHaveLength(1);
      expect(emissions[0]?.targetId).toBe(FACTURE);
    });

    it('rend 404 sur un établissement inconnu, sans rien écrire', async () => {
      await expect(
        admin.recordInvoiceGesture(SM, 'pas-un-objectid', facture()),
      ).rejects.toThrow(/introuvable/);
      expect(logs.size).toBe(0);
    });
  });

  // ─── Révocation d'appareil ───

  describe('Révocation d’un appareil', () => {
    it('coupe immédiatement le jeton d’une tablette volée', async () => {
      seedCaisse();
      const repository = deviceRepository();
      // Avant : la tablette encaisse.
      await expect(requirePairedDevice(repository, 'jeton-de-la-tablette-volée')).resolves.toEqual(
        expect.objectContaining({ name: 'Caisse comptoir' }),
      );

      await admin.revokeDevice(SM, CLASSFOOD, CAISSE, { reason: 'vol', note: 'Oubliée en salle' });

      // Après : plus jamais. Le jeton est DÉTRUIT, pas désactivé — même
      // réappairé, l'appareil repartira sur un secret neuf.
      await expect(
        requirePairedDevice(repository, 'jeton-de-la-tablette-volée'),
      ).rejects.toThrow(/plus reconnu/);
    });

    it('publie la révocation même si son écriture au journal échoue ensuite', async () => {
      seedCaisse();
      const revocations = { device: vi.fn().mockResolvedValue(undefined) };
      const logsIndisponibles = {
        create: vi.fn().mockRejectedValue(new Error('journal indisponible')),
      } as unknown as Model<AdminLog>;
      const avecEvenements = new AdminService(
        tenants.asModel<Tenant>(),
        devices.asModel<Device>(),
        screens.asModel<Screen>(),
        logsIndisponibles,
        users.asModel<User>(),
        testOriginesImages(),
        revocations as never,
      );

      await expect(
        avecEvenements.revokeDevice(SM, CLASSFOOD, CAISSE, { reason: 'vol', note: '' }),
      ).rejects.toThrow(/journal indisponible/);

      expect(revocations.device).toHaveBeenCalledWith(CLASSFOOD, CAISSE);
      expect(devices.rows.find((row) => row._id === CAISSE)?.paired).toBe(false);
    });

    it('repose l’appareil en attente d’appairage, avec un code frais à dicter', async () => {
      seedCaisse();
      const revoked = await admin.revokeDevice(SM, CLASSFOOD, CAISSE, { reason: 'vol', note: '' });

      expect(revoked.paired).toBe(false);
      expect(revoked.kind).toBe('pos');
      expect(revoked.kindLabel).toBe('Caisse');
      // L'équipe SM est au téléphone avec le restaurateur au moment où elle
      // coupe : le code de remise en service part avec la réponse.
      expect(isPairingCodeShape(revoked.pairing.code)).toBe(true);
      expect(Date.parse(revoked.pairing.expiresAt) - Date.parse(revoked.revokedAt)).toBe(
        PAIRING_CODE_TTL_MS,
      );

      const row = devices.rows.find((r) => r._id === CAISSE)!;
      expect(row.deviceToken).toBeNull();
      expect(row.paired).toBe(false);
      expect(row.lastSeenAt).toBeNull();
      expect(row.pairingCode).toBe(revoked.pairing.code);
    });

    it('enregistre le motif, sur l’appareil comme au journal', async () => {
      seedCaisse();
      await admin.revokeDevice(SM, CLASSFOOD, CAISSE, { reason: 'perte', note: 'Taxi' });

      const row = devices.rows.find((r) => r._id === CAISSE)!;
      expect(row.revokedReason).toBe('perte');
      expect(row.revokedAt).toBeInstanceOf(Date);

      const entry = (await admin.journal(CLASSFOOD, TOUT)).find((e) => e.action === 'device.revoke');
      expect(entry?.targetId).toBe(CAISSE);
      expect(entry?.reason).toBe('Taxi');
      expect(entry?.meta).toMatchObject({ reason: 'perte', kind: 'pos', name: 'Caisse comptoir' });
    });

    it('révoque un écran de salle avec le même geste', async () => {
      screens.seed({
        _id: ECRAN,
        tenantId: CLASSFOOD,
        name: 'Écran comptoir',
        paired: true,
        deviceToken: 'jeton-hdmi',
      });

      const revoked = await admin.revokeScreen(SM, CLASSFOOD, ECRAN, {
        reason: 'remplacement',
        note: '',
      });

      expect(revoked.kind).toBe('screen');
      expect(revoked.kindLabel).toBe('Écran de salle');
      expect(screens.rows.find((r) => r._id === ECRAN)!.deviceToken).toBeNull();
      expect((await admin.journal(CLASSFOOD, TOUT))[0]?.action).toBe('screen.revoke');
    });

    it('refuse de couper la caisse d’un autre établissement', async () => {
      devices.seed({
        _id: CAISSE_DU_VOISIN,
        tenantId: AUTRE_RESTO,
        name: 'Caisse du voisin',
        kind: 'pos',
        paired: true,
        deviceToken: 'jeton-du-voisin',
      });

      // Le filtre porte le tenant : deviner un identifiant ne suffit pas, même
      // depuis un compte d'équipe.
      await expect(
        admin.revokeDevice(SM, CLASSFOOD, CAISSE_DU_VOISIN, { reason: 'vol', note: '' }),
      ).rejects.toThrow(/introuvable/);
      expect(devices.rows.find((r) => r._id === CAISSE_DU_VOISIN)!.deviceToken).toBe(
        'jeton-du-voisin',
      );
    });

    it('rend 404 sur un identifiant illisible plutôt qu’une erreur de cast', async () => {
      await expect(
        admin.revokeDevice(SM, CLASSFOOD, 'pas-un-objectid', { reason: 'panne', note: '' }),
      ).rejects.toThrow(/introuvable/);
    });
  });

  // ─── Journal ───

  describe('Journal d’administration', () => {
    it('trace QUI, QUOI, SUR QUI, QUAND et POURQUOI', async () => {
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé — relance 3' });
      const entry = (await admin.journal(CLASSFOOD, TOUT))[0]!;

      expect(entry.actor.id).toBe(SM.sub);
      // Dénormalisé à l'écriture : le journal ne doit pas changer de contenu
      // le jour où un compte d'équipe est renommé ou supprimé.
      expect(entry.actor.email).toBe('admin@snackmanager.fr');
      expect(entry.action).toBe('tenant.suspend');
      expect(entry.actionLabel).toBe('Suspension du compte');
      expect(entry.tenantId).toBe(CLASSFOOD);
      expect(Date.parse(entry.at)).not.toBeNaN();
      expect(entry.reason).toBe('Impayé — relance 3');
    });

    it('écrit une ligne pour CHAQUE action d’administration, consultation comprise', async () => {
      seedCaisse();
      screens.seed({ _id: ECRAN, tenantId: CLASSFOOD, name: 'Écran', paired: true });

      await admin.account(SM, CLASSFOOD);
      // L'essai qui s'achève : la réconciliation exige un compte RÉELLEMENT en
      // essai, son terme passé. Posé ici, avant les gestes qui changent le
      // statut — un compte parti ne redevient pas actif parce qu'une date est
      // passée, et c'est justement la règle.
      tenants.rows[0]!.account = {
        status: 'trial',
        since: new Date('2026-07-01T09:00:00Z'),
        trialEndsAt: new Date('2026-07-31T09:00:00Z'),
      };
      await admin.acterFinEssai(SM, CLASSFOOD, new Date('2026-07-31T09:00:00Z'));
      // La dérogation de capacité : Class'Food est en « essentiel », la
      // fidélité n'y est pas comprise — l'octroi change donc quelque chose.
      await admin.changeCapacite(SM, CLASSFOOD, {
        capacite: 'loyalty',
        geste: 'accordee',
        motif: 'Pilote fidélité — vendue en Boost, tournée en Complet',
      });
      await admin.recordTenantCreation(SM, CLASSFOOD, {
        slug: 'classfood',
        plan: 'complet',
        founderSeat: true,
        leadId: 'lead-1',
        ownerEmail: 'gerant@classfood.fr',
      });
      await admin.recordOwnerReset(SM, CLASSFOOD, 'gerant@classfood.fr');
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      await admin.reactivate(SM, CLASSFOOD, { reason: 'Réglé' });
      await admin.churn(SM, CLASSFOOD, { cause: 'prix', reason: 'Ferme fin août' });
      await admin.changeOffre(SM, CLASSFOOD, {
        plan: 'complet',
        onlineOrdering: false,
        billing: 'mensuel',
        services: EMPTY_SERVICES,
        reason: '',
      });
      await admin.changeMarque(SM, CLASSFOOD, DIRECTIONS.marche);
      await admin.addNote(SM, CLASSFOOD, { note: 'Rappelé' });
      await admin.revokeDevice(SM, CLASSFOOD, CAISSE, { reason: 'vol', note: '' });
      await admin.revokeScreen(SM, CLASSFOOD, ECRAN, { reason: 'panne', note: '' });
      // Les trois gestes de compte passent par la même frontière que la
      // facturation : `ComptesService` rédige, ce service enregistre. Le
      // parcourir ici garde la promesse « aucun geste sans trace » vraie pour
      // la famille entière, y compris celle qu'on ajoutera demain.
      for (const action of COMPTE_LOG_ACTIONS) {
        await admin.recordCompteGesture(SM, CLASSFOOD, {
          action,
          compteId: COMPTE,
          summary: `Compte cogerant@classfood.fr — ${action}`,
          meta: { email: 'cogerant@classfood.fr', nom: 'Sofiane', role: 'cogerant' },
        });
      }
      for (const action of INVOICE_LOG_ACTIONS) {
        await admin.recordInvoiceGesture(SM, CLASSFOOD, {
          action,
          invoiceId: FACTURE,
          summary: `Facture SM-2026-0007 — ${action}`,
          meta: {
            number: 'SM-2026-0007',
            kind: 'abonnement',
            period: '2026-08',
            amountCents: 13_900,
          },
        });
      }

      // Nous agissons sur l'outil de travail d'un commerçant : aucun geste ne
      // doit pouvoir être fait sans laisser de trace.
      //
      // La liste de référence est celle des actions qui visent un CLIENT, pas
      // `ADMIN_LOG_ACTIONS` en entier : les actions `platform.*` (réglages de
      // notre propre vitrine) partagent ce journal mais ne visent aucun
      // établissement, et n'ont donc rien à faire dans le journal d'un
      // restaurant. Elles sont couvertes par `platform.test.ts`.
      const actions = (await admin.journal(CLASSFOOD, TOUT)).map((e) => e.action);
      expect(new Set(actions)).toEqual(new Set(TENANT_LOG_ACTIONS));
      expect(actions).toHaveLength(TENANT_LOG_ACTIONS.length);
    });

    it('rend le journal du plus récent au plus ancien', async () => {
      await admin.addNote(SM, CLASSFOOD, { note: 'première' });
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });

      const journal = await admin.journal(CLASSFOOD, TOUT);
      expect(journal[0]?.action).toBe('tenant.suspend');
      expect(journal.at(-1)?.action).toBe('tenant.note');
    });

    it('cloisonne le journal par établissement, et sait le lire en entier', async () => {
      await admin.addNote(SM, CLASSFOOD, { note: 'chez nous' });
      await admin.addNote(SM, AUTRE_RESTO, { note: 'chez le voisin' });

      expect(await admin.journal(CLASSFOOD, TOUT)).toHaveLength(1);
      expect(await admin.allLogs(TOUT)).toHaveLength(2);
      expect(await admin.allLogs({ limit: 200, action: 'tenant.note' })).toHaveLength(2);
      expect(await admin.allLogs({ limit: 1 })).toHaveLength(1);
    });

    it('n’écrit rien quand l’action échoue', async () => {
      // Un journal qui affirme une suspension jamais appliquée est pire qu'un
      // journal muet : c'est un registre qui ment.
      await expect(admin.suspend(SM, 'inconnu', { reason: 'Impayé' })).rejects.toThrow(
        /introuvable/,
      );
      expect(logs.size).toBe(0);
    });
  });

  // ─── Fiche compte ───

  describe('Fiche compte', () => {
    it('affiche un tenant sans champ « account » comme un compte d’essai', async () => {
      // Tous les établissements créés avant ce module sont dans ce cas : la
      // fiche doit les montrer ordinaires, jamais bloqués ni en anomalie.
      const view = await admin.account(SM, CLASSFOOD);

      expect(view.account.status).toBe('trial');
      expect(view.accessBlocked).toBe(false);
      expect(view.statusLabel).toBe('Essai');
      // À défaut de statut daté, on retombe sur l'entrée dans le parc.
      expect(view.account.since).toBe(new Date('2026-01-04T09:00:00Z').toISOString());
    });

    it('rend 404 sur un établissement inconnu', async () => {
      await expect(admin.account(SM, AUTRE_RESTO + 'x')).rejects.toThrow(/introuvable/);
    });

    it('regroupe les consultations rapprochées d’un même dossier', async () => {
      // Une fiche se recharge à chaque navigation : sans regroupement, une
      // matinée de support noierait les suspensions sous des lignes identiques.
      await admin.account(SM, CLASSFOOD);
      await admin.account(SM, CLASSFOOD);
      await admin.account(SM, CLASSFOOD);

      expect(await admin.journal(CLASSFOOD, TOUT)).toHaveLength(1);
    });

    it('trace à nouveau après la fenêtre de regroupement', async () => {
      await admin.account(SM, CLASSFOOD);
      // Consultation d'il y a une heure : c'est un autre moment, une autre ligne.
      const vieille = logs.rows[0]!;
      vieille.at = new Date(Date.now() - 60 * 60_000);

      await admin.account(SM, CLASSFOOD);
      expect(await admin.journal(CLASSFOOD, TOUT)).toHaveLength(2);
    });

    it('ne regroupe jamais une action qui modifie l’état', async () => {
      // Le regroupement est un confort de lecture réservé aux consultations :
      // deux suspensions successives restent deux décisions.
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé' });
      await admin.suspend(SM, CLASSFOOD, { reason: 'Impayé — confirmé' });

      const journal = await admin.journal(CLASSFOOD, TOUT);
      expect(journal.filter((e) => e.action === 'tenant.suspend')).toHaveLength(2);
    });

    it('distingue deux membres de l’équipe consultant le même dossier', async () => {
      const collegue = { ...SM, sub: '65f00000000000000000ff02' };
      users.seed({ _id: collegue.sub, email: 'support@snackmanager.fr' });

      await admin.account(SM, CLASSFOOD);
      await admin.account(collegue, CLASSFOOD);

      const auteurs = (await admin.journal(CLASSFOOD, TOUT)).map((e) => e.actor.email);
      expect(new Set(auteurs)).toEqual(
        new Set(['admin@snackmanager.fr', 'support@snackmanager.fr']),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Règles partagées (contrats)
// ─────────────────────────────────────────────────────────────

describe('Règle d’accès', () => {
  it('ne bloque QUE les comptes suspendus', () => {
    expect(isAccessBlocked('suspended')).toBe(true);
    for (const status of TENANT_ACCOUNT_STATUSES.filter((s) => s !== 'suspended')) {
      expect(isAccessBlocked(status), status).toBe(false);
    }
    // Absence de statut (tenant d'avant le champ) : jamais un blocage.
    expect(isAccessBlocked(undefined)).toBe(false);
    expect(isAccessBlocked(null)).toBe(false);
  });

  it('ne ferme pas la porte à un client qui nous quitte', () => {
    // `churned` est un état commercial, pas une sanction : couper l'accès
    // reste un geste explicite, motivé et journalisé.
    expect(isAccessBlocked('churned')).toBe(false);
  });
});

describe('Fermeture du site public', () => {
  /** Le cas ordinaire : la commande en ligne est bien souscrite. */
  const SOUSCRITE = true;

  it('ferme proprement la commande en ligne d’un restaurant suspendu', () => {
    const state = publicOrderingState(
      { status: 'suspended' },
      { paused: false, message: null },
      SOUSCRITE,
    );

    expect(state.paused).toBe(true);
    expect(state.message).toBe(PUBLIC_ORDERING_SUSPENDED_MESSAGE);
    // Le consommateur n'a rien à voir avec notre litige commercial : il ne
    // lit ni « suspendu », ni « impayé », ni une erreur technique.
    expect(state.message).not.toMatch(/suspend|impay|erreur|Snack Manager/i);
  });

  it('laisse la pause du restaurateur inchangée quand le compte va bien', () => {
    const pause = { paused: true, message: 'Victimes de notre succès !' };
    expect(publicOrderingState({ status: 'active' }, pause, SOUSCRITE)).toEqual(pause);
    expect(
      publicOrderingState(undefined, { paused: false, message: null }, SOUSCRITE),
    ).toEqual({ paused: false, message: null });
  });

  it('prime sur une pause déjà posée par le restaurateur', () => {
    const state = publicOrderingState(
      { status: 'suspended' },
      { paused: true, message: 'Victimes de notre succès !' },
      SOUSCRITE,
    );
    expect(state.message).toBe(PUBLIC_ORDERING_SUSPENDED_MESSAGE);
  });

  /**
   * LA COMMANDE EN LIGNE NON SOUSCRITE SUIT LE MÊME CHEMIN QUE LA SUSPENSION.
   *
   * Elle ne lève pas, elle ne rend pas un 403 : elle FERME la page comme une
   * pause. Un client qui valide son panier à 12h15 doit lire une phrase qui
   * lui parle, pas recevoir une erreur — et le menu, les horaires et les avis
   * restent affichés : on ferme un guichet, on n'efface pas un restaurant.
   */
  it('annonce l’indisponibilité quand le module n’est pas souscrit', () => {
    const state = publicOrderingState(
      { status: 'active' },
      { paused: false, message: null },
      false,
    );
    expect(state.paused).toBe(true);
    expect(state.message).toBe(PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE);
    // Le mangeur n'a pas à savoir ce que son restaurateur nous paie.
    expect(state.message).not.toMatch(/abonnement|formule|souscri|module|impay/i);
  });

  it('ne promet pas un retour qui n’aura pas lieu, et ne sort pas le mot du gérant', () => {
    // « Momentanément indisponible » est vrai d'une suspension (elle se lève
    // quand la facture est réglée) et faux d'une fonction jamais achetée : le
    // client reviendrait chaque semaine sur une page qui ne changera pas.
    expect(PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE).not.toBe(PUBLIC_ORDERING_SUSPENDED_MESSAGE);
    // Et « de retour à 18 h » ne doit jamais s'afficher sur une fonction qui
    // ne reviendra pas : la non-souscription passe AVANT la pause du gérant.
    const state = publicOrderingState(
      { status: 'suspended' },
      { paused: true, message: 'De retour à 18 h' },
      false,
    );
    expect(state.message).toBe(PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE);
  });
});

describe('Vocabulaire d’administration', () => {
  it('garde les formules alignées sur celles du reste du produit', () => {
    // `ADMIN_PLANS` est redéclaré dans `admin.ts` pour éviter un cycle de
    // modules : rien n'empêcherait les deux listes de diverger en silence.
    expect([...ADMIN_PLANS]).toEqual([...PLANS]);
  });

  it('nomme en français CHAQUE action tracée', () => {
    // Une action sans libellé s'afficherait « invoice.pay » dans la fiche d'un
    // client — le journal doit se lire, pas se décoder.
    for (const action of ADMIN_LOG_ACTIONS) {
      expect(ADMIN_LOG_ACTION_LABELS[action], action).toMatch(/^[A-ZÉÈÀÇ]/);
    }
    // Les gestes de facturation sont bien des actions du MÊME journal : un fil
    // unique, pas un registre parallèle.
    for (const action of INVOICE_LOG_ACTIONS) {
      expect(ADMIN_LOG_ACTIONS).toContain(action);
    }
    // Et les gestes sur les comptes du restaurant aussi : « ouvert un accès le
    // 3, révoqué le 30 » se lit dans le même fil qu'une suspension.
    for (const action of COMPTE_LOG_ACTIONS) {
      expect(ADMIN_LOG_ACTIONS).toContain(action);
    }
  });

  it('laisse la base écrire la nouvelle action du masque', () => {
    // PIÈGE RÉEL, rencontré sur ce tour : `adminLogs.action` portait un `enum`
    // Mongoose qui RECOPIAIT `ADMIN_LOG_ACTIONS`. Une action déclarée au
    // contrat mais absente là-bas ne se voyait ni au typecheck ni dans les
    // tests à doublure — elle tombait en ValidationError à la première
    // écriture RÉELLE, après que la facture a été créée et son numéro
    // consommé. Depuis, le schéma étale la source (`[...ADMIN_LOG_ACTIONS]`) :
    // comparer l'enum à la constante qu'il étale ne prouverait plus rien.
    //
    // Ce qui reste à vérifier, c'est le COMPORTEMENT : qu'une ligne réelle
    // portant la dernière action ajoutée passe la validation Mongoose. Un
    // retour à la recopie la ferait échouer ici, avant la production.
    const M = model('AdminLogAdminTest', AdminLogSchema);
    const ligne = new M({
      actorId: SM.sub,
      action: 'tenant.brand_change',
      tenantId: CLASSFOOD,
    });
    expect(ligne.validateSync()).toBeUndefined();
  });

  it('nomme en français chaque statut et chaque motif de révocation', () => {
    expect([...TENANT_ACCOUNT_STATUSES]).toEqual(['trial', 'active', 'suspended', 'churned']);
    expect([...DEVICE_REVOKE_REASONS]).toEqual(['perte', 'vol', 'panne', 'remplacement']);
    expect(ACCOUNT_SUSPENDED_MESSAGE).toBe('Accès suspendu — contactez Snack Manager');
  });
});
