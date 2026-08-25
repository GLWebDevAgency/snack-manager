"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CATALOGUE,
  DEMO_APPS,
  DEMO_FALLBACK,
  DEMO_MOBILE_ID,
  PILOTE_SIGNATURE,
  section,
} from "./content";
import { DeviceFrame } from "./DeviceFrame";
import { Chevron } from "./icons";
import { Photo } from "./Photo";

/** Position d'une carte dans la scène 3D : centre, gauche, droite, hors-champ. */
function slot(index: number, current: number, total: number) {
  let off = (((index - current) % total) + total) % total;
  if (off > total / 2) off -= total;
  if (off === 0) return "is-center";
  if (off === -1) return "is-left";
  if (off === 1) return "is-right";
  return "is-hidden";
}

/**
 * En dessous de cette largeur, une caisse conçue pour une tablette de 1280 px
 * n'est plus lisible : on garde l'affiche et on propose le plein écran.
 * Même seuil que la bascule CSS de la section — les deux doivent bouger
 * ensemble, sinon le bouton disparaît sans que l'iframe se démonte.
 *
 * UNE SEULE APPLICATION ÉCHAPPE À CETTE RÈGLE, et c'est tout l'objet de
 * `DEMO_MOBILE_ID` : la commande client est dessinée pour 390 px. La démonter
 * sur un téléphone reviendrait à retirer la démonstration de l'appareil que le
 * prospect tient dans la main — c'est-à-dire à casser la promesse du hero
 * (« Prendre une commande en démo ») sur l'écran où elle a le plus de valeur.
 */
const NARROW = "(max-width: 809.98px)";

/** Index de scène de la seule application qui reste jouable sous `NARROW`. */
const MOBILE_INDEX = DEMO_APPS.findIndex((a) => a.id === DEMO_MOBILE_ID);

/**
 * Au-delà de ce délai, on déclare la démonstration injoignable et on rend la
 * main à l'affiche.
 *
 * Neuf secondes, et c'est une valeur de terrain, pas un chiffre rond : les
 * applications de caisse et de cuisine sont servies par Railway, qui remet un
 * conteneur en route à froid. Trop court, on annoncerait une panne à chaque
 * réveil d'instance ; trop long, le visiteur reste devant un cadre qui ne dit
 * rien — et un cadre qui ne dit rien, sur la section dont dépend toute la
 * page, se lit comme un produit qui n'existe pas.
 */
const LOAD_TIMEOUT_MS = 9000;

/** Où en est l'application embarquée : elle arrive, elle est là, ou elle ne vient pas. */
type LoadState = "loading" | "ready" | "failed";

/**
 * Section 3 — « Passez derrière le comptoir. Prenez une commande. »
 *
 * UNE SEULE BALISE `<section>`, ET C'EST UNE CORRECTION DE FOND.
 *
 * Le composant en déclarait deux : le catalogue (#catalogue), puis la scène de
 * démonstration (#demo). Un inventaire de vingt-huit lignes posé AU-DESSUS de
 * sa preuve est une plaquette — on demande au lecteur de croire une liste,
 * puis on lui montre. Les mêmes lignes posées SOUS le cadre de l'appareil
 * qu'elles décrivent sont une LÉGENDE : chacune se vérifie au doigt dans les
 * trente secondes qui suivent. L'index existait déjà (`CatalogueColumn.demo`
 * pointe l'application) ; il n'y avait qu'à le câbler.
 *
 * ─── LES VRAIES APPLICATIONS, PAS DES CAPTURES ───
 *
 * Les QUATRE applications réelles tournent en `?demo=1` — le visiteur prend
 * une commande, l'encaisse, la voit tomber en cuisine, la recommande en ligne
 * côté client, puis va lire son chiffre d'affaires côté gérant.
 *
 * Les quatre, et pas deux : ce que le restaurateur doit constater ici, c'est
 * autant l'ÉTENDUE que la profondeur. Une application qu'on ne peut qu'admirer
 * en photo à côté de trois qu'on manipule, c'est celle-là qu'on soupçonne de
 * ne pas exister.
 *
 * ─── CE QUI EMPÊCHE LA PAGE DE COULER ───
 *
 * Chaque application pèse de plusieurs centaines de kilo-octets à ~1 Mo de
 * JavaScript. Quatre iframes montées au chargement, ce serait autant sur la
 * page d'accueil. Donc :
 *   1. l'AFFICHE (capture déjà optimisée) s'affiche instantanément ;
 *   2. l'iframe ne se monte QU'AU CLIC, et seulement pour l'app au centre ;
 *   3. changer d'onglet démonte l'iframe précédente (`setLive(null)` dans
 *      `go`) — il n'y a jamais deux applications chargées en mémoire.
 * Tant que le visiteur ne clique pas, la vitrine ne demande pas un octet à
 * Railway ; c'est vérifiable dans l'onglet réseau.
 *
 * ─── LA SECTION DOIT TENIR DEBOUT SANS UNE SEULE IFRAME ───
 *
 * Corollaire non négociable de la position 3 : si aucune application ne se
 * montait jamais — origine tombée, réseau coupé, iframe refusée par le
 * navigateur — la section doit rester COMPLÈTE EN TEXTE. Elle l'est : le
 * chapeau, les pastilles, l'affiche de chaque appareil, la légende de cinq
 * lignes et la signature du pilote ne dépendent d'aucun chargement distant.
 * L'affiche reste posée derrière l'application pendant qu'elle arrive, et
 * `DEMO_FALLBACK` prend le relais si elle ne vient pas. Jamais un cadre blanc.
 *
 * ─── AUCUNE BASE DE DONNÉES ───
 *
 * `?demo=1` fait tourner l'application entièrement dans le navigateur du
 * visiteur — `packages/client-core/src/demo` pour la caisse et la cuisine,
 * `apps/web/src/lib/demo` pour le back-office, `apps/web/src/components/order/
 * demo` pour la commande en ligne. Pas de restaurant de démonstration en
 * base : il n'apparaîtrait pas dans le CRM comme un faux client, deux
 * visiteurs ne se marchent pas dessus, et surtout les commandes jouées ici ne
 * faussent pas la médiane réseau dont sort notre conseil chiffré. Chacun a sa
 * démo, neuve ; un rechargement remet tout à zéro.
 */
export function AppsShowcase() {
  const { badge, title } = section("produit");

  /*
   * On ouvre sur `DEMO_APPS[0]`, la caisse : c'est l'écran auquel un
   * restaurateur s'identifie, et celui dont le bouton « Essayer » doit tomber
   * sous les yeux sans changer d'onglet (voir le commentaire de `DEMO_APPS`).
   * Sur téléphone, l'effet utile n'est pas le même et la scène s'ouvre
   * ailleurs — voir l'effet de bascule plus bas.
   */
  const [current, setCurrent] = useState(0);
  /** Identifiant de l'application actuellement MONTÉE. Une seule à la fois. */
  const [live, setLive] = useState<string | null>(null);
  /** Sort de l'application montée : elle arrive, elle est là, ou elle ne vient pas. */
  const [load, setLoad] = useState<LoadState>("loading");
  const total = DEMO_APPS.length;

  const go = useCallback(
    (i: number) => {
      // Changer d'onglet démonte l'application précédente : sans cela, une
      // visite curieuse laisserait quatre bundles vivants dans l'onglet.
      setLive(null);
      setCurrent(((i % total) + total) % total);
    },
    [total],
  );

  /** Monte une application. L'état de chargement repart de zéro à chaque fois. */
  const mount = useCallback((id: string) => {
    setLoad("loading");
    setLive(id);
  }, []);

  /**
   * Le seuil étroit a-t-il déjà été rencontré ? Voir `settle` ci-dessous : la
   * scène ne se réoriente qu'au PREMIER passage.
   */
  const opened = useRef(false);

  /*
   * ═══ CE QUE LE SEUIL DE 810 px FAIT, ET NE FAIT PLUS ═══
   *
   * DEUX GESTES, un par application concernée, et le second est nouveau.
   *
   * 1. LA SCÈNE S'OUVRE SUR LA COMMANDE CLIENT. Elle est dessinée pour 390 px
   *    et c'est la seule des quatre que les clients du restaurateur
   *    utiliseront vraiment : sur un téléphone, c'est elle qu'il faut avoir
   *    sous le pouce. Une fois seulement — se réorienter à chaque changement
   *    de largeur arracherait au visiteur l'onglet qu'il vient de choisir,
   *    fenêtre qu'on redimensionne ou téléphone qu'on tourne.
   *
   * 2. TOUTE AUTRE APPLICATION MONTÉE EST DÉMONTÉE. Le bouton « Essayer » des
   *    trois autres est masqué en CSS sous ce seuil, mais une fenêtre qu'on
   *    rétrécit laisserait sinon une caisse de 1280 px écrasée dans 375 px.
   *    La commande client, elle, est ÉPARGNÉE : la démonter reviendrait à
   *    retirer la démonstration de l'appareil que le prospect tient dans la
   *    main, c'est-à-dire à casser la promesse du hero là où elle vaut le plus.
   *
   * Tout se décide APRÈS l'hydratation, jamais au rendu : le serveur ne
   * connaît pas la largeur de la fenêtre, et un `useState` initialisé sur
   * `matchMedia` produirait deux arbres différents.
   */
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const settle = () => {
      if (!mq.matches) return;
      if (!opened.current && MOBILE_INDEX >= 0) {
        opened.current = true;
        setCurrent(MOBILE_INDEX);
      }
      setLive((id) => (id === DEMO_MOBILE_ID ? id : null));
    };
    settle();
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, []);

  /*
   * LE CHRONOMÈTRE DU REPLI.
   *
   * `onError` ne suffit pas : une iframe dont l'origine ne répond pas ne lève
   * pas toujours d'erreur — elle reste simplement vide, indéfiniment. On borne
   * donc l'attente dans le temps. Le compte repart à chaque montage (`live`
   * change), et s'arrête dès que l'application a signalé sa présence.
   */
  useEffect(() => {
    if (!live || load !== "loading") return;
    const t = window.setTimeout(() => setLoad("failed"), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [live, load]);

  const app = DEMO_APPS[current];
  /*
   * La légende de l'application au centre. `CATALOGUE` est une table à quatre
   * colonnes dont les `demo:` pointent les index de `DEMO_APPS` : c'est cet
   * index, et lui seul, qui apparie une colonne à son appareil.
   */
  const legend = CATALOGUE.find((c) => c.demo === current);

  return (
    <section className="section demo-section" id="produit">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 700 }}>
        {title}
      </h2>
      <p className="body-text demo-sub rv">
        Les quatre applications sont <strong>manipulables ici même</strong> :
        prenez une commande, suivez-la en cuisine, commandez depuis votre
        téléphone, ouvrez le back-office. Tout tourne dans{" "}
        <span className="kw">votre navigateur</span> — rien n&apos;est
        enregistré, un rechargement remet la démo à zéro.
      </p>

      <div className="demo-pills rv">
        {DEMO_APPS.map((a, i) => (
          <button
            type="button"
            aria-pressed={i === current}
            className={i === current ? "demo-pill is-on" : "demo-pill"}
            key={a.id}
            onClick={() => go(i)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/*
       * `data-device` sert au petit écran : une tablette couchée et un
       * téléphone debout n'ont pas la même hauteur utile, et une scène
       * dimensionnée pour le plus grand des deux laisserait un trou noir
       * sous l'autre. C'est aussi lui qui rend au téléphone, sous 810 px, la
       * hauteur qu'il faut pour être JOUÉ et pas seulement regardé.
       * Sur grand écran la scène garde une hauteur unique.
       */}
      <div className="demo-stage rv" data-device={app.device}>
        <div className="demo-track">
          {DEMO_APPS.map((a, i) => {
            const position = slot(i, current, total);
            const isCenter = position === "is-center";
            const isLive = isCenter && live === a.id && a.live !== undefined;
            /* L'iframe n'est dans le DOM que tant qu'on l'espère encore. */
            const isMounted = isLive && load !== "failed";
            const isPending = isMounted && load === "loading";
            const isFailed = isLive && load === "failed";
            /* La seule application qu'on laisse jouer sous 810 px. */
            const playsNarrow = a.id === DEMO_MOBILE_ID;
            return (
              <div
                className={`demo-card ${position}`}
                key={a.id}
                aria-hidden={!isCenter}
              >
                <DeviceFrame device={a.device}>
                  {/*
                   * L'AFFICHE RESTE POSÉE DERRIÈRE L'APPLICATION, TOUJOURS.
                   *
                   * Elle ne se retire pas quand la démo démarre, et ce n'est pas
                   * un oubli : l'iframe monte avec un fond opaque et met une
                   * seconde ou deux à peindre son premier écran. Sans affiche
                   * dessous, ce délai est un rectangle noir — le cadre blanc que
                   * cette section n'a pas le droit d'afficher. L'application
                   * arrive donc EN FONDU par-dessus une capture déjà là
                   * (`.dv-live.is-pending`), et si elle ne vient pas, il n'y a
                   * rien à restaurer : l'écran réel n'a jamais quitté le cadre.
                   */}
                  <span
                    className="demo-poster"
                    aria-hidden={isMounted ? true : undefined}
                  >
                    <Photo
                      shot={a.shot}
                      sizes={
                        a.device === "phone"
                          ? "(max-width: 810px) 80vw, 360px"
                          : "(max-width: 810px) 92vw, min(1240px, 92vw)"
                      }
                    />
                  </span>

                  {isMounted && a.live ? (
                    /*
                     * ─── LE BAC À SABLE, ET CE QU'IL TIENT VRAIMENT ───
                     *
                     * Pas d'`allow-top-navigation` : quelle que soit son
                     * origine, l'application embarquée ne peut pas emmener
                     * la page d'accueil ailleurs — le navigateur refuse la
                     * navigation et le dit en console. Pas d'`allow-popups`
                     * non plus : elle ne peut pas davantage ouvrir un onglet.
                     * Les deux sont vérifiés au navigateur, pas supposés.
                     *
                     * `allow-same-origin` n'est pas un confort : sans lui le
                     * document reçoit une origine opaque, `localStorage` et
                     * `document.cookie` lèvent une SecurityError, et les
                     * quatre applications tombent au premier rendu (le
                     * back-office lit `localStorage` dès son squelette).
                     *
                     * Conséquence assumée pour les deux démonstrations
                     * servies par CETTE origine — le back-office et la
                     * commande en ligne, reconnaissables à leur `href`
                     * relatif : elles redeviennent de plein droit du même
                     * domaine que la vitrine, donc capables d'en lire le
                     * DOM (le navigateur le signale en console). Ce sont nos
                     * propres pages, construites au même build, servies
                     * depuis le même dépôt : elles n'obtiennent rien qu'un
                     * `<script>` de la page d'accueil n'ait déjà. Le jour où
                     * une démonstration embarquerait du contenu tiers, elle
                     * devra passer par une origine à elle — pas par un
                     * assouplissement d'attribut.
                     */
                    <iframe
                      className={isPending ? "dv-live is-pending" : "dv-live"}
                      src={a.live.href}
                      title={a.live.title}
                      loading="lazy"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                      /*
                       * `onLoad` se déclenche aussi sur la page d'erreur d'un
                       * navigateur, et l'origine étant distante on ne peut pas
                       * inspecter le document pour trancher. C'est la limite
                       * assumée de cette détection : elle attrape l'origine
                       * qui ne répond pas (chronomètre) et le chargement
                       * refusé (`onError`), pas une page servie en 502. Les
                       * quatre adresses sont les nôtres et sont surveillées —
                       * voir le commentaire de `DEMO_ORIGINS`.
                       */
                      onLoad={() =>
                        setLoad((s) => (s === "loading" ? "ready" : s))
                      }
                      onError={() => setLoad("failed")}
                    />
                  ) : null}

                  {isPending ? (
                    <span className="demo-loading">
                      Chargement de la démonstration…
                    </span>
                  ) : null}

                  {isFailed && a.live ? (
                    /*
                     * LE REPLI, ET IL EST ÉCRIT AVANT LE RESTE.
                     *
                     * On ne masque pas la panne et on ne laisse pas le visiteur
                     * devant un cadre muet : on nomme ce qui se passe, l'écran
                     * réel est déjà sous les yeux, et le lien vers
                     * l'application en vraie grandeur reste offert — il ne
                     * dépend pas de l'iframe qui vient d'échouer.
                     */
                    <div className="demo-fallback">
                      <p className="demo-fallbacktext">{DEMO_FALLBACK}</p>
                      <a
                        className="demo-trybtn demo-tryout"
                        href={a.live.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {a.live.ctaOut}
                      </a>
                    </div>
                  ) : null}

                  {isCenter && a.live && !isLive ? (
                    <div
                      className={
                        playsNarrow ? "demo-cta plays-narrow" : "demo-cta"
                      }
                    >
                      <button
                        type="button"
                        className="demo-trybtn demo-try"
                        onClick={() => mount(a.id)}
                      >
                        {a.live.cta}
                      </button>
                      {/*
                       * LE PLEIN ÉCRAN EST PROPOSÉ D'EMBLÉE, À TOUTE LARGEUR.
                       *
                       * Il ne servait qu'en dessous de 810 px, quand la démo
                       * dans la page devenait impossible. Mais l'application
                       * embarquée est maintenant RÉDUITE — la cuisine tourne
                       * en 1920 px dans un cadre de ~1240 — donc son texte
                       * courant est plus petit qu'il ne l'est sur le mural.
                       * Le visiteur qui veut LIRE doit trouver la sortie sans
                       * la deviner : elle est là, à côté d'« Essayer », et à
                       * nouveau sous le cadre pendant que la démo tourne.
                       */}
                      <a
                        className="demo-trybtn demo-tryout"
                        href={a.live.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {a.live.ctaOut}
                      </a>
                      <span className="demo-ctanote">
                        Démo dans votre navigateur · aucune donnée réelle
                      </span>
                    </div>
                  ) : null}

                  {isCenter ? null : (
                    <button
                      type="button"
                      className="demo-focusbtn"
                      aria-label={`Voir ${a.label}`}
                      tabIndex={-1}
                      onClick={() => go(i)}
                    />
                  )}
                </DeviceFrame>

                {/*
                 * LA CONSIGNE EST TOUJOURS LÀ, ET ELLE PARLE DE CETTE APP.
                 *
                 * Deux raisons, une de fond et une de géométrie.
                 *
                 * De fond : avant le clic elle annonce ce qu'on va pouvoir
                 * faire, après le clic elle dit par où commencer. Elle est
                 * propre à l'application — inviter à « toucher un produit »
                 * devant un back-office ne voudrait rien dire, et devant
                 * celui-ci on invite à parcourir le menu de gauche, puisque
                 * c'est l'étendue qu'il s'agit de constater.
                 *
                 * De géométrie : cette ligne réserve sa hauteur (`--dv-hint`
                 * dans marketing.css) que la démo tourne ou non. Sans elle,
                 * la hauteur disponible pour l'appareil changerait au clic —
                 * le cadre sursauterait, et le rapport d'aspect de l'écran
                 * ne pourrait plus être calculé d'avance.
                 *
                 * Elle est masquée sous 810 px, où il n'y a rien à expliquer —
                 * SAUF sous la commande client, qui s'y joue vraiment et doit
                 * donc y garder son bouton « Arrêter la démo ».
                 */}
                <p className={isLive ? "demo-hint is-live" : "demo-hint"}>
                  {a.live ? (
                    <>
                      <span className="demo-hintdot" aria-hidden="true" />
                      <span className="demo-hinttext">{a.live.hint}</span>
                      {isLive ? (
                        <>
                          {/*
                           * L'application tourne à sa vraie résolution, mais
                           * RÉDUITE pour tenir dans le cadre. Ce lien la rend
                           * à sa taille réelle — c'est le geste de celui qui
                           * veut lire, pas seulement regarder.
                           */}
                          <a
                            className="demo-hintfull"
                            href={a.live.href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Voir en vraie grandeur ↗
                          </a>
                          <button
                            type="button"
                            className="demo-stop"
                            onClick={() => setLive(null)}
                          >
                            Arrêter la démo
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </p>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="demo-arrow prev"
          aria-label="Application précédente"
          onClick={() => go(current - 1)}
        >
          <Chevron size={18} dir="left" />
        </button>
        <button
          type="button"
          className="demo-arrow next"
          aria-label="Application suivante"
          onClick={() => go(current + 1)}
        >
          <Chevron size={18} />
        </button>
      </div>

      {/*
       * LA LÉGENDE — LE CATALOGUE, DESCENDU SOUS SA PREUVE.
       *
       * Elle suit l'appareil au centre : une phrase qui dit ce qu'est
       * l'application, les cinq lignes de sa colonne de `CATALOGUE`, et
       * l'appareil sur lequel elle vit dans le restaurant.
       *
       * POURQUOI SOUS LA SCÈNE ET NON DANS LA CARTE. Chaque carte est
       * positionnée en absolu, à hauteur FIXE (`--card-h`), et les deux cartes
       * de côté sont tournées dans l'espace : une liste de cinq lignes glissée
       * là-dedans serait rendue trois fois, dont deux fois de profil et
       * illisible, et ferait sauter le calcul de hauteur dont dépend le rapport
       * d'aspect de l'écran. Posée ici, elle touche le bas du cadre, ne se lit
       * qu'une fois, et reste au même endroit d'une application à l'autre.
       *
       * `aria-live` : le contenu change sans que le focus bouge quand on
       * change de pastille — sans quoi un lecteur d'écran annoncerait le
       * changement d'onglet sans jamais dire ce qui l'a remplacé.
       */}
      <div className="demo-legend rv" aria-live="polite">
        {/*
         * La clé sur l'application, et non sur le contenu : elle force React à
         * remonter ce bloc quand on change de pastille, ce qui relance
         * l'animation d'entrée. Sans elle, cinq lignes se remplaceraient par
         * cinq autres sans un mouvement — un changement muet, qui se lit comme
         * une page figée plutôt que comme une légende qui suit l'appareil.
         */}
        <div className="demo-legendbody" key={app.id}>
          <p className="demo-legendlead">
            <strong>{app.lead}</strong>
            {app.body}
          </p>
          {legend ? (
            <>
              <ul className="demo-legenditems">
                {legend.items.map((item, k) => (
                  <li className="demo-legenditem" key={k}>
                    <span className="demo-legenddot" aria-hidden="true" />
                    <span>
                      {item.pre}
                      {item.strong ? <strong>{item.strong}</strong> : null}
                      {item.post}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="demo-legenddevice">{legend.device}</p>
            </>
          ) : null}
        </div>
      </div>

      {/*
       * La signature du pilote : UNE ligne, en pied de section. Founder est en
       * dixième position sur onze — sans elle, le visiteur défile cinq mille
       * pixels sans une preuve d'existence. Ce qu'on affirme ici, c'est
       * l'EXISTENCE du restaurant ; sa VOIX reste en section 10, à l'endroit
       * où l'on se demande à qui on donne son numéro.
       */}
      <p className="demo-signature rv">{PILOTE_SIGNATURE}</p>
    </section>
  );
}
