import { DIRECTIONS } from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { toIdentity } from './tenant-site.repository';

/**
 * L'IDENTITÉ QUI SORT PAR LE DOMAINE DU RESTAURANT.
 *
 * `resolve-tenant-by-host` rend cette forme à chaque requête sur le domaine
 * personnalisé d'un restaurant : c'est elle qui décide du logo et de la
 * couleur affichés. La dérivation vivait dans une fonction privée du dépôt,
 * couverte seulement de biais par les cas d'usage sur des fakes — donc pas
 * couverte du tout : un retour au champ plat n'aurait rougi aucun test.
 */
const tenant = (patch: Record<string, unknown>) =>
  ({ _id: 'abc123', slug: 'classfood', name: 'Classfood', ...patch }) as unknown as Tenant & {
    _id: unknown;
  };

describe('l’identité d’un établissement, dérivée du masque', () => {
  it('un tenant repris porte l’accent et le logo de SON masque', () => {
    const id = toIdentity(
      tenant({
        brand: {
          ...DIRECTIONS.soleil,
          logo: {
            mark: { light: null, dark: 'https://r2/mark-dark.png' },
            lockup: { light: null, dark: null },
          },
        },
        // Les colonnes d'avant la reprise ne doivent PLUS être lues.
        brandColor: '#c9a15a',
        logoUrl: 'https://r2/legacy.png',
      }),
    );
    // L'accent DU MASQUE, pas la colonne du tenant (`#c9a15a` ci-dessus) :
    // c'est la seule chose que ce test doit prouver, et l'écrire en dur y
    // ajoutait une casse d'hexadécimal que le contrat normalise.
    expect(id.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
    expect(id.logoUrl).toBe('https://r2/mark-dark.png');
    expect(id.tenantId).toBe('abc123');
    expect(id.slug).toBe('classfood');
  });

  it('un tenant pas encore repris porte son accent BRUT — jamais une nuance qu’il n’a pas choisie', () => {
    // Spec §8.1 : `accent = brandColor`. C'est `accentInk`, dérivé au rendu,
    // qui porte l'AA du texte — pas la couleur qu'on rend au restaurateur.
    const id = toIdentity(
      tenant({ brand: null, brandColor: '#7a2e2a', logoUrl: 'https://r2/legacy.png' }),
    );
    expect(id.brandColor).toBe('#7a2e2a');
    expect(id.logoUrl).toBe('https://r2/legacy.png');
  });
});
