import { BadRequestException } from '@nestjs/common';
import { BrandSchema, contraste, type Brand } from '@sm/contracts';

/**
 * L'éditeur empêche d'arriver ici avec un masque illisible ; l'API ne s'y fie
 * pas. Le 400 rend les couples en échec ET la nuance la plus proche qui
 * passe — le même remède que l'éditeur propose en un clic.
 */
export function exigerAA(brand: Brand): void {
  const v = contraste(brand);
  if (v.ok) return;
  throw new BadRequestException({
    message: 'Contraste insuffisant',
    verdicts: v.verdicts.filter((x) => !x.ok),
  });
}

/** Un masque sans aucun logo hérite du logo legacy : rien ne disparaît à la première pose. */
export function avecLogoHerite(brand: Brand, logoUrl: string | null | undefined): Brand {
  const sansLogo = !brand.logo.mark.light && !brand.logo.mark.dark && !brand.logo.lockup.light && !brand.logo.lockup.dark;
  if (!sansLogo || !logoUrl) return brand;
  return { ...brand, logo: { ...brand.logo, mark: { ...brand.logo.mark, dark: logoUrl } } };
}

/**
 * Ce qu'on ENREGISTRE : le masque reçu, le logo legacy hérité s'il n'en porte
 * aucun, et le contraste rejoué. L'ordre est le sens : on hérite AVANT de
 * juger, et rien ne s'écrit sans passer AA.
 */
export function masqueAEnregistrer(brand: Brand, logoUrl: string | null | undefined): Brand {
  const herite = avecLogoHerite(brand, logoUrl);
  // Un logo legacy mal formé ne doit pas rendre le masque invisible à la
  // lecture (safeParse échouerait → repli Nuit, sur un 200) : on n'hérite que
  // si le résultat reste un masque valide, sinon on garde le masque tel quel.
  const valide = BrandSchema.safeParse(herite).success ? herite : brand;
  exigerAA(valide);
  return valide;
}
