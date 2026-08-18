import { InvalidOrderLine } from './errors';
import { type Clock, minutesBetween } from '../shared/clock';
import { err, ok, type Result } from '../shared/result';

/**
 * Preuve qu'un responsable a validé une action sensible (remise, annulation).
 *
 * Le domaine ne vérifie AUCUN code PIN : le hachage argon2 et la comparaison
 * vivent dans l'infrastructure. Ce qu'il modélise, c'est la trace — NF525
 * exige que toute minoration de recette soit imputable à une personne
 * identifiée, à un instant daté.
 *
 * Une autorisation périme volontairement vite. Sur le terrain, le gérant tape
 * son code puis retourne en cuisine ; sans péremption, sa session couvrirait
 * toutes les remises de la soirée, y compris celles qu'il n'a jamais vues.
 */
export class StaffAuthorization {
  private constructor(
    readonly staffId: string,
    private readonly verifiedAtMs: number,
  ) {}

  /** Un code tapé il y a plus de cinq minutes ne couvre plus l'action en cours. */
  static readonly VALIDITY_MINUTES = 5;

  /** À appeler APRÈS vérification du PIN par l'infrastructure. */
  static grant(staffId: string, clock: Clock): Result<StaffAuthorization, InvalidOrderLine> {
    const id = staffId.trim();
    if (!id) {
      return err(new InvalidOrderLine("Validation impossible : l'identité du valideur manque"));
    }

    return ok(new StaffAuthorization(id, clock.now().getTime()));
  }

  get pinVerifiedAt(): Date {
    return new Date(this.verifiedAtMs);
  }

  isStale(clock: Clock, maxAgeMinutes: number = StaffAuthorization.VALIDITY_MINUTES): boolean {
    return minutesBetween(this.pinVerifiedAt, clock.now()) >= maxAgeMinutes;
  }

  toJSON(): { staffId: string; pinVerifiedAt: string } {
    return { staffId: this.staffId, pinVerifiedAt: new Date(this.verifiedAtMs).toISOString() };
  }
}
