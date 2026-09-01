import { Platform } from 'react-native';
import { purgeLegacyApiOverride, resolveApiOrigin } from './api-origin';

/**
 * Configuration de la caisse.
 *
 * L'origine API appartient au build et ne peut jamais être remplacée par une
 * URL ou une valeur de stockage. Le pipeline vérifie en plus sa paire avec
 * EXPO_PUBLIC_SITE_URL avant chaque export.
 */
if (Platform.OS === 'web') {
  try {
    // Migration ponctuelle : ne supprimer ni appairage, ni session, ni file.
    purgeLegacyApiOverride(globalThis.localStorage);
  } catch {
    // Le stockage peut être indisponible (navigation privée, politique MDM).
  }
}

export const API_URL = resolveApiOrigin(
  process.env.EXPO_PUBLIC_API_URL,
  process.env.EXPO_PUBLIC_ALLOW_LOCAL_API === '1',
);
