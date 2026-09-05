/** Une session par brouillon : un seul appel actif, aucun travail après fermeture. */
export function createPreviewSession<T>({
  request,
  onStart,
  onContent,
  onError,
  debounceMs = 250,
  pollMs = 30_000,
  timeoutMs = 15_000,
}: {
  request: (signal: AbortSignal) => Promise<T>;
  onStart: () => void;
  onContent: (content: T) => void;
  onError: (error: unknown) => void;
  debounceMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}) {
  let alive = true;
  let initial = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let active: AbortController | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay: number) => {
    if (!alive) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      initial = false;
      refresh();
    }, delay);
  };

  const refresh = () => {
    // Le focus pendant le debounce ou un appel ne crée pas de doublon.
    if (!alive || initial || active) return;
    clearTimer();
    const controller = new AbortController();
    active = controller;
    onStart();

    const finish = (deliver: () => void) => {
      // Protège aussi contre un transport qui ignore l'annulation et répond tard.
      if (!alive || active !== controller) return;
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      active = null;
      deliver();
      schedule(pollMs);
    };

    deadline = setTimeout(() => {
      controller.abort();
      finish(() => onError(new Error("L’aperçu met trop de temps à répondre. Réessayez.")));
    }, timeoutMs);

    void (async () => {
      try {
        const content = await request(controller.signal);
        finish(() => onContent(content));
      } catch (error) {
        finish(() => onError(error));
      }
    })();
  };

  schedule(debounceMs);
  return {
    refresh,
    stop() {
      alive = false;
      clearTimer();
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      active?.abort();
      active = null;
    },
  };
}
