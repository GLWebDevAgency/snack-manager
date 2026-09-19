"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { MENUS_OFFERS, MENU_PRINT_NOTE } from "../menu-offers";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./menus.module.css";

const MODES = [
  { id: "papier", label: "Papier", need: "menu-papier", detail: "Trois volets. Une carte qui se lit d’un regard.", scope: "Un gabarit adapté · jusqu’à 40 références · 2 séries de corrections" },
  { id: "tv", label: "TV", need: "menu-tv", detail: "Deux compositions. Une présence à l’écran.", scope: "Bibliothèque existante · une orientation · jusqu’à 40 références · 2 séries de corrections" },
  { id: "ensemble", label: "Ensemble", need: "carte-tv", detail: "Papier et TV. Une même identité.", scope: "Le trois-volets + 2 compositions TV + un diagnostic et 3 actions proposées" },
] as const;

/** Illustrations of delivered supports, deliberately not a mock software editor. */
function FoldedMenu() {
  return <div className={styles.paperRig} aria-hidden="true">
    <div className={styles.paper}>
      <div className={`${styles.leaf} ${styles.leftLeaf}`}>
        <div className={styles.coverMark}>LA<br />CARTE<span>À VOTRE IMAGE.</span></div>
        <span className={styles.coverRule} />
        <p>Le goût des<br /><em>bonnes choses.</em></p>
        <span className={styles.paperFoot}>À partager. À savourer.</span>
      </div>
      <div className={`${styles.leaf} ${styles.middleLeaf}`}>
        <span className={styles.paperKicker}>LE PLAISIR DE CHOISIR</span>
        <h3>Nos<br /><em>classiques.</em></h3>
        <div className={styles.menuLine}><strong>Le burger signature</strong><span>Une recette généreuse.</span></div>
        <div className={styles.menuLine}><strong>La salade César</strong><span>Fraîcheur et gourmandise.</span></div>
        <div className={styles.menuLine}><strong>Le plat du moment</strong><span>Selon l’inspiration du chef.</span></div>
        <div className={styles.paperSeal}>LA CARTE<br /><b>DE VOTRE<br />RESTAURANT</b></div>
      </div>
      <div className={`${styles.leaf} ${styles.rightLeaf}`}>
        <span className={styles.paperKicker}>L’ENVIE DU MOMENT</span>
        <h3>Simplement<br /><em>généreux.</em></h3>
        <div className={styles.paperFood}><Image src="/photos/smash-burger.webp" alt="" width={335} height={298} sizes="(max-width: 600px) 130px, 230px" /></div>
        <p>Une belle recette.<br />Une place de choix.</p>
        <span className={styles.paperFoot}>Sur place · à emporter</span>
      </div>
    </div>
  </div>;
}

function TelevisionMenu() {
  return <div className={styles.tvRig} aria-hidden="true">
    <div className={styles.television}>
      <div className={styles.tvScreen}>
        <div className={`${styles.tvSlide} ${styles.tvSlideOne}`}>
          <div className={styles.tvCopy}><span>LA CARTE / VOTRE RESTAURANT</span><strong>L’envie<br />du <em>moment.</em></strong><p>Le burger signature</p><b>À savourer, tout simplement.</b></div>
          <div className={styles.tvHalo} />
          <Image className={styles.tvFood} src="/photos/smash-burger.webp" alt="" width={335} height={298} sizes="(max-width: 600px) 220px, 400px" />
          <span className={styles.compositionNumber}>01 / 02</span>
        </div>
        <div className={`${styles.tvSlide} ${styles.tvSlideTwo}`}>
          <div className={styles.tvCopy}><span>LA CARTE / VOTRE RESTAURANT</span><strong>Une pause<br /><em>fraîche.</em></strong><p>La salade César</p><b>Une autre envie, la même identité.</b></div>
          <div className={styles.tvHalo} />
          <Image className={styles.tvFood} src="/photos/salade-cesar.webp" alt="" width={640} height={640} sizes="(max-width: 600px) 220px, 400px" />
          <span className={styles.compositionNumber}>02 / 02</span>
        </div>
        <div className={styles.tvFooter}><span>À VOTRE IMAGE.</span><span>SUR PLACE · À EMPORTER</span></div>
      </div>
      <span className={styles.tvStatus} />
    </div>
    <div className={styles.tvStand} />
  </div>;
}

export function MenuExperience() {
  const { ref, playing } = useSceneMotion({ count: 1 });
  const [mode, setMode] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft") next = (index + MODES.length - 1) % MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    setMode(next);
    tabs.current[next]?.focus();
  }

  return <section id="menus" className={styles.section} aria-labelledby="menus-heading">
    <div className={styles.heading}>
      <p className={styles.eyebrow}><span /> MENUS PAPIER & TV</p>
      <div className={styles.headingGrid}><h2 id="menus-heading">Votre cuisine a du caractère.<br /><em>Votre carte aussi.</em></h2><p>Une carte plus lisible, une identité cohérente, des produits mieux présentés. Nous créons vos supports avec vous, au rythme de votre restaurant.</p></div>
    </div>

    <div className={styles.experience} ref={ref} data-playing={playing} data-mode={MODES[mode].id}>
      <div className={styles.stageTop}>
        <div className={styles.tabs} role="tablist" aria-label="Explorer les supports de menu">
          {MODES.map((item, index) => <button key={item.id} id={`menu-tab-${item.id}`} ref={(element) => { tabs.current[index] = element; }} type="button" role="tab" aria-selected={mode === index} aria-controls="menu-support-preview" tabIndex={mode === index ? 0 : -1} onClick={() => setMode(index)} onKeyDown={(event) => navigateTabs(event, index)}><span className={styles.tabNumber}>0{index + 1}</span>{item.label}</button>)}
        </div>
        <span className={styles.stageLabel}>PENSÉ POUR VOTRE CARTE</span>
      </div>
      <div className={styles.stage} id="menu-support-preview" role="tabpanel" tabIndex={0} aria-labelledby={`menu-tab-${MODES[mode].id}`}>
        <span className={styles.stageWord} aria-hidden="true">À LA CARTE.</span>
        <FoldedMenu />
        <TelevisionMenu />
        <div className={styles.supportTag} aria-hidden="true"><span />{mode === 0 ? "TROIS VOLETS / SIX FACES" : mode === 1 ? "DEUX COMPOSITIONS / UNE IDENTITÉ" : "DEUX SUPPORTS / UNE MÊME CARTE"}</div>
        <p className={styles.previewDescription}>{MODES[mode].detail}</p>
      </div>
      <div className={styles.stageBottom}><p>Exemples de présentation. Votre création est adaptée à votre identité.</p><MotionControl className={styles.motionControl} /></div>
    </div>

    <div className={styles.offerLedger} aria-label="Prestations de création de menus">
      {MODES.map((item, index) => {
        const offer = MENUS_OFFERS.find((entry) => entry.id === item.id)!;
        return <article className={styles.offer} key={item.id}>
          <span className={styles.offerIndex}>0{index + 1} / {item.label.toUpperCase()}</span>
          <h3>{offer.title}</h3>
          <p className={styles.price}>{offer.priceCents / 100}<span> € HT<br /><small>prestation ponctuelle</small></span></p>
          <p className={styles.scope}>{item.scope}.</p>
          <Link className={styles.offerLink} href={`/?besoin=${item.need}#contact`}>{offer.cta}<span aria-hidden="true">↗</span></Link>
        </article>;
      })}
    </div>
    <div className={styles.conditions}>
      <p><strong>Un périmètre clair, avant de commencer.</strong> Textes, prix, catalogue et identité fournis. Devis validé avant création. {MENU_PRINT_NOTE}</p>
      <p>Les fonctions TV existantes sont incluses dans Service, Gestion et Boost. La mise en scène par notre équipe est une prestation distincte ; diffusion avec une suite Snack Manager, matériel et installation en supplément. <Link href="/atelier#menus-atelier">Voir les inclusions et les limites <span aria-hidden="true">↗</span></Link></p>
    </div>
    <div className={styles.future}><span>EN PRÉPARATION</span><p>Le futur Studio pour composer vous-même vos menus papier et TV.</p><Link href="/offres#studio-a-venir">Découvrir le projet <span aria-hidden="true">↗</span></Link></div>
  </section>;
}
