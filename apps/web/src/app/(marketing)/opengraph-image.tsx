import { ImageResponse } from "next/og";
import { LAITON, markSvg } from "@/components/brand/geometry";

export const alt = "Snack Manager — Plus de commandes, moins de galère, zéro commission";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Image Open Graph générée à la construction : noir profond, accent laiton,
 * la promesse et les 4 modules. Aucune police externe (le rendu utilise la
 * police système de l'environnement de build) pour garder le build hermétique.
 */

/**
 * ═══ LE SIGNE, ET POURQUOI IL PASSE PAR UN DATA-URI ═══
 *
 * C'est CETTE image que LinkedIn, WhatsApp et Slack affichent à chaque
 * partage. Elle portait jusqu'ici un carré arrondi et la lettre « S » —
 * un remplaçant. Le premier contact visuel avec la marque montrait donc
 * autre chose que la marque.
 *
 * Le vrai signe ne peut pas arriver ici comme ailleurs :
 *
 *   · `<LogoMark/>` est un composant client (`useId`) et Satori ne rend pas
 *     de React côté navigateur — il compose du JSX en image, sans DOM.
 *   · `/icon.svg` n'est pas chargeable : le fichier est produit à la
 *     construction et aucun serveur n'écoute quand cette image est rendue.
 *
 * Reste la seule voie que Satori honore vraiment : une image en data-URI.
 * On assemble donc la chaîne SVG depuis `geometry.ts` — le module de tracés
 * purs prévu pour ces consommateurs hors écran — et on l'encode en base64.
 * Le dessin reste ainsi la MÊME source que le favicon et que la vitrine.
 *
 * ═══ 64 PX, ET BICHROME ═══
 *
 * L'image fait 1200 × 630 pixels RÉELS : un signe de 64 px y est très
 * au-dessus du seuil de la gravure micro (20) comme de celui de la garniture
 * au laiton (52). La version pleine — éclair évidé, garniture laiton — est
 * donc la bonne, et elle tient encore à la vignette réduite des messageries.
 *
 * L'éclair est un VIDE : il laisse passer le fond. Il est ici posé sur le
 * noir plein de la carte, jamais sur une photo ni sur un dégradé — la
 * condition que le signe exige partout.
 */
const TAILLE_SIGNE = 64;

const SIGNE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TAILLE_SIGNE}" height="${TAILLE_SIGNE}" ` +
  `viewBox="0 0 32 32">` +
  markSvg({ encre: "#ffffff", garniture: LAITON, masqueId: "og-eclair" }) +
  `</svg>`;

const SIGNE_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SIGNE_SVG).toString("base64")}`;
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000",
          padding: 72,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* `<img>` et non `next/image` : Satori ne connaît que la balise brute. */}
          <img src={SIGNE_DATA_URI} width={TAILLE_SIGNE} height={TAILLE_SIGNE} alt="" />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Snack Manager</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05, maxWidth: 900 }}>
            Plus de commandes. Moins de galère. Zéro commission.
          </div>
          <div style={{ fontSize: 28, color: "#999", maxWidth: 820, lineHeight: 1.4 }}>
            Caisse, cuisine, commande en ligne et back-office — 0 % de commission, à vos couleurs.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {["Caisse", "Cuisine", "Commande en ligne", "Back-office"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "12px 22px",
                borderRadius: 999,
                background: "#111",
                border: "1px solid rgba(255,255,255,.1)",
                fontSize: 22,
                // Le laiton de marque, pris à la source : jamais l'accent d'un
                // tenant, qui n'existe que sous /admin et /r.
                color: LAITON,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
