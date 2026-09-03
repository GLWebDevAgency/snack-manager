import { Logger } from '@nestjs/common';
import { DIRECTIONS } from '@sm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FENETRE_ALERTE_MASQUE_MS,
  lireMarqueObservee,
  marqueObservee,
  oublierAlertesMasque,
} from './marque-observee';

/**
 * LE REPLI « INVALIDE » NE DOIT PLUS ÊTRE MUET — NI BAVARD.
 *
 * Deux exigences opposées tiennent ce fichier. Un masque corrompu doit se
 * SIGNALER : sans ça, un restaurant s'affiche en Nuit sur toutes ses surfaces
 * clientes, sur un 200, et personne ne le sait. Et il ne doit se signaler
 * QU'UNE FOIS par fenêtre : ces lectures vivent sur la page de commande et le
 * tableau de menu d'un restaurant, une ligne par requête serait un défaut de
 * plus.
 */

/** Un masque que `BrandSchema` refuse : `mode` n'est ni `light` ni `dark`. */
const CASSE = { ...DIRECTIONS.soleil, mode: 'crepuscule' };

let avertissements: string[];

beforeEach(() => {
  oublierAlertesMasque();
  avertissements = [];
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
    avertissements.push(String(message));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  oublierAlertesMasque();
});

describe('la lecture du masque, côté API', () => {
  it('rend le masque stocké et ne dit rien quand il est valide', () => {
    const lu = lireMarqueObservee({ slug: 'chez-lima', brand: DIRECTIONS.soleil });
    expect(lu.brand).toEqual(DIRECTIONS.soleil);
    expect(lu.repli).toBeNull();
    expect(avertissements).toEqual([]);
  });

  it('ne dit rien d’un tenant PAS ENCORE REPRIS — c’est l’état normal, pas un incident', () => {
    // Un parc entier d'avant `backfill:brand` remplirait le journal de lignes
    // qui n'appellent aucune action.
    const lu = lireMarqueObservee({ slug: 'chez-lima', brand: null, brandColor: '#2e9e4f' });
    expect(lu.repli).toBe('absent');
    expect(lu.brand.preset).toBe('nuit');
    expect(avertissements).toEqual([]);
  });

  it('avertit quand le masque stocké est ILLISIBLE, en nommant l’établissement', () => {
    const lu = lireMarqueObservee({ slug: 'chez-lima', brand: CASSE, brandColor: '#2e9e4f' });
    expect(lu.repli).toBe('invalide');
    // Le repli est servi quand même : la page ne casse pas, elle se signale.
    expect(lu.brand.preset).toBe('nuit');
    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]).toContain('chez-lima');
    // La phrase dit quoi faire, pas seulement que ça va mal.
    expect(avertissements[0]).toMatch(/backfill:brand/);
  });

  it('se rabat sur l’identifiant quand le dépôt n’a pas projeté le slug', () => {
    lireMarqueObservee({ _id: '665f0d0a1c2b3d4e5f6a7b99', brand: CASSE });
    expect(avertissements[0]).toContain('665f0d0a1c2b3d4e5f6a7b99');
  });

  it('ne répète pas dans la fenêtre — une page publique très visitée noierait le journal', () => {
    const t = { slug: 'chez-lima', brand: CASSE };
    const t0 = 1_000_000;
    marqueObservee(t, t0);
    marqueObservee(t, t0 + 1);
    marqueObservee(t, t0 + FENETRE_ALERTE_MASQUE_MS - 1);
    expect(avertissements).toHaveLength(1);
  });

  it('resignale une fois la fenêtre passée — l’état dure, il doit rester visible', () => {
    const t = { slug: 'chez-lima', brand: CASSE };
    const t0 = 1_000_000;
    marqueObservee(t, t0);
    marqueObservee(t, t0 + FENETRE_ALERTE_MASQUE_MS);
    expect(avertissements).toHaveLength(2);
  });

  it('compte par ÉTABLISSEMENT — le silence de l’un ne couvre pas l’autre', () => {
    const t0 = 1_000_000;
    marqueObservee({ slug: 'chez-lima', brand: CASSE }, t0);
    marqueObservee({ slug: 'le-voisin', brand: CASSE }, t0);
    expect(avertissements).toHaveLength(2);
    expect(avertissements[1]).toContain('le-voisin');
  });

  it('rend exactement le masque de `lireMarque` — l’adaptateur observe, il ne décide pas', () => {
    const t = { slug: 'chez-lima', brand: CASSE, brandColor: '#2e9e4f', logoUrl: null };
    expect(marqueObservee(t)).toEqual(lireMarqueObservee(t).brand);
  });
});
