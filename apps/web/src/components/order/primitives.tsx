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
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "@/components/ui";
import { eurosBare } from "./helpers";

// ─────────────────────────────────────────────────────────────
// Retour tactile
// ─────────────────────────────────────────────────────────────

/** Enfoncement immédiat, relâchement doux — à poser sur tout élément appuyable. */
export const TAP =
  "transition-[transform,background-color,border-color,color,opacity] duration-200 ease-sm active:duration-75 active:scale-[0.97]";

type TapProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** `<button>` nu doté du retour tactile (aucun style de surface imposé). */
export function Tap({ className, type = "button", ...rest }: TapProps) {
  return <button type={type} className={cx(TAP, className)} {...rest} />;
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
}: {
  cents: number | null | undefined;
  className?: string;
  symbol?: boolean;
}) {
  return (
    <span
      className={cx(
        "font-extrabold tabular-nums tracking-[-0.02em] whitespace-nowrap",
        className,
      )}
    >
      {eurosBare(cents)}
      {symbol && <span className="ml-0.5 font-bold opacity-70">€</span>}
    </span>
  );
}

/** Intitulé de section : capitales espacées, gris — l’ossature de la page. */
export function SectionLabel({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3", className)}>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
        {children}
      </h3>
      {hint && <span className="text-[13px] text-mut">{hint}</span>}
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
        "rounded-panel border border-white/6 bg-surface bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_120px)] shadow-card",
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
    mut: "bg-white/25",
  }[tone];
  return (
    <span
      aria-hidden
      className={cx("inline-block size-[7px] shrink-0 rounded-full", bg, className)}
    />
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
        className="shrink-0 border border-white/10 object-cover"
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
  const btn =
    "grid size-9 place-items-center rounded-pill text-ink disabled:opacity-30 disabled:active:scale-100 hover:bg-white/10";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-pill border border-white/10 bg-surface2 p-0.5">
      <Tap
        className={btn}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={min === 0 && value === 1 ? `Retirer ${label}` : `Moins de ${label}`}
      >
        <Icon name="minus" size={16} />
      </Tap>
      <span
        aria-live="polite"
        className="min-w-7 text-center text-[15px] font-extrabold tabular-nums tracking-[-0.02em]"
      >
        {value}
      </span>
      <Tap
        className={btn}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Plus de ${label}`}
      >
        <Icon name="plus" size={16} />
      </Tap>
    </div>
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
        "inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-2 text-[14px] font-semibold",
        on
          ? "border-accent bg-[color-mix(in_srgb,var(--cf-accent)_18%,transparent)] text-ink"
          : "border-white/10 bg-surface2 text-ink/85 hover:border-white/25",
        disabled && "cursor-not-allowed opacity-35 active:scale-100",
      )}
    >
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

/** Ligne cochable pleine largeur (suppléments, modes de paiement). */
export function OptionRow({
  on,
  radio = false,
  disabled = false,
  title,
  sub,
  price,
  onClick,
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
}) {
  return (
    <Tap
      onClick={onClick}
      disabled={disabled}
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      className={cx(
        "flex w-full items-center gap-3 border-b border-white/6 py-3 text-left last:border-b-0",
        disabled && "cursor-not-allowed opacity-35 active:scale-100",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "grid size-[22px] shrink-0 place-items-center border-2 transition-colors duration-200 ease-sm",
          radio ? "rounded-full" : "rounded-[7px]",
          on ? "border-accent bg-accent text-onaccent" : "border-white/25",
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
        <span className="shrink-0 text-[14px] font-bold tabular-nums text-accent">
          +{eurosBare(price)} €
        </span>
      )}
    </Tap>
  );
}

// ─────────────────────────────────────────────────────────────
// Feuille (bottom sheet)
// ─────────────────────────────────────────────────────────────

const SHEET_MS = 260;

/**
 * Feuille montante ancrée en bas (fiche produit, tunnel). Positionnée en
 * `fixed` : dans une iframe, la fenêtre EST l’encart hôte — la même feuille
 * sert donc la page plein écran et le widget embarqué, sans code spécifique.
 *
 * Fermeture : croix, Échap, appui sur le fond. Le focus part sur le panneau et
 * revient à l’élément déclencheur à la fermeture.
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
  fill?: boolean;
  zIndex?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), SHEET_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  // Le fond ne défile pas sous la feuille (sinon le menu « fuit » à l’ouverture).
  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  useEffect(() => {
    if (!shown) return;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [shown]);

  if (!mounted) return null;

  return (
    <div
      style={{ zIndex }}
      className="fixed inset-0 flex flex-col items-center justify-end"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/70 transition-opacity duration-[260ms] ease-sm"
        style={{ opacity: shown ? 1 : 0 }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        className="relative flex w-full max-w-[560px] max-h-full flex-col overflow-hidden rounded-t-[20px] border-x border-t border-white/10 bg-surface shadow-[0_-18px_60px_rgba(0,0,0,0.65)] outline-none"
        style={{
          maxHeight,
          height: fill ? maxHeight : undefined,
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${SHEET_MS}ms var(--sm-ease)`,
        }}
      >
        <div className="relative shrink-0 border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),transparent)] px-4 pb-3 pt-3">
          <span
            aria-hidden
            className="mx-auto mb-3 block h-1 w-9 rounded-full bg-white/20"
          />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  id={titleId}
                  className="truncate text-[19px] font-extrabold tracking-[-0.02em] text-ink"
                >
                  {title}
                </h2>
              )}
              {headerExtra}
            </div>
            <Tap
              onClick={onClose}
              aria-label="Fermer"
              className="grid size-9 shrink-0 place-items-center rounded-pill border border-white/10 bg-surface2 text-ink hover:border-white/30"
            >
              <Icon name="close" size={16} />
            </Tap>
          </div>
        </div>

        <div className="cf-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-white/8 bg-surface px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
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
    info: "border-white/10",
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
  type = "button",
}: {
  children: ReactNode;
  /** Total en centimes affiché à droite du libellé. */
  amount?: number;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  icon?: IconName;
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
        "flex w-full items-center justify-center gap-2.5 rounded-pill bg-accent px-5 py-[15px] text-[15px] font-extrabold tracking-[-0.01em] text-onaccent",
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
          <Money cents={amount} />
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
        "flex w-full items-center justify-center gap-2 rounded-pill border border-white/12 bg-surface2 px-5 py-[13px] text-[14px] font-bold text-ink hover:border-white/30",
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
