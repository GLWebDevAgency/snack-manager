import { Platform } from 'react-native';

/**
 * Alertes sonores du KDS — module isolé.
 *
 * En web : synthèse Web Audio (oscillateurs), aucun fichier audio à charger,
 * donc aucun échec possible en cuisine sans internet.
 * En natif : implémentation muette pour l'instant ; brancher `expo-audio`
 * derrière la même interface le moment venu (voir `nativeSound`).
 *
 * Deux signaux distincts, volontairement reconnaissables sans regarder l'écran :
 *  - `newOrder()` : double note descendante 880 → 660 Hz (« un ticket est tombé ») ;
 *  - `reminder()` : triple bip 880 Hz plus sec (« un ticket t'attend toujours »).
 */

export interface KdsSound {
  /** Débloque le contexte audio — les navigateurs l'exigent après un geste utilisateur. */
  unlock(): void;
  /** Arrivée d'une commande. */
  newOrder(): void;
  /** Rappel périodique tant qu'un ticket « Nouveau » n'est pas accepté. */
  reminder(): void;
}

// ─────────────────────────────────────────────────────────────
// Web Audio
// ─────────────────────────────────────────────────────────────

type Ctor = new () => AudioContext;

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (Platform.OS !== 'web') return null;
  try {
    if (!ctx) {
      const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
      const Impl = g.AudioContext ?? g.webkitAudioContext;
      if (!Impl) return null;
      ctx = new Impl();
    }
    // Suspendu tant qu'aucun geste utilisateur n'a eu lieu (politique navigateur).
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // audio indisponible : le KDS reste parfaitement utilisable
  }
}

/**
 * Une note carrée avec enveloppe attaque/chute — sans la rampe, l'oscillateur
 * claque au démarrage et au coupage, ce qui s'entend très mal sur les
 * haut-parleurs bon marché des tablettes de comptoir.
 */
function tone(ac: AudioContext, at: number, freq: number, dur: number, peak: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.setValueAtTime(peak, at + Math.max(0.02, dur - 0.04));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

const webSound: KdsSound = {
  unlock() {
    audio();
  },
  newOrder() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    tone(ac, t, 880, 0.1, 0.06);
    tone(ac, t + 0.1, 660, 0.12, 0.06);
  },
  reminder() {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    for (let i = 0; i < 3; i++) tone(ac, t + i * 0.22, 880, 0.09, 0.05);
  },
};

// Premier geste utilisateur = déblocage du contexte. Posé une fois au chargement
// pour que le tout premier ticket sonne, même si personne n'a touché la barre.
if (Platform.OS === 'web') {
  const once = { once: true, passive: true } as const;
  globalThis.addEventListener?.('pointerdown', () => webSound.unlock(), once);
  globalThis.addEventListener?.('keydown', () => webSound.unlock(), once);
}

// ─────────────────────────────────────────────────────────────
// Natif — à brancher (expo-audio)
// ─────────────────────────────────────────────────────────────

/**
 * Stub natif : les mêmes points d'entrée, sans son. À remplacer par deux
 * `AudioPlayer` expo-audio (ou une synthèse native) en respectant les profils
 * ci-dessus. Prévoir le mode silencieux iOS (`playsInSilentMode`).
 */
const nativeSound: KdsSound = {
  unlock() {},
  newOrder() {},
  reminder() {},
};

export const sound: KdsSound = Platform.OS === 'web' ? webSound : nativeSound;

/** `true` quand les alertes sonores sont réellement audibles sur cette plateforme. */
export const soundSupported = Platform.OS === 'web';
