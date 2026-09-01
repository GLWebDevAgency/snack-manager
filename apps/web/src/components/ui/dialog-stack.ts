/**
 * Petite pile ordonnée utilisée par le gestionnaire de dialogues.
 *
 * Elle reste volontairement indépendante du DOM : son comportement imbriqué
 * est ainsi testable dans l'environnement Vitest Node déjà présent, sans
 * ajouter jsdom au bundle de développement.
 */
export function createDialogStack<T>() {
  const entries: Array<{ id: symbol; value: T }> = [];

  return {
    push(value: T) {
      const id = Symbol("dialog-layer");
      entries.push({ id, value });
      return id;
    },

    remove(id: symbol) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) return { removed: false, wasTop: false } as const;

      const wasTop = index === entries.length - 1;
      entries.splice(index, 1);
      return { removed: true, wasTop } as const;
    },

    get top(): T | undefined {
      return entries.at(-1)?.value;
    },

    get size() {
      return entries.length;
    },
  };
}
