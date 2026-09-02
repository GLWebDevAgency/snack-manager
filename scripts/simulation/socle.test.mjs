import { describe, expect, it, beforeEach } from 'vitest';
import { resoudreCible } from './socle.mjs';

/**
 * LE GARDE-FOU QUI EMPÊCHE DE JOUER SUR LA PRODUCTION.
 *
 * La simulation crée de vraies commandes, de vrais paiements et de vraies
 * lignes de statistiques. Le refus vivait dans le socle — bien — mais ne
 * portait que sur le NOM de la cible, alors que `SM_URL_API` écrase l'adresse
 * APRÈS ce contrôle. Lancer la simulation avec l'URL de production et le nom
 * « staging » visait donc la production sans rien déclencher.
 *
 * Et il n'était couvert par aucun test : un garde-fou qu'on ne vérifie pas est
 * un garde-fou qu'on rouvre au premier remaniement, sans s'en apercevoir.
 */

const VARIABLES = ['SM_URL_API', 'SM_URL_WEB', 'SM_SIMULATION_PRODUCTION'];
const PROD_API = 'https://api-production-8949.up.railway.app';
const AVEU = 'oui-je-sais-ce-que-je-fais';

beforeEach(() => {
  for (const v of VARIABLES) delete process.env[v];
});

describe('le refus de la production', () => {
  it('laisse passer staging', () => {
    expect(resoudreCible('staging').nom).toBe('staging');
  });

  it('refuse la production nommée', () => {
    expect(() => resoudreCible('production')).toThrow(/refuse de viser la production/);
  });

  it('accepte la production quand elle est ASSUMÉE, et seulement alors', () => {
    process.env.SM_SIMULATION_PRODUCTION = AVEU;
    expect(resoudreCible('production').nom).toBe('production');
    process.env.SM_SIMULATION_PRODUCTION = 'oui';
    expect(() => resoudreCible('production')).toThrow(/refuse de viser la production/);
  });

  /**
   * LE TROU QUE CE FICHIER EXISTE POUR FERMER.
   *
   * L'adresse est surchargeable et le contrôle portait sur le nom : les deux
   * ensemble laissaient viser la production en toute bonne foi.
   */
  it('refuse l’adresse de production même sous le nom « staging »', () => {
    process.env.SM_URL_API = PROD_API;
    expect(() => resoudreCible('staging')).toThrow(/refuse de viser la production/);
  });

  it('refuse aussi par l’adresse WEB, pas seulement l’API', () => {
    process.env.SM_URL_WEB = 'https://app.snackmanager.fr/admin';
    expect(() => resoudreCible('staging')).toThrow(/refuse de viser la production/);
  });

  it('le message dit que le NOM n’y change rien — sinon on cherche au mauvais endroit', () => {
    process.env.SM_URL_API = PROD_API;
    expect(() => resoudreCible('staging')).toThrow(/c’est l’adresse réellement appelée qui décide/);
  });

  it('laisse passer une API locale — c’est à ça que sert la surcharge', () => {
    process.env.SM_URL_API = 'http://localhost:3001';
    expect(resoudreCible('staging').api).toBe('http://localhost:3001');
  });

  it('refuse une adresse illisible plutôt que de la laisser passer', () => {
    // Ne pas savoir lire une adresse n'est pas une raison de la croire sûre.
    process.env.SM_URL_API = 'pas-une-url';
    expect(() => resoudreCible('staging')).toThrow(/illisible/);
  });

  it('refuse un environnement inconnu', () => {
    expect(() => resoudreCible('preprod')).toThrow(/inconnu/);
  });
});
