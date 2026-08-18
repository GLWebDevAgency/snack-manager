import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SmClient, setStore, webStore, type KeyValueStore } from '@sm/client-core';
import { API_URL } from './config';

/**
 * Client unique de l'app. Toute écriture (changement de statut) passe par
 * `client.patch`, donc par la file offline persistée : l'interface avance
 * immédiatement, le réseau rattrape quand il revient.
 */

/** AsyncStorage enveloppé dans le contrat KeyValueStore du noyau. */
function nativeStore(): KeyValueStore {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

// À faire AVANT toute lecture/écriture : sinon le noyau retombe sur un store
// mémoire qui ne survit pas au redémarrage de la tablette.
setStore(Platform.OS === 'web' ? webStore() : nativeStore());

export const client = new SmClient({ baseUrl: API_URL });
