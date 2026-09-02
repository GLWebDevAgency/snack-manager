/**
 * La carte de « Chez Nicolas » — snack de Rouen rive droite
 *
 * ── Pourquoi une vraie carte, et pas trois produits de test ─────────────────
 *
 * Un « Produit A » à 10 € ne révèle rien. Les défauts d'un logiciel de caisse
 * se cachent dans ce qui rend une carte réelle compliquée : un tacos dont le
 * nombre de viandes dépend de la taille, un gratiné qui coûte plus cher en XL,
 * un pain payant, des sauces limitées à deux, des ingrédients qu'on retire.
 * Cette carte reprend donc les mécaniques du vrai menu du dépôt.
 *
 * ── Les règles qui font échouer un appel naïf ───────────────────────────────
 *
 *  · Les prix sont en CENTIMES ENTIERS. `8.90` est refusé par le schéma Zod
 *    (`z.number().int()`), il faut écrire `890`.
 *  · `max` est `.int().positive()` : **`max: 0` est refusé**. Pour « autant
 *    qu'on veut », il faut OMETTRE la clé, pas la mettre à zéro.
 *  · Les clés de `perVariant` doivent correspondre au caractère près à un
 *    `variants[].key`. Rien ne le vérifie — le champ est `Mixed` côté Mongoose
 *    — et une clé fautive est ignorée en silence, donc jamais détectée.
 *  · La clé de groupe `"supplements"` est RÉSERVÉE : le serveur la projette
 *    depuis les ingrédients et la retire des réponses. D'où `supp-1-00`,
 *    `supp-1-50`, `supp-0-80`.
 */

export const CATEGORIES = [
  { key: 'tacos', name: 'Compose ton Tacos', order: 0 },
  { key: 'burgers', name: 'Gourmets Burgers', order: 1 },
  { key: 'sandwichs', name: 'Sandwichs & Kebabs', order: 2 },
  { key: 'texmex', name: 'Tex-Mex', order: 3 },
  { key: 'assiettes', name: 'Assiettes', order: 4 },
  { key: 'boissons', name: 'Boissons', order: 5 },
  { key: 'desserts', name: 'Desserts', order: 6 },
];

const VIANDES = [
  'Kebab', 'Steak', 'Kefta', 'Poulet', 'Tikka',
  'Tandoori', 'Cordon bleu', 'Nuggets', 'Merguez', 'Tenders',
].map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name, priceDelta: 0 }));

const SAUCES = [
  'Ketchup', 'Mayonnaise', 'Samouraï', 'Andalouse', 'Algérienne',
  'Blanche', 'Harissa', 'Barbecue', 'Curry', 'Biggy', 'Poivre',
].map((name) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name, priceDelta: 0 }));

/** Les trois paliers de suppléments, repris du vrai menu. */
const SUPPLEMENTS = [
  {
    key: 'supp-1-00',
    name: 'Suppléments +1,00 €',
    type: 'multi',
    min: 0,
    choices: ['Cheddar', 'Chèvre', 'Bleu', 'Boursin', 'Œuf', 'Raclette'].map((name) => ({
      key: name.toLowerCase().replace(/[^a-z]/g, ''),
      name,
      priceDelta: 100,
    })),
  },
  {
    key: 'supp-1-50',
    name: 'Suppléments +1,50 €',
    type: 'multi',
    min: 0,
    choices: ['Lardons', 'Bacon', 'Chorizo'].map((name) => ({
      key: name.toLowerCase(),
      name,
      priceDelta: 150,
    })),
  },
  {
    key: 'supp-0-80',
    name: 'Suppléments +0,80 €',
    type: 'multi',
    min: 0,
    choices: ['Champignons', 'Poivrons', 'Oignons frits'].map((name) => ({
      key: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      priceDelta: 80,
    })),
  },
];

const GROUPE_SAUCES = { key: 'sauces', name: 'Sauces (2 au choix)', type: 'multi', min: 0, max: 2, choices: SAUCES };

/** Un accompagnement payant — la mécanique du « pain payant » du vrai menu. */
const GROUPE_FORMULE = {
  key: 'formule',
  name: 'En menu',
  type: 'single',
  min: 0,
  max: 1,
  choices: [
    { key: 'frites-boisson', name: 'Frites + boisson 33 cl', priceDelta: 350 },
    { key: 'potatoes-boisson', name: 'Potatoes + boisson 33 cl', priceDelta: 400 },
  ],
};

const RETIRABLES = ['salade', 'tomate', 'oignons', 'cornichons'];

export const PRODUITS = [
  // ── Le produit de référence : toutes les mécaniques de tarification ────────
  {
    categorie: 'tacos',
    name: 'Compose ton Tacos',
    description: 'Taille, viandes, suppléments, sauces — servi avec frites',
    price: 0,
    order: 0,
    isNew: true,
    tags: ['signature'],
    removables: RETIRABLES,
    variants: [
      { key: 'M', name: 'M — 1 viande', price: 890 },
      { key: 'L', name: 'L — 2 viandes', price: 990 },
      { key: 'XL', name: 'XL — 3 viandes', price: 1250 },
      { key: 'XXL', name: 'XXL — 4 viandes', price: 1450 },
    ],
    optionGroups: [
      {
        key: 'viandes',
        name: 'Viandes',
        type: 'multi',
        min: 1,
        max: 4,
        choices: VIANDES,
        // Le nombre de viandes suit la taille : c'est là que se cachent les
        // erreurs de calcul de prix, et donc là qu'il faut regarder.
        perVariant: { M: { min: 1, max: 1 }, L: { min: 2, max: 2 }, XL: { min: 3, max: 3 }, XXL: { min: 4, max: 4 } },
      },
      ...SUPPLEMENTS,
      {
        key: 'gratine',
        name: 'Gratiné',
        type: 'single',
        min: 0,
        max: 1,
        choices: [{ key: 'gratine', name: 'Tacos gratiné', priceDelta: 150 }],
        // Le même supplément coûte plus cher sur les grandes tailles.
        perVariant: { XL: { priceDelta: 200 }, XXL: { priceDelta: 200 } },
      },
      GROUPE_SAUCES,
    ],
  },

  // ── Burgers ───────────────────────────────────────────────────────────────
  { categorie: 'burgers', name: 'Le Smash', description: 'Double smash, cheddar affiné, oignons confits', price: 990, order: 0, tags: ['best-seller'], removables: RETIRABLES, optionGroups: [GROUPE_FORMULE, ...SUPPLEMENTS.slice(0, 1), GROUPE_SAUCES] },
  { categorie: 'burgers', name: 'Le Rouennais', description: 'Steak charolais, camembert, pomme, sauce cidre', price: 1190, order: 1, isNew: true, removables: RETIRABLES, optionGroups: [GROUPE_FORMULE, GROUPE_SAUCES] },
  { categorie: 'burgers', name: 'Chicken Crispy', description: 'Poulet pané maison, cheddar, sauce biggy', price: 950, order: 2, removables: RETIRABLES, optionGroups: [GROUPE_FORMULE, GROUPE_SAUCES] },
  { categorie: 'burgers', name: 'Le Végé', description: 'Galette pois chiches, chèvre, miel', price: 920, order: 3, tags: ['vegetarien'], removables: RETIRABLES, optionGroups: [GROUPE_FORMULE, GROUPE_SAUCES] },
  { categorie: 'burgers', name: 'Big Nicolas', description: 'Triple steak, triple cheddar, bacon — pour les affamés', price: 1490, order: 4, tags: ['signature'], removables: RETIRABLES, optionGroups: [GROUPE_FORMULE, ...SUPPLEMENTS, GROUPE_SAUCES] },

  // ── Sandwichs & kebabs ────────────────────────────────────────────────────
  {
    categorie: 'sandwichs',
    name: 'Kebab',
    description: 'Galette ou pain, salade, tomate, oignons',
    price: 0,
    order: 0,
    removables: RETIRABLES,
    variants: [
      { key: 'galette', name: 'Galette', price: 750 },
      { key: 'pain', name: 'Pain', price: 750 },
      { key: 'assiette', name: 'Assiette', price: 1150 },
    ],
    optionGroups: [{ key: 'viande-kebab', name: 'Viande', type: 'single', min: 1, max: 1, choices: VIANDES.slice(0, 6) }, GROUPE_SAUCES],
  },
  { categorie: 'sandwichs', name: 'Américain', description: 'Steak, frites dedans, sauce au choix', price: 800, order: 1, removables: RETIRABLES, optionGroups: [GROUPE_SAUCES] },
  { categorie: 'sandwichs', name: 'Panini 3 fromages', description: 'Mozzarella, chèvre, emmental', price: 650, order: 2, tags: ['vegetarien'], optionGroups: [GROUPE_SAUCES] },
  { categorie: 'sandwichs', name: 'Bruschetta poulet', description: 'Poulet mariné, mozzarella, tomates confites', price: 890, order: 3, optionGroups: [GROUPE_SAUCES] },

  // ── Tex-Mex ───────────────────────────────────────────────────────────────
  { categorie: 'texmex', name: 'Tenders (5 pièces)', description: 'Filets de poulet panés, sauce au choix', price: 690, order: 0, optionGroups: [GROUPE_SAUCES] },
  { categorie: 'texmex', name: 'Nuggets (8 pièces)', description: '', price: 590, order: 1, optionGroups: [GROUPE_SAUCES] },
  { categorie: 'texmex', name: 'Wings (6 pièces)', description: 'Ailes marinées, épicées ou barbecue', price: 650, order: 2, optionGroups: [GROUPE_SAUCES] },
  { categorie: 'texmex', name: 'Mozza sticks (6 pièces)', description: '', price: 590, order: 3, tags: ['vegetarien'], optionGroups: [GROUPE_SAUCES] },
  { categorie: 'texmex', name: 'Jalapeños (6 pièces)', description: 'Piments farcis au cheddar', price: 620, order: 4, tags: ['epice', 'vegetarien'], optionGroups: [GROUPE_SAUCES] },

  // ── Assiettes ─────────────────────────────────────────────────────────────
  { categorie: 'assiettes', name: 'Assiette kebab', description: 'Viande, frites, salade, sauce', price: 1150, order: 0, removables: RETIRABLES, optionGroups: [GROUPE_SAUCES] },
  { categorie: 'assiettes', name: 'Assiette mixte', description: 'Deux viandes au choix, frites, salade', price: 1350, order: 1, removables: RETIRABLES, optionGroups: [{ key: 'viandes-assiette', name: 'Viandes (2 au choix)', type: 'multi', min: 2, max: 2, choices: VIANDES.slice(0, 8) }, GROUPE_SAUCES] },
  { categorie: 'assiettes', name: 'Salade César', description: 'Poulet grillé, parmesan, croûtons', price: 1050, order: 2, removables: ['croûtons', 'parmesan'] },

  // ── Boissons ──────────────────────────────────────────────────────────────
  { categorie: 'boissons', name: 'Coca-Cola', description: '', price: 0, order: 0, variants: [{ key: '33', name: '33 cl', price: 200 }, { key: '50', name: '50 cl', price: 250 }, { key: '150', name: '1,5 L', price: 350 }] },
  { categorie: 'boissons', name: 'Coca-Cola Zéro', description: '', price: 0, order: 1, variants: [{ key: '33', name: '33 cl', price: 200 }, { key: '50', name: '50 cl', price: 250 }] },
  { categorie: 'boissons', name: 'Oasis Tropical', description: '', price: 200, order: 2 },
  { categorie: 'boissons', name: 'Ice Tea Pêche', description: '', price: 200, order: 3 },
  { categorie: 'boissons', name: 'Eau minérale 50 cl', description: '', price: 150, order: 4 },
  { categorie: 'boissons', name: 'Jus d’orange pressé', description: 'Pressé à la commande', price: 350, order: 5 },

  // ── Desserts ──────────────────────────────────────────────────────────────
  { categorie: 'desserts', name: 'Tiramisu maison', description: 'Préparé le matin', price: 390, order: 0, tags: ['maison'] },
  { categorie: 'desserts', name: 'Brownie chocolat', description: 'Servi tiède', price: 350, order: 1 },
  { categorie: 'desserts', name: 'Tarte normande', description: 'Pommes du pays de Caux', price: 420, order: 2, tags: ['maison', 'local'] },
  { categorie: 'desserts', name: 'Milkshake', description: '', price: 0, order: 3, variants: [{ key: 'vanille', name: 'Vanille', price: 450 }, { key: 'fraise', name: 'Fraise', price: 450 }, { key: 'oreo', name: 'Oreo', price: 500 }] },
];

/** L'équipe : un gérant, deux postes en salle, la cuisine. */
export const EQUIPE = [
  { name: 'Nicolas Perrin', role: 'gerant', pin: '1904' },
  { name: 'Sofia', role: 'caisse', pin: '2210' },
  { name: 'Malik', role: 'caisse', pin: '3311' },
  { name: 'Cuisine', role: 'cuisine', pin: '4422' },
];

/** Fermé le lundi midi et le dimanche midi — un vrai rythme de quartier. */
export const HORAIRES = [
  { day: 1, lunch: null, dinner: { open: '18:00', close: '23:00' } },
  { day: 2, lunch: { open: '11:30', close: '14:30' }, dinner: { open: '18:00', close: '23:00' } },
  { day: 3, lunch: { open: '11:30', close: '14:30' }, dinner: { open: '18:00', close: '23:00' } },
  { day: 4, lunch: { open: '11:30', close: '14:30' }, dinner: { open: '18:00', close: '23:00' } },
  { day: 5, lunch: { open: '11:30', close: '14:30' }, dinner: { open: '18:00', close: '23:30' } },
  { day: 6, lunch: { open: '11:30', close: '15:00' }, dinner: { open: '18:00', close: '23:30' } },
  { day: 7, lunch: null, dinner: { open: '18:30', close: '22:30' } },
];

export const ETABLISSEMENT = {
  slug: 'chez-nicolas',
  name: 'Chez Nicolas',
  gerant: { nom: 'Nicolas Perrin', email: 'nicolas@chez-nicolas.fr', telephone: '06 71 24 89 03' },
  adresse: '27 rue Saint-Nicolas, 76000 Rouen',
  telephones: ['02 35 71 04 88', '06 71 24 89 03'],
  couleur: '#d1452b',
  facturation: {
    legalName: 'CHEZ NICOLAS SARL',
    legalForm: 'SARL au capital de 10 000 €',
    siret: '12345682400002',
    vatNumber: 'FR40123456824',
    address: '27 rue Saint-Nicolas, 76000 Rouen',
    email: 'compta@chez-nicolas.fr',
  },
};
