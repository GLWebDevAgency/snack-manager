import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from './client';
import { KEY_PREFS } from './config';
import { DEFAULT_PREFS, parsePrefs, type KdsPrefs } from './prefs';

/** Les réglages suivent le poste sans remonter les hooks de commandes ou de son. */
export function usePrefs(scope: string | null) {
  const [prefs, setPrefs] = useState<KdsPrefs>(() => ({ ...DEFAULT_PREFS }));
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const current = useRef(prefs);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    const epoch = ++generation.current;
    const cancel = () => { alive = false; if (generation.current === epoch) generation.current += 1; };
    setLoadedScope(null);
    current.current = { ...DEFAULT_PREFS };
    setPrefs(current.current);
    if (!scope) return cancel;
    void client.tenantStore.getItem(KEY_PREFS).then((raw) => {
      if (!alive || activeScope.current !== scope) return;
      current.current = parsePrefs(raw);
      setPrefs(current.current);
    }).catch(() => undefined).finally(() => {
      if (alive && activeScope.current === scope) setLoadedScope(scope);
    });
    return cancel;
  }, [scope]);

  const ready = !!scope && loadedScope === scope;
  const patchPrefs = useCallback((patch: Partial<KdsPrefs> | ((value: KdsPrefs) => Partial<KdsPrefs>)) => {
    if (!ready || !scope || activeScope.current !== scope) return;
    const next = { ...current.current, ...(typeof patch === 'function' ? patch(current.current) : patch) };
    current.current = next;
    setPrefs(next);
    const epoch = generation.current;
    writes.current = writes.current.then(async () => {
      if (activeScope.current === scope && generation.current === epoch) await client.tenantStore.setItem(KEY_PREFS, JSON.stringify(next));
    }).catch(() => undefined);
  }, [ready, scope]);

  return { prefs: ready ? prefs : DEFAULT_PREFS, ready, patchPrefs };
}
