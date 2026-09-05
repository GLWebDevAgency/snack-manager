"use client";

/**
 * Panier du tunnel de commande — modèle, tarification et persistance.
 *
 * Les prix affichés ici sont une PRÉVISUALISATION : l’API recalcule tout à la
 * création de la commande depuis le menu courant (le client n’envoie jamais de
 * montant). Le panier est donc systématiquement réconcilié avec le menu qui
 * vient d’être chargé — un produit retiré de la carte ou passé en rupture ne
 * peut pas rester silencieusement dans le panier d’un client.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MenuCategory,
  MenuGroup,
  MenuProduct,
  MenuVariant,
  OrderLinePayload,
} from "./api";
import { uid } from "./helpers";

/** Même clé que le groupe tarifé et validé par l'API. */
export const SUPPLEMENT_GROUP = "supplements";

/**
 * La projection dédiée remplace entièrement l'ancien groupe réservé : ses
 * prix ET ses règles/defaults ne doivent plus agir derrière un contrôle masqué.
 * Les autres groupes (dont les suppléments manuels) gardent toutes leurs règles.
 */
export function effectiveGroups(product: MenuProduct): MenuGroup[] {
  return product.supplements.length > 0
    ? product.groups.filter(group => group.key !== SUPPLEMENT_GROUP)
    : product.groups;
}

function dedicatedSupplementKeys(product: MenuProduct, keys: string[]): string[] {
  return [...new Set(keys)].filter(key => product.supplements.some(supplement => supplement.key === key));
}

// ─────────────────────────────────────────────────────────────
// Modèle
// ─────────────────────────────────────────────────────────────

export type LineOption = {
  groupKey: string;
  groupName: string;
  choiceKey: string;
  name: string;
  /** Centimes, déjà intégrés à `unitPrice`. */
  priceDelta: number;
};

export type CartLine = {
  /** Identifiant local — permet de rouvrir/remplacer une ligne sans re-saisie. */
  lineId: string;
  productId: string;
  name: string;
  photoUrl: string | null;
  variantKey: string | null;
  variantName: string | null;
  options: LineOption[];
  removed: string[];
  note: string | null;
  qty: number;
  /** Prix unitaire prévisualisé (base + options), en centimes. */
  unitPrice: number;
};

/** Sélection en cours dans la fiche produit (avant validation). */
export type Draft = {
  /** Renseigné en édition : la ligne conserve son `lineId`. */
  lineId: string | null;
  product: MenuProduct;
  variantKey: string | null;
  /** Choix cochés, par clé de groupe. */
  picked: Record<string, string[]>;
  removed: string[];
  note: string;
  qty: number;
};

// ─────────────────────────────────────────────────────────────
// Règles d’options
// ─────────────────────────────────────────────────────────────

/** Bornes effectives d’un groupe pour la variante choisie (tacos : viandes = taille). */
export function groupRules(
  group: MenuGroup,
  variantKey: string | null,
): { min: number; max: number } {
  const rule = variantKey ? group.perVariant?.[variantKey] : undefined;
  const min = rule?.min ?? group.min ?? 0;
  const max = rule?.max ?? group.max ?? Number.POSITIVE_INFINITY;
  return { min, max: Math.max(min, max) };
}

/** Prix d’un choix, surchargé par variante quand la règle l’impose. */
export function choicePrice(
  group: MenuGroup,
  choiceKey: string,
  variantKey: string | null,
): number {
  const rule = variantKey ? group.perVariant?.[variantKey] : undefined;
  if (rule?.priceDelta !== undefined) return rule.priceDelta;
  return group.choices.find((c) => c.key === choiceKey)?.priceDelta ?? 0;
}

/** Prix de base : variante sélectionnée, sinon prix du produit. */
export function basePrice(product: MenuProduct, variantKey: string | null): number {
  if (product.variants.length === 0) return product.price;
  const variant = product.variants.find((v) => v.key === variantKey);
  return variant?.price ?? product.fromPrice;
}

/** Draft neuf, pré-rempli des choix obligatoires par défaut. */
export function newDraft(product: MenuProduct): Draft {
  const variantKey = product.variants[0]?.key ?? null;
  return {
    lineId: null,
    product,
    variantKey,
    picked: defaultPicks(product, variantKey),
    removed: [],
    note: "",
    qty: 1,
  };
}

/**
 * Pré-sélection des groupes à choix unique obligatoires (« Pain », « Taille »).
 * Un client ne doit pas avoir à cocher ce qui n’a qu’une réponse possible.
 */
function defaultPicks(
  product: MenuProduct,
  variantKey: string | null,
): Record<string, string[]> {
  const picked: Record<string, string[]> = {};
  for (const group of effectiveGroups(product)) {
    const { min } = groupRules(group, variantKey);
    picked[group.key] =
      group.type === "single" && min >= 1 && group.choices.length === 1
        ? [group.choices[0].key]
        : [];
  }
  return picked;
}

/** Draft reconstruit depuis une ligne existante — « Modifier » ne re-saisit rien. */
export function draftFromLine(line: CartLine, product: MenuProduct): Draft {
  const picked: Record<string, string[]> = {};
  for (const group of effectiveGroups(product)) {
    picked[group.key] = line.options
      .filter((o) => o.groupKey === group.key)
      .map((o) => o.choiceKey)
      .filter((key) => group.choices.some((c) => c.key === key));
  }
  if (product.supplements.length > 0) {
    picked[SUPPLEMENT_GROUP] = dedicatedSupplementKeys(product,
      line.options.filter(option => option.groupKey === SUPPLEMENT_GROUP).map(option => option.choiceKey));
  }
  const variantKey =
    line.variantKey && product.variants.some((v) => v.key === line.variantKey)
      ? line.variantKey
      : (product.variants[0]?.key ?? null);
  return {
    lineId: line.lineId,
    product,
    variantKey,
    picked,
    removed: line.removed.filter((r) => product.removables.some((x) => x.key === r)),
    note: line.note ?? "",
    qty: Math.max(1, line.qty),
  };
}

/** Bascule un choix, en respectant single/multi et le plafond du groupe. */
export function toggleChoice(
  draft: Draft,
  group: MenuGroup,
  choiceKey: string,
): Draft {
  const current = draft.picked[group.key] ?? [];
  const { max } = groupRules(group, draft.variantKey);
  let next: string[];
  if (group.type === "single" || max === 1) {
    // Choix unique : re-cliquer décoche seulement si le groupe est facultatif.
    const { min } = groupRules(group, draft.variantKey);
    next = current[0] === choiceKey && min === 0 ? [] : [choiceKey];
  } else if (current.includes(choiceKey)) {
    next = current.filter((k) => k !== choiceKey);
  } else if (current.length >= max) {
    return draft; // plafond atteint : sélection inchangée
  } else {
    next = [...current, choiceKey];
  }
  return { ...draft, picked: { ...draft.picked, [group.key]: next } };
}

/**
 * Changement de variante : les sélections dépassant le nouveau plafond sont
 * tronquées (passer un tacos XXL en M ramène 4 viandes à 1).
 */
export function setVariant(draft: Draft, variantKey: string): Draft {
  const picked: Record<string, string[]> = {};
  for (const group of effectiveGroups(draft.product)) {
    const { min, max } = groupRules(group, variantKey);
    const kept = (draft.picked[group.key] ?? []).slice(
      0,
      Number.isFinite(max) ? max : undefined,
    );
    picked[group.key] =
      kept.length === 0 && group.type === "single" && min >= 1 && group.choices.length === 1
        ? [group.choices[0].key]
        : kept;
  }
  if (draft.product.supplements.length > 0) {
    picked[SUPPLEMENT_GROUP] = dedicatedSupplementKeys(draft.product, draft.picked[SUPPLEMENT_GROUP] ?? []);
  }
  return { ...draft, variantKey, picked };
}

/** Options du draft, aplaties et tarifées (ordre des groupes du menu). */
export function draftOptions(draft: Draft): LineOption[] {
  const options: LineOption[] = [];
  for (const group of effectiveGroups(draft.product)) {
    for (const choiceKey of new Set(draft.picked[group.key] ?? [])) {
      const choice = group.choices.find((c) => c.key === choiceKey);
      if (!choice) continue;
      options.push({
        groupKey: group.key,
        groupName: group.name,
        choiceKey: choice.key,
        name: choice.name,
        priceDelta: choicePrice(group, choice.key, draft.variantKey),
      });
    }
  }
  for (const key of dedicatedSupplementKeys(draft.product, draft.picked[SUPPLEMENT_GROUP] ?? [])) {
    const supplement = draft.product.supplements.find(item => item.key === key)!;
    options.push({ groupKey: SUPPLEMENT_GROUP, groupName: "Suppléments", choiceKey: key,
      name: supplement.label, priceDelta: supplement.priceCents });
  }
  return options;
}

/** Prix unitaire prévisualisé du draft. */
export function draftUnitPrice(draft: Draft): number {
  return (
    basePrice(draft.product, draft.variantKey) +
    draftOptions(draft).reduce((sum, o) => sum + o.priceDelta, 0)
  );
}

/**
 * Premier groupe non satisfait — sert à désactiver le CTA et à l’expliquer.
 *
 * Le libellé atterrit dans un bouton de 240 px : il doit tenir sans troncature.
 * D’où la forme courte « Choisissez : Viandes » plutôt qu’une phrase.
 */
export function draftBlocker(draft: Draft): string | null {
  if (draft.product.variants.length > 0 && !draft.variantKey) {
    return "Choisissez le format";
  }
  for (const group of effectiveGroups(draft.product)) {
    const { min, max } = groupRules(group, draft.variantKey);
    const count = (draft.picked[group.key] ?? []).length;
    if (count < min) {
      const missing = min - count;
      if (min === max && min > 1) {
        return `Choisissez ${min} ${group.name.toLowerCase()}`;
      }
      return missing > 1
        ? `Encore ${missing} · ${group.name}`
        : `Choisissez : ${group.name}`;
    }
    if (count > max) return `${group.name} : ${max} maximum`;
  }
  return null;
}

/** Draft → ligne de panier (création ou remplacement à `lineId` constant). */
export function draftToLine(draft: Draft): CartLine {
  const variant: MenuVariant | undefined = draft.product.variants.find(
    (v) => v.key === draft.variantKey,
  );
  const options = draftOptions(draft);
  return {
    lineId: draft.lineId ?? uid(),
    productId: draft.product.id,
    name: draft.product.name,
    photoUrl: draft.product.photoUrl,
    variantKey: variant?.key ?? null,
    variantName: variant?.name ?? null,
    options,
    removed: draft.removed,
    note: draft.note.trim() || null,
    qty: draft.qty,
    unitPrice:
      basePrice(draft.product, draft.variantKey) +
      options.reduce((sum, o) => sum + o.priceDelta, 0),
  };
}

/** Récapitulatif d’une ligne : « L · Kefta, Steak · sans oignons ». */
export function lineSummary(line: CartLine): string {
  return [
    line.variantName,
    ...line.options.map((o) => o.name),
    ...line.removed.map((r) => `sans ${r}`),
  ]
    .filter(Boolean)
    .join(" · ");
}

export const lineTotal = (line: CartLine) => line.unitPrice * line.qty;

export const cartSubtotal = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + lineTotal(l), 0);

export const cartCount = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + l.qty, 0);

/** Lignes du panier → charge utile API (aucun prix transmis). */
export function toOrderLines(lines: CartLine[]): OrderLinePayload[] {
  return lines.map((line) => ({
    productId: line.productId,
    ...(line.variantKey ? { variantKey: line.variantKey } : {}),
    options: line.options.map((o) => ({
      groupKey: o.groupKey,
      choiceKey: o.choiceKey,
    })),
    removed: line.removed,
    ...(line.note ? { note: line.note } : {}),
    qty: line.qty,
  }));
}

// ─────────────────────────────────────────────────────────────
// Index du menu + réconciliation
// ─────────────────────────────────────────────────────────────

export type MenuIndex = Map<string, MenuProduct>;

export function indexMenu(categories: MenuCategory[]): MenuIndex {
  const index: MenuIndex = new Map();
  for (const category of categories) {
    for (const product of category.products) index.set(product.id, product);
  }
  return index;
}

/**
 * Réaligne un panier restauré sur le menu courant : produits disparus ou en
 * rupture écartés, prix et libellés rafraîchis, options obsolètes purgées.
 */
export function reconcile(
  lines: CartLine[],
  index: MenuIndex,
): { lines: CartLine[]; dropped: string[] } {
  const kept: CartLine[] = [];
  const dropped: string[] = [];

  for (const line of lines) {
    const product = index.get(line.productId);
    if (!product || product.outOfStock) {
      dropped.push(line.name);
      continue;
    }
    const draft = draftFromLine(line, product);
    if (draftBlocker(draft)) {
      // La configuration enregistrée ne satisfait plus la carte (option retirée).
      dropped.push(line.name);
      continue;
    }
    kept.push({ ...draftToLine(draft), lineId: line.lineId, qty: line.qty });
  }
  return { lines: kept, dropped };
}

// ─────────────────────────────────────────────────────────────
// Persistance (panier survivant au rafraîchissement, par restaurant)
// ─────────────────────────────────────────────────────────────

const CART_VERSION = 1;
const cartKey = (slug: string) => `sm.cart.${slug}`;
const customerKey = "sm.customer";

export type Customer = { name: string; phone: string };

type Stored = { v: number; at: number; lines: CartLine[]; note: string };

/** Un panier oublié depuis plus de 12 h n’a plus de sens (le service est passé). */
const CART_TTL_MS = 12 * 60 * 60 * 1000;

function readCart(slug: string): { lines: CartLine[]; note: string } {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    if (!raw) return { lines: [], note: "" };
    const parsed = JSON.parse(raw) as Stored;
    if (parsed?.v !== CART_VERSION || !Array.isArray(parsed.lines)) {
      return { lines: [], note: "" };
    }
    if (Date.now() - Number(parsed.at ?? 0) > CART_TTL_MS) {
      return { lines: [], note: "" };
    }
    return { lines: parsed.lines, note: String(parsed.note ?? "") };
  } catch {
    return { lines: [], note: "" };
  }
}

function writeCart(slug: string, lines: CartLine[], note: string) {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(cartKey(slug));
      return;
    }
    const payload: Stored = { v: CART_VERSION, at: Date.now(), lines, note };
    localStorage.setItem(cartKey(slug), JSON.stringify(payload));
  } catch {
    // Navigation privée / quota : le panier reste simplement en mémoire.
  }
}

export function readCustomer(): Customer {
  try {
    const raw = localStorage.getItem(customerKey);
    if (!raw) return { name: "", phone: "" };
    const parsed = JSON.parse(raw) as Partial<Customer>;
    return { name: String(parsed?.name ?? ""), phone: String(parsed?.phone ?? "") };
  } catch {
    return { name: "", phone: "" };
  }
}

export function writeCustomer(customer: Customer) {
  try {
    localStorage.setItem(customerKey, JSON.stringify(customer));
  } catch {
    /* non bloquant */
  }
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export type CartApi = {
  lines: CartLine[];
  note: string;
  count: number;
  subtotal: number;
  /** `true` tant que le panier persisté n’a pas été relu (évite un flash). */
  hydrated: boolean;
  /** Produits écartés à la réconciliation — à annoncer une seule fois. */
  dropped: string[];
  clearDropped: () => void;
  upsert: (line: CartLine) => void;
  setQty: (lineId: string, qty: number) => void;
  remove: (lineId: string) => void;
  setNote: (note: string) => void;
  clear: () => void;
};

/**
 * Panier persisté par restaurant. La relecture se fait APRÈS le montage :
 * le rendu serveur et le premier rendu client sont donc identiques (pas de
 * divergence d’hydratation), puis le panier réel apparaît.
 */
export function useCart(slug: string, index: MenuIndex): CartApi {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNoteState] = useState("");
  const [dropped, setDropped] = useState<string[]>([]);
  // Restaurant pour lequel le panier persisté a déjà été relu — sert aussi de
  // drapeau « hydraté », sans ref écrite pendant le rendu.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const hydrated = loadedFor === slug;

  useEffect(() => {
    if (loadedFor === slug) return;
    const stored = readCart(slug);
    const result = reconcile(stored.lines, index);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- relecture du panier persisté APRÈS le montage, volontairement : lue au rendu elle divergerait entre serveur et client. `loadedFor` sert de drapeau « hydraté » qui autorise l'écriture de l'effet suivant ; inverser cet ordre ferait réécrire le panier vide du premier rendu par-dessus la commande en cours du client.
    setLines(result.lines);
    setNoteState(stored.note);
    setDropped(result.dropped);
    setLoadedFor(slug);
  }, [slug, index, loadedFor]);

  useEffect(() => {
    if (!hydrated) return;
    writeCart(slug, lines, note);
  }, [hydrated, slug, lines, note]);

  const upsert = useCallback((line: CartLine) => {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.lineId === line.lineId);
      if (at === -1) return [...prev, line];
      const next = [...prev];
      next[at] = line;
      return next;
    });
  }, []);

  const setQty = useCallback((lineId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.lineId !== lineId)
        : prev.map((l) =>
            l.lineId === lineId ? { ...l, qty: Math.min(99, qty) } : l,
          ),
    );
  }, []);

  const remove = useCallback((lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setNoteState("");
  }, []);

  return useMemo(
    () => ({
      lines,
      note,
      count: cartCount(lines),
      subtotal: cartSubtotal(lines),
      hydrated,
      dropped,
      clearDropped: () => setDropped([]),
      upsert,
      setQty,
      remove,
      setNote: setNoteState,
      clear,
    }),
    [lines, note, hydrated, dropped, upsert, setQty, remove, clear],
  );
}
