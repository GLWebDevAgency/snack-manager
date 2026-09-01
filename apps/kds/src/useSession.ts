import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { DEVICE_HEARTBEAT_INTERVAL_MS } from '@sm/contracts';
import { type SmClient } from '@sm/client-core';
import {
  DeviceError,
  deviceHeartbeat,
  forgetPairedDevice,
  loadPairedDevice,
  pairedDevice,
  pinLogin,
  subscribeDevice,
  type PairedDevice,
} from './client';
import { KEY_SESSION } from './config';

/**
 * Session cuisine — appairage de l'appareil, puis ouverture par PIN.
 *
 * Ce sont DEUX choses distinctes, et c'est essentiel : l'équipe se déconnecte
 * tous les soirs, la tablette reste appairée pour la vie du restaurant.
 *
 * L'appairage remplace la constante `TENANT_SLUG` que ce module envoyait
 * jusqu'ici dans le corps de `/auth/pin`. L'établissement est désormais déduit
 * du jeton d'appareil, côté serveur : la cuisine ne peut plus, même par
 * accident de configuration, afficher les tickets du restaurant voisin.
 *
 * Le jeton staff est persisté : une tablette qui redémarre en plein service ne
 * redemande pas le code.
 */

export interface Session {
  token: string;
  staff: { name: string; role: string };
  tenant: { slug: string; name: string; brandColor: string };
}

/**
 * Appairage courant, lu comme un magasin externe.
 *
 * L'écran d'ouverture en a besoin pour se peindre aux couleurs du restaurant,
 * sans pour autant dépendre de la session : à ce moment-là il n'y en a pas.
 */
export function useDevice(): PairedDevice | null {
  return useSyncExternalStore(subscribeDevice, pairedDevice, pairedDevice);
}

export function useSession(client: SmClient) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const device = useDevice();

  /**
   * Restauration au démarrage : d'ABORD l'appairage, ensuite la session.
   *
   * L'ordre compte. Sans appairage, une session enregistrée ne veut plus rien
   * dire — son jeton a été émis pour un établissement que cette tablette ne
   * sert plus.
   */
  useEffect(() => {
    let alive = true;
    setRestoring(true);
    setRestoreError(null);
    void (async () => {
      try {
        const paired = await loadPairedDevice();
        if (!paired) return;
        try {
          const raw = await client.tenantStore.getItem(KEY_SESSION);
          if (raw) {
            const parsed = JSON.parse(raw) as Session;
            if (parsed?.token && parsed.tenant?.slug === paired.tenant.slug) {
              client.setToken(parsed.token);
              if (alive) setSession(parsed);
            } else {
              await client.tenantStore.removeItem(KEY_SESSION);
            }
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            await client.tenantStore.removeItem(KEY_SESSION);
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (alive) {
          setRestoreError(
            error instanceof Error
              ? error.message
              : 'Le stockage sécurisé de la cuisine est indisponible.',
          );
        }
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, restoreAttempt]);

  const retryRestore = useCallback(() => {
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  const logout = useCallback(async () => {
    client.setToken(null);
    await client.tenantStore.removeItem(KEY_SESSION);
    setSession(null);
  }, [client]);

  const login = useCallback(
    async (pin: string) => {
      const data = await pinLogin(pin);
      const next: Session = { token: data.token, staff: data.staff, tenant: data.tenant };
      client.setToken(next.token);
      await client.tenantStore.setItem(KEY_SESSION, JSON.stringify(next));
      setSession(next);
    },
    [client],
  );

  /**
   * Battement de cœur de l'appareil.
   *
   * Le back-office voit « écran cuisine en ligne » — le seul incident possible
   * sur cette tablette est qu'elle se taise —, et la marque revient à jour, si
   * bien qu'un changement de nom ou de couleur se propage sans réappairage.
   * Une révocation (tablette perdue) ferme la session sur-le-champ.
   */
  useEffect(() => {
    if (!device) return;
    let alive = true;

    const beat = () => {
      void deviceHeartbeat().catch((e: unknown) => {
        if (!alive || !(e instanceof DeviceError) || e.status !== 401) return;
        // Le jeton a été révoqué : garder l'appairage en mémoire ne ferait
        // qu'échouer à chaque saisie de code. On ramène l'écran à l'appairage.
        setSession(null);
        void forgetPairedDevice();
      });
    };

    beat();
    const id = setInterval(beat, DEVICE_HEARTBEAT_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [device]);

  return { session, restoring, restoreError, retryRestore, login, logout, device };
}
