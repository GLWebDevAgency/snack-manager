import { describe, expect, it } from 'vitest';
import {
  classerUrlsMongo,
  construireUrlProxy,
  extraireNomsServices,
  grefferCheminBase,
  grefferRequete,
  masquerUrl,
  trouverProxyTcp,
} from './railway';

/**
 * Les URL d'exemple portent les identifiants-GABARITS (`default:password@`,
 * masque `***`) : la règle « uri-connexion-avec-identifiants » du garde-fou
 * secrets (.github/gitleaks.toml) s'applique volontairement aux fichiers de
 * test, et seules ces formes-là sont reconnues comme « pas une valeur
 * réelle ». Un pseudo-secret inventé ici serait signalé — et il aurait
 * raison de l'être.
 */

describe('extraireNomsServices', () => {
  it('lit la forme en tableau plat', () => {
    expect(extraireNomsServices({ services: [{ name: 'api' }, { name: 'MongoDB' }] })).toEqual([
      'api',
      'MongoDB',
    ]);
  });

  it('lit la forme en edges façon GraphQL', () => {
    expect(
      extraireNomsServices({ services: { edges: [{ node: { name: 'web' } }, { node: { name: 'mongo' } }] } }),
    ).toEqual(['web', 'mongo']);
  });

  it('ramasse les name en profondeur, dédoublonnés — un vrai service ne doit jamais manquer', () => {
    expect(
      extraireNomsServices({
        project: { name: 'snack-manager' },
        environments: [{ name: 'production', serviceInstances: [{ service: { name: 'Mongo' } }] }],
        services: [{ name: 'Mongo' }],
      }),
    ).toEqual(['snack-manager', 'production', 'Mongo']);
  });

  it('rend une liste vide sur un JSON inattendu, sans lever', () => {
    expect(extraireNomsServices(null)).toEqual([]);
    expect(extraireNomsServices({ projet: 'sm' })).toEqual([]);
    expect(extraireNomsServices({ services: [{ id: 42 }] })).toEqual([]);
  });
});

describe('classerUrlsMongo', () => {
  const interne = 'mongodb://mongo.railway.internal:27017';
  const publique = 'mongodb://default:password@tramway.proxy.rlwy.net:33017';

  it('sépare l’URL publique de l’interne, quel que soit le service porteur', () => {
    const resultat = classerUrlsMongo({
      api: { MONGO_URL: interne, PORT: '8080' },
      MongoDB: { MONGO_PUBLIC_URL: publique, MONGOHOST: 'mongo.railway.internal' },
    });
    expect(resultat).toEqual({ publique, interne });
  });

  it('préfère l’URL dont le NOM dit PUBLIC quand plusieurs sont joignables', () => {
    const autre = 'mongodb://default:password@autre.hote.net:27017';
    const resultat = classerUrlsMongo({
      MongoDB: { MONGO_URL_MIROIR: autre, MONGO_PUBLIC_URL: publique },
    });
    expect(resultat.publique).toBe(publique);
  });

  it('ne prend jamais une valeur qui n’est pas une URL Mongo', () => {
    const resultat = classerUrlsMongo({
      api: { REDIS_URL: 'redis://default:password@host:6379', SM_REVISION: 'abc' },
    });
    expect(resultat).toEqual({ publique: undefined, interne: undefined });
  });

  it('entre deux internes, garde celle qui porte le chemin de base — celle de l’API', () => {
    const sansChemin = 'mongodb://user:password@mongo.railway.internal:27017';
    const avecChemin = 'mongodb://user:password@mongo.railway.internal:27017/snack?authSource=admin';
    expect(classerUrlsMongo({ Mongo: { MONGO_URL: sansChemin }, api: { MONGO_URL: avecChemin } }).interne).toBe(avecChemin);
    expect(classerUrlsMongo({ api: { MONGO_URL: avecChemin }, Mongo: { MONGO_URL: sansChemin } }).interne).toBe(avecChemin);
  });
});

describe('trouverProxyTcp', () => {
  const interne = 'mongodb://user:password@mongo.railway.internal:27017';

  it('trouve le service qui porte À LA FOIS le proxy TCP et une URL Mongo interne', () => {
    expect(
      trouverProxyTcp({
        api: { MONGO_URL: interne },
        Mongo: {
          MONGO_URL: interne,
          RAILWAY_TCP_PROXY_DOMAIN: 'tramway.proxy.rlwy.net',
          RAILWAY_TCP_PROXY_PORT: '16828',
        },
      }),
    ).toEqual({ interne, domaine: 'tramway.proxy.rlwy.net', port: '16828', service: 'Mongo' });
  });

  it('ignore un proxy TCP qui ne dessert pas Mongo (Postgres, Redis…)', () => {
    expect(
      trouverProxyTcp({
        Postgres: {
          DATABASE_URL: 'postgresql://user:password@pg.railway.internal:5432/sm',
          RAILWAY_TCP_PROXY_DOMAIN: 'tramway.proxy.rlwy.net',
          RAILWAY_TCP_PROXY_PORT: '5000',
        },
      }),
    ).toBeUndefined();
  });
});

describe('construireUrlProxy', () => {
  it('remplace l’hôte interne par le proxy, en gardant identifiants, chemin et requête', () => {
    expect(
      construireUrlProxy(
        'mongodb://user:password@mongo.railway.internal:27017/snack?authSource=admin',
        'tramway.proxy.rlwy.net',
        '16828',
      ),
    ).toBe('mongodb://user:password@tramway.proxy.rlwy.net:16828/snack?authSource=admin');
  });

  it('fonctionne aussi sans identifiants ni chemin', () => {
    expect(construireUrlProxy('mongodb://mongo.railway.internal:27017', 'hote.net', '1234')).toBe(
      'mongodb://hote.net:1234',
    );
  });
});

describe('grefferRequete', () => {
  const publique = 'mongodb://default:password@tramway.proxy.rlwy.net:33017/snack';

  it('greffe la requête de l’interne — authSource=admin en tête — quand la publique n’en a pas', () => {
    expect(
      grefferRequete(publique, 'mongodb://user:password@mongo.railway.internal:27017/snack?authSource=admin'),
    ).toBe(`${publique}?authSource=admin`);
  });

  it('respecte une requête déjà présente, et une interne muette ne change rien', () => {
    expect(grefferRequete(`${publique}?w=majority`, 'mongodb://mongo.railway.internal:27017?authSource=admin')).toBe(
      `${publique}?w=majority`,
    );
    expect(grefferRequete(publique, 'mongodb://mongo.railway.internal:27017/snack')).toBe(publique);
    expect(grefferRequete(publique)).toBe(publique);
  });
});

describe('grefferCheminBase', () => {
  const publique = 'mongodb://default:password@tramway.proxy.rlwy.net:33017';

  it('greffe le chemin de base de l’interne quand la publique n’en a pas', () => {
    expect(grefferCheminBase(publique, 'mongodb://mongo.railway.internal:27017/snack')).toBe(
      `${publique}/snack`,
    );
  });

  it('greffe AVANT la chaîne de requête, jamais après', () => {
    expect(
      grefferCheminBase(`${publique}?authSource=admin`, 'mongodb://mongo.railway.internal:27017/snack'),
    ).toBe(`${publique}/snack?authSource=admin`);
  });

  it('respecte un chemin déjà présent sur la publique', () => {
    expect(grefferCheminBase(`${publique}/deja`, 'mongodb://mongo.railway.internal:27017/snack')).toBe(
      `${publique}/deja`,
    );
  });

  it('ne double jamais la barre oblique d’une publique qui finit par /', () => {
    expect(grefferCheminBase(`${publique}/`, 'mongodb://mongo.railway.internal:27017/snack')).toBe(
      `${publique}/snack`,
    );
  });

  it('rend la publique telle quelle sans interne ou sans base interne', () => {
    expect(grefferCheminBase(publique)).toBe(publique);
    expect(grefferCheminBase(publique, 'mongodb://mongo.railway.internal:27017')).toBe(publique);
  });
});

describe('masquerUrl', () => {
  it('cache le mot de passe, garde l’utilisateur, l’hôte et la base', () => {
    expect(masquerUrl('mongodb://default:password@hote.net:33017/snack')).toBe(
      'mongodb://default:***@hote.net:33017/snack',
    );
  });

  it('cache aussi sur mongodb+srv', () => {
    expect(masquerUrl('mongodb+srv://user:password@grappe.mongodb.net/sm')).toBe(
      'mongodb+srv://user:***@grappe.mongodb.net/sm',
    );
  });

  it('laisse intacte une URL sans identifiants', () => {
    expect(masquerUrl('mongodb://hote.net:27017/sm')).toBe('mongodb://hote.net:27017/sm');
  });
});
