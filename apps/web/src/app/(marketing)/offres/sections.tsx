import Link from "next/link";
import {
  BILLING_YEARLY_NOTE,
  CTA_CALLBACK,
  CTA_DEMO,
  ENGAGEMENT,
  FOUNDER_POLICY,
  MODULE_ADDON,
  MODULE_MONTHLY_CENTS,
  MODULE_SETUP_CENTS,
  PLANS,
  PLAN_MODULES,
  PRICING_FOOTNOTE,
  PRICING_MATH,
  ancre,
  euros,
} from "@/components/marketing/content";
import {
  ANNUEL_HINT,
  LIMITES,
  MODULE_POINTS,
  OFFRE_CTA,
  OFFRE_HERO,
  OFFRE_SERVICES,
  PLAN_MODULE_NOTE,
  SOMMAIRE,
  TOUJOURS_COMPRIS,
  offreSection,
} from "./content";

/**
 * Les blocs de la page Offres — tous rendus au SERVEUR.
 *
 * Rien ici n'a d'état : pas de sélecteur de périodicité (les deux montants sont
 * affichés côte à côte, c'est une page de détail), pas d'accordéon, pas
 * d'onglet. La seule pincée de client de la route est `RevealObserver`, qui pose
 * `.in` sur les `.rv` — la même mécanique que la landing, importée telle quelle
 * plutôt que redessinée.
 *
 * ═══ CHAQUE MONTANT EST LU, AUCUN N'EST ÉCRIT ═══
 *
 * `plan.price`, `plan.priceYearly`, `plan.yearlyPerMonth`, `MODULE_ADDON`,
 * `PRICING_MATH` : tout descend des constantes de `components/marketing/
 * content.ts`, où l'assertion `GRILLES_ACCORDÉES` casse le typecheck si la
 * vitrine diverge des contrats. Une page de tarifs est le pire endroit du site
 * où recopier un nombre.
 */

/* ── En-tête de page et sommaire ─────────────────────────────── */

/**
 * L'en-tête ANNONCE LE CONTENU, il ne revend pas le produit.
 *
 * Le lecteur qui arrive ici a déjà lu la vitrine (les six liens qui mènent à
 * cette route sont tous dans l'en-tête, le burger et le pied de page). Lui
 * rejouer un argumentaire, c'est lui faire redescendre onze sections pour
 * retrouver le prix qu'il venait chercher. On lui dit donc ce que la page
 * contient, et le sommaire l'y emmène en un clic.
 */
function PageHead() {
  return (
    <header className="section of-head">
      <div className="of-wrap of-headwrap">
        <span className="badge">{OFFRE_HERO.badge}</span>
        <h1 className="h1 of-title">{OFFRE_HERO.title}</h1>
        <p className="subheading of-lead">{OFFRE_HERO.lead}</p>

        {/* Trois faits vérifiables au premier écran — et pas un mot sur
            l'engagement, qui ne s'écrit qu'en entier (voir `conditions`). */}
        <ul className="of-facts">
          {OFFRE_HERO.facts.map((fact) => (
            <li className="of-fact" key={fact}>
              {fact}
            </li>
          ))}
        </ul>

        {/*
         * LE SOMMAIRE EST UNE VRAIE NAVIGATION, pas une rangée de pastilles :
         * la page fait plus de trois écrans, et sans lui le lecteur qui cherche
         * « ce qui n'est pas compris » défile à l'aveugle. `<nav>` + son
         * `aria-label` pour qu'un lecteur d'écran puisse y sauter directement.
         *
         * Les six liens sont des ancres NUES, et c'est le seul endroit du site
         * où c'est correct : elles visent des sections de CETTE page. Le lien
         * vers la vitrine, juste en dessous, passe lui par `ancre()`.
         */}
        <nav className="of-toc" aria-label="Sommaire de la page">
          {SOMMAIRE.map((item) => (
            <a className="of-tocitem" href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

/* ── 1. Les trois formules ───────────────────────────────────── */

/**
 * LES DEUX PÉRIODICITÉS SONT AFFICHÉES ENSEMBLE, sans sélecteur.
 *
 * La vitrine a un onglet « Par mois / Par an » parce qu'elle doit tenir en un
 * regard ; ici, le lecteur VÉRIFIE, et cacher la moitié des montants derrière un
 * clic transformerait la page de détail en devinette. Les deux prix sont donc
 * dans le DOM, hiérarchisés — le mensuel en gros, l'annuel sous lui avec son
 * équivalent ramené au mois, seul chiffre qui se compare vraiment au mensuel.
 *
 * La liste des modules est rendue ENTIÈRE dans les trois colonnes, pastille
 * pleine ou vide : c'est la refonte de la grille de la landing, et pour la même
 * raison — trois listes cumulatives de longueurs différentes obligent à
 * reconstruire de tête ce que chacune contient.
 */
function Formules() {
  const { id, badge, title, lead } = offreSection("formules");

  return (
    <section className="section of-section" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <div className="of-plans">
          {PLANS.map((plan, i) => {
            // La note se choisit sur les MODULES de la formule, jamais sur son
            // identifiant : le jour où la commande en ligne descendrait dans
            // Complet, les trois cartes suivraient toutes seules.
            const enLigne = plan.modules.includes("online");

            return (
              <div className="rv" key={plan.id} style={{ transitionDelay: `${i * 0.1}s` }}>
                <article className={plan.popular ? "of-plan is-popular spot" : "of-plan spot"}>
                  {plan.popular ? <span className="of-planbadge">Populaire</span> : null}
                  <h3 className="of-planname">{plan.name}</h3>

                  <p className="of-price">
                    <span className="of-amt">{plan.price}</span>
                    <span className="of-per">{plan.period}</span>
                  </p>

                  {/* L'année : son montant, sa période, puis l'équivalent
                      mensuel. « 1 590 € » posé seul sous « 159 € » se lit comme
                      dix fois plus cher tant qu'on n'a pas lu la période. */}
                  <p className="of-year">
                    <span className="of-yearamt">{plan.priceYearly}</span> {plan.periodYearly}
                    {/* La pastille est poussée à droite de la MÊME ligne
                        (`margin-left: auto`) : sur sa propre ligne, elle
                        rajoutait une troisième hauteur à l'encart annuel et les
                        trois cartes gagnaient vingt pixels pour trois mots. */}
                    <span className="of-yearhint">{ANNUEL_HINT}</span>
                    <span className="of-yearmonth">{plan.yearlyPerMonth}</span>
                  </p>

                  <p className="of-plandesc">{plan.desc}</p>

                  <ul className="of-mods">
                    {PLAN_MODULES.map((m) => {
                      const inclus = plan.modules.includes(m.id);
                      return (
                        <li className={inclus ? "of-mod" : "of-mod is-off"} key={m.id}>
                          <span className="of-dot" aria-hidden="true" />
                          <span>{m.label}</span>
                          {/* La pastille est muette pour un lecteur d'écran :
                              sans ce mot, les trois colonnes lui dictent onze
                              fois la même liste et la grille ne dit plus rien. */}
                          <span className="of-sr">{inclus ? "Inclus" : "Non inclus"}</span>
                        </li>
                      );
                    })}
                  </ul>

                  <p className={enLigne ? "of-plannote is-inclus" : "of-plannote"}>
                    {enLigne ? PLAN_MODULE_NOTE.inclus : PLAN_MODULE_NOTE.supplement}
                  </p>
                </article>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── 2. Le module Commande en ligne & fidélité ───────────────── */

/**
 * UN PANNEAU À DEUX COLONNES, ET SURTOUT PAS UNE QUATRIÈME CARTE DE PRIX.
 *
 * La section précédente vient de poser trois cartes ; en aligner une quatrième
 * ferait lire le module comme une formule de plus — c'est-à-dire comme un choix
 * À LA PLACE de Boost, alors que c'est un supplément qui se branche SUR
 * Essentiel ou Complet. Le détail tient donc la largeur, et le prix s'isole dans
 * un encart qui ne ressemble à aucune des trois cartes du dessus.
 *
 * L'ARBITRAGE EST DONNÉ, PAS CACHÉ. Quelqu'un qui lit « 79 € par mois » juste
 * après avoir lu « Boost, 199 € » fait l'addition ; s'il trouve tout seul que
 * Boost coûte moins cher, il se demande pourquoi on ne le lui a pas dit.
 * `PRICING_MATH.line` la fait pour lui, et sans qu'un seul nombre soit écrit
 * ici.
 */
function Module() {
  const { id, badge, title, lead } = offreSection("module");

  return (
    <section className="section of-section is-tinted" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <div className="of-module">
          <ol className="of-points rv">
            {MODULE_POINTS.map((point) => (
              <li className="of-point" key={point.title}>
                <h3 className="of-pointtitle">{point.title}</h3>
                <p className="of-pointline">{point.line}</p>
              </li>
            ))}
          </ol>

          <aside className="of-modulecard spot rv">
            <h3 className="of-modulename">{MODULE_ADDON.name}</h3>

            <dl className="of-modulerows">
              <div className="of-modulerow">
                <dt>Abonnement</dt>
                <dd>{euros(MODULE_MONTHLY_CENTS)}</dd>
              </div>
              <div className="of-modulerow">
                <dt>Mise en service</dt>
                <dd>{euros(MODULE_SETUP_CENTS)}</dd>
              </div>
            </dl>

            <p className="of-modulenote">
              Par mois, plus la mise en service la première fois. Se branche sur Essentiel ou sur Complet — les deux sont
              déjà compris dans Boost.
            </p>

            {/* L'addition, écrite franchement. Les trois montants descendent des
                quatre constantes de la grille : elle ne peut plus se tromper,
                et c'était exactement son défaut avant qu'elle soit dérivée. */}
            <p className="of-modulemath">{PRICING_MATH.line}</p>
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ── 3. Les services ─────────────────────────────────────────── */

/**
 * TROIS RANGÉES PLEINE LARGEUR, JAMAIS TROIS CARTES.
 *
 * Même arbitrage que sur la vitrine, et pour la même raison : trois cartes
 * feraient lire la fiche Google comme un troisième choix parmi trois, alors
 * qu'elle est comprise dans la mise en route et qu'elle n'est en concurrence
 * avec rien. Une rangée se lit comme une ligne de devis, ce qui est exactement
 * ce que cette page est.
 *
 * Le prix tient sa colonne plutôt que de finir en queue de paragraphe : c'est la
 * première chose qu'on cherche dans une liste de services, et la dernière qu'on
 * trouve quand elle est noyée dans la prose.
 */
function Services() {
  const { id, badge, title, lead } = offreSection("services");

  return (
    <section className="section of-section" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <ol className="of-rows">
          {OFFRE_SERVICES.map((s, i) => (
            <li className="of-row rv" key={s.id} style={{ transitionDelay: `${i * 0.08}s` }}>
              <div className="of-rowhead">
                <h3 className="of-rowtitle">{s.title}</h3>
                <p className="of-rowlead">{s.lead}</p>
              </div>
              <p className="of-rowline">{s.line}</p>
              <p className="of-rowprice">
                {s.price}
                {s.priceNote ? <span className="of-rowpricenote">{s.priceNote}</span> : null}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── 4. Toujours compris ─────────────────────────────────────── */

/**
 * UNE LISTE COCHÉE, EN DEUX COLONNES DE TEXTE — pas une grille de cartes.
 *
 * Neuf éléments en cartes, ce serait neuf encadrés à la suite d'une section qui
 * en portait déjà trois : la page deviendrait le mur de vignettes que la refonte
 * de la landing a démonté. Deux colonnes de lignes cochées se parcourent d'un
 * regard vertical et n'ajoutent aucun cadre.
 */
function Compris() {
  const { id, badge, title, lead } = offreSection("compris");

  return (
    <section className="section of-section" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <ul className="of-checks rv">
          {TOUJOURS_COMPRIS.map((line) => (
            <li className="of-check" key={line}>
              <span className="of-tick" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── 5. Ce qui n'est pas compris ─────────────────────────────── */

/**
 * LA SECTION QUI DIT NON, ET ELLE A DROIT À SON FOND.
 *
 * C'est le seul moment de la page où le lecteur doit RALENTIR : un fond teinté
 * et quatre blocs larges l'y obligent mieux qu'un paragraphe de plus. Le
 * marqueur est un trait doré et non une croix rouge — nous n'annonçons pas des
 * défauts, nous délimitons un périmètre, et une croix rouge en série se lit
 * comme une liste de manques.
 */
function Limites() {
  const { id, badge, title, lead } = offreSection("limites");

  return (
    <section className="section of-section is-tinted" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <ul className="of-limits">
          {LIMITES.map((limite, i) => (
            <li className="of-limit rv" key={limite.title} style={{ transitionDelay: `${i * 0.08}s` }}>
              <h3 className="of-limittitle">{limite.title}</h3>
              <p className="of-limitline">{limite.line}</p>
            </li>
          ))}
        </ul>

        {/* LE SEUL ENDROIT DE LA PAGE OÙ LE TAUX D'ENCAISSEMENT EST ÉCRIT, et
            il l'est par la constante de la vitrine. Discrète par sa taille, pas
            par son emplacement : elle ferme la section qui dit non, personne ne
            peut prétendre ne pas l'avoir vue. */}
        <p className="of-fineprint">{PRICING_FOOTNOTE}</p>
      </div>
    </section>
  );
}

/* ── 6. Conditions ───────────────────────────────────────────── */

/**
 * TROIS ÉNONCÉS, ET LE PREMIER EST AFFICHÉ TEL QUEL.
 *
 * `ENGAGEMENT` est une constante et non une phrase recopiée parce que le site se
 * contredisait à voix haute : le hero annonçait « Sans engagement » pendant que
 * la FAQ répondait « on vous détaille les conditions au moment du devis ». Un
 * prospect qui attrape les deux ne croit plus ni l'une ni l'autre. Cette page
 * est la troisième surface à l'afficher — donc la troisième occasion de diverger
 * si on la reformulait. On ne la reformule pas.
 */
function Conditions() {
  const { id, badge, title, lead } = offreSection("conditions");

  return (
    <section className="section of-section" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <div className="of-conditions rv">
          <p className="of-engagement">{ENGAGEMENT}</p>
          <p className="of-condition">{BILLING_YEARLY_NOTE}</p>
          <p className="of-condition of-policy">{FOUNDER_POLICY}</p>
        </div>
      </div>
    </section>
  );
}

/* ── 7. L'appel de pied de page ──────────────────────────────── */

/**
 * LES DEUX SEULS GESTES DU SITE, ET ILS MÈNENT TOUS DEUX À LA LANDING.
 *
 * `CTA_CALLBACK` vers le formulaire de rappel, `CTA_DEMO` vers la démonstration
 * manipulable : deux libellés pour deux destinations, jamais un troisième verbe
 * inventé pour cette page. Les deux href passent par `ancre()`, qui les résout
 * contre `SECTIONS` et LÈVE si la section a disparu — une ancre nue écrite ici
 * résoudrait en `/offres#contact` et ne ferait rien du tout, sans erreur, sans
 * 404, sans une ligne de console.
 */
function AppelFinal() {
  return (
    <section className="section of-section of-ctasection">
      <div className="of-wrap">
        <div className="of-cta spot rv">
          <h2 className="h2 of-ctatitle">{OFFRE_CTA.title}</h2>
          <p className="subheading of-ctaline">{OFFRE_CTA.line}</p>
          <div className="of-ctabtns">
            <Link className="btn light" href={ancre("contact").href}>
              {CTA_CALLBACK}
            </Link>
            <Link className="btn dark" href={ancre("produit").href}>
              {CTA_DEMO}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * La page, dans l'ordre d'une vérification : ce que contient une formule → ce
 * qui se vend à part → ce qu'on fait autour → ce qui est toujours compris → ce
 * qui ne l'est jamais → à quoi l'on s'engage → comment nous joindre.
 *
 * Deux blocs de même forme ne se suivent jamais : cartes, panneau, rangées,
 * liste cochée, blocs larges, bande de texte, encart d'appel.
 */
export function OffresBody() {
  return (
    <>
      <PageHead />
      <Formules />
      <Module />
      <Services />
      <Compris />
      <Limites />
      <Conditions />
      <AppelFinal />
    </>
  );
}
