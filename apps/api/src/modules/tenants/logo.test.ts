import { describe, expect, it } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { journalMuet } from '../audit/audit.fakes';
import { LogoController } from './logo.controller';
import type { OriginesImages } from './origines-images';
import { createImageStore } from '../../infrastructure/images/image-store.factory';
import { NoopImageStore, type ImageStore } from '../../infrastructure/images/image-store';
import { R2ImageStore } from '../../infrastructure/images/r2-image-store';
import { detecterImage } from './image-signature';
import { LogoService } from './logo.service';

/**
 * Le logo de l'enseigne : reconnu aux octets, stocké sur R2, servi par nous.
 * Ce qui se vérifie ici : qu'un fichier menteur est refusé à l'entrée, que
 * l'URL ne s'écrit JAMAIS avant le stockage réussi (pas de lien mort), et
 * que le service ne relit R2 qu'au premier passage — l'API REST de
 * Cloudflare est limitée en débit, le cache est un engagement, pas un confort.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b99';
const ORIGIN = 'https://api.exemple.test';

/** La session du gérant, telle que le garde la pose sur la requête. */
const SESSION: JwtPayload = {
  sub: '665f0d0a1c2b3d4e5f6a7b01',
  tenantId: TENANT,
  role: 'owner',
  kind: 'user',
};

/** Un PNG minimal honnête : la signature, puis du remplissage. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'latin1'),
  Buffer.alloc(64, 3),
]);

describe('detecterImage — les octets font foi', () => {
  it('reconnaît PNG, JPEG et WebP', () => {
    expect(detecterImage(PNG)).toBe('image/png');
    expect(detecterImage(JPEG)).toBe('image/jpeg');
    expect(detecterImage(WEBP)).toBe('image/webp');
  });

  it('refuse le reste — SVG, GIF, exécutable renommé, fichier tronqué', () => {
    expect(detecterImage(Buffer.from('<svg xmlns="…"><script/></svg>'))).toBeNull();
    expect(detecterImage(Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16)]))).toBeNull();
    expect(detecterImage(Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(64)]))).toBeNull();
    expect(detecterImage(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

/** Doublure du magasin — n'accepte que ce que le port promet. */
function fakeStore(options: { failPut?: boolean } = {}) {
  const objets = new Map<string, { corps: Buffer; type: string }>();
  const lectures = { count: 0 };
  const store: ImageStore = {
    enabled: true,
    providerName: 'doublure',
    async put(key, corps, type) {
      if (options.failPut) throw new Error('R2 indisponible');
      objets.set(key, { corps, type });
    },
    async get(key) {
      lectures.count += 1;
      return objets.get(key)?.corps ?? null;
    },
    async delete(key) {
      objets.delete(key);
    },
  };
  return { store, objets, lectures };
}

/** Doublure du modèle Tenant — un seul document, gestes Mongo minimaux. */
function fakeTenants(doc: { slug: string; logoUrl: string | null } | null) {
  const etat = doc ? { _id: TENANT, ...doc } : null;
  const sets: Record<string, unknown>[] = [];
  return {
    sets,
    etat: () => etat,
    model: {
      findById: async (id: string) => (etat && id === TENANT ? etat : null),
      findByIdAndUpdate: async (id: string, update: { $set: Record<string, unknown> }) => {
        if (!etat || id !== TENANT) return null;
        sets.push(update.$set);
        Object.assign(etat, update.$set);
        return etat;
      },
      findOne: (filter: { slug: string }) => ({
        lean: async () => (etat && etat.slug === filter.slug ? etat : null),
      }),
    },
  };
}

function service(store: ImageStore, tenants: ReturnType<typeof fakeTenants>) {
  return new LogoService(tenants.model as never, store, journalMuet());
}

describe('poser un logo', () => {
  it("stocke les octets sous une clef VERSIONNÉE puis fige l'URL assortie", async () => {
    const { store, objets } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    const doc = await service(store, tenants).poser(TENANT, ORIGIN, WEBP, () => 1724500000000);

    // La clef porte la version : deux envois concurrents écrivent chacun LEUR
    // objet, la base tranche — jamais les octets de l'un sous le ?v= de l'autre.
    expect(objets.get(`logo-${TENANT}-1724500000000`)?.type).toBe('image/webp');
    expect(doc?.logoUrl).toBe(`${ORIGIN}/public/tenants/chez-nour/logo?v=1724500000000`);
  });

  it('un nouvel envoi remplace le précédent — et fait le ménage de son objet', async () => {
    const { store, objets } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    const svc = service(store, tenants);
    await svc.poser(TENANT, ORIGIN, PNG, () => 1000);
    await svc.poser(TENANT, ORIGIN, JPEG, () => 2000);

    expect([...objets.keys()]).toEqual([`logo-${TENANT}-2000`]);
    expect(tenants.etat()?.logoUrl).toContain('?v=2000');
  });

  it("refuse un fichier qui n'est pas une image, sans rien écrire", async () => {
    const { store, objets } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    await expect(
      service(store, tenants).poser(TENANT, ORIGIN, Buffer.from('<svg/>')),
    ).rejects.toThrow(/PNG, JPEG ou WebP/);
    expect(objets.size).toBe(0);
    expect(tenants.sets).toHaveLength(0);
  });

  it("n'écrit JAMAIS l'URL si le stockage échoue — pas de lien mort", async () => {
    const { store } = fakeStore({ failPut: true });
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    // Le refus ressort en phrase pour le gérant (502), jamais en « Internal
    // server error » — le vrai motif, lui, reste dans les journaux.
    await expect(service(store, tenants).poser(TENANT, ORIGIN, PNG)).rejects.toThrow(
      /hébergement d'images/,
    );
    expect(tenants.sets).toHaveLength(0);
  });

  it('refuse au-delà de 512 Ko, en français et en Ko', async () => {
    const { store } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    const enorme = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    await expect(service(store, tenants).poser(TENANT, ORIGIN, enorme)).rejects.toThrow(
      /512 Ko maximum/,
    );
  });
});

describe('servir un logo', () => {
  it('sert les octets stockés avec le type détecté, et ne relit R2 qu’une fois', async () => {
    const { store, lectures } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    const svc = service(store, tenants);
    await svc.poser(TENANT, ORIGIN, PNG);

    // L'envoi vient de mettre les octets en cache : servir ne lit pas R2.
    const un = await svc.servir('chez-nour');
    const deux = await svc.servir('chez-nour');
    expect(un?.type).toBe('image/png');
    expect(deux?.corps.equals(PNG)).toBe(true);
    expect(lectures.count).toBe(0);
  });

  it('relit R2 au premier service après redémarrage, puis sert du cache', async () => {
    const { store, objets, lectures } = fakeStore();
    objets.set(`logo-${TENANT}-1`, { corps: JPEG, type: 'image/jpeg' });
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: `${ORIGIN}/public/tenants/chez-nour/logo?v=1` });

    const svc = service(store, tenants); // cache vide : simule un redémarrage
    expect((await svc.servir('chez-nour'))?.type).toBe('image/jpeg');
    await svc.servir('chez-nour');
    expect(lectures.count).toBe(1);
  });

  it('répond « pas de logo » : slug inconnu, URL vide, ou objet disparu', async () => {
    const { store } = fakeStore();
    expect(await service(store, fakeTenants(null)).servir('fantome')).toBeNull();
    expect(
      await service(store, fakeTenants({ slug: 'chez-nour', logoUrl: null })).servir('chez-nour'),
    ).toBeNull();
    expect(
      await service(
        store,
        fakeTenants({ slug: 'chez-nour', logoUrl: `${ORIGIN}/x?v=1` }),
      ).servir('chez-nour'),
    ).toBeNull();
  });

  it('retirer efface l’objet, l’URL et le cache', async () => {
    const { store, objets, lectures } = fakeStore();
    const tenants = fakeTenants({ slug: 'chez-nour', logoUrl: null });
    const svc = service(store, tenants);
    await svc.poser(TENANT, ORIGIN, PNG);
    await svc.retirer(TENANT);

    expect(objets.size).toBe(0);
    expect(tenants.etat()?.logoUrl).toBeNull();
    expect(await svc.servir('chez-nour')).toBeNull();
    expect(lectures.count).toBe(0); // logoUrl vide : on ne va même pas voir R2
  });
});

describe('fabrique du magasin — la variable est l’interrupteur', () => {
  const silencieux = { log: () => {}, warn: () => {} };

  it('sans variables : magasin au repos, jamais de levée', () => {
    const store = createImageStore(() => undefined, silencieux);
    expect(store).toBeInstanceOf(NoopImageStore);
    expect(store.enabled).toBe(false);
  });

  it('configuration incomplète : au repos, et la fabrique prévient', () => {
    const alertes: string[] = [];
    const store = createImageStore(
      (k) => (k === 'CLOUDFLARE_API_TOKEN' ? 'jeton' : undefined),
      { log: () => {}, warn: (m) => alertes.push(m) },
    );
    expect(store.enabled).toBe(false);
    expect(alertes.join(' ')).toContain('incomplète');
  });

  it('jeton + compte : R2, bucket « sm-images » par défaut', () => {
    const env: Record<string, string> = {
      CLOUDFLARE_API_TOKEN: 'jeton',
      CLOUDFLARE_ACCOUNT_ID: 'compte',
    };
    const store = createImageStore((k) => env[k], silencieux);
    expect(store).toBeInstanceOf(R2ImageStore);
    expect(store.enabled).toBe(true);
  });
});

describe('adaptateur R2 (API REST Cloudflare)', () => {
  function fauxFetch(reponses: { status: number; corps?: Buffer }[]) {
    const appels: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      appels.push({ url: String(url), init: init ?? {} });
      const suivante = reponses.shift() ?? { status: 200 };
      return {
        ok: suivante.status >= 200 && suivante.status < 300,
        status: suivante.status,
        arrayBuffer: async () => {
          const corps = suivante.corps ?? Buffer.alloc(0);
          return corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.byteLength);
        },
      };
    }) as typeof fetch;
    return { impl, appels };
  }

  it('écrit sur le bon compte, le bon bucket, avec le jeton et le type', async () => {
    const { impl, appels } = fauxFetch([{ status: 200 }]);
    await new R2ImageStore('jeton', 'compte-42', 'sm-images', impl).put('logo-abc', PNG, 'image/png');

    const [appel] = appels;
    expect(appel?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/compte-42/r2/buckets/sm-images/objects/logo-abc',
    );
    expect(appel?.init.method).toBe('PUT');
    expect((appel?.init.headers as Record<string, string>).authorization).toBe('Bearer jeton');
    expect((appel?.init.headers as Record<string, string>)['content-type']).toBe('image/png');
  });

  it('lecture : 404 vaut « pas d’objet », 200 rend les octets, 500 lève', async () => {
    const store = (impl: typeof fetch) => new R2ImageStore('j', 'c', 'b', impl);
    expect(await store(fauxFetch([{ status: 404 }]).impl).get('x')).toBeNull();
    const corps = await store(fauxFetch([{ status: 200, corps: PNG }]).impl).get('x');
    expect(corps?.equals(PNG)).toBe(true);
    await expect(store(fauxFetch([{ status: 500 }]).impl).get('x')).rejects.toThrow('HTTP 500');
  });

  it('suppression : 404 toléré (déjà absent), autre refus lève', async () => {
    const store = (impl: typeof fetch) => new R2ImageStore('j', 'c', 'b', impl);
    await store(fauxFetch([{ status: 404 }]).impl).delete('x');
    await expect(store(fauxFetch([{ status: 403 }]).impl).delete('x')).rejects.toThrow('HTTP 403');
  });
});

/**
 * L'HÔTE DE LA REQUÊTE EST UNE ENTRÉE, PAS UNE VÉRITÉ.
 *
 * `PUT /tenants/me/logo` ne reçoit aucune URL : il en FABRIQUE une à partir
 * de `X-Forwarded-Host` puis de `Host`, deux en-têtes que le client contrôle.
 * L'URL obtenue part ensuite dans `logoUrl` ET dans `brand.logo.mark.dark`,
 * donc sur la vitrine, la carte de fidélité et le tableau de menu. C'était le
 * contournement exact de la liste blanche que les routes de masque appliquent
 * sur une URL REÇUE.
 */
describe('l’hôte d’où le logo est déposé', () => {
  const HOTES = ['snackmanager.fr', 'localhost'] as const;
  type Req = Parameters<LogoController['poser']>[3];

  const poser = (headers: Record<string, string>) => {
    const service = { actif: true, poser: (_id: string, origin: string) => origin };
    const req = { protocol: 'https', headers, get: (n: string) => headers[n.toLowerCase()] };
    const ctrl = new LogoController(service as unknown as LogoService, {
      hotes: HOTES,
    } as OriginesImages);
    return ctrl.poser(
      't1',
      SESSION,
      { buffer: PNG, mimetype: 'image/png', size: PNG.length },
      req as Req,
    );
  };

  it('accepte le domaine public et ses sous-domaines', async () => {
    await expect(poser({ host: 'api.snackmanager.fr' })).resolves.toBe(
      'https://api.snackmanager.fr',
    );
  });

  it('refuse un X-Forwarded-Host forgé — le logo aurait été servi par un tiers', async () => {
    await expect(
      poser({ 'x-forwarded-host': 'mechant.fr', host: 'api.snackmanager.fr' }),
    ).rejects.toThrow(/hôte que nous ne servons pas/);
  });

  it('refuse un faux sous-domaine : le point du suffixe n’est pas décoratif', async () => {
    await expect(poser({ host: 'evilsnackmanager.fr' })).rejects.toThrow(
      /hôte que nous ne servons pas/,
    );
    await expect(poser({ host: 'snackmanager.fr.mechant.fr' })).rejects.toThrow(
      /hôte que nous ne servons pas/,
    );
  });
});
