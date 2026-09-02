/**
 * LA CARTE DE « LE COMPTOIR » — FICHIER GÉNÉRÉ, NE PAS ÉDITER À LA MAIN.
 *
 * D'où elle vient : `GET /public/tenants/:slug/site` de l'API Snack Manager,
 * photographiée sur la base de STAGING puis ANONYMISÉE — restaurant fictif
 * « Le Comptoir », identifiants renumérotés, quatre plats renommés parce
 * qu'ils portaient le nom de l'enseigne. Aucun avis client réel n'est repris
 * (voir `fixture.ts`, ils sont réécrits).
 *
 * Pourquoi une VRAIE carte plutôt que six produits inventés : le restaurateur
 * qui essaie la démonstration reconnaît son métier au volume. 109 produits sur
 * 22 catégories, des tacos à taille variable, des groupes d'options
 * obligatoires, des suppléments tarifés, des retraits d'ingrédients — c'est
 * cette épaisseur-là qui prouve que le produit tient la carte d'un snack, et
 * pas une maquette.
 *
 * Forme COMPACTE assumée : groupes d'options, suppléments et retraits sont
 * déclarés une fois puis référencés par clé. `demoCategories()` les recompose
 * dans la forme EXACTE de la route `/site` — mêmes clés, même imbrication, le
 * groupe « supplements » replié dans `optionGroups` comme le fait l'API. Rien
 * en aval ne sait que la carte était compressée : elle traverse le même
 * normaliseur (`toCategories`) que les octets du réseau.
 *
 * Écrite à plat, elle pèserait 217 ko.
 */
import type { PublicSiteCategory, PublicSiteProduct } from "@sm/contracts";

/** Groupe d'options tel que l'API le sérialise (choix, bornes, dérogations). */
type RawGroup = {
  key: string;
  name: string;
  type: "single" | "multi";
  min: number;
  max: number | null;
  choices: { key: string; name: string; priceDelta: number }[];
  perVariant?: Record<string, { min?: number; max?: number; priceDelta?: number }> | null;
};

type RawProduct = {
  id: string;
  name: string;
  description?: string;
  /** Centimes — absent quand le prix dépend de la variante. */
  price?: number;
  variants?: { key: string; name: string; price: number }[];
  groups?: string[];
  supplements?: string;
  removables?: string;
  tags?: string[];
  isNew?: boolean;
  outOfStock?: boolean;
  photo?: string;
};

/** Groupes d'options distincts de la carte. */
const GROUPS: Record<string, RawGroup> = {
  "g1": {"choices":[{"key":"pain","name":"Pain","priceDelta":0},{"key":"galette","name":"Galette","priceDelta":50}],"key":"pain","max":1,"min":1,"name":"Pain","type":"single"},
  "g2": {"choices":[{"key":"ketchup","name":"Ketchup","priceDelta":0},{"key":"mayonnaise","name":"Mayonnaise","priceDelta":0},{"key":"samourai","name":"Samouraï","priceDelta":0},{"key":"andalouse","name":"Andalouse","priceDelta":0},{"key":"poivre","name":"Poivre","priceDelta":0},{"key":"biggy","name":"Biggy","priceDelta":0},{"key":"blanche-maison","name":"Blanche maison","priceDelta":0},{"key":"harissa","name":"Harissa","priceDelta":0},{"key":"cheesy","name":"Cheesy","priceDelta":0},{"key":"moutarde","name":"Moutarde","priceDelta":0},{"key":"algerienne","name":"Algérienne","priceDelta":0}],"key":"sauces","max":2,"min":0,"name":"Sauces","type":"multi"},
  "g3": {"choices":[{"key":"pain","name":"Pain","priceDelta":0},{"key":"galette","name":"Galette","priceDelta":50}],"key":"pain","max":1,"min":1,"name":"Pain","perVariant":null,"type":"single"},
  "g4": {"choices":[{"key":"ketchup","name":"Ketchup","priceDelta":0},{"key":"mayonnaise","name":"Mayonnaise","priceDelta":0},{"key":"samourai","name":"Samouraï","priceDelta":0},{"key":"andalouse","name":"Andalouse","priceDelta":0},{"key":"poivre","name":"Poivre","priceDelta":0},{"key":"biggy","name":"Biggy","priceDelta":0},{"key":"blanche-maison","name":"Blanche maison","priceDelta":0},{"key":"harissa","name":"Harissa","priceDelta":0},{"key":"cheesy","name":"Cheesy","priceDelta":0},{"key":"moutarde","name":"Moutarde","priceDelta":0},{"key":"algerienne","name":"Algérienne","priceDelta":0}],"key":"sauces","max":2,"min":0,"name":"Sauces","perVariant":null,"type":"multi"},
  "g5": {"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"key":"viandes","max":3,"min":0,"name":"Viandes","perVariant":{"1-viande":{"max":1,"min":1},"2-ou-3-viandes":{"max":3,"min":2},"veggi":{"max":0,"min":0}},"type":"multi"},
  "g6": {"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"key":"viandes","max":4,"min":1,"name":"Viandes","perVariant":{"L":{"max":2,"min":2},"M":{"max":1,"min":1},"XL":{"max":3,"min":3},"XXL":{"max":4,"min":4}},"type":"multi"},
  "g7": {"choices":[{"key":"cheddar","name":"Cheddar","priceDelta":100},{"key":"chevre","name":"Chèvre","priceDelta":100},{"key":"bleu","name":"Bleu","priceDelta":100},{"key":"boursin","name":"Boursin","priceDelta":100},{"key":"miel","name":"Miel","priceDelta":100},{"key":"uf","name":"Œuf","priceDelta":100},{"key":"reblochon","name":"Reblochon","priceDelta":100},{"key":"raclette","name":"Raclette","priceDelta":100},{"key":"camembert","name":"Camembert","priceDelta":100}],"key":"supp-1-00","max":null,"min":0,"name":"Suppléments +1,00 €","perVariant":null,"type":"multi"},
  "g8": {"choices":[{"key":"lardons","name":"Lardons","priceDelta":150},{"key":"bacon","name":"Bacon","priceDelta":150},{"key":"jambon-de-dinde","name":"Jambon de dinde","priceDelta":150},{"key":"chorizo","name":"Chorizo","priceDelta":150}],"key":"supp-1-50","max":null,"min":0,"name":"Suppléments +1,50 €","perVariant":null,"type":"multi"},
  "g9": {"choices":[{"key":"champignons","name":"Champignons","priceDelta":80},{"key":"avocat","name":"Avocat","priceDelta":80},{"key":"poivrons","name":"Poivrons","priceDelta":80},{"key":"aubergine","name":"Aubergine","priceDelta":80},{"key":"oignons-frits","name":"Oignons frits","priceDelta":80}],"key":"supp-0-80","max":null,"min":0,"name":"Suppléments +0,80 €","perVariant":null,"type":"multi"},
  "g10": {"choices":[{"key":"gratine","name":"Tacos gratiné","priceDelta":150}],"key":"gratine","max":1,"min":0,"name":"Gratiné","perVariant":{"XL":{"priceDelta":200},"XXL":{"priceDelta":200}},"type":"single"},
  "g11": {"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"key":"viandes","max":3,"min":1,"name":"Viandes","perVariant":{"L":{"max":2,"min":2},"M":{"max":1,"min":1},"XL":{"max":3,"min":3}},"type":"multi"},
  "g12": {"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"key":"viandes","max":2,"min":2,"name":"Viandes (2 au choix)","perVariant":null,"type":"multi"},
  "g13": {"choices":[{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"kefta","name":"Kefta","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"tikka","name":"Tikka","priceDelta":0},{"key":"tandoori","name":"Tandoori","priceDelta":0},{"key":"cordon-bleu","name":"Cordon bleu","priceDelta":0},{"key":"nuggets","name":"Nuggets","priceDelta":0},{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"tenders","name":"Tenders","priceDelta":0}],"key":"viandes","max":2,"min":1,"name":"Viandes","perVariant":{"L":{"max":2,"min":2},"M":{"max":1,"min":1}},"type":"multi"},
  "g14": {"choices":[{"key":"merguez","name":"Merguez","priceDelta":0},{"key":"thon","name":"Thon","priceDelta":0},{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"steak","name":"Steak","priceDelta":0},{"key":"poulet","name":"Poulet","priceDelta":0},{"key":"merguez-ou-poulet-chorizo","name":"Merguez ou poulet chorizo","priceDelta":0},{"key":"steak-chevre","name":"Steak chèvre","priceDelta":0},{"key":"steak-chevre-miel","name":"Steak chèvre miel","priceDelta":0},{"key":"jambon-de-dinde","name":"Jambon de dinde","priceDelta":0}],"key":"garniture","max":1,"min":1,"name":"Garniture","perVariant":null,"type":"single"},
  "g15": {"choices":[{"key":"frites","name":"Supplément frites","priceDelta":150}],"key":"extras","max":1,"min":0,"name":"Extras","perVariant":null,"type":"multi"},
  "g16": {"choices":[{"key":"3-steaks","name":"3 steaks","priceDelta":0},{"key":"escalope-de-poulet","name":"Escalope de poulet","priceDelta":0}],"key":"base","max":1,"min":1,"name":"Base","perVariant":null,"type":"single"},
  "g17": {"choices":[{"key":"cheeseburger","name":"Cheeseburger","priceDelta":0},{"key":"5-nuggets","name":"5 nuggets","priceDelta":0},{"key":"kebab","name":"Kebab","priceDelta":0},{"key":"mini-tacos","name":"Mini tacos","priceDelta":0}],"key":"plat","max":1,"min":1,"name":"Plat","perVariant":null,"type":"single"},
  "g18": {"choices":[{"key":"capri-sun","name":"Capri-Sun","priceDelta":0},{"key":"compote","name":"Compote","priceDelta":0}],"key":"douceur","max":1,"min":1,"name":"Boisson / dessert","perVariant":null,"type":"single"},
  "g19": {"choices":[{"key":"riz-sauce-creme","name":"Riz (sauce crème)","priceDelta":0},{"key":"pates-sauce-cheddar","name":"Pâtes (sauce cheddar)","priceDelta":0},{"key":"nouilles-sauce-cheddar","name":"Nouilles (sauce cheddar)","priceDelta":0}],"key":"base","max":1,"min":1,"name":"Base","perVariant":null,"type":"single"},
  "g20": {"choices":[{"key":"legumes","name":"Légumes","priceDelta":0},{"key":"poulet","name":"poulet","priceDelta":0},{"key":"b-uf","name":"bœuf","priceDelta":0}],"key":"garniture","max":1,"min":1,"name":"Garniture","perVariant":null,"type":"single"},
  "g21": {"choices":[{"key":"5-tenders","name":"5 tenders","priceDelta":0},{"key":"5-wings","name":"5 wings","priceDelta":0}],"key":"choix","max":1,"min":1,"name":"Choix","perVariant":null,"type":"single"},
};

/** Ingrédients ajoutables, tarifés — l'API les expose en groupe « supplements ». */
const SUPPLEMENTS: Record<string, { name: string; priceDelta: number }> = {
  "aubergine": {"name":"Aubergine","priceDelta":80},
  "avocat": {"name":"Avocat","priceDelta":80},
  "champignons": {"name":"Champignons","priceDelta":80},
  "oignons-frits": {"name":"Oignons frits","priceDelta":80},
  "poivrons": {"name":"Poivrons","priceDelta":80},
  "bleu": {"name":"Bleu","priceDelta":100},
  "boursin": {"name":"Boursin","priceDelta":100},
  "camembert": {"name":"Camembert","priceDelta":100},
  "cheddar": {"name":"Cheddar","priceDelta":100},
  "chevre": {"name":"Chèvre","priceDelta":100},
  "miel": {"name":"Miel","priceDelta":100},
  "oeuf": {"name":"Œuf","priceDelta":100},
  "raclette": {"name":"Raclette","priceDelta":100},
  "reblochon": {"name":"Reblochon","priceDelta":100},
  "bacon": {"name":"Bacon","priceDelta":150},
  "chorizo": {"name":"Chorizo","priceDelta":150},
  "jambon-de-dinde": {"name":"Jambon de dinde","priceDelta":150},
  "lardons": {"name":"Lardons","priceDelta":150},
  "cordon-bleu": {"name":"Cordon bleu","priceDelta":200},
  "kebab": {"name":"Kebab","priceDelta":200},
  "kefta": {"name":"Kefta","priceDelta":200},
  "merguez": {"name":"Merguez","priceDelta":200},
  "nuggets": {"name":"Nuggets","priceDelta":200},
  "poulet": {"name":"Poulet","priceDelta":200},
  "poulet-pane": {"name":"Poulet pané","priceDelta":200},
  "steak": {"name":"Steak","priceDelta":200},
  "tandoori": {"name":"Tandoori","priceDelta":200},
  "tenders": {"name":"Tenders","priceDelta":200},
  "tikka": {"name":"Tikka","priceDelta":200},
};

/** Jeux de suppléments partagés par plusieurs produits. */
const SUPPLEMENT_SETS: Record<string, string[]> = {
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

/** Ingrédients retirables, tels que l'API les envoie (libellés). */
const REMOVABLE_SETS: Record<string, string[]> = {
  "r1": ["crudités"],
  "r2": ["salade","tomates","oignons rouges","cornichons"],
};

const PRODUCTS: RawProduct[] = [
  {"id":"p1","name":"Végétarien","price":750,"groups":["g1","g2"],"supplements":"s1","removables":"r1"},
  {"id":"p2","name":"Kebab","price":750,"groups":["g1","g2"],"supplements":"s2","removables":"r1","photo":"/photos/doner-kebab.webp"},
  {"id":"p3","name":"Merguez","description":"Deux merguez grillées","price":750,"groups":["g3","g4"],"supplements":"s3","removables":"r1"},
  {"id":"p4","name":"2 Steaks","description":"Deux steaks, fromage","price":790,"groups":["g3","g4"],"supplements":"s4","removables":"r1"},
  {"id":"p5","name":"3 Steaks","description":"Trois steaks, fromage","price":890,"groups":["g3","g4"],"supplements":"s4","removables":"r1"},
  {"id":"p6","name":"4 Steaks","description":"Quatre steaks, fromage","price":990,"groups":["g3","g4"],"supplements":"s4","removables":"r1"},
  {"id":"p7","name":"Kebab Fromage","description":"Kebab, fromage au choix","price":850,"groups":["g3","g4"],"supplements":"s5","removables":"r1","photo":"/photos/doner-kebab.webp"},
  {"id":"p8","name":"Chèvre Miel","description":"Viande kebab, chèvre, miel","price":950,"groups":["g3","g4"],"supplements":"s6","removables":"r1"},
  {"id":"p9","name":"Kefta","description":"Viande hachée épicée, fromage","price":950,"groups":["g3","g4"],"supplements":"s7","removables":"r1"},
  {"id":"p10","name":"Tikka","description":"Poulet tikka","price":950,"groups":["g3","g4"],"supplements":"s8","removables":"r1"},
  {"id":"p11","name":"Tandoori","description":"Poulet mariné tandoori","price":950,"groups":["g3","g4"],"supplements":"s9","removables":"r1","isNew":true},
  {"id":"p12","name":"Le Boursin","description":"Poulet, Boursin fondant","price":950,"groups":["g3","g4"],"supplements":"s10","removables":"r1","isNew":true},
  {"id":"p13","name":"Escalope Normande","description":"Escalope panée, camembert, champignons","price":990,"groups":["g3","g4"],"supplements":"s11","removables":"r1","isNew":true},
  {"id":"p14","name":"Spécial","description":"Viande kebab, merguez","price":990,"groups":["g3","g4"],"supplements":"s12","removables":"r1"},
  {"id":"p15","name":"Radical","description":"Deux steaks, deux merguez, fromage","price":990,"groups":["g3","g4"],"supplements":"s13","removables":"r1"},
  {"id":"p16","name":"Duo","description":"Deux steaks, cordon bleu, fromage","price":950,"groups":["g3","g4"],"supplements":"s14","removables":"r1"},
  {"id":"p17","name":"Mexicain","description":"Viande au choix, chorizo, poivrons","price":950,"groups":["g3","g4"],"supplements":"s15","removables":"r1"},
  {"id":"p18","name":"Suprême","description":"Viande kebab, champignons, emmental","price":950,"groups":["g3","g4"],"supplements":"s16","removables":"r1"},
  {"id":"p19","name":"Buffalo","description":"Deux steaks, bacon, fromage, œuf","price":950,"groups":["g3","g4"],"supplements":"s17","removables":"r1"},
  {"id":"p20","name":"Royal","description":"Steak, viande kebab","price":950,"groups":["g3","g4"],"supplements":"s18","removables":"r1"},
  {"id":"p21","name":"Beldi","description":"Viande hachée, œuf, fromage","price":950,"groups":["g3","g4"],"supplements":"s19","removables":"r1"},
  {"id":"p22","name":"Maxi Kebab","description":"Double viande kebab","price":990,"groups":["g3","g4"],"supplements":"s2","removables":"r1","photo":"/photos/doner-kebab.webp"},
  {"id":"p23","name":"Galette 4 Fromages","description":"Kebab, 4 fromages","price":990,"groups":["g3","g4"],"supplements":"s20","removables":"r1","isNew":true,"photo":"/photos/wrap-tenders.webp"},
  {"id":"p24","name":"Galette Burrata","description":"Kebab ou tenders, burrata, tomate grillée, crème balsamique","price":1100,"groups":["g3","g4"],"supplements":"s2","removables":"r1","isNew":true,"photo":"/photos/wrap-tenders.webp"},
  {"id":"p25","name":"Le Classique","price":950,"groups":["g2"],"supplements":"s4","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p26","name":"Le Crousty","description":"Steak 130 g, poulet crousty, cheddar","price":1250,"groups":["g4"],"supplements":"s21","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p27","name":"Le Chèvre Miel","description":"Steak 130 g, chèvre, miel","price":1250,"groups":["g4"],"supplements":"s22","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p28","name":"Le Gourmet","description":"Steak 130 g, œuf, bacon, cheddar","price":1250,"groups":["g4"],"supplements":"s17","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p29","name":"Le Montagnard","description":"Steak 130 g, œuf, raclette fondante","price":1250,"groups":["g4"],"supplements":"s23","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p30","name":"Le Red","description":"Steak 130 g, camembert, lardons grillés","price":1250,"groups":["g4"],"supplements":"s24","removables":"r2","isNew":true,"photo":"/photos/black-burger.webp"},
  {"id":"p31","name":"Le Black","description":"Steak 130 g, bleu, bacon","price":1250,"groups":["g4"],"supplements":"s25","removables":"r2","isNew":true,"photo":"/photos/black-burger.webp"},
  {"id":"p32","name":"Le King","description":"Double steak 130 g, œuf, cheddar","price":1490,"groups":["g4"],"supplements":"s19","removables":"r2","photo":"/photos/black-burger.webp"},
  {"id":"p33","name":"Cheese","description":"Steak, cheddar","price":550,"groups":["g4"],"supplements":"s4","removables":"r1"},
  {"id":"p34","name":"Double Cheese","description":"Deux steaks, double cheddar","price":700,"groups":["g4"],"supplements":"s4","removables":"r1"},
  {"id":"p35","name":"Triple Cheese","description":"Trois steaks, triple cheddar","price":800,"groups":["g4"],"supplements":"s4","removables":"r1"},
  {"id":"p36","name":"Chicken","description":"Poulet pané, cheddar","price":750,"groups":["g4"],"supplements":"s26","removables":"r1"},
  {"id":"p37","name":"Fish","description":"Poisson pané, cheddar","price":750,"groups":["g4"],"supplements":"s27","removables":"r1","photo":"/photos/fish-burger.webp"},
  {"id":"p38","name":"Veggi","description":"Galette multi-céréales, œuf, légumes","price":750,"groups":["g4"],"supplements":"s28","removables":"r1"},
  {"id":"p39","name":"Texan","description":"Deux steaks, cheddar, œuf, bacon","price":950,"groups":["g4"],"supplements":"s17","removables":"r1"},
  {"id":"p40","name":"Farci","description":"Viande hachée marinée, œuf, fromage","price":950,"groups":["g4"],"supplements":"s29","removables":"r1"},
  {"id":"p41","name":"Country","description":"Deux steaks 45 g, galette PDT, cheddar","price":950,"groups":["g4"],"supplements":"s4","removables":"r1"},
  {"id":"p42","name":"Le 180","description":"Steak 180 g, cheddar","price":950,"groups":["g4"],"supplements":"s4","removables":"r1","tags":["Mega Burger"],"photo":"/photos/mega-burger-long.webp"},
  {"id":"p43","name":"Le 360","description":"Deux steaks 180 g, cheddar","price":1300,"groups":["g4"],"supplements":"s4","removables":"r1","tags":["Mega Burger"],"photo":"/photos/mega-burger-long.webp"},
  {"id":"p44","name":"Le 540","description":"Trois steaks 180 g, cheddar","price":1600,"groups":["g4"],"supplements":"s4","removables":"r1","tags":["Mega Burger"],"photo":"/photos/mega-burger-long.webp"},
  {"id":"p45","name":"Le Bowl","description":"Frites, sauce fromagère, mozzarella · poivrons, champignons, aubergine, oignons frits","variants":[{"key":"veggi","name":"Veggi","price":790},{"key":"1-viande","name":"1 viande","price":950},{"key":"2-ou-3-viandes","name":"2 ou 3 viandes","price":1250}],"groups":["g5","g4"],"supplements":"s30","isNew":true},
  {"id":"p46","name":"Compose ton Tacos","description":"Taille, viandes, suppléments, sauces — servi avec frites","variants":[{"key":"M","name":"M — 1 viande","price":890},{"key":"L","name":"L — 2 viandes","price":990},{"key":"XL","name":"XL — 3 viandes","price":1250},{"key":"XXL","name":"XXL — 4 viandes","price":1450}],"groups":["g6","g7","g8","g9","g10","g4"],"supplements":"s31","photo":"/photos/tacos-hero.webp"},
  {"id":"p47","name":"Assiette","description":"Viandes au choix, crudités & frites","variants":[{"key":"M","name":"M — 1 viande","price":1200},{"key":"L","name":"L — 2 viandes","price":1450},{"key":"XL","name":"XL — 3 viandes","price":1700}],"groups":["g11","g4"],"supplements":"s32"},
  {"id":"p48","name":"Assiette du Comptoir","description":"3 onion rings, 3 beignets de calamar, 2 viandes au choix","price":1990,"groups":["g12","g4"],"supplements":"s32"},
  {"id":"p49","name":"Bun's","description":"Pain bun toasté, viandes au choix","variants":[{"key":"M","name":"M — 1 viande","price":890},{"key":"L","name":"L — 2 viandes","price":990}],"groups":["g13","g4"],"supplements":"s32","photo":"/photos/mega-burger-long.webp"},
  {"id":"p50","name":"Panini au choix","description":"Merguez · Thon · Kebab · Steak · Poulet · Merguez ou poulet chorizo · Steak chèvre · Steak chèvre miel · Jambon de dinde","price":700,"groups":["g14","g15"],"supplements":"s33","photo":"/photos/panini-menu.webp"},
  {"id":"p51","name":"Panini 3 fromages","price":650,"groups":["g15"],"supplements":"s34"},
  {"id":"p52","name":"Panini Nutella","price":450,"supplements":"s35","isNew":true},
  {"id":"p53","name":"H1 — 2 steaks","description":"Cheddar, crudités & frites","price":790,"groups":["g4"],"supplements":"s4","removables":"r1","photo":"/photos/hummers-stack.webp"},
  {"id":"p54","name":"H2 — 4 steaks","description":"Cheddar, crudités & frites","price":990,"groups":["g4"],"supplements":"s4","removables":"r1","photo":"/photos/hummers-stack.webp"},
  {"id":"p55","name":"H3 — 6 steaks","description":"Cheddar, crudités & frites","price":1200,"groups":["g4"],"supplements":"s4","removables":"r1","photo":"/photos/hummers-stack.webp"},
  {"id":"p56","name":"H4 — 8 steaks","description":"Cheddar, crudités & frites","price":1490,"groups":["g4"],"supplements":"s4","removables":"r1","isNew":true,"photo":"/photos/hummers-stack.webp"},
  {"id":"p57","name":"Salade César","description":"Salade, tomates, poulet pané","price":750,"supplements":"s36","photo":"/photos/salade-cesar.webp"},
  {"id":"p58","name":"Salade Océane","description":"Salade, tomates, thon, olives","price":750,"supplements":"s35"},
  {"id":"p59","name":"Salade Lyonnaise","description":"Salade, tomates, œuf au plat, chèvre","price":750,"supplements":"s37"},
  {"id":"p60","name":"Salade Normande","description":"Salade, tomates, aubergine grillée, camembert, olives","price":750,"supplements":"s38","isNew":true},
  {"id":"p61","name":"Salade Andelloise","description":"Salade, tomates, avocat, olives noires, camembert, oignons rouges","price":750,"supplements":"s39","isNew":true},
  {"id":"p62","name":"Frites","variants":[{"key":"M","name":"M","price":350},{"key":"L","name":"L","price":450}],"supplements":"s35"},
  {"id":"p63","name":"Frites cheddar ou fromagère","variants":[{"key":"M","name":"M","price":450},{"key":"L","name":"L","price":550}],"supplements":"s35"},
  {"id":"p64","name":"Frites cheddar lardons","variants":[{"key":"M","name":"M","price":550},{"key":"L","name":"L","price":650}],"supplements":"s40"},
  {"id":"p65","name":"Viande (kebab ou poulet)","variants":[{"key":"M","name":"M","price":900},{"key":"L","name":"L","price":1100}],"supplements":"s2"},
  {"id":"p66","name":"Pain Suédois","description":"3 steaks ou escalope de poulet, crudités, œuf, frites","price":990,"groups":["g16","g4"],"supplements":"s1"},
  {"id":"p67","name":"Menu Enfant","description":"Au choix : cheeseburger, 5 nuggets, kebab ou mini tacos — frites + Capri-Sun ou compote","price":750,"groups":["g17","g18"],"supplements":"s2"},
  {"id":"p68","name":"Le Comptoir Dog","description":"Le classique généreux","price":690,"supplements":"s41"},
  {"id":"p69","name":"Le Royal Dog","description":"Saucisse, bacon, fromage, oignons frits","price":890,"supplements":"s42"},
  {"id":"p70","name":"Le Cheese Dog","description":"Double cheddar fondu à cœur","price":750,"supplements":"s27"},
  {"id":"p71","name":"Le Boss","description":"Pur bœuf, cheddar, onion rings, cornichons — le patron","price":1350,"supplements":"s4","tags":["Burger"],"photo":"/photos/smash-burger.webp"},
  {"id":"p72","name":"Le Bo Goss","description":"Escalope de poulet, jambon, œuf, tomate grillée, oignons frits","price":1250,"supplements":"s43","tags":["Burger"],"photo":"/photos/smash-burger.webp"},
  {"id":"p73","name":"Bling Bling","description":"Pur bœuf, escalope de poulet, crème balsamique, sauce maison, oignons frie","price":1250,"supplements":"s44","tags":["Burger"],"photo":"/photos/smash-burger.webp"},
  {"id":"p74","name":"Egg 180","description":"Steaks 180g, œuf, sauce cheddar, oignons grillés","price":1190,"supplements":"s45","tags":["Mega Burger"],"photo":"/photos/smash-burger.webp"},
  {"id":"p75","name":"Le Smash","description":"Smash burgers trempés dans une sauce cream cheese fondante","variants":[{"key":"simple","name":"Simple","price":950},{"key":"double","name":"Double","price":1250},{"key":"triple","name":"Triple","price":1490}],"supplements":"s4","photo":"/photos/smash-burger.webp"},
  {"id":"p76","name":"Le Smash Chicken","description":"La version poulet croustillant","price":950,"supplements":"s26","photo":"/photos/smash-burger.webp"},
  {"id":"p77","name":"Le Double Kif","description":"Double smash, double plaisir","price":1690,"supplements":"s4","tags":["1+1"],"photo":"/photos/smash-burger.webp"},
  {"id":"p78","name":"Crousty One","description":"Le plat qui cartonne — poulet crousty — Sauce crème (riz) ou sauce cheddar (pâtes & nouilles)","price":950,"groups":["g19"],"supplements":"s36","photo":"/photos/crousty-riz.webp"},
  {"id":"p79","name":"Nuggets","variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s46","photo":"/photos/nuggets.avif"},
  {"id":"p80","name":"Wings","variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s35"},
  {"id":"p81","name":"Mozza sticks","variants":[{"key":"5","name":"5 pcs","price":600},{"key":"10","name":"10 pcs","price":1100}],"supplements":"s35","photo":"/photos/mozza-stick.webp"},
  {"id":"p82","name":"Tenders","variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"supplements":"s47"},
  {"id":"p83","name":"Jalapeños","variants":[{"key":"5","name":"5 pcs","price":650},{"key":"10","name":"10 pcs","price":1200}]},
  {"id":"p84","name":"Samoussa","description":"Légumes · poulet · bœuf","variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"groups":["g20"],"isNew":true},
  {"id":"p85","name":"Nems","description":"Légumes · poulet · bœuf","variants":[{"key":"5","name":"5 pcs","price":750},{"key":"10","name":"10 pcs","price":1400}],"groups":["g20"],"isNew":true},
  {"id":"p86","name":"Beignets de calamar","variants":[{"key":"10","name":"10 pcs","price":650},{"key":"20","name":"20 pcs","price":1300}],"supplements":"s35","isNew":true},
  {"id":"p87","name":"Onion rings","variants":[{"key":"10","name":"10 pcs","price":650},{"key":"20","name":"20 pcs","price":1300}],"isNew":true},
  {"id":"p88","name":"Box Menu Solo","description":"5 tenders ou 5 wings + frites + 1 canette","price":990,"groups":["g21"],"supplements":"s35"},
  {"id":"p89","name":"Mix Box 1","description":"8 tenders · 8 wings","price":2190,"supplements":"s47"},
  {"id":"p90","name":"Mix Box 2","description":"8 tenders · 15 wings","price":2690,"supplements":"s47"},
  {"id":"p91","name":"Family Box","description":"14 tenders · 16 wings · 4 frites · 1 boisson 1,5 L","price":4290,"supplements":"s47"},
  {"id":"p92","name":"Family Big Box","description":"10 tenders · 10 wings · 5 beignets de calamar · 3 samoussas poulet · 3 nems poulet · 5 onion rings · 4 jalapeños · 5 frites · 1 boisson 1,5 L","price":5350,"supplements":"s47","tags":["La plus grosse"]},
  {"id":"p93","name":"Pot 100 ml","price":350},
  {"id":"p94","name":"Pot 500 ml","price":800},
  {"id":"p95","name":"Chocobon","price":390},
  {"id":"p96","name":"Tarte au Daim","price":350,"photo":"/photos/tarte-daim.webp"},
  {"id":"p97","name":"Cheesecake","price":350},
  {"id":"p98","name":"Tiramisu","price":350},
  {"id":"p99","name":"Fondant chocolat","price":350},
  {"id":"p100","name":"Milkshake Nature, vanille, fraise","description":"Coulis : fraise, caramel ou chocolat","variants":[{"key":"classique","name":"Classique","price":350},{"key":"xl","name":"XL","price":590}],"photo":"/photos/milkshake-oreo.webp"},
  {"id":"p101","name":"Milkshake Oréo ou Bueno","description":"Coulis : fraise, caramel ou chocolat","variants":[{"key":"classique","name":"Classique","price":400},{"key":"xl","name":"XL","price":690}],"photo":"/photos/milkshake-oreo.webp"},
  {"id":"p102","name":"Canette 33 cl","price":150,"photo":"/photos/boissons.webp"},
  {"id":"p103","name":"Bouteille 50 cl","price":250,"photo":"/photos/boissons.webp"},
  {"id":"p104","name":"Bouteille 1,5 L","price":350,"photo":"/photos/boissons.webp"},
  {"id":"p105","name":"Bouteille 2 L","price":390,"photo":"/photos/boissons.webp"},
  {"id":"p106","name":"Red Bull","price":300,"photo":"/photos/boissons.webp"},
  {"id":"p107","name":"Monster","price":350,"photo":"/photos/boissons.webp"},
  {"id":"p108","name":"Freez","price":300,"photo":"/photos/boissons.webp"},
  {"id":"p109","name":"Thé / Café","price":150,"photo":"/photos/boissons.webp"},
];

const CATEGORIES: { id: string; name: string; products: string[] }[] = [
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

/** Groupe « Suppléments » recomposé — même clé et mêmes bornes que l'API. */
function supplementGroup(setKey: string): RawGroup | null {
  const keys = SUPPLEMENT_SETS[setKey];
  if (!keys) return null;
  const choices = keys.flatMap((key) => {
    const supplement = SUPPLEMENTS[key];
    return supplement
      ? [{ key, name: supplement.name, priceDelta: supplement.priceDelta }]
      : [];
  });
  return choices.length === 0
    ? null
    : { key: "supplements", name: "Suppléments", type: "multi", min: 0, max: null, choices };
}

function hydrate(p: RawProduct): PublicSiteProduct {
  const groups: RawGroup[] = (p.groups ?? []).flatMap((key) => {
    const group = GROUPS[key];
    return group ? [group] : [];
  });
  const supplements = p.supplements ? supplementGroup(p.supplements) : null;
  return {
    _id: p.id,
    name: p.name,
    description: p.description ?? "",
    price: p.price ?? 0,
    variants: p.variants ?? [],
    optionGroups: supplements ? [...groups, supplements] : groups,
    removables: p.removables ? (REMOVABLE_SETS[p.removables] ?? []) : [],
    tags: p.tags ?? [],
    isNew: p.isNew ?? false,
    outOfStock: p.outOfStock ?? false,
    photoUrl: p.photo ?? null,
  };
}

/** La carte complète, dans la forme rendue par `GET /public/tenants/:slug/site`. */
export function demoCategories(): PublicSiteCategory[] {
  const byId = new Map<string, PublicSiteProduct>(
    PRODUCTS.map((p) => [p.id, hydrate(p)]),
  );
  return CATEGORIES.map((c) => ({
    _id: c.id,
    name: c.name,
    products: c.products.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    }),
  }));
}
