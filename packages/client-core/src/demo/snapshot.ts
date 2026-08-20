/**
 * INSTANTANÉ DE DÉMONSTRATION — FICHIER GÉNÉRÉ, NE PAS ÉDITER À LA MAIN.
 *
 * D'où il vient : `GET /public/tenants/:slug/menu` et `GET /orders` de l'API
 * Snack Manager, photographiés le 2026-08-19 sur la base de STAGING,
 * puis anonymisés (restaurant « Le Comptoir », prénoms inventés, téléphones
 * de la plage fictive ARCEP, identifiants renumérotés).
 *
 * Comment le régénérer :
 *
 *   pnpm --filter @sm/client-core exec tsx src/demo/generate.ts
 *
 * (API locale sur http://localhost:3001 ; voir `generate.ts` pour les variables.)
 *
 * Forme COMPACTE assumée : les groupes d'options, suppléments et retraits sont
 * déclarés une fois et référencés par clé. `fixture.ts` les recompose en un
 * `Menu` ordinaire au démarrage. Écrit à plat, ce même contenu pèserait 281 ko
 * au lieu de 52 — dans un paquet qui part aussi sur les tablettes en service.
 *
 * 109 produits · 22 catégories · 7 commandes en cours.
 */
import type { MenuSupplement, OptionGroup, Variant } from '../types';

export const SNAPSHOT_TENANT = {
  slug: "le-comptoir",
  name: "Le Comptoir",
  brandColor: "#c9a15a",
  logoUrl: null,
  address: '14 rue des Halles — 76000 Rouen',
  // Plages réservées par l'ARCEP à la fiction : elles ne sonnent nulle part.
  phones: ['01 99 00 12 34', '06 39 98 76 54'],
} as const;

/** Groupes d'options distincts de la carte. */
export const SNAPSHOT_GROUPS: Record<string, OptionGroup> = {
  "g1": {"key":"pain","name":"Pain","type":"single","min":1,"max":1,"choices":[{"key":"pain","name":"Pain","priceDelta":0},{"key":"galette","name":"Galette","priceDelta":50}]},
  "g2": {"key":"sauces","name":"Sauces","type":"multi","min":0,"max":2,"choices":[{"key":"ketchup","name":"Ketchup","priceDelta":0},{"key":"mayonnaise","name":"Mayonnaise","priceDelta":0},{"key":"samourai","name":"Samouraï","priceDelta":0},{"key":"andalouse","name":"Andalouse","priceDelta":0},{"key":"poivre","name":"Poivre","priceDelta":0},{"key":"biggy","name":"Biggy","priceDelta":0},{"key":"blanche-maison","name":"Blanche maison","priceDelta":0},{"key":"harissa","name":"Harissa","priceDelta":0},{"key":"cheesy","name":"Cheesy","priceDelta":0},{"key":"moutarde","name":"Moutarde","priceDelta":0},{"key":"algerienne","name":"Algérienne","priceDelta":0}]},
  "g3": {"key":"pain","name":"Pain","type":"single","min":1,"max":1,"choices":[{"key":"pain","name":"Pain","priceDelta":0},{"key":"galette","name":"Galette","priceDelta":50}],"perVariant":null},
  "g4": {"key":"sauces","name":"Sauces","type":"multi","min":0,"max":2,"choices":[{"key":"ketchup","name":"Ketchup","priceDelta":0},{"key":"mayonnaise","name":"Mayonnaise","priceDelta":0},{"key":"samourai","name":"Samouraï","priceDelta":0},{"key":"andalouse","name":"Andalouse","priceDelta":0},{"key":"poivre","name":"Poivre","priceDelta":0},{"key":"biggy","name":"Biggy","priceDelta":0},{"key":"blanche-maison","name":"Blanche maison","priceDelta":0},{"key":"harissa","name":"Harissa","priceDelta":0},{"key":"cheesy","name":"Cheesy","priceDelta":0},{"key":"moutarde","name":"Moutarde","priceDelta":0},{"key":"algerienne","name":"Algérienne","priceDelta":0}],"perVariant":null},
  "g5": {"key":"viandes","name":"Viandes","type":"multi","min":0,"max":3,"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"perVariant":{"veggi":{"min":0,"max":0},"1-viande":{"min":1,"max":1},"2-ou-3-viandes":{"min":2,"max":3}}},
  "g6": {"key":"viandes","name":"Viandes","type":"multi","min":1,"max":4,"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"perVariant":{"M":{"min":1,"max":1},"L":{"min":2,"max":2},"XL":{"min":3,"max":3},"XXL":{"min":4,"max":4}}},
  "g7": {"key":"supp-1-00","name":"Suppléments +1,00 €","type":"multi","min":0,"max":null,"choices":[{"key":"cheddar","name":"Cheddar","priceDelta":100},{"key":"chevre","name":"Chèvre","priceDelta":100},{"key":"bleu","name":"Bleu","priceDelta":100},{"key":"boursin","name":"Boursin","priceDelta":100},{"key":"miel","name":"Miel","priceDelta":100},{"key":"uf","name":"Œuf","priceDelta":100},{"key":"reblochon","name":"Reblochon","priceDelta":100},{"key":"raclette","name":"Raclette","priceDelta":100},{"key":"camembert","name":"Camembert","priceDelta":100}],"perVariant":null},
  "g8": {"key":"supp-1-50","name":"Suppléments +1,50 €","type":"multi","min":0,"max":null,"choices":[{"key":"lardons","name":"Lardons","priceDelta":150},{"key":"bacon","name":"Bacon","priceDelta":150},{"key":"jambon-de-dinde","name":"Jambon de dinde","priceDelta":150},{"key":"chorizo","name":"Chorizo","priceDelta":150}],"perVariant":null},
  "g9": {"key":"supp-0-80","name":"Suppléments +0,80 €","type":"multi","min":0,"max":null,"choices":[{"key":"champignons","name":"Champignons","priceDelta":80},{"key":"avocat","name":"Avocat","priceDelta":80},{"key":"poivrons","name":"Poivrons","priceDelta":80},{"key":"aubergine","name":"Aubergine","priceDelta":80},{"key":"oignons-frits","name":"Oignons frits","priceDelta":80}],"perVariant":null},
  "g10": {"key":"gratine","name":"Gratiné","type":"single","min":0,"max":1,"choices":[{"key":"gratine","name":"Tacos gratiné","priceDelta":150}],"perVariant":{"XL":{"priceDelta":200},"XXL":{"priceDelta":200}}},
  "g11": {"key":"viandes","name":"Viandes","type":"multi","min":1,"max":3,"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"perVariant":{"M":{"min":1,"max":1},"L":{"min":2,"max":2},"XL":{"min":3,"max":3}}},
  "g12": {"key":"viandes","name":"Viandes (2 au choix)","type":"multi","min":2,"max":2,"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"perVariant":null},
  "g13": {"key":"viandes","name":"Viandes","type":"multi","min":1,"max":2,"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"perVariant":{"M":{"min":1,"max":1},"L":{"min":2,"max":2}}},
  "g14": {"key":"garniture","name":"Garniture","type":"single","min":1,"max":1,"choices":[{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"thon","name":"Thon","priceDelta":0},{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"merguez-ou-poulet-chorizo","name":"Merguez ou poulet chorizo","priceDelta":0},{"key":"steak-chevre","name":"Steak chèvre","priceDelta":0},{"key":"steak-chevre-miel","name":"Steak chèvre miel","priceDelta":0},{"key":"jambon-de-dinde","name":"Jambon de dinde","priceDelta":0}],"perVariant":null},
  "g15": {"key":"extras","name":"Extras","type":"multi","min":0,"max":1,"choices":[{"key":"frites","name":"Supplément frites","priceDelta":150}],"perVariant":null},
  "g16": {"key":"base","name":"Base","type":"single","min":1,"max":1,"choices":[{"key":"3-steaks","name":"3 steaks","priceDelta":0},{"key":"escalope-de-poulet","name":"Escalope de poulet","priceDelta":0}],"perVariant":null},
  "g17": {"key":"plat","name":"Plat","type":"single","min":1,"max":1,"choices":[{"key":"cheeseburger","name":"Cheeseburger","priceDelta":0},{"key":"5-nuggets","name":"5 nuggets","priceDelta":0},{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"mini-tacos","name":"Mini tacos","priceDelta":0}],"perVariant":null},
  "g18": {"key":"douceur","name":"Boisson / dessert","type":"single","min":1,"max":1,"choices":[{"key":"capri-sun","name":"Capri-Sun","priceDelta":0},{"key":"compote","name":"Compote","priceDelta":0}],"perVariant":null},
  "g19": {"key":"base","name":"Base","type":"single","min":1,"max":1,"choices":[{"key":"riz-sauce-creme","name":"Riz (sauce crème)","priceDelta":0},{"key":"pates-sauce-cheddar","name":"Pâtes (sauce cheddar)","priceDelta":0},{"key":"nouilles-sauce-cheddar","name":"Nouilles (sauce cheddar)","priceDelta":0}],"perVariant":null},
  "g20": {"key":"garniture","name":"Garniture","type":"single","min":1,"max":1,"choices":[{"key":"legumes","name":"Légumes","priceDelta":0},{"key":"poulet","name":"poulet","priceDelta":0},{"key":"b-uf","name":"bœuf","priceDelta":0}],"perVariant":null},
  "g21": {"key":"choix","name":"Choix","type":"single","min":1,"max":1,"choices":[{"key":"5-tenders","name":"5 tenders","priceDelta":0},{"key":"5-wings","name":"5 wings","priceDelta":0}],"perVariant":null},
};

/** Suppléments payants, dérivés des recettes côté serveur. */
export const SNAPSHOT_SUPPLEMENTS: Record<string, MenuSupplement> = {
  "bleu": {"key":"bleu","label":"Bleu","priceCents":100,"category":"fromage"},
  "boursin": {"key":"boursin","label":"Boursin","priceCents":100,"category":"fromage"},
  "camembert": {"key":"camembert","label":"Camembert","priceCents":100,"category":"fromage"},
  "cheddar": {"key":"cheddar","label":"Cheddar","priceCents":100,"category":"fromage"},
  "chevre": {"key":"chevre","label":"Chèvre","priceCents":100,"category":"fromage"},
  "raclette": {"key":"raclette","label":"Raclette","priceCents":100,"category":"fromage"},
  "reblochon": {"key":"reblochon","label":"Reblochon","priceCents":100,"category":"fromage"},
  "miel": {"key":"miel","label":"Miel","priceCents":100,"category":"epicerie"},
  "bacon": {"key":"bacon","label":"Bacon","priceCents":150,"category":"volaille"},
  "chorizo": {"key":"chorizo","label":"Chorizo","priceCents":150,"category":"volaille"},
  "jambon-de-dinde": {"key":"jambon-de-dinde","label":"Jambon de dinde","priceCents":150,"category":"volaille"},
  "lardons": {"key":"lardons","label":"Lardons","priceCents":150,"category":"volaille"},
  "cordon-bleu": {"key":"cordon-bleu","label":"Cordon bleu","priceCents":200,"category":"volaille"},
  "nuggets": {"key":"nuggets","label":"Nuggets","priceCents":200,"category":"volaille"},
  "poulet": {"key":"poulet","label":"Poulet","priceCents":200,"category":"volaille"},
  "poulet-pane": {"key":"poulet-pane","label":"Poulet pané","priceCents":200,"category":"volaille"},
  "tandoori": {"key":"tandoori","label":"Tandoori","priceCents":200,"category":"volaille"},
  "tenders": {"key":"tenders","label":"Tenders","priceCents":200,"category":"volaille"},
  "tikka": {"key":"tikka","label":"Tikka","priceCents":200,"category":"volaille"},
  "kebab": {"key":"kebab","label":"Kebab","priceCents":200,"category":"viande"},
  "kefta": {"key":"kefta","label":"Kefta","priceCents":200,"category":"viande"},
  "merguez": {"key":"merguez","label":"Merguez","priceCents":200,"category":"viande"},
  "steak": {"key":"steak","label":"Steak","priceCents":200,"category":"viande"},
  "aubergine": {"key":"aubergine","label":"Aubergine","priceCents":80,"category":"legume"},
  "avocat": {"key":"avocat","label":"Avocat","priceCents":80,"category":"legume"},
  "champignons": {"key":"champignons","label":"Champignons","priceCents":80,"category":"legume"},
  "oignons-frits": {"key":"oignons-frits","label":"Oignons frits","priceCents":80,"category":"legume"},
  "poivrons": {"key":"poivrons","label":"Poivrons","priceCents":80,"category":"legume"},
  "oeuf": {"key":"oeuf","label":"Œuf","priceCents":100,"category":"epicerie"},
};

/** Retraits proposés, dérivés des recettes côté serveur : clé → libellé. */
export const SNAPSHOT_REMOVABLES: Record<string, string> = {
  "oeuf": "Œuf",
  "oignons": "Oignons",
  "salade": "Salade",
  "tomate": "Tomate",
  "crudites": "crudités",
  "cheddar": "Cheddar",
  "chevre": "Chèvre",
  "miel": "Miel",
  "boursin": "Boursin",
  "camembert": "Camembert",
  "champignons": "Champignons",
  "poivrons": "Poivrons",
  "emmental": "Emmental",
  "bleu": "Bleu",
  "burrata": "Burrata",
  "creme-balsamique": "Crème balsamique",
  "cornichons": "Cornichons",
  "raclette": "Raclette",
  "aubergine": "Aubergine",
  "mozzarella": "Mozzarella",
  "oignons-frits": "Oignons frits",
  "sauce-fromagere": "Sauce fromagère",
  "olives-noires": "Olives noires",
  "avocat": "Avocat",
  "sauce-cheddar-poche": "Sauce cheddar (poche)",
  "ketchup": "Ketchup",
  "moutarde": "Moutarde",
  "sauce-blanche": "Sauce blanche",
};

/** Jeux de suppléments partagés par plusieurs produits. */
export const SNAPSHOT_SUPPLEMENT_SETS: Record<string, string[]> = {
  "s1": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s2": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s3": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s4": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s5": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s6": ["bleu","boursin","camembert","cheddar","raclette","reblochon","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s7": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s8": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s9": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s10": ["bleu","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s11": ["bleu","boursin","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","oignons-frits","poivrons"],
  "s12": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s13": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s14": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s15": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits"],
  "s16": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","oignons-frits","poivrons"],
  "s17": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s18": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s19": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s20": ["boursin","camembert","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s21": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s22": ["bleu","boursin","camembert","cheddar","raclette","reblochon","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s23": ["bleu","boursin","camembert","cheddar","chevre","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s24": ["bleu","boursin","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s25": ["boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s26": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s27": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s28": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","oignons-frits"],
  "s29": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s30": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","poulet-pane","avocat"],
  "s31": ["poulet-pane"],
  "s32": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","poulet-pane","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s33": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","lardons","cordon-bleu","nuggets","poulet-pane","tandoori","tenders","tikka","kefta","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s34": ["bleu","boursin","camembert","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s35": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s36": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s37": ["bleu","boursin","camembert","cheddar","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s38": ["bleu","boursin","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","avocat","champignons","oignons-frits","poivrons"],
  "s39": ["bleu","boursin","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","champignons","oignons-frits","poivrons"],
  "s40": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s41": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","poivrons"],
  "s42": ["bleu","boursin","camembert","chevre","raclette","reblochon","miel","oeuf","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","poivrons"],
  "s43": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","bacon","chorizo","lardons","cordon-bleu","nuggets","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","poivrons"],
  "s44": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","poivrons"],
  "s45": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s46": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","poulet","poulet-pane","tandoori","tenders","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
  "s47": ["bleu","boursin","camembert","cheddar","chevre","raclette","reblochon","miel","oeuf","bacon","chorizo","jambon-de-dinde","lardons","cordon-bleu","nuggets","poulet","poulet-pane","tandoori","tikka","kebab","kefta","merguez","steak","aubergine","avocat","champignons","oignons-frits","poivrons"],
};

/** Jeux de retraits partagés par plusieurs produits. */
export const SNAPSHOT_REMOVABLE_SETS: Record<string, string[]> = {
  "r1": ["oeuf","oignons","salade","tomate","crudites"],
  "r2": ["oignons","salade","tomate","crudites"],
  "r3": ["cheddar","oignons","salade","tomate","crudites"],
  "r4": ["chevre","miel","oignons","salade","tomate","crudites"],
  "r5": ["boursin","oignons","salade","tomate","crudites"],
  "r6": ["camembert","champignons","oignons","salade","tomate","crudites"],
  "r7": ["oignons","poivrons","salade","tomate","crudites"],
  "r8": ["champignons","emmental","oignons","salade","tomate","crudites"],
  "r9": ["cheddar","oeuf","oignons","salade","tomate","crudites"],
  "r10": ["bleu","cheddar","chevre","emmental","oignons","salade","tomate","crudites"],
  "r11": ["burrata","creme-balsamique","oignons","salade","tomate","crudites"],
  "r12": ["cheddar","cornichons","oignons","salade","tomate"],
  "r13": ["chevre","cornichons","miel","oignons","salade","tomate"],
  "r14": ["cheddar","cornichons","oeuf","oignons","salade","tomate"],
  "r15": ["cornichons","oeuf","oignons","raclette","salade","tomate"],
  "r16": ["camembert","cornichons","oignons","salade","tomate"],
  "r17": ["bleu","cornichons","oignons","salade","tomate"],
  "r18": ["cheddar","salade","tomate","crudites"],
  "r19": ["champignons","oeuf","poivrons","salade","tomate","crudites"],
  "r20": ["cheddar","oeuf","salade","tomate","crudites"],
  "r21": ["aubergine","champignons","mozzarella","oignons-frits","poivrons","sauce-fromagere"],
  "r22": ["sauce-fromagere"],
  "r23": ["oignons","salade","tomate"],
  "r24": ["salade","tomate"],
  "r25": ["emmental"],
  "r26": ["cheddar","chevre","emmental"],
  "r27": ["olives-noires","salade","tomate"],
  "r28": ["chevre","oeuf","salade","tomate"],
  "r29": ["aubergine","camembert","olives-noires","salade","tomate"],
  "r30": ["avocat","camembert","oignons","olives-noires","salade","tomate"],
  "r31": ["sauce-cheddar-poche"],
  "r32": ["oeuf","salade","tomate"],
  "r33": ["ketchup","moutarde","oignons-frits"],
  "r34": ["cheddar","oignons-frits"],
  "r35": ["cheddar"],
  "r36": ["cheddar","cornichons","salade"],
  "r37": ["oeuf","oignons-frits","tomate"],
  "r38": ["creme-balsamique","oignons-frits","sauce-blanche"],
  "r39": ["oeuf","oignons","sauce-cheddar-poche"],
  "r40": ["cheddar","sauce-fromagere"],
};

export interface SnapshotProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  variants?: Variant[];
  /** Clés dans SNAPSHOT_GROUPS. */
  groups?: string[];
  /** Clé dans SNAPSHOT_SUPPLEMENT_SETS. */
  supplements?: string;
  /** Clé dans SNAPSHOT_REMOVABLE_SETS. */
  removables?: string;
  tags?: string[];
  isNew?: boolean;
  outOfStock?: boolean;
}

export const SNAPSHOT_PRODUCTS: SnapshotProduct[] = [
  {"id":"p1","name":"Végétarien","price":750,"groups":["g1","g2"],"supplements":"s1","removables":"r1"},
  {"id":"p2","name":"Kebab","price":750,"groups":["g1","g2"],"supplements":"s2","removables":"r2"},
  {"id":"p3","name":"Merguez","description":"Deux merguez grillées","price":750,"groups":["g3","g4"],"supplements":"s3","removables":"r2"},
  {"id":"p4","name":"2 Steaks","description":"Deux steaks, fromage","price":790,"groups":["g3","g4"],"supplements":"s4","removables":"r3"},
  {"id":"p5","name":"3 Steaks","description":"Trois steaks, fromage","price":890,"groups":["g3","g4"],"supplements":"s4","removables":"r3"},
  {"id":"p6","name":"4 Steaks","description":"Quatre steaks, fromage","price":990,"groups":["g3","g4"],"supplements":"s4","removables":"r3"},
  {"id":"p7","name":"Kebab Fromage","description":"Kebab, fromage au choix","price":850,"groups":["g3","g4"],"supplements":"s5","removables":"r3"},
  {"id":"p8","name":"Chèvre Miel","description":"Viande kebab, chèvre, miel","price":950,"groups":["g3","g4"],"supplements":"s6","removables":"r4"},
  {"id":"p9","name":"Kefta","description":"Viande hachée épicée, fromage","price":950,"groups":["g3","g4"],"supplements":"s7","removables":"r3"},
  {"id":"p10","name":"Tikka","description":"Poulet tikka","price":950,"groups":["g3","g4"],"supplements":"s8","removables":"r2"},
  {"id":"p11","name":"Tandoori","description":"Poulet mariné tandoori","price":950,"groups":["g3","g4"],"supplements":"s9","removables":"r2","isNew":true},
  {"id":"p12","name":"Le Boursin","description":"Poulet, Boursin fondant","price":950,"groups":["g3","g4"],"supplements":"s10","removables":"r5","isNew":true},
  {"id":"p13","name":"Escalope Normande","description":"Escalope panée, camembert, champignons","price":990,"groups":["g3","g4"],"supplements":"s11","removables":"r6","isNew":true},
  {"id":"p14","name":"Spécial","description":"Viande kebab, merguez","price":990,"groups":["g3","g4"],"supplements":"s12","removables":"r2"},
  {"id":"p15","name":"Radical","description":"Deux steaks, deux merguez, fromage","price":990,"groups":["g3","g4"],"supplements":"s13","removables":"r3"},
  {"id":"p16","name":"Duo","description":"Deux steaks, cordon bleu, fromage","price":950,"groups":["g3","g4"],"supplements":"s14","removables":"r3"},
  {"id":"p17","name":"Mexicain","description":"Viande au choix, chorizo, poivrons","price":950,"groups":["g3","g4"],"supplements":"s15","removables":"r7"},
  {"id":"p18","name":"Suprême","description":"Viande kebab, champignons, emmental","price":950,"groups":["g3","g4"],"supplements":"s16","removables":"r8"},
  {"id":"p19","name":"Buffalo","description":"Deux steaks, bacon, fromage, œuf","price":950,"groups":["g3","g4"],"supplements":"s17","removables":"r9"},
  {"id":"p20","name":"Royal","description":"Steak, viande kebab","price":950,"groups":["g3","g4"],"supplements":"s18","removables":"r2"},
  {"id":"p21","name":"Beldi","description":"Viande hachée, œuf, fromage","price":950,"groups":["g3","g4"],"supplements":"s19","removables":"r9"},
  {"id":"p22","name":"Maxi Kebab","description":"Double viande kebab","price":990,"groups":["g3","g4"],"supplements":"s2","removables":"r2"},
  {"id":"p23","name":"Galette 4 Fromages","description":"Kebab, 4 fromages","price":990,"groups":["g3","g4"],"supplements":"s20","removables":"r10","isNew":true},
  {"id":"p24","name":"Galette Burrata","description":"Kebab ou tenders, burrata, tomate grillée, crème balsamique","price":1100,"groups":["g3","g4"],"supplements":"s2","removables":"r11","isNew":true},
  {"id":"p25","name":"Le Classic","price":950,"groups":["g2"],"supplements":"s4","removables":"r12"},
  {"id":"p26","name":"Le Crousty","description":"Steak 130 g, poulet crousty, cheddar","price":1250,"groups":["g4"],"supplements":"s21","removables":"r12"},
  {"id":"p27","name":"Le Chèvre Miel","description":"Steak 130 g, chèvre, miel","price":1250,"groups":["g4"],"supplements":"s22","removables":"r13"},
  {"id":"p28","name":"Le Gourmet","description":"Steak 130 g, œuf, bacon, cheddar","price":1250,"groups":["g4"],"supplements":"s17","removables":"r14"},
  {"id":"p29","name":"Le Montagnard","description":"Steak 130 g, œuf, raclette fondante","price":1250,"groups":["g4"],"supplements":"s23","removables":"r15"},
  {"id":"p30","name":"Le Red","description":"Steak 130 g, camembert, lardons grillés","price":1250,"groups":["g4"],"supplements":"s24","removables":"r16","isNew":true},
  {"id":"p31","name":"Le Black","description":"Steak 130 g, bleu, bacon","price":1250,"groups":["g4"],"supplements":"s25","removables":"r17","isNew":true},
  {"id":"p32","name":"Le King","description":"Double steak 130 g, œuf, cheddar","price":1490,"groups":["g4"],"supplements":"s19","removables":"r14"},
  {"id":"p33","name":"Cheese","description":"Steak, cheddar","price":550,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p34","name":"Double Cheese","description":"Deux steaks, double cheddar","price":700,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p35","name":"Triple Cheese","description":"Trois steaks, triple cheddar","price":800,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p36","name":"Chicken","description":"Poulet pané, cheddar","price":750,"groups":["g4"],"supplements":"s26","removables":"r18"},
  {"id":"p37","name":"Fish","description":"Poisson pané, cheddar","price":750,"groups":["g4"],"supplements":"s27","removables":"r18"},
  {"id":"p38","name":"Veggi","description":"Galette multi-céréales, œuf, légumes","price":750,"groups":["g4"],"supplements":"s28","removables":"r19"},
  {"id":"p39","name":"Texan","description":"Deux steaks, cheddar, œuf, bacon","price":950,"groups":["g4"],"supplements":"s17","removables":"r20"},
  {"id":"p40","name":"Farci","description":"Viande hachée marinée, œuf, fromage","price":950,"groups":["g4"],"supplements":"s29","removables":"r20"},
  {"id":"p41","name":"Country","description":"Deux steaks 45 g, galette PDT, cheddar","price":950,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p42","name":"Le 180","description":"Steak 180 g, cheddar","price":950,"groups":["g4"],"supplements":"s4","removables":"r18","tags":["Mega Burger"]},
  {"id":"p43","name":"Le 360","description":"Deux steaks 180 g, cheddar","price":1300,"groups":["g4"],"supplements":"s4","removables":"r18","tags":["Mega Burger"]},
  {"id":"p44","name":"Le 540","description":"Trois steaks 180 g, cheddar","price":1600,"groups":["g4"],"supplements":"s4","removables":"r18","tags":["Mega Burger"]},
  {"id":"p45","name":"Le Bowl","description":"Frites, sauce fromagère, mozzarella · poivrons, champignons, aubergine, oignons frits","price":0,"variants":[{"key":"veggi","name":"Veggi","price":790},{"key":"1-viande","name":"1 viande","price":950},{"key":"2-ou-3-viandes","name":"2 ou 3 viandes","price":1250}],"groups":["g5","g4"],"supplements":"s30","removables":"r21","isNew":true},
  {"id":"p46","name":"Compose ton Tacos","description":"Taille, viandes, suppléments, sauces — servi avec frites","price":0,"variants":[{"key":"M","name":"M — 1 viande","price":890},{"key":"L","name":"L — 2 viandes","price":990},{"key":"XL","name":"XL — 3 viandes","price":1250},{"key":"XXL","name":"XXL — 4 viandes","price":1450}],"groups":["g6","g7","g8","g9","g10","g4"],"supplements":"s31","removables":"r22"},
  {"id":"p47","name":"Assiette","description":"Viandes au choix, crudités & frites","price":0,"variants":[{"key":"M","name":"M — 1 viande","price":1200},{"key":"L","name":"L — 2 viandes","price":1450},{"key":"XL","name":"XL — 3 viandes","price":1700}],"groups":["g11","g4"],"supplements":"s32","removables":"r23"},
  {"id":"p48","name":"Assiette Maison","description":"3 onion rings, 3 beignets de calamar, 2 viandes au choix","price":1990,"groups":["g12","g4"],"supplements":"s32","removables":"r24"},
  {"id":"p49","name":"Bun's","description":"Pain bun toasté, viandes au choix","price":0,"variants":[{"key":"M","name":"M — 1 viande","price":890},{"key":"L","name":"L — 2 viandes","price":990}],"groups":["g13","g4"],"supplements":"s32","removables":"r24"},
  {"id":"p50","name":"Panini au choix","description":"Merguez · Thon · Kebab · Steak · Poulet · Merguez ou poulet chorizo · Steak chèvre · Steak chèvre miel · Jambon de dinde","price":700,"groups":["g14","g15"],"supplements":"s33","removables":"r25"},
  {"id":"p51","name":"Panini 3 fromages","price":650,"groups":["g15"],"supplements":"s34","removables":"r26"},
  {"id":"p52","name":"Panini Nutella","price":450,"supplements":"s35","isNew":true},
  {"id":"p53","name":"H1 — 2 steaks","description":"Cheddar, crudités & frites","price":790,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p54","name":"H2 — 4 steaks","description":"Cheddar, crudités & frites","price":990,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p55","name":"H3 — 6 steaks","description":"Cheddar, crudités & frites","price":1200,"groups":["g4"],"supplements":"s4","removables":"r18"},
  {"id":"p56","name":"H4 — 8 steaks","description":"Cheddar, crudités & frites","price":1490,"groups":["g4"],"supplements":"s4","removables":"r18","isNew":true},
  {"id":"p57","name":"Salade César","description":"Salade, tomates, poulet pané","price":750,"supplements":"s36","removables":"r24"},
  {"id":"p58","name":"Salade Océane","description":"Salade, tomates, thon, olives","price":750,"supplements":"s35","removables":"r27"},
  {"id":"p59","name":"Salade Lyonnaise","description":"Salade, tomates, œuf au plat, chèvre","price":750,"supplements":"s37","removables":"r28"},
  {"id":"p60","name":"Salade Normande","description":"Salade, tomates, aubergine grillée, camembert, olives","price":750,"supplements":"s38","removables":"r29","isNew":true},
  {"id":"p61","name":"Salade Andelloise","description":"Salade, tomates, avocat, olives noires, camembert, oignons rouges","price":750,"supplements":"s39","removables":"r30","isNew":true},
  {"id":"p62","name":"Frites","price":0,"variants":[{"key":"M","name":"M","price":350},{"key":"L","name":"L","price":450}],"supplements":"s35"},
  {"id":"p63","name":"Frites cheddar ou fromagère","price":0,"variants":[{"key":"M","name":"M","price":450},{"key":"L","name":"L","price":550}],"supplements":"s35","removables":"r31"},
  {"id":"p64","name":"Frites cheddar lardons","price":0,"variants":[{"key":"M","name":"M","price":550},{"key":"L","name":"L","price":650}],"supplements":"s40","removables":"r31"},
  {"id":"p65","name":"Viande (kebab ou poulet)","price":0,"variants":[{"key":"M","name":"M","price":900},{"key":"L","name":"L","price":1100}],"supplements":"s2"},
  {"id":"p66","name":"Pain Suédois","description":"3 steaks ou escalope de poulet, crudités, œuf, frites","price":990,"groups":["g16","g4"],"supplements":"s1","removables":"r32"},
  {"id":"p67","name":"Menu Enfant","description":"Au choix : cheeseburger, 5 nuggets, kebab ou mini tacos — frites + Capri-Sun ou compote","price":750,"groups":["g17","g18"],"supplements":"s2"},
  {"id":"p68","name":"Le Grand Dog","description":"Le classique généreux","price":690,"supplements":"s41","removables":"r33"},
  {"id":"p69","name":"Le Royal Dog","description":"Saucisse, bacon, fromage, oignons frits","price":890,"supplements":"s42","removables":"r34"},
  {"id":"p70","name":"Le Cheese Dog","description":"Double cheddar fondu à cœur","price":750,"supplements":"s27","removables":"r35"},
  {"id":"p71","name":"Le Boss","description":"Pur bœuf, cheddar, onion rings, cornichons — le patron","price":1350,"supplements":"s4","removables":"r36","tags":["Burger"]},
  {"id":"p72","name":"Le Bo Goss","description":"Escalope de poulet, jambon, œuf, tomate grillée, oignons frits","price":1250,"supplements":"s43","removables":"r37","tags":["Burger"]},
  {"id":"p73","name":"Bling Bling","description":"Pur bœuf, escalope de poulet, crème balsamique, sauce maison, oignons frie","price":1250,"supplements":"s44","removables":"r38","tags":["Burger"]},
  {"id":"p74","name":"Egg 180","description":"Steaks 180g, œuf, sauce cheddar, oignons grillés","price":1190,"supplements":"s45","removables":"r39","tags":["Mega Burger"]},
  {"id":"p75","name":"Le Smash","description":"Smash burgers trempés dans une sauce cream cheese fondante","price":0,"variants":[{"key":"simple","name":"Simple","price":950},{"key":"double","name":"Double","price":1250},{"key":"triple","name":"Triple","price":1490}],"supplements":"s4","removables":"r40"},
  {"id":"p76","name":"Le Smash Chicken","description":"La version poulet croustillant","price":950,"supplements":"s26","removables":"r40"},
  {"id":"p77","name":"Le Double Kif","description":"Double smash, double plaisir","price":1690,"supplements":"s4","removables":"r40","tags":["1+1"]},
  {"id":"p78","name":"Crousty One","description":"Le plat qui cartonne — poulet crousty — Sauce crème (riz) ou sauce cheddar (pâtes & nouilles)","price":950,"groups":["g19"],"supplements":"s36"},
  {"id":"p79","name":"Nuggets","price":0,"variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s46"},
  {"id":"p80","name":"Wings","price":0,"variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s35"},
  {"id":"p81","name":"Mozza sticks","price":0,"variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s35"},
  {"id":"p82","name":"Tenders","price":0,"variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"supplements":"s47"},
  {"id":"p83","name":"Jalapeños","price":0,"variants":[{"key":"5","name":"5 pcs","price":650},{"key":"10","name":"10 pcs","price":1200}]},
  {"id":"p84","name":"Samoussa","description":"Légumes · poulet · bœuf","price":0,"variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"groups":["g20"],"isNew":true},
  {"id":"p85","name":"Nems","description":"Légumes · poulet · bœuf","price":0,"variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"groups":["g20"],"isNew":true},
  {"id":"p86","name":"Beignets de calamar","price":0,"variants":[{"key":"10","name":"10 pcs","price":650},{"key":"20","name":"20 pcs","price":1300}],"supplements":"s35","isNew":true},
  {"id":"p87","name":"Onion rings","price":0,"variants":[{"key":"10","name":"10 pcs","price":650},{"key":"20","name":"20 pcs","price":1300}],"isNew":true},
  {"id":"p88","name":"Box Menu Solo","description":"5 tenders ou 5 wings + frites + 1 canette","price":990,"groups":["g21"],"supplements":"s35"},
  {"id":"p89","name":"Mix Box 1","description":"8 tenders · 8 wings","price":2190,"supplements":"s47"},
  {"id":"p90","name":"Mix Box 2","description":"8 tenders · 15 wings","price":2690,"supplements":"s47"},
  {"id":"p91","name":"Family Box","description":"14 tenders · 16 wings · 4 frites · 1 boisson 1,5 L","price":4290,"supplements":"s47"},
  {"id":"p92","name":"Family Big Box","description":"10 tenders · 10 wings · 5 beignets de calamar · 3 samoussas poulet · 3 nems poulet · 5 onion rings · 4 jalapeños · 5 frites · 1 boisson 1,5 L","price":5350,"supplements":"s47","tags":["La plus grosse"]},
  {"id":"p93","name":"Pot 100 ml","price":350},
  {"id":"p94","name":"Pot 500 ml","price":800},
  {"id":"p95","name":"Chocobon","price":390},
  {"id":"p96","name":"Tarte au Daim","price":350},
  {"id":"p97","name":"Cheesecake","price":350},
  {"id":"p98","name":"Tiramisu","price":350},
  {"id":"p99","name":"Fondant chocolat","price":350},
  {"id":"p100","name":"Milkshake Nature, vanille, fraise","description":"Coulis : fraise, caramel ou chocolat","price":0,"variants":[{"key":"classique","name":"Classique","price":350},{"key":"xl","name":"XL","price":590}]},
  {"id":"p101","name":"Milkshake Oréo ou Bueno","description":"Coulis : fraise, caramel ou chocolat","price":0,"variants":[{"key":"classique","name":"Classique","price":400},{"key":"xl","name":"XL","price":690}]},
  {"id":"p102","name":"Canette 33 cl","price":150},
  {"id":"p103","name":"Bouteille 50 cl","price":250},
  {"id":"p104","name":"Bouteille 1,5 L","price":350},
  {"id":"p105","name":"Bouteille 2 L","price":390},
  {"id":"p106","name":"Red Bull","price":300},
  {"id":"p107","name":"Monster","price":350},
  {"id":"p108","name":"Freez","price":300},
  {"id":"p109","name":"Thé / Café","price":150},
];

export const SNAPSHOT_CATEGORIES: { id: string; name: string; products: string[] }[] = [
  {"id":"c1","name":"Sandwichs","products":["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10","p11","p12","p13","p14","p15","p16","p17","p18","p19","p20","p21","p22","p23","p24"]},
  {"id":"c2","name":"Gourmets Burgers","products":["p25","p26","p27","p28","p29","p30","p31","p32"]},
  {"id":"c3","name":"Les Classiques","products":["p33","p34","p35","p36","p37","p38","p39","p40","p41","p42","p43","p44"]},
  {"id":"c4","name":"Le Bowl","products":["p45"]},
  {"id":"c5","name":"Compose ton Tacos","products":["p46"]},
  {"id":"c6","name":"Assiettes","products":["p47","p48"]},
  {"id":"c7","name":"Bun's","products":["p49"]},
  {"id":"c8","name":"Paninis","products":["p50","p51","p52"]},
  {"id":"c9","name":"Hummers","products":["p53","p54","p55","p56"]},
  {"id":"c10","name":"Salades","products":["p57","p58","p59","p60","p61"]},
  {"id":"c11","name":"Barquettes","products":["p62","p63","p64","p65"]},
  {"id":"c12","name":"Pain Suédois","products":["p66"]},
  {"id":"c13","name":"Menu Enfant","products":["p67"]},
  {"id":"c14","name":"Hot Dogs","products":["p68","p69","p70"]},
  {"id":"c15","name":"Les Signatures","products":["p71","p72","p73","p74","p75","p76","p77"]},
  {"id":"c16","name":"Crousty One","products":["p78"]},
  {"id":"c17","name":"Tex-Mex","products":["p79","p80","p81","p82","p83","p84","p85","p86","p87"]},
  {"id":"c18","name":"Box à Partager","products":["p88","p89","p90","p91","p92"]},
  {"id":"c19","name":"Glaces","products":["p93","p94","p95"]},
  {"id":"c20","name":"Desserts","products":["p96","p97","p98","p99"]},
  {"id":"c21","name":"Milkshakes","products":["p100","p101"]},
  {"id":"c22","name":"Boissons","products":["p102","p103","p104","p105","p106","p107","p108","p109"]},
];

export interface SnapshotOrderLine {
  productId: string;
  variantKey: string | null;
  options: { groupKey: string; choiceKey: string }[];
  removed: string[];
  note?: string;
  qty: number;
}

export interface SnapshotOrder {
  status: 'new' | 'preparing' | 'ready';
  /** Âge en minutes au démarrage de la démonstration — jamais une date figée. */
  ageMin: number;
  channel: 'online' | 'pos' | 'phone';
  type: 'surplace' | 'emporter' | 'pickup';
  payment: { method: 'online' | 'counter'; tender: 'cash' | 'card' | 'online' | null; status: 'pending' | 'paid' };
  customerName?: string;
  customerPhone?: string;
  note?: string;
  lines: SnapshotOrderLine[];
}

/** Le service déjà en cours quand le visiteur arrive. */
export const SNAPSHOT_ORDERS: SnapshotOrder[] = [
  {"status":"ready","ageMin":27,"channel":"pos","type":"surplace","payment":{"method":"counter","tender":null,"status":"pending"},"lines":[{"productId":"p46","variantKey":"L","options":[{"groupKey":"viandes","choiceKey":"cordon-bleu"},{"groupKey":"viandes","choiceKey":"steak"},{"groupKey":"sauces","choiceKey":"algerienne"}],"removed":[],"note":"Coupé en deux","qty":1},{"productId":"p87","variantKey":"10","options":[],"removed":[],"qty":1}]},
  {"status":"ready","ageMin":22,"channel":"pos","type":"surplace","payment":{"method":"counter","tender":null,"status":"pending"},"lines":[{"productId":"p16","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"galette"},{"groupKey":"sauces","choiceKey":"algerienne"}],"removed":[],"qty":1},{"productId":"p12","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"galette"},{"groupKey":"sauces","choiceKey":"blanche-maison"},{"groupKey":"sauces","choiceKey":"moutarde"}],"removed":[],"qty":1},{"productId":"p104","variantKey":null,"options":[],"removed":[],"qty":2},{"productId":"p98","variantKey":null,"options":[],"removed":[],"qty":1}]},
  {"status":"preparing","ageMin":17,"channel":"pos","type":"emporter","payment":{"method":"counter","tender":null,"status":"pending"},"lines":[{"productId":"p12","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"pain"},{"groupKey":"sauces","choiceKey":"poivre"}],"removed":[],"qty":2},{"productId":"p57","variantKey":null,"options":[],"removed":[],"qty":1}]},
  {"status":"preparing","ageMin":13,"channel":"pos","type":"surplace","payment":{"method":"counter","tender":null,"status":"pending"},"lines":[{"productId":"p2","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"galette"},{"groupKey":"sauces","choiceKey":"samourai"}],"removed":["oignons","crudités"],"note":"bien cuit","qty":2},{"productId":"p62","variantKey":"L","options":[],"removed":[],"qty":1}]},
  {"status":"new","ageMin":9,"channel":"pos","type":"surplace","payment":{"method":"counter","tender":"card","status":"paid"},"lines":[{"productId":"p3","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"pain"},{"groupKey":"supplements","choiceKey":"cheddar"}],"removed":["oignons","tomate"],"qty":1}]},
  {"status":"new","ageMin":5,"channel":"pos","type":"surplace","payment":{"method":"counter","tender":"card","status":"paid"},"lines":[{"productId":"p2","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"galette"},{"groupKey":"sauces","choiceKey":"algerienne"},{"groupKey":"supplements","choiceKey":"cheddar"}],"removed":["oignons"],"qty":1}]},
  {"status":"new","ageMin":2,"channel":"online","type":"pickup","payment":{"method":"counter","tender":null,"status":"pending"},"customerName":"Sarah","customerPhone":"06 39 98 10 20","lines":[{"productId":"p2","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"galette"},{"groupKey":"sauces","choiceKey":"ketchup"}],"removed":[],"qty":1},{"productId":"p2","variantKey":null,"options":[{"groupKey":"pain","choiceKey":"pain"}],"removed":[],"qty":1}]},
];
