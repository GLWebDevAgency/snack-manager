import Link from "next/link";
import { CommerceOffers } from "@/components/marketing/CommerceOffers";
import { Photo } from "@/components/marketing/Photo";
import {
  ATELIER_PORTE,
  BILLING_YEARLY_NOTE,
  CTA_CALLBACK,
  CTA_DEMO,
  ENGAGEMENT,
  FOUNDER_POLICY,
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
  ATELIER_STRIP,
  MATERIEL,
  MODULE_POINTS,
  OFFRE_CTA,
  OFFRE_HERO,
  OFFRE_SERVICES,
  OFFRE_SHOTS,
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
 * d'onglet. Les seules pincées de client de la route sont `RevealObserver`, qui
 * pose `.in` sur les `.rv`, et `Photo`, qui replie une image manquante — deux
 * composants de la landing importés tels quels plutôt que redessinés.
 *
 * ═══ CHAQUE MONTANT EST LU, AUCUN N'EST ÉCRIT ═══
 *
 * `plan.price`, `plan.priceYearly`, `plan.yearlyPerMonth`, `MODULE_ADDON`,
 * `PRICING_MATH`, `MATERIEL.zero` : tout descend des constantes de
 * `components/marketing/content.ts`, où l'assertion `GRILLES_ACCORDÉES` casse le
 * typecheck si la vitrine diverge des contrats. Une page de tarifs est le pire
 * endroit du site où recopier un nombre.
 *
 * ═══ LE RYTHME EST LE SUJET DE LA RÉVISION DU 21/08/2026 ═══
 *
 * La page mesurait huit sections toutes calées sur 1 200 px, toutes ouvertes par
 * le même bloc badge + `h2` + accroche, toutes espacées de 90 px, et ne portait
 * pas une seule image sur sept écrans et demi. Elle alterne désormais QUATRE
 * gabarits, et deux du même ne se suivent jamais :
 *
 *   bande photographique à fond perdu   → l'ouverture, le matériel, le rappel
 *   grille ou rangées contenues         → les formules, les services
 *   panneau débordant d'un seul côté    → le module
 *   colonne étroite, typographie seule  → les conditions
 *
 * ET LA PAGE A RACCOURCI. Une page plus riche n'est pas une page plus longue :
 * les bandes REMPLACENT du texte. La section « limites » (817 px) a disparu, les
 * neuf lignes de « toujours compris » sont passées de deux à trois colonnes, la
 * carte d'appel de 1 200 px a cédé la place à une bande letterbox. Le solde est
 * négatif — la page est plus courte qu'avant d'avoir cinq images.
 */

/* ── En-tête de page — la bande d'ouverture ──────────────────── */

/**
 * ═══ LA PREMIÈRE IMAGE DE LA PAGE, ET LE PREMIER CHIFFRE DORÉ ═══
 *
 * L'en-tête était du texte seul dans une colonne de 1 200 px : badge, titre à
 * 70 px, accroche, trois pastilles de faits, sommaire. Le fondateur en a fait le
 * cœur de son reproche — « on prend toute la largeur de l'écran avec des
 * images » — et la mesure lui donnait raison : zéro `<img>` dans tout le `main`
 * quand la landing en affiche treize.
 *
 * La photo couvre donc TOUTE la largeur, à fond perdu, et le dégradé du voile
 * finit à l'opaque en bas pour que la section suivante naisse dedans plutôt que
 * de commencer après un trait.
 *
 * L'EN-TÊTE ANNONCE TOUJOURS LE CONTENU, IL NE REVEND PAS LE PRODUIT. Le lecteur
 * qui arrive ici a déjà lu la vitrine (les six liens qui mènent à cette route
 * sont tous dans l'en-tête, le burger et le pied de page). Lui rejouer un
 * argumentaire, c'est lui faire redescendre onze sections pour retrouver le prix
 * qu'il venait chercher. On lui dit donc ce que la page contient — et cette
 * fois, on lui donne le prix AVANT le sommaire.
 */
function PageHead() {
  return (
    <header className="of-band of-hero">
      {/* Décorative, et les deux drapeaux sont posés : la photo d'ambiance
          n'apporte rien à qui ne la voit pas, et son texte alternatif ne ferait
          qu'allonger le trajet vers le prix. */}
      <span className="of-bandmedia of-heromedia">
        <Photo shot={OFFRE_SHOTS.hero} decorative eager sizes="100vw" />
      </span>
      {/* Le voile est en deux couches : un dégradé vertical qui ferme la bande
          sur le noir de la page, et une lueur radiale calée à gauche, sous le
          texte. Mesuré et non supposé : sur les pixels les plus clairs de la
          photo (le fromage grillé), le blanc conserve plus de 8:1. */}
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-heroinner">
        <span className="badge">{OFFRE_HERO.badge}</span>
        <h1 className="h1 of-title">{OFFRE_HERO.title}</h1>
        <p className="subheading of-lead">{OFFRE_HERO.lead}</p>

        {/*
         * LA FOURCHETTE, SEULE, ÉNORME, EN OR.
         *
         * Elle vivait dans une pastille de 13,5 px au milieu de deux autres. Sur
         * les cinquante occurrences dorées de l'ancienne page, trente-quatre
         * mesuraient moins de 20 px de côté : la charte a une couleur d'accent et
         * la page la dépensait en confettis. Le premier doré de la page est
         * désormais un prix, et il se voit d'un bout à l'autre de la pièce.
         */}
        <p className="of-heroprice">
          <span className="of-heroamt">{OFFRE_HERO.price}</span>
        </p>
        <p className="of-heroclaim">{OFFRE_HERO.claim}</p>

        {/*
         * LE SOMMAIRE EST UNE VRAIE NAVIGATION, pas une rangée de pastilles :
         * la page fait plus de trois écrans, et sans lui le lecteur qui cherche
         * les conditions défile à l'aveugle. `<nav>` + son `aria-label` pour
         * qu'un lecteur d'écran puisse y sauter directement.
         *
         * Les six liens sont des ancres NUES, et c'est le seul endroit du site
         * où c'est correct : elles visent des sections de CETTE page. Le lien
         * vers la vitrine, plus bas, passe lui par `ancre()`.
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
 * ═══ CE QUI A CHANGÉ : LES TROIS MONTANTS SONT DORÉS, ET ÉNORMES ═══
 *
 * Ils étaient à 42 px et BLANCS (`color: rgb(255,255,255)`, mesuré). Trois
 * cartes de onze lignes chacune, et rien dedans que l'œil doive attraper en
 * premier. Ils passent à ~72 px en #c9a15a : c'est la seule chose qui doit se
 * voir avant d'être lue, et c'est ce que le lecteur est venu chercher.
 *
 * ═══ ET `PRICING_FOOTNOTE` EST REMONTÉE ICI ═══
 *
 * Elle fermait la section « limites », qui n'existe plus. La supprimer avec elle
 * aurait fait DISPARAÎTRE de la page la mention des frais d'encaissement — le
 * seul endroit où le taux est écrit. Elle se pose donc sous la grille, c'est-à-
 * dire sous les trois « 0 % de commission » dont elle est l'astérisque, à
 * l'endroit exact où la question se pose. Une note qu'on soupçonne d'être cachée
 * vend contre nous ; celle-là est collée au prix.
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

        {/* L'astérisque du « 0 % », à l'endroit où la question se pose : sous les
            prix. C'est le SEUL endroit de la page où le taux d'encaissement est
            écrit, et il l'est par la constante de la vitrine. */}
        <p className="of-fineprint rv">{PRICING_FOOTNOTE}</p>
      </div>
    </section>
  );
}

/* ── 1 bis. L'Atelier — la bande compacte ────────────────────── */

/**
 * SIX LIGNES, UN MONTANT PAR LIGNE — le gabarit du tableau des commissions de
 * la landing (`.pr-commissions`), et surtout pas une deuxième grille de
 * cartes : la section précédente vient d'en poser trois, et l'Atelier n'est
 * pas une quatrième formule. La bande RÉSUME et renvoie ; la page `/atelier`
 * porte la démarche (la maquette avant l'engagement), les détails et les
 * conditions.
 *
 * Le renvoi est un lien de NAVIGATION en habit de bouton, pas un troisième
 * verbe d'appel : les deux gestes du site restent `CTA_CALLBACK` et
 * `CTA_DEMO`, et « Découvrir » n'engage à rien — il ouvre une page.
 */
function Atelier() {
  const { id, badge, title, lead } = offreSection("atelier");

  return (
    <section className="section of-section" id={id}>
      <div className="of-wrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <dl className="pr-commissions rv">
          {ATELIER_STRIP.map((row) => (
            <div className="pr-commission" key={row.id}>
              <dt className="pr-cwho">{row.who}</dt>
              <dd className="pr-crate">{row.rate}</dd>
              <dd className="pr-cnote">{row.note}</dd>
            </div>
          ))}
        </dl>

        <Link className="btn light rv" href={ATELIER_PORTE.href}>
          {ATELIER_PORTE.cta}
        </Link>
      </div>
    </section>
  );
}

/* ── 2. Le module Commande en ligne & fidélité ───────────────── */

/**
 * LE SEUL BLOC DE LA PAGE QUI CASSE LA GRILLE SANS ÊTRE UNE BANDE.
 *
 * La colonne de texte reste alignée sur la gouttière de 1 200 px à gauche ; la
 * capture VERTICALE de l'application de commande sort du conteneur à droite et
 * va toucher le bord de l'écran, sur toute la hauteur de la section. C'est le
 * troisième gabarit de la page — ni carte, ni bande — et il tombe exactement
 * entre deux blocs contenus.
 *
 * `commande.png` est la seule capture portrait du dépôt (780 × 1688) et elle est
 * faite pour cet usage : affichée vers 560 px de large, elle est rendue SOUS sa
 * définition native, donc plus nette que la source. C'est aussi la seule image
 * de la page qui porte un vrai texte alternatif — ce n'est pas une illustration,
 * c'est la capture de ce qu'on vend dans la section qui le vend.
 *
 * ET SURTOUT PAS UNE QUATRIÈME CARTE DE PRIX. La section précédente vient de
 * poser trois cartes ; en aligner une quatrième ferait lire le module comme une
 * formule de plus — c'est-à-dire comme un choix À LA PLACE de Boost, alors que
 * c'est un supplément qui se branche SUR Essentiel ou Complet. Les deux montants
 * se posent donc à plat sous les points, en or et en grand.
 *
 * L'ARBITRAGE EST DONNÉ, PAS CACHÉ. Quelqu'un qui lit « 79 € par mois » juste
 * après avoir lu « Boost, 199 € » fait l'addition ; s'il trouve tout seul que
 * Boost coûte moins cher, il se demande pourquoi on ne le lui a pas dit.
 * `PRICING_MATH.line` la fait pour lui, et sans qu'un seul nombre soit écrit ici.
 */
function Module() {
  const { id, badge, title, lead } = offreSection("module");

  return (
    <section className="section of-section is-tinted of-modulesec" id={id}>
      <div className="of-modulegrid">
        <div className="of-modulecol">
          <div className="of-sechead rv">
            <span className="badge">{badge}</span>
            <h2 className="h2">{title}</h2>
            <p className="subheading of-seclead">{lead}</p>
          </div>

          <ol className="of-points rv">
            {MODULE_POINTS.map((point) => (
              <li className="of-point" key={point.title}>
                <h3 className="of-pointtitle">{point.title}</h3>
                <p className="of-pointline">{point.line}</p>
              </li>
            ))}
          </ol>

          {/* Les deux montants à plat, dorés et larges. L'ancien encart latéral
              portait en plus « Se branche sur Essentiel ou sur Complet — les
              deux sont déjà compris dans Boost » : c'est mot pour mot l'accroche
              de la section, deux cent pixels plus haut. Doublon supprimé. */}
          <div className="of-modulefigs rv">
            <p className="of-modulefig">
              <span className="of-modulenum">{euros(MODULE_MONTHLY_CENTS)}</span>
              <span className="of-modulelabel">par mois</span>
            </p>
            <p className="of-modulefig">
              <span className="of-modulenum">{euros(MODULE_SETUP_CENTS)}</span>
              <span className="of-modulelabel">de mise en service, la première fois</span>
            </p>
          </div>

          {/* L'addition, écrite franchement. Les trois montants descendent des
              quatre constantes de la grille : elle ne peut plus se tromper,
              et c'était exactement son défaut avant qu'elle soit dérivée. */}
          <p className="of-modulemath rv">{PRICING_MATH.line}</p>
        </div>

        {/* La SEULE image de la page qui porte un texte alternatif : ce n'est
            pas une illustration, c'est la capture de ce qu'on vend. */}
        <div className="of-modulemedia">
          <Photo shot={OFFRE_SHOTS.module} sizes="(max-width: 1023.98px) 100vw, 560px" />
          {/* Le bord gauche est fondu vers le fond de la section : sans ce
              raccord, la capture se termine sur une arête verticale nette au
              milieu d'une page qui n'en a aucune autre. */}
          <span className="of-mediafeather" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

/* ── 3. Le matériel — la bande en diptyque ───────────────────── */

/**
 * ═══ L'ARGUMENT PROMU DEPUIS L'INVENTAIRE DES REFUS ═══
 *
 * « Nous ne vendons pas de matériel propriétaire » était le quatrième bloc d'une
 * section intitulée « Et ce que nous ne faisons pas », entre les frais bancaires
 * et un devis d'identité visuelle. Ce n'est pas une limite : c'est l'écart le
 * plus brutal de tout le marché. La concurrence installée impose ses bornes
 * propriétaires à quatre chiffres et un restaurateur qui change de logiciel doit
 * tout racheter ; nous, une tablette du commerce.
 *
 * Il devient donc une BANDE PLEINE LARGEUR en diptyque : un aplat sombre à
 * gauche qui porte l'argument et son unique chiffre doré, la photo à fond perdu
 * jusqu'au bord de l'écran à droite. Quatrième gabarit de la page, et il tombe
 * juste AVANT les services — pour que le lecteur arrive sur les prix
 * d'installation en sachant déjà que le matériel ne lui est ni loué ni imposé.
 *
 * `MATERIEL.zero` est LU dans `HARDWARE_PATHS` : c'est `euros(0)`, avec la même
 * espace insécable que les trois tarifs de la grille.
 */
function Materiel() {
  const { id, badge, title, lead } = offreSection("materiel");

  return (
    <section className="of-band of-split" id={id}>
      <div className="of-splitcopy">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <p className="of-splitline rv">{MATERIEL.line}</p>

        {/* Le seul « 0 € » de la page, et le seul endroit du site où un zéro
            vend. Il est doré et il est le plus gros chiffre de la bande. */}
        <p className="of-splitfig rv">
          <span className="of-splitnum">{MATERIEL.zero}</span>
          <span className="of-splitnote">{MATERIEL.zeroNote}</span>
        </p>
        <p className="of-splitalt rv">{MATERIEL.installNote}</p>
      </div>

      <div className="of-splitmedia">
        <Photo shot={OFFRE_SHOTS.materiel} decorative sizes="(max-width: 1023.98px) 100vw, 46vw" />
        <span className="of-mediafeather" aria-hidden="true" />
      </div>
    </section>
  );
}

/* ── 4. Les services ─────────────────────────────────────────── */

/**
 * TROIS RANGÉES PLEINE LARGEUR, JAMAIS TROIS CARTES.
 *
 * Même arbitrage que sur la vitrine, et pour la même raison : trois cartes
 * feraient lire la fiche Google comme un troisième choix parmi trois, alors
 * qu'elle est comprise dans la mise en route et qu'elle n'est en concurrence
 * avec rien. Une rangée se lit comme une ligne de devis, ce qui est exactement
 * ce que cette page est.
 *
 * LA FORME NE CHANGE PAS, L'ÉCHELLE SI. Le prix passe de 17 à ~32 px : les trois
 * montants forment alors une colonne qu'on lit SANS lire les rangées, ce qui est
 * précisément ce qu'on fait devant un devis. La fiche Google garde son montant
 * en petit et en blanc — la dorer ferait lire les trois rangées comme trois
 * dépenses, l'inverse exact de ce qu'on dit d'elle.
 *
 * Pas d'image : la section précédente en porte une pleine largeur, la suivante
 * aussi. Trois bandes d'affilée ne feraient plus un rythme.
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
            // `is-compris` suit la donnée : le « montant » de la fiche Google
            // n'est pas un chiffre, la rangée l'affiche discret plutôt que doré.
            <li className={s.compris ? "of-row is-compris rv" : "of-row rv"} key={s.id} style={{ transitionDelay: `${i * 0.08}s` }}>
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

/* ── 5. Toujours compris — la bande sur capture voilée ───────── */

/**
 * ═══ LA SEULE RESPIRATION HORIZONTALE DE LA PAGE ═══
 *
 * Neuf lignes cochées sur DEUX colonnes de 1 200 px, ça fait cinq rangées et
 * 754 px de haut dans la même largeur que les sept autres sections. Sur TROIS
 * colonnes portées à toute la largeur de l'écran, ça fait trois rangées, une
 * gouttière très large, et deux cents pixels de moins. La section gagne en
 * largeur ce qu'elle perd en hauteur : c'est exactement l'échange que la refonte
 * cherche partout.
 *
 * LA CAPTURE EST NOYÉE, PAS AFFICHÉE. `menu.png` est posée à fond perdu à ~14 %
 * d'opacité, dégradée vers le noir en haut et en bas : elle ne s'offre pas à la
 * lecture, elle donne du fond et de la profondeur derrière neuf lignes de texte.
 * C'est pour ça que c'est ELLE et pas une autre — lignes de produits régulières,
 * interrupteurs alignés, aucune zone claire : la capture la plus calme du dépôt
 * est la seule qui supporte d'être réduite à une texture sans devenir du bruit.
 * Décorative, donc muette pour un lecteur d'écran.
 */
function Compris() {
  const { id, badge, title, lead } = offreSection("compris");

  return (
    <section className="of-band of-texture" id={id}>
      <span className="of-bandmedia of-texturemedia">
        <Photo shot={OFFRE_SHOTS.compris} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-textureinner">
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

/* ── 6. Conditions ───────────────────────────────────────────── */

/**
 * LE CONTREPOINT : UNE COLONNE ÉTROITE, ET PAS UN CADRE.
 *
 * Elle arrive juste après une bande pleine largeur sur photo. Lui donner un
 * encadré de 900 px sur fond teinté — ce qu'elle avait — reviendrait à poser une
 * neuvième boîte dans une page qui en comptait vingt-six. Une mesure de 760 px,
 * aucune bordure, aucun fond, aucune image : c'est la respiration.
 *
 * `ENGAGEMENT` EST AFFICHÉE TELLE QUELLE, ET ELLE PASSE DE 15 À ~26 PX. C'est
 * une constante et non une phrase recopiée parce que le site se contredisait à
 * voix haute : le hero annonçait « Sans engagement » pendant que la FAQ
 * répondait « on vous détaille les conditions au moment du devis ». Un prospect
 * qui attrape les deux ne croit plus ni l'une ni l'autre. Le texte que le site a
 * le devoir de ne pas reformuler mérite d'être le plus gros texte non-titre de
 * la page — c'est le seul endroit où l'échelle typographique sert la confiance
 * plutôt que la vente.
 */
function Conditions() {
  const { id, badge, title, lead } = offreSection("conditions");

  return (
    <section className="section of-section of-condsec" id={id}>
      <div className="of-wrap of-condwrap">
        <div className="of-sechead rv">
          <span className="badge">{badge}</span>
          <h2 className="h2">{title}</h2>
          <p className="subheading of-seclead">{lead}</p>
        </div>

        <div className="of-conditions rv">
          <p className="of-engagement">{ENGAGEMENT}</p>
          <p className="of-condition">{BILLING_YEARLY_NOTE}</p>
          <p className="of-policy">{FOUNDER_POLICY}</p>
        </div>
      </div>
    </section>
  );
}

/* ── 7. L'appel de pied de page ──────────────────────────────── */

/**
 * LA PAGE FERME SUR LE PRODUIT, PLUS SUR UNE CARTE.
 *
 * L'appel tenait dans une `.spot` de 1 200 × 338 — la huitième boîte bordée
 * d'une page qui en comptait vingt-six, et la cinquième à porter exactement le
 * même dégradé noir. Il devient une bande letterbox : `board.png`, l'écran
 * d'appel client, est DÉJÀ une composition noire et dorée pleine largeur. Posée
 * à fond perdu sous un voile, elle montre ce qu'on vend au moment précis où l'on
 * demande un rendez-vous. Décorative : les huit lignes de burgers qu'elle
 * affiche n'ont rien à dicter à un lecteur d'écran.
 *
 * LES DEUX SEULS GESTES DU SITE, ET ILS MÈNENT TOUS DEUX À LA LANDING.
 * `CTA_CALLBACK` vers le formulaire de rappel, `CTA_DEMO` vers la démonstration
 * manipulable : deux libellés pour deux destinations, jamais un troisième verbe
 * inventé pour cette page. Les deux href passent par `ancre()`, qui les résout
 * contre `SECTIONS` et LÈVE si la section a disparu — une ancre nue écrite ici
 * résoudrait en `/offres#contact` et ne ferait rien du tout, sans erreur, sans
 * 404, sans une ligne de console.
 */
function AppelFinal() {
  return (
    <section className="of-band of-ctaband">
      <span className="of-bandmedia of-ctamedia">
        <Photo shot={OFFRE_SHOTS.cta} decorative sizes="100vw" />
      </span>
      <span className="of-bandveil" aria-hidden="true" />

      <div className="of-bandinner of-ctainner rv">
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
    </section>
  );
}

/**
 * La page, dans l'ordre d'une vérification : ce que contient une formule → ce
 * que l'Atelier facture autour → ce qui se vend à part → ce que le matériel ne
 * coûte pas → ce qu'on fait autour → ce qui est toujours compris → à quoi l'on
 * s'engage → comment nous joindre. L'Atelier suit les formules parce que c'est
 * là que le lecteur compare des mensualités — sa bande dit les montants, sa
 * page dit le reste.
 *
 * L'INVENTAIRE DES REFUS A DISPARU D'ENTRE « toujours compris » ET LE POINT DE
 * CONVERSION. La dernière chose que le lecteur lisait avant qu'on lui demande
 * son numéro était quatre paragraphes commençant par une négation.
 *
 * Deux gabarits de même forme ne se suivent jamais, et cette fois c'est
 * vérifiable : bande / grille / tableau compact / panneau débordant / bande /
 * rangées / bande / colonne nue / bande.
 */
export function OffresBody() {
  return (
    <>
      <PageHead />
      <Formules />
      <CommerceOffers />
      <Atelier />
      <Module />
      <Materiel />
      <Services />
      <Compris />
      <Conditions />
      <AppelFinal />
    </>
  );
}
