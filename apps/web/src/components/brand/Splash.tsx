"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DECOUPE_ECLAIR,
  ECLAIR,
  GARNITURE,
  LAITON,
  PAIN_BAS,
  PAIN_HAUT,
  TICKET,
  TRAIT_CADRE,
} from "./geometry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ÉCRAN D'OUVERTURE — LE TICKET-BURGER QUI SE DESSINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le signe s'écrit sous les yeux, dans l'ordre où on le lirait : le ticket se
 * trace, les trois couches du burger apparaissent l'une après l'autre, puis
 * l'éclair frappe et le nom se dévoile. C'est la même géométrie que partout
 * ailleurs — importée de `geometry.ts`, jamais recopiée.
 *
 * ═══ CE QUI A ÉTÉ RE-CADENCÉ, ET POURQUOI ═══
 *
 * La composition d'origine dure 10,2 secondes. C'est une bande de
 * démonstration, pas un écran de chargement : retenir un gérant dix secondes
 * devant son écran à 12 h 30 n'est pas une marque, c'est un défaut.
 *
 * Les temps sont donc exprimés en FRACTIONS de la durée totale, pas en
 * secondes. La cadence relative — l'ordre, les chevauchements, le silence
 * avant l'éclair — est celle de l'auteur ; seule l'échelle change. Régler
 * `duree` suffit à re-cadencer l'ensemble sans toucher à une seule courbe.
 *
 * ═══ TROIS GARANTIES QUI PRIMENT SUR L'EFFET ═══
 *
 * 1. IL NE BLOQUE JAMAIS. C'est un calque au-dessus d'une page déjà rendue,
 *    et il se retire tout seul. Si le JS échoue, la page est là-dessous.
 * 2. IL RESPECTE `prefers-reduced-motion`. La règle globale de `globals.css`
 *    neutralise les animations CSS — celle-ci est pilotée en JS, elle n'y
 *    serait pas soumise. On teste donc la requête média nous-mêmes, et on
 *    s'efface immédiatement.
 * 3. IL NE PARAÎT JAMAIS DEVANT UN MANGEUR. Charte §10 : notre marque n'a
 *    rien à faire sur le site de commande d'un restaurant, son écran de salle
 *    ou son suivi. C'est à l'appelant de ne pas le monter là — voir
 *    `SplashAuPremierPassage`, qui porte cette garde.
 */

/* ── Courbes, portées telles quelles depuis le moteur d'origine ─────────── */

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutQuart = (t: number) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(t - 1, 4);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** `animate` du moteur : borné aux extrémités, interpolé au milieu. */
const anim =
  (from: number, to: number, start: number, end: number, ease: (t: number) => number) =>
  (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    return from + (to - from) * ease((t - start) / (end - start));
  };

/** `interpolate` du moteur : une table de points, une courbe entre chacun. */
const table = (entrees: number[], sorties: number[], ease: (t: number) => number) => (t: number) => {
  if (t <= entrees[0]) return sorties[0];
  if (t >= entrees[entrees.length - 1]) return sorties[sorties.length - 1];
  for (let i = 0; i < entrees.length - 1; i++) {
    if (t >= entrees[i] && t <= entrees[i + 1]) {
      const portee = entrees[i + 1] - entrees[i];
      const local = portee === 0 ? 0 : (t - entrees[i]) / portee;
      return sorties[i] + (sorties[i + 1] - sorties[i]) * ease(local);
    }
  }
  return sorties[sorties.length - 1];
};

/**
 * LES TEMPS, EN FRACTIONS DE LA DURÉE TOTALE.
 *
 * Dérivés de la composition d'origine (10,2 s) en retirant sa seconde
 * d'amorce morte et son temps de pose : ce qui restait était un écran de
 * chargement qui attendait pour rien. Les chevauchements sont conservés —
 * c'est eux qui donnent l'enchaînement plutôt qu'une succession de saccades.
 */
const B = {
  cadre: [0.0, 0.3],
  pain: [0.25, 0.4],
  garniture: [0.35, 0.5],
  base: [0.45, 0.6],
  eclair: [0.56, 0.71],
  mot1: [0.66, 0.83],
  mot2: [0.74, 0.91],
  sortie: [0.9, 1.0],
} as const;

/** La jauge n'avance pas linéairement : elle hésite, puis rattrape. */
const JAUGE = table(
  [0, 0.12, 0.26, 0.36, 0.44, 0.5, 0.62, 0.76, 0.86, 0.94, 1],
  [0, 3, 19, 34, 47, 49, 71, 86, 92, 100, 100],
  easeInOutSine,
);

export type SplashProps = {
  /** Durée totale, en secondes. 3,6 par défaut — réglé à l'œil sur le rendu réel. */
  duree?: number;
  /** Appelé une fois le calque entièrement sorti. */
  onFini?: () => void;
  /** Texte lu par les lecteurs d'écran pendant l'attente. */
  annonce?: string;
};

export function Splash({ duree = 3.6, onFini, annonce = "Chargement" }: SplashProps) {
  const masqueId = useId();
  const [t, setT] = useState(0);
  const fini = useRef(false);

  useEffect(() => {
    /*
     * MOUVEMENT RÉDUIT : on ne joue rien. La règle globale de `globals.css`
     * ramène les animations CSS à 0,01 ms, mais elle ne peut rien contre une
     * boucle `requestAnimationFrame` — c'est à nous de la respecter.
     */
    const reduit =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduit) {
      onFini?.();
      return;
    }

    let brut = 0;
    const depart = performance.now();
    const boucle = (maintenant: number) => {
      const p = Math.min(1, (maintenant - depart) / (duree * 1000));
      setT(p);
      if (p < 1) {
        brut = requestAnimationFrame(boucle);
      } else if (!fini.current) {
        fini.current = true;
        onFini?.();
      }
    };
    brut = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(brut);
  }, [duree, onFini]);

  const trace = (b: readonly [number, number]) => anim(0, 1, b[0], b[1], easeInOutQuart)(t);
  const entre = (b: readonly [number, number]) => anim(0, 1, b[0], b[1], easeOutCubic)(t);

  const cadre = trace(B.cadre);
  const gPain = trace(B.pain);
  const gGarn = trace(B.garniture);
  const gBase = trace(B.base);
  // Le remplissage suit son propre tracé fantôme, décalé d'un souffle.
  const fPain = anim(0, 1, B.pain[1] - 0.04, B.pain[1] + 0.04, easeOutCubic)(t);
  const fGarn = anim(0, 1, B.garniture[1] - 0.04, B.garniture[1] + 0.04, easeOutCubic)(t);
  const fBase = anim(0, 1, B.base[1] - 0.04, B.base[1] + 0.04, easeOutCubic)(t);
  const eclair = anim(0, 1, B.eclair[0], B.eclair[1], easeOutBack)(t);
  const frappe = entre([B.eclair[0] - 0.01, B.eclair[0] + 0.06]);
  const mot1 = entre(B.mot1);
  const mot2 = entre(B.mot2);
  const sortie = entre(B.sortie);
  const pct = JAUGE(t);
  const pret = pct >= 99.5;

  const fantome = (d: string, p: number) => (
    <path
      d={d}
      pathLength={1}
      fill="none"
      stroke={LAITON}
      strokeWidth={0.55}
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeDasharray={1}
      strokeDashoffset={1 - p}
      opacity={p > 0 ? 0.9 - 0.6 * p : 0}
    />
  );

  const mot = (texte: string, p: number, couleur: string) => (
    <span
      style={{
        display: "block",
        color: couleur,
        // Le mot se dévoile par la gauche, il n'apparaît pas d'un bloc.
        clipPath: `inset(-20% ${(1 - p) * 100}% -20% -2%)`,
        transform: `translateY(${(1 - p) * 0.14}em)`,
        opacity: 0.15 + 0.85 * p,
      }}
    >
      {texte}
    </span>
  );

  return (
    <div className="sm-splash" role="status" aria-live="polite" style={{ opacity: 1 - sortie }}>
      <span className="sr-only">{pret ? "Prêt" : annonce}</span>

      {/* Le halo respire et tourne — un décor de fond, jamais un traitement du
          logo (charte §09 : aucun effet sur le signe lui-même). */}
      <div
        className="sm-splash-halo"
        aria-hidden="true"
        style={{
          transform: `translate(-50%,-50%) scale(${0.7 + 0.3 * entre([0, 0.22])}) rotate(${t * 60}deg)`,
          opacity: 0.18 + 0.5 * entre([0.02, 0.14]) - 0.5 * sortie,
        }}
      />

      <div
        className="sm-splash-scene"
        style={{
          opacity: 1 - sortie,
          transform: `translateY(${-3.5 * sortie}vh) scale(${1 + 0.05 * sortie})`,
          filter: sortie > 0 ? `blur(${9 * sortie}px)` : undefined,
        }}
      >
        <div className="sm-splash-groupe">
          <svg viewBox="0 0 32 32" className="sm-splash-mark" aria-hidden="true">
            <defs>
              <mask id={masqueId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
                <rect width="32" height="32" fill="#fff" />
                <path
                  d={ECLAIR}
                  fill="#000"
                  stroke="#000"
                  strokeWidth={DECOUPE_ECLAIR}
                  strokeLinejoin="round"
                  opacity={eclair > 0.02 ? 1 : 0}
                />
              </mask>
            </defs>

            {/* L'ÉCLAIR EST PEINT ICI, ET SEULEMENT ICI. Le reste du produit
                l'évide ; pendant l'ouverture il frappe d'abord en laiton, puis
                le masque le creuse — c'est la seule licence, et elle dure une
                fraction de seconde. */}
            <g opacity={eclair}>
              <path
                d={ECLAIR}
                fill={LAITON}
                transform={`translate(16 16) scale(${0.9 + 0.1 * eclair}) translate(-16 -16)`}
              />
              <path
                d={ECLAIR}
                fill="none"
                stroke={LAITON}
                strokeWidth={1.6 * (1 - frappe)}
                strokeLinejoin="round"
                opacity={0.55 * (1 - frappe)}
              />
            </g>

            <g mask={`url(#${masqueId})`}>
              <path d={PAIN_HAUT} fill="currentColor" opacity={fPain} />
              <path d={GARNITURE} fill="currentColor" opacity={fGarn} />
              <path d={PAIN_BAS} fill="currentColor" opacity={fBase} />
            </g>

            {fantome(PAIN_HAUT, gPain)}
            {fantome(GARNITURE, gGarn)}
            {fantome(PAIN_BAS, gBase)}

            <path
              d={TICKET}
              pathLength={1}
              fill="none"
              stroke="currentColor"
              strokeWidth={TRAIT_CADRE}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={1}
              strokeDashoffset={1 - cadre}
            />
            {/* Une étincelle court en tête du tracé — elle disparaît dès qu'il
                se referme. */}
            <path
              d={TICKET}
              pathLength={1}
              fill="none"
              stroke={LAITON}
              strokeWidth={2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="0.012 0.988"
              strokeDashoffset={1 - cadre}
              opacity={cadre > 0 && cadre < 1 ? 1 : 0}
            />
          </svg>

          <div className="sm-splash-nom" aria-hidden="true">
            {mot("Snack", mot1, "currentColor")}
            <span style={{ display: "block", width: "0.08em" }} />
            {mot("Manager", mot2, LAITON)}
          </div>
        </div>

        <div className="sm-splash-jauge" aria-hidden="true">
          <div className="sm-splash-rail">
            <div
              className="sm-splash-barre"
              style={{
                width: `${pct}%`,
                boxShadow: `0 0 ${10 + 26 * (1 - sortie)}px ${LAITON}`,
              }}
            />
          </div>
          <div className="sm-splash-etat">
            <span>{pret ? "Prêt" : "Chargement"}</span>
            <span style={{ color: pret ? LAITON : "currentColor" }}>{Math.round(pct)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
