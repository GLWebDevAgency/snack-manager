"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useRef, useState } from "react";
import {
  BILLING_CYCLES,
  BILLING_YEARLY_NOTE,
  COMMISSIONS,
  CTA_CALLBACK,
  ENGAGEMENT,
  FOUNDER_POLICY,
  MODULE_ADDON,
  PLANS,
  PLAN_MODULES,
  PRICING_FOOTNOTE,
  PRICING_MATH,
  PRICING_PERIMETER,
  ancre,
  euros,
  section,
  type BillingCycleId,
  type Plan,
  type PricingMath,
} from "./content";

/**
 * LE RANG D'UN ÉLÉMENT DANS LA SÉQUENCE, ET RIEN D'AUTRE.
 *
 * `--i` ne porte pas un retard, il porte une POSITION : c'est le CSS qui en
 * tire le retard (`--t0 + --i × --dt`, bloc « Tarifs » de marketing.css). Un
 * retard calculé ici en millisecondes obligerait à rouvrir ce fichier pour
 * changer le rythme, et surtout il ne saurait pas se taire sous
 * `prefers-reduced-motion` — le CSS, lui, sait.
 *
 * Même motif que `--i` sur `.cmp-row` (Comparison.tsx) : le CSS n'a aucun autre
 * moyen de savoir qu'il est la quatrième ligne d'une liste.
 */
const rank = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

/**
 * Ce que douze mois payés au mois coûtent de plus que l'année réglée d'avance.
 *
 * Déduit de la formule elle-même, jamais saisi : `yearlyCents` descend déjà de
 * `YEARLY_MONTHS_BILLED` (content.ts), donc le jour où l'on facturerait onze
 * mois au lieu de dix, la carte l'annoncerait toute seule.
 */
const yearlySaved = (plan: Plan): number => plan.monthlyCents * 12 - plan.yearlyCents;

/**
 * ═══ LA CARTE DE CALCUL — UNE COLONNE, ET SON RANG DE DÉPART ═══
 *
 * Une colonne occupe des rangs CONSÉCUTIFS : son titre, ses lignes, la barre
 * de l'addition, puis ses deux totaux. `spanOf` est ce qui permet à la colonne
 * suivante de savoir où elle commence sans qu'aucun rang soit écrit à la main —
 * `steps` a la longueur qu'il a, et l'ajout d'une ligne dans `PRICING_MATH`
 * décale la suite au lieu de la chevaucher.
 */
const spanOf = (side: PricingMath["stack"]): number => side.steps.length + 4;

/**
 * UNE COLONNE DE L'ADDITION — celle qu'on empile, ou celle qui répond.
 *
 * LE MONTANT PEUT ÊTRE UN MOT. La mise en service de Boost s'écrit
 * « Comprise » : c'est le seul endroit de la page où l'absence de chiffre vaut
 * mieux qu'un chiffre, et il répond aux 55 € posés en face à la même hauteur.
 * On le reconnaît à ce qu'il ne porte aucun chiffre — pas à sa position dans la
 * liste, qui n'engage personne.
 */
function CalcSide({ side, from, boost }: { side: PricingMath["stack"]; from: number; boost?: boolean }) {
  /* La barre de l'addition se trace APRÈS la dernière ligne empilée et AVANT
     que le total tombe : c'est le geste qu'on fait à la main sur un carnet. */
  const bar = from + side.steps.length + 1;

  return (
    <div className={boost ? "pr-calcside is-boost" : "pr-calcside"}>
      <p className="pr-calctitle" style={rank(from)}>
        {side.title}
      </p>

      <dl className="pr-calcrows">
        {side.steps.map((step, i) => (
          <div className="pr-calcrow" key={step.label} style={rank(from + 1 + i)}>
            <dt className="pr-calclabel">
              {step.label}
              {step.note ? <span className="pr-calcnote">{step.note}</span> : null}
            </dt>
            <dd className={/\d/.test(step.amount) ? "pr-calcamt" : "pr-calcamt is-word"}>{step.amount}</dd>
          </div>
        ))}
      </dl>

      {/* Les deux totaux sous la barre. Le premier mois d'abord : c'est la mise
          en service qui creuse l'écart et elle n'est due qu'une fois — le mois
          courant seul cacherait le seul écart à trois chiffres de la page. */}
      <dl className="pr-calctotals" style={rank(bar)}>
        <div className="pr-calcrow is-total" style={rank(bar + 1)}>
          <dt className="pr-calclabel">
            {side.firstMonth.label}
            {side.firstMonth.note ? <span className="pr-calcnote">{side.firstMonth.note}</span> : null}
          </dt>
          <dd className="pr-calcamt">{side.firstMonth.amount}</dd>
        </div>
        <div className="pr-calcrow" style={rank(bar + 2)}>
          <dt className="pr-calclabel">
            {side.everyMonth.label}
            {side.everyMonth.note ? <span className="pr-calcnote">{side.everyMonth.note}</span> : null}
          </dt>
          <dd className="pr-calcamt">{side.everyMonth.amount}</dd>
        </div>
      </dl>
    </div>
  );
}

/*
 * ═══ LA PARTITION, ÉCRITE UNE FOIS ═══
 *
 * Les trois temps se déroulent dans cet ordre et pas un autre : on additionne,
 * on montre ce que ça coûte en face, l'écart tombe en dernier. L'écart est la
 * chute — s'il apparaissait en premier, il ne resterait qu'à le croire.
 *
 * Le « + 1 » entre deux temps est un TEMPS D'ARRÊT, un rang laissé vide. Sans
 * lui, la colonne de droite enchaîne sur la gauche sans qu'on ait le temps de
 * lire le total : la carte redevient un tableau qui s'affiche.
 */
const STACK_FROM = 0;
const BOOST_FROM = STACK_FROM + spanOf(PRICING_MATH.stack) + 1;
const GAPS_FROM = BOOST_FROM + spanOf(PRICING_MATH.boost) + 1;
const LINE_RANK = GAPS_FROM + 1 + PRICING_MATH.gaps.items.length;

/**
 * « Trois prix, affichés. Zéro commission, toujours. »
 *
 * LA SECTION NE DEMANDE QU'UN SEUL ARBITRAGE : où s'arrête ma colonne. Tout ce
 * qui est écrit ici sert cette décision-là, et rien d'autre ne s'y invite.
 *
 * L'ORDRE EST L'ARGUMENT. Le tableau des commissions vient EN TÊTE, avant les
 * prix, parce que l'objection « et en plus vous allez prendre un
 * pourcentage ? » naît exactement ici et jamais avant. Trois lignes, aucune
 * phrase de plaidoyer autour : un restaurateur qui pose « 0 % » à côté de
 * « jusqu'à 30 % » se convainc tout seul, et l'entourer de commentaires
 * transformerait un fait en argumentaire.
 *
 * LA GRILLE LIT TROIS FOIS LA MÊME LISTE. `PLAN_MODULES` est rendue ENTIÈRE
 * dans les trois colonnes, pastille pleine ou vide. Les listes cumulatives
 * d'hier (« Tout Starter, plus : ») obligeaient le lecteur à comparer quatre
 * lignes contre cinq contre trois et à reconstruire de tête ce que chacune
 * contenait ; il lui reste maintenant une seule chose à chercher, et elle est
 * visible en travers des trois colonnes d'un seul regard.
 *
 * UN SEUL APPEL, EN PIED DE GRILLE. Trois boutons identiques posés sur trois
 * cartes de prix redemandent la décision qu'on vient de réduire à une.
 *
 * ═══ POURQUOI CETTE SECTION EST DEVENUE UN ÎLOT CLIENT ═══
 *
 * Pour un seul état : la périodicité. Elle ne pouvait pas rester en CSS — deux
 * jeux de prix dans le DOM avec une case à cocher au milieu, c'est un lecteur
 * d'écran qui annonce six montants pour trois formules. Le sélecteur est donc
 * un VRAI groupe d'onglets (`role="tablist"`, flèches, `aria-selected`), et
 * l'onglet inactif porte `aria-hidden` sur le montant qu'il cache.
 *
 * Rien d'autre n'est passé au client : les trois cartes, l'addition et le
 * bandeau se rendent au serveur comme avant, et l'animation de la carte de
 * calcul n'est faite QUE de CSS (voir plus bas).
 *
 * L'ADDITION EST ÉCRITE FRANCHEMENT, on ne la laisse pas découvrir : Complet
 * plus le module, mise en service comprise, coûtent plus cher que Boost — et
 * `PRICING_MATH` en porte les trois temps, montant par montant, sans qu'un
 * seul nombre soit recopié dans ce fichier.
 *
 * CE QUI EST SORTI : le compteur de places prises et ses pastilles. Il
 * affirmait trois clients signés que nous n'avons pas — le seul énoncé de la
 * page qu'un prospect pouvait prendre en flagrant délit d'un coup de
 * téléphone. La politique, elle, est vraie et reste : `FOUNDER_POLICY`.
 */
export function Pricing() {
  const { badge, title } = section("tarifs");

  const [cycle, setCycle] = useState<BillingCycleId>("mensuel");
  const yearly = cycle === "annuel";
  const active = BILLING_CYCLES.findIndex((c) => c.id === cycle);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  /*
   * LES FLÈCHES DÉPLACENT LA SÉLECTION ET LE FOCUS AVEC ELLE.
   *
   * C'est le contrat d'un groupe d'onglets : un seul des deux boutons est dans
   * l'ordre de tabulation (`tabIndex`), les flèches font le reste. Sans ce
   * déplacement du focus, l'onglet suivant serait sélectionné pendant que le
   * clavier reste sur le précédent — et la touche suivante repartirait du
   * mauvais bouton.
   */
  const onTabKey = (ev: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = BILLING_CYCLES.length - 1;
    let next = i;
    if (ev.key === "ArrowRight") next = i === last ? 0 : i + 1;
    else if (ev.key === "ArrowLeft") next = i === 0 ? last : i - 1;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = last;
    else return;

    ev.preventDefault();
    setCycle(BILLING_CYCLES[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <section className="section pr-section" id="tarifs">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>
        {title}
      </h2>

      {/* ─── Ce qu'on prélève, et ce que prélèvent les autres ─── */}
      <dl className="pr-commissions rv">
        {COMMISSIONS.map((c, i) => (
          // La première ligne est la nôtre. C'est aussi la seule qui porte
          // l'astérisque : il appelle `PRICING_FOOTNOTE`, en pied de section,
          // qui dit les frais d'encaissement que nous ne touchons pas.
          <div className={i === 0 ? "pr-commission is-ours" : "pr-commission"} key={c.who}>
            <dt className="pr-cwho">{c.who}</dt>
            <dd className="pr-crate">
              {c.rate}
              {i === 0 ? (
                <sup className="pr-star" aria-hidden="true">
                  *
                </sup>
              ) : null}
            </dd>
            <dd className="pr-cnote">{c.note}</dd>
          </div>
        ))}
      </dl>

      {/* ─── Le sélecteur de périodicité ───
          `--i` place la pastille dorée sous l'onglet actif et `--n` la
          dimensionne : deux variables, et la glissade est au CSS. Une largeur
          calculée en JavaScript se serait désaccordée du texte au premier
          changement de police. */}
      <div className="pr-billing rv">
        <div
          className="pr-cycles"
          role="tablist"
          aria-label="Périodicité de facturation"
          style={{ "--i": active, "--n": BILLING_CYCLES.length } as CSSProperties}
        >
          {BILLING_CYCLES.map((c, i) => (
            <button
              type="button"
              role="tab"
              id={`pr-cycle-${c.id}`}
              key={c.id}
              className="pr-cycle"
              aria-selected={c.id === cycle}
              aria-controls="pr-plans"
              // Un seul arrêt de tabulation pour le groupe : on entre dans le
              // sélecteur sur l'onglet actif, on en sort d'une tabulation.
              tabIndex={c.id === cycle ? 0 : -1}
              ref={(node) => {
                tabs.current[i] = node;
              }}
              onClick={() => setCycle(c.id)}
              onKeyDown={(ev) => onTabKey(ev, i)}
            >
              {c.label}
              {c.hint ? <span className="pr-cyclehint">{c.hint}</span> : null}
            </button>
          ))}
        </div>
        {/* Sans cette phrase, un onglet « Par an » posé au-dessus d'un bandeau
            qui dit « sans engagement » se lit comme un démenti. Elle est écrite
            dans content.ts pour tenir avec `ENGAGEMENT`, qu'on ne reformule
            jamais. */}
        <p className="pr-billingnote">{BILLING_YEARLY_NOTE}</p>
      </div>

      {/* ─── Les trois formules ───
          `data-cycle` est le SEUL attribut que la périodicité fait bouger sur
          la grille : les trois enveloppes `.rv` gardent une classe fixe, sinon
          React réécrirait leur `className` au changement d'onglet et emporterait
          le `.in` que l'observateur y a posé — les cartes disparaîtraient. */}
      <div
        className="pr-grid"
        id="pr-plans"
        role="tabpanel"
        aria-labelledby={`pr-cycle-${cycle}`}
        tabIndex={0}
        data-cycle={cycle}
      >
        {PLANS.map((plan, i) => (
          <div className="rv" key={plan.id} style={{ transitionDelay: `${i * 0.1}s` }}>
            <article className={plan.popular ? "pr-card popular spot" : "pr-card spot"}>
              {plan.popular ? <span className="pr-badge">Populaire</span> : null}
              <h3 className="h5">{plan.name}</h3>

              {/* LES DEUX MONTANTS SONT LÀ, EMPILÉS DANS LA MÊME CASE.
                  Le chiffre se substitue en glissant vers le haut ; un nombre
                  qui saute ne se lit pas comme une remise, il se lit comme une
                  erreur de chargement. Celui qu'on cache sort du texte
                  (`aria-hidden`) : deux prix annoncés pour une formule, c'est
                  une grille qui se contredit à voix haute. */}
              <p className="pr-price">
                <span className="pr-amt is-month" aria-hidden={yearly}>
                  {plan.price}
                  <span className="pr-period">{plan.period}</span>
                </span>
                <span className="pr-amt is-year" aria-hidden={!yearly}>
                  {plan.priceYearly}
                  <span className="pr-period">{plan.periodYearly}</span>
                </span>
              </p>

              {/* CE QUE L'ANNÉE ÉCONOMISE, SOUS LE PRIX ET NULLE PART AILLEURS.
                  Le gain doit se VOIR au moment du choix, pas se calculer. La
                  case se déplie (`0fr` → `1fr`) au lieu d'apparaître : une
                  hauteur qui surgit décale les trois cartes d'un coup. */}
              <div className="pr-year" aria-hidden={!yearly}>
                <div className="pr-yearin">
                  <p className="pr-yearmonth">{plan.yearlyPerMonth}</p>
                  <p className="pr-yearsave">
                    <b>{euros(yearlySaved(plan))}</b> de moins que douze mois payés au mois
                  </p>
                </div>
              </div>

              <p className="body-text pr-desc">{plan.desc}</p>

              <ul className="pr-modules">
                {PLAN_MODULES.map((m) => {
                  const included = plan.modules.includes(m.id);
                  return (
                    <li className={included ? "pr-module" : "pr-module off"} key={m.id}>
                      <span className="pr-dot" aria-hidden="true" />
                      <span>{m.label}</span>
                      {/* La pastille est muette pour un lecteur d'écran : sans
                          ce mot, les trois colonnes lui dictent onze fois la
                          même liste et la grille ne dit plus rien. */}
                      <span className="pr-sr">{included ? "Inclus" : "Non inclus"}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          </div>
        ))}
      </div>

      {/* `ancre()` et pas `#contact` : voir le hero. */}
      <a className="btn light pr-cta" href={ancre("contact").href}>
        {CTA_CALLBACK}
      </a>

      {/* ═══ L'ADDITION SE FAIT SOUS LES YEUX ═══

          Une somme déjà posée se vérifie ; une somme qui se construit se VIT.
          Les lignes s'empilent une à une, la barre se trace, le total tombe,
          Boost répond en face et l'écart arrive en dernier.

          TROIS RÈGLES TIENNENT CE BLOC :
           · la séquence est ENTIÈREMENT en CSS, pilotée par `--i` — aucun
             temporisateur JavaScript, rien qui puisse se désynchroniser dans
             un onglet resté en arrière-plan ;
           · elle ne part qu'une fois la carte révélée (`.pr-calc.in`), sinon
             elle se jouerait pendant que le visiteur est trois écrans plus
             haut et il arriverait devant un tableau déjà figé ;
           · hors animation, le calcul est COMPLET : tous les montants et les
             deux totaux sont dans le DOM, dans l'ordre, et lisibles par un
             moteur de recherche, un lecteur d'écran ou quelqu'un sous
             `prefers-reduced-motion`. L'animation embellit, elle ne conditionne
             rien. */}
      <div className="pr-calc spot rv">
        <div className="pr-calccols">
          <CalcSide side={PRICING_MATH.stack} from={STACK_FROM} />
          <CalcSide side={PRICING_MATH.boost} from={BOOST_FROM} boost />
        </div>

        {/* La chute. Trois écarts, du plus spectaculaire au plus durable —
            le signe moins est DÉJÀ dans le montant (`euros`), on n'en préfixe
            pas un second. */}
        <div className="pr-gaps">
          <p className="pr-gapstitle" style={rank(GAPS_FROM)}>
            {PRICING_MATH.gaps.title}
          </p>
          <ul className="pr-gapitems">
            {PRICING_MATH.gaps.items.map((gap, i) => (
              <li className="pr-gap" key={gap.label} style={rank(GAPS_FROM + 1 + i)}>
                <span className="pr-gapamt">{gap.amount}</span>
                <span className="pr-gaplabel">{gap.label}</span>
                <span className="pr-gapdetail">{gap.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pr-calcfoot">
          <p className="pr-calcline" style={rank(LINE_RANK)}>
            {PRICING_MATH.line}
          </p>
          {/* Le sélecteur, lui, peut être resté sur « Par an ». Cette ligne
              évite au lecteur de chercher pourquoi le calcul parle en
              mensualités : il compare deux CHEMINS, pas deux périodicités. */}
          <p className="pr-calcbase" style={rank(LINE_RANK)}>
            Montants au tarif mensuel.
          </p>
        </div>
      </div>

      {/* Le module vendu à part. Il s'affiche « Commande en ligne & click and
          collect » et jamais « Livraison » : le mot Livraison en face d'un prix
          se lit comme un livreur qu'on facture, et nous n'en fournissons
          aucun — le tunnel s'arrête au créneau de retrait. */}
      <p className="pr-addon">
        <strong>{MODULE_ADDON.name}</strong> — <span className="pr-addonprice">{MODULE_ADDON.price}</span>.{" "}
        {MODULE_ADDON.line}
      </p>

      {/* La clause d'engagement est affichée telle quelle, jamais reformulée :
          la FAQ affiche la MÊME constante, et c'est à ce prix que la page cesse
          de se contredire à voix haute. */}
      <div className="pr-band rv">
        <p className="pr-engagement">{ENGAGEMENT}</p>
        <p className="pr-policy">{FOUNDER_POLICY}</p>
      </div>

      {/* Discrète par sa taille, pas par son emplacement : elle ferme la
          section, personne ne peut prétendre ne pas l'avoir vue. */}
      <p className="pr-note">{PRICING_FOOTNOTE}</p>
      {/* Le périmètre avant le prix : un prospect qui compare 199 € à un
          prix d'appel compare une pile complète à sa première brique. */}
      <p className="pr-note">{PRICING_PERIMETER}</p>
    </section>
  );
}
