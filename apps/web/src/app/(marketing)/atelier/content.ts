import type { Shot } from "@/components/marketing/content";

export const ATELIER_SECTIONS = [
  { id: "menus-atelier", nav: "Menus papier & TV", badge: "Vos supports", title: "Une création adaptée à votre carte.", lead: "Choisissez le travail à nous confier. Chaque prestation précise les supports, les éléments à fournir et les retours compris. Prix HT, conception uniquement." },
  { id: "mises-a-jour", nav: "Mises à jour & conseil", badge: "Faire évoluer", title: "La bonne intervention, au bon moment.", lead: "Une retouche ponctuelle pour une carte qui change peu. Une analyse lorsque vous souhaitez préparer vos prochaines mises en avant." },
  { id: "parcours", nav: "La démarche", badge: "Trois étapes", title: "De votre carte au support validé.", lead: "Un brief précis, un devis détaillé et vos validations aux moments utiles." },
  { id: "services", nav: "Autres services", badge: "L’Atelier", title: "Une identité cohérente autour de votre restaurant.", lead: "Identité, site, fiche Google et réseaux sociaux peuvent se choisir séparément, avec ou sans notre caisse." },
  { id: "questions", nav: "Vos questions", badge: "Avant de choisir", title: "Parlons concret.", lead: "Impression, retouches, données et logiciels : chaque prestation garde un rôle clair." },
] as const;

export const ATELIER_SOMMAIRE = ATELIER_SECTIONS.map(({ id, nav }) => ({ href: `#${id}`, label: nav }));

export const ATELIER_SHOTS = {
  hero: { src: "/photos/libre/comptoir-vignette.webp", alt: "" },
  cta: { src: "/photos/libre/blog-telephone-main-nuit.webp", alt: "" },
} satisfies Record<string, Shot>;

export const PARCOURS_STEPS = [
  { when: "01 — Votre besoin", title: "Nous regardons votre carte.", line: "Votre identité, vos plats, vos formats, vos écrans et votre prochain changement. Nous vérifions aussi les fichiers disponibles et le niveau d’accompagnement souhaité." },
  { when: "02 — Votre proposition", title: "Le périmètre est écrit.", line: "Vous recevez les supports prévus, le prix, les éléments à fournir, les retours et le calendrier. La conception, l’impression, la livraison et le matériel restent des lignes distinctes." },
  { when: "03 — Votre validation", title: "Vous approuvez le résultat.", line: "Vous validez textes, prix, visuels et bon à tirer avant l’impression. Pour les TV, nous vérifions l’aperçu et préparons la boucle convenue sur les fonctions existantes." },
] as const;

export const ATELIER_FAQ = [
  { q: "Est-ce adapté à ma spécialité de restaurant ?", a: "Nous partons de votre carte et de votre mode de service : au comptoir, à emporter ou à table. Japonais, thaï, brasserie, pizzeria ou restauration rapide : la présentation suit votre identité et les informations dont vos clients ont besoin. Une TV en salle reste un choix, pas une obligation." },
  { q: "L’impression est-elle comprise dans le prix ?", a: "Les tarifs affichés rémunèrent la conception. L’impression et la livraison sont présentées séparément, au coût de l’imprimeur, après validation d’un devis correspondant au format, au papier, aux finitions et à la quantité retenus. Une éventuelle coordination de fabrication est chiffrée à part." },
  { q: "Que faut-il nous fournir ?", a: "Votre carte, les prix, textes, logo et photographies que vous souhaitez utiliser. Nous précisons les références, variantes et formules avant de confirmer un forfait. Les informations sur les ingrédients et les mentions de votre carte sont validées par votre restaurant. Une collecte ou une rédaction importante fait l’objet d’un périmètre adapté." },
  { q: "Que comprend une petite modification ?", a: "Un prix ou un texte existant à corriger, par exemple. Le lot couvre jusqu’à dix changements simples, dans une limite de 45 minutes de production et coordination au total, avec un retour compris. Une nouvelle mise en page, un nouveau format ou une restructuration de la carte nécessite un autre devis, présenté avant le travail." },
  { q: "Dois-je prendre Boost pour avoir des menus TV ?", a: "Non. Les fonctions TV existantes sont comprises dans les trois suites Service, Gestion et Boost. La prestation de mise en scène rémunère la préparation de vos compositions. Le téléviseur, le lecteur éventuel et l’installation physique restent distincts et leur compatibilité est vérifiée." },
  { q: "Puis-je modifier seul mes menus papier ?", a: "Le Studio autonome pour préparer des cartes papier est en préparation. Aujourd’hui, vous pouvez nous confier une création ou des modifications ponctuelles. Les fonctions actuelles des suites permettent déjà d’administrer votre carte et de configurer les compositions TV disponibles." },
  { q: "L’analyse identifie-t-elle automatiquement mes plats les plus rentables ?", a: "L’analyse est réalisée avec vous à partir de données exploitables. Nous distinguons popularité et contribution estimée ; les coûts matière demandent des recettes, portions et achats renseignés. Sans ces données, les recommandations portent sur les ventes et la présentation. Aucun gain de chiffre d’affaires n’est garanti." },
  { q: "Puis-je garder mon graphiste, mon imprimeur et ma caisse ?", a: "Oui. Nous vérifions les fichiers et les formats disponibles avant reprise. Un export de caisse exploitable peut servir à une analyse ponctuelle. Une synchronisation automatique avec une caisse tierce doit être étudiée séparément. Les prestations papier peuvent se choisir sans suite Snack Manager." },
  { q: "Que deviennent mes fichiers après la prestation ?", a: "Les fichiers livrés et leurs droits d’utilisation sont précisés au devis. Vous conservez les livrables payés selon ces conditions. Une carte déjà imprimée doit faire l’objet d’une nouvelle édition pour que des changements apparaissent sur le papier." },
] as const;
