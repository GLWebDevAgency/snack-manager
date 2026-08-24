import { fetchV4 } from '../http-v4';
import type { ImageStore } from './image-store';

/**
 * Cloudflare R2, par l'API REST (`api.cloudflare.com`) — le même chemin et le
 * même jeton que la sauvegarde nocturne (`.github/workflows/sauvegarde.yml`,
 * qui passe par `wrangler r2 object put`, lui-même bâti sur cette API).
 *
 * POURQUOI LA REST ET PAS S3 : l'API S3 de R2 exige des clefs d'accès d'un
 * autre type (Access Key + Secret, à générer à la main dans le tableau de
 * bord R2), et la doc Cloudflare précise que ces jetons « Object » ne
 * fonctionnent PAS contre la REST. Un seul couple de secrets pour la
 * sauvegarde ET les images (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)
 * bat deux mécanismes d'auth à maintenir. La REST est limitée en débit — sans
 * importance ici : le module tenants met les logos en cache mémoire et ne
 * relit un objet qu'au premier service après (re)démarrage ou changement.
 *
 * Les clefs restent PLATES (`logo-<id>`, pas de `/`) : le segment d'URL
 * `objects/{key}` encodé n'a pas à porter la question « %2F vaut-il / ? ».
 */
export class R2ImageStore implements ImageStore {
  readonly enabled = true;
  readonly providerName = 'Cloudflare R2';

  constructor(
    private readonly apiToken: string,
    private readonly accountId: string,
    private readonly bucket: string,
    // IPv4 forcé : api.cloudflare.com publie une IPv6 que Railway ne sait
    // pas joindre — même mal que ntfy et Brevo, voir `http-v4.ts`.
    private readonly fetchImpl: typeof fetch = fetchV4,
  ) {}

  private urlOf(key: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/r2/buckets/${this.bucket}/objects/${encodeURIComponent(key)}`;
  }

  private get authHeader(): Record<string, string> {
    return { authorization: `Bearer ${this.apiToken}` };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.fetchImpl(this.urlOf(key), {
      method: 'PUT',
      headers: { ...this.authHeader, 'content-type': contentType },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`R2 : écriture de « ${key} » refusée (HTTP ${res.status})`);
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.fetchImpl(this.urlOf(key), { headers: this.authHeader });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 : lecture de « ${key} » refusée (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.fetchImpl(this.urlOf(key), {
      method: 'DELETE',
      headers: this.authHeader,
    });
    // 404 toléré : l'objet absent est exactement l'état recherché.
    if (!res.ok && res.status !== 404) {
      throw new Error(`R2 : suppression de « ${key} » refusée (HTTP ${res.status})`);
    }
  }
}
