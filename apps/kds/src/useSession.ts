import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore, type SmClient } from '@sm/client-core';
import { KEY_SESSION, TENANT_SLUG } from './config';

/**
 * Session cuisine ouverte par PIN.
 *
 * Le jeton est persisté : une tablette qui redémarre en plein service ne
 * redemande pas le code. `client.direct` court-circuite volontairement la file
 * offline — s'authentifier sans réseau n'a aucun sens, autant échouer
 * franchement et laisser la session précédente en place.
 */

export interface Session {
  token: string;
  staff: { name: string; role: string };
  tenant: { slug: string; name: string; brandColor: string };
}

interface PinResponse {
  token: string;
  staff: { name: string; role: string };
  tenant: { slug: string; name: string; brandColor: string };
}

export function useSession(client: SmClient) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      try {
        const raw = await getStore().getItem(KEY_SESSION);
        if (raw) {
          const parsed = JSON.parse(raw) as Session;
          if (parsed?.token) {
            client.setToken(parsed.token);
            setSession(parsed);
          }
        }
      } catch {
        // session illisible : on redemande le PIN, c'est l'affaire de 2 secondes
      } finally {
        setRestoring(false);
      }
    })();
  }, [client]);

  const login = useCallback(
    async (pin: string) => {
      const data = await client.direct<PinResponse>('POST', '/auth/pin', {
        tenantSlug: TENANT_SLUG,
        pin,
      });
      const next: Session = { token: data.token, staff: data.staff, tenant: data.tenant };
      client.setToken(next.token);
      await getStore().setItem(KEY_SESSION, JSON.stringify(next));
      setSession(next);
    },
    [client],
  );

  const logout = useCallback(async () => {
    client.setToken(null);
    await getStore().removeItem(KEY_SESSION);
    setSession(null);
  }, [client]);

  return { session, restoring, login, logout };
}
