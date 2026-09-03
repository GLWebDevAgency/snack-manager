"use client";

import { LAITON, WCAG_AA, ajusterJusquaAA, type Brand } from "@sm/contracts";
import { LogoLockup } from "@/components/brand/Logo";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * « PROPULSÉ PAR SNACK MANAGER » — LA SIGNATURE, EN PIED D'APPLICATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══ NOTRE MARQUE NE PREND PAS LA COULEUR DU RESTAURANT ═══
 *
 * La question s'est posée, et la réponse est déjà dans `globals.css` :
 * `--sm-logo-accent` retombe sur `--cf-gold`, JAMAIS sur `--cf-accent`. Les
 * brancher ensemble suffirait à faire virer le laiton au vert chez un
 * restaurant qui a choisi le vert — notre marque repeinte aux couleurs d'un
 * autre. Une signature qui prend la teinte de celui qu'elle signe ne signe
 * plus rien.
 *
 * ═══ MAIS LE LAITON NU N'EST PAS LISIBLE PARTOUT ═══
 *
 * Mesuré : `#c9a15a` sur le fond Marché (#ffffff) vaut 2,1:1, et sur le sable
 * de Soleil (#f6ebd9) 2,0:1. Une signature qu'on ne lit pas est une signature
 * ratée, et le contraste ne se négocie pas plus ici qu'ailleurs.
 *
 * D'où le seul compromis honnête : la TEINTE reste la nôtre, la VALEUR est
 * ramenée au plancher AA sur le fond du restaurant. C'est exactement le
 * mécanisme que le masque applique déjà à l'accent du restaurateur
 * (`--cf-accent-ink` : l'accent, ramené jusqu'à AA). `ajusterJusquaAA` rend
 * la nuance la PLUS PROCHE qui passe — sur un fond sombre, le laiton ne bouge
 * pas d'un bit.
 *
 * ═══ CE QUE LE COMPOSANT REND VRAIMENT À CETTE TAILLE ═══
 *
 * Vérifié dans `Logo.tsx` avant d'écrire, parce que le composant applique deux
 * règles de charte tout seul :
 *
 *   · `tone="duo"` (la garniture laiton du burger) est REFUSÉ sous 48 px et
 *     retombe en monochrome. À 22 px, le demander n'aurait rien changé — donc
 *     on ne le demande pas, et le mark est entièrement en `currentColor`.
 *   · la gravure MICRO s'applique sous 20 px. À 22 px on est juste au-dessus :
 *     c'est la gravure standard, éclair évidé compris.
 *
 * Le doré du pied vient donc du MOT « Manager », que `.sm-lockup-nom i` peint
 * en `--sm-logo-accent` quelle que soit la taille — et c'est bien le verrou
 * blanc-et-doré du CRM, à l'échelle d'un pied de page.
 *
 * ═══ L'ÉCLAIR EST UN VIDE — IL LUI FAUT UN FOND UNI ═══
 *
 * Le pied est posé sur `bg-bg`, l'aplat de la page. Ne jamais le déplacer sur
 * une carte à dégradé ni sur la photo d'en-tête : le signe s'y brouillerait.
 *
 * ═══ ET PAS DE LIEN ═══
 *
 * C'est une signature, pas une publicité. Un lien sortant depuis la carte d'un
 * restaurant emmènerait SON client sur NOTRE site, depuis une application
 * qu'il a installée pour lui. Le texte est inerte.
 */
export function SignatureSnackManager({ brand }: { brand: Brand }) {
  /*
   * Les DEUX fonds où ce pied peut atterrir : la page (`ground`) et, si on le
   * déplaçait un jour dans une carte, `surface`. Les juger ensemble coûte le
   * même balayage et évite qu'un déplacement ne casse la promesse en silence.
   */
  const laiton = ajusterJusquaAA(
    LAITON,
    [brand.palette.ground, brand.palette.surface],
    WCAG_AA,
  ).couleur;

  return (
    <footer className="mx-auto mt-9 flex max-w-[720px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4">
      <span className="text-[11px] leading-none text-mut">Carte propulsée par</span>
      <LogoLockup
        size={22}
        className="text-mut"
        style={{ ["--sm-logo-accent" as string]: laiton }}
      />
    </footer>
  );
}
