/** Horloge monotone d'une scène : la pause conserve le temps déjà regardé. */
export function createSceneTimer(initialDurationMs: number, now = () => performance.now()) {
  let durationMs = initialDurationMs;
  let elapsedMs = 0;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pause = () => {
    if (startedAt !== null) elapsedMs += Math.max(0, now() - startedAt);
    startedAt = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    pause,
    setDuration(nextDurationMs: number) {
      pause();
      durationMs = nextDurationMs;
    },
    resume(onComplete: () => void) {
      if (timer !== null) return;
      startedAt = now();
      timer = setTimeout(() => {
        timer = null;
        startedAt = null;
        elapsedMs = durationMs;
        onComplete();
      }, Math.max(0, durationMs - elapsedMs));
    },
  };
}
