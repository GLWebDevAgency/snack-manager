import { BadRequestException } from '@nestjs/common';
import { BrandSchema, contraste, type Brand } from '@sm/contracts';
import { imageAutorisee } from './origines-images';

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

/**
 * Les cinq emplacements d'image d'un masque — quatre logos et l'en-tête.
 *
 * Énumérés une fois ici : ce sont exactement les champs que le contrat déclare
 * en `ImageUrl`, et un emplacement ajouté au masque sans être ajouté à cette
 * liste échapperait à la liste blanche d'origines.
 */
export function urlsDuMasque(brand: Brand): string[] {
  return [
    brand.logo.mark.light,
    brand.logo.mark.dark,
    brand.logo.lockup.light,
    brand.logo.lockup.dark,
    brand.hero,
  ].filter((url): url is string => typeof url === 'string' && url !== '');
}

/** Toutes les images du masque viennent-elles d'un hôte autorisé ? */
const toutesImagesAutorisees = (brand: Brand, hotes: readonly string[]): boolean =>
  urlsDuMasque(brand).every((url) => imageAutorisee(url, hotes));

/**
 * L'API n'héberge pas les images des autres.
 *
 * `ImageUrl` borne le SCHÉMA (http(s) seulement) ; il ne dit rien de
 * l'ORIGINE. Une adresse arbitraire écrite dans `logo.*` ou `hero` était donc
 * servie sur la vitrine, la carte de fidélité et le tableau de menu du
 * restaurant — l'hôte tiers y voyait passer l'IP et le navigateur de chaque
 * client, et gardait la main sur ce qui s'affiche (cf. `OriginesImages`).
 *
 * Le 400 NOMME les adresses refusées et les hôtes admis : sans ça, un
 * restaurateur qui colle l'URL d'une photo trouvée ailleurs n'a aucun moyen de
 * comprendre ce qu'on attend de lui.
 */
export function exigerOriginesImages(brand: Brand, hotes: readonly string[]): void {
  const refusees = urlsDuMasque(brand).filter((url) => !imageAutorisee(url, hotes));
  if (refusees.length === 0) return;
  throw new BadRequestException({
    message: 'Origine d’image non autorisée',
    refusees,
    hotesAutorises: [...hotes],
  });
}

/** Un masque sans aucun logo hérite du logo legacy : rien ne disparaît à la première pose. */
export function avecLogoHerite(brand: Brand, logoUrl: string | null | undefined): Brand {
  const sansLogo = !brand.logo.mark.light && !brand.logo.mark.dark && !brand.logo.lockup.light && !brand.logo.lockup.dark;
  if (!sansLogo || !logoUrl) return brand;
  return { ...brand, logo: { ...brand.logo, mark: { ...brand.logo.mark, dark: logoUrl } } };
}

/**
 * Ce qu'on ENREGISTRE : le masque reçu, ses images tenues à des origines
 * connues, le logo legacy hérité s'il n'en porte aucun, et le contraste
 * rejoué. L'ordre est le sens.
 *
 *  1. Les ORIGINES d'abord, sur le masque tel qu'il a été ENVOYÉ : c'est le
 *     seul endroit où l'on juge une intention. Ce qui est refusé ici ne
 *     s'écrit pas, et l'appelant sait pourquoi.
 *  2. L'HÉRITAGE ensuite — mais le logo legacy n'est greffé que si le résultat
 *     reste un masque VALIDE et sur une origine admise. Ce logo-là vient de la
 *     colonne plate, écrite par des chemins plus anciens que cette garde : le
 *     refuser bloquerait le restaurateur pour une URL qu'il n'a pas posée,
 *     alors qu'il suffit de ne pas la greffer (sinon `safeParse` échouerait à
 *     la lecture et le restaurant basculerait en repli Nuit, sur un 200).
 *  3. Le CONTRASTE en dernier, sur le masque tel qu'il sera vraiment stocké.
 */
export function masqueAEnregistrer(
  brand: Brand,
  logoUrl: string | null | undefined,
  hotes: readonly string[],
): Brand {
  exigerOriginesImages(brand, hotes);
  const herite = avecLogoHerite(brand, logoUrl);
  const greffable = BrandSchema.safeParse(herite).success && toutesImagesAutorisees(herite, hotes);
  const valide = greffable ? herite : brand;
  exigerAA(valide);
  return valide;
}
