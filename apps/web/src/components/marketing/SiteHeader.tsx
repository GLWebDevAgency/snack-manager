"use client";

import { useEffect, useState } from "react";
import { NAV } from "./content";

/**
 * En-tête collant : fond qui se densifie au scroll, menu plein écran ≤ 880 px.
 * Le lien « Demander une démo » est la seule action en accent laiton.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="mk-header" data-stuck={stuck}>
      <div className="mk-wrap">
        <div className="mk-header-row">
          <a className="mk-logo" href="#top" aria-label="Snack Manager — accueil">
            <span className="mk-logo-mark" aria-hidden="true">
              S
            </span>
            Snack Manager
          </a>

          <nav className="mk-nav" aria-label="Navigation principale">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="mk-header-cta">
            <a className="mk-btn mk-btn--primary" href="#contact">
              Demander une démo
            </a>
          </div>

          <button
            type="button"
            className="mk-burger"
            aria-expanded={open}
            aria-controls="mk-mobilemenu"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div className="mk-mobilemenu" id="mk-mobilemenu" data-open={open} aria-hidden={!open}>
        <div className="mk-wrap">
          <div className="mk-mobilemenu-in">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
                {item.label}
              </a>
            ))}
            <a
              className="mk-btn mk-btn--primary mk-btn--block"
              href="#contact"
              onClick={() => setOpen(false)}
              tabIndex={open ? 0 : -1}
              style={{ marginTop: 10 }}
            >
              Demander une démo
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
