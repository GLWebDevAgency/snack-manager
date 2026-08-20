"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOGUE, demoHref, DEMO_APPS } from "./content";
import { DeviceFrame } from "./DeviceFrame";
import { Chevron } from "./icons";
import { Photo } from "./Photo";

/** Position d'une carte dans la scène 3D : centre, gauche, droite, hors-champ. */
function slot(index: number, current: number, total: number) {
  let off = (((index - current) % total) + total) % total;
  if (off > total / 2) off -= total;
  if (off === 0) return "is-center";
  if (off === -1) return "is-left";
  if (off === 1) return "is-right";
  return "is-hidden";
}

/**
 * En dessous de cette largeur, une caisse conçue pour une tablette de 1024 px
 * n'est plus lisible : on garde l'affiche et on propose le plein écran.
 * Même seuil que la bascule CSS de la section — les deux doivent bouger
 * ensemble, sinon le bouton disparaît sans que l'iframe se démonte.
 */
const NARROW = "(max-width: 809.98px)";

/**
 * Catalogue app par app + scène de démonstration 3D.
 *
 * Les deux sections partagent un état (`current`) : chaque colonne du
 * catalogue porte son lien « Essayer … en démo → » qui fait pivoter la scène
 * sur la bonne application puis y amène le lecteur — c'est le `smDemoGo()`
 * global de la maquette, remplacé ici par un `useState` et une ref.
 *
 * ─── LES VRAIES APPLICATIONS, PAS DES CAPTURES ───
 *
 * La maquette embarquait des iframes ; une étape intermédiaire les avait
 * remplacées par des captures statiques. On revient aux cadres, avec les
 * applications de terrain réelles en `?demo=1` — le visiteur prend une
 * commande, l'encaisse, la voit tomber en cuisine.
 *
 * ─── CE QUI EMPÊCHE LA PAGE DE COULER ───
 *
 * Chaque application de terrain pèse ~1 Mo de JavaScript. Quatre iframes
 * montées au chargement, ce serait 4 Mo sur la page d'accueil. Donc :
 *   1. l'AFFICHE (capture déjà optimisée) s'affiche instantanément ;
 *   2. l'iframe ne se monte QU'AU CLIC, et seulement pour l'app au centre ;
 *   3. changer d'onglet démonte l'iframe précédente (`setLive(null)` dans
 *      `go`) — il n'y a jamais deux applications chargées en mémoire.
 * Tant que le visiteur ne clique pas, la vitrine ne demande pas un octet à
 * Railway ; c'est vérifiable dans l'onglet réseau.
 *
 * ─── AUCUNE BASE DE DONNÉES ───
 *
 * `?demo=1` fait tourner l'application entièrement dans le navigateur du
 * visiteur (`packages/client-core/src/demo`). Pas de restaurant de
 * démonstration en base : il n'apparaîtrait pas dans le CRM comme un faux
 * client, deux visiteurs ne se marchent pas dessus, et surtout les commandes
 * jouées ici ne faussent pas la médiane réseau dont sort notre conseil chiffré.
 * Chacun a sa démo, neuve ; un rechargement remet tout à zéro.
 */
export function AppsShowcase() {
  const [current, setCurrent] = useState(0);
  /** Identifiant de l'application actuellement MONTÉE. Une seule à la fois. */
  const [live, setLive] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const total = DEMO_APPS.length;

  const go = useCallback(
    (i: number) => {
      // Changer d'onglet démonte l'application précédente : sans cela, une
      // visite curieuse laisserait quatre bundles vivants dans l'onglet.
      setLive(null);
      setCurrent(((i % total) + total) % total);
    },
    [total],
  );

  const goAndScroll = useCallback(
    (i: number) => {
      go(i);
      stageRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    },
    [go],
  );

  /*
   * Passage en petit écran alors qu'une démo tourne : on démonte. Le bouton
   * « Essayer » est masqué en CSS sous ce seuil, mais une fenêtre qu'on rétrécit
   * laisserait sinon une caisse de 1024 px écrasée dans 375 px.
   */
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const settle = () => {
      if (mq.matches) setLive(null);
    };
    settle();
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, []);

  const app = DEMO_APPS[current];

  return (
    <>
      <section className="section cat-section" id="catalogue">
        <span className="badge">Dans le détail</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 680 }}>
          Tout ce que la plateforme couvre, app par app
        </h2>
        <p className="body-text cat-sub rv">
          Pas une plaquette : chaque ligne ci-dessous existe déjà dans les applications — descendez d&apos;une section
          pour les voir en vrai.
        </p>

        <div className="cat-grid">
          {CATALOGUE.map((col, i) => (
            <div className="cat-col rv spot" key={col.name} style={{ transitionDelay: `${i * 0.06}s` }}>
              <div className="cat-colhead">
                <p className="cat-appname">{col.name}</p>
                <p className="cat-device">{col.device}</p>
              </div>
              <div className="cat-items">
                {col.items.map((item, k) => (
                  <div className="cat-item" key={k}>
                    <span className="cat-dot" />
                    <span>
                      {item.pre}
                      {item.strong ? <strong>{item.strong}</strong> : null}
                      {item.post}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="cat-demolink" onClick={() => goAndScroll(col.demo)}>
                {col.demoLabel}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section demo-section" id="demo" ref={stageRef}>
        <span className="badge">La démo</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 640 }}>
          Explorez les applications, en démo
        </h2>
        <p className="body-text demo-sub rv">
          La caisse et l&apos;écran cuisine sont <strong>manipulables ici même</strong> : lancez-en un, prenez une
          commande, encaissez. Tout tourne dans <span className="kw">votre navigateur</span> — rien n&apos;est
          enregistré, un rechargement remet la démo à zéro.
        </p>

        <div className="demo-pills rv">
          {DEMO_APPS.map((a, i) => (
            <button
              type="button"
              aria-pressed={i === current}
              className={i === current ? "demo-pill is-on" : "demo-pill"}
              key={a.id}
              onClick={() => go(i)}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/*
         * `data-device` sert au petit écran : une tablette couchée et un
         * téléphone debout n'ont pas la même hauteur utile, et une scène
         * dimensionnée pour le plus grand des deux laisserait un trou noir
         * sous l'autre. Sur grand écran la scène garde une hauteur unique.
         */}
        <div className="demo-stage rv" data-device={app.device}>
          <div className="demo-track">
            {DEMO_APPS.map((a, i) => {
              const position = slot(i, current, total);
              const isCenter = position === "is-center";
              const isLive = isCenter && live === a.id && a.live !== undefined;
              return (
                <div className={`demo-card ${position}`} key={a.id} aria-hidden={!isCenter}>
                  <DeviceFrame device={a.device}>
                    {isLive && a.live ? (
                      /*
                       * `sandbox` sans `allow-top-navigation` : l'application
                       * embarquée ne peut pas emmener la page d'accueil
                       * ailleurs. `allow-same-origin` la laisse parler à sa
                       * propre origine (elle en a besoin pour son stockage),
                       * pas à la nôtre.
                       */
                      <iframe
                        className="dv-live"
                        src={demoHref(a.live.origin)}
                        title={a.live.title}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    ) : (
                      <Photo
                        shot={a.shot}
                        sizes={a.device === "phone" ? "(max-width: 810px) 40vw, 300px" : "(max-width: 810px) 92vw, min(880px, 78vw)"}
                      />
                    )}

                    {isCenter && a.live && !isLive ? (
                      <div className="demo-cta">
                        <button type="button" className="demo-trybtn demo-try" onClick={() => setLive(a.id)}>
                          {a.live.cta}
                        </button>
                        {/*
                         * Petit écran : on renonce proprement. Une caisse de
                         * tablette pliée dans 375 px ne se lit pas — le plein
                         * écran, lui, se manipule vraiment.
                         */}
                        <a
                          className="demo-trybtn demo-tryout"
                          href={demoHref(a.live.origin)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {a.live.ctaOut}
                        </a>
                        <span className="demo-ctanote">Démo dans votre navigateur · aucune donnée réelle</span>
                      </div>
                    ) : null}

                    {isCenter ? null : (
                      <button
                        type="button"
                        className="demo-focusbtn"
                        aria-label={`Voir ${a.label}`}
                        tabIndex={-1}
                        onClick={() => go(i)}
                      />
                    )}
                  </DeviceFrame>

                  {isLive && a.live ? (
                    <p className="demo-hint">
                      <span className="demo-hintdot" aria-hidden="true" />
                      <span className="demo-hinttext">{a.live.hint}</span>
                      <button type="button" className="demo-stop" onClick={() => setLive(null)}>
                        Arrêter la démo
                      </button>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="demo-arrow prev"
            aria-label="Application précédente"
            onClick={() => go(current - 1)}
          >
            <Chevron size={18} dir="left" />
          </button>
          <button
            type="button"
            className="demo-arrow next"
            aria-label="Application suivante"
            onClick={() => go(current + 1)}
          >
            <Chevron size={18} />
          </button>
        </div>

        <p className="demo-caption rv" aria-live="polite">
          <strong>{app.lead}</strong>
          {app.body}
          <span className="demo-chips">
            {app.chips.map((c) => (
              <em key={c}>{c}</em>
            ))}
          </span>
        </p>
      </section>
    </>
  );
}
