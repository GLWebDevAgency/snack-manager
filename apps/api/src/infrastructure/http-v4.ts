import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';

/**
 * `fetch`, MAIS EN IPv4 FORCÉ — le transport des adaptateurs sortants.
 *
 * Constat du 24/08/2026, sur staging : « Tester le canal » → « webhook
 * injoignable (TypeError: fetch failed) ». La cause : ntfy.sh publie une
 * adresse IPv6, le conteneur Railway n'a PAS de sortie IPv6 publique, et le
 * `fetch` de Node tente l'IPv6 en premier sans retomber sur l'IPv4 (le
 * repli « happy eyeballs » du moteur ne couvre pas toutes les versions
 * embarquées). Même pile double chez api.brevo.com (e-mail d'alerte) et
 * api.cloudflare.com (magasin d'images R2) : TOUS les adaptateurs sortants
 * de l'infrastructure étaient exposés — quand api.stripe.com, en IPv4 seul,
 * serait passé sans bruit. D'où un transport commun qui ne se pose pas la
 * question : `family: 4`, point.
 *
 * La SIGNATURE reste celle de `fetch` : les adaptateurs (webhook, Brevo, R2)
 * ne lisent que `ok`, `status` et `arrayBuffer()`, et leurs tests injectent
 * déjà des doublures à cette forme — changer le transport ne change ni les
 * appelants ni les tests. Les erreurs réseau ressortent BRUTES (`connect
 * ENETUNREACH…`), pas emmaillotées dans un « fetch failed » muet : c'est
 * précisément l'opacité qui a coûté ce diagnostic.
 */
export type RequestFn = (
  url: URL,
  options: RequestOptions,
  cb: (res: IncomingMessage) => void,
) => ClientRequest;

export function fetchV4Of(requestFn: RequestFn = httpsRequest): typeof fetch {
  return ((entree: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(String(entree));
    if (url.protocol !== 'https:') {
      return Promise.reject(new TypeError(`fetchV4 ne parle que https — reçu ${url.protocol}`));
    }
    return new Promise<Response>((resolve, reject) => {
      const req = requestFn(
        url,
        {
          family: 4,
          method: init?.method ?? 'GET',
          headers: (init?.headers as Record<string, string>) ?? {},
        },
        (res) => {
          const morceaux: Buffer[] = [];
          res.on('data', (chunk: Buffer) => morceaux.push(chunk));
          res.on('end', () => {
            // `Response` natif : `ok`, `status`, `arrayBuffer()`, `json()`
            // dérivés d'office — exactement ce que les adaptateurs lisent.
            resolve(
              new Response(new Uint8Array(Buffer.concat(morceaux)), {
                status: res.statusCode ?? 502,
              }),
            );
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      const signal = init?.signal;
      if (signal) {
        const couper = () => req.destroy(new Error('délai dépassé (signal)'));
        if (signal.aborted) couper();
        else signal.addEventListener('abort', couper, { once: true });
      }
      const corps = init?.body;
      if (corps !== undefined && corps !== null) {
        req.end(typeof corps === 'string' ? corps : Buffer.from(corps as Uint8Array));
      } else {
        req.end();
      }
    });
  }) as typeof fetch;
}

/** Le transport par défaut des adaptateurs sortants. */
export const fetchV4 = fetchV4Of();

/**
 * La VRAIE raison d'un échec réseau, causes emboîtées dépliées — undici
 * enveloppe `connect ENETUNREACH 2604:…` sous deux niveaux de `cause`, et
 * « TypeError: fetch failed » seul a déjà coûté un aller-retour de
 * diagnostic. Trois niveaux suffisent ; au-delà c'est du bruit.
 */
export function detailErreur(cause: unknown): string {
  const morceaux: string[] = [];
  let courant: unknown = cause;
  for (let i = 0; i < 3 && courant instanceof Error; i += 1) {
    morceaux.push(courant.message);
    courant = courant.cause;
  }
  return morceaux.length > 0 ? morceaux.join(' ← ') : String(cause);
}
