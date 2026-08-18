// Données du menu Class'Food — PRIX À JOUR (relevés en boutique, juin 2026)
window.MENU = {
  brand: {
    name: "CLASS'FOOD",
    tagline: "Burgers · Tacos · Sandwichs · Tex-Mex",
    phones: ["09 84 36 49 76", "07 45 70 13 53"],
    address: "63 rue du Général de Gaulle — 27910 Perriers-sur-Andelle",
    hours: "Tous les jours - 7J/7",
    hoursDetail: "11h30–14h30 & 18h00–22h30 · Lundi & Vendredi : soir uniquement",
  },

  sandwichs: {
    title: "Sandwichs",
    note: "Tous servis avec crudités & frites — version galette +0,50 €",
    items: [
      { n: "Kebab", p: "7,50", d: "Viande kebab marinée" },
      { n: "Végétarien", p: "7,50", d: "Galette de pomme de terre, œuf" },
      { n: "Merguez", p: "7,50", d: "Deux merguez grillées" },
      { n: "2 Steaks", p: "7,90", d: "Deux steaks, fromage" },
      { n: "3 Steaks", p: "8,90", d: "Trois steaks, fromage" },
      { n: "4 Steaks", p: "9,90", d: "Quatre steaks, fromage" },
      { n: "Kebab Fromage", p: "8,50", d: "Kebab, fromage au choix" },
      { n: "Chèvre Miel", p: "9,50", d: "Viande kebab, chèvre, miel" },
      { n: "Kefta", p: "9,50", d: "Viande hachée épicée, fromage" },
      { n: "Tikka", p: "9,50", d: "Poulet tikka" },
      { n: "Tandoori", p: "9,50", d: "Poulet mariné tandoori", isNew: true },
      { n: "Le Boursin", p: "9,50", d: "Poulet, Boursin fondant", isNew: true },
      { n: "Escalope Normande", p: "9,90", d: "Escalope panée, camembert, champignons", isNew: true },
      { n: "Spécial", p: "9,90", d: "Viande kebab, merguez" },
      { n: "Radical", p: "9,90", d: "Deux steaks, deux merguez, fromage" },
      { n: "Duo", p: "9,50", d: "Deux steaks, cordon bleu, fromage" },
      { n: "Mexicain", p: "9,50", d: "Viande au choix, chorizo, poivrons" },
      { n: "Suprême", p: "9,50", d: "Viande kebab, champignons, emmental" },
      { n: "Buffalo", p: "9,50", d: "Deux steaks, bacon, fromage, œuf" },
      { n: "Royal", p: "9,50", d: "Steak, viande kebab" },
      { n: "Beldi", p: "9,50", d: "Viande hachée, œuf, fromage" },
      { n: "Maxi Kebab", p: "9,90", d: "Double viande kebab" },
      { n: "Galette 4 Fromages", p: "9,90", d: "Kebab, 4 fromages", isNew: true },
      { n: "Galette Burrata", p: "11,00", d: "Kebab ou tenders, burrata, tomate grillée, crème balsamique", isNew: true },
    ],
  },

  burgers: {
    title: "Gourmets Burgers",
    note: "Pain brioché toasté · salade · tomates · oignons rouges · cornichons",
    items: [
      { n: "Le Classic", p: "9,50", d: "Steak haché 130 g, cheddar" },
      { n: "Le Crousty", p: "12,50", d: "Steak 130 g, poulet crousty, cheddar" },
      { n: "Le Chèvre Miel", p: "12,50", d: "Steak 130 g, chèvre, miel" },
      { n: "Le Gourmet", p: "12,50", d: "Steak 130 g, œuf, bacon, cheddar" },
      { n: "Le Montagnard", p: "12,50", d: "Steak 130 g, œuf, raclette fondante" },
      { n: "Le Red", p: "12,50", d: "Steak 130 g, camembert, lardons grillés", isNew: true },
      { n: "Le Black", p: "12,50", d: "Steak 130 g, bleu, bacon", isNew: true },
      { n: "Le King", p: "14,90", d: "Double steak 130 g, œuf, cheddar" },
    ],
  },

  classiques: {
    title: "Les Classiques",
    note: "Servis avec crudités & frites",
    items: [
      { n: "Cheese", p: "5,50", d: "Steak, cheddar" },
      { n: "Double Cheese", p: "7,00", d: "Deux steaks, double cheddar" },
      { n: "Triple Cheese", p: "8,00", d: "Trois steaks, triple cheddar" },
      { n: "Chicken", p: "7,50", d: "Poulet pané, cheddar" },
      { n: "Fish", p: "7,50", d: "Poisson pané, cheddar" },
      { n: "Veggi", p: "7,50", d: "Galette multi-céréales, œuf, légumes" },
      { n: "Texan", p: "9,50", d: "Deux steaks, cheddar, œuf, bacon" },
      { n: "Farci", p: "9,50", d: "Viande hachée marinée, œuf, fromage" },
      { n: "Country", p: "9,50", d: "Deux steaks 45 g, galette PDT, cheddar" },
      { n: "Le 180", p: "9,50", d: "Steak 180 g, cheddar", tag: "Mega Burger" },
      { n: "Le 360", p: "13,00", d: "Deux steaks 180 g, cheddar", tag: "Mega Burger" },
      { n: "Le 540", p: "16,00", d: "Trois steaks 180 g, cheddar", tag: "Mega Burger" },
    ],
  },

  bowl: {
    title: "Class Bowl",
    isNew: true,
    d: "Frites, sauce fromagère, mozzarella · poivrons, champignons, aubergine, oignons frits",
    prices: [
      { n: "Veggi", p: "7,90" },
      { n: "1 viande", p: "9,50" },
      { n: "2 ou 3 viandes", p: "12,50" },
    ],
  },

  tacos: {
    title: "Compose ton Tacos",
    sizes: [
      { n: "M", d: "1 viande", p: "8,90" },
      { n: "L", d: "2 viandes", p: "9,90" },
      { n: "XL", d: "3 viandes", p: "12,50" },
      { n: "XXL", d: "4 viandes", p: "14,50" },
    ],
    viandes: ["Kebab", "Steak", "Kefta", "Poulet", "Tikka", "Tandoori", "Cordon bleu", "Nuggets", "Merguez", "Tenders"],
    supp100: ["Cheddar", "Chèvre", "Bleu", "Boursin", "Miel", "Œuf", "Reblochon", "Raclette", "Camembert"],
    supp150: ["Lardons", "Bacon", "Jambon de dinde", "Chorizo"],
    supp080: ["Champignons", "Avocat", "Poivrons", "Aubergine", "Oignons frits"],
    gratine: { n: "Tacos gratiné", ml: "+1,50", xl: "+2,00" },
  },

  assiettes: {
    title: "Assiettes",
    rows: [
      { n: "M", d: "1 viande", p: "12,00" },
      { n: "L", d: "2 viandes", p: "14,50" },
      { n: "XL", d: "3 viandes", p: "17,00" },
    ],
    special: { n: "Assiette Class'Food", d: "3 onion rings, 3 beignets de calamar, 2 viandes au choix", p: "19,90" },
  },

  buns: {
    title: "Bun's",
    rows: [
      { n: "M", d: "1 viande", p: "8,90" },
      { n: "L", d: "2 viandes", p: "9,90" },
    ],
  },

  paninis: {
    title: "Paninis",
    base: "Merguez · Thon · Kebab · Steak · Poulet · Merguez ou poulet chorizo · Steak chèvre · Steak chèvre miel · Jambon de dinde",
    rows: [
      { n: "Au choix", p: "7,00" },
      { n: "3 fromages", p: "6,50" },
      { n: "Nutella", p: "4,50", isNew: true },
      { n: "Supplément frites seules", p: "+1,50" },
    ],
  },

  sauces: ["Ketchup", "Mayonnaise", "Samouraï", "Andalouse", "Poivre", "Biggy", "Blanche maison", "Harissa", "Cheesy", "Moutarde", "Algérienne"],

  hummers: {
    title: "Hummers",
    note: "Cheddar, crudités & frites",
    rows: [
      { n: "H1", d: "2 steaks", p: "7,90" },
      { n: "H2", d: "4 steaks", p: "9,90" },
      { n: "H3", d: "6 steaks", p: "12,00" },
      { n: "H4", d: "8 steaks", p: "14,90", isNew: true },
    ],
  },

  salades: {
    title: "Salades",
    price: "7,50",
    items: [
      { n: "César", d: "Salade, tomates, poulet pané" },
      { n: "Océane", d: "Salade, tomates, thon, olives" },
      { n: "Lyonnaise", d: "Salade, tomates, œuf au plat, chèvre" },
      { n: "Normande", d: "Salade, tomates, aubergine grillée, camembert, olives", isNew: true },
      { n: "Andelloise", d: "Salade, tomates, avocat, olives noires, camembert, oignons rouges", isNew: true },
    ],
  },

  barquettes: {
    title: "Barquettes",
    cols: ["M", "L"],
    rows: [
      { n: "Frites", m: "3,50", l: "4,50" },
      { n: "Frites cheddar ou fromagère", m: "4,50", l: "5,50" },
      { n: "Frites cheddar lardons", m: "5,50", l: "6,50" },
      { n: "Viande (kebab ou poulet)", m: "9,00", l: "11,00" },
    ],
  },

  suedois: {
    title: "Pain Suédois",
    p: "9,90",
    d: "3 steaks ou escalope de poulet, crudités, œuf, frites",
  },

  enfant: {
    title: "Menu Enfant",
    p: "7,50",
    d: "Au choix : cheeseburger, 5 nuggets, kebab ou mini tacos — frites + Capri-Sun ou compote",
  },

  glaces: {
    title: "Glaces",
    rows: [
      { n: "Pot 100 ml", p: "3,50" },
      { n: "Pot 500 ml", p: "8,00" },
      { n: "Chocobon", p: "3,90" },
    ],
  },

  desserts: {
    title: "Desserts",
    price: "3,50",
    items: ["Tarte au Daim", "Cheesecake", "Tiramisu", "Fondant chocolat"],
  },

  milkshakes: {
    title: "Milkshakes",
    note: "Coulis : fraise, caramel ou chocolat",
    rows: [
      { n: "Nature, vanille, fraise", p: "3,50", xl: "5,90" },
      { n: "Oréo ou Bueno", p: "4,00", xl: "6,90" },
    ],
  },

  boissons: {
    title: "Boissons",
    rows: [
      { n: "Canette 33 cl", p: "1,50" },
      { n: "Bouteille 50 cl", p: "2,50" },
      { n: "Bouteille 1,5 L", p: "3,50" },
      { n: "Bouteille 2 L", p: "3,90" },
      { n: "Red Bull", p: "3,00" },
      { n: "Monster", p: "3,50" },
      { n: "Freez", p: "3,00" },
      { n: "Thé / Café", p: "1,50" },
    ],
  },

  texmex: {
    title: "Tex-Mex",
    cols: ["5 pcs", "10 pcs"],
    rows: [
      { n: "Nuggets", m: "6,00", l: "11,00" },
      { n: "Wings", m: "6,00", l: "11,00" },
      { n: "Mozza sticks", m: "6,00", l: "11,00" },
      { n: "Tenders", m: "7,50", l: "14,00" },
      { n: "Jalapeños", m: "6,50", l: "12,00" },
      { n: "Samoussa", sub: "Légumes · poulet · bœuf", m: "7,50", l: "14,00", isNew: true },
      { n: "Nems", sub: "Légumes · poulet · bœuf", m: "7,50", l: "14,00", isNew: true },
    ],
    soloRows: [
      { n: "Beignets de calamar", q1: "10 pcs", p1: "6,50", q2: "20 pcs", p2: "13,00", isNew: true },
      { n: "Onion rings", q1: "10 pcs", p1: "6,50", q2: "20 pcs", p2: "13,00", isNew: true },
    ],
  },

  boxes: {
    title: "Box à Partager",
    note: "Le meilleur de Class'Food à partager — frites & boisson incluses sur les Family",
    solo: {
      n: "Box Menu Solo",
      d: "5 tenders ou 5 wings + frites + 1 canette",
      p: "9,90",
    },
    mix: [
      { n: "Mix Box 1", d: "8 tenders · 8 wings", p: "21,90" },
      { n: "Mix Box 2", d: "8 tenders · 15 wings", p: "26,90" },
    ],
    family: {
      n: "Family Box",
      d: "14 tenders · 16 wings · 4 frites · 1 boisson 1,5 L",
      p: "42,90",
    },
    bigbox: {
      n: "Family Big Box",
      tag: "La plus grosse",
      lines: ["10 tenders", "10 wings", "5 beignets de calamar", "3 samoussas poulet", "3 nems poulet", "5 onion rings", "4 jalapeños", "5 frites", "1 boisson 1,5 L"],
      p: "53,50",
    },
  },

  hotdogs: {
    title: "Hot Dogs",
    note: "Pain moelleux toasté, servis avec frites",
    items: [
      { n: "Le Class Dog", p: "6,90", d: "Le classique généreux" },
      { n: "Le Royal Dog", p: "8,90", d: "Saucisse, bacon, fromage, oignons frits" },
      { n: "Le Cheese Dog", p: "7,50", d: "Double cheddar fondu à cœur" },
    ],
  },

  signatures: {
    title: "Les Signatures",
    note: "Nos créations maison — viandes du jour, montage minute",
    items: [
      { n: "Le Boss", p: "13,50", d: "Pur bœuf, cheddar, onion rings, cornichons — le patron", bread: "Burger" },
      { n: "Le Bo Goss", p: "12,50", d: "Escalope de poulet, jambon, œuf, tomate grillée, oignons frits", bread: "Burger" },
      { n: "Bling Bling", p: "12,50", d: "Pur bœuf, escalope de poulet, crème balsamique, sauce maison, oignons frie", bread: "Burger" },
      { n: "Egg 180", p: "11,90", d: "Steaks 180g, œuf, sauce cheddar, oignons grillés", bread: "Mega Burger" },
      { n: "Le Smash", d: "Smash burgers trempés dans une sauce cream cheese fondante", sizes: [{ label: "Simple", p: "9,50" }, { label: "Double", p: "12,50" }, { label: "Triple", p: "14,90" }] },
      { n: "Le Smash Chicken", p: "9,50", d: "La version poulet croustillant" },
      { n: "Le Double Kif", p: "16,90", d: "Double smash, double plaisir", tag: "1+1" },
    ],
  },

  crousty: {
    title: "Crousty One",
    note: "Le plat qui cartonne — poulet crousty",
    price: "9,50",
    choices: "Riz · Pâtes · Nouilles",
    compo: "Sauce crème (riz) ou sauce cheddar (pâtes & nouilles)",
    items: [
      { n: "Crousty One — Riz", p: "9,50", d: "Poulet crousty, riz, sauce crème" },
      { n: "Crousty One — Pâtes ou Nouilles", p: "9,50", d: "Poulet crousty, pâtes ou nouilles, sauce cheddar" },
    ],
  },
};
