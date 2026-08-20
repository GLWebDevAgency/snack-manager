"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NAV_LEFT, NAV_MOBILE, NAV_RIGHT } from "./content";
import { LogoMark, NotchFillet } from "./icons";

/** `useLayoutEffect` côté client, `useEffect` au rendu serveur (pas d'avertissement). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Barre de navigation « encoche » de la maquette.
 *
 * Au repos l'encoche noire ne fait que 48 px de large ; au survol (ou au focus
 * clavier) elle s'ouvre jusqu'à `--hd-open-w` — une largeur MESURÉE sur les
 * liens réels, parce que les libellés français sont plus longs que ceux du
 * gabarit d'origine. C'est la fonction `fitNotch` du JS de maquette, portée en
 * hook : mesure via refs + ResizeObserver, jamais d'écriture DOM manuelle.
 */
export function SiteHeader() {
  const [openWidth, setOpenWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLAnchorElement>(null);

  const measure = useCallback(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    const logo = logoRef.current;
    if (!left || !right || !logo) return;

    const groupWidth = (group: HTMLElement) => {
      const kids = Array.from(group.children) as HTMLElement[];
      if (kids.length === 0) return 0;
      return kids.reduce((sum, k) => sum + k.offsetWidth, 0) + 16 * (kids.length - 1);
    };

    // Groupes symétriques : on prend le plus large des deux, ×2, + le logo + les gouttières.
    const maxGroup = Math.max(groupWidth(left), groupWidth(right));
    setOpenWidth(maxGroup * 2 + logo.offsetWidth + 16 * 2 + 36);
  }, []);

  useIsoLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (leftRef.current) ro.observe(leftRef.current);
    if (rightRef.current) ro.observe(rightRef.current);
    window.addEventListener("resize", measure);
    // Les largeurs changent quand Inter remplace la police de repli.
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <header className="site-head">
      <div className="hd-desktop">
        <div className="hd-strip" />
        <div className="hd-row">
          <NotchFillet className="notch-fillet" />
          <div
            className="hd-mid"
            style={openWidth ? ({ "--hd-open-w": `${openWidth}px` } as React.CSSProperties) : undefined}
          >
            <div className="hd-midc">
              <div className="hd-links" ref={leftRef}>
                {NAV_LEFT.map((l) => (
                  <a className="ui-link" href={l.href} key={l.href}>
                    {l.label}
                  </a>
                ))}
              </div>
              <a className="hd-logolink" href="#top" aria-label="Accueil" ref={logoRef}>
                <LogoMark />
              </a>
              <div className="hd-links" ref={rightRef}>
                {NAV_RIGHT.map((l) => (
                  <a className="ui-link" href={l.href} key={l.href}>
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
          <NotchFillet className="notch-fillet" flip />
        </div>
      </div>

      <div className="hd-mobile">
        <div className="hd-mobilebar">
          <a href="#top" aria-label="Accueil">
            <LogoMark />
          </a>
          <button
            type="button"
            className={menuOpen ? "hd-burger open" : "hd-burger"}
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            aria-controls="hd-mobilemenu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        {/*
         * LE BURGER EST DEVENU LE SOMMAIRE DE LA PAGE, ET IL N'AVAIT PAS LE
         * CHOIX. La barre collante a disparu : sur téléphone, ce menu est
         * désormais la SEULE navigation, et le seul raccourci vers le prix.
         * Les cinq entrées de l'encoche n'y suffisaient plus — il déroule les
         * dix sections de `NAV_MOBILE` (tout sauf le hero, où l'on est déjà).
         */}
        <nav
          id="hd-mobilemenu"
          className={menuOpen ? "hd-mobilemenu open" : "hd-mobilemenu"}
          aria-hidden={!menuOpen}
        >
          {NAV_MOBILE.map((l) => (
            <a
              className="ui-link"
              href={l.href}
              key={l.href}
              tabIndex={menuOpen ? undefined : -1}
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
