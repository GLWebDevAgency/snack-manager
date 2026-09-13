"use client";

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import styles from "./AdminSections.module.css";

export type AdminSection = {
  id: string;
  label: string;
  icon?: IconName;
  content: ReactNode;
  /** A draft in another section remains discoverable without moving its save action. */
  modified?: boolean;
};

const changed = "sm:admin-section";
function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
    window.removeEventListener(changed, notify);
  };
}
const snapshot = () => window.location.search + window.location.hash;
const serverSnapshot = () => "";

/** Local views of one page. Keep mounted children, business state and in-flight work. */
export function AdminSections({ label, sections, defaultSection, hashSections = {} }: {
  label: string;
  sections: readonly AdminSection[];
  defaultSection?: string;
  /** Existing inbound anchors (for example #salle) still open the right panel. */
  hashSections?: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const location = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [search, hash] = location.split("#");
  const requested = new URLSearchParams(search).get("section") ?? hashSections[hash ?? ""];
  const active = sections.find(section => section.id === requested)?.id
    ?? sections.find(section => section.id === defaultSection)?.id ?? sections[0]?.id;

  function select(key: string) {
    if (key === active) return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", key);
    if (hashSections[url.hash.slice(1)]) url.hash = "";
    // Next's native history integration copies its own router state. Passing its
    // private markers back would bypass that integration.
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event(changed));
  }

  if (!sections.length) return null;
  return <div className={styles.root} data-admin-sections>
    <div role="tablist" aria-label={label} className={styles.tabs}>
      {sections.map((section, index) => <button
        key={section.id}
        ref={node => { if (node) tabs.current.set(section.id, node); else tabs.current.delete(section.id); }}
        type="button" role="tab" id={`${id}-tab-${section.id}`}
        aria-controls={`${id}-panel-${section.id}`} aria-selected={active === section.id}
        aria-describedby={section.modified ? `${id}-draft-${section.id}` : undefined}
        tabIndex={active === section.id ? 0 : -1} className={styles.tab}
        onClick={() => select(section.id)}
        onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1
            : event.key === "ArrowRight" ? (index + 1) % sections.length
            : event.key === "ArrowLeft" ? (index - 1 + sections.length) % sections.length : null;
          if (next === null) return;
          event.preventDefault();
          tabs.current.get(sections[next].id)?.focus({ preventScroll: true });
          select(sections[next].id);
        }}
      >
        {section.icon && <Icon name={section.icon} size={18} />}
        <span>{section.label}</span>
        {section.modified && <span className={styles.draft} aria-hidden="true" />}
      </button>)}
    </div>
    {sections.filter(section => section.modified).map(section => <span key={section.id} id={`${id}-draft-${section.id}`} className="sr-only">Modifications non enregistrées</span>)}
    {sections.map(section => <SectionPanel key={section.id}
      id={`${id}-panel-${section.id}`} tabId={`${id}-tab-${section.id}`}
      active={active === section.id}>
      {section.content}
    </SectionPanel>)}
  </div>;
}

function SectionPanel({ id, tabId, active, children }: {
  id: string; tabId: string; active: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const update = () => {
      const open = Boolean(panel.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'));
      if (!open && !active && panel.contains(document.activeElement)) {
        panel.closest("[data-admin-sections]")?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
      }
      setDialogOpen(open);
    };
    const observer = new MutationObserver(update);
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    update();
    return () => observer.disconnect();
  }, [active]);
  // Back/forward may change the URL while an inline dialog owns focus. Its
  // existing layer continues isolating the page until the user finishes it.
  // Hiding its ancestor would strand that layer and its in-flight operation.
  return <section ref={ref} role="tabpanel" id={id} aria-labelledby={tabId}
    hidden={!active && !dialogOpen} tabIndex={0} className={styles.panel}>
    {children}
  </section>;
}
