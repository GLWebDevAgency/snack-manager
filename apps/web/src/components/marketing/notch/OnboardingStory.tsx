"use client";

import Link from "next/link";
import { useId, useRef, type KeyboardEvent } from "react";
import { aPartirDe, DEMO_PATHS, INSTALL_FROM_CENTS } from "../content";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./onboarding.module.css";

const STEPS = [
  {
    label: "Besoin",
    eyebrow: "On part de votre quotidien",
    title: "Votre restaurant. Vos priorités.",
    body: "Une carte à refaire, des commandes à organiser, des clients à faire revenir. Vous nous dites ce qui compte aujourd’hui et ce que vous avez déjà.",
    detail: "Pas besoin d’avoir déjà choisi une formule.",
  },
  {
    label: "Échange",
    eyebrow: "On prend le temps de comprendre",
    title: "Un échange pour y voir clair.",
    body: "Nous regardons avec vous votre façon de travailler, vos supports et votre équipement. Puis nous identifions les applications et les services utiles à votre projet.",
    detail: "Vous gardez la main sur le périmètre.",
  },
  {
    label: "Devis",
    eyebrow: "Vous savez ce que vous choisissez",
    title: "Une proposition, ligne par ligne.",
    body: "Logiciel, création ponctuelle, installation : chaque poste est distingué. Les prestations, les frais éventuels et les conditions sont précisés avant votre décision.",
    detail: "Le contenu, le prix et le calendrier se lisent ensemble.",
  },
  {
    label: "Réglages",
    eyebrow: "On prépare votre lancement",
    title: "Votre configuration prend forme.",
    body: "Nous préparons les modules retenus, vérifions la compatibilité du matériel et convenons avec vous de la mise en service. L’accompagnement à distance ou sur place suit le devis.",
    detail: "Votre carte et votre organisation servent de point de départ.",
  },
  {
    label: "Suivi",
    eyebrow: "Et après le lancement",
    title: "Un contact pour la suite.",
    body: "Prise en main, questions, évolution de vos besoins : vous savez vers qui vous tourner. Le support et les mises à jour accompagnent l’utilisation de vos applications, selon votre contrat.",
    detail: "Votre activité évolue. On refait le point quand c’est utile.",
  },
] as const;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-7-7 7 7-7 7"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Mark({ type }: { type: "menu" | "orders" | "service" | "check" | "screen" }) {
  const paths = {
    menu: "M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h3",
    orders: "M5 7h14l1 14H4L5 7Zm3 0V6a4 4 0 0 1 8 0v1m-8 6 3 3 5-5",
    service: "M3 17h18M5 14a7 7 0 0 1 14 0H5Zm7-12v3M7 21h10",
    check: "m5 12 4 4L19 6",
    screen: "M3 3h18v13H3V3Zm9 13v5m-5 0h10",
  };
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[type]} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function NeedIllustration() {
  return <div className={styles.needs}>
    <div className={styles.needsCentre}><span>VOTRE</span><strong>projet</strong><i /></div>
    <svg className={styles.needsLinks} viewBox="0 0 480 400" fill="none"><path d="M98 97 240 200 392 93M91 315 240 200 386 312" /><circle cx="240" cy="200" r="91" /><circle cx="240" cy="200" r="138" /></svg>
    <div className={`${styles.needCard} ${styles.needOne}`}><Mark type="menu" /><span>Ma carte</span><b>01</b></div>
    <div className={`${styles.needCard} ${styles.needTwo}`}><Mark type="orders" /><span>Mes commandes</span><b>02</b></div>
    <div className={`${styles.needCard} ${styles.needThree}`}><Mark type="service" /><span>Mon service</span><b>03</b></div>
    <div className={`${styles.needCard} ${styles.needFour}`}><Mark type="screen" /><span>Ma visibilité</span><b>04</b></div>
  </div>;
}

function ExchangeIllustration() {
  return <div className={styles.exchange}>
    <div className={styles.exchangeOrbit}><i /><i /><i /></div>
    <div className={styles.messageFirst}>
      <span className={styles.speaker}><i /> Vous</span>
      <strong>« Voici comment<br />on travaille. »</strong>
      <div className={styles.voice}>{Array.from({ length: 17 }, (_, i) => <i key={i} style={{ height: `${[12, 21, 32, 17, 38, 26, 16][i % 7]}px`, animationDelay: `${i * 70}ms` }} />)}</div>
    </div>
    <div className={styles.messageSecond}>
      <span className={styles.speaker}><i /> Snack Manager</span>
      <strong>On construit<br />à partir de là.</strong>
      <span className={styles.messageCheck}><Mark type="check" /> Besoin compris</span>
    </div>
    <div className={styles.connection}><span /><span /><span /></div>
  </div>;
}

function ProposalIllustration() {
  return <div className={styles.proposal}>
    <div className={styles.paperBack} />
    <span className={`${styles.proposalSlip} ${styles.proposalSlipFirst}`}><Mark type="menu" /> Vos besoins</span>
    <span className={`${styles.proposalSlip} ${styles.proposalSlipSecond}`}><Mark type="check" /> Vos choix</span>
    <div className={styles.paper}>
      <div className={styles.paperHeader}><span>VOTRE PROJET</span><Arrow diagonal /></div>
      <strong className={styles.paperTitle}>Tout est<br />posé.</strong>
      <div className={styles.paperRule} />
      <div className={styles.quoteRow}><b>01</b><div><strong>Logiciel</strong><span>Abonnement retenu</span></div><i /></div>
      <div className={styles.quoteRow}><b>02</b><div><strong>Prestation ponctuelle</strong><span>Périmètre détaillé</span></div><i /></div>
      <div className={styles.quoteRow}><b>03</b><div><strong>Frais à préciser</strong><span>Matériel, paiement, déplacement…</span></div><i /></div>
      <div className={styles.paperFooter}><span>Une décision éclairée.</span><Mark type="check" /></div>
    </div>
    <span className={styles.proposalTag}>Proposition détaillée <Arrow diagonal /></span>
  </div>;
}

function ConfigurationIllustration() {
  return <div className={styles.configuration}>
    <svg className={styles.deviceLinks} viewBox="0 0 480 400" fill="none"><path d="M99 266v62h265V188M235 198v130" /><circle cx="235" cy="328" r="5" /><circle cx="99" cy="266" r="4" /></svg>
    <div className={styles.configScreen}>
      <div className={styles.screenHeader}><i /><span>Votre configuration</span><span>SM</span></div>
      <div className={styles.configMenu}><b>Votre carte</b><span /><span /><span /></div>
      <div className={styles.configTiles}><i><Mark type="menu" /></i><i><Mark type="orders" /></i><i><Mark type="service" /></i></div>
      <div className={styles.configStatus}><Mark type="check" /><span>Modules choisis ensemble</span></div>
    </div>
    <div className={styles.configPhone}><i /><Mark type="check" /><strong>À votre<br />image.</strong><span /><span /></div>
    <div className={styles.configTicket}><Mark type="check" /><span>Équipement<br /><strong>à vérifier ensemble</strong></span></div>
  </div>;
}

function SupportIllustration() {
  return <div className={styles.support}>
    <svg className={styles.supportOrbit} viewBox="0 0 480 400" fill="none"><ellipse cx="240" cy="200" rx="169" ry="137" /><ellipse cx="240" cy="200" rx="118" ry="94" /><path d="M240 63v43m0 188v43M71 200h51m236 0h51" /></svg>
    <div className={styles.supportCore}><span>ON GARDE</span><strong>le lien.</strong><span className={styles.supportSignal}><i /><i /><i /></span></div>
    <div className={`${styles.supportLabel} ${styles.supportTop}`}><Mark type="check" /><span>Prise en main</span></div>
    <div className={`${styles.supportLabel} ${styles.supportRight}`}><span>Vos questions</span><i /></div>
    <div className={`${styles.supportLabel} ${styles.supportBottom}`}><Mark type="check" /><span>Mises à jour</span></div>
    <div className={`${styles.supportLabel} ${styles.supportLeft}`}><i /><span>Vos besoins</span></div>
  </div>;
}

const ILLUSTRATIONS = [NeedIllustration, ExchangeIllustration, ProposalIllustration, ConfigurationIllustration, SupportIllustration];

export function OnboardingStory() {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const { ref, step, select, playing, reduced } = useSceneMotion({ count: STEPS.length, intervalMs: 8500 });

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % STEPS.length;
    else if (event.key === "ArrowLeft") next = (index + STEPS.length - 1) % STEPS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = STEPS.length - 1;
    else return;
    event.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }

  return <section className={styles.section} id="lancement" aria-labelledby={`${id}-heading`}>
    <div className={styles.heading}>
      <p className={styles.eyebrow}><span /> De la première idée au premier service</p>
      <h2 id={`${id}-heading`}>Votre projet avance<br />avec <em>un interlocuteur.</em></h2>
      <p className={styles.intro}>Vous connaissez votre métier. Nous vous aidons à choisir et à mettre en place les bons outils, étape par étape.</p>
    </div>

    <div className={styles.story} ref={ref} data-playing={playing} data-reduced={reduced}>
      <div className={styles.storyTop}><span>UN PARCOURS, CINQ ÉTAPES</span><MotionControl className={styles.motionControl} /></div>
      <div className={styles.tabs} role="tablist" aria-label="Les étapes de votre projet">
        {STEPS.map((item, index) => <button
          type="button"
          role="tab"
          key={item.label}
          id={`${id}-tab-${index}`}
          aria-selected={step === index}
          aria-controls={`${id}-panel-${index}`}
          tabIndex={step === index ? 0 : -1}
          ref={(element) => { tabs.current[index] = element; }}
          onClick={() => select(index)}
          onKeyDown={(event) => navigate(event, index)}
          className={styles.tab}
        ><span className={styles.tabNumber}>0{index + 1}</span><span>{item.label}</span><i key={step === index ? "active" : "inactive"} /></button>)}
      </div>

      {STEPS.map((item, index) => {
        const Illustration = ILLUSTRATIONS[index];
        return <div key={item.label} className={styles.panel} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={step !== index} tabIndex={0}>
          <div className={styles.visual} aria-hidden="true"><div className={styles.visualGrid} /><Illustration /><span className={styles.visualCaption}>Illustration du parcours</span><span className={styles.visualIndex}>0{index + 1}<i>/ 05</i></span></div>
          <div className={styles.copy}>
            <p className={styles.chapter}>{item.eyebrow}</p>
            <h3>{item.title}</h3>
            <p className={styles.body}>{item.body}</p>
            <p className={styles.detail}><span /><span>{item.detail}</span></p>
            <Link className={styles.contactLink} href="/?besoin=etre-conseille#contact">Parlons de mon projet <Arrow diagonal /></Link>
          </div>
        </div>;
      })}
      <div className={styles.storyBottom}><span>Votre besoin donne le rythme.</span><span>Le périmètre et la date sont convenus avec vous.</span></div>
    </div>

    <div className={styles.hardware} id="materiel" aria-labelledby={`${id}-hardware`}>
      <div className={styles.hardwareHeading}><span className={styles.eyebrow}>ET CÔTÉ MATÉRIEL ?</span><h3 id={`${id}-hardware`}>Partons de ce<br />que vous avez déjà.</h3></div>
      <div className={styles.hardwarePath}><span className={styles.pathIcon}><Mark type="screen" /></span><h4>Votre équipement actuel</h4><p>Tablette, imprimante, écran cuisine : nous vérifions la compatibilité avant la configuration. Aucun achat imposé si votre équipement convient.</p><span className={styles.hardwareNote}>Prestations éventuelles précisées au devis.</span></div>
      <div className={styles.hardwarePath}><span className={styles.pathIcon}><Mark type="service" /></span><h4>Installation sur place</h4><p className={styles.installPrice}>{aPartirDe(INSTALL_FROM_CENTS)} <span>HT</span></p><p>Matériel acheté séparément. Déplacement, configuration et périmètre détaillés au devis.</p><span className={styles.hardwareNote}>Date de mise en service convenue ensemble.</span></div>
    </div>

    <div className={styles.pilot} id="histoire">
      <div className={styles.pilotMark} aria-hidden="true"><span>C<span>’</span>F</span><i /></div>
      <div className={styles.pilotCopy}><p>Un projet né du terrain.</p><span><strong>Class’Food, à Perriers-sur-Andelle,</strong> est notre restaurant pilote. Découvrez les applications avec des données d’exemple.</span></div>
      <Link className={styles.demoLink} href={DEMO_PATHS.order}>Ouvrir l’application démo <Arrow diagonal /></Link>
    </div>
  </section>;
}
