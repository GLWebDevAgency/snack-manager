"use client";

import type { CSSProperties } from "react";
import { LogoMark } from "../../brand/Logo";
import { DEMO_APPS } from "../content";
import { Photo } from "../Photo";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./intro.module.css";

const HERO_APPS = [DEMO_APPS[0], DEMO_APPS[1], DEMO_APPS[3]];
const HERO_LABELS = ["La caisse", "La cuisine", "La vue d’ensemble"];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The screenshots are real product captures; the composition is editorial. */
export function LandingIntro() {
  const { ref, step, select, playing, reduced } = useSceneMotion({ count: HERO_APPS.length, intervalMs: 6500 });

  return (
    <section id="hero" className={styles.hero} aria-labelledby="landing-title">
      <div ref={ref} className={styles.frame} data-playing={playing} data-reduced={reduced}>
        <div className={styles.grain} aria-hidden="true" />
        <div className={styles.topNotch} aria-hidden="true"><span /> Logiciels & accompagnement</div>

        <div className={styles.intro}>
          <p className={styles.eyebrow}><span /> Pour les restaurateurs indépendants</p>
          <h1 id="landing-title" className={styles.title}>
            <span>Gérez votre restaurant.</span>
            <span>Faites vivre votre carte.</span>
          </h1>
          <p className={styles.description}>
            Des outils pour votre service. Un Atelier pour vos menus papier et TV.
            Un accompagnement adapté à votre façon de travailler.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="#produit">Voir les applications <Arrow diagonal /></a>
            <a className={styles.secondary} href="#contact">Parlons de mon restaurant <Arrow /></a>
          </div>
        </div>

        <div className={styles.cinema}>
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.rearCard} aria-hidden="true">
            <span className={styles.rearLabel}><LogoMark size={18} /> Votre carte, vos écrans</span>
            <Photo shot={DEMO_APPS[5].shot} decorative />
          </div>
          <div className={styles.monitor}>
            <div className={styles.monitorBar}>
              <span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span>
              <span>Snack Manager <span className={styles.barDivider}>/</span> {HERO_LABELS[step]}</span>
              <LogoMark size={18} />
            </div>
            <div className={styles.screen}>
              {HERO_APPS.map((app, index) => (
                <div className={styles.slide} key={app.id} data-active={step === index} aria-hidden={step !== index}>
                  <Photo shot={app.shot} eager={index === 0} sizes="(max-width: 700px) 95vw, 900px" />
                </div>
              ))}
            </div>
          </div>
          <div className={styles.phone}>
            <span className={styles.phoneNotch} aria-hidden="true" />
            <Photo shot={DEMO_APPS[2].shot} sizes="(max-width: 700px) 110px, 190px" />
            <span className={styles.phoneLabel}>Côté client</span>
          </div>
          <div className={styles.caption}>
            <span className={styles.captionIcon}><LogoMark size={25} /></span>
            <span><strong>À chacun son écran.</strong><span>À vous, la vue d’ensemble.</span></span>
          </div>
        </div>

        <div className={styles.heroFooter}>
          <div className={styles.scenePicker} role="group" aria-label="Choisir un aperçu de l’application">
            {HERO_LABELS.map((label, index) => (
              <button type="button" key={label} aria-pressed={step === index} onClick={() => select(index)}>
                <span className={styles.pickerDot} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <div className={styles.captureNote}><span>Captures des applications · données de démonstration</span><MotionControl className={styles.motionControl} /></div>
        </div>
      </div>
    </section>
  );
}

function ServiceIllustration() {
  return (
    <div className={styles.serviceMock}>
      <div className={styles.mockHeading}><LogoMark size={21} /><span>Le service avance</span><span className={styles.mockStatus} /></div>
      <div className={styles.serviceRows}>
        {["Commande reçue", "En préparation", "Prête au retrait"].map((label, index) => (
          <div className={styles.serviceRow} key={label} style={{ "--row": index } as CSSProperties}>
            <span className={styles.rowIcon}>{index === 2 ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <span>{label}</span><span className={styles.rowTrack}><i /></span>
          </div>
        ))}
      </div>
      <div className={styles.mockBottom}><span>Caisse</span><i /><span>Cuisine</span><i /><span>Gérant</span></div>
    </div>
  );
}

function MenuIllustration() {
  return (
    <div className={styles.menuMock}>
      <div className={styles.paperMock}>
        <span className={styles.paperTop}>LA CARTE</span>
        <span className={styles.paperRule} />
        <span className={styles.paperName}>Les spécialités</span>
        <span className={styles.paperLine} /><span className={styles.paperLine} /><span className={styles.paperLine} />
        <span className={styles.paperName}>À partager</span>
        <span className={styles.paperLine} /><span className={styles.paperLine} />
        <span className={styles.paperStamp}>Votre restaurant</span>
      </div>
      <div className={styles.tvMock}>
        <span className={styles.tvTop}>À LA CARTE <span>SM</span></span>
        <span className={styles.tvPlate}><i /><i /><i /></span>
        <span className={styles.tvCopy}>Votre spécialité.<br /><em>Au premier plan.</em></span>
        <span className={styles.tvUnderline} />
      </div>
      <span className={styles.formatLabel}>Papier <span>↔</span> Écrans TV</span>
    </div>
  );
}

function DirectIllustration() {
  return (
    <div className={styles.directMock}>
      <div className={styles.directPhone}>
        <span className={styles.miniNotch} />
        <span className={styles.directBrand}><LogoMark size={22} /><span>Votre restaurant</span></span>
        <span className={styles.directMeal}><span /><i /><i /></span>
        <span className={styles.directLine} /><span className={styles.directLine} />
        <span className={styles.directCta}>Ma commande <Arrow /></span>
      </div>
      <span className={styles.directOrbit} />
      <span className={styles.directBubble}>Votre carte.<br /><strong>Votre relation client.</strong></span>
    </div>
  );
}

const NEEDS = [
  { label: "Le service", title: "Mieux organiser mon service.", description: "De la prise de commande à la cuisine, donnez à chaque équipe les outils adaptés.", href: "#service", cta: "Voir le parcours", illustration: ServiceIllustration },
  { label: "La carte", title: "Faire évoluer mes menus.", description: "Une carte plus lisible, des présentations TV à votre image et des retouches quand il le faut.", href: "#menus", cta: "Découvrir l’Atelier menus", illustration: MenuIllustration },
  { label: "La commande directe", title: "Recevoir mes commandes en direct.", description: "Proposez à vos clients de commander auprès de votre restaurant, avec ou sans notre caisse.", href: "#applications-seules", cta: "Voir les solutions", illustration: DirectIllustration },
] as const;

export function NeedsNavigation() {
  const { ref, step, playing, reduced } = useSceneMotion({ count: NEEDS.length, intervalMs: 5000 });

  return (
    <section id="votre-service" className={styles.needs} aria-labelledby="needs-title">
      <div className={styles.sectionHeading}>
        <p className={styles.sectionLabel}><span>01 /</span> Votre point de départ</p>
        <h2 id="needs-title">Qu’est-ce qui compte<br /><span>pour vous, aujourd’hui ?</span></h2>
        <p>Commencez par votre besoin. Nous composons la suite avec vous.</p>
      </div>
      <div ref={ref} className={styles.needsGrid} data-playing={playing} data-reduced={reduced}>
        {NEEDS.map(({ label, title, description, href, cta, illustration: Illustration }, index) => (
          <a href={href} key={href} className={styles.needCard} data-active={step === index}>
            <div className={styles.needVisual}>
              <span className={styles.needNotch}><span>{String(index + 1).padStart(2, "0")}</span>{label}</span>
              <div className={styles.illustration} aria-hidden="true"><Illustration /></div>
              <span className={styles.illustrationNote}>Illustration</span>
            </div>
            <div className={styles.needCopy}><h3>{title}</h3><p>{description}</p><span className={styles.needLink}>{cta}<Arrow diagonal /></span></div>
          </a>
        ))}
      </div>
    </section>
  );
}
