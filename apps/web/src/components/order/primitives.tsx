"use client";

/**
 * Primitives visuelles de la surface client.
 *
 * Direction artistique — noir premium stratifié :
 *   fond #000 · carte #111 (dégradé vertical subtil) · élément #1a1a1a,
 *   filets rgba(255,255,255,.06–.1), rayons 8 / 12 / 16–20 / pilule.
 * L’accent de marque (`--cf-accent`, injecté par tenant) ne sert QU’aux
 * actions primaires, aux totaux et aux éléments actifs. Le vert #3fae4a,
 * le rouge #c94b3f et l’ambre #e0973f restent fonctionnels sur tous les
 * comptes : prêt / alerte / en préparation.
 *
 * Écran de comptoir : rien sous 13 px pour une information utile, réponse
 * tactile visible en moins de 100 ms, mouvement limité à l’opacité et à la
 * transformation (et neutralisé sous `prefers-reduced-motion`).
 *
 * La hiérarchie de la maquette (`docs/specs/commande-en-ligne.md` §4) est
 * portée ici : eyebrow de section, en-tête à double filet, pastille de prix,
 * chips d’options, lignes cochables, feuille montante.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "@/components/ui";
import { useDialogLayer } from "@/components/ui/useDialogLayer";
import { euros, eurosBare } from "./helpers";
import "./order.css";

// ─────────────────────────────────────────────────────────────
// Retour tactile
// ─────────────────────────────────────────────────────────────

/** Enfoncement immédiat, relâchement doux — à poser sur tout élément appuyable. */
export const TAP =
  "transition-[transform,background-color,border-color,color,opacity] duration-fast ease-sm active:duration-snap active:scale-[0.97] motion-reduce:active:scale-100";

/** Variante « ligne » : une ligne pleine largeur s’enfonce, elle ne rétrécit pas. */
export const TAP_ROW =
  "transition-[transform,background-color,border-color,color,opacity] duration-fast ease-sm active:duration-snap active:translate-y-px motion-reduce:active:translate-y-0";

/**
 * `ComponentPropsWithRef` et non `ButtonHTMLAttributes` : en React 19, `ref`
 * est une propriété ordinaire des composants de fonction. Le tabindex
 * tournant de `Segmented` doit pouvoir donner le focus au segment voisin.
 */
type TapProps = ComponentPropsWithRef<"button">;

/** `<button>` nu doté du retour tactile (aucun style de surface imposé). */
export function Tap({ className, type = "button", ...rest }: TapProps) {
  return <button type={type} className={cx(TAP, className)} {...rest} />;
}

// ─────────────────────────────────────────────────────────────
// Icônes propres au parcours client
// ─────────────────────────────────────────────────────────────

const GLYPHS = {
  /** Épingle de lieu — carte « où retirer ». */
  pin: ["M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  /** Flamme — « au plus tôt », créneau chaud. */
  fire: [
    "M12 3s5.5 4.2 5.5 9a5.5 5.5 0 0 1-11 0c0-2 .9-3.4 1.8-4.4.4 1.2 1.2 1.9 2 1.9 1.4 0 1.9-1.3 1.7-6.5z",
  ],
  /** Sac de retrait — paiement au comptoir. */
  bag: ["M5 8h14l-1.1 12.5H6.1z", "M9 8V6a3 3 0 0 1 6 0v2"],
  /** Étincelle — nouveauté, mise en avant. */
  spark: ["M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"],
  /** Curseurs — « ce produit se compose » : une feuille d’options va s’ouvrir. */
  sliders: [
    "M4 7h9",
    "M17 7h3",
    "M4 17h3",
    "M11 17h9",
    "M15 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
    "M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
  ],
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** Icônes absentes du DS back-office, nécessaires à la surface client. */
export function Glyph({
  name,
  size = 18,
  stroke = 2,
  className,
  filled = false,
}: {
  name: GlyphName;
  size?: number;
  stroke?: number;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Plateau produit — le visuel qui donne faim
// ─────────────────────────────────────────────────────────────

/** Initiales de repli : deux lettres, articles et prépositions écartés. */
const FILLER = /^(le|la|les|l|de|du|des|d|au|aux|à|et|the)$/i;

export function monogram(name: string): string {
  const words = name.trim().split(/[\s'’-]+/).filter(Boolean);
  const strong = words.filter((w) => !FILLER.test(w));
  const source = strong.length > 0 ? strong : words;
  // Un seul mot (« Végétarien ») : deux lettres. Une initiale isolée flotte au
  // milieu du plateau, deux lettres tiennent la surface comme un monogramme.
  const letters =
    source.length > 1
      ? source
          .slice(0, 2)
          .map((w) => w[0] ?? "")
          .join("")
      : (source[0] ?? name.trim()).slice(0, 2);
  return (letters || name.trim().slice(0, 2)).toUpperCase();
}

/**
 * Plateau : le réceptacle de TOUT visuel produit (carte, rail, panier, fiche).
 *
 * Trois exigences, un seul composant :
 *  — les photos de la carte sont **détournées** et de format libre : elles
 *    tiennent en `contain` sur un halo, jamais recadrées en `cover` (un plat
 *    coupé aux deux bouts ne donne pas faim) ;
 *  — un produit sans photo — la majorité de la carte — reçoit le monogramme
 *    en contour : une mise en page réglée, pas un cadre vide ;
 *  — une photo qui ne charge PAS bascule sur ce même monogramme. Sans cela le
 *    navigateur dessine son icône d'image cassée, ce qui donne à la carte
 *    l'air d'un site en panne.
 */
export function Plate({
  photoUrl,
  name,
  className,
  radius = "rounded-card",
  /** Corps du monogramme de repli, en pixels. */
  mono = 22,
  /** Marge intérieure de la photo (le détourage respire). */
  pad = "p-[7%]",
}: {
  photoUrl: string | null;
  name: string;
  className?: string;
  radius?: string;
  mono?: number;
  pad?: string;
}) {
  /**
   * L’état porte l’URL qu’il juge : la feuille produit réutilise le même
   * plateau d’un produit à l’autre, une photo cassée ne doit pas condamner la
   * suivante (motif « ajuster l’état pendant le rendu » de la doc React).
   */
  const [state, setState] = useState({ url: photoUrl, broken: false });
  if (state.url !== photoUrl) setState({ url: photoUrl, broken: false });
  const shown = photoUrl && !state.broken;
  const fail = () => setState({ url: photoUrl, broken: true });
  return (
    <span
      aria-hidden
      className={cx(
        "sm-plate relative grid shrink-0 place-items-center overflow-hidden border border-ink/6",
        radius,
        className,
      )}
    >
      {shown ? (
        // Photo tenant : domaine non maîtrisé, next/image imposerait une
        // liste blanche — <img> volontaire, avec repli à l'erreur.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={fail}
          /* La page est rendue côté serveur : une image morte a déjà échoué
             quand React s’attache, et `onError` ne se déclenchera JAMAIS. On
             relit donc l’état réel du nœud au montage — sans quoi le
             navigateur laisse son icône d’image cassée dans la carte. */
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) fail();
          }}
          className={cx("sm-cut size-full object-contain", pad)}
        />
      ) : (
        <span
          style={{ fontSize: mono }}
          className="sm-mono relative font-black uppercase leading-none"
        >
          {monogram(name)}
        </span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Typographie des chiffres
// ─────────────────────────────────────────────────────────────

/**
 * Montant en centimes. Graisse forte, chasse tabulaire et interlettrage
 * négatif : les prix d’une colonne s’alignent au pixel.
 */
export function Money({
  cents,
  className,
  symbol = true,
  mono = false,
}: {
  cents: number | null | undefined;
  className?: string;
  symbol?: boolean;
  /** Chasse fixe : le masque du restaurant le dicte, jamais le composant. */
  mono?: boolean;
}) {
  return (
    <span
      className={cx(
        "font-extrabold tabular-nums tracking-[-0.02em] whitespace-nowrap",
        mono && "font-mono",
        className,
      )}
    >
      {eurosBare(cents)}
      {/*
        LE SYMBOLE FAIT PARTIE DU PRIX — il ne s'atténue donc pas.
        Il était posé à `opacity-70`. Sur les boutons d'accent (barre de
        panier, « Continuer · 3,50 € ») le couple onAccent/accent n'a que le
        minimum garanti par le résolveur : rabattu à 70 %, le € tombait sous
        4,5:1 sur quatre directions. La hiérarchie passe donc par le CORPS et
        la GRAISSE — jamais par la couleur, qui reste celle du montant.
      */}
      {symbol && <span className="ml-0.5 text-[0.85em] font-bold">€</span>}
    </span>
  );
}

/**
 * Pastille de prix (maquette §4.5) — le prix ne flotte pas dans la carte, il
 * est posé sur un aplat de niveau 3. C’est ce qui le rend lisible d’un coup
 * d’œil dans une liste de vingt produits.
 */
export function PriceTag({
  cents,
  from = false,
  size = "md",
  mono = false,
}: {
  cents: number | null | undefined;
  /** Produit à variantes : préfixe « dès ». */
  from?: boolean;
  size?: "sm" | "md";
  /** `prixMono` du masque — descendu depuis la vitrine, jamais relu ici. */
  mono?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-baseline gap-1 rounded-ctrl border border-ink/6 bg-surface2 text-ink",
        size === "sm" ? "px-2 py-[3px]" : "px-2.5 py-[5px]",
      )}
    >
      {from && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">
          dès
        </span>
      )}
      <Money
        cents={cents}
        mono={mono}
        className={size === "sm" ? "text-[13px]" : "text-[15px]"}
      />
    </span>
  );
}

/**
 * Montant écrit en toutes lettres (« 9,50 € »), hors pastille.
 *
 * La chasse fixe n'est PAS un choix de composant : deux paires typographiques
 * du masque sur dix posent les prix en mono (l'atelier, le brut). La vitrine
 * lit `TYPE_PAIRS[brand.type.pair].prixMono` une seule fois et le descend en
 * propriété — dans la table des paires, et surtout PAS via `resoudreMarque()`,
 * qui refait toute la palette pour un booléen (voir le commentaire de
 * `Storefront`). Aucun composant ne relit la marque pour son propre compte,
 * sinon la règle se disperse dans vingt fichiers et diverge au premier oubli.
 */
export function Prix({
  cents,
  mono = false,
  className,
}: {
  cents: number | null | undefined;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("tabular-nums whitespace-nowrap", mono && "font-mono", className)}>
      {euros(cents)}
    </span>
  );
}

/**
 * Intitulé de section : capitales espacées, gris — l’ossature de la page.
 *
 * `id` est posé sur le `<h3>` et non sur l'enveloppe : c'est le TITRE qui
 * nomme le champ ou le groupe qui suit (`aria-labelledby`). Sans lui, les
 * `<textarea>` du tunnel et de la fiche produit n'avaient aucun nom
 * accessible (1.3.1, 4.1.2) et les grappes de chips n'appartenaient à aucun
 * groupe annoncé — « Ketchup » se lisait sans qu'on sache de quel choix.
 */
export function SectionLabel({
  children,
  hint,
  className,
  id,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3", className)}>
      <h3 id={id} className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
        {children}
      </h3>
      {hint && <span className="shrink-0 text-[13px] text-mut">{hint}</span>}
    </div>
  );
}

/**
 * En-tête de section de carte (maquette §4.10) : titre à l’accent, double
 * filet, puis la note. C’est ce filet qui donne à la carte sa structure
 * « imprimée » — sans lui, la page redevient une liste plate.
 */
export function SectionHead({
  title,
  note,
  id,
  aside,
}: {
  title: ReactNode;
  note?: ReactNode;
  id?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="pb-3">
      <div className="flex items-end justify-between gap-3">
        <h2
          id={id}
          className="font-display text-[19px] font-extrabold uppercase leading-none tracking-[-0.01em] text-accentink"
        >
          {title}
        </h2>
        {aside}
      </div>
      <div aria-hidden className="sm-rule mt-2" />
      {note && <p className="mt-2 text-[13px] leading-snug text-mut">{note}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Surfaces
// ─────────────────────────────────────────────────────────────

/** Carte niveau 2 (#111) : dégradé vertical, filet 6 %, ombre portée douce. */
export function Surface({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cx(
        "rounded-panel border border-ink/6 bg-surface bg-[linear-gradient(180deg,var(--cf-surface-3),transparent_120px)] shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Pastille d’état — vert prêt · ambre en préparation · rouge alerte. */
export function Dot({
  tone,
  className,
}: {
  tone: "ok" | "prep" | "alert" | "mut";
  className?: string;
}) {
  const bg = {
    ok: "bg-ok",
    prep: "bg-prep",
    alert: "bg-alert",
    mut: "bg-ink/25",
  }[tone];
  return (
    <span
      aria-hidden
      className={cx("inline-block size-[7px] shrink-0 rounded-full", bg, className)}
    />
  );
}

/**
 * Badge produit (maquette §4.4). `new` porte l’accent tenant, `hot` reste
 * neutre — deux aplats accent côte à côte tueraient la parcimonie (DA §3).
 */
export function Badge({
  tone = "new",
  children,
}: {
  tone?: "new" | "hot" | "out" | "ok";
  children: ReactNode;
}) {
  const skin = {
    new: "bg-accent text-onaccent",
    hot: "bg-ink/12 text-ink",
    out: "border border-ink/15 text-mut",
    ok: "bg-ok text-onok",
  }[tone];
  return (
    <span
      /*
        11 px, et non 10 : l'en-tête de ce fichier pose « rien sous 13 px pour
        une information utile », et ces badges en portent une — « Bientôt »
        REMPLACE le prix sur une carte en rupture, « Nouveau » et « En cours »
        ne sont écrits nulle part ailleurs. On ne peut pas descendre à 13 px
        sans casser la pastille ; on remonte donc au plus haut que la forme
        supporte, et l'interlettrage est desserré d'autant moins (0,06 em au
        lieu de 0,09) pour que le mot ne s'étale pas.
      */
      className={cx(
        "inline-flex shrink-0 items-center rounded-pill px-2 py-[3px] text-[11px] font-extrabold uppercase leading-none tracking-[0.06em]",
        skin,
      )}
    >
      {children}
    </span>
  );
}

/** Tuile de marque : initiale du restaurant sur l’accent, ou logo fourni. */
export function BrandMark({
  name,
  logoUrl,
  size = 40,
  letter,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  letter: string;
}) {
  if (logoUrl) {
    return (
      // Logo tenant : URL arbitraire hors domaine connu — <img> volontaire
      // (next/image imposerait une liste blanche de domaines).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
        className="shrink-0 border border-ink/10 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        fontSize: Math.round(size * 0.46),
      }}
      className="grid shrink-0 place-items-center bg-accent font-extrabold tracking-[-0.02em] text-onaccent"
    >
      {letter}
    </span>
  );
}

/**
 * Rail horizontal : défilement au doigt, bords fondus, pas de barre.
 *
 * ═══ UN NOM EXIGE UN RÔLE ═══
 *
 * `aria-label` était posé sur une `<div>` nue. ARIA l'interdit sur un élément
 * générique et les technologies d'assistance l'ignorent : le rail n'avait
 * donc AUCUN nom, malgré l'intention. `role="group"` est le rôle exact d'un
 * ensemble d'objets d'interface qui se tiennent — et non `region`, qui
 * ajouterait un point de repère de page pour une bande de six cartes.
 *
 * Pas de `tabIndex={0}` : la zone défilante contient des boutons, donc elle
 * est déjà atteignable et défilée au clavier (2.1.1). L'ajouter ne ferait
 * qu'intercaler une halte de tabulation vide avant chaque carte.
 */
export function Rail({
  children,
  className,
  label,
  snap = true,
}: {
  children: ReactNode;
  className?: string;
  /** Nom du rail. Sans lui, pas de `role` non plus : un groupe anonyme n'aide personne. */
  label?: string;
  snap?: boolean;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className={cx(
        "sm-rail -mx-4 flex gap-2.5 overflow-x-auto px-4",
        snap && "sm-snap",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stepper de quantité
// ─────────────────────────────────────────────────────────────

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  /** `0` dans le panier : décrémenter à zéro supprime la ligne. */
  min?: number;
  max?: number;
  /** Contexte lu par les lecteurs d’écran (« Kebab »). */
  label: string;
}) {
  // 44 px : la cible tactile minimale, sur un contrôle qu'on martèle du pouce.
  const btn =
    "grid size-11 place-items-center rounded-pill text-ink disabled:opacity-30 disabled:active:scale-100 hover:bg-ink/10";
  return (
    <div className="inline-flex items-center rounded-pill border border-ink/12 bg-surface2 p-0.5">
      <Tap
        className={btn}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={min === 0 && value === 1 ? `Retirer ${label}` : `Moins de ${label}`}
      >
        <Icon name="minus" size={16} stroke={2.4} />
      </Tap>
      <span
        aria-live="polite"
        className="min-w-7 text-center text-[16px] font-extrabold tabular-nums tracking-[-0.02em]"
      >
        {value}
      </span>
      <Tap
        className={btn}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Plus de ${label}`}
      >
        <Icon name="plus" size={16} stroke={2.4} />
      </Tap>
    </div>
  );
}

/**
 * Affordance d’ajout d’une carte produit (maquette §5.2.3).
 *
 * Trois états, un seul gabarit — c’est le signe qui dit ce qui va se passer :
 *   déjà au panier → la quantité ;
 *   produit à options → curseurs (une feuille de composition va s’ouvrir) ;
 *   produit simple → « + » (un appui, c’est ajouté).
 *
 * Un gabarit unique de 40 px garde le rythme vertical de la liste : vingt
 * cartes se parcourent sans que l’œil ait à re-mesurer chaque ligne. Rendu en
 * `<span aria-hidden>` — c’est la carte entière qui est le bouton, une cible
 * tactile bien plus large que la pastille.
 */
export function AddButton({
  qty = 0,
  compose = false,
}: {
  /** Quantité déjà au panier : le bouton devient un compteur. */
  qty?: number;
  /** Produit configurable : on annonce « composer », pas « ajouter ». */
  compose?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="grid size-11 shrink-0 place-items-center rounded-pill bg-accent text-onaccent shadow-[0_6px_16px_-6px_var(--cf-accent)]"
    >
      {qty > 0 ? (
        <span className="text-[16px] font-extrabold tabular-nums">{qty}</span>
      ) : compose ? (
        <Glyph name="sliders" size={19} stroke={2.2} />
      ) : (
        <Icon name="plus" size={20} stroke={2.6} />
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Sélecteurs
// ─────────────────────────────────────────────────────────────

/** Chip d’option : sélectionnée = aplat accent discret + filet accent. */
export function OptionChip({
  on,
  disabled,
  children,
  onClick,
  price,
}: {
  on: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
  /** Écart de prix affiché en suffixe (centimes) ; 0 ⇒ masqué. */
  price?: number;
}) {
  return (
    <Tap
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 py-2 text-[14px] font-semibold",
        // Le lavis d'accent est celui du contrat (`--cf-accent-wash`, 12 %) et
        // pas une opacité improvisée : c'est sur CETTE valeur que le résolveur
        // prouve l'AA de `mut` et d'`accentink`. À 20 %, la chip sélectionnée
        // était plus dense que tout ce que le résolveur avait jugé.
        on
          ? "border-accent bg-accentwash text-ink"
          : "border-ink/10 bg-surface2 text-ink/85 hover:border-ink/25",
        disabled && "cursor-not-allowed opacity-35 active:scale-100",
      )}
    >
      {on && <Icon name="check" size={13} stroke={3} className="-ml-0.5 text-accentink" />}
      {children}
      {price !== undefined && price !== 0 && (
        <span
          className={cx(
            "text-[12px] font-bold tabular-nums",
            on ? "text-ink" : "text-mut",
          )}
        >
          +{eurosBare(price)} €
        </span>
      )}
    </Tap>
  );
}

/**
 * Le pas d'une flèche dans un groupe de boutons radio (APG radiogroup).
 * `null` quand la touche n'est pas une flèche : l'appelant laisse passer.
 */
function pasDeFleche(key: string): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  return null;
}

/**
 * Enveloppe `role="radiogroup"` qui rend les flèches opérantes (APG).
 *
 * Elle sert les groupes dont les boutons sont posés par l'APPELANT
 * (`ChoiceCard`, `OptionRow` en mode radio) : le clavier se gouverne au
 * niveau du groupe, en interrogeant les `role="radio"` réellement rendus —
 * aucun composant enfant n'a donc à connaître ses frères. `Segmented`, qui
 * possède déjà ses options, gère ses flèches lui-même.
 *
 * Le tabindex tournant reste à la charge de l'appelant (`tabIndex` sur chaque
 * ligne) : lui seul sait laquelle est cochée, et quelle ligne prend la halte
 * de tabulation quand aucune ne l'est.
 */
export function RadioGroup({
  label,
  labelledBy,
  className,
  children,
}: {
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={className}
      onKeyDown={(e) => {
        const pas = pasDeFleche(e.key);
        if (pas === null || e.altKey || e.ctrlKey || e.metaKey) return;
        const radios = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            '[role="radio"]:not([disabled]):not([aria-disabled="true"])',
          ),
        ];
        const depuis = radios.indexOf(
          e.currentTarget.ownerDocument.activeElement as HTMLElement,
        );
        if (depuis < 0) return;
        e.preventDefault();
        // La boucle est circulaire, comme le veut l'APG : en bout de groupe la
        // flèche revient au premier plutôt que de ne rien faire.
        const cible = radios[(depuis + pas + radios.length) % radios.length];
        // Dans un radiogroup, déplacer le focus SÉLECTIONNE : le clic est donc
        // la bonne primitive — il rejoue exactement ce que fait la souris.
        cible?.click();
        cible?.focus();
      }}
    >
      {children}
    </div>
  );
}

/**
 * Contrôle segmenté — le sélecteur de format. Le curseur actif porte
 * l’accent : c’est le choix qui pilote le prix, il doit se lire avant tout le
 * reste de la fiche.
 *
 * ═══ LA GRILLE SUIT LE CONTENEUR, PAS LE NOMBRE D'OPTIONS ═══
 *
 * Elle valait `repeat(n, minmax(0,1fr))` : trois formats longs à 390 px
 * devenaient « Gran… / Gran… / Gran… », indistinguables. `auto-fit` pose
 * autant de colonnes de 6,5 rem que la place en accepte, replie le contrôle
 * sur deux lignes quand elle manque, et — les pistes vides étant effondrées —
 * deux options occupent toujours toute la largeur. Le libellé se coupe sur
 * deux lignes au lieu d'être tronqué : mieux vaut lire en deux temps que ne
 * pas lire.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  mono = false,
}: {
  options: { key: T; label: string; sub?: string }[];
  value: T | null;
  onChange: (next: T) => void;
  label: string;
  /** `prixMono` du masque : le `sub` d'un segment porte un prix. */
  mono?: boolean;
}) {
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  /*
   * Le tabindex TOURNANT (APG) : le groupe entier ne prend qu'UNE halte de
   * tabulation, sur le segment coché — ou, si rien n'est coché, sur le
   * premier, sinon le contrôle deviendrait inatteignable au clavier.
   */
  const coche = options.findIndex((o) => o.key === value);
  const tournant = coche >= 0 ? coche : 0;

  const deplacer = (depuis: number, pas: number) => {
    const cible = (depuis + pas + options.length) % options.length;
    const option = options[cible];
    if (!option) return;
    onChange(option.key);
    segments.current[cible]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-1.5 rounded-panel border border-ink/8 bg-surface2 p-1.5"
    >
      {options.map((option, i) => {
        const on = option.key === value;
        return (
          <Tap
            key={option.key}
            ref={(node) => {
              segments.current[i] = node;
            }}
            role="radio"
            aria-checked={on}
            tabIndex={i === tournant ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={(e) => {
              const pas = pasDeFleche(e.key);
              if (pas === null || e.altKey || e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              deplacer(i, pas);
            }}
            className={cx(
              "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-card px-2 py-2 text-center",
              on
                ? "bg-accent text-onaccent shadow-card"
                : "text-mut hover:text-ink",
            )}
          >
            <span className="line-clamp-2 max-w-full break-words text-[13.5px] font-bold leading-tight">
              {option.label}
            </span>
            {option.sub && (
              // Sur le segment actif, le prix reste en `onaccent` PLEIN : il
              // pilote le prix de la fiche, et à 80 % d'opacité il tombait à
              // 3,63:1 sur Marché. La hiérarchie tient au corps et à la
              // graisse — semi-gras contre le gras du libellé.
              <span
                className={cx(
                  "text-[12px] font-semibold tabular-nums leading-none",
                  mono && "font-mono",
                  !on && "text-mut",
                )}
              >
                {option.sub}
              </span>
            )}
          </Tap>
        );
      })}
    </div>
  );
}

/** Ligne cochable pleine largeur (suppléments, modes de paiement). */
export function OptionRow({
  on,
  radio = false,
  disabled = false,
  title,
  sub,
  price,
  onClick,
  tabIndex,
}: {
  on: boolean;
  /** Rendu en pastille ronde plutôt que carrée (choix exclusif). */
  radio?: boolean;
  disabled?: boolean;
  title: ReactNode;
  sub?: ReactNode;
  /** Centimes ; `undefined` ⇒ aucun prix affiché. */
  price?: number;
  onClick: () => void;
  /**
   * Tabindex tournant d'un `RadioGroup` (APG) : `0` sur la ligne cochée, `-1`
   * sur les autres. Seul l'appelant, qui voit tout le groupe, peut le poser.
   */
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      tabIndex={radio ? tabIndex : undefined}
      className={cx(
        TAP_ROW,
        "flex min-h-[52px] w-full items-center gap-3 border-b border-ink/6 py-3 text-left last:border-b-0",
        disabled && "cursor-not-allowed opacity-35",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid size-[22px] shrink-0 place-items-center border-2 transition-colors duration-fast ease-sm",
          radio ? "rounded-full" : "rounded-[7px]",
          // `border-linefirm` et non `border-ink/25` : c'est cet anneau,
          // et lui seul, qui dit « non coché ». À 25 % d'encre il mesurait
          // 1,52 à 2,16:1 selon la direction — la case cochée se voyait
          // (aplat d'accent), la case vide se devinait (1.4.11 exige 3:1).
          on ? "border-accent bg-accent text-onaccent" : "border-linefirm",
        )}
      >
        {on && <Icon name="check" size={13} stroke={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">
          {title}
        </span>
        {sub && <span className="block truncate text-[13px] text-mut">{sub}</span>}
      </span>
      {price !== undefined && price !== 0 && (
        <span className="shrink-0 text-[14px] font-bold tabular-nums text-accentink">
          +{eurosBare(price)} €
        </span>
      )}
    </button>
  );
}

/**
 * Carte de choix exclusif (mode de paiement, mode de retrait) — plus lourde
 * qu’une `OptionRow` : elle porte une icône et une bordure pleine à l’état
 * sélectionné. Réservée aux embranchements du tunnel.
 */
export function ChoiceCard({
  on,
  icon,
  glyph,
  title,
  sub,
  onClick,
  disabled,
  tabIndex,
}: {
  on: boolean;
  icon?: IconName;
  glyph?: GlyphName;
  title: ReactNode;
  sub?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Tabindex tournant du `RadioGroup` qui l'entoure (APG). */
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cx(
        TAP_ROW,
        "flex w-full items-center gap-3 rounded-panel border p-3.5 text-left",
        // Même lavis unique que partout ailleurs (`--cf-accent-wash`, 12 %),
        // et non une troisième force inventée ici.
        on
          ? "border-accent bg-accentwash"
          : "border-ink/8 bg-surface hover:border-ink/20",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cx(
          "grid size-10 shrink-0 place-items-center rounded-card",
          on ? "bg-accent text-onaccent" : "bg-surface2 text-accentink",
        )}
      >
        {glyph ? <Glyph name={glyph} size={19} /> : icon ? <Icon name={icon} size={19} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-ink">{title}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-mut">{sub}</span>}
      </span>
      <span
        aria-hidden
        className={cx(
          "grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition-colors duration-fast ease-sm",
          // Même filet ferme que `OptionRow` ci-dessus, et pour la même
          // raison : l'anneau vide est le seul signe de « non choisi ».
          on ? "border-accent bg-accent text-onaccent" : "border-linefirm",
        )}
      >
        {on && <Icon name="check" size={12} stroke={3} />}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Feuille (bottom sheet)
// ─────────────────────────────────────────────────────────────

/**
 * SECOURS de démontage, et rien d'autre — ce n'est PAS la durée de sortie.
 *
 * La sortie dure `--sm-t-med`, posé par le masque (200 ms « vif », 320 ms
 * « posé ») : la feuille est démontée sur son `transitionend`. Ce délai ne
 * sert qu'au cas où l'événement ne vient jamais — ouverture puis fermeture
 * dans la même image, avant que la transition ait commencé. Il est donc
 * volontairement plus long que le plus lent des masques : mieux vaut un
 * nœud invisible 400 ms de trop qu'une feuille qui ne se démonte plus.
 */
const SORTIE_SECOURS_MS = 700;
/** Course au-delà de laquelle le relâchement ferme la feuille. */
const DISMISS_PX = 96;

/**
 * Feuille montante ancrée en bas (fiche produit, tunnel). Positionnée en
 * `fixed` : dans une iframe, la fenêtre EST l’encart hôte — la même feuille
 * sert donc la page plein écran et le widget embarqué, sans code spécifique.
 *
 * Fermeture : croix, Échap, appui sur le fond, **et glissement vers le bas
 * depuis la poignée ou l’en-tête** (le geste attendu sur un téléphone).
 *
 * ═══ LA FEUILLE EST UN DIALOGUE, ET ELLE EN PORTE LE CONTRAT ═══
 *
 * Elle se déclarait `role="dialog" aria-modal` sans rien tenir : la
 * tabulation sortait du panneau et se promenait dans la vitrine masquée par
 * le voile (2.4.3, APG dialog). `useDialogLayer` — déjà employé par `Modal`,
 * `Drawer` et le scanner de fidélité — apporte la pile, le piège de focus,
 * `inert` sur le reste de la page, Échap, le verrou de défilement et la
 * restitution du focus au déclencheur. La feuille client, la plus utilisée du
 * produit, était la seule à ne pas l'employer ; elle ne réécrit donc plus ces
 * quatre mécanismes pour son compte.
 *
 * En mode `float`, la barre de tête est transparente sur le visuel puis se
 * solidifie dès que le contenu défile dessous — la croix ne se retrouve jamais
 * posée sur du texte.
 */
export function Sheet({
  open,
  onClose,
  title,
  label,
  children,
  footer,
  /** Hauteur maximale relative à la scène. */
  maxHeight = "94%",
  /** Occupe toute la hauteur : évite que la feuille « saute » entre deux étapes. */
  fill = false,
  headerExtra,
  /**
   * `bar` : en-tête plein (poignée, titre, croix) — le tunnel, où l’étape doit
   * rester lisible en permanence.
   * `float` : aucun en-tête ; la poignée et la croix flottent au-dessus du
   * contenu, qui commence donc par son propre visuel plein cadre et défile
   * sous elles — c’est la fiche produit de la maquette.
   */
  chrome = "bar",
  /** Bouton retour dans l’en-tête (étapes du tunnel). */
  onBack,
  /** Empilement : la fiche produit doit passer AU-DESSUS du tunnel (60 > 50). */
  zIndex = 50,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  label?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: string;
  headerExtra?: ReactNode;
  chrome?: "bar" | "float";
  onBack?: (() => void) | null;
  fill?: boolean;
  zIndex?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  /** Mode `float` : le visuel de tête est-il déjà passé sous la barre ? */
  const [sunk, setSunk] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  const titleId = useId();
  /*
   * Le focus d'ouverture reste le PANNEAU, comme avant : la feuille produit
   * s'ouvre sur son visuel, pas sur la première chip de sauce. Sans cette
   * cible, `useDialogLayer` irait au premier élément tabulable du contenu.
   */
  const layerRef = useDialogLayer({
    open: mounted,
    onClose,
    initialFocusRef: panelRef,
  });

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- `mounted` et `shown` sont deux temps d'animation pilotés par requestAnimationFrame puis par `transitionend` : le démontage doit attendre la fin de la transition de sortie, ce qu'aucun calcul au rendu ne peut exprimer.
      setMounted(true);
      setDrag(0);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    /*
     * LE DÉMONTAGE SUIT LA TRANSITION, PAS UN CHRONOMÈTRE ÉCRIT ICI.
     *
     * Il attendait 300 ms en dur pendant que la sortie durait `--sm-t-med` :
     * le masque « posé » (320 ms) se faisait couper net, et le choix de
     * mouvement du restaurateur s'arrêtait à la porte de sa propre feuille.
     * `transitionend` est la seule source qui dise VRAIMENT quand elle est
     * finie — mouvement réduit compris, où la durée tombe à 0,01 ms.
     */
    const panneau = panelRef.current;
    const fini = (e?: TransitionEvent) => {
      if (e && e.propertyName !== "transform") return;
      setMounted(false);
    };
    panneau?.addEventListener("transitionend", fini);
    const secours = window.setTimeout(fini, SORTIE_SECOURS_MS);
    return () => {
      panneau?.removeEventListener("transitionend", fini);
      window.clearTimeout(secours);
    };
  }, [open]);

  // ── Glisser pour fermer ──
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    dragFrom.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null) return;
    // Vers le haut : rien (la feuille ne grandit pas), vers le bas : elle suit.
    setDrag(Math.max(0, e.clientY - dragFrom.current));
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragFrom.current === null) return;
      const travelled = Math.max(0, e.clientY - dragFrom.current);
      dragFrom.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (travelled > DISMISS_PX) onClose();
      setDrag(0);
    },
    [onClose],
  );

  if (!mounted) return null;

  const dragging = drag > 0;

  return (
    <div
      ref={layerRef}
      /* Retiré par `useDialogLayer` au moment d'isoler le fond : il empêche un
         `autoFocus` du contenu de voler le focus avant que la cible de retour
         soit lue (même contrat que `Modal` et `Drawer`). */
      inert
      tabIndex={-1}
      style={{ zIndex }}
      className="fixed inset-0 flex flex-col items-center justify-end outline-none"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-scrim transition-opacity duration-med ease-sm"
        style={{ opacity: shown ? Math.max(0, 1 - drag / 320) : 0 }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-t-wide border-x border-t border-ink/10 bg-surface shadow-deep outline-none"
        style={{
          maxHeight,
          height: fill ? maxHeight : undefined,
          transform: shown ? `translateY(${drag}px)` : "translateY(100%)",
          // La durée vient du masque comme la courbe : elle était écrite en dur
          // (300 ms) à côté d'un `var(--sm-ease)` qui, lui, suivait déjà.
          transition: dragging ? "none" : "transform var(--sm-t-med) var(--sm-ease)",
        }}
      >
        {chrome === "bar" ? (
          <div
            className="sm-grab relative shrink-0 border-b border-ink/6 bg-[linear-gradient(180deg,var(--cf-surface-6),transparent)] px-4 pb-3 pt-2.5"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span
              aria-hidden
              className="mx-auto mb-3 block h-1 w-9 rounded-full bg-ink/20"
            />
            <div className="flex items-start gap-3">
              {onBack && (
                <Tap
                  onClick={onBack}
                  aria-label="Étape précédente"
                  className="-ml-1 grid size-11 shrink-0 place-items-center rounded-pill border border-ink/10 bg-surface2 text-ink hover:border-ink/30"
                >
                  <Icon name="back" size={16} />
                </Tap>
              )}
              <div className="min-w-0 flex-1">
                {title && (
                  <h2
                    id={titleId}
                    className="font-display truncate text-[19px] font-extrabold tracking-[-0.025em] text-ink"
                  >
                    {title}
                  </h2>
                )}
                {headerExtra}
              </div>
              <Tap
                onClick={onClose}
                aria-label="Fermer"
                className="grid size-11 shrink-0 place-items-center rounded-pill border border-ink/10 bg-surface2 text-ink hover:border-ink/30"
              >
                <Icon name="close" size={16} />
              </Tap>
            </div>
          </div>
        ) : (
          <div
            className={cx(
              "sm-grab absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-3 px-3 transition-colors duration-med ease-sm",
              sunk ? "border-b border-ink/8 bg-surface/95 backdrop-blur-md" : "",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* Poignée : visible tant que le visuel occupe la tête de feuille. */}
            <span
              aria-hidden
              className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-ink/45 shadow-card transition-opacity duration-med"
              style={{ opacity: sunk ? 0 : 1 }}
            />
            {title && (
              <h2
                id={titleId}
                className="font-display min-w-0 flex-1 truncate text-[16px] font-extrabold tracking-[-0.025em] text-ink transition-opacity duration-med"
                style={{ opacity: sunk ? 1 : 0 }}
              >
                {title}
              </h2>
            )}
            <Tap
              onClick={onClose}
              aria-label="Fermer"
              className={cx(
                "ml-auto grid size-11 shrink-0 place-items-center rounded-pill border text-ink transition-colors duration-med",
                sunk
                  ? "border-ink/12 bg-surface2 hover:border-ink/30"
                  : "border-ink/15 bg-bg/55 backdrop-blur-md hover:bg-bg/75",
              )}
            >
              <Icon name="close" size={17} stroke={2.4} />
            </Tap>
          </div>
        )}

        <div
          data-dialog-content
          className="cf-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onScroll={
            chrome === "float"
              ? (e) => {
                  const next = e.currentTarget.scrollTop > 96;
                  setSunk((prev) => (prev === next ? prev : next));
                }
              : undefined
          }
        >
          {children}
        </div>

        {footer && (
          <div
            data-dialog-footer
            className="shrink-0 border-t border-ink/8 bg-[linear-gradient(0deg,var(--cf-surface),var(--cf-surface))] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bandeaux et états
// ─────────────────────────────────────────────────────────────

/** Bandeau d’information. `tone` porte la sémantique fonctionnelle. */
export function Banner({
  tone = "info",
  icon,
  title,
  children,
  action,
}: {
  tone?: "info" | "ok" | "prep" | "alert";
  icon?: IconName;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const ring = {
    info: "border-ink/10",
    ok: "border-ok/35",
    prep: "border-prep/40",
    alert: "border-alert/45",
  }[tone];
  const color = {
    info: "text-mut",
    ok: "text-okt",
    prep: "text-prept",
    alert: "text-alertt",
  }[tone];
  return (
    <div
      className={cx(
        "flex items-start gap-3 rounded-card border bg-surface2 px-3.5 py-3",
        ring,
      )}
    >
      {icon && (
        <span className={cx("mt-0.5 shrink-0", color)}>
          <Icon name={icon} size={17} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && (
          <p className={cx("text-[14px] font-bold", tone === "info" ? "text-ink" : color)}>
            {title}
          </p>
        )}
        {children && <div className="text-[13px] leading-relaxed text-mut">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Bouton principal du tunnel : accent, pleine largeur, prix aligné à droite. */
export function PrimaryAction({
  children,
  amount,
  disabled,
  loading,
  onClick,
  icon,
  mono = false,
  type = "button",
}: {
  children: ReactNode;
  /** Total en centimes affiché à droite du libellé. */
  amount?: number;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  icon?: IconName;
  /**
   * `prixMono` du masque. Le montant de ce bouton est un prix comme un autre :
   * sans lui, le pied du tunnel restait en police de corps pendant que le
   * total juste au-dessus passait en chasse fixe.
   */
  mono?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        TAP,
        "flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-pill bg-accent px-5 text-[15px] font-extrabold tracking-[-0.01em] text-onaccent",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
      )}
    >
      {loading ? (
        <Spinner />
      ) : (
        icon && <Icon name={icon} size={17} stroke={2.4} />
      )}
      <span className="min-w-0 truncate">{children}</span>
      {amount !== undefined && (
        <>
          <span aria-hidden className="opacity-45">
            ·
          </span>
          <Money cents={amount} mono={mono} />
        </>
      )}
    </button>
  );
}

/** Action secondaire, sans aplat — l’accent reste rare. */
export function GhostAction({
  children,
  onClick,
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  return (
    <Tap
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex min-h-12 w-full items-center justify-center gap-2 rounded-pill border border-ink/12 bg-surface2 px-5 text-[14px] font-bold text-ink hover:border-ink/30",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
      )}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Tap>
  );
}

/** Roue d’attente 16 px — mouvement réduit : elle s’immobilise proprement. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, Math.round(size / 8)),
        borderStyle: "solid",
        borderColor: "currentColor",
        borderTopColor: "transparent",
      }}
      className="inline-block animate-spin rounded-full opacity-80 motion-reduce:animate-none"
    />
  );
}

/** Bloc d’erreur avec reprise — jamais d’écran mort dans le tunnel. */
export function ErrorState({
  title = "Un problème est survenu",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-card bg-surface2 text-alertt">
        <Icon name="bell" size={20} />
      </span>
      <p className="text-[15px] font-bold text-ink">{title}</p>
      <p className="max-w-[320px] text-[13px] leading-relaxed text-mut">{message}</p>
      {onRetry && (
        <div className="mt-1 w-full max-w-[220px]">
          <GhostAction onClick={onRetry}>Réessayer</GhostAction>
        </div>
      )}
    </div>
  );
}
