import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoRequested } from './mode';
import { SmClient } from '../api';

/**
 * LE TEST QUI COMPTE.
 *
 * Ces applications tournent sur des tablettes en plein service. Une caisse qui
 * basculerait en démonstration par accident encaisserait dans le vide : le
 * ticket part vers une fixture, la cuisine ne voit rien, et personne ne s'en
 * aperçoit avant le premier client qui réclame sa commande.
 *
 * D'où la règle, épinglée ici sous toutes ses coutures : le mode démonstration
 * s'active par `?demo=1`, ET PAR RIEN D'AUTRE.
 */

const withLocation = (href: string) => {
  vi.stubGlobal('location', { href });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('bascule du mode démonstration', () => {
  it("s'active sur ?demo=1, seule forme reconnue", () => {
    expect(isDemoRequested('https://caisse.snackmanager.fr/?demo=1')).toBe(true);
    expect(isDemoRequested('https://caisse.snackmanager.fr/?api=http://x&demo=1')).toBe(true);
    expect(isDemoRequested('https://caisse.snackmanager.fr/?demo=1&tenant=x')).toBe(true);
  });

  it('reste inactif sans paramètre du tout', () => {
    expect(isDemoRequested('https://caisse.snackmanager.fr/')).toBe(false);
    expect(isDemoRequested('https://caisse.snackmanager.fr')).toBe(false);
  });

  it("n'accepte aucune valeur approchante", () => {
    // Chacune de ces URL a existé dans la vraie vie d'un projet : un « 0 »
    // laissé après un test, un « true » écrit d'instinct, un paramètre vide
    // produit par un formulaire. Aucune ne doit ouvrir une caisse fictive.
    for (const href of [
      'https://x/?demo=0',
      'https://x/?demo=',
      'https://x/?demo',
      'https://x/?demo=true',
      'https://x/?demo=oui',
      'https://x/?demo=2',
      'https://x/?demo=11',
      'https://x/?demo=1x',
    ]) {
      expect(isDemoRequested(href), href).toBe(false);
    }
  });

  it('ne se laisse pas déclencher par un paramètre qui lui ressemble', () => {
    for (const href of [
      'https://x/?nodemo=1',
      'https://x/?demo_mode=1',
      'https://x/?mode=demo=1',
      'https://x/?url=https%3A%2F%2Fy%2F%3Fdemo%3D1',
    ]) {
      expect(isDemoRequested(href), href).toBe(false);
    }
  });

  it("ignore ce qui est écrit après le dièse — un fragment n'est pas une requête", () => {
    expect(isDemoRequested('https://x/#/ecran?demo=1')).toBe(false);
    expect(isDemoRequested('https://x/?demo=1#/ecran')).toBe(true);
  });

  it("répond faux hors navigateur : une application native n'a pas d'URL", () => {
    // Aucune `location` (tablette Expo native) : il n'existe alors aucun moyen
    // de demander le mode, donc aucun moyen de l'obtenir.
    expect(isDemoRequested()).toBe(false);
    expect(isDemoRequested(null)).toBe(false);
  });

  it("ne s'active par AUCUNE variable d'environnement", () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SM_DEMO', '1');
    vi.stubEnv('EXPO_PUBLIC_DEMO', '1');
    vi.stubEnv('EXPO_PUBLIC_DEMO_MODE', 'true');
    withLocation('https://caisse.snackmanager.fr/');
    expect(isDemoRequested()).toBe(false);
  });

  it("lit l'URL du document quand on ne lui en passe pas", () => {
    withLocation('https://caisse.snackmanager.fr/?demo=1');
    expect(isDemoRequested()).toBe(true);
    withLocation('https://caisse.snackmanager.fr/');
    expect(isDemoRequested()).toBe(false);
  });
});

describe('le client par défaut parle au réseau, pas à une fixture', () => {
  it("n'utilise le transport de démonstration que si on le lui donne", async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ url }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    // Une URL de démonstration dans la barre d'adresse ne change RIEN au client :
    // la bascule est un choix explicite de l'application, pas une contagion.
    withLocation('https://caisse.snackmanager.fr/?demo=1');

    const client = new SmClient({ baseUrl: 'https://api.exemple.fr' });
    await client.get('/public/tenants/x/menu');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.exemple.fr/public/tenants/x/menu');
  });
});
