export type LatestRequestTicket = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export type LatestRequestCoordinator = {
  start: () => LatestRequestTicket;
  cancel: () => void;
  finish: (ticket: LatestRequestTicket) => void;
};

/**
 * Un seul chargement de liste peut publier son résultat. Démarrer une requête
 * annule la précédente et invalide sa génération, même si le transport ignore
 * AbortSignal et finit tout de même par répondre.
 */
export function createLatestRequestCoordinator(): LatestRequestCoordinator {
  let generation = 0;
  let active: { generation: number; controller: AbortController } | null = null;

  return {
    start() {
      active?.controller.abort();
      generation += 1;
      const current = {
        generation,
        controller: new AbortController(),
      };
      active = current;
      return {
        signal: current.controller.signal,
        isCurrent: () =>
          active === current &&
          generation === current.generation &&
          !current.controller.signal.aborted,
      };
    },
    cancel() {
      generation += 1;
      active?.controller.abort();
      active = null;
    },
    finish(ticket) {
      if (ticket.isCurrent()) active = null;
    },
  };
}
