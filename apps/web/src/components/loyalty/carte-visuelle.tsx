"use client";

import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { Card, Icon, TuileDeLogo, Verrou } from "@/components/ui";
import { cx } from "@/lib/cx";
import { chiffre, unitePour, type Recompense } from "./paliers";
import { SceauRecompense } from "./MatiereCarte";
import styles from "./carte-visuelle.module.css";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LES PIÈCES VISIBLES DE LA CARTE — partagées entre le produit et la démo
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `LoyaltyCardApp` (la vraie carte, alimentée par le réseau) et
 * `DemoLoyaltyCard` (l'aperçu de la matrice de captures, données fictives)
 * rendaient DEUX compositions écrites à la main. Elles avaient déjà divergé :
 * pastilles de 44 px d'un côté, 40 de l'autre, hiérarchies différentes, et
 * l'aperçu que voit un prospect ne montrait pas le produit qu'on lui livre.
 *
 * Les pièces vivent donc ici, une fois. La démo n'est plus une maquette qui
 * ressemble à la carte : c'est la carte, avec d'autres chiffres — ce qui rend
 * aussi la matrice de captures (`scripts/capture-masque.mjs`) enfin probante
 * sur les six directions.
 *
 * ═══ LE RYTHME VERTICAL — UNE ÉCHELLE, PAS SIX VALEURS ═══
 *
 * Six écarts sans multiple commun cohabitaient (mt-1, mt-2, mt-3, mt-5, mt-7,
 * mt-8), et le plus grand ne séparait pas les groupes de sens. L'échelle
 * retenue est celle de la DA §5, en quatre crans seulement :
 *
 *   8 px  (mt-2)  — deux lignes qui se lisent ensemble (un chiffre, son unité)
 *   12 px (mt-3)  — deux blocs d'un même objet
 *   24 px (mt-6)  — deux objets d'une même section
 *   40 px (mt-10) — DEUX SECTIONS, et rien d'autre ne vaut 40
 *
 * ═══ UN SEUL GABARIT DE PASTILLE ═══
 *
 * Trois listes voisines portaient trois tailles (40, 44, 36 px). Ce sont des
 * pastilles DÉCORATIVES — aucune n'est cliquable, la cible de 44 px ne les
 * concerne donc pas — et rien ne justifiait qu'elles diffèrent d'une liste à
 * l'autre. Elles valent 40 px partout : assez pour porter une icône de 19,
 * assez discrètes pour qu'une liste de vingt lignes ne devienne pas un mur.
 */
const PASTILLE = "grid size-10 shrink-0 place-items-center rounded-card";

// ─────────────────────────────────────────────────────────────
// En-tête
// ─────────────────────────────────────────────────────────────

/**
 * L'en-tête de l'application — sans chevron de retour.
 *
 * Il en portait un, en PREMIÈRE position de lecture, sans libellé et sans
 * retour tactile : le premier élément de la carte de fidélité d'un restaurant
 * était une flèche vers l'arrière. Le lien vers la vitrine n'a pas disparu, il
 * a changé de nature et de place — il est devenu « Commander », dans la carte,
 * juste sous la phrase qui donne envie de commander (voir `SoldeCarte`).
 *
 * L'en-tête n'a donc plus qu'un rôle : dire chez QUI on est.
 */
export function EnTeteFidelite({
  nom,
  programme,
  logoUrl,
  verrouUrl = null,
  aside,
}: {
  nom: string;
  programme: string;
  logoUrl: string | null;
  /**
   * Le VERROU du masque — « logo avec le nom ». Posé, il REMPLACE la tuile et
   * le nom écrit ; absent (le cas de presque tout le monde), rien ne change.
   */
  verrouUrl?: string | null;
  /** Pastille de démonstration, bouton d'installation… selon l'appelant. */
  aside?: ReactNode;
}) {
  /* Le nom du programme — sous le nom écrit comme sous le verrou. */
  const sousTitre = (
    <p className="font-display truncate text-xs text-mut">{programme}</p>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-ink/8 bg-bg px-4 py-3">
      <div className="mx-auto flex max-w-[1080px] items-center gap-3">
        {/*
          La tuile et le verrou viennent de `components/ui/identite`, comme sur
          la vitrine : c'est le MÊME fichier de logo, il n'a aucune raison
          d'être peint deux fois — et il l'était, avec quatre écarts : 40 px
          contre 44, rayon en jeton contre rayon calculé, aucun filet contre un
          filet, `alt=""` contre `alt={nom}`. Le logo n'y est plus recadré, et
          le vide que `contain` laisse est traité par la tuile elle-même.

          40 px : la hauteur de la tuile que le verrou remplace. L'en-tête
          grandit alors d'une ligne, celle du programme, qui passe dessous.
        */}
        <Verrou
          src={verrouUrl}
          nom={nom}
          hauteur={40}
          sous={sousTitre}
          replier={
            <>
              <TuileDeLogo nom={nom} logoUrl={logoUrl} taille={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-ink">{nom}</p>
                {sousTitre}
              </div>
            </>
          }
        />
        {aside}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// La carte de solde — le seul chiffre de la page
// ─────────────────────────────────────────────────────────────

export function SoldeCarte({
  alias,
  soldeAffiche,
  soldeReel,
  uniteSingulier,
  unitePluriel,
  palier,
  progression,
  phrase,
  fete,
  titreRef,
  action,
  secondaire,
  pied,
}: {
  alias: string;
  /** La valeur EN COURS de montée — c'est elle qu'on voit. */
  soldeAffiche: number;
  /** La valeur vraie — c'est elle qu'annonce l'ARIA, quoi qu'affiche l'œil. */
  soldeReel: number;
  uniteSingulier: string;
  unitePluriel: string;
  palier: Recompense | null;
  /** 0 à 100, calculé sur le solde AFFICHÉ : la jauge monte avec le chiffre. */
  progression: number;
  phrase: string;
  /** Un palier vient d'être franchi : l'onde part du solde. */
  fete: boolean;
  titreRef?: Ref<HTMLHeadingElement>;
  /** Le geste principal — « Commander ». */
  action: ReactNode;
  /** Le geste de comptoir — « Présenter ma carte ». */
  secondaire?: ReactNode;
  /** Fraîcheur et entretien de la carte (actualiser, retirer). */
  pied?: ReactNode;
}) {
  return (
    /*
      L'ARRIVÉE, ENFIN JOUÉE. Le squelette disparaissait et la carte
      apparaissait au MÊME tick : rien ne reliait les deux écrans. L'animation
      se joue au montage — donc une fois, à l'arrivée — et pas à chaque
      actualisation, puisque la section reste montée entre-temps.
    */
    <section className={cx(styles.balance, "relative animate-carte overflow-hidden rounded-wide border border-ink/8 p-5 motion-reduce:animate-none sm:p-7")}>
      {/*
        L'ÉTIQUETTE DU CHIFFRE PORTE LE PRÉNOM — et c'est ce qui remet le solde
        en tête de lecture.

        L'ordre était : pastille « Carte active », titre « Bonjour X », icône
        cadeau, PUIS l'étiquette et le nombre. Le seul chiffre de la page
        arrivait cinquième. Fusionner l'accueil et l'étiquette rend au solde la
        première position sans perdre le « bonjour » — et l'état de la carte
        redescend au pied, avec la fraîcheur, là où un état se lit.
      */}
      <p className="relative text-[13px] font-semibold text-mut">
        Solde de {alias}
      </p>

      <div className="relative mt-2">
        {fete && (
          /* L'onde du palier franchi part du chiffre lui-même. Décorative,
             donc hors de l'arbre d'accessibilité et hors du flux des clics. */
          <span
            aria-hidden
            className="pointer-events-none absolute left-[18%] top-1/2 size-32 -translate-x-1/2 -translate-y-1/2 animate-eclat rounded-full bg-accentwash motion-reduce:animate-none"
          />
        )}
        <h1
          ref={titreRef}
          tabIndex={-1}
          className="font-display relative rounded-xs text-[clamp(3.5rem,3rem+2vw,4.5rem)] font-bold leading-none tracking-[-0.045em] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
        >
          {/*
            LE LECTEUR D'ÉCRAN ENTEND LA VRAIE VALEUR, PAS LE COMPTEUR.

            Le nombre visible traverse une trentaine d'états pendant sa montée.
            Le rendre au clavier tel quel ferait annoncer un chiffre pris au
            hasard dans la course. Le texte accessible est donc figé sur le
            solde réel, et le compteur — purement visuel — est masqué.
          */}
          <span className="sr-only">
            Solde&nbsp;: {chiffre(soldeReel)}{" "}
            {unitePour(soldeReel, uniteSingulier, unitePluriel)}
          </span>
          <span className="cf-fig" aria-hidden>
            {chiffre(soldeAffiche)}
          </span>
        </h1>
        <p className="relative mt-2 text-sm font-bold text-accentink" aria-hidden>
          {unitePour(soldeReel, uniteSingulier, unitePluriel)}
        </p>
      </div>

      <div className="relative mt-6">
        {/* Une jauge est un COMPOSANT, pas une décoration : sans
            `role`/`aria-value*`, un lecteur d'écran ne rendait qu'une div vide
            et la progression n'existait que pour l'œil. Les bornes sont les
            unités réelles, pas le pourcentage affiché : « 24 sur 30 » se lit,
            « 80 » ne dit rien.

            La piste est `bg-gaugetrack`, garantie 3:1 contre l'ACCENT qui la
            remplit — ce qu'on doit voir d'une jauge, c'est où le remplissage
            s'arrête. À `bg-ink/10` le couple tombait à 2,38:1 sur Soleil.

            AUCUNE TRANSITION CSS ICI, et c'est délibéré : le remplissage suit
            le solde AFFICHÉ, donc il est déjà animé, image par image, par la
            même montée que le chiffre. Une transition par-dessus traînerait
            derrière le compteur de toute la durée « fête ». Un seul mouvement,
            deux représentations. */}
        <div
          className="h-2.5 overflow-hidden rounded-pill bg-gaugetrack"
          role="progressbar"
          aria-label={
            palier
              ? `Progression vers « ${palier.name} »`
              : "Progression vers le prochain palier"
          }
          aria-valuemin={0}
          aria-valuemax={palier ? palier.costUnits : soldeReel}
          aria-valuenow={soldeReel}
          aria-valuetext={
            palier
              ? `${chiffre(soldeReel)} sur ${chiffre(palier.costUnits)} ${unitePluriel}`
              : "Tous les paliers publiés sont atteints"
          }
        >
          <div
            className="h-full rounded-pill bg-accent"
            style={{ transform: `scaleX(${progression / 100})`, transformOrigin: "left" }}
          />
        </div>
        <p className="mt-3 text-[13px] leading-5 text-mut">{phrase}</p>
      </div>

      {/*
        LE GESTE PRINCIPAL EST ICI, ET PAS AILLEURS.

        C'est la place que la phrase du dessus commande : quelqu'un qui vient
        de lire « encore 6 points pour un menu offert » a une seule chose à
        faire de cette information. Le bouton était en haut de page, sous la
        forme d'un chevron de retour sans libellé.
      */}
      <div className="relative mt-6 flex flex-col gap-3">
        {action}
        {secondaire}
      </div>

      {pied && (
        <div className="relative mt-6 border-t border-line2 pt-4">{pied}</div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Récompenses
// ─────────────────────────────────────────────────────────────

/**
 * UNE RÉCOMPENSE ACQUISE PORTE L'ACCENT DU RESTAURANT, PAS LE VERT SYSTÈME.
 *
 * « Palier atteint » était peint en vert sémantique. Sur la direction
 * « marché », dont l'accent EST un vert, la couleur de marque et la couleur
 * « acquis » étaient rigoureusement la même : impossible de savoir si le vert
 * d'une pastille voulait dire « c'est le restaurant » ou « c'est gagné ».
 *
 * Le vert fonctionnel dit « prêt / positif » à l'échelle du SERVICE — une
 * commande prête, un poste ouvert. Une récompense débloquée n'est pas un état
 * de service : c'est un objet qui appartient désormais au client, et ce qui le
 * dit, c'est la marque du restaurant. L'aplat d'accent est réservé aux
 * récompenses ACQUISES — quelques-unes au plus — ce qui le laisse
 * parcimonieux (DA §3) tout en levant l'ambiguïté sur les six directions.
 */
export function TuileRecompense({
  nom,
  detail,
  cout,
  uniteSingulier,
  unitePluriel,
  acquise,
  fete = false,
}: {
  nom: string;
  detail: string;
  cout: number;
  uniteSingulier: string;
  unitePluriel: string;
  acquise: boolean;
  /** Cette récompense vient d'être débloquée : elle respire une fois. */
  fete?: boolean;
}) {
  return (
    <Card
      className={cx(
        styles.reward,
        "p-4",
        acquise && "border-accent/30",
        fete && "animate-fete motion-reduce:animate-none",
      )}
    >
      <div className="flex items-start gap-3">
        {/*
          LE SCEAU N'APPARAÎT QU'UNE FOIS LA RÉCOMPENSE ACQUISE, ET C'EST VOULU.

          C'est un dessin — un anneau perforé, le bord d'un ticket qu'on
          détache — là où le reste de la liste porte une pastille de 40 px.
          L'employer partout ferait de chaque ligne un objet précieux, donc
          plus aucune : ce qui distingue « c'est à vous » disparaîtrait.

          Il est plus haut que la pastille, et cela fait grandir la ligne
          acquise. C'est l'effet cherché : au milieu d'une liste calme, c'est
          celle-là qu'on doit voir.
        */}
        {acquise ? (
          <SceauRecompense />
        ) : (
          <span className={cx(PASTILLE, "bg-ink/6 text-mut")}>
            <Icon name="gift" size={19} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <p className="text-sm font-extrabold text-ink">{nom}</p>
            {acquise && (
              <span className="shrink-0 rounded-pill border-[1.5px] border-accent/30 bg-accentwash px-[9px] py-[3px] text-[11px] font-semibold text-accentink">
                Acquise
              </span>
            )}
          </div>
          {/* Pas d'`opacity` sur un palier non atteint : elle rabattait
              `text-mut` — déjà AU plancher AA — à 2,6:1, et le coût du palier
              est justement l'information principale. Le cadeau, la bordure
              neutre et le coût suffisent à dire « pas encore ». */}
          <p className="mt-2 text-xs leading-5 text-mut">{detail}</p>
          <p className="cf-fig mt-3 text-sm font-black text-accentink">
            {chiffre(cout)} {unitePour(cout, uniteSingulier, unitePluriel)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** L'intitulé d'une section — un seul gabarit pour les quatre de la page. */
export function TitreSection({
  sur,
  children,
  note,
}: {
  sur: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="mb-3">
      <p className="text-[13px] font-semibold text-accentink">
        {sur}
      </p>
      <h2 className="font-display mt-2 text-xl font-bold tracking-[-0.025em] text-ink">
        {children}
      </h2>
      {note && <p className="mt-3 text-xs leading-5 text-mut">{note}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Squelette
// ─────────────────────────────────────────────────────────────

/**
 * LE SQUELETTE DOIT AVOIR LA SILHOUETTE DE CE QU'IL ANNONCE.
 *
 * L'ancien posait un rectangle de 320 px puis deux tuiles : ni l'étiquette, ni
 * le chiffre, ni la jauge, ni les deux boutons n'y étaient — la page changeait
 * donc entièrement de forme à l'arrivée des données. Un squelette qui ment sur
 * la mise en page fait pire que pas de squelette : il promet un écran, en
 * livre un autre.
 *
 * Le battement vient de `--sm-t-slow` (`animate-battement`) et non des 2 s
 * fixes d'`animate-pulse` : le squelette d'un fast-food « vif » respire
 * désormais au rythme de son masque, comme tout le reste de sa surface.
 */
function Os({ className }: { className?: string }) {
  return <div aria-hidden className={cx("rounded-card bg-ink/6", className)} />;
}

export function SqueletteCarte() {
  return (
    <div
      className="animate-battement motion-reduce:animate-none"
      aria-hidden
      data-squelette="carte"
    >
      <section className={cx(styles.balance, "rounded-wide border border-ink/8 p-5 sm:p-7")}>
        <Os className="h-3 w-28" />
        <Os className="mt-2 h-12 w-40" />
        <Os className="mt-2 h-4 w-24" />
        <Os className="mt-6 h-2.5 w-full rounded-pill" />
        <Os className="mt-3 h-3.5 w-3/4" />
        <Os className="mt-6 h-[52px] w-full rounded-pill" />
        <Os className="mt-3 h-[52px] w-full rounded-pill" />
      </section>
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Os className="h-[104px]" />
        <Os className="h-[104px]" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Le geste principal, dessiné une fois
// ─────────────────────────────────────────────────────────────

/**
 * « Commander » — un LIEN, pas un bouton.
 *
 * C'est une navigation vers la vitrine du restaurant : elle doit s'ouvrir dans
 * un nouvel onglet au clic du milieu, se copier, se partager. Un `<button>`
 * avec un `router.push()` retirerait les trois.
 *
 * 52 px de haut, comme l'appel à l'action de la vitrine (`Storefront`) : les
 * deux surfaces se répondent, et c'est bien au-dessus des 44 px exigés.
 */
export function ActionCommander({
  href,
  nomRestaurant,
}: {
  href: string;
  nomRestaurant: string;
}) {
  return (
    <Link
      href={href}
      className="cf-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-pill bg-accent px-6 py-3 text-center text-[15px] font-semibold text-onaccent"
    >
      Commander chez {nomRestaurant}
      <Icon name="arrow" size={17} stroke={2.6} />
    </Link>
  );
}
