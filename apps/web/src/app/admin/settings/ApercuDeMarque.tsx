"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'APERÇU — la vitrine du restaurateur, peinte avec le masque en cours
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ─── IL NE DESSINE RIEN LUI-MÊME ───────────────────────────────────────────
 *
 * Un aperçu qui ment est pire que pas d'aperçu. Tout ce qui est peint ici
 * vient des PRIMITIVES de la surface client (`components/order/primitives`) :
 * la tuile de marque, le plateau d'un plat, la pastille de prix, l'en-tête de
 * section à double filet, le bouton du tunnel. Ce sont les composants que le
 * mangeur voit vraiment, avec leur CSS (`order.css`, importé par le module) —
 * un fac-similé écrit ici aurait divergé au premier ajustement de la vitrine,
 * et le restaurateur aurait choisi ses couleurs sur une maquette.
 *
 * ─── POURQUOI PAS `FeuilleDuMasque` ────────────────────────────────────────
 *
 * Elle hisse `background` et `color-scheme` jusqu'à `html` et `body` : montée
 * ici, elle repeindrait le BACK-OFFICE ENTIER aux couleurs du masque en cours
 * d'édition, à chaque frappe dans un champ de couleur. Le `style` inline de
 * `styleDuMasque()` s'arrête au sous-arbre, et c'est exactement ce qu'on veut.
 * Conséquence assumée et visible : le cadre de l'aperçu a des bords, là où la
 * vraie page va jusqu'au bord de l'écran.
 *
 * ─── POURQUOI `inert` ──────────────────────────────────────────────────────
 *
 * C'est une IMAGE, pas une page. Sans lui, le clavier traverserait huit
 * boutons qui ne font rien avant d'atteindre le champ suivant de l'éditeur, et
 * un lecteur d'écran annoncerait un faux tunnel de commande. La légende
 * au-dessus du cadre dit ce qui est montré — elle, elle est lue.
 */

import { useMemo } from "react";
import { TYPE_PAIRS, logoPour, type Brand } from "@sm/contracts";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import {
  Badge,
  BrandMark,
  Dot,
  Plate,
  PriceTag,
  PrimaryAction,
  SectionHead,
  Surface,
} from "@/components/order/primitives";
import { initial } from "@/components/order/helpers";

/*
 * `font-body` ET `classesPolices` — les deux, comme sur toutes les racines
 * client : la première nomme la famille, les secondes déclarent les
 * dix-huit variables `--police-*` que next/font pose sur un élément.
 */
const cadre = `${classesPolices} font-body overflow-hidden rounded-panel border border-line bg-bg text-ink`;

/** Deux plats fictifs, et ils s'annoncent comme tels dans la légende. */
const PLATS = [
  { nom: "Le kebab maison", detail: "Galette, oignons confits, sauce blanche", prix: 950, neuf: true },
  { nom: "Assiette du jour", detail: "Servie de 12 h à 14 h", prix: 1350, neuf: false },
];

export function ApercuDeMarque({ brand, nom }: { brand: Brand; nom: string }) {
  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200. Cet aperçu se repeint à
   * CHAQUE frappe dans un champ de couleur : sans ce `useMemo`, la facture
   * serait payée aussi pour un rendu déclenché par l'ouverture d'une modale.
   * Sa référence sert de `style` — la recréer repeindrait tout le sous-arbre.
   */
  const masque = useMemo(() => styleDuMasque(brand), [brand]);
  // Lu dans la table des paires et non via `resoudreMarque()` : refaire toute
  // la palette pour un booléen serait payer une palette pour lire une police.
  const { prixMono } = TYPE_PAIRS[brand.type.pair];
  const logo = logoPour(brand, "mark");
  const lettre = initial(nom);

  return (
    <div
      inert
      style={masque}
      className={cadre}
    >
      {/* En-tête : la tuile de marque suit le MODE du masque (`logoPour`), pas
          le champ plat `logoUrl` — un logo dessiné pour fond sombre
          disparaîtrait sur une Brasserie crème. */}
      <div className="flex items-center gap-3 px-4 pt-4">
        <BrandMark name={nom} logoUrl={logo} letter={lettre} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display truncate text-[17px] font-extrabold tracking-[-0.01em]">
            {nom}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-mut">
            <Dot tone="ok" />
            Ouvert · retrait en 15 min
          </div>
        </div>
      </div>

      {brand.hero && (
        <div className="mt-3.5 px-4">
          <div className="aspect-video overflow-hidden rounded-card border border-ink/6">
            {/* eslint-disable-next-line @next/next/no-img-element -- image servie par notre API : next/image n'a rien à y optimiser. */}
            <img src={brand.hero} alt="" className="size-full object-cover" />
          </div>
        </div>
      )}

      <div className="mt-4 px-4">
        <SectionHead title="Nos incontournables" note="Retrait au comptoir, paiement sur place ou en ligne." />
        <div className="flex flex-col gap-2.5">
          {PLATS.map((p) => (
            <Surface key={p.nom} className="flex items-center gap-3 p-2.5">
              {/* Sans photo, volontairement : c'est le cas de la majorité
                  d'une carte, et le plateau rend alors le monogramme — poser
                  ici une image qui n'est pas la sienne serait un décor. */}
              <Plate photoUrl={null} name={p.nom} className="size-[62px]" mono={20} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-bold">{p.nom}</span>
                  {p.neuf && <Badge>Nouveau</Badge>}
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-mut">{p.detail}</p>
              </div>
              <PriceTag cents={p.prix} mono={prixMono} />
            </Surface>
          ))}
        </div>
      </div>

      <div className="mt-4 px-4 pb-4">
        <PrimaryAction icon="cart" amount={2300}>
          Commander
        </PrimaryAction>
      </div>
    </div>
  );
}
