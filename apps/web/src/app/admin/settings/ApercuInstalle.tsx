"use client";

import { useMemo } from "react";
import { logoPour, type Brand } from "@sm/contracts";
import { dessinerIconeCarte, dessinerIconeLogo } from "@/components/loyalty/icone-carte";
import { nomCourt, nomTronque, phraseDuLanceur, sourceDe } from "./surfaces-installees";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'APERÇU DES SURFACES INSTALLÉES — ET LE SEUL DÉFAUT INACCEPTABLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le fondateur voulait voir, en déposant son logo, « comment il apparaîtra
 * dans les onglets pour Google Chrome, comme lanceur d'application pour la
 * carte fidélité ». Cet aperçu répond à cela.
 *
 * ─── L'ICÔNE N'EST PAS REDESSINÉE ICI ───
 *
 * Elle vient de `dessinerIconeCarte` et de `dessinerIconeLogo`, LES MÊMES
 * fonctions que la route `icon.svg` sert au manifeste. Recopier le dessin à la
 * main aurait produit deux vérités qui divergeraient au premier changement :
 * l'aperçu montrerait une icône que le téléphone n'affiche pas. C'est le seul
 * défaut que cet aperçu n'a pas le droit d'avoir.
 *
 * ─── CE QUI ENTRE DANS `dangerouslySetInnerHTML`, ET CE QUI N'Y ENTRE PAS ───
 *
 * `dessinerIconeCarte` est PURE et entièrement numérique : elle ne lit que le
 * masque et rend des formes, sans une lettre depuis qu'elle a cessé de dépendre
 * d'une police. Aucun texte du restaurateur n'y entre, et les couleurs sont des
 * hexadécimaux déjà validés par le contrat.
 *
 * `dessinerIconeLogo` ajoute UNE valeur qui vient du restaurateur : l'adresse
 * de son logo, dans un attribut `href`. Elle est bornée à la source — une
 * adresse `data:` d'image raster ou une URL http(s), rien d'autre —, puis
 * échappée en XML, et la fonction rend `null` si l'adresse ne passe pas. C'est
 * la même garde des deux côtés : ici et dans la route.
 *
 * ─── POURQUOI L'APERÇU N'INCORPORE PAS LES OCTETS, LUI ───
 *
 * La route encode le logo en `data:` parce qu'un SVG servi COMME IMAGE ne
 * charge aucune ressource externe. Ici, le balisage est injecté DANS le
 * document : le `<image href="https://…">` s'y charge comme n'importe quelle
 * image, et le rendu est le même à l'écran. Faire télécharger et encoder le
 * fichier dans le navigateur à chaque frappe dans un champ de couleur aurait
 * coûté beaucoup pour un pixel identique.
 *
 * Ce que l'aperçu ne peut donc PAS montrer : le repli. Un logo trop lourd pour
 * le plafond de la route, ou servi depuis un hôte hors liste, s'affiche ici et
 * pas sur le téléphone. C'est la phrase du lanceur qui porte cette réserve —
 * elle ne promet pas sans condition.
 *
 * ─── LA DÉCOUPE EST APPLIQUÉE À LA BONNE VARIANTE ───
 *
 * `masquable` sous un cercle, `plein` dans un carré arrondi. Inverser les deux
 * serait montrer une icône rognée là où elle ne l'est pas, et intacte là où
 * elle le sera.
 */

/** Le cercle est la découpe la plus agressive qu'un lanceur applique. */
/*
 * LE SVG DOIT ÊTRE CONTRAINT À SA BOÎTE, ET RIEN NE LE FAIT TOUT SEUL.
 *
 * `dessinerIconeCarte` rend un SVG portant `width="512" height="512"` EN
 * ATTRIBUTS. La préflight de Tailwind ne pose `max-width: 100%` que sur
 * `img` et `video` — jamais sur `svg`. Sans contrainte, le dessin s'affichait
 * donc à 512 px dans une boîte de 56, et `overflow-hidden` en montrait le coin
 * supérieur gauche : 1,2 % de la surface.
 *
 * Le logo composé étant posé au centre, dans la zone sûre, il tombait
 * ENTIÈREMENT hors du champ visible. Le restaurateur voyait un aplat uni là où
 * on lui promettait son logo — précisément la vignette pour laquelle tout ce
 * lot existe.
 */
const SVG_DANS_SA_BOITE = "[&>svg]:size-full [&>svg]:block";

function PastilleLanceur({ svg, taille }: { svg: string; taille: number }) {
  return (
    <div
      className={`overflow-hidden rounded-full ${SVG_DANS_SA_BOITE}`}
      style={{ width: taille, height: taille }}
      // Voir l'en-tête : formes et couleurs validées, plus l'unique `href` du
      // logo, borné et échappé par `dessinerIconeLogo`.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function TuilePleine({ svg, taille }: { svg: string; taille: number }) {
  return (
    <div
      className={`overflow-hidden rounded-card ${SVG_DANS_SA_BOITE}`}
      style={{ width: taille, height: taille }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ApercuInstalle({ brand, nom }: { brand: Brand; nom: string }) {
  const logo = logoPour(brand, "mark");
  /*
   * Deux dessins, deux rôles — mémorisés parce que cet aperçu se repeint à
   * chaque frappe dans un champ de couleur, comme celui de la vitrine.
   *
   * Le rôle masquable suit EXACTEMENT l'arbitrage de la route : le logo composé
   * s'il y en a un et que son adresse passe la garde, notre dessin sinon.
   */
  const masquable = useMemo(
    () => (logo ? dessinerIconeLogo(brand, logo) : null) ?? dessinerIconeCarte(brand, "masquable"),
    [brand, logo],
  );
  const plein = useMemo(() => dessinerIconeCarte(brand, "plein"), [brand]);
  const court = nomCourt(nom);
  const coupe = nomTronque(nom);

  return (
    <div className="rounded-panel border border-line2 bg-surface p-4">
      <div className="text-[13px] font-bold text-ink">Sur le téléphone de vos clients</div>
      <p className="mt-1 text-[12px] leading-snug text-mut">{phraseDuLanceur(brand)}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {/* ── L'écran d'accueil : le rôle masquable, composé avec le logo ── */}
        <figure className="m-0 flex flex-col items-center gap-2">
          <PastilleLanceur svg={masquable} taille={56} />
          <figcaption className="text-center text-[10px] leading-tight text-mut">
            <span className="block max-w-[76px] truncate font-bold text-ink">{court}</span>
            Écran d’accueil
          </figcaption>
        </figure>

        {/* ── L'onglet et la liste d'applications : le rôle « any » ── */}
        <figure className="m-0 flex flex-col items-center gap-2">
          {sourceDe(brand, "onglet") === "logo" && logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- image servie par notre API : next/image n'a rien à y optimiser.
            <img
              src={logo}
              alt=""
              className="size-14 rounded-card object-contain"
              style={{ background: brand.palette.surface }}
            />
          ) : (
            <TuilePleine svg={plein} taille={56} />
          )}
          <figcaption className="text-center text-[10px] leading-tight text-mut">
            <span className="block font-bold text-ink">
              {sourceDe(brand, "onglet") === "logo" ? "Votre logo" : "Notre dessin"}
            </span>
            Onglet du navigateur
          </figcaption>
        </figure>

        {/* ── L'écran de chargement : fond du masque + icône « any » ── */}
        <figure className="m-0 flex flex-col items-center gap-2">
          <div
            className="grid size-14 place-items-center rounded-card border border-line2"
            style={{ background: brand.palette.ground }}
          >
            {sourceDe(brand, "chargement") === "logo" && logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- même raison qu’au-dessus.
              <img src={logo} alt="" className="size-8 object-contain" />
            ) : (
              <TuilePleine svg={plein} taille={32} />
            )}
          </div>
          <figcaption className="text-center text-[10px] leading-tight text-mut">
            <span className="block font-bold text-ink">Fond de l’identité</span>
            À l’ouverture
          </figcaption>
        </figure>
      </div>

      {coupe && (
        <p className="mt-3 text-[11px] leading-snug text-mut">
          Sous l’icône, le nom est coupé à 30 caractères : «&nbsp;{court}&nbsp;». C’est la limite du
          système, pas la nôtre.
        </p>
      )}

      {/*
        LA PHRASE QUI ÉVITE UNE MAUVAISE SURPRISE.

        Android capture l'icône, le fond de chargement et la couleur de la barre
        système À L'INSTALLATION, puis ne les relit plus. Le fondateur l'a
        constaté avant nous : sa carte installée affichait encore l'ancien
        accent doré alors que le manifeste servait déjà le nouveau. On ne le
        cache pas derrière une formule vague, et on ne promet pas une mise à
        jour que la plateforme ne permet pas.
      */}
      <p className="mt-3 rounded-card border border-line2 bg-ink/[0.03] px-3 py-2 text-[11px] leading-snug text-mut">
        Une carte <strong className="font-bold text-ink">déjà installée</strong> garde l’apparence
        qu’elle avait ce jour-là : le téléphone la retient à l’installation. Pour voir un changement
        d’identité sur l’écran d’accueil, il faut retirer la carte puis la réinstaller.
      </p>
    </div>
  );
}
