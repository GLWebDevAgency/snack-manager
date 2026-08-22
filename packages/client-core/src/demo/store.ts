/**
 * Stockage local de la démonstration — en mémoire, et seulement en mémoire.
 *
 * Deux raisons, dans cet ordre :
 *
 * 1. RIEN NE DOIT SURVIVRE. Le visiteur doit pouvoir tout casser : un
 *    rechargement lui rend une caisse neuve. Écrire dans `localStorage`
 *    laisserait au contraire une session, un journal de service et une file de
 *    commandes fantômes dans son navigateur — visibles ensuite par une VRAIE
 *    caisse ouverte depuis la même machine, ce qui est exactement l'accident
 *    qu'on veut rendre impossible.
 * 2. RIEN NE DOIT MANQUER AU DÉMARRAGE. Les applications lisent leur session et
 *    leur appairage au montage. Le magasin est donc pré-alimenté à la
 *    construction, avant qu'aucun écran ne se peigne : le visiteur n'aperçoit
 *    jamais l'écran d'appairage ni le clavier de code.
 */
import type { KeyValueStore } from '../storage';

export function demoStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}
