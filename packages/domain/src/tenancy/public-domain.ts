import { InvalidDomainName } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';

/**
 * Nom de domaine public d'un restaurant (« commander.classfood.fr »).
 *
 * Value object : une instance existante est forcément un nom valide, en
 * minuscules, sans schéma ni chemin. On refuse volontairement les domaines
 * apex (« classfood.fr ») : un apex ne peut pas porter de CNAME selon la
 * RFC 1034, et un restaurateur qui pointerait son domaine racine chez nous
 * casserait sa messagerie. On exige donc un sous-domaine.
 */
export class PublicDomain {
  private constructor(readonly value: string) {}

  static create(input: string): Result<PublicDomain, InvalidDomainName> {
    const cleaned = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '');

    if (!cleaned) {
      return err(new InvalidDomainName('Le domaine est vide'));
    }
    if (cleaned.length > 253) {
      return err(new InvalidDomainName('Le domaine dépasse 253 caractères'));
    }

    const labels = cleaned.split('.');
    if (labels.length < 3) {
      return err(
        new InvalidDomainName(
          `« ${cleaned} » est un domaine racine. Utilisez un sous-domaine, par exemple « commander.${cleaned} » — un domaine racine ne peut pas porter de CNAME.`,
        ),
      );
    }

    const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
    for (const l of labels) {
      if (!label.test(l)) {
        return err(new InvalidDomainName(`Segment invalide dans « ${cleaned} » : « ${l} »`));
      }
    }

    return ok(new PublicDomain(cleaned));
  }

  /** Sous-domaine que nous hébergeons nous-mêmes (pas de CNAME à poser). */
  isManagedBy(rootDomain: string): boolean {
    return this.value.endsWith(`.${rootDomain}`);
  }

  equals(other: PublicDomain): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/**
 * Identifiant court d'un restaurant, utilisé comme sous-domaine et dans les URL.
 * Contraintes plus strictes qu'un domaine : c'est nous qui le générons.
 */
export class TenantSlug {
  private constructor(readonly value: string) {}

  /** Mots réservés : ils entreraient en collision avec nos propres adresses. */
  private static readonly RESERVED = new Set([
    'www',
    'api',
    'admin',
    'app',
    'mail',
    'ftp',
    'cdn',
    'static',
    'assets',
    'status',
    'docs',
    'blog',
    'support',
    'sm',
    'embed',
  ]);

  static create(input: string): Result<TenantSlug, InvalidDomainName> {
    const cleaned = input
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (cleaned.length < 3) {
      return err(new InvalidDomainName('Identifiant trop court (3 caractères minimum)'));
    }
    if (cleaned.length > 63) {
      return err(new InvalidDomainName('Identifiant trop long (63 caractères maximum)'));
    }
    if (TenantSlug.RESERVED.has(cleaned)) {
      return err(new InvalidDomainName(`« ${cleaned} » est un identifiant réservé`));
    }

    return ok(new TenantSlug(cleaned));
  }

  /** Adresse servie par défaut, sans aucune action du restaurateur. */
  defaultDomain(rootDomain: string): string {
    return `${this.value}.${rootDomain}`;
  }

  equals(other: TenantSlug): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
