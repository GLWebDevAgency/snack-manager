"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'IDENTITÉ VISIBLE DU RESTAURANT — sa tuile, et son verrou
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux pièces, écrites UNE fois pour les trois surfaces qui montrent le logo
 * d'un restaurant : la vitrine (`order/primitives` → `BrandMark`), l'en-tête
 * de la carte de fidélité (`loyalty/carte-visuelle`) et les aperçus du
 * back-office. Elles vivaient en double et avaient déjà divergé sur quatre
 * points — 44 px contre 40, rayon calculé contre jeton, filet contre rien,
 * `alt={nom}` contre `alt=""` — pour le MÊME fichier.
 *
 * Elles vivent dans `components/ui` et non dans `components/order` : la carte
 * de fidélité n'importe rien de la vitrine, et `order/primitives` tire
 * `order.css` avec lui. Ce fichier ne dépend que des jetons du masque.
 *
 * ─── UN LOGO NE SE RECADRE PAS ─────────────────────────────────────────────
 *
 * Les deux surfaces peignaient `object-cover` dans une boîte carrée : un logo
 * plus large que haut — un pictogramme de burger, une signature — y perdait
 * son haut et son bas, et un logo qui porte sa propre marge perdait la marge
 * PUIS du dessin. La règle inverse est pourtant déjà écrite dans le dépôt, sur
 * la rangée d'images de l'éditeur d'identité : « `contain` : un logo recadré
 * n'est plus un logo ». Elle vaut partout, et c'est ici qu'elle est tenue.
 *
 * ─── LE VIDE QUE `contain` LAISSE, ET COMMENT IL EST TRAITÉ ────────────────
 *
 * Ajusté, un logo non carré ne remplit plus sa tuile. Sans rien d'autre, la
 * tuile aurait l'air TROUÉE — on aurait échangé un défaut contre un autre.
 * La rangée de l'éditeur avait déjà résolu ce cas de la seule façon qui tienne
 * sur six directions : la tuile est PEINTE — un fond, un filet, un rayon — et
 * le logo respire dedans. Le vide n'est alors plus un trou, c'est la marge
 * d'un réceptacle.
 *
 * Le fond est `surface2`, la surface d'ÉLÉVATION du masque (« l'élément » du
 * résolveur) : le rôle exact d'un réceptacle posé sur la page, et un jeton —
 * donc les six directions suivent sans qu'une seule couleur soit écrite ici.
 *
 * ─── LE RAYON SUIT LA FORME, IL NE SE CALCULE PLUS ─────────────────────────
 *
 * `BrandMark` posait `borderRadius: 28 % du côté` — 12 px à 44 px, quel que
 * soit `brand.shape`, alors que `--cf-r-md` vaut 2, 10 ou 18 selon que le
 * restaurateur a choisi « net », « doux » ou « rond ». La tuile était le seul
 * objet de la page à ignorer ce choix. `rounded-card` le lui rend.
 */

import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { initial } from "@/components/order/helpers";

/**
 * Marge intérieure du logo dans sa tuile — la même respiration que le plateau
 * d'un plat (`Plate`, `p-[7%]`), et pour la même raison : un visuel détouré
 * collé au filet a l'air d'y être coincé. En pourcentage, donc juste aux trois
 * tailles (44, 40, 34 px) sans table de valeurs à tenir.
 */
const RESPIRATION = "p-[7%]";

/**
 * La tuile de marque : le logo du restaurant ajusté sur un réceptacle, ou son
 * initiale sur l'accent quand il n'a rien posé.
 *
 * DÉCORATIVE, et c'est délibéré : `aria-hidden` + `alt=""`. Le nom du
 * restaurant est TOUJOURS écrit à côté (le `h1` de la vitrine, le `p` de la
 * carte de fidélité). L'annoncer deux fois est le défaut que le bandeau
 * d'accueil a déjà fermé — même geste ici.
 */
export function TuileDeLogo({
  nom,
  logoUrl,
  taille = 40,
  className,
}: {
  nom: string;
  logoUrl: string | null;
  /** Côté en pixels : 44 sur la vitrine, 40 dans la carte, 34 en embarqué. */
  taille?: number;
  className?: string;
}) {
  /*
   * L'état porte l'URL qu'il juge — même motif que `Plate` : un logo mort ne
   * doit pas condamner le suivant quand la même tuile change de restaurant
   * (l'aperçu du back-office se repeint à chaque frappe).
   */
  const [etat, setEtat] = useState({ url: logoUrl, casse: false });
  if (etat.url !== logoUrl) setEtat({ url: logoUrl, casse: false });
  const echec = () => setEtat({ url: logoUrl, casse: true });
  const montre = logoUrl !== null && logoUrl !== "" && !etat.casse;

  return (
    <span
      aria-hidden
      style={{ width: taille, height: taille, fontSize: Math.round(taille * 0.46) }}
      className={cx(
        "grid shrink-0 place-items-center overflow-hidden rounded-card",
        montre
          ? "border border-ink/10 bg-surface2"
          : "bg-accent font-extrabold leading-none tracking-[-0.02em] text-onaccent",
        className,
      )}
    >
      {montre ? (
        // Logo tenant : URL hors domaine maîtrisé — <img> volontaire,
        // `next/image` imposerait une liste blanche de domaines.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          decoding="async"
          onError={echec}
          /* La page est rendue côté serveur : une image morte a déjà échoué
             quand React s'attache, et `onError` ne se déclenchera JAMAIS. On
             relit donc l'état réel du nœud au montage — sans quoi le
             navigateur laisse son icône d'image cassée en tête de l'en-tête,
             et le repli à l'initiale n'arrive jamais. Même garde que `Plate`
             et que le bandeau d'accueil. */
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) echec();
          }}
          className={cx("size-full object-contain", RESPIRATION)}
        />
      ) : (
        initial(nom)
      )}
    </span>
  );
}

/**
 * ═══ LE VERROU — le logo qui porte DÉJÀ le nom ═══
 *
 * `brand.logo.lockup` (« Logo avec le nom » dans l'éditeur) est un bloc :
 * pictogramme et nom composés par le graphiste du restaurant. Quand il est
 * posé, recomposer une tuile PLUS un nom en police du produit défait le
 * travail — l'en-tête l'emploie donc tel quel.
 *
 * ─── LE NOM RESTE LU ───────────────────────────────────────────────────────
 *
 * Le nom est DANS l'image : il doit rester dans l'arbre d'accessibilité. Le
 * verrou est donc l'inverse exact de la tuile — `alt={nom}`, jamais vide — et
 * il est posé DANS l'élément qui portait le nom écrit (`h1` sur la vitrine,
 * `p` dans la carte). Un lecteur d'écran annonce « titre niveau 1, Le
 * Comptoir » comme avant ; l'œil voit le verrou.
 *
 * ─── UNE HAUTEUR MAÎTRISÉE, UN ALIGNEMENT À GAUCHE ─────────────────────────
 *
 * Un verrou est un bloc, pas une vignette : il prend la HAUTEUR de la tuile
 * qu'il remplace et la largeur que son dessin demande (`w-auto`), jamais
 * l'inverse. `max-w-full` le borne à la colonne ; comme la boîte reste en
 * `object-contain`, un verrou très allongé rétrécit au lieu d'être coupé ou
 * étiré. `object-left` le cale à gauche : le vide d'un verrou plus court que
 * sa boîte se pose à droite, là où il ne décale rien.
 *
 * L'en-tête grandit alors d'une ligne — celle du sous-titre, qui passe SOUS le
 * verrou au lieu d'être à côté de la tuile. C'est assumé : c'est ce qui garde
 * la ville et le nom du programme lisibles sous un verrou large.
 *
 * ─── ET S'IL EST MORT ──────────────────────────────────────────────────────
 *
 * Un verrou remplace le nom écrit : son fichier introuvable laisserait un
 * en-tête SANS nom, orné d'une icône d'image cassée. `replier` est donc ce que
 * l'appelant rendait sans verrou — tuile et nom — et c'est ce qui revient dès
 * que l'image échoue.
 */
export function Verrou({
  src,
  nom,
  hauteur,
  balise: Balise = "p",
  sous,
  replier,
}: {
  /** `null` quand le restaurateur n'a posé aucun verrou : rien ne change. */
  src: string | null;
  nom: string;
  /** Hauteur du bloc, en pixels — celle de la tuile qu'il remplace. */
  hauteur: number;
  /** L'élément qui PORTE le nom : `h1` sur la vitrine, `p` ailleurs. */
  balise?: "h1" | "p";
  /** La ligne sous l'identité : la ville, le nom du programme. */
  sous: ReactNode;
  /** Sans verrou — ou s'il est mort : la tuile et le nom écrit, inchangés. */
  replier: ReactNode;
}) {
  const [etat, setEtat] = useState({ url: src, casse: false });
  if (etat.url !== src) setEtat({ url: src, casse: false });
  const echec = () => setEtat({ url: src, casse: true });

  if (src === null || src === "" || etat.casse) return <>{replier}</>;

  return (
    <div className="min-w-0 flex-1">
      <Balise className="min-w-0">
        {/* Logo tenant : URL hors domaine maîtrisé — <img> volontaire. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={nom}
          decoding="async"
          onError={echec}
          /* Même garde qu'ailleurs : rendu côté serveur, `onError` a déjà eu
             lieu quand React s'attache. Sans cette relecture, un verrou mort
             laisserait un en-tête sans nom visible. */
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) echec();
          }}
          style={{ height: hauteur }}
          className="block w-auto max-w-full object-contain object-left"
        />
      </Balise>
      {sous}
    </div>
  );
}
