"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import "./restaurant-journey.css";

const PHASE_MS = 6_000;
const PHASES = [
  {
    label: "Votre point de départ",
    title: "Vous partez de votre réalité.",
    description: "Votre carte, vos outils, votre équipe : vous nous dites ce que vous souhaitez améliorer.",
    headline: <>Votre restaurant.<br />Vos priorités.</>,
    detail: "Une carte à faire évoluer. Un service à simplifier. Un projet à préciser.",
  },
  {
    label: "Notre échange",
    title: "Nous cadrons votre besoin.",
    description: "Un échange pour comprendre votre fonctionnement, vos priorités et votre budget.",
    headline: <>Commençons par<br />vous écouter.</>,
    detail: "Nous regardons avec vous ce qui vous serait utile et ce que vous souhaitez conserver.",
  },
  {
    label: "Votre proposition",
    title: "Vous choisissez une offre claire.",
    description: "Applications, prestations, inclusions et tarifs : vous savez ce qui est prévu avant de vous engager.",
    headline: <>Les bons outils.<br />Un périmètre clair.</>,
    detail: "Les solutions retenues, leur prix et les conditions de mise en service sont détaillés.",
  },
  {
    label: "La mise en place",
    title: "Nous préparons le lancement.",
    description: "Configuration des outils retenus, prise en main et accompagnement : le calendrier est convenu avec vous.",
    headline: <>Une mise en place<br />accompagnée.</>,
    detail: "Votre carte et vos réglages prennent leur place. Nous vous accompagnons dans la prise en main.",
  },
] as const;

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function JourneyIcon({ kind }: { kind: "check" | "arrow" | "pause" | "play" | "replay" | "message" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "check" && <path d="m5 12 4.5 4.5L19 7" />}
    {kind === "arrow" && <path d="M4 12h15m-6-6 6 6-6 6" />}
    {kind === "pause" && <><path d="M8 5v14M16 5v14" /></>}
    {kind === "play" && <path d="m8 5 11 7-11 7Z" />}
    {kind === "replay" && <><path d="M4 9a8 8 0 1 1 .8 8M4 4v5h5" /></>}
    {kind === "message" && <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5a9 9 0 0 1 18 0Z" />}
  </svg>;
}

function NeedsIllustration() {
  return <div className="journey-needs">
    <div className="journey-menu-paper journey-reveal journey-delay-one">
      <span className="journey-paper-mark">À la carte</span>
      <span className="journey-paper-rule" />
      <span>Nos spécialités</span><i /><i />
      <span>Nos formules</span><i /><i />
      <span>Pour finir</span><i />
      <span className="journey-paper-end">Votre identité, votre carte.</span>
    </div>
    <div className="journey-brief journey-reveal journey-delay-two">
      <span className="journey-mini-label">Vos priorités</span>
      <strong>Qu’aimeriez-vous<br />faire évoluer ?</strong>
      {["La présentation de ma carte", "L’organisation du service", "La commande en direct"].map((item, index) =>
        <div className={`journey-brief-row journey-reveal journey-delay-${index + 3}`} key={item}>
          <span className="journey-check"><JourneyIcon kind="check" /></span>{item}
        </div>,
      )}
    </div>
  </div>;
}

function ConversationIllustration() {
  return <div className="journey-conversation">
    <div className="journey-person journey-reveal journey-delay-one"><span className="journey-person-mark">Vous</span><span>Votre restaurant</span></div>
    <div className="journey-message journey-reveal journey-delay-two">« Je souhaite moderniser mes menus. »</div>
    <div className="journey-reply journey-reveal journey-delay-3">
      <span className="journey-sm-mark">SM</span>
      <div><span className="journey-mini-label">Snack Manager</span><p>Parlons de votre carte, de vos supports et de votre budget.</p></div>
    </div>
    <div className="journey-conversation-summary journey-reveal journey-delay-4">
      <JourneyIcon kind="message" /><span>Un échange concret.<br /><strong>Des priorités partagées.</strong></span>
    </div>
  </div>;
}

function ProposalIllustration() {
  return <div className="journey-proposal journey-reveal journey-delay-one">
    <div className="journey-proposal-top"><span className="journey-mini-label">Votre proposition</span><span className="journey-paper-status">À valider ensemble</span></div>
    <strong className="journey-proposal-title">Pour votre restaurant.</strong>
    <p className="journey-proposal-caption">Un choix adapté à votre projet.</p>
    {[
      ["Applications", "Les outils retenus"],
      ["Prestations", "Les supports et services choisis"],
      ["Conditions", "Les prix et la mise en service"],
    ].map(([name, detail], index) => <div className={`journey-proposal-row journey-reveal journey-delay-${index + 2}`} key={name}>
      <span className="journey-check"><JourneyIcon kind="check" /></span><span><strong>{name}</strong><small>{detail}</small></span>
    </div>)}
    <div className="journey-proposal-total journey-reveal journey-delay-5"><span>Inclusions et tarifs détaillés</span><JourneyIcon kind="arrow" /></div>
  </div>;
}

function SetupIllustration() {
  return <div className="journey-setup">
    <div className="journey-setup-heading journey-reveal journey-delay-one"><span className="journey-sm-mark">SM</span><div><span className="journey-mini-label">La mise en place</span><strong>Nous avançons avec vous.</strong></div></div>
    <div className="journey-workflow">
      {[
        ["Votre carte", "Produits, prix, identité"],
        ["Vos réglages", "Les outils que vous avez choisis"],
        ["Votre prise en main", "Un accompagnement au démarrage"],
      ].map(([title, description], index) => <div className={`journey-workflow-step journey-reveal journey-delay-${index + 2}`} key={title}>
        <span className="journey-workflow-node"><JourneyIcon kind="check" /></span><span><strong>{title}</strong><small>{description}</small></span>
      </div>)}
    </div>
    <div className="journey-setup-foot journey-reveal journey-delay-5"><span className="journey-small-dot" />Un calendrier convenu ensemble.</div>
  </div>;
}

const ILLUSTRATIONS = [NeedsIllustration, ConversationIllustration, ProposalIllustration, SetupIllustration] as const;

/** Public, conceptual illustration. No application, account or business data is loaded. */
export function RestaurantJourney() {
  const titleId = useId();
  const sequenceId = useId();
  const stageRef = useRef<HTMLElement>(null);
  const phaseButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const clock = useRef({ phase: 0, remaining: PHASE_MS });
  const [phase, setPhase] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [replay, setReplay] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
  const playing = visible && pageVisible && !paused && !completed && !reducedMotion;

  useEffect(() => {
    const target = stageRef.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.3 });
    observer.observe(target);
    const handleVisibility = () => setPageVisible(document.visibilityState === "visible");
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", handleVisibility); };
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (clock.current.phase !== phase) clock.current = { phase, remaining: PHASE_MS };
    const phaseClock = clock.current;
    const started = performance.now();
    let elapsed = false;
    const timer = window.setTimeout(() => {
      elapsed = true;
      clock.current.remaining = PHASE_MS;
      if (phase === PHASES.length - 1) setCompleted(true);
      else { setManual(false); setPhase(phase + 1); }
    }, clock.current.remaining);
    return () => {
      window.clearTimeout(timer);
      if (!elapsed && clock.current === phaseClock) phaseClock.remaining = Math.max(0, phaseClock.remaining - (performance.now() - started));
    };
  }, [phase, playing, replay]);

  function selectPhase(index: number) {
    setPaused(true);
    setManual(true);
    setCompleted(false);
    setPhase(index);
    clock.current = { phase: index, remaining: PHASE_MS };
  }

  function selectWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % PHASES.length
      : event.key === "ArrowLeft" ? (index + PHASES.length - 1) % PHASES.length
        : event.key === "Home" ? 0 : event.key === "End" ? PHASES.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectPhase(next);
    phaseButtons.current[next]?.focus();
  }

  function replaySequence() {
    clock.current = { phase: 0, remaining: PHASE_MS };
    setPhase(0);
    setReplay((value) => value + 1);
    setPaused(false);
    setManual(false);
    setCompleted(false);
  }

  function togglePlayback() {
    if (paused) setManual(false);
    setPaused((value) => !value);
  }

  const Illustration = ILLUSTRATIONS[phase];
  const currentPhase = PHASES[phase];

  return <section className="section journey" id="lancement" aria-labelledby={titleId} data-playing={playing} data-static={reducedMotion || manual}>
    <div className="journey-heading">
      <span className="badge">Notre accompagnement</span>
      <h2 className="h2" id={titleId}>Votre projet commence<br />par une conversation.</h2>
      <p>De votre premier besoin à la mise en place, nous avançons avec vous, étape par étape.</p>
    </div>

    <figure className="journey-film" ref={stageRef}>
      <div className="journey-film-top"><span>Votre restaurant. Notre accompagnement.</span><span className="journey-illustration-label">Illustration du parcours</span></div>
      <div className="journey-scene" key={`${phase}-${replay}`} aria-hidden="true">
        <div className="journey-narration">
          <span className="journey-scene-number">0{phase + 1}<span>/ 04</span></span>
          <span className="journey-mini-label">{currentPhase.label}</span>
          <p className="journey-scene-title journey-reveal journey-delay-one">{currentPhase.headline}</p>
          <p className="journey-scene-detail journey-reveal journey-delay-two">{currentPhase.detail}</p>
          <div className="journey-flow-line"><span /><JourneyIcon kind="arrow" /></div>
        </div>
        <div className="journey-visual"><Illustration /></div>
      </div>
      <figcaption className="journey-controls">
        <span className="journey-playback-note">{reducedMotion ? "Présentation sans animation" : completed ? "Les étapes restent à votre disposition" : "4 étapes · 24 secondes"}</span>
        <div className="journey-control-buttons">
          <button type="button" onClick={togglePlayback} aria-pressed={paused} disabled={reducedMotion || completed} aria-label={paused ? "Reprendre l’animation du parcours" : "Mettre l’animation du parcours en pause"}>
            <JourneyIcon kind={paused ? "play" : "pause"} />{paused ? "Lire" : "Pause"}
          </button>
          <button type="button" onClick={replaySequence} disabled={reducedMotion} aria-label="Rejouer les quatre étapes du parcours"><JourneyIcon kind="replay" />Rejouer</button>
        </div>
      </figcaption>
    </figure>

    <ol className="journey-phases" aria-label="Les quatre étapes de votre accompagnement" id={sequenceId}>
      {PHASES.map((item, index) => <li className="journey-phase" key={item.label} data-current={phase === index}>
        <button type="button" aria-pressed={phase === index} aria-describedby={`${sequenceId}-${index}`} onClick={() => selectPhase(index)} onKeyDown={(event) => selectWithKeyboard(event, index)} ref={(node) => { phaseButtons.current[index] = node; }}>
          <span className="journey-phase-rail" aria-hidden="true"><span className="journey-phase-fill" key={`${phase}-${replay}-${index}`} /></span>
          <span className="journey-phase-number" aria-hidden="true">0{index + 1}</span>
          <span className="journey-phase-title">{item.title}</span>
        </button>
        <p id={`${sequenceId}-${index}`}>{item.description}</p>
      </li>)}
    </ol>
  </section>;
}
