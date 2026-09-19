"use client";

import { useEffect, useRef, useState } from "react";
import { CTA_DEMO, HERO_SHOTS, ancre, type ReseauPublié } from "./content";
import { Photo } from "./Photo";
import { Reseaux } from "./Reseaux";

function slot(index: number, current: number, total: number) {
  let offset = (((index - current) % total) + total) % total;
  if (offset > total / 2) offset -= total;
  return offset === 0 ? "hd-center" : offset === -1 ? "hd-left" : offset === 1 ? "hd-right" : "hd-hidden";
}

/** Actual application captures, with a decorative, pausable carousel. */
export function Hero({ reseaux }: { reseaux: readonly ReseauPublié[] }) {
  const total = HERO_SHOTS.length;
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!paused && !media.matches && visible && !document.hidden) {
        timer = setInterval(() => setCurrent((c) => (c + 1) % total), 5000);
      }
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    if (root.current) observer.observe(root.current);
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [paused, total]);

  return (
    <section className="hero hero-v2" id="hero" ref={root}>
      <div className="hero-frame">
        <div className="hero-demo" aria-hidden="true">
          <div className="hero-demotrack">
            {HERO_SHOTS.map((shot, i) => (
              <div className={`hero-democard ${slot(i, current, total)}${shot.portrait ? " hd-portrait" : ""}`} key={shot.src}>
                <Photo shot={shot} eager={i === 0} sizes="(max-width: 810px) 130vw, min(900px, 74vw)" />
              </div>
            ))}
          </div>
        </div>
        <div className="hero-blur" /><div className="hero-veil" /><div className="hero-shade" />
        <div className="hero-content">
          <span className="badge"><span className="accent">Snack Manager</span>Pour les restaurateurs indépendants</span>
          <h1 className="h1 hero-title">Gérez votre restaurant.<br /><span>Faites vivre votre carte.</span></h1>
          <p className="subheading hero-sub">
            Caisse, cuisine, suivi de l’activité et commande directe : choisissez les outils adaptés à votre organisation.
            Pour vos menus papier et TV, notre Atelier vous accompagne dans la création et les mises à jour.
          </p>
          <div className="hero-actions">
            <a className="btn light" href={ancre("produit").href}>{CTA_DEMO}<span aria-hidden="true"> ↗</span></a>
            <a className="btn dark" href={ancre("menus").href}>Refaire mes menus</a>
          </div>
          <p className="hero-v2-note">Logiciels et accompagnement. Selon vos besoins, à votre rythme.</p>
          <Reseaux reseaux={reseaux} variant="hero" />
        </div>
        <div className="hero-live hero-v2-pillars">
          <div className="hero-chip"><span className="hero-chipdot" /><span className="t"><b>Votre service</b><span>Caisse, cuisine et suivi de l’activité</span></span></div>
          <div className="hero-chip"><span className="hero-chipdot gold" /><span className="t"><b>Votre carte</b><span>Menus papier, présentations TV et retouches</span></span></div>
          <div className="hero-chip"><span className="hero-chipdot" /><span className="t"><b>Vos clients</b><span>Commande directe et fidélité en pilote</span></span></div>
        </div>
        <button type="button" className="hero-motion" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
          {paused ? "Reprendre les aperçus" : "Mettre les aperçus en pause"}
        </button>
      </div>
    </section>
  );
}
