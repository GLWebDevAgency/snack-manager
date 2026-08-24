import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { detailErreur, fetchV4Of, type RequestFn } from './http-v4';

/**
 * Le transport IPv4 des adaptateurs sortants : ce qui se vérifie ici, c'est
 * que `family: 4` part VRAIMENT (c'est tout l'objet du fichier), que la
 * réponse a la forme que les adaptateurs lisent (`ok`, `status`,
 * `arrayBuffer`), et qu'une erreur réseau ressort BRUTE — le « fetch
 * failed » muet a coûté un diagnostic entier le 24/08.
 */

type Appel = { url: URL; options: Record<string, unknown>; corps: Buffer[] };

function fauxHttps(reponse: { status: number; corps?: string; erreur?: Error }) {
  const appels: Appel[] = [];
  const requestFn: RequestFn = (url, options, cb) => {
    const appel: Appel = { url, options: options as Record<string, unknown>, corps: [] };
    appels.push(appel);
    const req = new EventEmitter() as EventEmitter & {
      end: (c?: string | Buffer) => void;
      destroy: (e?: Error) => void;
    };
    req.end = (c) => {
      if (c) appel.corps.push(Buffer.from(c));
      if (reponse.erreur) {
        setImmediate(() => req.emit('error', reponse.erreur));
        return;
      }
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = reponse.status;
      setImmediate(() => {
        cb(res as never);
        if (reponse.corps) res.emit('data', Buffer.from(reponse.corps));
        res.emit('end');
      });
    };
    req.destroy = (e) => {
      if (e) req.emit('error', e);
    };
    return req as never;
  };
  return { requestFn, appels };
}

describe('fetchV4 — le transport forcé en IPv4', () => {
  it('poste en family 4, avec méthode, en-têtes et corps', async () => {
    const { requestFn, appels } = fauxHttps({ status: 200 });
    const res = await fetchV4Of(requestFn)('https://ntfy.sh/sujet', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'alerte',
    });

    expect(res.ok).toBe(true);
    const [appel] = appels;
    expect(appel?.options.family).toBe(4);
    expect(appel?.options.method).toBe('POST');
    expect((appel?.options.headers as Record<string, string>)['content-type']).toBe('text/plain');
    expect(Buffer.concat(appel?.corps ?? []).toString()).toBe('alerte');
  });

  it('rend la forme que les adaptateurs lisent : ok, status, arrayBuffer', async () => {
    const { requestFn } = fauxHttps({ status: 404, corps: 'absent' });
    const res = await fetchV4Of(requestFn)('https://api.cloudflare.com/x');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('absent');
  });

  it('laisse l’erreur réseau BRUTE — le code ENETUNREACH doit se lire', async () => {
    const erreur = Object.assign(new Error('connect ENETUNREACH 2604:a880::1:443'), {
      code: 'ENETUNREACH',
    });
    const { requestFn } = fauxHttps({ status: 0, erreur });
    await expect(fetchV4Of(requestFn)('https://ntfy.sh/sujet', { method: 'POST', body: 'x' }))
      .rejects.toThrow('ENETUNREACH');
  });

  it('refuse ce qui n’est pas https, sans appeler le réseau', async () => {
    const { requestFn, appels } = fauxHttps({ status: 200 });
    await expect(fetchV4Of(requestFn)('http://exemple.test/')).rejects.toThrow('https');
    expect(appels).toHaveLength(0);
  });
});

describe('detailErreur — les causes emboîtées se déplient', () => {
  it('déplie la chaîne de causes comme undici les emboîte', () => {
    const fond = Object.assign(new Error('connect ENETUNREACH 2604::1'), { code: 'ENETUNREACH' });
    const milieu = new Error('other side closed', { cause: fond });
    const dessus = new TypeError('fetch failed', { cause: milieu });
    expect(detailErreur(dessus)).toBe('fetch failed ← other side closed ← connect ENETUNREACH 2604::1');
  });

  it('sans Error, retombe sur String()', () => {
    expect(detailErreur('boum')).toBe('boum');
  });
});
