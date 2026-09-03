import { BRAND_MODES, HEX, type Brand } from "@sm/contracts";

/**
 * LE MASQUE REMONTE JUSQU'AU DOCUMENT — la moitié que le `style` inline ne
 * peut pas atteindre.
 *
 * `styleDuMasque()` pose la cinquantaine de `--cf-*` sur la RACINE d'une
 * surface, c'est-à-dire sur une `<div>`. Or trois choses ne se peignent pas
 * depuis une div :
 *
 *  1. LE CANEVAS. Le fond de la fenêtre vient de `<html>` (à défaut de
 *     `<body>`), jamais d'un enfant : sur les quatre directions claires, le
 *     rebond élastique d'iOS et de macOS découvrait un rectangle NOIR derrière
 *     une page crème, et un éclair noir passait avant la peinture du
 *     sous-arbre. `min-h-dvh` masquait le défaut sans le corriger — il ne
 *     couvre pas la zone d'overscroll.
 *  2. L'ASCENSEUR DU DOCUMENT et les contrôles natifs (date, select, champs
 *     d'autofill), qui suivent le `color-scheme` de l'élément qui DÉFILE :
 *     `<html>`. Celui posé sur la div ne remonte pas.
 *  3. La couleur d'interface que le navigateur dérive du même endroit.
 *
 * ═══ POURQUOI UNE FEUILLE HISSÉE, ET PAS UN EFFET SUR document.documentElement ═══
 *
 * React 19 hisse dans le `<head>` tout `<style>` porteur d'un `href` et d'une
 * `precedence`, en dédoublonnant par `href` — rendu côté SERVEUR compris.
 * La règle est donc dans la toute première image HTML, avant le moindre
 * octet de JavaScript : c'est exactement ce qu'un `useEffect` ne peut pas
 * offrir, lui qui n'agirait qu'après l'hydratation — soit après le flash.
 *
 * Elle est HORS `@layer`, et `globals.css` a mis ses règles d'éléments dans
 * `@layer base` pour cette raison : une règle sans couche l'emporte sur toute
 * couche, quel que soit l'ordre d'insertion des feuilles dans le `<head>`.
 * Aucune course entre la feuille de Next et celle-ci.
 *
 * L'ADMIN NE LA REND JAMAIS : elle est montée par les racines client
 * (vitrine, tunnel, suivi, fidélité), à côté de `styleDuMasque()`.
 */
export function FeuilleDuMasque({ brand }: { brand: Brand }) {
  const fond = brand.palette.ground;
  const mode = brand.mode;
  /*
   * Le contenu d'un `<style>` est du CSS BRUT : rien ne l'échappe, et une
   * accolade suffirait à ouvrir une autre règle. La palette a beau traverser
   * `BrandSchema` avant d'arriver ici, la seule garde qui vaille est celle
   * posée au point d'écriture — les deux valeurs sont donc revalidées contre
   * leur forme littérale, et la feuille n'est pas rendue si l'une échoue.
   */
  if (!HEX.test(fond) || !BRAND_MODES.includes(mode)) return null;
  /*
   * `body` autant que `html` : le canevas vient du premier, mais le second
   * garde un fond propre là où le sous-arbre du masque ne s'étend pas.
   * Un enfant UNIQUE et une chaîne — c'est ce que React exige d'un `<style>`
   * hissé pour pouvoir le dédoublonner.
   */
  const regles = `html,body{background:${fond}}html{color-scheme:${mode}}`;
  return (
    <style href={`masque-${mode}-${fond}`} precedence="masque">
      {regles}
    </style>
  );
}
