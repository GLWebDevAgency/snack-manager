import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { BackupController } from './backup.controller';

/**
 * L'export en flux doit rendre EXACTEMENT le format d'avant (sm-sauvegarde-v1,
 * EJSON canonique) sans jamais matérialiser la base : ces tests relisent le
 * flux entier et le parsent — si un morceau de JSON se referme mal (panne
 * Postgres à mi-chemin comprise), c'est ici que ça casse, pas à 03:17.
 */

const JETON = 'jeton-de-sauvegarde-assez-long';

function requete(authorization?: string): Request {
  return { headers: { authorization } } as Request;
}

function construire(over: { pgEnPanne?: boolean; pgPanneApresUneTable?: boolean } = {}) {
  const quand = new Date('2026-08-24T03:17:00.000Z');
  const documents = [
    { _id: new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b8c'), restaurantName: 'Atlas Kebab', createdAt: quand },
    { _id: new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b8d'), restaurantName: 'La Bonne Broche', createdAt: quand },
  ];
  const collection = (docs: unknown[]) => ({
    find: () => ({
      // Le contrôleur itère un CURSEUR — la doublure rend l'itérable, pas un
      // tableau : c'est le contrat même de la correction.
      async *[Symbol.asyncIterator]() {
        for (const d of docs) yield d;
      },
    }),
  });
  const db = {
    listCollections: () => ({
      toArray: () =>
        Promise.resolve([{ name: 'leads' }, { name: 'system.views' }, { name: 'users' }]),
    }),
    collection: (name: string) => collection(name === 'leads' ? documents : []),
  };
  const mongo = { db } as unknown as Connection;

  let appels = 0;
  const pool = {
    query: vi.fn().mockImplementation((sql: string) => {
      appels += 1;
      if (over.pgEnPanne) return Promise.reject(new Error('ECONNREFUSED'));
      if (sql.includes('information_schema')) {
        return Promise.resolve({ rows: [{ table_name: 'suppliers' }, { table_name: 'recipes' }] });
      }
      if (over.pgPanneApresUneTable && appels > 2) {
        return Promise.reject(new Error('la panne de mi-chemin'));
      }
      return Promise.resolve({ rows: [{ id: 1, name: 'Métro' }] });
    }),
  } as unknown as Pool;

  const config = {
    get: (cle: string) => (cle === 'SM_BACKUP_TOKEN' ? JETON : cle === 'SM_REVISION' ? 'abc123' : undefined),
  } as unknown as ConfigService;

  return new BackupController(mongo, pool, config);
}

async function lireFluxEntier(controller: BackupController, auth = `Bearer ${JETON}`): Promise<string> {
  const fichier = controller.export(requete(auth));
  let corps = '';
  for await (const morceau of fichier.getStream()) corps += String(morceau);
  return corps;
}

describe('export de sauvegarde en flux', () => {
  it('rend le format sm-sauvegarde-v1 inchangé, EJSON canonique compris', async () => {
    const corps = await lireFluxEntier(construire());
    const d = JSON.parse(corps);
    expect(d.format).toBe('sm-sauvegarde-v1');
    expect(d.revision).toBe('abc123');
    expect(d.partial).toBe(false);
    // Les collections système ne partent jamais ; les vides restent des tableaux.
    expect(Object.keys(d.mongo)).toEqual(['leads', 'users']);
    expect(d.mongo.users).toEqual([]);
    expect(d.mongo.leads).toHaveLength(2);
    // EJSON canonique : l'ObjectId et la date SURVIVENT au voyage — c'est ce
    // qui rend le dump restaurable, et c'était le contrat de l'ancien export.
    expect(d.mongo.leads[0]._id).toEqual({ $oid: '665f0d0a1c2b3d4e5f6a7b8c' });
    expect(d.mongo.leads[0].createdAt).toEqual({
      $date: { $numberLong: String(new Date('2026-08-24T03:17:00.000Z').getTime()) },
    });
    expect(d.postgres.suppliers).toEqual([{ id: 1, name: 'Métro' }]);
    expect(d.postgres.recipes).toEqual([{ id: 1, name: 'Métro' }]);
  });

  it('PostgreSQL en panne : le JSON reste valide, partial le dit, l’erreur est portée', async () => {
    const d = JSON.parse(await lireFluxEntier(construire({ pgEnPanne: true })));
    expect(d.partial).toBe(true);
    expect(d.postgres.__erreur).toContain('ECONNREFUSED');
    expect(d.mongo.leads).toHaveLength(2);
  });

  it('panne APRÈS une première table : la virgule de l’entrée d’erreur ne manque pas', async () => {
    const d = JSON.parse(await lireFluxEntier(construire({ pgPanneApresUneTable: true })));
    expect(d.partial).toBe(true);
    expect(d.postgres.suppliers).toEqual([{ id: 1, name: 'Métro' }]);
    expect(d.postgres.__erreur).toContain('mi-chemin');
  });

  it('un seul export à la fois : le second appel reçoit un 409, le verrou se relâche à la fin', async () => {
    const controller = construire();
    const fichier = controller.export(requete(`Bearer ${JETON}`));
    // Pendant que le premier flux n'est pas consommé, la porte est fermée.
    expect(() => controller.export(requete(`Bearer ${JETON}`))).toThrow(ConflictException);
    let corps = '';
    for await (const morceau of fichier.getStream()) corps += String(morceau);
    expect(JSON.parse(corps).format).toBe('sm-sauvegarde-v1');
    // Flux terminé : la porte rouvre.
    await lireFluxEntier(controller);
  });

  it('jeton absent ou faux : le même 404 muet qu’avant', () => {
    const controller = construire();
    expect(() => controller.export(requete(undefined))).toThrow(NotFoundException);
    expect(() => controller.export(requete('Bearer faux-jeton-quand-meme-long'))).toThrow(
      NotFoundException,
    );
  });
});
