"use client";

/**
 * Onglet Fournisseurs : cartes fournisseur (contact, conditions, jours de
 * livraison), table des références (conditionnement, prix colis, prix/unité,
 * mini historique — flèche ROUGE fonctionnelle si hausse), édition de prix
 * inline (l'API historise l'ancien prix) et ajout de référence.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SupplyIngredient,
  SupplySupplier,
  SupplySupplierItem,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { cx } from "@/lib/cx";
import {
  Btn,
  Drawer,
  EmptyState,
  Field,
  Icon,
  IconBtn,
  Input,
  Modal,
  Panel,
  Pill,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  DangerBtn,
  ErrorState,
  Th,
  UNIT_LABELS,
  centsToInput,
  fmtQty,
  parseDecimal,
  parseEurosToCents,
} from "./shared";

/** Dernier prix historisé d'une référence (null = jamais changé). */
type PrevPrice = { packPriceCents: number; recordedAt: string } | null;

type PriceHistoryResponse = {
  current: { packPriceCents: number; updatedAt: string };
  history: { id: string; packPriceCents: number; recordedAt: string }[];
};

export function SuppliersTab({
  ingredients,
  priceUpItemIds,
  filterPriceUp,
  onClearFilter,
  onReloadAlerts,
}: {
  ingredients: SupplyIngredient[];
  /** Références en hausse de prix (< 30 j) d'après /supply/alerts. */
  priceUpItemIds: ReadonlySet<string>;
  filterPriceUp: boolean;
  onClearFilter: () => void;
  onReloadAlerts: () => void;
}) {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<SupplySupplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prevPrices, setPrevPrices] = useState<Record<string, PrevPrice>>({});
  const [drawer, setDrawer] = useState<
    { mode: "create" } | { mode: "edit"; supplier: SupplySupplier } | null
  >(null);
  const [itemModal, setItemModal] = useState<SupplySupplier | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.get<SupplySupplier[]>("/supply/suppliers");
      setSuppliers(list);
      // Mini historique : dernier prix historisé de chaque référence.
      const items = list.flatMap((s) => s.items);
      const entries = await Promise.all(
        items.map(async (it): Promise<[string, PrevPrice]> => {
          try {
            const h = await api.get<PriceHistoryResponse>(
              `/supply/items/${it.id}/price-history`,
            );
            const last = h.history[0];
            return [
              it.id,
              last
                ? {
                    packPriceCents: last.packPriceCents,
                    recordedAt: last.recordedAt,
                  }
                : null,
            ];
          } catch {
            return [it.id, null];
          }
        }),
      );
      setPrevPrices(Object.fromEntries(entries));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Chargement des fournisseurs impossible",
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone en deux temps : la liste des fournisseurs, PUIS un Promise.all des derniers prix par article. Sans lui, la colonne « prix précédent » et le filtre « prix en hausse » n'auraient aucune donnée.
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!suppliers) return null;
    if (!filterPriceUp) return suppliers;
    return suppliers
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => priceUpItemIds.has(it.id)),
      }))
      .filter((s) => s.items.length > 0);
  }, [suppliers, filterPriceUp, priceUpItemIds]);

  function upsertSupplier(next: SupplySupplier) {
    setSuppliers((list) => {
      const base = list ?? [];
      const exists = base.some((s) => s.id === next.id);
      const merged = exists
        ? base.map((s) => (s.id === next.id ? { ...s, ...next } : s))
        : [...base, next];
      return merged.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    });
  }

  function onPriceSaved(
    supplierId: string,
    updated: SupplySupplierItem,
    previousCents: number,
  ) {
    setSuppliers((list) =>
      (list ?? []).map((s) =>
        s.id === supplierId
          ? {
              ...s,
              items: s.items.map((it) =>
                it.id === updated.id
                  ? {
                      ...it,
                      packPriceCents: updated.packPriceCents,
                      packQty: updated.packQty,
                    }
                  : it,
              ),
            }
          : s,
      ),
    );
    if (updated.packPriceCents !== previousCents) {
      // L'API vient d'historiser l'ancien prix.
      setPrevPrices((m) => ({
        ...m,
        [updated.id]: {
          packPriceCents: previousCents,
          recordedAt: new Date().toISOString(),
        },
      }));
      onReloadAlerts();
    }
    toast("Prix mis à jour — historique conservé", { icon: "check" });
  }

  // ── États chargement / erreur ──
  if (error)
    return <ErrorState message={error} onRetry={() => void load()} />;
  if (!visible)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[220px]" />
      </div>
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {filterPriceUp && (
          <button
            type="button"
            onClick={onClearFilter}
            className="cf-press inline-flex items-center gap-1.5 rounded-pill border border-gold/60 bg-gold/10 px-3 py-[7px] text-[13px] font-semibold text-gold hover:bg-gold/16"
          >
            Filtre : Hausses de prix
            <Icon name="close" size={12} />
            <span className="sr-only">— retirer le filtre</span>
          </button>
        )}
        <Btn
          icon="plus"
          className="ml-auto"
          onClick={() => setDrawer({ mode: "create" })}
        >
          Nouveau fournisseur
        </Btn>
      </div>

      {visible.length === 0 ? (
        <Panel title="Fournisseurs">
          {filterPriceUp ? (
            <EmptyState
              icon="euro"
              title="Aucune hausse de prix récente"
              hint="Aucune référence n'a augmenté sur les 30 derniers jours."
            />
          ) : (
            <EmptyState
              icon="cart"
              title="Aucun fournisseur"
              hint="Ajoutez vos fournisseurs pour suivre les prix d'achat et leur historique."
              action={
                <Btn
                  size="sm"
                  icon="plus"
                  onClick={() => setDrawer({ mode: "create" })}
                >
                  Nouveau fournisseur
                </Btn>
              }
            />
          )}
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              prevPrices={prevPrices}
              priceUpItemIds={priceUpItemIds}
              onEdit={() => {
                // Édite le fournisseur complet (items inclus), pas la copie filtrée.
                const full = suppliers?.find((x) => x.id === s.id) ?? s;
                setDrawer({ mode: "edit", supplier: full });
              }}
              onAddItem={() => {
                const full = suppliers?.find((x) => x.id === s.id) ?? s;
                setItemModal(full);
              }}
              onPriceSaved={(item, prev) => onPriceSaved(s.id, item, prev)}
            />
          ))}
        </div>
      )}

      {drawer && (
        <SupplierDrawer
          initial={drawer.mode === "edit" ? drawer.supplier : null}
          onClose={() => setDrawer(null)}
          onSaved={upsertSupplier}
          onDeleted={(id) =>
            setSuppliers((list) => (list ?? []).filter((s) => s.id !== id))
          }
        />
      )}
      {itemModal && (
        <ItemModal
          supplier={itemModal}
          ingredients={ingredients}
          onClose={() => setItemModal(null)}
          onAdded={() => {
            setItemModal(null);
            // Rechargement : la réponse de création n'est pas hydratée
            // (ingredient/brand) — la liste complète l'est.
            void load();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Carte fournisseur
// ─────────────────────────────────────────────────────────────

function SupplierCard({
  supplier,
  prevPrices,
  priceUpItemIds,
  onEdit,
  onAddItem,
  onPriceSaved,
}: {
  supplier: SupplySupplier;
  prevPrices: Record<string, PrevPrice>;
  priceUpItemIds: ReadonlySet<string>;
  onEdit: () => void;
  onAddItem: () => void;
  onPriceSaved: (item: SupplySupplierItem, previousCents: number) => void;
}) {
  const contact = [supplier.contactName, supplier.phone, supplier.email]
    .filter(Boolean)
    .join(" · ");
  return (
    <Panel
      title={supplier.name}
      sub={contact || "Aucun contact renseigné"}
      actions={
        <>
          <Btn variant="ghost" size="sm" icon="plus" onClick={onAddItem}>
            Référence
          </Btn>
          <IconBtn
            icon="edit"
            label={`Modifier ${supplier.name}`}
            size={32}
            iconSize={15}
            onClick={onEdit}
          />
        </>
      }
    >
      {(supplier.deliveryDays || supplier.paymentTerms || supplier.notes) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {supplier.deliveryDays && (
            <Pill variant="out">Livraison : {supplier.deliveryDays}</Pill>
          )}
          {supplier.paymentTerms && (
            <Pill variant="out">Règlement : {supplier.paymentTerms}</Pill>
          )}
          {supplier.notes && (
            <span className="text-[13px] text-mut" title={supplier.notes}>
              {supplier.notes}
            </span>
          )}
        </div>
      )}

      {supplier.items.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Aucune référence"
          hint="Ajoutez les produits achetés chez ce fournisseur pour suivre leurs prix."
          className="p-6"
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line2">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-white/3">
                <Th>Ingrédient</Th>
                <Th>Marque</Th>
                <Th className="text-right">Conditionnement</Th>
                <Th className="text-right">Prix du colis</Th>
                <Th className="text-right">Prix / unité</Th>
                <Th>Historique</Th>
              </tr>
            </thead>
            <tbody>
              {supplier.items.map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  prev={prevPrices[it.id] ?? null}
                  highlight={priceUpItemIds.has(it.id)}
                  onPriceSaved={onPriceSaved}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ItemRow({
  item,
  prev,
  highlight,
  onPriceSaved,
}: {
  item: SupplySupplierItem;
  prev: PrevPrice;
  highlight: boolean;
  onPriceSaved: (item: SupplySupplierItem, previousCents: number) => void;
}) {
  const unit = item.ingredient ? UNIT_LABELS[item.ingredient.unit] : "";
  const unitPriceCents =
    item.packQty > 0 ? Math.round(item.packPriceCents / item.packQty) : null;
  return (
    <tr
      className={cx(
        "border-b border-line2 last:border-b-0",
        highlight && "bg-gold/5",
      )}
    >
      <td className="px-4 py-2.5">
        <span className="font-bold text-ink">
          {item.ingredient?.name ?? "Ingrédient supprimé"}
        </span>
        {item.sku && (
          <span className="ml-2 text-[11px] text-mut">réf. {item.sku}</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-mut">{item.brand?.name ?? "—"}</td>
      <td className="cf-fig whitespace-nowrap px-4 py-2.5 text-right font-semibold text-ink">
        {fmtQty(item.packQty)} {unit}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <PriceEditor item={item} onSaved={onPriceSaved} />
      </td>
      <td className="cf-fig whitespace-nowrap px-4 py-2.5 text-right text-mut">
        {unitPriceCents !== null ? (
          <>
            {fmtEuro(unitPriceCents)} / {unit}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <PriceTrend current={item.packPriceCents} prev={prev} />
      </td>
    </tr>
  );
}

/** Dernier vs précédent — flèche ROUGE fonctionnelle si hausse (spec). */
function PriceTrend({ current, prev }: { current: number; prev: PrevPrice }) {
  if (!prev) return <span className="text-mut">Premier prix</span>;
  const diff = current - prev.packPriceCents;
  const pctText =
    prev.packPriceCents > 0
      ? `${Math.abs((diff / prev.packPriceCents) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
      : null;
  if (diff === 0)
    return (
      <span className="text-[13px] text-mut tabular-nums">
        = {fmtEuro(prev.packPriceCents)}
      </span>
    );
  const up = diff > 0;
  return (
    <span
      className={cx(
        "text-[13px] font-bold tabular-nums",
        up ? "text-alertt" : "text-okt",
      )}
      title={`Prix précédent : ${fmtEuro(prev.packPriceCents)}`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "En hausse :" : "En baisse :"}</span>{" "}
      {pctText ?? fmtEuro(Math.abs(diff))}
      <span className="ml-1.5 font-normal text-mut">
        préc. {fmtEuro(prev.packPriceCents)}
      </span>
    </span>
  );
}

/** Prix du colis éditable inline — PATCH /supply/items/:id (historisé côté API). */
function PriceEditor({
  item,
  onSaved,
}: {
  item: SupplySupplierItem;
  onSaved: (item: SupplySupplierItem, previousCents: number) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  function start() {
    setValue(centsToInput(item.packPriceCents));
    setEditing(true);
  }

  async function save() {
    const cents = parseEurosToCents(value);
    if (cents === null) {
      toast("Montant invalide (ex. 24,90)");
      return;
    }
    if (cents === item.packPriceCents) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patch<SupplySupplierItem>(
        `/supply/items/${item.id}`,
        { packPriceCents: cents },
      );
      onSaved(updated, item.packPriceCents);
      setEditing(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (!editing)
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="cf-fig text-[15px] font-extrabold text-ink">
          {fmtEuro(item.packPriceCents)}
        </span>
        <IconBtn
          icon="edit"
          label={`Modifier le prix — ${item.ingredient?.name ?? "référence"}`}
          size={26}
          iconSize={12}
          onClick={start}
        />
      </span>
    );

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        autoFocus
        inputMode="decimal"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label="Nouveau prix du colis en euros"
        className="w-24 px-2.5 py-1.5 text-right text-sm tabular-nums"
      />
      <IconBtn
        icon="check"
        label="Enregistrer le prix"
        size={26}
        iconSize={12}
        disabled={saving}
        onClick={() => void save()}
      />
      <IconBtn
        icon="close"
        label="Annuler la modification"
        size={26}
        iconSize={12}
        disabled={saving}
        onClick={() => setEditing(false)}
      />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer fournisseur (création / édition / suppression douce)
// ─────────────────────────────────────────────────────────────

function SupplierDrawer({
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial: SupplySupplier | null;
  onClose: () => void;
  onSaved: (s: SupplySupplier) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const isEdit = initial !== null;
  const [draft, setDraft] = useState({
    name: initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    paymentTerms: initial?.paymentTerms ?? "",
    deliveryDays: initial?.deliveryDays ?? "",
    notes: initial?.notes ?? "",
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = (key: keyof typeof draft, v: string) =>
    setDraft((d) => ({ ...d, [key]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setNameError("Le nom est requis.");
      return;
    }
    setNameError(null);
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      ...(draft.contactName.trim()
        ? { contactName: draft.contactName.trim() }
        : {}),
      ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.paymentTerms.trim()
        ? { paymentTerms: draft.paymentTerms.trim() }
        : {}),
      ...(draft.deliveryDays.trim()
        ? { deliveryDays: draft.deliveryDays.trim() }
        : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    };
    try {
      if (isEdit && initial) {
        const updated = await api.patch<Omit<SupplySupplier, "items">>(
          `/supply/suppliers/${initial.id}`,
          body,
        );
        onSaved({ ...initial, ...updated, items: initial.items });
        toast("Fournisseur mis à jour", { icon: "check" });
      } else {
        const created = await api.post<SupplySupplier>(
          "/supply/suppliers",
          body,
        );
        onSaved(created);
        toast(`« ${created.name} » ajouté`, { icon: "check" });
      }
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial) return;
    setDeleting(true);
    try {
      await api.del(`/supply/suppliers/${initial.id}`);
      toast(`« ${initial.name} » supprimé`, { icon: "check" });
      onDeleted(initial.id);
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Suppression impossible");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={isEdit ? "Modifier le fournisseur" : "Nouveau fournisseur"}
        footer={
          <div className="flex items-center gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cf-press mr-auto rounded-pill px-2 py-1 text-[13px] font-semibold text-alertt hover:bg-alert/12 hover:text-alert"
              >
                Supprimer
              </button>
            )}
            <Btn variant="ghost" size="sm" onClick={onClose} className="ml-auto">
              Annuler
            </Btn>
            <Btn type="submit" size="sm" form="sm-supplier-form" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Btn>
          </div>
        }
      >
        <form
          id="sm-supplier-form"
          onSubmit={save}
          className="flex flex-col gap-4 px-[18px] py-4"
        >
          <Field label="Nom" htmlFor="sup-name" error={nameError}>
            <Input
              id="sup-name"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ex. Metro Nanterre"
              maxLength={120}
              autoFocus={!isEdit}
            />
          </Field>
          <Field label="Contact" htmlFor="sup-contact">
            <Input
              id="sup-contact"
              value={draft.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              placeholder="Ex. Karim"
              maxLength={120}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Téléphone" htmlFor="sup-phone">
              <Input
                id="sup-phone"
                type="tel"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="06 12 34 56 78"
                maxLength={30}
              />
            </Field>
            <Field label="E-mail" htmlFor="sup-email">
              <Input
                id="sup-email"
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="contact@exemple.fr"
              />
            </Field>
          </div>
          <Field
            label="Conditions de règlement"
            htmlFor="sup-terms"
            hint="Ex. « 30 j fin de mois », « comptant »."
          >
            <Input
              id="sup-terms"
              value={draft.paymentTerms}
              onChange={(e) => set("paymentTerms", e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field
            label="Jours de livraison"
            htmlFor="sup-days"
            hint="Ex. « mar, ven »."
          >
            <Input
              id="sup-days"
              value={draft.deliveryDays}
              onChange={(e) => set("deliveryDays", e.target.value)}
              maxLength={100}
            />
          </Field>
          <Field label="Notes" htmlFor="sup-notes">
            <Textarea
              id="sup-notes"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={500}
            />
          </Field>
        </form>
      </Drawer>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Supprimer « ${initial?.name ?? ""} » ?`}
        destructive
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Btn>
            <DangerBtn onClick={remove} disabled={deleting}>
              {deleting ? "Suppression…" : "Supprimer"}
            </DangerBtn>
          </>
        }
      >
        <p className="text-mut">
          Le fournisseur sera retiré des listes. Son catalogue et l’historique
          de prix restent archivés (suppression douce).
        </p>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Modale « Nouvelle référence »
// ─────────────────────────────────────────────────────────────

function ItemModal({
  supplier,
  ingredients,
  onClose,
  onAdded,
}: {
  supplier: SupplySupplier;
  ingredients: SupplyIngredient[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [ingredientId, setIngredientId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [sku, setSku] = useState("");
  const [packQtyRaw, setPackQtyRaw] = useState("");
  const [priceRaw, setPriceRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = ingredients.find((i) => i.id === ingredientId) ?? null;
  const unit = selected ? UNIT_LABELS[selected.unit] : "";
  const packQty = parseDecimal(packQtyRaw);
  const priceCents = parseEurosToCents(priceRaw);
  const unitPriceCents =
    packQty && packQty > 0 && priceCents !== null
      ? Math.round(priceCents / packQty)
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) {
      setError("Choisissez un ingrédient.");
      return;
    }
    if (packQty === null || packQty <= 0) {
      setError("Conditionnement invalide (quantité par colis > 0).");
      return;
    }
    if (priceCents === null) {
      setError("Prix du colis invalide (ex. 24,90).");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.post(`/supply/suppliers/${supplier.id}/items`, {
        ingredientId,
        ...(brandId ? { brandId } : {}),
        ...(sku.trim() ? { sku: sku.trim() } : {}),
        packQty,
        packPriceCents: priceCents,
      });
      toast("Référence ajoutée", { icon: "check" });
      onAdded();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Ajout impossible — réessayez.",
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Nouvelle référence — ${supplier.name}`}
      width={480}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Annuler
          </Btn>
          <Btn type="submit" form="sm-item-form" disabled={saving}>
            {saving ? "Ajout…" : "Ajouter la référence"}
          </Btn>
        </>
      }
    >
      <form id="sm-item-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ingrédient" htmlFor="item-ing">
            <Select
              id="item-ing"
              value={ingredientId}
              onChange={(e) => {
                setIngredientId(e.target.value);
                setBrandId("");
              }}
            >
              <option value="">Choisir…</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Marque (optionnel)" htmlFor="item-brand">
            <Select
              id="item-brand"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              disabled={!selected || selected.brands.length === 0}
            >
              <option value="">—</option>
              {selected?.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Référence / SKU (optionnel)" htmlFor="item-sku">
          <Input
            id="item-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="Ex. MET-4521"
            maxLength={80}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Conditionnement${unit ? ` (${unit} / colis)` : ""}`}
            htmlFor="item-qty"
            hint="Quantité par colis en unité de base."
          >
            <Input
              id="item-qty"
              inputMode="decimal"
              value={packQtyRaw}
              onChange={(e) => setPackQtyRaw(e.target.value)}
              placeholder="Ex. 10"
              className="tabular-nums"
            />
          </Field>
          <Field label="Prix du colis (€ HT)" htmlFor="item-price">
            <Input
              id="item-price"
              inputMode="decimal"
              value={priceRaw}
              onChange={(e) => setPriceRaw(e.target.value)}
              placeholder="Ex. 24,90"
              className="tabular-nums"
            />
          </Field>
        </div>
        <p className="text-[13px] text-mut tabular-nums" aria-live="polite">
          {unitPriceCents !== null && selected && (
            <>
              Prix par {unit} :{" "}
              <span className="font-bold text-ink">
                {fmtEuro(unitPriceCents)}
              </span>
            </>
          )}
        </p>
        {error && (
          <p className="text-xs text-alertt" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
