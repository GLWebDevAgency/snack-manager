/**
 * Temps réel des surfaces terrain — la logique PURE, volontairement sans React
 * ni `react-native` : les harnais de test (vitest, sans preset natif) chargent
 * ce module tel quel.
 *
 * Il vivait dans `apps/kds`. Il est remonté ici le jour où la CAISSE a eu, elle
 * aussi, une vue du service à tenir à jour : la doctrine ci-dessous n'est pas
 * propre à la cuisine, c'est celle du dépôt pour toute lecture répétée.
 *
 * ─── LA RÈGLE ───
 *
 * Le sondage ne disparaît JAMAIS. La socket n'est qu'un accélérateur : quand
 * elle est connectée, chaque événement `order.*` du tenant rafraîchit l'écran
 * dans la seconde, et le sondage s'étire en filet de sécurité. Dès qu'elle ne
 * l'est pas — jamais connectée, coupée, morte sans un bruit —, on retombe sur
 * EXACTEMENT le comportement historique de la surface. Au pire elle est aussi
 * fiable qu'avant ; jamais moins.
 *
 * La cadence de secours n'est donc PAS une constante partagée : la cuisine
 * resonde toutes les 5 s (trois GET, un écran qui ne fait que ça), la caisse
 * toutes les 12 s (amorce journalière si nécessaire + trois statuts actifs, un
 * poste qui encaisse en même temps). Chaque surface apporte sa cadence ; ce
 * module ne décide que de la RÈGLE.
 */

/** Cadence de secours historique de l'écran cuisine — trois GET par tour. */
export const POLL_MS = 5000;

/** Cadence de secours historique de la caisse — réconciliation du journal. */
export const POLL_POS_MS = 12_000;

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
 * coûte au moins un GET. 300 ms n'est perceptible ni depuis le piano, ni
 * depuis le comptoir.
 */
export const EVENT_DEBOUNCE_MS = 300;

/**
 * Plafond du debounce : un service chargé peut émettre des événements plus
 * rapprochés que la fenêtre pendant un long moment — précisément le moment où
 * l'équipe a le plus besoin de voir les commandes. Le rafraîchissement part
 * donc AU PLUS TARD une seconde après la première demande non servie, quelle
 * que soit la rafale.
 */
export const EVENT_DEBOUNCE_MAX_MS = 1000;

/**
 * LA décision de cadence. Trois lignes, mais ce sont elles qui portent la
 * règle « jamais moins fiable qu'avant » — d'où une fonction nommée et testée
 * plutôt qu'un ternaire enfoui dans un effet.
 *
 * `cadenceDeSecours` est la cadence historique de la surface appelante : la
 * socket ne peut que l'ÉTIRER, jamais la resserrer, et jamais la remplacer.
 */
export function pollCadenceMs(socketConnectee: boolean, cadenceDeSecours: number = POLL_MS): number {
  return socketConnectee ? Math.max(cadenceDeSecours, POLL_SOCKET_MS) : cadenceDeSecours;
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

// ─────────────────────────────────────────────────────────────
// La fraîcheur, dite honnêtement
// ─────────────────────────────────────────────────────────────

/**
 * Au-delà de ce délai sans lecture réussie, l'écran ne prétend plus être à
 * jour : il le DIT. Deux tours de sondage de la caisse (12 s) plus une marge —
 * en dessous, un simple tour manqué ferait clignoter une alerte pour rien.
 */
export const FRAICHEUR_SUSPECTE_MS = 30_000;

export interface Fraicheur {
  /** Aucune lecture réussie depuis le démarrage de la surface. */
  jamais: boolean;
  /** Millisecondes depuis la dernière lecture réussie (`0` si jamais). */
  ageMs: number;
  /** Au-delà du seuil : ce qui est affiché n'est plus une photo récente. */
  perimee: boolean;
  /** Phrase prête à afficher — jamais un chiffre figé qui aurait l'air vivant. */
  libelle: string;
}

/**
 * DEPUIS QUAND CET ÉCRAN N'A-T-IL PAS ÉTÉ RAFRAÎCHI.
 *
 * Une caisse travaille hors ligne, et le pire affichage possible pendant une
 * coupure est un compteur figé qui ressemble à un compteur vivant : on croit
 * lire l'état du service, on lit une photo de tout à l'heure. La règle du
 * dépôt est celle du KDS — la lecture n'est JAMAIS servie depuis un cache
 * disque, pour que la panne remonte comme une panne — et l'écran garde la
 * dernière photo en mémoire uniquement, DATÉE.
 *
 * @param derniereLectureMs horodatage de la dernière lecture serveur RÉUSSIE,
 *        `null` tant qu'aucune n'a abouti. C'est bien l'horloge des LECTURES :
 *        `QueueState.lastSyncAt` date le dernier ENVOI réussi de la file, ce
 *        qui ne dit rien de l'âge de ce qui est à l'écran.
 * @param maintenant horloge partagée (`useNow`), pour que le libellé vieillisse
 *        seul sans qu'aucun rendu ne soit forcé ailleurs.
 */
export function fraicheur(
  derniereLectureMs: number | null,
  maintenant: number,
  seuilMs: number = FRAICHEUR_SUSPECTE_MS,
): Fraicheur {
  if (derniereLectureMs === null) {
    return { jamais: true, ageMs: 0, perimee: true, libelle: 'Jamais rafraîchi' };
  }
  // Une horloge qui recule (mise à l'heure NTP, changement manuel) donnerait un
  // âge négatif, donc « il y a -3 s ». On borne à zéro plutôt que d'afficher
  // une absurdité au comptoir.
  const ageMs = Math.max(0, maintenant - derniereLectureMs);
  return {
    jamais: false,
    ageMs,
    perimee: ageMs >= seuilMs,
    libelle: `Actualisé ${ilYA(ageMs)}`,
  };
}

/**
 * « à l'instant » · « il y a 42 s » · « il y a 7 min » · « il y a 2 h 05 ».
 *
 * Les paliers sont ceux de la lecture au comptoir : sous dix secondes, le
 * chiffre exact n'apprend rien et bouge pour rien ; au-delà de l'heure, les
 * minutes seules ne se lisent plus (« il y a 143 min »).
 */
export function ilYA(ageMs: number): string {
  const s = Math.floor(Math.max(0, ageMs) / 1000);
  if (s < 10) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return `il y a ${h} h ${String(min % 60).padStart(2, '0')}`;
}
