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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderLineInputSchema } from '@sm/contracts';
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
export const CHECKOUT_MAX_LINES = 50;
const checkoutLinesSchema = OrderLineInputSchema.strict().array().min(1).max(CHECKOUT_MAX_LINES);

/** Validate the actual outgoing selection before confirming a basket import. */
export function canSubmitCartLines(lines: CartLine[]): boolean {
  return checkoutLinesSchema.safeParse(toOrderLines(lines)).success;
}

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

/** Ignore catalogue ordering, labels and prices, but never lost/added choices
 * or deduplicated stored options. A different selection needs a new user action. */
function selectionKey(line: CartLine): string {
  return JSON.stringify([
    line.variantKey,
    line.options.map(option => JSON.stringify([option.groupKey, option.choiceKey])).sort(),
    [...line.removed].sort(),
  ]);
}

/**
 * Réaligne un panier restauré sur le menu courant : produits disparus ou en
 * rupture et configurations invalides écartés. Les prix et libellés ne sont
 * rafraîchis que lorsque tous les choix enregistrés restent identiques.
 */
export function reconcile(
  lines: CartLine[],
  index: MenuIndex,
): { lines: CartLine[]; dropped: string[] } {
  const kept: CartLine[] = [];
  const dropped: string[] = [];

  for (const line of lines) {
    const product = index.get(line.productId);
    if (!product || product.outOfStock || !Number.isSafeInteger(line.qty) || line.qty <= 0) {
      dropped.push(line.name);
      continue;
    }
    const draft = draftFromLine(line, product);
    const updated = draftToLine(draft);
    if (draftBlocker(draft) || selectionKey(line) !== selectionKey(updated)) {
      // draftFromLine is also used for explicit editing. Its fallbacks must
      // never silently substitute a variant or remove a choice during restore.
      dropped.push(line.name);
      continue;
    }
    kept.push(updated);
  }
  return { lines: kept, dropped };
}

// ─────────────────────────────────────────────────────────────
// Persistance (panier survivant au rafraîchissement, par restaurant)
// ─────────────────────────────────────────────────────────────

const CART_VERSION = 1;
const cartKey = (slug: string) => `sm.cart.${slug}`;

type CartSnapshot = { lines: CartLine[]; note: string };
type Stored = CartSnapshot & { v: number; at: number };
type CartRead = CartSnapshot & { readable: boolean };

/** Un panier oublié depuis plus de 12 h n’a plus de sens (le service est passé). */
const CART_TTL_MS = 12 * 60 * 60 * 1000;

function readCart(slug: string): CartRead {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    if (!raw) return { lines: [], note: "", readable: true };
    const parsed = JSON.parse(raw) as Stored;
    if (parsed?.v !== CART_VERSION || !Array.isArray(parsed.lines)) {
      return { lines: [], note: "", readable: false };
    }
    if (Date.now() - Number(parsed.at ?? 0) > CART_TTL_MS) {
      return { lines: [], note: "", readable: true };
    }
    return { lines: parsed.lines, note: String(parsed.note ?? ""), readable: true };
  } catch {
    return { lines: [], note: "", readable: false };
  }
}

/** Called only while holding the per-tenant Web Lock. Never swallow a failed write. */
function writeCart(slug: string, lines: CartLine[], note: string) {
  if (lines.length === 0 && !note) {
    localStorage.removeItem(cartKey(slug));
    return;
  }
  const payload: Stored = { v: CART_VERSION, at: Date.now(), lines, note };
  localStorage.setItem(cartKey(slug), JSON.stringify(payload));
}

const CART_STORAGE_ERROR = "Votre panier n’a pas pu être sauvegardé. Conservez cette page et autorisez le stockage du navigateur avant de continuer.";
const CART_EVENT = "sm:cart-change";

function withCartLock<T>(slug: string, action: () => T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) return Promise.reject(new Error(CART_STORAGE_ERROR));
  return navigator.locks.request(`sm.cart.write.${slug}`, { signal: AbortSignal.timeout(5_000) }, action);
}

function sameCart(left: CartSnapshot, right: CartSnapshot): boolean {
  return JSON.stringify(left.lines) === JSON.stringify(right.lines) && left.note === right.note;
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
  /** Receipt cleanup only. Recheck access inside the write lock; false keeps the
   * draft, including a newer cart from another tab. The guard must be synchronous. */
  clearIfUnchanged: (canClear?: () => boolean) => Promise<boolean>;
  /** Explicit historical selection import only. No replacement or partial
   * addition; authority is rechecked INSIDE the native cross-tab cart lock. */
  appendIfUnchanged: (lines: CartLine[], canAppend: () => Promise<boolean>) => Promise<boolean>;
  persistenceError: string | null;
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
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const current = useRef<{ slug: string | null; snapshot: CartSnapshot }>({ slug: null, snapshot: { lines: [], note: "" } });
  // Restaurant pour lequel le panier persisté a déjà été relu — sert aussi de
  // drapeau « hydraté », sans ref écrite pendant le rendu.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const hydrated = loadedFor === slug;

  const publish = useCallback((snapshot: CartSnapshot, removed: string[] = []) => {
    current.current = { slug, snapshot };
    setLines(snapshot.lines);
    setNoteState(snapshot.note);
    setDropped(removed);
    setLoadedFor(slug);
  }, [slug]);

  const readCurrent = useCallback(() => {
    const stored = readCart(slug);
    if (!stored.readable) throw new Error(CART_STORAGE_ERROR);
    const result = reconcile(stored.lines, index);
    return { snapshot: { lines: result.lines, note: stored.note }, dropped: result.dropped };
  }, [slug, index]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void withCartLock(slug, () => {
        if (!alive) return;
        const latest = readCurrent();
        publish(latest.snapshot, latest.dropped);
        setPersistenceError(null);
      }).catch(() => {
        if (!alive) return;
        setPersistenceError(CART_STORAGE_ERROR);
        setLoadedFor(slug);
      });
    };
    const changed = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== cartKey(slug)) return;
      if (event instanceof CustomEvent && event.detail !== slug) return;
      refresh();
    };
    refresh();
    window.addEventListener("storage", changed);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener(CART_EVENT, changed);
    return () => {
      alive = false;
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener(CART_EVENT, changed);
    };
  }, [slug, readCurrent, publish]);

  // Persist explicit actions, not a render effect: an old render can never
  // restore a cart after a receipt or overwrite another tab's newer draft.
  const mutate = useCallback((change: (snapshot: CartSnapshot) => CartSnapshot) => {
    void withCartLock(slug, () => {
      if (current.current.slug !== slug) return;
      const latest = readCurrent();
      const next = change(latest.snapshot);
      writeCart(slug, next.lines, next.note);
      publish(next, latest.dropped);
      setPersistenceError(null);
      window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: slug }));
    }).catch(() => setPersistenceError(CART_STORAGE_ERROR));
  }, [slug, readCurrent, publish]);

  const upsert = useCallback((line: CartLine) => {
    const saved = structuredClone(line);
    mutate((snapshot) => {
      const at = snapshot.lines.findIndex((entry) => entry.lineId === saved.lineId);
      const next = [...snapshot.lines];
      if (at === -1) next.push(saved); else next[at] = saved;
      return { ...snapshot, lines: next };
    });
  }, [mutate]);

  const setQty = useCallback((lineId: string, qty: number) => {
    // A user edit already queued behind receipt cleanup is still a new intent.
    // Preserve that visible line if the cleanup wins the lock just before it.
    const observed = current.current.snapshot.lines.find((line) => line.lineId === lineId);
    const fallback = observed ? structuredClone(observed) : null;
    mutate((snapshot) => {
      if (qty <= 0) return { ...snapshot, lines: snapshot.lines.filter((line) => line.lineId !== lineId) };
      const quantity = Math.min(99, qty);
      const exists = snapshot.lines.some((line) => line.lineId === lineId);
      return { ...snapshot, lines: !exists && fallback
        ? [...snapshot.lines, { ...fallback, qty: quantity }]
        : snapshot.lines.map((line) => line.lineId === lineId ? { ...line, qty: quantity } : line) };
    });
  }, [mutate]);

  const remove = useCallback((lineId: string) => {
    mutate((snapshot) => ({ ...snapshot, lines: snapshot.lines.filter((line) => line.lineId !== lineId) }));
  }, [mutate]);

  const setNote = useCallback((value: string) => { mutate((snapshot) => ({ ...snapshot, note: value })); }, [mutate]);

  const clearIfUnchanged = useCallback(async (canClear?: () => boolean): Promise<boolean> => {
    const expected = { lines, note };
    try {
      return await withCartLock(slug, () => {
        if (current.current.slug !== slug || (canClear && !canClear())) return false;
        const latest = readCurrent();
        if (!sameCart(expected, latest.snapshot) || !sameCart(expected, current.current.snapshot)) {
          publish(latest.snapshot, latest.dropped);
          return false;
        }
        writeCart(slug, [], "");
        publish({ lines: [], note: "" });
        setPersistenceError(null);
        window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: slug }));
        return true;
      });
    } catch {
      setPersistenceError(CART_STORAGE_ERROR);
      return false;
    }
  }, [slug, lines, note, readCurrent, publish]);

  const clear = useCallback(() => { void clearIfUnchanged(); }, [clearIfUnchanged]);

  const appendIfUnchanged = useCallback(async (additions: CartLine[], canAppend: () => Promise<boolean>): Promise<boolean> => {
    const expected = { lines, note }, requested = structuredClone(additions);
    try {
      return await withCartLock(slug, async () => {
        if (current.current.slug !== slug || !await canAppend() || current.current.slug !== slug) return false;
        const latest = readCurrent();
        if (!sameCart(expected, latest.snapshot) || !sameCart(expected, current.current.snapshot)) {
          publish(latest.snapshot, latest.dropped); return false;
        }
        if (!requested.length || latest.dropped.length
          || !canSubmitCartLines([...latest.snapshot.lines, ...requested])) return false;
        const checked = reconcile(requested, index);
        // A menu refresh must never silently change the confirmed selection or
        // price. New ids belong only to this new basket, never the source order.
        if (checked.dropped.length || JSON.stringify(checked.lines) !== JSON.stringify(requested)) return false;
        const next = { ...latest.snapshot, lines: [...latest.snapshot.lines, ...checked.lines.map(line => ({ ...line, lineId: uid() }))] };
        if (!Number.isSafeInteger(cartSubtotal(next.lines))) return false;
        writeCart(slug, next.lines, next.note);
        publish(next); setPersistenceError(null);
        window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: slug }));
        return true;
      });
    } catch { setPersistenceError(CART_STORAGE_ERROR); return false; }
  }, [slug, lines, note, readCurrent, index, publish]);

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
      setNote,
      clear,
      clearIfUnchanged,
      appendIfUnchanged,
      persistenceError,
    }),
    [lines, note, hydrated, dropped, upsert, setQty, remove, setNote, clear, clearIfUnchanged, appendIfUnchanged, persistenceError],
  );
}
