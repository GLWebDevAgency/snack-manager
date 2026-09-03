import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creerDebounce,
  EVENT_DEBOUNCE_MAX_MS,
  EVENT_DEBOUNCE_MS,
  FRAICHEUR_SUSPECTE_MS,
  POLL_MS,
  POLL_POS_MS,
  POLL_SOCKET_MS,
  fraicheur,
  ilYA,
  pollCadenceMs,
} from './temps-reel';

/**
 * AUCUNE SURFACE NE DOIT ÊTRE MOINS FIABLE QU'AVANT LA SOCKET.
 *
 * La socket temps réel est un accélérateur, pas un remplaçant : ces tests
 * épinglent le contrat de repli. Socket absente, coupée ou silencieusement
 * morte → la cadence historique de la surface, À L'IDENTIQUE. Socket connectée
 * → 60 s de filet, et chaque événement `order.*` rafraîchit dans la seconde,
 * rafales absorbées.
 */

describe('le choix de la cadence de sondage', () => {
  it('retombe sur les 5 s historiques de la cuisine dès que la socket n’est pas connectée', () => {
    // La valeur littérale est le contrat : si quelqu'un « optimise » le
    // secours à 30 s, ce test doit le forcer à venir lire pourquoi.
    expect(POLL_MS).toBe(5000);
    expect(pollCadenceMs(false)).toBe(5000);
  });

  it('retombe sur les 12 s historiques de la caisse quand c’est elle qui appelle', () => {
    expect(POLL_POS_MS).toBe(12_000);
    expect(pollCadenceMs(false, POLL_POS_MS)).toBe(12_000);
  });

  it('étire le sondage à 60 s quand la socket est connectée, pour les deux surfaces', () => {
    expect(POLL_SOCKET_MS).toBe(60_000);
    expect(pollCadenceMs(true)).toBe(60_000);
    expect(pollCadenceMs(true, POLL_POS_MS)).toBe(60_000);
  });

  it('ne RESSERRE jamais la cadence d’une surface plus lente que le filet', () => {
    // Une surface qui sonderait déjà toutes les 5 minutes ne doit pas se
    // mettre à sonder plus souvent parce qu'elle a gagné une socket : la
    // socket ne peut qu'étirer, jamais accélérer le secours.
    expect(pollCadenceMs(true, 300_000)).toBe(300_000);
  });
});

describe('le debounce des événements temps réel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sert une demande isolée après la fenêtre, pas avant', () => {
    const action = vi.fn();
    const debounce = creerDebounce(action);

    debounce.demander();
    vi.advanceTimersByTime(EVENT_DEBOUNCE_MS - 1);
    expect(action).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('absorbe une rafale en une seule exécution, calée sur la dernière demande', () => {
    const action = vi.fn();
    const debounce = creerDebounce(action);

    // Trois événements en 200 ms — une commande créée puis aussitôt avancée.
    debounce.demander();
    vi.advanceTimersByTime(100);
    debounce.demander();
    vi.advanceTimersByTime(100);
    debounce.demander();

    vi.advanceTimersByTime(EVENT_DEBOUNCE_MS);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('sert AU PLUS TARD au plafond, même si la rafale ne s’arrête jamais', () => {
    const action = vi.fn();
    const debounce = creerDebounce(action);

    // Un événement toutes les 200 ms, sans fin : chaque demande retombe dans
    // la fenêtre de la précédente. Sans plafond, l'action ne partirait jamais
    // — précisément pendant le coup de feu où l'équipe en a le plus besoin.
    for (let t = 0; t < EVENT_DEBOUNCE_MAX_MS; t += 200) {
      debounce.demander();
      vi.advanceTimersByTime(200);
    }
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('repart de zéro après avoir servi', () => {
    const action = vi.fn();
    const debounce = creerDebounce(action);

    debounce.demander();
    vi.advanceTimersByTime(EVENT_DEBOUNCE_MS);
    debounce.demander();
    vi.advanceTimersByTime(EVENT_DEBOUNCE_MS);

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('ne tire plus rien une fois annulé — le démontage ne laisse pas de minuterie', () => {
    const action = vi.fn();
    const debounce = creerDebounce(action);

    debounce.demander();
    debounce.annuler();
    vi.advanceTimersByTime(EVENT_DEBOUNCE_MAX_MS * 2);

    expect(action).not.toHaveBeenCalled();
  });
});

/**
 * UN CHIFFRE FIGÉ QUI A L'AIR VIVANT EST UN MENSONGE.
 *
 * C'est tout l'objet de ces tests : pendant une coupure, l'écran doit dire
 * depuis quand il n'a pas été rafraîchi, et non continuer à présenter sa
 * dernière photo comme si elle datait de l'instant.
 */
describe('la fraîcheur d’une lecture serveur', () => {
  it('dit « jamais rafraîchi » tant qu’aucune lecture n’a abouti', () => {
    const f = fraicheur(null, 1_000_000);
    expect(f.jamais).toBe(true);
    expect(f.perimee).toBe(true);
    expect(f.libelle).toBe('Jamais rafraîchi');
  });

  it('reste fraîche tant qu’on est sous le seuil', () => {
    const now = 1_000_000;
    const f = fraicheur(now - 5_000, now);
    expect(f.perimee).toBe(false);
    expect(f.ageMs).toBe(5_000);
  });

  it('bascule en périmée au seuil exact — la borne est le contrat', () => {
    const now = 1_000_000;
    expect(fraicheur(now - FRAICHEUR_SUSPECTE_MS + 1, now).perimee).toBe(false);
    expect(fraicheur(now - FRAICHEUR_SUSPECTE_MS, now).perimee).toBe(true);
  });

  it('ne rend jamais un âge négatif quand l’horloge du poste recule', () => {
    // Mise à l'heure NTP ou réglage manuel pendant le service : sans borne,
    // le comptoir lirait « il y a -3 s ».
    const f = fraicheur(2_000_000, 1_000_000);
    expect(f.ageMs).toBe(0);
    expect(f.libelle).toBe('Actualisé à l’instant');
  });
});

describe('la formulation de l’ancienneté', () => {
  it('ne fait pas défiler un compteur sous dix secondes', () => {
    expect(ilYA(0)).toBe('à l’instant');
    expect(ilYA(9_999)).toBe('à l’instant');
  });

  it('donne les secondes, puis les minutes, puis les heures', () => {
    expect(ilYA(10_000)).toBe('il y a 10 s');
    expect(ilYA(59_000)).toBe('il y a 59 s');
    expect(ilYA(60_000)).toBe('il y a 1 min');
    expect(ilYA(59 * 60_000)).toBe('il y a 59 min');
    expect(ilYA(2 * 3_600_000 + 5 * 60_000)).toBe('il y a 2 h 05');
  });
});
