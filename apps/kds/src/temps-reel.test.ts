import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  creerDebounce,
  EVENT_DEBOUNCE_MAX_MS,
  EVENT_DEBOUNCE_MS,
  POLL_MS,
  POLL_SOCKET_MS,
  pollCadenceMs,
} from './temps-reel';

/**
 * LA CUISINE NE DOIT JAMAIS ÊTRE MOINS FIABLE QU'AVANT.
 *
 * La socket temps réel est un accélérateur, pas un remplaçant : ces tests
 * épinglent le contrat de repli. Socket absente, coupée ou silencieusement
 * morte → sondage à 5 s, la cadence historique, À L'IDENTIQUE. Socket
 * connectée → 60 s de filet, et chaque événement `order.*` rafraîchit dans la
 * seconde, rafales absorbées.
 */

describe('le choix de la cadence de sondage', () => {
  it('retombe sur les 5 s historiques dès que la socket n’est pas connectée', () => {
    // La valeur littérale est le contrat : si quelqu'un « optimise » le
    // secours à 30 s, ce test doit le forcer à venir lire pourquoi.
    expect(POLL_MS).toBe(5000);
    expect(pollCadenceMs(false)).toBe(5000);
  });

  it('étire le sondage à 60 s quand la socket est connectée', () => {
    expect(POLL_SOCKET_MS).toBe(60_000);
    expect(pollCadenceMs(true)).toBe(60_000);
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
    // — précisément pendant le coup de feu où la cuisine en a le plus besoin.
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
