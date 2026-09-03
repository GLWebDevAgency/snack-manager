import { describe, expect, it } from 'vitest';
import {
  ORDERS_WINDOW_MAX,
  normalizeOrdersWindow,
  windowCountLabel,
} from './orders-window';

/**
 * LE PLAFOND DE 200 COMMANDES DOIT SE VOIR.
 *
 * Le serveur renvoie `total` et `truncated` « pour que l'écran refuse de
 * conclure plutôt que de conclure faux ». La caisse les ignorait : au-delà de
 * 200 commandes dans la journée, son Z était calculé sur une fenêtre amputée
 * de ses lignes les plus anciennes, en silence.
 */

interface Ligne {
  _id: string;
}

const lignes = (n: number): Ligne[] =>
  Array.from({ length: n }, (_, i) => ({ _id: `o${i}` }));

describe('la fenêtre de GET /orders', () => {
  it('garde le plafond du serveur comme constante partagée', () => {
    expect(ORDERS_WINDOW_MAX).toBe(200);
  });

  it('lit le total et la coupe annoncés par le serveur', () => {
    const w = normalizeOrdersWindow<Ligne>({
      rows: lignes(200),
      total: 253,
      truncated: true,
    });
    expect(w.rows).toHaveLength(200);
    expect(w.total).toBe(253);
    expect(w.truncated).toBe(true);
  });

  it('déduit la coupe du seul total quand le booléen manque', () => {
    // Déploiement roulant : une API intermédiaire peut servir `total` sans
    // encore servir `truncated`. Le total suffit à savoir qu'il manque des
    // lignes — l'écran ne doit pas conclure faux pendant une livraison.
    const w = normalizeOrdersWindow<Ligne>({ rows: lignes(200), total: 201 });
    expect(w.truncated).toBe(true);
  });

  it('ne crie pas à la coupe sur une journée normale', () => {
    const w = normalizeOrdersWindow<Ligne>({ rows: lignes(37), total: 37, truncated: false });
    expect(w.truncated).toBe(false);
    expect(w.total).toBe(37);
  });

  it('accepte l’ancien tableau nu sans rien casser', () => {
    const w = normalizeOrdersWindow<Ligne>(lignes(3));
    expect(w.rows).toHaveLength(3);
    expect(w.total).toBe(3);
    expect(w.truncated).toBe(false);
  });

  it('retombe sur une fenêtre vide plutôt que de jeter, si la réponse est illisible', () => {
    // Une réponse absente ou mal formée ne doit pas faire tomber un poste en
    // plein service : on rend une fenêtre vide, et l'appelant décide.
    expect(normalizeOrdersWindow<Ligne>(null)).toEqual({ rows: [], total: 0, truncated: false });
    expect(normalizeOrdersWindow<Ligne>({} as never)).toEqual({
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it('ignore un total incohérent, plus petit que ce qu’on tient déjà', () => {
    // Sinon l'écran annoncerait moins de commandes qu'il n'en affiche.
    const w = normalizeOrdersWindow<Ligne>({ rows: lignes(10), total: 4 });
    expect(w.total).toBe(10);
    expect(w.truncated).toBe(false);
  });
});

describe('le libellé d’un compteur calculé sur une fenêtre', () => {
  it('reste un chiffre quand rien n’est coupé', () => {
    expect(windowCountLabel(12, false)).toBe('12');
  });

  it('devient un minimum dès que la fenêtre est tronquée', () => {
    expect(windowCountLabel(200, true)).toBe('≥ 200');
  });
});
