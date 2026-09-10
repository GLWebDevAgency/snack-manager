const registrations = new Map<string, Promise<ServiceWorkerRegistration>>();

export function orderWorkerScope(slug: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug)) throw new Error('Restaurant invalide');
  return `/r/${slug}/`;
}

/** Fonctionne aussi depuis /t : ready global attendrait le mauvais document. */
export function waitForOrderWorker(registration: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) { reject(new Error('Installation indisponible')); return; }
    const finish = () => {
      if (worker.state === 'activated' || registration.active) { clean(); resolve(registration); }
      else if (worker.state === 'redundant') { clean(); reject(new Error('Installation interrompue')); }
    };
    const timeout = setTimeout(() => { clean(); reject(new Error('Installation trop longue')); }, 12_000);
    const clean = () => { clearTimeout(timeout); worker.removeEventListener('statechange', finish); };
    worker.addEventListener('statechange', finish);
    finish();
  });
}

export function registerOrderWorker(slug: string): Promise<ServiceWorkerRegistration> {
  const scope = orderWorkerScope(slug);
  const existing = registrations.get(scope);
  if (existing) return existing;
  const pending = navigator.serviceWorker.register(`${scope}sw.js`, { scope }).then(waitForOrderWorker).catch((error: unknown) => {
    registrations.delete(scope); throw error;
  });
  registrations.set(scope, pending);
  while (registrations.size > 16) registrations.delete(registrations.keys().next().value!);
  return pending;
}

export function vapidBytes(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
