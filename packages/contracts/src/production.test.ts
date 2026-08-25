import { describe, expect, it } from 'vitest';
import { EMPTY_SERVICES } from './crm';
import {
  moisDuRapport,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  productionTasksFor,
  productionWeekLabel,
  productionWeekOf,
} from './production';

/**
 * La file de production dérive le dû du signé : ces tests verrouillent
 * l'arithmétique des semaines ISO (les pièges sont aux bords d'année) et la
 * dérivation des tâches — c'est elle qui refuse une coche sans promesse.
 */

describe('les semaines ISO', () => {
  it('un mercredi ordinaire : lundi → dimanche, clef zéro-padded', () => {
    // Le 26 août 2026 est un mercredi.
    expect(productionWeekOf('2026-08-26')).toEqual({
      key: '2026-W35',
      monday: '2026-08-24',
      sunday: '2026-08-30',
    });
    // Dimanche appartient à la MÊME semaine — pas à la suivante.
    expect(productionWeekOf('2026-08-30').key).toBe('2026-W35');
  });

  it('bord d’année : un 1er janvier tombé vendredi appartient à la W53 d’avant', () => {
    // 2026 commence un jeudi : 53 semaines ISO ; le 1er janvier 2027 (vendredi)
    // reste dans la W53 de 2026 — l'année ISO est celle du jeudi.
    expect(productionWeekOf('2026-01-01').key).toBe('2026-W01');
    expect(productionWeekOf('2027-01-01').key).toBe('2026-W53');
    expect(productionWeekOf('2027-01-04').key).toBe('2027-W01');
  });

  it('relit ses propres clefs, et refuse celles qui n’existent pas', () => {
    const w = productionWeekOf('2026-08-26');
    expect(parseWeekKey('2026-W35')).toEqual(w);
    expect(parseWeekKey('2026-W54')).toBeNull();
    // 2025 n'a que 52 semaines : sa « W53 » se reconstruit ailleurs — refusée.
    expect(parseWeekKey('2025-W53')).toBeNull();
    expect(parseWeekKey('2026-35')).toBeNull();
  });

  it('navigue d’une semaine à l’autre, y compris à cheval sur deux années', () => {
    const w35 = productionWeekOf('2026-08-26');
    expect(previousWeekKey(w35)).toBe('2026-W34');
    expect(nextWeekKey(w35)).toBe('2026-W36');
    const w53 = productionWeekOf('2026-12-30');
    expect(w53.key).toBe('2026-W53');
    expect(nextWeekKey(w53)).toBe('2027-W01');
  });

  it('le libellé sort le mois du lundi seulement quand il diffère', () => {
    expect(productionWeekLabel(productionWeekOf('2026-08-26'))).toBe('du 24 au 30 août');
    // La semaine du 31 août au 6 septembre chevauche deux mois.
    expect(productionWeekLabel(productionWeekOf('2026-09-02'))).toBe(
      'du 31 août au 6 septembre',
    );
    // Le 1er novembre 2026 est un dimanche : « 1er », jamais « 1 ».
    expect(productionWeekLabel(productionWeekOf('2026-10-27'))).toBe(
      'du 26 octobre au 1er novembre',
    );
  });
});

describe('le rapport mensuel', () => {
  it('se doit la semaine qui contient un 1er du mois — pour le mois clos', () => {
    // Le 1er septembre 2026 (mardi) tombe dans la semaine du 31 août.
    expect(moisDuRapport(productionWeekOf('2026-09-02'))).toBe('août');
    expect(moisDuRapport(productionWeekOf('2026-08-26'))).toBeNull();
    // Bord d'année : le 1er janvier clôt décembre.
    expect(moisDuRapport(productionWeekOf('2027-01-01'))).toBe('décembre');
  });
});

describe('les tâches dérivées du signé', () => {
  const semaineOrdinaire = productionWeekOf('2026-08-26');
  const semaineDeRapport = productionWeekOf('2026-09-02');

  it('hebdo : une publication ; bihebdo : deux, distinctes', () => {
    expect(
      productionTasksFor({ ...EMPTY_SERVICES, reseauxSociaux: 'hebdo' }, semaineOrdinaire).map(
        (t) => t.key,
      ),
    ).toEqual(['social_pub_1']);
    expect(
      productionTasksFor({ ...EMPTY_SERVICES, reseauxSociaux: 'bihebdo' }, semaineOrdinaire).map(
        (t) => t.key,
      ),
    ).toEqual(['social_pub_1', 'social_pub_2']);
  });

  it('présence internet : les avis chaque semaine, le rapport sa semaine seulement', () => {
    expect(
      productionTasksFor({ ...EMPTY_SERVICES, presenceInternet: true }, semaineOrdinaire).map(
        (t) => t.key,
      ),
    ).toEqual(['presence_avis']);
    const rapport = productionTasksFor(
      { ...EMPTY_SERVICES, presenceInternet: true },
      semaineDeRapport,
    );
    expect(rapport.map((t) => t.key)).toEqual(['presence_avis', 'presence_rapport']);
    expect(rapport[1]?.label).toContain('août');
  });

  it('rien de récurrent signé : aucune tâche — les ponctuels restent hors file', () => {
    const queDesPonctuels = { ...EMPTY_SERVICES, siteVitrine: true };
    expect(productionTasksFor(queDesPonctuels, semaineOrdinaire)).toEqual([]);
  });
});
