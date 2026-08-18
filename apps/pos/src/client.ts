/**
 * Client API du poste de caisse.
 *
 * Toute écriture passe par `client.post` / `client.patch`, donc par la file
 * offline persistée : une coupure réseau ne fait perdre aucune commande.
 * Seule l'authentification utilise `direct` (il faut un jeton avant de pouvoir
 * empiler quoi que ce soit).
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SmClient, setStore, webStore, type KeyValueStore } from '@sm/client-core';

const DEFAULT_API = 'https://api-production-8949.up.railway.app';

/** Le poste peut être pointé vers une API locale sans rebuild (clé `sm.apiUrl`). */
function resolveBaseUrl(): string {
  if (Platform.OS === 'web') {
    try {
      const override = globalThis.localStorage?.getItem('sm.apiUrl');
      if (override) return override;
    } catch {
      /* stockage bloqué : on garde l'URL par défaut */
    }
  }
  return DEFAULT_API;
}

function nativeStore(): KeyValueStore {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    async setItem(key, value) {
      await AsyncStorage.setItem(key, value);
    },
    async removeItem(key) {
      await AsyncStorage.removeItem(key);
    },
  };
}

// Doit être appelé AVANT toute construction de file de sync.
setStore(Platform.OS === 'web' ? webStore() : nativeStore());

export const TENANT_SLUG = 'classfood';

export const client = new SmClient({ baseUrl: resolveBaseUrl() });

// ─── Clés de persistance locale ───

export const KEYS = {
  session: 'sm.pos.session.v1',
  parked: 'sm.pos.parked.v1',
  dayLog: 'sm.pos.daylog.v1',
} as const;

export interface Session {
  token: string;
  staffName: string;
  staffRole: string;
  tenantName: string;
  tenantSlug: string;
  brandColor: string;
  at: number;
}

export interface PinLoginResponse {
  token: string;
  staff: { name: string; role: string };
  tenant: { slug: string; name: string; brandColor: string };
}
