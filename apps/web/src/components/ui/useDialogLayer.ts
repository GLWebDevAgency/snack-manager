"use client";

import {
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { createDialogStack } from "./dialog-stack";

const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogLayer = {
  root: HTMLElement;
  close: () => void;
  initialFocus: HTMLElement | null;
  restoreFocus: HTMLElement | null;
};

type IsolationSnapshot = {
  inert: boolean;
  ariaHidden: string | null;
};

type ScrollSnapshot = {
  scrollX: number;
  scrollY: number;
  overflow: string;
  paddingRight: string;
  position: string;
  top: string;
  left: string;
  width: string;
};

const layers = createDialogStack<DialogLayer>();
const isolatedElements = new Map<HTMLElement, IsolationSnapshot>();

let activeDocument: Document | null = null;
let mutationObserver: MutationObserver | null = null;
let isolationRefreshQueued = false;
let redirectingFocus = false;
let scrollSnapshot: ScrollSnapshot | null = null;

function isHTMLElement(
  value: Element | null,
  document: Document,
): value is HTMLElement {
  const HTMLElementConstructor = document.defaultView?.HTMLElement;
  return Boolean(
    value &&
      HTMLElementConstructor &&
      value instanceof HTMLElementConstructor,
  );
}

function isDisabled(element: HTMLElement) {
  return "disabled" in element && Boolean(element.disabled);
}

function isVisible(element: HTMLElement) {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view || !element.isConnected) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;

  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    (element.getClientRects().length > 0 || style.position === "fixed")
  );
}

function isTabbable(element: HTMLElement) {
  return !isDisabled(element) && element.tabIndex >= 0 && isVisible(element);
}

function tabbableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    isTabbable,
  );
}

function focusElement(element: HTMLElement) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    // Safari ancien ne comprend pas toujours FocusOptions.
    element.focus();
  }
}

function firstTabbableWithin(root: HTMLElement, selector: string) {
  const section = root.querySelector<HTMLElement>(selector);
  return section ? tabbableElements(section)[0] : undefined;
}

function preferredFocus(layer: DialogLayer) {
  if (
    layer.initialFocus &&
    layer.root.contains(layer.initialFocus) &&
    !isDisabled(layer.initialFocus) &&
    isVisible(layer.initialFocus)
  ) {
    return layer.initialFocus;
  }

  const requested = layer.root.querySelector<HTMLElement>(
    "[data-dialog-autofocus], [autofocus]",
  );
  if (requested && !isDisabled(requested) && isVisible(requested)) {
    return requested;
  }

  return (
    firstTabbableWithin(layer.root, "[data-dialog-content]") ??
    firstTabbableWithin(layer.root, "[data-dialog-footer]") ??
    tabbableElements(layer.root)[0] ??
    layer.root
  );
}

function focusLayer(layer: DialogLayer) {
  if (layers.top !== layer || !layer.root.isConnected) return;
  focusElement(preferredFocus(layer));
}

function canRestoreFocus(element: HTMLElement | null) {
  return Boolean(
    element &&
      !isDisabled(element) &&
      isVisible(element),
  );
}

function restoreIsolation() {
  for (const [element, snapshot] of isolatedElements) {
    element.inert = snapshot.inert;
    if (snapshot.ariaHidden === null) {
      element.removeAttribute("aria-hidden");
    } else {
      element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
  }
  isolatedElements.clear();
}

function isAllowedLiveRegion(element: HTMLElement) {
  const ariaLive = element.getAttribute("aria-live");
  return (
    element.hasAttribute("data-dialog-allow") ||
    (ariaLive !== null && ariaLive !== "off")
  );
}

/**
 * Isole chaque branche sœur entre le dialogue supérieur et `<body>`.
 * Cette marche ascendante fonctionne aussi quand une modale est rendue dans
 * le contenu d'un Drawer, contrairement à un simple `body > * { inert }`.
 */
function applyIsolation() {
  restoreIsolation();

  const top = layers.top;
  if (!top?.root.isConnected) return;

  const body = top.root.ownerDocument.body;
  let branch: HTMLElement = top.root;

  while (branch !== body) {
    const parent = branch.parentElement;
    if (!parent) return;

    for (const sibling of Array.from(parent.children)) {
      if (
        sibling === branch ||
        !isHTMLElement(sibling, top.root.ownerDocument) ||
        isAllowedLiveRegion(sibling)
      ) {
        continue;
      }

      isolatedElements.set(sibling, {
        inert: sibling.inert,
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }

    branch = parent;
  }
}

function scheduleIsolationRefresh() {
  if (isolationRefreshQueued) return;
  isolationRefreshQueued = true;
  queueMicrotask(() => {
    isolationRefreshQueued = false;
    if (layers.size > 0) applyIsolation();
  });
}

function lockScroll(document: Document) {
  if (scrollSnapshot) return;
  const view = document.defaultView;
  if (!view) return;

  const body = document.body;
  const scrollbarWidth = Math.max(
    0,
    view.innerWidth - document.documentElement.clientWidth,
  );
  const computedPadding = Number.parseFloat(
    view.getComputedStyle(body).paddingRight,
  ) || 0;

  scrollSnapshot = {
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    width: body.style.width,
  };

  body.style.overflow = "hidden";
  body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
  body.style.position = "fixed";
  body.style.top = `${-scrollSnapshot.scrollY}px`;
  body.style.left = `${-scrollSnapshot.scrollX}px`;
  body.style.width = "100%";
}

function unlockScroll(document: Document) {
  const snapshot = scrollSnapshot;
  if (!snapshot) return;
  scrollSnapshot = null;

  const body = document.body;
  body.style.overflow = snapshot.overflow;
  body.style.paddingRight = snapshot.paddingRight;
  body.style.position = snapshot.position;
  body.style.top = snapshot.top;
  body.style.left = snapshot.left;
  body.style.width = snapshot.width;
  document.defaultView?.scrollTo(snapshot.scrollX, snapshot.scrollY);
}

function onKeyDown(event: KeyboardEvent) {
  const top = layers.top;
  if (!top || event.defaultPrevented || event.isComposing) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    top.close();
    return;
  }

  if (
    event.key !== "Tab" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }

  const tabbables = tabbableElements(top.root);
  if (tabbables.length === 0) {
    event.preventDefault();
    focusElement(top.root);
    return;
  }

  const active = top.root.ownerDocument.activeElement;
  const first = tabbables[0];
  const last = tabbables.at(-1)!;

  const activeTabbable =
    isHTMLElement(active, top.root.ownerDocument) && tabbables.includes(active);

  if (!top.root.contains(active) || !activeTabbable) {
    event.preventDefault();
    focusElement(event.shiftKey ? last : first);
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    focusElement(last);
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    focusElement(first);
  }
}

function onFocusIn(event: FocusEvent) {
  const top = layers.top;
  const target = event.target;
  const NodeConstructor = top?.root.ownerDocument.defaultView?.Node;
  if (
    !top ||
    redirectingFocus ||
    (NodeConstructor &&
      target instanceof NodeConstructor &&
      top.root.contains(target))
  ) {
    return;
  }

  redirectingFocus = true;
  try {
    focusLayer(top);
  } finally {
    redirectingFocus = false;
  }
}

function startRuntime(document: Document) {
  if (activeDocument) return;
  activeDocument = document;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);

  const MutationObserverConstructor = document.defaultView?.MutationObserver;
  if (MutationObserverConstructor) {
    mutationObserver = new MutationObserverConstructor(scheduleIsolationRefresh);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  lockScroll(document);
}

function stopRuntime(document: Document) {
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("focusin", onFocusIn, true);
  mutationObserver?.disconnect();
  mutationObserver = null;
  activeDocument = null;
  restoreIsolation();
  unlockScroll(document);
}

function registerLayer(layer: DialogLayer) {
  const document = layer.root.ownerDocument;
  startRuntime(document);
  const id = layers.push(layer);
  applyIsolation();
  focusLayer(layer);

  return () => {
    const result = layers.remove(id);
    if (!result.removed) return;

    if (layers.size === 0) {
      stopRuntime(document);
    } else {
      applyIsolation();
    }

    if (!result.wasTop) return;
    if (canRestoreFocus(layer.restoreFocus)) {
      focusElement(layer.restoreFocus!);
    } else if (layers.top) {
      focusLayer(layers.top);
    }
  };
}

type UseDialogLayerOptions = {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Contrat commun Drawer/Modal : pile, focus, Échap, arrière-plan et scroll.
 * Le nœud racine doit être rendu temporairement `inert` afin d'empêcher un
 * `autoFocus` React de voler le focus avant que sa cible de retour soit lue.
 */
export function useDialogLayer({
  open,
  onClose,
  initialFocusRef,
}: UseDialogLayerOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;

    const document = root.ownerDocument;
    const activeElement = document.activeElement;
    const restoreFocus =
      isHTMLElement(activeElement, document) && !root.contains(activeElement)
        ? activeElement
        : null;

    // Retire le garde-fou posé dans le JSX juste avant d'isoler le fond.
    root.inert = false;
    root.removeAttribute("inert");

    return registerLayer({
      root,
      close: () => onCloseRef.current(),
      initialFocus: initialFocusRef?.current ?? null,
      restoreFocus,
    });
  }, [initialFocusRef, open]);

  return rootRef;
}
