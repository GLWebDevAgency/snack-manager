"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOGUE, DEMO_APPS } from "./content";
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
 */
const NARROW = "(max-width: 809.98px)";

/**
 * Catalogue app par app + scène de démonstration 3D.
 *
 * Les deux sections partagent un état (`current`) : chaque colonne du
 * catalogue porte son lien « Essayer … en démo → » qui fait pivoter la scène
 * sur la bonne application puis y amène le lecteur — c'est le `smDemoGo()`
 * global de la maquette, remplacé ici par un `useState` et une ref.
 *
 * ─── LES VRAIES APPLICATIONS, PAS DES CAPTURES ───
 *
 * La maquette embarquait des iframes ; une étape intermédiaire les avait
 * remplacées par des captures statiques. On revient aux cadres, avec les
 * QUATRE applications réelles en `?demo=1` — le visiteur prend une commande,
 * l'encaisse, la voit tomber en cuisine, la recommande en ligne côté client,
 * puis va lire son chiffre d'affaires côté gérant.
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
  /*
   * On ouvre sur `DEMO_APPS[0]`, la caisse : c'est l'écran auquel un
   * restaurateur s'identifie, et celui dont le bouton « Essayer » doit tomber
   * sous les yeux sans changer d'onglet (voir le commentaire de `DEMO_APPS`).
   */
  const [current, setCurrent] = useState(0);
  /** Identifiant de l'application actuellement MONTÉE. Une seule à la fois. */
  const [live, setLive] = useState<string | null>(null);
  /**
   * Où le lecteur doit atterrir : SUR L'APPAREIL, pas sur le chapeau.
   *
   * La ref était posée sur la `<section>` et visait son DÉBUT. Le lien
   * « Essayer la caisse en démo → » amenait donc le lecteur en haut du
   * chapeau — badge, titre, paragraphe, pastilles — et l'appareil commençait
   * 590 px plus bas, hors champ. Celui qui venait de cliquer sur « essayer »
   * devait chercher ce qu'il avait demandé.
   *
   * L'appareil occupe désormais presque toute la hauteur de fenêtre (voir
   * `--card-h` dans marketing.css) : on le CENTRE, et il tient alors en entier
   * à l'écran, bouton « Essayer » compris — celui-ci est posé en bas de
   * l'affiche, et un cadrage par le haut le laisserait sous la barre collante
   * de l'offre fondateur. Les pastilles passent au-dessus du champ, mais on ne
   * perd pas la navigation : les flèches ‹ › vivent dans la scène elle-même.
   */
  const stageRef = useRef<HTMLDivElement>(null);
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

  const goAndScroll = useCallback(
    (i: number) => {
      go(i);
      stageRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center",
      });
    },
    [go],
  );

  /*
   * Passage en petit écran alors qu'une démo tourne : on démonte. Le bouton
   * « Essayer » est masqué en CSS sous ce seuil, mais une fenêtre qu'on rétrécit
   * laisserait sinon une caisse de 1280 px écrasée dans 375 px.
   */
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const settle = () => {
      if (mq.matches) setLive(null);
    };
    settle();
    mq.addEventListener("change", settle);
    return () => mq.removeEventListener("change", settle);
  }, []);

  const app = DEMO_APPS[current];

  return (
    <>
      <section className="section cat-section" id="catalogue">
        <span className="badge">Dans le détail</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 680 }}>
          Tout ce que la plateforme couvre, app par app
        </h2>
        <p className="body-text cat-sub rv">
          Pas une plaquette : chaque ligne ci-dessous existe déjà dans les applications — descendez d&apos;une section
          pour les voir en vrai.
        </p>

        <div className="cat-grid">
          {CATALOGUE.map((col, i) => (
            <div className="cat-col rv spot" key={col.name} style={{ transitionDelay: `${i * 0.06}s` }}>
              <div className="cat-colhead">
                <p className="cat-appname">{col.name}</p>
                <p className="cat-device">{col.device}</p>
              </div>
              <div className="cat-items">
                {col.items.map((item, k) => (
                  <div className="cat-item" key={k}>
                    <span className="cat-dot" />
                    <span>
                      {item.pre}
                      {item.strong ? <strong>{item.strong}</strong> : null}
                      {item.post}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="cat-demolink" onClick={() => goAndScroll(col.demo)}>
                {col.demoLabel}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section demo-section" id="demo">
        <span className="badge">La démo</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 640 }}>
          Explorez les applications, en démo
        </h2>
        <p className="body-text demo-sub rv">
          Les quatre applications sont <strong>manipulables ici même</strong> : prenez une commande, suivez-la en
          cuisine, commandez en ligne, ouvrez le back-office. Tout tourne dans{" "}
          <span className="kw">votre navigateur</span> — rien n&apos;est enregistré, un rechargement remet la démo à
          zéro.
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
         * sous l'autre. Sur grand écran la scène garde une hauteur unique.
         */}
        <div className="demo-stage rv" data-device={app.device} ref={stageRef}>
          <div className="demo-track">
            {DEMO_APPS.map((a, i) => {
              const position = slot(i, current, total);
              const isCenter = position === "is-center";
              const isLive = isCenter && live === a.id && a.live !== undefined;
              return (
                <div className={`demo-card ${position}`} key={a.id} aria-hidden={!isCenter}>
                  <DeviceFrame device={a.device}>
                    {isLive && a.live ? (
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
                        className="dv-live"
                        src={a.live.href}
                        title={a.live.title}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    ) : (
                      <Photo
                        shot={a.shot}
                        sizes={
                          a.device === "phone"
                            ? "(max-width: 810px) 40vw, 360px"
                            : "(max-width: 810px) 92vw, min(1160px, 92vw)"
                        }
                      />
                    )}

                    {isCenter && a.live && !isLive ? (
                      <div className="demo-cta">
                        <button type="button" className="demo-trybtn demo-try" onClick={() => setLive(a.id)}>
                          {a.live.cta}
                        </button>
                        {/*
                         * LE PLEIN ÉCRAN EST PROPOSÉ D'EMBLÉE, À TOUTE LARGEUR.
                         *
                         * Il ne servait qu'en dessous de 810 px, quand la démo
                         * dans la page devenait impossible. Mais l'application
                         * embarquée est maintenant RÉDUITE — la cuisine tourne
                         * en 1920 px dans un cadre de ~1130 — donc son texte
                         * courant est plus petit qu'il ne l'est sur le mural.
                         * Le visiteur qui veut LIRE doit trouver la sortie sans
                         * la deviner : elle est là, à côté d'« Essayer », et à
                         * nouveau sous le cadre pendant que la démo tourne.
                         */}
                        <a className="demo-trybtn demo-tryout" href={a.live.href} target="_blank" rel="noopener noreferrer">
                          {a.live.ctaOut}
                        </a>
                        <span className="demo-ctanote">Démo dans votre navigateur · aucune donnée réelle</span>
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
                            <button type="button" className="demo-stop" onClick={() => setLive(null)}>
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

        <p className="demo-caption rv" aria-live="polite">
          <strong>{app.lead}</strong>
          {app.body}
          <span className="demo-chips">
            {app.chips.map((c) => (
              <em key={c}>{c}</em>
            ))}
          </span>
        </p>
      </section>
    </>
  );
}
