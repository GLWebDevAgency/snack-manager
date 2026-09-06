import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS, type JwtPayload } from '@sm/contracts';
import { journalDeTest } from '../audit/audit.fakes';
import { LogoService } from './logo.service';
import { testOriginesImages } from './tenants.fakes';
import { TenantsService } from './tenants.service';

/**
 * CE QUE VOIT LE CLIENT — et qui, dans le restaurant, l'a changé.
 *
 * Six routes écrivent l'établissement (réglages, identité, horaires, masque,
 * logo, identité de facturation) et AUCUNE ne laissait de trace. Le cas le
 * plus parlant est le masque : le même document, écrit depuis la fiche client
 * du CRM, produisait une ligne `tenant.brand_change` au journal
 * d'administration ; écrit par le restaurateur lui-même, il n'en produisait
 * aucune. Un geste, deux registres, une seule moitié tracée.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const GERANT = '665f0d0a1c2b3d4e5f6a7b01';

const SESSION: JwtPayload = { sub: GERANT, tenantId: TENANT, role: 'owner', kind: 'user' };

const DOCUMENT = {
  _id: TENANT,
  slug: 'chez-lima',
  name: 'Chez Lima',
  logoUrl: null as string | null,
  brandColor: '#c9a15a',
  brand: null as unknown,
  address: '12 rue du Marché',
  phones: ['0102030405'],
  hours: [],
  closures: [],
  plan: 'complet',
  onlineOrdering: true,
  settings: { slotIntervalMin: 10, slotCapacity: 4, onlineOrderingPaused: false },
  account: { status: 'active' },
};

/** Une collection `tenants` réduite au vocabulaire des cinq écritures. */
function fakeTenants(over: Record<string, unknown> = {}) {
  const etat: Record<string, unknown> = { ...structuredClone(DOCUMENT), ...over };
  const appliquer = ($set: Record<string, unknown>) => {
    for (const [chemin, valeur] of Object.entries($set)) {
      const segments = chemin.split('.');
      let cible = etat;
      for (const s of segments.slice(0, -1)) {
        if (cible[s] === null || typeof cible[s] !== 'object') cible[s] = {};
        cible = cible[s] as Record<string, unknown>;
      }
      cible[segments[segments.length - 1]!] = valeur;
    }
  };
  return {
    etat,
    model: {
      findById: (_id: string, projection?: Record<string, unknown>) => {
        const vu = structuredClone(etat);
        const rendu = projection
          ? Object.fromEntries(
              Object.entries(vu).filter(([k]) => k === '_id' || k in projection),
            )
          : vu;
        const query = Promise.resolve(rendu);
        return Object.assign(query, { lean: () => query, select: () => query, read: () => query,
          readConcern: () => query, maxTimeMS: () => query });
      },
      findByIdAndUpdate: async (
        _id: string,
        update: { $set: Record<string, unknown> },
      ) => {
        appliquer(update.$set);
        return structuredClone(etat);
      },
      findOneAndUpdate: vi.fn((_filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        appliquer(update.$set);
        const result = structuredClone(etat);
        const query = Promise.resolve(result);
        return Object.assign(query, { select: (value: string) => {
          expect(value).toBe('-capacityControl');
          delete result.capacityControl;
          return query;
        } });
      }),
      updateOne: async (_f: unknown, update: { $set: Record<string, unknown> }) => {
        appliquer(update.$set);
        return { modifiedCount: 1 };
      },
    },
  };
}

function atelier(over: Record<string, unknown> = {}) {
  const tenants = fakeTenants(over);
  const { audit, lignes } = journalDeTest({ users: [{ _id: GERANT, name: 'Lima Ghassene' }] });
  const service = new TenantsService(tenants.model as never, testOriginesImages(), audit);
  return { service, lignes, tenants };
}

describe('les réglages du service', () => {
  it('tracent la pause de la commande en ligne, avec qui l’a posée', async () => {
    // C'est le réglage qui FERME la vente : un restaurant en pause pendant
    // deux heures un samedi soir, et personne pour dire qui a appuyé.
    const { service, lignes } = atelier();

    await service.updateSettings(
      TENANT,
      { onlineOrderingPaused: true, pauseMessage: 'Victimes de notre succès !' },
      SESSION,
    );

    expect(lignes[0]).toMatchObject({
      action: 'tenant.settings',
      meta: {
        reglages: ['onlineOrderingPaused', 'pauseMessage'],
        onlineOrderingPaused: true,
        pauseMessage: 'Victimes de notre succès !',
      },
      author: { id: GERANT, name: 'Lima Ghassene', role: 'owner', means: 'password' },
    });
  });

  it('trace une capacité enregistrée seulement après l’écriture conditionnelle', async () => {
    const { service, lignes, tenants } = atelier();
    await service.updateSettings(TENANT, { slotCapacity: 6 }, SESSION);
    expect(tenants.model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: TENANT, capacityControl: { $exists: false } },
      { $set: { 'settings.slotCapacity': 6 } }, expect.any(Object));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: 'tenant.settings', meta: { reglages: ['slotCapacity'] } });
  });

  it.each(['capacity', 'hours'] as const)('ne journalise pas un succès si le réglage %s est refusé avant persistance', async (kind) => {
    const { service, lignes, tenants } = atelier();
    tenants.model.findOneAndUpdate.mockImplementationOnce(() => {
      const query = Promise.resolve(null as never);
      return Object.assign(query, { select: () => Promise.reject(new Error('Modification concurrente')) });
    });
    const update = kind === 'capacity'
      ? service.updateSettings(TENANT, { slotCapacity: 6 }, SESSION)
      : service.updateHours(TENANT, { hours: [] }, SESSION);
    await expect(update).rejects.toThrow();
    expect(lignes).toEqual([]);
  });

  it('n’écrit rien sur un PATCH qui ne reconnaît aucun réglage', async () => {
    // Le service se contente alors de relire la fiche : pas d'écriture, donc
    // pas de ligne. Un registre qui note des non-événements devient illisible.
    const { service, lignes } = atelier();
    await service.updateSettings(TENANT, {} as never, SESSION);
    expect(lignes).toEqual([]);
  });
});

describe('l’identité de l’enseigne', () => {
  it('inscrit ce qui part sur la vitrine, les tickets et les tablettes', async () => {
    const { service, lignes } = atelier();

    await service.updateIdentity(
      TENANT,
      { name: 'Chez Lima — Traiteur', address: '14 rue du Marché' },
      SESSION,
    );

    expect(lignes[0]).toMatchObject({
      action: 'tenant.identity',
      meta: { name: 'Chez Lima — Traiteur', address: '14 rue du Marché' },
      author: { name: 'Lima Ghassene', means: 'password' },
    });
  });
});

describe('les horaires', () => {
  it('résument ce qui se relit — combien de jours servis, combien de fermetures', async () => {
    // Le détail des sept jours ne se relit pas dans un registre ; ce qu'on y
    // cherche, c'est le jour où le restaurant a cessé d'ouvrir.
    const { service, lignes } = atelier();

    await service.updateHours(
      TENANT,
      {
        hours: [
          { day: 1, lunch: { open: '11:30', close: '14:30' }, dinner: null },
          { day: 2, lunch: null, dinner: null },
        ],
        closures: [{ from: '2026-12-25', reason: 'Noël' }],
      },
      SESSION,
    );

    expect(lignes[0]).toMatchObject({
      action: 'tenant.hours',
      meta: { joursServis: 1, fermetures: 1 },
    });
  });
});

describe('le masque d’identité', () => {
  it('laisse enfin une ligne côté restaurateur — comme le CRM en laisse une', async () => {
    const { service, lignes } = atelier();

    await service.updateMarque(TENANT, DIRECTIONS.soleil, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'tenant.brand',
      meta: { accent: DIRECTIONS.soleil.palette.accent, mode: DIRECTIONS.soleil.mode },
      author: { name: 'Lima Ghassene', role: 'owner', means: 'password' },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Le logo
// ─────────────────────────────────────────────────────────────

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

describe('le logo', () => {
  const store = () => {
    const objets = new Map<string, Buffer>();
    return {
      objets,
      enabled: true,
      put: async (cle: string, corps: Buffer) => void objets.set(cle, corps),
      get: async (cle: string) => objets.get(cle) ?? null,
      delete: async (cle: string) => void objets.delete(cle),
    };
  };

  it('dit quel fichier remplace quel autre — l’URL porte la version', async () => {
    const tenants = fakeTenants({ logoUrl: 'https://api.snackmanager.fr/x/logo?v=1' });
    const { audit, lignes } = journalDeTest({ users: [{ _id: GERANT, name: 'Lima Ghassene' }] });
    const service = new LogoService(tenants.model as never, store() as never, audit);

    await service.poser(TENANT, 'https://api.snackmanager.fr', PNG, () => 42, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'tenant.logo',
      meta: {
        pose: true,
        de: 'https://api.snackmanager.fr/x/logo?v=1',
        vers: 'https://api.snackmanager.fr/public/tenants/chez-lima/logo?v=42',
        type: 'image/png',
      },
      author: { name: 'Lima Ghassene', means: 'password' },
    });
  });

  it('note aussi le RETRAIT — une vitrine qui perd son logo est un changement', async () => {
    const tenants = fakeTenants({ logoUrl: 'https://api.snackmanager.fr/x/logo?v=7' });
    const { audit, lignes } = journalDeTest({ users: [{ _id: GERANT, name: 'Lima Ghassene' }] });
    const service = new LogoService(tenants.model as never, store() as never, audit);

    await service.retirer(TENANT, SESSION);

    expect(lignes[0]).toMatchObject({
      action: 'tenant.logo',
      meta: { pose: false, de: 'https://api.snackmanager.fr/x/logo?v=7', vers: null },
    });
  });
});
