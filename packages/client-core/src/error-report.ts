/**
 * Rapporteur d'erreurs des tablettes — l'autre moitié du journal /sm/erreurs.
 *
 * Un écran blanc chez un restaurateur était invisible : l'exception mourait
 * dans le navigateur de la tablette, et la première trace était son appel
 * (diagnostic quatre casquettes, 24/08/2026, P0). Ici : les erreurs globales
 * et les promesses rejetées partent au guichet public de l'API.
 *
 * Sobre par principe :
 * - JAMAIS d'exception sortante — un rapporteur qui casse entretient sa
 *   propre avalanche ; l'envoi est fire-and-forget, l'échec silencieux ;
 * - dédoublonné et plafonné PAR SESSION — le serveur regroupe déjà par
 *   empreinte, inutile de l'arroser ;
 * - aucune donnée métier : un message, une pile, une URL. Pas de commande,
 *   pas de client, pas de PIN.
 */

export type ClientErrorBody = {
  source: 'pos' | 'kds';
  message: string;
  stack: string;
  url: string;
};

/** L'envoi appartient à l'app (elle connaît sa base API et son mode démo). */
export type ErrorPoster = (body: ClientErrorBody) => void;

const MAX_PER_SESSION = 8;

export function installClientErrorReporter(opts: {
  source: 'pos' | 'kds';
  post: ErrorPoster;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  const seen = new Set<string>();
  let sent = 0;

  const report = (message: unknown, stack?: string) => {
    const text = String(message ?? '').slice(0, 500);
    // « Script error. » : le bruit des scripts d'une autre origine, sans
    // aucune information exploitable — le journaliser ne dirait rien.
    if (!text || text === 'Script error.') return;
    const key = text.slice(0, 120);
    if (seen.has(key) || sent >= MAX_PER_SESSION) return;
    seen.add(key);
    sent += 1;
    try {
      opts.post({
        source: opts.source,
        message: text,
        stack: (stack ?? '').slice(0, 6_000),
        url: window.location?.pathname ?? '',
      });
    } catch {
      // Rien : voir l'en-tête.
    }
  };

  const onError = (event: ErrorEvent) => {
    report(event.message, event.error instanceof Error ? event.error.stack : undefined);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    report(
      reason instanceof Error ? reason.message : reason,
      reason instanceof Error ? reason.stack : undefined,
    );
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
