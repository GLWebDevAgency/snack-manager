import { PLANNING_REMINDERS_DISCLAIMER } from '@sm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildReminders,
  buildWeek,
  costCentsFor,
  serviceOf,
  shiftMinutes,
  shiftsOverlap,
  type PlannedShiftRow,
  type StaffRow,
} from './planning.compute';

const LUNDI = { y: 2026, m: 8, d: 17 }; // lundi 17 août 2026
const DIMANCHE = { y: 2026, m: 8, d: 23 };

const shift = (over: Partial<PlannedShiftRow> & Pick<PlannedShiftRow, 'id' | 'staffId' | 'date'>): PlannedShiftRow => ({
  start: '11:00',
  end: '15:00',
  position: 'polyvalent',
  note: '',
  status: 'brouillon',
  ...over,
});

const ALI: StaffRow = { id: 'ali', name: 'Ali', role: 'cuisine', hourlyCostCents: 1_500 };
const SARA: StaffRow = { id: 'sara', name: 'Sara', role: 'caisse', hourlyCostCents: 1_200 };
/** L'extra du samedi, embauché mais pas encore tarifé. */
const EXTRA: StaffRow = { id: 'extra', name: 'Yanis', role: 'caisse', hourlyCostCents: null };

describe('Durée d’un service prévu', () => {
  it('compte les minutes réelles, y compris après minuit', () => {
    expect(shiftMinutes('11:00', '15:00')).toBe(240);
    expect(shiftMinutes('18:30', '23:00')).toBe(270);
    // Un snack qui ferme à 00:30 pose bien « 18:00 → 00:30 » : ce n'est pas une
    // faute de saisie, c'est six heures et demie.
    expect(shiftMinutes('18:00', '00:30')).toBe(390);
    expect(shiftMinutes('22:00', '02:00')).toBe(240);
  });

  it('range le service au midi ou au soir selon son heure de début', () => {
    expect(serviceOf('11:00')).toBe('midi');
    expect(serviceOf('15:59')).toBe('midi');
    expect(serviceOf('16:00')).toBe('soir');
    expect(serviceOf('18:30')).toBe('soir');
  });

  it('détecte le chevauchement, même quand un service déborde sur le lendemain', () => {
    const nuit = shift({ id: 'a', staffId: 'ali', date: '2026-08-17', start: '22:00', end: '02:00' });
    const matin = shift({ id: 'b', staffId: 'ali', date: '2026-08-18', start: '01:00', end: '07:00' });
    expect(shiftsOverlap(nuit, matin)).toBe(true);

    const apres = shift({ id: 'c', staffId: 'ali', date: '2026-08-18', start: '11:00', end: '15:00' });
    expect(shiftsOverlap(nuit, apres)).toBe(false);
  });
});

describe('Coût projeté', () => {
  it('convertit les minutes en centimes, au centime près', () => {
    expect(costCentsFor(240, 1_500)).toBe(6_000); // 4 h × 15,00 €
    expect(costCentsFor(270, 1_200)).toBe(5_400); // 4 h 30 × 12,00 €
    expect(costCentsFor(50, 1_337)).toBe(1_114); // arrondi au centime
  });

  it('refuse de facturer à zéro un salarié dont on ignore le coût', () => {
    // Compter gratuitement un extra non tarifé donnerait une masse salariale
    // fausse — et c'est sur ce chiffre que le gérant décide d'embaucher.
    expect(costCentsFor(240, null)).toBeNull();
    expect(costCentsFor(240, 0)).toBe(0);
  });
});

describe('Semaine de planning', () => {
  const semaine = () =>
    buildWeek({
      weekStart: LUNDI,
      staff: [ALI, SARA, EXTRA],
      payrollVisible: true,
      reminders: [],
      shifts: [
        shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '11:00', end: '15:00' }),
        shift({ id: '2', staffId: 'sara', date: '2026-08-17', start: '18:00', end: '23:00' }),
        shift({ id: '3', staffId: 'ali', date: '2026-08-22', start: '18:00', end: '23:30', status: 'publie' }),
        shift({ id: '4', staffId: 'extra', date: '2026-08-22', start: '18:00', end: '23:30' }),
      ],
    });

  it('rend les sept jours, même vides, et sépare midi et soir', () => {
    const week = semaine();
    expect(week.week).toBe('2026-08-17');
    expect(week.weekEnd).toBe('2026-08-23');
    expect(week.days).toHaveLength(7);
    expect(week.days.map((d) => d.label)).toEqual([
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
      'Dimanche',
    ]);

    const lundi = week.days[0];
    expect(lundi?.services.map((s) => s.service)).toEqual(['midi', 'soir']);
    expect(lundi?.services[0]?.shifts.map((s) => s.staffName)).toEqual(['Ali']);
    expect(lundi?.services[1]?.shifts.map((s) => s.staffName)).toEqual(['Sara']);

    // Mardi : aucun service, mais la case existe — le planning est une grille.
    expect(week.days[1]?.services).toHaveLength(2);
    expect(week.days[1]?.people).toBe(0);
  });

  it('projette le coût par service, par jour et sur la semaine', () => {
    const week = semaine();

    // Lundi midi : Ali, 4 h × 15,00 € = 60,00 €.
    expect(week.days[0]?.services[0]?.costCents).toBe(6_000);
    // Lundi soir : Sara, 5 h × 12,00 € = 60,00 €.
    expect(week.days[0]?.services[1]?.costCents).toBe(6_000);
    expect(week.days[0]?.costCents).toBe(12_000);

    // Samedi soir : Ali 5 h 30 × 15,00 € = 82,50 € ; l'extra n'est pas tarifé.
    const samedi = week.days[5];
    expect(samedi?.hours).toBe(11); // 5,5 h × 2 personnes : les HEURES, elles, comptent
    expect(samedi?.costCents).toBe(8_250);

    expect(week.totals.hours).toBe(20);
    expect(week.totals.costCents).toBe(12_000 + 8_250);
  });

  it('annonce une projection PARTIELLE plutôt qu’un total qui ment', () => {
    const week = semaine();
    expect(week.payroll.visible).toBe(true);
    expect(week.payroll.missingCost).toEqual([{ staffId: 'extra', staffName: 'Yanis' }]);
    expect(week.payroll.message).toContain('Projection partielle');
    expect(week.payroll.message).toContain('Yanis');
  });

  it('renvoie « — » plutôt que « 0 € » quand personne n’est tarifé', () => {
    const week = buildWeek({
      weekStart: LUNDI,
      staff: [EXTRA],
      payrollVisible: true,
      reminders: [],
      shifts: [shift({ id: '1', staffId: 'extra', date: '2026-08-17' })],
    });
    // Un zéro afficherait « votre équipe ne coûte rien ». Le null dit « je ne
    // sais pas », qui est la vérité.
    expect(week.totals.costCents).toBeNull();
    expect(week.totals.hours).toBe(4);
  });

  it('compte brouillons et publiés séparément', () => {
    const week = semaine();
    expect(week.counts).toEqual({ brouillon: 3, publie: 1 });
  });

  it('ne fait pas disparaître les services d’un membre supprimé', () => {
    const week = buildWeek({
      weekStart: LUNDI,
      staff: [],
      payrollVisible: true,
      reminders: [],
      shifts: [shift({ id: '1', staffId: 'parti', date: '2026-08-17' })],
    });
    expect(week.days[0]?.services[0]?.shifts[0]?.staffName).toBe('Membre supprimé');
    expect(week.totals.hours).toBe(4);
  });
});

describe('Rappels de durée du travail', () => {
  const rappels = (shifts: PlannedShiftRow[], staff: StaffRow[] = [ALI]) =>
    buildReminders({ shifts, staff, weekStart: LUNDI, weekEnd: DIMANCHE });

  it('signale une journée cumulée au-delà de dix heures', () => {
    // Deux services le même jour : c'est le CUMUL qui interpelle, pas chaque
    // service pris isolément.
    const found = rappels([
      shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '10:00', end: '15:00' }),
      shift({ id: '2', staffId: 'ali', date: '2026-08-17', start: '17:00', end: '23:30' }),
    ]);
    const longue = found.filter((r) => r.kind === 'journee-longue');
    expect(longue).toHaveLength(1);
    expect(longue[0]?.message).toContain('11 h 30');
    expect(longue[0]?.message).toContain('lundi 17 août');
    expect(longue[0]?.date).toBe('2026-08-17');
  });

  it('ne dit rien d’une journée de dix heures pile', () => {
    const found = rappels([
      shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '11:00', end: '21:00' }),
    ]);
    expect(found).toEqual([]);
  });

  it('signale un repos inférieur à onze heures entre deux journées', () => {
    // Fermeture à 23 h 30, réouverture à 08 h 00 : huit heures et demie.
    const found = rappels([
      shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '18:00', end: '23:30' }),
      shift({ id: '2', staffId: 'ali', date: '2026-08-18', start: '08:00', end: '15:00' }),
    ]);
    const repos = found.filter((r) => r.kind === 'repos-court');
    expect(repos).toHaveLength(1);
    expect(repos[0]?.message).toContain('8 h 30 de repos');
    expect(repos[0]?.date).toBe('2026-08-18');
  });

  it('ne prend JAMAIS la coupure de l’après-midi pour un repos court', () => {
    // Régression constatée en curl sur le tenant de staging : la semaine type
    // d'un snack (midi 11 h–15 h, soir 18 h–23 h 30) produisait un rappel de
    // « 3 h de repos » CHAQUE jour et pour CHAQUE personne — quatorze rappels
    // qui n'apprenaient rien et noyaient les deux qui comptaient. La coupure
    // est le rythme normal du métier, pas un signal.
    const found = rappels([
      shift({ id: '1', staffId: 'ali', date: '2026-08-18', start: '11:00', end: '15:00' }),
      shift({ id: '2', staffId: 'ali', date: '2026-08-18', start: '18:00', end: '23:30' }),
      shift({ id: '3', staffId: 'ali', date: '2026-08-19', start: '11:00', end: '15:00' }),
      shift({ id: '4', staffId: 'ali', date: '2026-08-19', start: '18:00', end: '23:30' }),
    ]);
    expect(found.filter((r) => r.kind === 'repos-court')).toEqual([]);
  });

  it('mesure le repos depuis la FIN de la journée, service de nuit compris', () => {
    // Vendredi soir jusqu'à 00:30, reprise samedi 11 h : 10 h 30 de repos.
    // Sans la borne de fin poussée sur le lendemain, on lirait « 22 h 30 ».
    const found = rappels([
      shift({ id: '1', staffId: 'ali', date: '2026-08-21', start: '18:00', end: '00:30' }),
      shift({ id: '2', staffId: 'ali', date: '2026-08-22', start: '11:00', end: '15:00' }),
    ]);
    const repos = found.filter((r) => r.kind === 'repos-court');
    expect(repos).toHaveLength(1);
    expect(repos[0]?.message).toContain('10 h 30 de repos');
    expect(repos[0]?.message).toContain('fin du vendredi 21 août');
    expect(repos[0]?.message).toContain('reprise du samedi 22 août');
  });

  it('signale sept jours d’affilée, même à cheval sur deux semaines', () => {
    // La série commence le vendredi de la semaine PRÉCÉDENTE : sans fenêtre
    // élargie, le gérant ne la verrait jamais.
    const jours = ['08-14', '08-15', '08-16', '08-17', '08-18', '08-19', '08-20'];
    const found = rappels(
      jours.map((jour, i) => shift({ id: String(i), staffId: 'ali', date: `2026-${jour}` })),
    );
    const serie = found.filter((r) => r.kind === 'jours-consecutifs');
    expect(serie).toHaveLength(1);
    expect(serie[0]?.message).toContain('7 jours travaillés');
    expect(serie[0]?.message).toContain('vendredi 14 août');
    expect(serie[0]?.message).toContain('jeudi 20 août');
  });

  it('ne signale rien pour six jours consécutifs', () => {
    const jours = ['08-17', '08-18', '08-19', '08-20', '08-21', '08-22'];
    const found = rappels(
      jours.map((jour, i) => shift({ id: String(i), staffId: 'ali', date: `2026-${jour}` })),
    );
    expect(found.filter((r) => r.kind === 'jours-consecutifs')).toEqual([]);
  });

  it('ne mélange pas les personnes', () => {
    const found = rappels(
      [
        shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '11:00', end: '23:00' }),
        shift({ id: '2', staffId: 'sara', date: '2026-08-17', start: '11:00', end: '15:00' }),
      ],
      [ALI, SARA],
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.staffName).toBe('Ali');
  });

  it('n’annonce JAMAIS une conformité — la réserve voyage avec les rappels', () => {
    const week = buildWeek({
      weekStart: LUNDI,
      staff: [ALI],
      payrollVisible: true,
      shifts: [],
      reminders: rappels([
        shift({ id: '1', staffId: 'ali', date: '2026-08-17', start: '10:00', end: '23:00' }),
      ]),
    });

    expect(week.remindersDisclaimer).toBe(PLANNING_REMINDERS_DISCLAIMER);
    expect(week.remindersDisclaimer).toContain("ce n'est pas un contrôle de conformité");
    expect(week.remindersDisclaimer).toContain('convention collective');

    // Aucun message ne doit ressembler à un verdict légal.
    const mots = /conforme|conformité|légal|illégal|infraction|obligatoire/i;
    for (const rappel of week.reminders) {
      expect(rappel.message).not.toMatch(mots);
    }
  });
});
