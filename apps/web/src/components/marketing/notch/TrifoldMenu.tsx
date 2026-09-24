import Image from "next/image";
import styles from "./trifold.module.css";

export type PaperView = "auto" | "open" | "closed";

function Seal() {
  return <div className={styles.seal}><span>LE GOÛT</span><b>des bonnes<br />choses.</b><span>À VOTRE IMAGE</span></div>;
}

function Dish({ name, detail, price }: { name: string; detail: string; price: string }) {
  return <div className={styles.dish}><div><strong>{name}</strong><span>{price}</span></div><p>{detail}</p></div>;
}

/** Six printed faces. Keep the hinges free of filters/opacity/overflow: those flatten CSS 3D. */
export function TrifoldMenu({ view, playing, animationStart }: { view: PaperView; playing: boolean; animationStart: "cover" | "interior" }) {
  return <div className={styles.scene} data-view={view} data-running={playing} data-start={animationStart} aria-hidden="true">
    <div className={styles.groundShadow} />
    <div className={styles.camera}>
      <div className={styles.paper}>
        <div className={`${styles.leaf} ${styles.center}`}>
          <div className={`${styles.face} ${styles.front} ${styles.classics}`}>
            <div className={styles.runningHead}><span>LA CARTE</span><span>02</span></div>
            <h3>Les grands<br /><em>classiques.</em></h3>
            <p className={styles.intro}>Les recettes qu’on aime.<br />Le plaisir d’y revenir.</p>
            <div className={styles.dishes}>
              <Dish name="Le burger signature" detail="Bœuf grillé, cheddar affiné, sauce maison." price="14" />
              <Dish name="La salade César" detail="Poulet doré, parmesan, croûtons." price="13" />
              <Dish name="Le plat du moment" detail="Une recette au fil des saisons." price="16" />
            </div>
            <div className={styles.menuNote}><span>LE BON ACCORD</span><p>Votre plat préféré.<br />L’accompagnement qui va avec.</p></div>
            <div className={styles.pageFoot}><span>CUISINE & CONVIVIALITÉ</span><span>02 — 03</span></div>
          </div>
          <div className={`${styles.face} ${styles.back} ${styles.backCover}`}>
            <span className={styles.smallCaps}>ON SE RETROUVE À TABLE.</span>
            <Seal />
            <p>Une carte qui vous ressemble.<br />Un plaisir qui se partage.</p>
            <span className={styles.backSignature}>VOTRE RESTAURANT</span>
          </div>
        </div>

        <div className={`${styles.leaf} ${styles.left}`}>
          <div className={`${styles.face} ${styles.front} ${styles.starters}`}>
            <div className={styles.runningHead}><span>POUR COMMENCER</span><span>01</span></div>
            <h3>L’envie<br /><em>de partager.</em></h3>
            <div className={styles.bowlArt}><Image src="/illustrations/food/bowl.svg" unoptimized alt="" width={240} height={165} /></div>
            <div className={styles.starterDishes}>
              <Dish name="La fraîcheur du jour" detail="Des couleurs, du croquant, de la saison." price="8" />
              <Dish name="À partager" detail="Une assiette à poser au centre de la table." price="12" />
            </div>
            <div className={styles.pageFoot}><span>LE PLAISIR COMMENCE ICI</span><span>01</span></div>
          </div>
          <div className={`${styles.face} ${styles.back} ${styles.signature}`}>
            <span className={styles.smallCaps}>LA RECETTE SIGNATURE</span>
            <h3>Simplement<br /><em>généreux.</em></h3>
            <div className={styles.burgerArt}><Image src="/illustrations/food/smash-burger.svg" unoptimized alt="" width={240} height={165} /></div>
            <p>Du caractère.<br />Jusqu’à la dernière bouchée.</p>
            <div className={styles.pageFoot}><span>À SAVOURER</span><span>04</span></div>
          </div>
        </div>

        <div className={`${styles.leaf} ${styles.right}`}>
          <div className={`${styles.face} ${styles.front} ${styles.desserts}`}>
            <div className={styles.runningHead}><span>POUR PROLONGER</span><span>03</span></div>
            <h3>La touche<br /><em>gourmande.</em></h3>
            <div className={styles.dessertArt}><Image src="/illustrations/food/tiramisu-caramel.svg" unoptimized alt="" width={240} height={165} /></div>
            <div className={styles.dessertDishes}>
              <Dish name="Le tiramisu" detail="Une douceur, tout simplement." price="6" />
              <Dish name="Le café gourmand" detail="Pour faire durer le moment." price="7" />
            </div>
            <div className={styles.pageFoot}><span>ENCORE UN INSTANT</span><span>03</span></div>
          </div>
          <div className={`${styles.face} ${styles.back} ${styles.cover}`}>
            <div className={styles.coverBorder} />
            <div className={styles.coverTop}><span>VOTRE RESTAURANT</span><span>CUISINE & CONVIVIALITÉ</span></div>
            <div className={styles.coverTitle}>La<br /><em>carte.</em><span>LE GOÛT DES BONNES CHOSES</span></div>
            <Seal />
            <div className={styles.coverBottom}><span>SUR PLACE · À EMPORTER</span><i /> <span>À VOTRE IMAGE.</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
