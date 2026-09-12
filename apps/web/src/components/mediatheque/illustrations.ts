import { assets, renderArtwork } from "@sm/design-assets";
import { MEDIA_LARGEUR_CIBLE } from "@sm/contracts";

/** Mapping de présentation explicite ; aucun nom de produit n'est interprété. */
export const FAMILLES_ILLUSTRATIONS = [
  { id: "burgers", nom: "Burgers", icone: "burger", cles: ["burger", "double", "black", "chicken", "smash-burger"] },
  { id: "sandwichs", nom: "Snacks et kebabs", icone: "wrap", cles: ["wrap", "tacos", "kebab", "shawarma-plate", "panini", "bowl"] },
  { id: "pizzas", nom: "Pizzas", icone: "pizza", cles: ["pizza-margherita", "pizza-chicken", "pizza-vegetarian", "pizza-slice", "calzone"] },
  { id: "croustillants", nom: "Croustillants", icone: "fries", cles: ["fries", "loaded-fries", "tenders", "nuggets", "croustille", "nuggets-croustille", "wings", "samosa"] },
  { id: "thai", nom: "Cuisine thaï", icone: "thai", cles: ["pad-thai", "thai-noodles", "thai-rice", "thai-curry", "spring-rolls"] },
  { id: "boissons", nom: "Boissons", icone: "cup", cles: ["lemonade", "cola", "orange-can", "iced-tea", "water", "coffee"] },
  { id: "desserts", nom: "Desserts", icone: "dessert", cles: ["tiramisu", "tiramisu-pistachio", "tiramisu-caramel", "tiramisu-berry", "cookie", "brownie"] },
] as const;

export const illustrations = assets;
const normaliser = (texte: string) => texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();

export function filtrerIllustrations(recherche: string, famille = "toutes") {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  const choix = FAMILLES_ILLUSTRATIONS.find((f) => f.id === famille);
  return assets.filter((illustration) => {
    if (famille !== "toutes" && (!choix || !(choix.cles as readonly string[]).includes(illustration.id))) return false;
    const groupe = FAMILLES_ILLUSTRATIONS.find((f) => (f.cles as readonly string[]).includes(illustration.id));
    const texte = normaliser(`${illustration.label} ${illustration.id} ${groupe?.nom ?? ""}`);
    return mots.every((mot) => texte.includes(mot));
  });
}

function illustrationConnue(id: string) {
  const illustration = assets.find((asset) => asset.id === id);
  if (!illustration) throw new Error("Cette illustration n'est pas disponible.");
  return illustration;
}

/** Un SVG du registre versionné uniquement, jamais un fichier ou une URL saisis. */
export function svgIllustration(id: string): string {
  illustrationConnue(id);
  return renderArtwork(id, `mediatheque-${id}`);
}

export function apercuIllustration(id: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgIllustration(id))}`;
}

/**
 * Prépare un PNG transparent pour le dépôt existant. Les octets passent ensuite
 * par reduirePourEnvoi et POST /medias : formats, quota et dédoublonnage inchangés.
 * La largeur stable et les identifiants SVG déterministes évitent de varier
 * inutilement le contenu à chaque sélection de la même illustration.
 */
export async function creerFichierIllustration(id: string): Promise<File> {
  const xml = svgIllustration(id);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Impossible de préparer cette illustration. Réessayez."));
      image.src = url;
    });
    const canevas = document.createElement("canvas");
    canevas.width = MEDIA_LARGEUR_CIBLE;
    canevas.height = Math.round(MEDIA_LARGEUR_CIBLE * 165 / 240);
    const contexte = canevas.getContext("2d");
    if (!contexte) throw new Error("Votre navigateur ne peut pas préparer cette illustration.");
    contexte.drawImage(image, 0, 0, canevas.width, canevas.height);
    const png = await new Promise<Blob | null>((resolve) => canevas.toBlob(resolve, "image/png"));
    if (!png || png.type !== "image/png") throw new Error("L'illustration n'a pas pu être préparée. Réessayez.");
    return new File([png], `illustration-${id}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
