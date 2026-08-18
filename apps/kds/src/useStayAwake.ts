import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const TAG = 'sm-kds';

/**
 * Empêche la mise en veille pendant le service.
 *
 * On n'utilise pas `useKeepAwake` directement : en web, l'API Wake Lock rejette
 * (permission refusée, onglet en arrière-plan, navigateur non compatible) et le
 * hook laisse fuiter une promesse rejetée dans la console. Un écran qui
 * s'éteint est un inconfort, pas une panne : l'échec doit rester silencieux.
 */
export function useStayAwake(): void {
  useEffect(() => {
    void activateKeepAwakeAsync(TAG).catch(() => undefined);
    return () => {
      try {
        void Promise.resolve(deactivateKeepAwake(TAG)).catch(() => undefined);
      } catch {
        /* rien à libérer */
      }
    };
  }, []);
}
