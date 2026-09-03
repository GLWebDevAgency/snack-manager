"use client";

import { useMemo } from "react";
import { logoPour, type Brand } from "@sm/contracts";
import { dessinerIconeCarte } from "@/components/loyalty/icone-carte";
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
 * Elle vient de `dessinerIconeCarte`, LA MÊME fonction que la route
 * `icon.svg` sert au manifeste. Recopier le dessin à la main aurait produit
 * deux vérités qui divergeraient au premier changement : l'aperçu montrerait
 * une icône que le téléphone n'affiche pas. C'est le seul défaut que cet
 * aperçu n'a pas le droit d'avoir.
 *
 * La fonction est PURE — elle ne lit que le masque et rend une chaîne SVG de
 * formes, sans une lettre depuis qu'elle a cessé de dépendre d'une police.
 * Aucun texte du restaurateur n'y entre : `dangerouslySetInnerHTML` n'a donc
 * ici aucune surface d'injection, et les couleurs sont des hexadécimaux déjà
 * validés par le contrat.
 *
 * ─── LA DÉCOUPE EST APPLIQUÉE À LA BONNE VARIANTE ───
 *
 * `masquable` sous un cercle, `plein` dans un carré arrondi. Inverser les deux
 * serait montrer une icône rognée là où elle ne l'est pas, et intacte là où
 * elle le sera.
 */

/** Le cercle est la découpe la plus agressive qu'un lanceur applique. */
function PastilleLanceur({ svg, taille }: { svg: string; taille: number }) {
  return (
    <div
      className="overflow-hidden rounded-full"
      style={{ width: taille, height: taille }}
      // Voir l'en-tête : SVG de formes, sans texte, couleurs déjà validées.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function TuilePleine({ svg, taille }: { svg: string; taille: number }) {
  return (
    <div
      className="overflow-hidden rounded-card"
      style={{ width: taille, height: taille }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ApercuInstalle({ brand, nom }: { brand: Brand; nom: string }) {
  // Deux dessins, deux rôles — mémorisés parce que cet aperçu se repeint à
  // chaque frappe dans un champ de couleur, comme celui de la vitrine.
  const masquable = useMemo(() => dessinerIconeCarte(brand, "masquable"), [brand]);
  const plein = useMemo(() => dessinerIconeCarte(brand, "plein"), [brand]);
  const logo = logoPour(brand, "mark");
  const court = nomCourt(nom);
  const coupe = nomTronque(nom);

  return (
    <div className="rounded-panel border border-line2 bg-surface p-4">
      <div className="text-[13px] font-bold text-ink">Sur le téléphone de vos clients</div>
      <p className="mt-1 text-[12px] leading-snug text-mut">{phraseDuLanceur(brand)}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {/* ── L'écran d'accueil : le rôle masquable, donc notre dessin ── */}
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
