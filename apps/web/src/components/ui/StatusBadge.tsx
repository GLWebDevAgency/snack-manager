import type { OrderStatus } from "@sm/contracts";
import { cx } from "@/lib/cx";

/**
 * Badge de statut commande — DÉCISION PRODUCTION (spec backoffice §2.6) :
 * couleurs FONCTIONNELLES fixes tous tenants, jamais l'accent de marque.
 * Statuts internes : new / preparing / ready / delivered / cancelled.
 */
const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  new: { label: "Nouvelle", cls: "bg-alert text-onalert" },
  preparing: { label: "En prépa", cls: "bg-prep text-onprep" },
  ready: { label: "Prête", cls: "bg-ok text-onok" },
  /*
   * `bg` et non `onfill` : le résolveur ajuste `mut` à ≥4,5:1 contre `ground`,
   * et `ground` est précisément ce que nomme `text-bg` — l'AA vient donc de la
   * construction, dans les DEUX modes.
   *
   * `text-onfill` ne tenait qu'en clair, où `onfill` vaut justement `ground`.
   * En sombre `onfill` bascule sur l'encre, un couple que rien n'ajuste :
   * mesuré 1,82 sur Nuit, 1,99 sur Néon, 2,85 en admin (#fff sur #999). Le
   * commentaire promettait « AA par construction » là où il n'y avait qu'une
   * coïncidence de mode.
   *
   * Conséquence assumée en back-office : le libellé « Remise » passe du blanc
   * au noir sur sa pastille grise — c'est le sens de la correction, pas un
   * effet de bord.
   */
  delivered: { label: "Remise", cls: "bg-mut text-bg" },
  cancelled: {
    label: "Annulée",
    cls: "border-[1.5px] border-alert bg-transparent text-alertt",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const s = STATUS[status] ?? STATUS.new; // statut inconnu → repli « Nouvelle »
  return (
    <span
      className={cx(
        // 10px : le 9px d'origine était sous le seuil de lisibilité de service.
        "inline-flex items-center whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]",
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}

/** Libellé français d'un statut (réutilisable hors badge). */
export const statusLabel = (status: OrderStatus) =>
  (STATUS[status] ?? STATUS.new).label;
