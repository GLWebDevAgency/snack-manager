"use client";

import { useEffect, useState } from "react";
import { FOUNDER_SEATS_LEFT, FOUNDER_SEATS_TOTAL } from "./content";

/**
 * Rappel de rareté qui monte après 1 000 px de défilement et se retire de
 * lui-même à l'approche du formulaire de contact — inutile de proposer une
 * démo à quelqu'un qui est déjà en train de la demander.
 */
export function StickyBar() {
  const [visible, setVisible] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (closed) return;
    const onScroll = () => {
      const contact = document.getElementById("contact");
      const nearEnd = contact ? contact.getBoundingClientRect().top < window.innerHeight * 0.9 : false;
      setVisible(window.scrollY > 1000 && !nearEnd);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [closed]);

  if (closed) return null;

  return (
    <div className={visible ? "stickybar is-on" : "stickybar"}>
      <div className="stickybar-in">
        <span className="stickybar-dot" />
        <p className="stickybar-text">
          <strong>Offre fondateur</strong> — {FOUNDER_SEATS_LEFT} places restantes sur {FOUNDER_SEATS_TOTAL} au tarif
          préférentiel à vie
        </p>
        <a className="btn light" href="#contact">
          Réserver ma démo
        </a>
        <button
          type="button"
          className="stickybar-x"
          aria-label="Fermer le bandeau"
          onClick={() => {
            setClosed(true);
            setVisible(false);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
