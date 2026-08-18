"use client";

/**
 * Vue Ingrédients & stocks — libellés français, formatage et petits
 * composants d'affichage partagés par les trois onglets.
 * Rappel non négociable : tous les montants circulent en CENTIMES (int).
 */

import {
  ALLERGEN_LABELS,
  type Allergen,
  type BaseUnit,
  type IngredientCategory,
  type StockMovementType,
  type StorageMode,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Pill } from "@/components/ui";

// ─── Libellés français ───

export const CATEGORY_LABELS: Record<IngredientCategory, string> = {
  viande: "Viande",
  volaille: "Volaille",
  poisson: "Poisson",
  fromage: "Fromage",
  legume: "Légume",
  feculent: "Féculent",
  pain: "Pain",
  sauce: "Sauce",
  epicerie: "Épicerie",
  dessert: "Dessert",
  boisson: "Boisson",
  emballage: "Emballage",
  autre: "Autre",
};

export const STORAGE_LABELS: Record<StorageMode, string> = {
  sec: "Sec",
  frais: "Frais",
  congele: "Congelé",
};

/** Unités d'affichage (l'unité de base pilote coût et stock). */
export const UNIT_LABELS: Record<BaseUnit, string> = {
  kg: "kg",
  l: "L",
  pcs: "pcs",
};

export const MOVEMENT_META: Record<
  StockMovementType,
  { label: string; cls: string }
> = {
  // Couleurs FONCTIONNELLES fixes (§2.6) — jamais l'accent tenant.
  purchase: { label: "Réception", cls: "bg-ok text-white" },
  sale: { label: "Vente", cls: "bg-fill text-onfill" },
  waste: { label: "Perte", cls: "bg-alert text-white" },
  count: { label: "Inventaire", cls: "bg-prep text-[#1C1612]" },
};

// ─── Parsing / formatage fr-FR ───

/** « 1,5 » / « 1.5 » → 1.5 ; vide ou invalide → null. Jamais négatif. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** « 12,50 » (euros saisis) → 1250 centimes ; invalide → null. */
export function parseEurosToCents(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null ? null : Math.round(n * 100);
}

/** 1250 centimes → « 12,50 » (pré-remplissage d'un champ euros). */
export const centsToInput = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",");

/** Quantité en unité de base, fr-FR, 3 décimales max. */
export const fmtQty = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

/** « 18/08/2026 · 14:32 » pour le journal des mouvements. */
export function fmtDateTimeFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Recherche insensible à la casse et aux accents. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// ─── Composants d'affichage ───

/** Pilule de catégorie (contour, libellé français). */
export function CategoryPill({ category }: { category: IngredientCategory }) {
  return <Pill variant="out">{CATEGORY_LABELS[category]}</Pill>;
}

/**
 * Chips allergènes compactes : 3 visibles + « +N » (title = liste complète),
 * alternative sr-only en texte.
 */
export function AllergenChips({ allergens }: { allergens: Allergen[] }) {
  if (!allergens.length) return <span className="text-mut">—</span>;
  const labels = allergens.map((a) => ALLERGEN_LABELS[a]);
  const visible = labels.slice(0, 3);
  const rest = labels.slice(3);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {visible.map((l) => (
        <span
          key={l}
          title={l}
          aria-hidden
          className="rounded-pill bg-white/6 px-1.5 py-0.5 text-[10px] font-semibold text-mut"
        >
          {l}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          title={rest.join(", ")}
          aria-hidden
          className="rounded-pill border-[1.5px] border-line px-1.5 py-0.5 text-[10px] font-semibold text-mut"
        >
          +{rest.length}
        </span>
      )}
      <span className="sr-only">Allergènes : {labels.join(", ")}</span>
    </span>
  );
}

/**
 * Jauge de stock : valeur vs seuil + barre fine (base zéro, échelle 2× seuil,
 * repère au niveau du seuil). Ambre sous seuil, rouge en rupture, vert sinon.
 */
export function StockGauge({
  stock,
  par,
  unit,
  isOut,
}: {
  stock: number;
  par: number;
  unit: BaseUnit;
  isOut: boolean;
}) {
  const scale = par > 0 ? par * 2 : Math.max(stock, 1);
  const ratio = Math.max(0, Math.min(1, scale > 0 ? stock / scale : 0));
  const below = stock < par;
  const fill = isOut ? "bg-alert" : below ? "bg-prep" : "bg-ok";
  const valueCls = isOut ? "text-alertt" : below ? "text-prept" : "text-ink";
  const parPos = par > 0 ? (par / scale) * 100 : null;
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
        <span className={cx("text-sm font-bold", valueCls)}>
          {fmtQty(stock)} {UNIT_LABELS[unit]}
        </span>
        <span className="text-[11px] text-mut">
          / seuil {fmtQty(par)} {UNIT_LABELS[unit]}
        </span>
      </div>
      <div
        className="relative mt-1.5 h-1 w-[120px] overflow-hidden rounded-pill bg-white/10"
        aria-hidden
      >
        <div
          className={cx("h-full rounded-pill", fill)}
          style={{ width: `${ratio * 100}%` }}
        />
        {parPos !== null && (
          <span
            className="absolute inset-y-0 w-px bg-white/40"
            style={{ left: `${parPos}%` }}
          />
        )}
      </div>
    </div>
  );
}

/** Badge de type de mouvement (couleurs fonctionnelles fixes). */
export function MovementBadge({ type }: { type: StockMovementType }) {
  const meta = MOVEMENT_META[type] ?? MOVEMENT_META.count;
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.06em]",
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

/** État d'erreur standard : message rouge fonctionnel + bouton Réessayer. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-alert/40 bg-alert/10 px-6 py-8 text-center">
      <p className="text-sm font-bold text-alertt">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-pill border border-line bg-transparent px-3.5 py-[9px] text-xs font-semibold text-white transition-[opacity,background-color] duration-200 ease-sm hover:bg-white/6"
      >
        Réessayer
      </button>
    </div>
  );
}

/** Bouton destructif (rouge fonctionnel — pas de variante Btn dédiée au DS). */
export function DangerBtn({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-[9px] whitespace-nowrap rounded-pill bg-alert px-5 py-[13px] text-sm font-semibold tracking-[-0.2px] text-white transition-opacity duration-200 ease-sm hover:opacity-85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** En-tête de colonne de table standard. */
export function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-mut",
        className,
      )}
    >
      {children}
    </th>
  );
}
