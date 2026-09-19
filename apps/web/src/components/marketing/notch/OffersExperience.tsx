"use client";

import { useState } from "react";
import { ATELIER_CENTS, BILLING_CYCLES, BILLING_YEARLY_NOTE, ENGAGEMENT, FOUNDER_POLICY, MODULE_MONTHLY_CENTS, MODULE_SETUP_CENTS, PLANS, PLAN_MONTHLY_CENTS, PLAN_MODULES, euros } from "../content";
import { COMMERCE_OFFERS, LOYALTY_PILOT_NOTE } from "../commerce-offers";
import { MotionControl, useSceneMotion } from "./Motion";
import styles from "./offers.module.css";

const BENEFITS = [
  { promise: "Organisez votre service.", includes: ["Caisse et écran cuisine", "Carte, prix et modèles TV", "Suivi des ventes et exports"], excludes: "Planning, stocks et commande en ligne à ajouter selon vos besoins.", need: "service" },
  { promise: "Gardez la vue d’ensemble.", includes: ["Tout Service", "Planning, pointage et coût de l’équipe", "Stocks et suivi du coût matière"], excludes: "Commande directe en option. Création graphique distincte.", need: "gestion" },
  { promise: "Réunissez gestion et commande.", includes: ["Tout Gestion", "Click & collect et mise en service standard", "Fidélité et livraison en pilote accompagné", "Support prioritaire"], excludes: "Vos livreurs, frais de paiement et créations graphiques restent distincts.", need: "boost" },
] as const;

export function OffersExperience() {
  const [yearly, setYearly] = useState(false);
  const { ref, step, playing } = useSceneMotion({ count: 3, intervalMs: 3800 });
  const total = PLAN_MONTHLY_CENTS.complet + MODULE_MONTHLY_CENTS;
  const saving = total - PLAN_MONTHLY_CENTS.boost;
  return <section id="tarifs" className={styles.section} aria-labelledby="nl-offers-title">
    <div className={styles.heading}>
      <span className={styles.eyebrow}>05 / Votre offre</span>
      <h2 id="nl-offers-title">Le bon outil.<br /><span>Au bon moment.</span></h2>
      <p>Commencez avec ce qui vous est utile. Ajoutez les outils qui accompagnent l’évolution de votre restaurant.</p>
    </div>
    <div className={styles.billing}>
      <fieldset className={styles.switch}>
        <legend className={styles.srOnly}>Périodicité de facturation</legend>
        <label data-selected={!yearly}><input type="radio" name="nl-billing" checked={!yearly} onChange={() => setYearly(false)} />Par mois</label>
        <label data-selected={yearly}><input type="radio" name="nl-billing" checked={yearly} onChange={() => setYearly(true)} />Par an <span>{BILLING_CYCLES[1].hint}</span></label>
      </fieldset>
      <p>{yearly ? `${BILLING_YEARLY_NOTE} Prix HT par établissement.` : "Au mois, résiliable à tout moment. Prix HT par établissement."}</p>
    </div>
    <div className={styles.plans}>
      {PLANS.map((plan, i) => <article key={plan.id} className={`${styles.plan} ${plan.id === "boost" ? styles.boost : ""}`}>
        <span className={styles.notch}>{plan.id === "boost" ? "Gestion + commande directe" : i === 0 ? "Le service" : "Le pilotage"}</span>
        <div className={styles.planHeading}><h3>{plan.name}</h3><span aria-hidden="true">0{i + 1}</span></div>
        <p className={styles.promise}>{BENEFITS[i].promise}</p>
        <p className={styles.price}><strong>{euros(yearly ? plan.yearlyCents : plan.monthlyCents)}</strong><span>HT / {yearly ? "an" : "mois"}</span></p>
        {yearly ? <p className={styles.equivalent}>Soit {euros(Math.round(plan.yearlyCents / 12))} HT/mois, payé en une fois.</p> : <p className={styles.equivalent}>Par établissement</p>}
        <ul>{BENEFITS[i].includes.map((benefit) => <li key={benefit}><span aria-hidden="true">✓</span>{benefit}</li>)}</ul>
        <p className={styles.excludes}>{BENEFITS[i].excludes}</p>
        <a className={styles.choose} href={`/?besoin=${BENEFITS[i].need}#contact`}>Parlons de {plan.name}<span aria-hidden="true">↗</span></a>
      </article>)}
    </div>
    <p className={styles.common}><span aria-hidden="true">◉</span> Les modèles TV existants sont inclus dans les trois offres. La création par l’Atelier et le futur Studio papier sont distincts.</p>

    <details className={styles.compare}>
      <summary>Comparer tout ce qui est inclus<span aria-hidden="true">+</span></summary>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Tableau comparatif des offres">
        <table><caption className={styles.srOnly}>Fonctionnalités de Service, Gestion et Boost</caption>
          <thead><tr><th scope="col">Fonctionnalités</th>{PLANS.map((plan) => <th scope="col" key={plan.id}>{plan.name}</th>)}</tr></thead>
          <tbody>{PLAN_MODULES.map((module) => <tr key={module.id}><th scope="row">{module.label}</th>{PLANS.map((plan) => <td key={plan.id} data-included={plan.modules.includes(module.id)}>{plan.modules.includes(module.id) ? "Inclus" : "Non inclus"}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <p>* La caisse conserve les commandes saisies localement. Leur transmission, les commandes en ligne et le paiement en ligne nécessitent une connexion. Impression selon le matériel et le réseau validés.</p>
      <p>{LOYALTY_PILOT_NOTE} La livraison nécessite la configuration et la validation du parcours avec vos propres livreurs.</p>
    </details>

    <div className={styles.math} ref={ref} data-playing={playing} data-step={step}>
      <div className={styles.mathIntro}><span className={styles.eyebrow}>Quand regrouper devient utile</span><h3>La gestion et la commande directe,<br />dans une même offre.</h3><p>Vous avez besoin des deux ? Le calcul vous aide à choisir.</p></div>
      <div className={styles.equation} aria-label={`Gestion ${euros(PLAN_MONTHLY_CENTS.complet)} et Click & collect ${euros(MODULE_MONTHLY_CENTS)} : ${euros(total)} par mois. Boost : ${euros(PLAN_MONTHLY_CENTS.boost)}. Écart : ${euros(saving)} par mois.`}>
        <div className={styles.sum}><span>Gestion<strong>{euros(PLAN_MONTHLY_CENTS.complet)}</strong></span><i aria-hidden="true">+</i><span>Click & collect<strong>{euros(MODULE_MONTHLY_CENTS)}</strong></span><i aria-hidden="true">=</i><span>Total<strong>{euros(total)}</strong></span></div>
        <div className={styles.result}><span>Réunis dans Boost<strong>{euros(PLAN_MONTHLY_CENTS.boost)}<small> HT / mois</small></strong></span><b>{euros(saving)}<small>de moins par mois</small></b></div>
      </div>
      <p className={styles.mathNote}>Tarifs mensuels standards, hors promotion. Mise en service standard de la commande : {euros(MODULE_SETUP_CENTS)} en module seul, comprise dans Boost. Matériel, paiement et interventions distincts.</p>
      <MotionControl className={styles.motion} />
    </div>

    <div id="applications-seules" className={styles.standalone}>
      <div><span className={styles.eyebrow}>Vous gardez votre caisse ?</span><h3>Choisissez votre application.</h3><p>Chaque module comprend le back-office nécessaire à son utilisation.</p></div>
      <div className={styles.modules}>{COMMERCE_OFFERS.map((offer) => <article key={offer.id}>
        <div><h4>{offer.title}</h4><p>{offer.id === "loyalty" ? "Pilote accompagné" : offer.id === "delivery" ? "Validation pilote avant activation" : "Fidélité en pilote incluse"}</p></div>
        <strong>{euros(offer.monthlyCents)}<small> HT / mois par établissement{offer.id === "delivery" ? " · tarif prévu" : ""}</small></strong>
        <a href={`/?besoin=${offer.id === "collect" ? "commande-directe" : offer.id === "loyalty" ? "fidelite" : "livraison"}#contact`}>Étudier mon besoin<span aria-hidden="true"> ↗</span></a>
      </article>)}</div>
      <p className={styles.fine}>Mise en service standard : {euros(MODULE_SETUP_CENTS)} une fois. Intégration sur un site existant : {euros(ATELIER_CENTS.integration)} HT en remplacement de la mise en service standard, selon devis. Livraison avec vos livreurs ; aucun livreur tiers fourni.</p>
      <p className={styles.fine}>{LOYALTY_PILOT_NOTE}</p>
    </div>
    <div className={styles.terms}><p><strong>0 % de commission Snack Manager sur les commandes.</strong> Les frais du prestataire de paiement, les coûts de livraison, le matériel et les prestations restent distincts.</p><p>{ENGAGEMENT}</p></div>
    <details className={styles.founder}><summary>Les conditions de l’offre fondateur<span aria-hidden="true">+</span></summary><p>{FOUNDER_POLICY}</p></details>
    <a className={styles.fullOffers} href="/offres">Voir les offres et leurs conditions<span aria-hidden="true"> ↗</span></a>
  </section>;
}
