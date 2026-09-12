/** Repères de familles explicites. Aucun produit, recette ou média n'est déduit
 * de ces libellés ; une catégorie inconnue garde le symbole neutre du menu. */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  burger: ['burger', 'burgers', 'gourmet burgers', 'gourmets burgers', 'buns', "bun's", 'hummer', 'hummers'],
  smash: ['smash', 'smash burger', 'smash burgers'],
  tacos: ['tacos', 'compose ton tacos', 'tacos français'],
  wrap: ['wrap', 'wraps'],
  kebab: ['kebab', 'kebabs', 'shawarma'],
  panini: ['panini', 'paninis'],
  sandwich: ['sandwich', 'sandwichs', 'sandwiches', 'pain suédois'],
  dog: ['hot dog', 'hot dogs', 'hot-dog', 'hot-dogs'],
  bowl: ['bowl', 'bowls', 'le bowl', 'assiette', 'assiettes', 'crousty one'],
  leaf: ['salade', 'salades', 'végétarien', 'végétariens'],
  fries: ['frites', 'accompagnements', 'à-côtés'],
  box: ['barquette', 'barquettes', 'box', 'box à partager', 'tex-mex'],
  bag: ['menu enfant', 'menus enfants'],
  cup: ['boisson', 'boissons', 'drink', 'drinks', 'milkshake', 'milkshakes', 'jus', 'smoothie', 'smoothies'],
  coffee: ['café', 'cafés', 'coffee', 'boissons chaudes'],
  dessert: ['dessert', 'desserts', 'glace', 'glaces', 'tiramisu', 'tiramisus'],
  cookie: ['cookie', 'cookies'],
  pizza: ['pizza', 'pizzas', 'pizzeria'],
  wings: ['wings', 'ailes de poulet'],
  noodles: ['nouilles', 'noodles', 'pad thaï', 'pad thai'],
  rice: ['riz', 'riz thaï', 'riz sauté'],
  curry: ['curry', 'currys'],
  thai: ['thaï', 'thai', 'cuisine thaï'],
};

const normalize = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’‘]/g, "'").trim().replace(/\s+/g, ' ');
const ICON_BY_CATEGORY = new Map(Object.entries(FAMILIES).flatMap(([icon, names]) => names.map(name => [normalize(name), icon] as const)));

export function categoryIcon(name: string): string {
  return ICON_BY_CATEGORY.get(normalize(name)) ?? 'menu';
}
