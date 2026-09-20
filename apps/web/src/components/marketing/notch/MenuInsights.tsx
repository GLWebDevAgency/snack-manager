"use client";

import Image from "next/image";
import Link from "next/link";
import { MENUS_OFFERS } from "../menu-offers";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./insights.module.css";

const STEPS = [
  { title: "Lire vos ventes", text: "Repérer les produits commandés, les formules et les moments de service." },
  { title: "Choisir avec vous", text: "Croiser la demande, les coûts disponibles et les contraintes en cuisine." },
  { title: "Soigner la présentation", text: "Proposer une place et une composition adaptées à votre carte." },
] as const;

const PRODUCTS = [
  { name: "Burger signature", quantity: 84, width: "84%" },
  { name: "Salade César", quantity: 62, width: "62%" },
  { name: "Plat du moment", quantity: 28, width: "28%" },
] as const;

export function MenuInsights() {
  const { ref, step, select, playing } = useSceneMotion({ count: STEPS.length, intervalMs: 6500 });
  const analysis = MENUS_OFFERS.find((offer) => offer.id === "analyse")!;

  return <section className={styles.section} id="carte-et-ventes" aria-labelledby="insights-heading">
    <div className={styles.intro}>
      <p className={styles.eyebrow}><span /> LA CARTE, ÉCLAIRÉE PAR VOS VENTES</p>
      <h2 id="insights-heading">Vos ventes éclairent.<br /><em>Vous décidez.</em></h2>
      <p className={styles.lead}>Un beau menu attire l’attention. Une carte bien pensée tient aussi compte de ce que vos clients commandent et de ce que votre cuisine peut servir.</p>
    </div>

    <div className={styles.experience} ref={ref} data-playing={playing} data-step={step}>
      <div className={styles.sceneTop}><span>DE LA LECTURE À LA MISE EN AVANT</span><span className={styles.demoLabel}>CHIFFRES ET COMPOSITION ILLUSTRATIFS</span></div>
      <div className={styles.scene}>
        <div className={styles.reading}>
          <div className={styles.readingHeading}><span>01 / OBSERVER</span><h3>Ce que vos clients<br />commandent.</h3></div>
          <div className={styles.chart} role="img" aria-label="Exemple fictif : 84 burgers signature, 62 salades César et 28 plats du moment commandés. Ces quantités ne sont pas des données clients réelles.">
            <div className={styles.chartHeading} aria-hidden="true"><span>PRODUITS</span><span>QUANTITÉS</span></div>
            {PRODUCTS.map((product, index) => <div key={product.name} className={styles.product} data-selected={index === 1 && step >= 1} aria-hidden="true">
              <div className={styles.productLine}><span><i>0{index + 1}</i>{product.name}</span><strong>{product.quantity}</strong></div>
              <div className={styles.barTrack}><span style={{ width: product.width }} /></div>
              {index === 1 && <span className={styles.selectedLabel}>Une piste à examiner ensemble</span>}
            </div>)}
          </div>
          <p className={styles.readingNote}>La popularité d’un plat ne suffit pas à connaître sa rentabilité.</p>
        </div>

        <div className={styles.connection} aria-hidden="true"><span className={styles.connectionLine} /><span className={styles.connectionNode}>↗</span><span className={styles.connectionLine} /><span className={styles.connectionCaption}>VOTRE<br />CHOIX</span></div>

        <div className={styles.composition} role="img" aria-label="Exemple de mise en avant d’une salade César sur une carte, soumis à la validation du restaurateur.">
          <div className={styles.poster} aria-hidden="true">
            <div className={styles.posterTop}><span>VOTRE CARTE</span><span>02 / PRÉSENTER</span></div>
            <h3>Une place<br />pour la <em>fraîcheur.</em></h3>
            <div className={styles.foodHalo} />
            <Image className={styles.food} src="/illustrations/food/bowl.svg" unoptimized alt="" width={240} height={165} sizes="(max-width: 700px) 300px, 450px" />
            <div className={styles.posterBottom}><strong>La salade César</strong><span>Votre recette. Votre identité.</span></div>
            <span className={styles.selectionStamp}>MISE EN AVANT<br /><b>À VALIDER<br />AVEC VOUS</b></span>
          </div>
          <p className={styles.posterCaption}>Une proposition graphique, après échange avec votre équipe.</p>
        </div>
      </div>

      <div className={styles.steps} role="group" aria-label="Étapes de l’analyse et de la création">
        {STEPS.map((item, index) => <button key={item.title} type="button" onClick={() => select(index)} aria-pressed={step === index} className={styles.step}><span className={styles.stepIndex}>0{index + 1}<span className={styles.stepProgress} /></span><span><strong>{item.title}</strong><span className={styles.stepText}>{item.text}</span></span></button>)}
      </div>
      <div className={styles.sceneBottom}><p>Exemple fictif, sans résultat commercial annoncé.</p><MotionControl className={styles.motionControl} /></div>
    </div>

    <div className={styles.service}>
      <div><span className={styles.serviceLabel}>UN REGARD HUMAIN SUR VOTRE CARTE</span><h3>Trois recommandations.<br />Des raisons claires.</h3></div>
      <div className={styles.serviceCopy}><p>Nous examinons vos données disponibles et vous proposons trois actions expliquées. Sans coûts exploitables, l’analyse porte sur les ventes et la présentation, pas sur la rentabilité.</p><p className={styles.boundary}>Restitution courte comprise · jusqu’à 2 h 30 de travail total · création graphique en supplément.</p></div>
      <div className={styles.serviceAction}><p>{analysis.priceCents / 100}<span> € HT<small>analyse ponctuelle</small></span></p><Link href="/atelier#menus-atelier">Découvrir l’analyse <span aria-hidden="true">↗</span></Link></div>
    </div>
  </section>;
}
