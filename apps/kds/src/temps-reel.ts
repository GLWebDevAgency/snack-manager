/**
 * Temps réel du tableau — la logique PURE, volontairement sans React ni
 * `react-native` : le harnais de test du KDS (vitest, sans preset natif) peut
 * charger ce module tel quel, et c'est ici que vit la décision mesurée par
 * l'audit de capacité — l'écran cuisine faisait 92 % du trafic d'un
 * restaurant à lui seul, trois GET `/orders` toutes les 5 secondes.
 *
 * ─── LA RÈGLE ───
 *
 * Le sondage ne disparaît JAMAIS. La socket n'est qu'un accélérateur : quand
 * elle est connectée, chaque événement `order.*` du tenant rafraîchit le
 * tableau dans la seconde, et le sondage s'étire à 60 s en filet de sécurité.
 * Dès qu'elle ne l'est pas — jamais connectée, coupée, morte sans un bruit —,
 * on retombe sur EXACTEMENT le comportement historique : 5 s. Au pire, la
 * cuisine est aussi fiable qu'avant ; jamais moins.
 */

/** Cadence de secours — la cadence historique de l'écran, inchangée. */
export const POLL_MS = 5000;

/**
 * Cadence quand la socket est connectée. Le sondage ne sert alors plus à voir
 * arriver les tickets (les événements s'en chargent) : il ne sert qu'à
 * rattraper un événement perdu ou une socket silencieusement morte — une
 * panne ne peut donc pas rester invisible plus d'une minute.
 */
export const POLL_SOCKET_MS = 60_000;

/**
 * Fenêtre d'absorption des rafales : une commande génère volontiers plusieurs
 * événements coup sur coup (créée, payée, avancée…) et chaque rafraîchissement
 * coûte trois GET. 300 ms n'est pas perceptible depuis le piano.
 */
export const EVENT_DEBOUNCE_MS = 300;

/**
 * Plafond du debounce : un service chargé peut émettre des événements plus
 * rapprochés que la fenêtre pendant un long moment — précisément le moment où
 * la cuisine a le plus besoin de voir les tickets. Le rafraîchissement part
 * donc AU PLUS TARD une seconde après la première demande non servie, quelle
 * que soit la rafale.
 */
export const EVENT_DEBOUNCE_MAX_MS = 1000;

/**
 * LA décision de cadence. Trois lignes, mais ce sont elles qui portent la
 * règle « jamais moins fiable qu'avant » — d'où une fonction nommée et testée
 * plutôt qu'un ternaire enfoui dans un effet.
 */
export function pollCadenceMs(socketConnectee: boolean): number {
  return socketConnectee ? POLL_SOCKET_MS : POLL_MS;
}

export interface Debounce {
  /** Demande une exécution ; des demandes rapprochées n'en produisent qu'une. */
  demander(): void;
  /** Abandonne la demande en attente — au démontage, rien ne doit tirer. */
  annuler(): void;
}

/**
 * Debounce « traînant » plafonné : l'action part `delaiMs` après la DERNIÈRE
 * demande, mais jamais plus de `plafondMs` après la PREMIÈRE encore non
 * servie. Sans le plafond, une rafale qui ne s'arrête pas repousserait le
 * rafraîchissement indéfiniment (voir `EVENT_DEBOUNCE_MAX_MS`).
 */
export function creerDebounce(
  action: () => void,
  delaiMs: number = EVENT_DEBOUNCE_MS,
  plafondMs: number = EVENT_DEBOUNCE_MAX_MS,
): Debounce {
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  /** Horodatage de la première demande non encore servie. */
  let premiereDemande: number | null = null;

  const servir = () => {
    minuterie = null;
    premiereDemande = null;
    action();
  };

  return {
    demander() {
      const maintenant = Date.now();
      premiereDemande ??= maintenant;
      if (minuterie !== null) clearTimeout(minuterie);
      const attente = Math.min(delaiMs, premiereDemande + plafondMs - maintenant);
      minuterie = setTimeout(servir, Math.max(0, attente));
    },
    annuler() {
      if (minuterie !== null) clearTimeout(minuterie);
      minuterie = null;
      premiereDemande = null;
    },
  };
}
