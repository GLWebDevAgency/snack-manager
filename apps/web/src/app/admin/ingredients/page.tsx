"use client";

/**
 * Vue « Ingrédients & stocks » — point d'entrée /admin/ingredients.
 * Charge les ingrédients + les alertes (GET /supply/ingredients, /supply/alerts),
 * affiche le bandeau d'alertes cliquable (ruptures ROUGE / sous seuil AMBRE /
 * hausses de prix OR — couleurs fonctionnelles fixes, jamais l'accent tenant)
 * et branche les trois onglets. Toute mutation d'un onglet déclenche un
 * rafraîchissement silencieux (`onReloadAlerts`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupplyAlerts, SupplyIngredient } from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Chip, Icon, Skeleton, type IconName } from "@/components/ui";
import { ErrorState } from "./shared";
import { IngredientsTab, type IngredientAlertFilter } from "./ingredients-tab";
import { SuppliersTab } from "./suppliers-tab";
import { MovementsTab } from "./movements-tab";

type TabKey = "ingredients" | "suppliers" | "movements";

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: "ingredients", label: "Ingrédients", icon: "fries" },
  { key: "suppliers", label: "Fournisseurs", icon: "cart" },
  { key: "movements", label: "Mouvements", icon: "clock" },
];

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<SupplyIngredient[] | null>(
    null,
  );
  const [alerts, setAlerts] = useState<SupplyAlerts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("ingredients");
  const [alertFilter, setAlertFilter] = useState<IngredientAlertFilter>(null);
  const [priceUp, setPriceUp] = useState(false);

  const fetchAll = useCallback(async () => {
    const [list, next] = await Promise.all([
      api.get<SupplyIngredient[]>("/supply/ingredients"),
      api.get<SupplyAlerts>("/supply/alerts"),
    ]);
    setIngredients(list);
    setAlerts(next);
  }, []);

  /** Chargement initial / réessai : squelette puis données ou erreur. */
  const load = useCallback(async () => {
    setError(null);
    setIngredients(null);
    setAlerts(null);
    try {
      await fetchAll();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Chargement des stocks impossible",
      );
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Revalidation silencieuse après mutation : on garde l'affichage courant
   * (l'onglet a déjà appliqué sa mise à jour optimiste et signalé ses erreurs).
   */
  const refresh = useCallback(() => {
    void fetchAll().catch(() => {});
  }, [fetchAll]);

  // ── Mise à jour locale immédiate depuis l'onglet Ingrédients ──
  const upsert = useCallback((ing: SupplyIngredient) => {
    setIngredients((list) => {
      const base = list ?? [];
      const next = base.some((i) => i.id === ing.id)
        ? base.map((i) => (i.id === ing.id ? { ...i, ...ing } : i))
        : [...base, ing];
      return next.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    });
  }, []);

  const removeOne = useCallback((id: string) => {
    setIngredients((list) => (list ?? []).filter((i) => i.id !== id));
  }, []);

  const priceUpItemIds = useMemo(
    () => new Set((alerts?.priceIncreases ?? []).map((p) => p.itemId)),
    [alerts],
  );

  // Depuis un autre onglet la tuile ACTIVE toujours son filtre ; on ne bascule
  // (retrait du filtre) que si la table concernée est déjà à l'écran.
  function toggleStockAlert(key: Exclude<IngredientAlertFilter, null>) {
    setPriceUp(false);
    setAlertFilter((f) => (tab === "ingredients" && f === key ? null : key));
    setTab("ingredients");
  }

  function togglePriceAlert() {
    setAlertFilter(null);
    setPriceUp((v) => (tab === "suppliers" ? !v : true));
    setTab("suppliers");
  }

  // ── États globaux ──

  if (error && ingredients === null)
    return (
      <div className="p-[26px]">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );

  if (!ingredients || !alerts)
    return (
      <div className="p-[26px]">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[68px]" />
          <Skeleton className="h-[68px]" />
          <Skeleton className="h-[68px]" />
        </div>
        <div className="mb-4 flex gap-2">
          <Skeleton className="h-[34px] w-[150px]" />
          <Skeleton className="h-[34px] w-[150px]" />
          <Skeleton className="h-[34px] w-[150px]" />
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    );

  const rupturesCount = alerts.ruptures.length;
  const belowParCount = alerts.belowPar.length;
  const priceUpCount = alerts.priceIncreases.length;
  const totalAlerts = rupturesCount + belowParCount + priceUpCount;

  // Filtres DÉRIVÉS : une alerte résolue entre-temps retire son filtre
  // (sinon la table resterait vide sans raison visible).
  const activeFilter: IngredientAlertFilter =
    (alertFilter === "out" && rupturesCount === 0) ||
    (alertFilter === "belowPar" && belowParCount === 0)
      ? null
      : alertFilter;
  const activePriceUp = priceUp && priceUpCount > 0;

  return (
    <div className="p-[26px]">
      {/* ── Bandeau d'alertes (chaque tuile filtre la table) ── */}
      <div className="mb-4" aria-live="polite">
        {totalAlerts === 0 ? (
          <div className="flex items-center gap-2.5 rounded-ctrl border border-ok/35 bg-ok/8 px-4 py-3 text-[13px] text-ink">
            <span className="size-2.5 shrink-0 rounded-full bg-ok" aria-hidden />
            Aucune alerte — tous les stocks sont au-dessus de leur seuil et
            aucune hausse de prix relevée sur les 30 derniers jours.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AlertTile
              tone="alert"
              label="Ruptures"
              count={rupturesCount}
              hint={summarize(alerts.ruptures.map((i) => i.name))}
              active={activeFilter === "out"}
              action="Filtrer les ingrédients en rupture"
              onSelect={() => toggleStockAlert("out")}
            />
            <AlertTile
              tone="prep"
              label="Sous le seuil"
              count={belowParCount}
              hint={summarize(alerts.belowPar.map((i) => i.name))}
              active={activeFilter === "belowPar"}
              action="Filtrer les ingrédients à commander"
              onSelect={() => toggleStockAlert("belowPar")}
            />
            <AlertTile
              tone="gold"
              label="Hausses de prix"
              count={priceUpCount}
              hint={summarize(
                alerts.priceIncreases.map(
                  (p) =>
                    `${p.ingredientName} +${p.increasePct.toLocaleString("fr-FR")} %`,
                ),
              )}
              active={activePriceUp}
              action="Filtrer les références en hausse"
              onSelect={togglePriceAlert}
            />
          </div>
        )}
      </div>

      {/* ── Onglets ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Chip key={t.key} on={tab === t.key} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.key === "ingredients" && (
              <span className="cf-fig">· {ingredients.length}</span>
            )}
          </Chip>
        ))}
      </div>

      {/* ── Contenu de l'onglet ── */}
      {tab === "ingredients" && (
        <IngredientsTab
          ingredients={ingredients}
          alertFilter={activeFilter}
          onClearAlertFilter={() => setAlertFilter(null)}
          onChanged={upsert}
          onRemoved={removeOne}
          onReloadAlerts={refresh}
        />
      )}
      {tab === "suppliers" && (
        <SuppliersTab
          ingredients={ingredients}
          priceUpItemIds={priceUpItemIds}
          filterPriceUp={activePriceUp}
          onClearFilter={() => setPriceUp(false)}
          onReloadAlerts={refresh}
        />
      )}
      {tab === "movements" && <MovementsTab ingredients={ingredients} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tuile d'alerte
// ─────────────────────────────────────────────────────────────

type Tone = "alert" | "prep" | "gold";

/** Couleurs FONCTIONNELLES fixes (§2.6) — jamais l'accent tenant. */
const TONES: Record<Tone, { idle: string; on: string; value: string; dot: string }> =
  {
    alert: {
      idle: "border-alert/40 bg-alert/10 hover:bg-alert/15",
      on: "border-alert bg-alert/15",
      value: "text-alertt",
      dot: "bg-alert",
    },
    prep: {
      idle: "border-prep/40 bg-prep/10 hover:bg-prep/15",
      on: "border-prep bg-prep/15",
      value: "text-prept",
      dot: "bg-prep",
    },
    gold: {
      idle: "border-gold/40 bg-gold/10 hover:bg-gold/15",
      on: "border-gold bg-gold/15",
      value: "text-gold",
      dot: "bg-gold",
    },
  };

/** « Poulet · Cheddar +3 » — aperçu court des éléments concernés. */
function summarize(names: string[], max = 2): string {
  if (names.length === 0) return "";
  const head = names.slice(0, max).join(" · ");
  const rest = names.length - max;
  return rest > 0 ? `${head} +${rest}` : head;
}

function AlertTile({
  tone,
  label,
  count,
  hint,
  active,
  action,
  onSelect,
}: {
  tone: Tone;
  label: string;
  count: number;
  /** Aperçu des éléments concernés (une ligne, tronquée). */
  hint: string;
  active: boolean;
  /** Libellé d'action (title + alternative lecteur d'écran). */
  action: string;
  onSelect: () => void;
}) {
  const t = TONES[tone];
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={empty}
      aria-pressed={empty ? undefined : active}
      title={empty ? undefined : active ? `${action} — retirer le filtre` : action}
      className={cx(
        "cf-press-row flex items-center gap-3 rounded-ctrl border px-4 py-3 text-left",
        empty
          ? "cursor-default border-line bg-white/3"
          : active
            ? t.on
            : t.idle,
      )}
    >
      <span
        className={cx(
          "size-2.5 shrink-0 rounded-full",
          empty ? "bg-line" : t.dot,
        )}
        aria-hidden
      />
      <span
        className={cx(
          "cf-fig shrink-0 text-[26px] font-extrabold leading-none",
          empty ? "text-mut" : t.value,
        )}
      >
        {count}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-ink">{label}</span>
        <span className="block truncate text-xs text-mut">
          {empty ? "Rien à signaler" : hint}
        </span>
      </span>
      {active && (
        <>
          <Icon name="close" size={13} className="ml-auto shrink-0 text-mut" />
          <span className="sr-only">Filtre actif — cliquer pour le retirer</span>
        </>
      )}
    </button>
  );
}
