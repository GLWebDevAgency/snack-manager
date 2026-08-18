import type { Clock } from '../shared/clock';
import { err, ok, type Result } from '../shared/result';
import type { BrandTheme } from './brand-theme';
import type { Closure } from './closure';
import { DomainAlreadyAttached, InvalidRestaurant } from './errors';
import {
  generateSlots,
  SlotPolicy,
  type PickupSlot,
  type SlotOccupancy,
} from './pickup-slot';
import type { PublicDomain, TenantSlug } from './public-domain';
import type { ServiceHours, ServiceOpening } from './service-hours';
import type { CalendarDay } from './wall-clock';

/**
 * Le restaurant — racine d'agrégat du sous-domaine RESTAURANT.
 *
 * Il rassemble ce qu'on ne peut pas modifier séparément sans se contredire :
 * on ne peut pas répondre « êtes-vous ouvert ? » avec les horaires seuls, ni
 * proposer un créneau sans connaître les fermetures. Tout le reste (menu,
 * commandes, stock) vit dans d'autres agrégats et n'est référencé que par le
 * slug.
 */
export class Restaurant {
  private constructor(
    readonly slug: TenantSlug,
    readonly name: string,
    readonly hours: ServiceHours,
    readonly theme: BrandTheme,
    readonly slotPolicy: SlotPolicy,
    readonly closures: readonly Closure[],
    readonly domains: readonly PublicDomain[],
  ) {}

  static create(restaurant: {
    slug: TenantSlug;
    name: string;
    hours: ServiceHours;
    theme: BrandTheme;
    slotPolicy?: SlotPolicy;
    closures?: readonly Closure[];
    domains?: readonly PublicDomain[];
  }): Result<Restaurant, InvalidRestaurant> {
    const name = restaurant.name.trim();
    if (name.length === 0) {
      return err(new InvalidRestaurant('Le nom du restaurant est obligatoire'));
    }
    if (name.length > 120) {
      return err(new InvalidRestaurant('Le nom du restaurant dépasse 120 caractères'));
    }

    const domains = restaurant.domains ?? [];
    for (let i = 1; i < domains.length; i++) {
      const current = domains[i];
      if (current && domains.slice(0, i).some((d) => d.equals(current))) {
        return err(new InvalidRestaurant(`« ${current.toString()} » est rattaché deux fois`));
      }
    }

    return ok(
      new Restaurant(
        restaurant.slug,
        name,
        restaurant.hours,
        restaurant.theme,
        restaurant.slotPolicy ?? SlotPolicy.DEFAULT,
        restaurant.closures ?? [],
        domains,
      ),
    );
  }

  /**
   * Sert-on à cet instant ?
   *
   * Les horaires disent la semaine type, les fermetures ont le dernier mot :
   * un gérant qui ferme pour cause de panne ne veut pas voir « ouvert » sur sa
   * page publique.
   */
  isOpenAt(instant: Date): boolean {
    if (this.closures.some((c) => c.covers(instant))) return false;
    return this.hours.isOpenAt(instant);
  }

  /** Prochain service réellement assuré, fermetures déduites. */
  nextOpening(from: Date): Date | null {
    return this.nextService(from)?.opensAt ?? null;
  }

  /** Le prochain service, avec sa plage — de quoi écrire « Soir · 18:00 – 22:30 ». */
  nextService(from: Date): ServiceOpening | null {
    return (
      this.hours
        .openingsFrom(from)
        .find(
          (opening) =>
            !this.closures.some(
              (c) => c.coversWholeDay(opening.day) || c.covers(opening.opensAt),
            ),
        ) ?? null
    );
  }

  /** Fermeture exceptionnelle avalant cette journée, s'il y en a une. */
  closureOn(day: CalendarDay): Closure | null {
    return this.closures.find((c) => c.coversWholeDay(day)) ?? null;
  }

  /** Créneaux de retrait proposables pour une journée. Ne lève jamais. */
  pickupSlotsOn(day: CalendarDay, occupancy: SlotOccupancy, clock: Clock): readonly PickupSlot[] {
    return generateSlots(day, this.hours, this.slotPolicy, occupancy, clock, this.closures);
  }

  /** Adresse servie sans aucune démarche du restaurateur. */
  defaultDomain(rootDomain: string): string {
    return this.slug.defaultDomain(rootDomain);
  }

  /** Adresse à afficher : celle du restaurateur si elle existe, la nôtre sinon. */
  primaryDomain(rootDomain: string): string {
    return this.domains[0]?.toString() ?? this.defaultDomain(rootDomain);
  }

  attachDomain(domain: PublicDomain): Result<Restaurant, DomainAlreadyAttached> {
    if (this.domains.some((d) => d.equals(domain))) {
      return err(new DomainAlreadyAttached(domain.toString()));
    }
    return ok(this.with({ domains: [...this.domains, domain] }));
  }

  closeExceptionally(closure: Closure): Restaurant {
    return this.with({ closures: [...this.closures, closure] });
  }

  withHours(hours: ServiceHours): Restaurant {
    return this.with({ hours });
  }

  withTheme(theme: BrandTheme): Restaurant {
    return this.with({ theme });
  }

  withSlotPolicy(slotPolicy: SlotPolicy): Restaurant {
    return this.with({ slotPolicy });
  }

  /** Recopie immuable — l'agrégat construit est déjà valide, rien à revalider. */
  private with(patch: {
    hours?: ServiceHours;
    theme?: BrandTheme;
    slotPolicy?: SlotPolicy;
    closures?: readonly Closure[];
    domains?: readonly PublicDomain[];
  }): Restaurant {
    return new Restaurant(
      this.slug,
      this.name,
      patch.hours ?? this.hours,
      patch.theme ?? this.theme,
      patch.slotPolicy ?? this.slotPolicy,
      patch.closures ?? this.closures,
      patch.domains ?? this.domains,
    );
  }
}
