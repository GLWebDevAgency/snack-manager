"use client";

import { useEffect, useState } from "react";
import { FOUNDER_SEATS_LEFT, FOUNDER_SEATS_TOTAL } from "./content";

const STORAGE_KEY = "sm.mk.stickybar.closed";

/**
 * Rappel discret de l'offre fondateur. Apparaît après ~900 px de défilement et
 * s'efface à l'approche du formulaire (inutile de doubler l'appel à l'action
 * juste au-dessus de lui). La fermeture est mémorisée pour la session.
 */
export function StickyBar() {
  const [closed, setClosed] = useState(true);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setClosed(sessionStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setClosed(false);
    }
  }, []);

  useEffect(() => {
    if (closed) return;
    const onScroll = () => {
      const contact = document.getElementById("contact");
      const nearForm = contact ? contact.getBoundingClientRect().top < window.innerHeight * 0.9 : false;
      setVisible(window.scrollY > 900 && !nearForm);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [closed]);

  const close = () => {
    setClosed(true);
    setVisible(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* mode privé : on se contente de l'état mémoire */
    }
  };

  if (closed) return null;

  return (
    <div className="mk-sticky" data-on={visible ? "true" : undefined} aria-hidden={!visible}>
      <div className="mk-sticky-in">
        <i className="mk-dot" aria-hidden="true" />
        <span className="mk-sticky-txt">
          <b>Offre fondateur</b> — {FOUNDER_SEATS_LEFT} places restantes sur {FOUNDER_SEATS_TOTAL} au tarif gelé à vie
        </span>
        <a
          className="mk-btn mk-btn--primary"
          href="#contact"
          tabIndex={visible ? 0 : -1}
          style={{ padding: "10px 18px", fontSize: 13.5 }}
        >
          Réserver ma démo
        </a>
        <button type="button" className="mk-sticky-close" onClick={close} aria-label="Fermer" tabIndex={visible ? 0 : -1}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
