"use client";

import { LogoMark } from "../../brand/Logo";
import { CINEMA_SHOTS, DEMO_APPS } from "../content";
import { Photo } from "../Photo";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./service.module.css";

const STEPS = [
  { short: "La commande", title: "Une commande bien cadrée.", body: "Produits, options et total : la caisse accompagne la prise de commande.", app: DEMO_APPS[0], shot: CINEMA_SHOTS.pos, label: "Caisse · prise de commande", link: "Explorer la caisse" },
  { short: "La cuisine", title: "Une préparation lisible.", body: "Les tickets et leurs statuts aident l’équipe à suivre ce qui reste à préparer.", app: DEMO_APPS[1], shot: CINEMA_SHOTS.kds, label: "Cuisine · suivi des préparations", link: "Explorer l’écran cuisine" },
  { short: "La remise", title: "Le bon mode de remise.", body: "Retrait au restaurant ou livraison par votre propre équipe, selon votre organisation.", app: null, shot: null, label: "Retrait & livraison · parcours illustré", link: "Parler de mon organisation" },
  { short: "Le suivi", title: "Vous gardez la vue d’ensemble.", body: "Retrouvez les commandes et les ventes dans votre espace gérant.", app: DEMO_APPS[3], shot: CINEMA_SHOTS.bo, label: "Back-office · suivi de l’activité", link: "Explorer le back-office" },
] as const;

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16 16 4H5m11 0v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Bag({ small = false }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 100 120" width={small ? 40 : 72} fill="none" aria-hidden="true">
      <path d="M22 34h56l9 76H13l9-76Z" fill="#a69570" fillOpacity=".15" stroke="#c9b185" strokeWidth="1.5" />
      <path d="M35 42V27c0-21 30-21 30 0v15" stroke="#c9b185" strokeWidth="2" strokeLinecap="round" />
      <path d="M37 70h26M37 77h26M43 84h14" stroke="#c9b185" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A conceptual handoff, not a fabricated screenshot of the driver application. */
function Handoff() {
  return (
    <div className={styles.handoff}>
      <div className={styles.handoffOrigin}><LogoMark size={28} /><span>Votre restaurant</span><strong>Commande prête</strong></div>
      <div className={styles.handoffLines} aria-hidden="true"><i /><i /><span /></div>
      <div className={styles.handoffRoutes}>
        <div className={styles.routeCard}><div className={styles.routePicture}><Bag /></div><span className={styles.routeLabel}>Au comptoir</span><strong>Le client vient<br />la récupérer.</strong><span className={styles.routeTag}>Retrait</span></div>
        <div className={styles.routeCard}><div className={styles.routePicture}><div className={styles.routePhone}><span /><Bag small /><i /></div></div><span className={styles.routeLabel}>Avec votre équipe</span><strong>Votre livreur<br />prend le relais.</strong><span className={styles.routeTag}>Pilote accompagné</span></div>
      </div>
    </div>
  );
}

export function ServiceStory() {
  const { ref, step, select, playing, reduced } = useSceneMotion({ count: STEPS.length, intervalMs: 6000 });

  return (
    <section className={styles.section} id="service" aria-labelledby="service-title">
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}><span>02 /</span> Du comptoir à la cuisine</p><h2 id="service-title">Chaque équipe avance.<br /><span>Vous gardez le fil.</span></h2></div>
        <p className={styles.introduction}>À chaque étape du service, le bon outil et les bonnes informations. Découvrez comment les applications prennent leur place dans votre restaurant.</p>
      </div>

      <div ref={ref} className={styles.story} data-playing={playing} data-reduced={reduced} data-step={step}>
        <div className={styles.topline}>
          <span className={styles.notch}><span /> Parcours illustré</span>
          <span className={styles.sceneLabel}>Un service, plusieurs équipes</span>
          <MotionControl className={styles.motionControl} />
        </div>

        <div className={styles.stage}>
          <div className={styles.stageAside}>
            <span className={styles.asideCaption}>Tout commence ici</span>
            <div className={styles.ticket} aria-hidden="true">
              <span className={styles.ticketTop}><LogoMark size={23} /><span>La commande</span></span>
              <span className={styles.ticketRule} />
              <span className={styles.ticketItem}><span>Un plat</span><i /></span>
              <span className={styles.ticketOption}>Les options choisies</span>
              <span className={styles.ticketItem}><span>Un accompagnement</span><i /></span>
              <span className={styles.ticketItem}><span>Une boisson</span><i /></span>
              <span className={styles.ticketRule} />
              <span className={styles.ticketEnd}>Le détail suit le service <span>↗</span></span>
            </div>
            <div className={styles.asideConnector} aria-hidden="true"><span /><i /></div>
            <span className={styles.asideFootnote}>Une illustration du parcours.<br />Aucune commande réelle n’est passée.</span>
          </div>

          <div className={styles.display}>
            <div className={styles.displayBar}><LogoMark size={18} /><span>{STEPS[step].label}</span><span className={styles.displayIndex}>0{step + 1}<span> / 04</span></span></div>
            <div className={styles.displayContent}>
              {STEPS.map((item, index) => (
                <div className={styles.scene} key={item.short} data-active={step === index} aria-hidden={step !== index}>
                  {item.shot ? <Photo shot={item.shot} sizes="(max-width: 700px) 95vw, 850px" /> : <Handoff />}
                </div>
              ))}
            </div>
            <div className={styles.displayCaption}><span>Captures de démonstration · remise illustrée</span><span>Snack Manager</span></div>
          </div>
        </div>

        <div className={styles.timeline} role="group" aria-label="Choisir une étape du service">
          {STEPS.map((item, index) => (
            <button key={item.short} type="button" aria-pressed={step === index} onClick={() => select(index)}>
              <span className={styles.timelineTrack} aria-hidden="true"><span /></span>
              <span className={styles.timelineNumber}>{String(index + 1).padStart(2, "0")}</span><span>{item.short}</span>
            </button>
          ))}
        </div>
      </div>

      <ol className={styles.explanations}>
        {STEPS.map((item, index) => (
          <li key={item.short}><span className={styles.explanationNumber}>0{index + 1}</span><h3>{item.title}</h3><p>{item.body}</p><a href={item.app?.live?.href ?? "/?besoin=service#contact"}>{item.link}<Arrow /></a></li>
        ))}
      </ol>
      <div className={styles.bottomline}>
        <p>Livraison par vos livreurs en pilote accompagné, après validation avec votre établissement. Les démonstrations utilisent des jeux de données indépendants.</p>
        <a href="#produit">Voir toutes les applications <Arrow /></a>
      </div>
    </section>
  );
}
