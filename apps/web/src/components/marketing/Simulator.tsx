"use client";

import { useMemo, useState } from "react";
import { CTA_CALLBACK, NARROW_NBSP, NBSP, SIM_CTA_NOTE, SIM_ESC, SIM_LEAD, SIM_NOTES, ancre, section } from "./content";

/* ── Hypothèses (identiques à la maquette, § « sim ») ───────────────── */
const HOURLY = 13; // coût horaire chargé, €/h
const DAYS = 30.4; // jours par mois
const WEEKS = 4.33; // semaines par mois
const FULLTIME = 151.67; // heures d'un temps plein mensuel

/*
 * Formatage maison plutôt que `toLocaleString` : le séparateur de milliers de
 * l'ICU français a changé d'espace selon les versions, et un écart entre le
 * rendu serveur et le rendu navigateur casserait l'hydratation.
 */
/*
 * LES DEUX ESPACES VIENNENT DE `content.ts`, ET C'EST LE CORRECTIF LUI-MÊME.
 *
 * Ce fichier redéclarait la paire sous les mêmes noms, avec deux espaces
 * ORDINAIRES dedans. À l'œil, une insécable et une espace normale sont le même
 * caractère : la faute était invisible au diff comme à la relecture, et TOUS
 * les montants du simulateur sortaient sécables — « ≈ 5,75 € », « 505 € »,
 * « 6 065 € », « 13 €/h », « 35 h » — pendant que la grille de prix, elle,
 * composait juste. Deux déclarations du même caractère invisible, c'est deux
 * déclarations qui finissent par diverger sans que personne le voie.
 *
 * On les importe donc au lieu de les réécrire. Le formatage, lui, reste local
 * pour la raison ci-dessus : le simulateur compte en euros et non en centimes,
 * `euros()` ne lui conviendrait pas.
 */

function group(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
}
function euro(n: number): string {
  return `${group(n)}${NBSP}€`;
}
function decimalEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}${NBSP}€`;
}

type Field = { id: string; label: string; hint?: string; min: number; max: number; step: number };

const FIELDS: Field[] = [
  { id: "cmd", label: "Commandes par jour", min: 20, max: 300, step: 5 },
  { id: "panier", label: "Panier moyen", min: 6, max: 25, step: 0.5 },
  {
    id: "err",
    label: "Commandes refaites par semaine",
    hint: "écriture mal relue, oublis, erreurs de prix",
    min: 0,
    max: 30,
    step: 1,
  },
  {
    id: "mins",
    label: "Minutes perdues par service en coordination",
    hint: "totaux calculés de tête, déchiffrage, re-annonces en cuisine",
    min: 0,
    max: 60,
    step: 5,
  },
  {
    id: "tel",
    label: "Commandes par téléphone par jour",
    hint: "décrochés en plein rush — en caisse, ou par quelqu'un qui quitte son poste",
    min: 0,
    max: 40,
    step: 1,
  },
];

/**
 * Le calcul — cinq curseurs, un panneau de résultats recalculé à chaque
 * `input`. Les formules sont reprises telles quelles du script de la maquette :
 * on ne « corrige » pas les hypothèses du fondateur, on les rend consultables
 * dans le dépliable de pied de section — disponibles, jamais annoncées.
 *
 * LA SECTION A CHANGÉ DE MÉTIER SANS CHANGER D'UNE FORMULE. Elle passait avant
 * les tarifs : cinq curseurs à bouger au pouce entre deux services, juste avant
 * la seule chose que le visiteur cherche, c'est un péage — il défile, il rate
 * les hypothèses et il arrive au prix de mauvaise humeur. Posée APRÈS le prix,
 * elle répond à l'objection qui naît exactement là : « d'accord pour ce
 * tarif-là, et ce que je paie déjà, c'est combien ? » — le titre de la section
 * (`SECTIONS`, content.ts) cite le montant, et il le DÉRIVE de la grille
 * plutôt que de le recopier, ce commentaire compris. Le seul chiffre de
 * résultat de toute la page est celui que le visiteur fabrique lui-même — il
 * ne peut pas être notre mensonge.
 */
export function Simulator() {
  const { badge, title } = section("simulateur");

  const [cmd, setCmd] = useState(80);
  const [panier, setPanier] = useState(11.5);
  const [err, setErr] = useState(6);
  const [mins, setMins] = useState(20);
  const [tel, setTel] = useState(12);

  const r = useMemo(() => {
    const phone = Math.min(tel, cmd);

    // Erreurs évitées : −35 % des commandes refaites, valorisées à 50 % du panier.
    const errSave = err * WEEKS * panier * 0.5 * 0.35;
    // Coordination : minutes perdues × 2 services, converties en heures puis en euros.
    const coordHours = (mins * 2 * DAYS) / 60;
    const coordSave = coordHours * HOURLY;
    // Téléphone : 60 % des appels migrent en ligne, 4 min économisées par appel.
    const phoneMigrated = phone * 0.6;
    const phoneHours = (phoneMigrated * 4 * DAYS) / 60;
    const phoneSave = phoneHours * HOURLY;
    /*
     * LE CA ADDITIONNEL A ÉTÉ RETIRÉ DU CALCUL, ET C'EST DÉLIBÉRÉ.
     *
     * Une ligne « panier en ligne +15 % » pesait ici 61 % du chiffre annuel
     * affiché — et la page avouait elle-même, sous les curseurs, ne tenir ce
     * taux d'aucune étude qu'elle puisse nommer. Les seules sources qui
     * l'annoncent (15 à 30 %) sont des éditeurs qui vendent la même chose que
     * nous : citer un vendeur pour appuyer une vente ne prouve rien.
     *
     * Tout ce qui reste se déduit des chiffres que le restaurateur a saisis
     * lui-même. Un montant plus petit qu'il peut refaire de tête vaut mieux
     * qu'un montant deux fois plus gros qu'il peut contester d'une question.
     * Le taux survit en NOTE sous le résultat, jamais dans le total.
     */
    const monthly = errSave + coordSave + phoneSave;
    const hours = coordHours + phoneHours;

    return {
      monthly,
      yearly: monthly * 12,
      errSave,
      coordSave,
      phoneSave,
      hours,
      fulltime: Math.round((hours / FULLTIME) * 100),
    };
  }, [cmd, panier, err, mins, tel]);

  const value: Record<string, number> = { cmd, panier, err, mins, tel };
  const setter: Record<string, (n: number) => void> = {
    cmd: setCmd,
    panier: setPanier,
    err: setErr,
    mins: setMins,
    tel: setTel,
  };
  const display: Record<string, string> = {
    cmd: String(cmd),
    panier: decimalEuro(panier),
    err: String(err),
    mins: `${mins} min`,
    tel: String(Math.min(tel, cmd)),
  };

  return (
    <section className="section sim-section" id="simulateur">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>
        {title}
      </h2>

      {/*
       * Ce qui reste d'Intro : la phrase la plus forte de la page était posée
       * seule sur un filigrane géant « ×2 », sans une preuve à portée de regard.
       * Elle devient l'affirmation immédiatement suivie du calcul qui la produit.
       */}
      <div className="sim-lead rv">
        <p className="sim-leadtitle">{SIM_LEAD.title}</p>
        <p className="sim-leadline">{SIM_LEAD.line}</p>
      </div>

      {/* L'amorce, ramenée de soixante mots à une ligne + deux cases de chiffres. */}
      <div className="sim-escbox rv">
        <p className="sim-escline">{SIM_ESC.line}</p>
        <div className="sim-figs">
          {SIM_ESC.figures.map((f) => (
            <div className="sim-fig" key={f.fig}>
              <p className="sim-fignum">{f.fig}</p>
              <p className="sim-figlabel">{f.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="sim-board rv">
        <div className="sim-controls spot">
          {FIELDS.map((f) => (
            <div className="sim-ctl" key={f.id}>
              <div className="sim-ctlhead">
                <label htmlFor={`s-${f.id}`}>
                  {f.label}
                  {f.hint ? <span className="sim-hint">{f.hint}</span> : null}
                </label>
                <output htmlFor={`s-${f.id}`}>{display[f.id]}</output>
              </div>
              <input
                type="range"
                id={`s-${f.id}`}
                min={f.min}
                max={f.max}
                step={f.step}
                value={value[f.id]}
                onChange={(e) => setter[f.id](Number(e.target.value))}
              />
            </div>
          ))}
        </div>

        <div className="sim-results spot">
          <p className="sim-reslabel">Récupérable chaque mois</p>
          <p className="sim-resbig" aria-live="polite">
            {euro(r.monthly)}
          </p>
          <p className="sim-resyear">
            soit <b>{euro(r.yearly)}</b> par an, uniquement à partir de vos chiffres
          </p>
          <div className="sim-resrows">
            <div className="sim-resrow">
              <span>Erreurs évitées (−35 %)</span>
              <b>{euro(r.errSave)}</b>
            </div>
            <div className="sim-resrow">
              <span>Totaux, déchiffrage &amp; re-annonces supprimés</span>
              <b>{euro(r.coordSave)}</b>
            </div>
            <div className="sim-resrow">
              <span>Téléphone déchargé — appels + interruptions de poste</span>
              <b>{euro(r.phoneSave)}</b>
            </div>
            <div className="sim-resrow">
              <span>Heures d&apos;équipe libérées</span>
              <b>
                {group(r.hours)}
                {NBSP}h
              </b>
            </div>
          </div>
          <p className="sim-equiv">
            ≈ {r.fulltime} % d&apos;un temps plein récupéré — hors gain des erreurs évitées.
          </p>
          {/* `ancre()` et pas `#contact` : voir le hero. */}
          <a className="btn light sim-cta" href={ancre("contact").href}>
            {CTA_CALLBACK}
          </a>
          {/* La couture : ce chiffre-là ne meurt pas au défilement, il part avec nous. */}
          <p className="sim-ctanote">{SIM_CTA_NOTE}</p>
        </div>
      </div>

      {/*
       * LA MÉTHODE EST DISPONIBLE. ELLE N'EST PAS ANNONCÉE.
       *
       * Il y avait ici un bloc ouvert qui titrait « le seul chiffre que nous
       * n'avons pas mesuré nous-mêmes », affichait sa source, puis expliquait ce
       * qu'on avait refusé de compter. Chaque phrase était exacte et l'ensemble
       * sonnait faux : une page qui devance une objection que personne n'a
       * formulée s'accuse toute seule. Le lecteur n'y lit pas de la rigueur, il
       * y lit un doute.
       *
       * Le dépliable dit la même chose sans la crier. Qui veut savoir d'où
       * sortent les taux ouvre et trouve tout, source et année comprises ; les
       * autres voient un montant qui s'assume. `details` reste ouvrable sans
       * JavaScript.
       */}
      <details className="sim-fold rv">
        <summary className="sim-foldsum">Nos hypothèses</summary>
        <p className="sim-foldtext">{SIM_NOTES}</p>
      </details>
    </section>
  );
}
