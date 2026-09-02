import { describe, expect, it } from 'vitest';
import { HEURE_MURALE, TenantHoursUpdateSchema } from './tenant';

/**
 * LES HORAIRES SONT VALIDÉS, PAS SEULEMENT ÉCRITS.
 *
 * `PATCH /tenants/me/hours` était la dernière route d'écriture du contrôleur à
 * prendre un corps NU. Ces deux tableaux repartent vers le PUBLIC — fiche du
 * restaurant, vitrine, tableau de menu, calcul des créneaux de retrait — donc
 * un corps mal formé ne cassait pas un écran d'administration : il cassait la
 * commande en ligne de tous les clients d'un restaurant.
 *
 * Chaque borne ci-dessous répare un dégât PRÉCIS, et aucune n'est décorative.
 */

/** La forme que le back-office envoie vraiment : sept jours, midi et soir. */
const semaine = (
  ...jours: { day: number; lunch?: unknown; dinner?: unknown }[]
): Record<string, unknown> => ({
  hours: jours.map((j) => ({ day: j.day, lunch: j.lunch ?? null, dinner: j.dinner ?? null })),
});

const passe = (corps: Record<string, unknown>) =>
  TenantHoursUpdateSchema.safeParse(corps).success;

const MIDI = { open: '11:30', close: '14:30' };

describe('les horaires hebdomadaires', () => {
  it('accepte la semaine telle que l’écran l’envoie — sept jours, services ou null', () => {
    const corps = semaine(
      { day: 1, dinner: { open: '18:00', close: '22:30' } },
      { day: 2, lunch: MIDI, dinner: { open: '18:00', close: '22:30' } },
      { day: 3 },
      { day: 4 },
      { day: 5 },
      { day: 6 },
      { day: 7 },
    );
    const lu = TenantHoursUpdateSchema.parse(corps);
    expect(lu.hours).toHaveLength(7);
    expect(lu.hours[0]?.lunch).toBeNull();
    expect(lu.hours[1]?.lunch).toEqual(MIDI);
    // `closures` absent reste absent : l'écran des horaires n'y touche pas, et
    // le service ne doit rien poser dans le `$set`.
    expect('closures' in lu).toBe(false);
  });

  it('refuse une heure qui n’existe pas — « 25:99 » passait jusqu’en base', () => {
    expect(passe(semaine({ day: 1, lunch: { open: '25:99', close: '26:00' } }))).toBe(false);
    expect(passe(semaine({ day: 1, lunch: { open: '9:30', close: '14:00' } }))).toBe(false);
    expect(passe(semaine({ day: 1, lunch: { open: '11:30', close: '14:30' } }))).toBe(true);
  });

  it('refuse un créneau à moitié saisi — la fenêtre partait « close: undefined »', () => {
    expect(passe(semaine({ day: 1, lunch: { open: '11:30' } }))).toBe(false);
  });

  it('refuse une fermeture qui précède l’ouverture — le calcul des créneaux l’ignorerait en silence', () => {
    // `windowsFor` fait `continue` sur `closeMin < openMin` : le service était
    // accepté, stocké, affiché sur la vitrine, et ne proposait aucun créneau.
    expect(passe(semaine({ day: 5, dinner: { open: '18:00', close: '02:00' } }))).toBe(false);
    expect(passe(semaine({ day: 5, dinner: { open: '18:00', close: '18:00' } }))).toBe(false);
  });

  it('refuse un jour hors de la semaine ISO', () => {
    expect(passe(semaine({ day: 0 }))).toBe(false);
    expect(passe(semaine({ day: 8 }))).toBe(false);
    expect(passe(semaine({ day: 1.5 }))).toBe(false);
  });

  it('refuse deux entrées pour le même jour — seule la première serait lue', () => {
    expect(passe(semaine({ day: 2, lunch: MIDI }, { day: 2 }))).toBe(false);
  });

  it('refuse plus de sept jours', () => {
    expect(passe(semaine(...[1, 2, 3, 4, 5, 6, 7, 1].map((day) => ({ day }))))).toBe(false);
  });

  it('refuse une clé inattendue, à chaque étage — un corps de requête n’est pas un bac à sable', () => {
    expect(TenantHoursUpdateSchema.safeParse({ hours: [], role: 'sm_admin' }).success).toBe(false);
    expect(passe({ hours: [{ day: 1, lunch: null, dinner: null, brunch: MIDI }] })).toBe(false);
    expect(
      passe(semaine({ day: 1, lunch: { ...MIDI, capacite: 999 } })),
    ).toBe(false);
  });

  it('exige les horaires : un PATCH sans eux effacerait la semaine par un `undefined`', () => {
    expect(TenantHoursUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('les fermetures exceptionnelles', () => {
  const avec = (...closures: unknown[]) => ({ hours: [], closures });

  it('accepte les DEUX formes que l’écran renvoie — sa saisie et ce qu’il vient de relire', () => {
    // Le champ date pose « 2026-08-14 » ; l'API rend ensuite l'instant ISO de
    // la base. L'écran renvoie la liste ENTIÈRE à chaque ajout, donc les deux
    // formes voyagent dans le même corps.
    expect(
      passe(
        avec(
          { from: '2026-08-14', to: '2026-08-16', reason: 'Congés d’été' },
          { from: '2026-07-14T00:00:00.000Z', to: '2026-07-14T23:59:59.000Z', reason: 'Fête nationale' },
          { from: '2026-05-01T00:00:00+02:00' },
        ),
      ),
    ).toBe(true);
  });

  it('refuse une date-heure sans fuseau — elle ne désigne pas le même instant selon la machine', () => {
    expect(passe(avec({ from: '2026-08-14T00:00' }))).toBe(false);
    expect(passe(avec({ from: '14/08/2026' }))).toBe(false);
    expect(passe(avec({ from: '2026-13-40' }))).toBe(false);
  });

  it('exige une date de début — sans elle, la fermeture est ignorée sans un mot', () => {
    // `closureRanges` fait `continue` sur un `from` illisible : la ligne
    // s'affichait dans le back-office et ne fermait rien.
    expect(passe(avec({ to: '2026-08-16', reason: 'Congés' }))).toBe(false);
  });

  it('tolère une fermeture d’avant l’écran actuel — sans fin, sans motif', () => {
    // Les refuser rendrait impossible l'AJOUT d'une fermeture à un restaurant
    // qui en porte une ancienne : l'écran renvoie la liste entière.
    expect(passe(avec({ from: '2026-08-14' }))).toBe(true);
    expect(passe(avec({ from: '2026-08-14', to: null, reason: null }))).toBe(true);
  });

  it('refuse une fin antérieure au début', () => {
    expect(passe(avec({ from: '2026-08-16', to: '2026-08-14' }))).toBe(false);
    // Même jour : une fermeture d'une seule journée, c'est le cas normal.
    expect(passe(avec({ from: '2026-08-16', to: '2026-08-16' }))).toBe(true);
  });

  it('borne le motif — il s’affiche sur la page de commande de tous les clients', () => {
    // `closureReason` part dans `SlotsResponse` : sans borne, un motif sans
    // longueur partait sur la page publique.
    expect(passe(avec({ from: '2026-08-14', reason: 'x'.repeat(200) }))).toBe(true);
    expect(passe(avec({ from: '2026-08-14', reason: 'x'.repeat(201) }))).toBe(false);
  });

  it('refuse une liste anormale — elle est relue à chaque calcul de créneau', () => {
    const une = { from: '2026-08-14', to: '2026-08-14', reason: 'Congé' };
    expect(passe(avec(...Array.from({ length: 200 }, () => une)))).toBe(true);
    expect(passe(avec(...Array.from({ length: 201 }, () => une)))).toBe(false);
  });
});

describe('le motif d’heure murale, exporté pour la base', () => {
  it('dit la même chose que le schéma — la base est aussi écrite hors de zod', () => {
    for (const bonne of ['00:00', '09:05', '11:30', '23:59']) {
      expect(HEURE_MURALE.test(bonne), bonne).toBe(true);
    }
    for (const mauvaise of ['24:00', '9:30', '11:60', '11h30', '', '11:30:00']) {
      expect(HEURE_MURALE.test(mauvaise), mauvaise).toBe(false);
    }
  });
});
