"use client";

import { useEffect, useState } from "react";
import { CTA_CALLBACK, CTA_DEMO, HERO_SHOTS } from "./content";
import { Photo } from "./Photo";

/** Position d'une carte dans le deck : centre, gauche, droite, ou hors-champ. */
function slot(index: number, current: number, total: number) {
  let off = (((index - current) % total) + total) % total;
  if (off > total / 2) off -= total;
  if (off === 0) return "hd-center";
  if (off === -1) return "hd-left";
  if (off === 1) return "hd-right";
  return "hd-hidden";
}

/**
 * Hero de la maquette : un carrousel 3D d'applications tourne DERRIÈRE le
 * texte (perspective 1400 px, cartes en `translateZ(-380px) rotateY(24deg)`),
 * recouvert de trois voiles — flou, voile blanc, ombre basse — pour que le
 * titre reste parfaitement lisible.
 *
 * La maquette y plaçait des iframes de démonstration ; on affiche les VRAIES
 * captures de nos applications (`public/shots/`).
 *
 * LE HERO N'OUVRE QU'UNE PORTE, ET CE N'EST PAS LE FORMULAIRE. Son appel
 * principal mène à la démonstration manipulable, un écran plus bas : c'est la
 * seule inversion de hiérarchie de la page, et elle est le corollaire de la
 * thèse — le seul actif que personne d'autre n'a, c'est que nos applications
 * se touchent. « Être rappelé » reste offert juste à côté, en second.
 *
 * LA RANGÉE DE GAGES EST PARTIE (« Sans engagement », « Installé en quelques
 * jours », « Testé en service réel »). Elle répondait ici à trois questions
 * que le visiteur ne se pose pas encore, et les usait avant qu'elles ne
 * comptent : l'engagement se dit une fois, dans les termes exacts du socle,
 * sous la grille tarifaire et dans la FAQ ; le délai d'installation est la
 * frise du lancement ; le service réel est la section du pilote.
 */
export function Hero() {
  const total = HERO_SHOTS.length;
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setCurrent((c) => (c + 1) % total), 4500);
    return () => window.clearInterval(id);
  }, [total]);

  return (
    <section className="hero" id="hero">
      <div className="hero-frame">
        <div className="hero-demo" aria-hidden="true">
          <div className="hero-demotrack">
            {HERO_SHOTS.map((shot, i) => (
              <div className={`hero-democard ${slot(i, current, total)}`} key={shot.src}>
                <Photo shot={shot} eager={i === 0} sizes="(max-width: 810px) 130vw, min(900px, 74vw)" />
              </div>
            ))}
          </div>
        </div>
        <div className="hero-blur" />
        <div className="hero-veil" />
        <div className="hero-shade" />

        <div className="hero-content">
          <span className="badge">
            <span className="accent">Nouveau</span>Conçu par des restaurateurs
          </span>
          <h1 className="h1 hero-title">
            On fait tourner votre restaurant.
            <br />
            Pas l&apos;inverse.
          </h1>
          <p className="subheading hero-sub">
            Caisse, cuisine, back-office et commande en ligne réunis dans <span className="kw-w">une seule plateforme</span>{" "}
            — <span className="kw">à vos couleurs</span>, pensée par des gens qui ont{" "}
            <span className="kw-w">tenu le comptoir</span>.
          </p>
          <div className="hero-actions">
            <a className="btn light" href="#produit">
              {CTA_DEMO}
            </a>
            <a className="btn dark" href="#contact">
              {CTA_CALLBACK}
            </a>
          </div>
        </div>

        <div className="hero-live" aria-hidden="true">
          <div className="hero-chip">
            <span className="hero-chipdot" />
            <span className="t">
              <b>Commande en ligne · 18,90 € payée</b>
              <span>Ticket parti en cuisine — sans passer par la caisse</span>
            </span>
          </div>
          <div className="hero-chip">
            <span className="hero-chipdot gold" />
            <span className="t">
              <b>Cuisine · 3 frites à lancer</b>
              <span>Agrégé sur toutes les commandes en cours</span>
            </span>
          </div>
          <div className="hero-chip">
            <span className="hero-chipdot" />
            <span className="t">
              <b>N°42 prête en 11 min</b>
              <span>Sticker sac imprimé, client prévenu</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
