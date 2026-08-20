import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@sm/contracts';
import { describe, expect, it } from 'vitest';
import { PlanningController } from './planning.controller';
import type { PlanningService } from './planning.service';
import { canReadPayroll, PAYROLL_FORBIDDEN_MESSAGE, PayrollGuard } from './payroll-access';
import { buildWeek } from './planning.compute';

/**
 * LE SALAIRE NE SORT PAS PAR LE COMPTOIR.
 *
 * Une rémunération est une donnée personnelle. La tablette de caisse s'ouvre à
 * quatre chiffres, tapés devant l'équipe et devant les clients ; le jeton
 * qu'elle délivre porte le rôle du membre — `gerant` compris. C'est le piège
 * exact que ce fichier verrouille : `@Roles('owner', 'gerant')` ne suffit PAS,
 * et sans la double condition un équipier lirait le coût horaire de son
 * collègue en tapotant l'écran.
 */

const PROPRIETAIRE: JwtPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  role: 'owner',
  kind: 'user',
};

/** Le cas dangereux : rôle `gerant`, mais session ouverte au PIN sur tablette. */
const GERANT_AU_PIN: JwtPayload = {
  sub: 'staff-1',
  tenantId: 'tenant-1',
  role: 'gerant',
  kind: 'staff',
};

const CAISSIER_AU_PIN: JwtPayload = {
  sub: 'staff-2',
  tenantId: 'tenant-1',
  role: 'caisse',
  kind: 'staff',
};

const contextFor = (user: JwtPayload | undefined): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, headers: {} }) }) }) as ExecutionContext;

describe('Droit de lecture des rémunérations', () => {
  it('n’accorde le droit qu’au propriétaire connecté par mot de passe', () => {
    expect(canReadPayroll(PROPRIETAIRE)).toBe(true);

    // Même rôle « gerant » qu'au back-office, mais obtenu au PIN : refusé.
    expect(canReadPayroll(GERANT_AU_PIN)).toBe(false);
    expect(canReadPayroll(CAISSIER_AU_PIN)).toBe(false);
    expect(canReadPayroll(undefined)).toBe(false);

    // Un jeton d'équipe SM n'est pas non plus l'employeur du salarié.
    expect(canReadPayroll({ sub: 'sm', tenantId: null, role: 'sm_admin', kind: 'user' })).toBe(false);
  });

  it('ferme les routes de coût horaire à une session PIN, avec un message lisible', () => {
    const guard = new PayrollGuard();
    expect(guard.canActivate(contextFor(PROPRIETAIRE))).toBe(true);

    const error = (() => {
      try {
        guard.canActivate(contextFor(GERANT_AU_PIN));
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(PAYROLL_FORBIDDEN_MESSAGE);
  });
});

describe('Le planning rendu à une session PIN', () => {
  /** Contrôleur branché sur un faux service : on n'observe que ce qu'il transmet. */
  function controllerSpy() {
    const calls: boolean[] = [];
    const service = {
      week: (_tenantId: string, _week: string | undefined, payrollVisible: boolean) => {
        calls.push(payrollVisible);
        return Promise.resolve(null);
      },
    } as unknown as PlanningService;
    return { controller: new PlanningController(service), calls };
  }

  it('transmet « montants masqués » quand la session vient du PIN', async () => {
    const { controller, calls } = controllerSpy();

    await controller.week('tenant-1', GERANT_AU_PIN, { week: undefined });
    await controller.week('tenant-1', CAISSIER_AU_PIN, { week: undefined });
    await controller.week('tenant-1', PROPRIETAIRE, { week: undefined });

    // Le contrôleur ne devine rien : il applique `canReadPayroll` et passe le
    // résultat au service, seul point où la décision est prise.
    expect(calls).toEqual([false, false, true]);
  });

  it('rend un planning complet mais SANS aucun montant', () => {
    const staff = [
      { id: 'ali', name: 'Ali', role: 'cuisine', hourlyCostCents: 1_450 },
      { id: 'sara', name: 'Sara', role: 'caisse', hourlyCostCents: 1_300 },
    ];
    const shifts = [
      {
        id: 's1',
        staffId: 'ali',
        date: '2026-08-17',
        start: '11:00',
        end: '15:00',
        position: 'cuisine' as const,
        note: '',
        status: 'publie' as const,
      },
      {
        id: 's2',
        staffId: 'sara',
        date: '2026-08-17',
        start: '18:00',
        end: '23:00',
        position: 'caisse' as const,
        note: '',
        status: 'publie' as const,
      },
    ];
    const weekStart = { y: 2026, m: 8, d: 17 };

    const masque = buildWeek({ weekStart, shifts, staff, payrollVisible: false, reminders: [] });
    const complet = buildWeek({ weekStart, shifts, staff, payrollVisible: true, reminders: [] });

    // Le service reste lisible : heures, postes, personnes — tout est là.
    expect(masque.totals.hours).toBe(9);
    expect(masque.days[0]?.services[0]?.shifts[0]?.staffName).toBe('Ali');

    // Mais aucun euro, à aucun niveau d'agrégation.
    expect(masque.totals.costCents).toBeNull();
    expect(masque.days[0]?.costCents).toBeNull();
    expect(masque.days[0]?.services.every((s) => s.costCents === null)).toBe(true);
    expect(masque.perStaff.every((s) => s.costCents === null)).toBe(true);
    // Le coût horaire lui-même ne transite pas non plus : c'est LA donnée
    // personnelle, la déduire d'un total serait déjà trop.
    expect(masque.perStaff.every((s) => s.hourlyCostCents === null)).toBe(true);
    expect(masque.payroll.visible).toBe(false);

    // Sérialisation complète : aucune valeur de salaire ne subsiste ailleurs.
    const json = JSON.stringify(masque);
    expect(json).not.toContain('1450');
    expect(json).not.toContain('1300');

    // Le même planning, lu par le patron, porte bien les montants.
    expect(complet.totals.costCents).toBe(4 * 1_450 + 5 * 1_300);
    expect(complet.payroll.visible).toBe(true);
  });
});
