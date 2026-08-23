import type { AnyBulkWriteOperation } from 'mongoose';
import type { Lead } from '@sm/db';

/**
 * LA LISTE DE PROSPECTION RÉELLE — à ne pas confondre avec `crm.seed.ts`.
 *
 * Le seed est une fiction de démonstration, réservée aux environnements où
 * `SM_DEMO_SEED=on`. Cette liste-ci est l'inverse : de vrais établissements,
 * relevés un par un dans des sources publiques (Pages Jaunes, pages Facebook
 * des établissements, annuaires, presse locale) le 23/08/2026, pour lancer la
 * prospection terrain. Elle n'est écrite QUE là où la démo est coupée — en
 * production — par `CrmService.ensureProspected`.
 *
 * Ciblage arrêté avec le fondateur : des snacks indépendants au profil de
 * Class'Food (kebab, tacos, burger, pizza à emporter, friterie), dans les
 * bourgs normands autour de Rouen où Uber Eats et Deliveroo ne livrent pas —
 * vallée de l'Andelle comme Perriers-sur-Andelle, Vexin normand, pays de
 * Bray, pays de Caux, sud de l'Eure. L'absence de plateforme est une
 * HEURISTIQUE (communes rurales hors zones de course), vérifiée quand une
 * source le permettait ; elle se confirme au premier appel.
 *
 * Règles de la liste :
 * - chaque établissement provient d'une source publique consultée — aucun
 *   nom « plausible », aucun numéro reconstitué : un téléphone absent reste
 *   vide, un numéro faux ferait perdre un appel et la face ;
 * - le modèle `leads` ne portant pas de champ « ville », la ville ouvre la
 *   note, suivie de la source entre parenthèses — même convention que le
 *   seed ;
 * - tout entre en étape « nouveau », sans séquence : le pipeline se joue au
 *   téléphone, pas dans un import.
 */

export type ProspectionLead = {
  restaurantName: string;
  contact: { name: string; phone: string; email: string };
  notes: string;
};

/**
 * Chaque fiche a été relevée par une première recherche PUIS contre-vérifiée
 * par une seconde passe indépendante (existence, fermeture, attribution du
 * numéro) le 23/08/2026. Les réserves qui restaient après ces deux passes
 * sont écrites dans la note — jamais gommées : c'est au téléphone qu'elles
 * se lèvent. Un établissement réfuté (liquidation, fermeture avérée) n'entre
 * pas dans la liste.
 */
export const PROSPECTION_LEADS: readonly ProspectionLead[] = [
  // ── Pays de Caux & boucles de Seine ──
  {
    restaurantName: 'Atlas Kebab',
    contact: { name: '', phone: '02 32 70 45 32', email: '' },
    notes:
      'Doudeville (76), 7 rue Cacheleu — kebab-snack du bourg : sandwichs, pizzas, sur place et à emporter ; page Facebook propre, recoupé sur quatre annuaires (source : sitloc.fr, pagesjaunes.fr).',
  },
  {
    restaurantName: 'La Bonne Broche',
    contact: { name: '', phone: '09 80 38 37 59', email: '' },
    notes:
      'Doudeville (76), 13 rue Félix Faure — döner kebab, deuxième enseigne du bourg, recoupée jusqu’au site municipal (source : bottin.fr, doudeville.fr).',
  },
  {
    restaurantName: 'Pizza Chez Vous',
    contact: { name: '', phone: '02 35 16 00 00', email: '' },
    notes:
      'Yerville (76), 1 boulevard Delahaye — pizzeria à emporter et livraison depuis 2016, pâte maison, 7 j/7 le soir, 4,1/5 sur plus de 1 200 avis, très active sur les réseaux (source : pizzachezvous.fr, tripadvisor.com).',
  },
  {
    restaurantName: 'Duclair Food',
    contact: { name: '', phone: '09 86 06 69 31', email: '' },
    notes:
      'Duclair (76), 36 rue Pavée — restauration rapide sur place et à emporter, immatriculation active (source : pagesjaunes.fr, societe.com).',
  },
  {
    restaurantName: 'Au Croque Express',
    contact: { name: '', phone: '02 35 95 09 24', email: '' },
    notes:
      'Rives-en-Seine, Caudebec-en-Caux (76), 16 rue Aristide Cauchois — kebab-burger depuis 1999, pain de boulanger et frites maison, cité parmi les meilleurs kebabs de France par Normandie Tourisme ; gérant prénommé Marcus (source : rives-en-seine.fr, normandie-tourisme.fr).',
  },
  {
    restaurantName: 'Bouche Kebab',
    contact: { name: '', phone: '02 35 97 65 32', email: '' },
    notes:
      'Cany-Barville (76), 15 rue du Général de Gaulle — kebab de la rue principale, carte en ligne, recoupé jusqu’au site municipal (source : cany-barville.fr, bottin.fr).',
  },
  {
    restaurantName: 'Le Gyros',
    contact: { name: '', phone: '02 35 97 50 25', email: '' },
    notes:
      'Saint-Valery-en-Caux (76), 15 place de la Chapelle — kebab midi et soir 6 j/7, à emporter et livraison, avis récents ; couverture Uber Eats à vérifier sur place (source : legyros.com, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Pizza Antonio au Feu de Bois',
    contact: { name: '', phone: '02 32 90 15 30', email: '' },
    notes:
      'Luneray (76), 23 place René Coty — pizzeria au feu de bois, plats à emporter, sur la place principale (source : pagesjaunes.fr, yelp.fr).',
  },
  {
    restaurantName: 'Kebab Istanbul',
    contact: { name: '', phone: '02 32 42 10 82', email: '' },
    notes:
      'Bourg-Achard (27), 260 Grande Rue — kebab-tacos de la Grande Rue, ouvert le dimanche, avis positifs (source : pagesjaunes.fr, kebab-frites.com).',
  },
  {
    restaurantName: 'Pizz Party',
    contact: { name: '', phone: '02 35 78 49 80', email: '' },
    notes:
      'Grand Bourgtheroulde (27), 199 Grande Rue — snack multi-offre : pizzas, kebab à la broche, tacos ; 4,3/5 sur 254 avis (source : bottin.fr, annuaire-entreprises.data.gouv.fr).',
  },
  {
    restaurantName: 'Ceasar Pizza',
    contact: { name: '', phone: '02 32 42 18 36', email: '' },
    notes:
      'Routot (27), avenue du Général de Gaulle (n° 33 ou 48 selon l’annuaire) — pizzeria à emporter, mardi-dimanche en soirée (source : pagesjaunes.fr, mairie de Routot).',
  },
  {
    restaurantName: 'Le Moulin à Pizza',
    contact: { name: '', phone: '02 32 57 08 44', email: '' },
    notes:
      'Montfort-sur-Risle (27), 46 rue Saint-Pierre — pizzeria du soir, fermée le lundi (source : bakus.fr, yelp.fr).',
  },

  // ── Vallée de l’Andelle & Vexin normand ──
  {
    restaurantName: 'Kebab Fleury Royal',
    contact: { name: '', phone: '02 32 49 60 46', email: '' },
    notes:
      'Fleury-sur-Andelle (27), 56 rue Pouyer-Quertier — kebab classé premier des quatre fast-foods du bourg (4,1/5), midi et soir ; aussi référencé sous son ancien nom Royal Sandwich (source : pagesjaunes.fr, 118712.fr).',
  },
  {
    restaurantName: 'Planet Pizza',
    contact: { name: '', phone: '02 32 48 63 69', email: '' },
    notes:
      'Fleury-sur-Andelle (27), 13 rue Emile Parquet — pizzeria à emporter et livraison sur 12 km, site propre planetpizza27.fr, 7 j/7 le soir (source : planetpizza27.fr, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Andelle Pizza',
    contact: { name: 'Jean-Luc Gosselin', phone: '02 32 49 06 50', email: '' },
    notes:
      'Fleury-sur-Andelle (27), 4 bis rue du Sergent Roland Pasquier — pizzas à emporter et livraison, midi et soir sauf dimanche, SIRET actif (source : bottin.fr, hoodspot.fr).',
  },
  {
    restaurantName: 'Crusty Food',
    contact: { name: '', phone: '02 32 48 28 39', email: '' },
    notes:
      'Charleval (27), 56 Grande Rue — l’ex-Allo Pizza rebaptisé : pizzas et sandwichs, livraison 7 j/7 en soirée sur toute la vallée de l’Andelle, de Romilly à Écouis (source : crustyfood.fr, bottin.fr).',
  },
  {
    restaurantName: 'Le Pacha',
    contact: { name: '', phone: '02 77 14 62 49', email: '' },
    notes:
      'Étrépagny (27), 17 rue Georges Clemenceau — kebab 7 j/7 midi et soir ; enseigne à confirmer sur place, les annuaires mêlent Rebei Kebab Zine-King et King Kébab à la même adresse (source : my-kebab.fr, bottin.fr).',
  },
  {
    restaurantName: 'Délices d’Étrépagny',
    contact: { name: '', phone: '02 32 55 58 72', email: '' },
    notes:
      'Étrépagny (27), 7 rue Saint-Maur — kebab et tacos, fermé le lundi (source : kebab-frites.com, tripadvisor.fr).',
  },
  {
    restaurantName: 'O’Royal Kebab Pizza',
    contact: { name: '', phone: '02 32 51 91 92', email: '' },
    notes:
      'Les Andelys (27), 72 rue Marcel Lefèvre — kebab, pizzas et sandwichs, site de commande en ligne ; Restaurant Guru le signale « fermé pour travaux », vérifier la réouverture à l’appel (source : oroyal27.com, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Pizza Max',
    contact: { name: '', phone: '02 32 21 10 10', email: '' },
    notes:
      'Les Andelys (27), 23 rue Marcel Lefèvre — pizzas en livraison 7 j/7 et à emporter, site propre (source : pizzamaxlesandelys.com, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Pizzaland au feu de bois',
    contact: { name: '', phone: '02 32 48 45 91', email: '' },
    notes:
      'Pont-Saint-Pierre (27), 55 Grande Rue — pizzas au feu de bois à emporter, site propre ; avis en ligne anciens, vitalité à jauger à l’appel (source : pizza-pont-st-pierre.fr, societe.com).',
  },
  {
    restaurantName: 'F L’Eure Pizza',
    contact: { name: '', phone: '02 32 51 03 55', email: '' },
    notes:
      'Écouis (27), 4 route de Paris — pizzas artisanales, tacos et burgers, à emporter et livraison, 7 j/7 midi et soir : le profil multi-produits de la caisse (source : pagesjaunes.fr, annuaire-entreprises.data.gouv.fr).',
  },
  {
    restaurantName: 'Délice Pizza — Ry',
    contact: { name: '', phone: '09 81 20 01 14', email: '' },
    notes:
      'Ry (76), 66 Grand’Rue — pizzeria du bourg, 7 j/7 le soir, 4,5/5 sur 77 avis (source : ipizzeria.fr, eat-list.fr).',
  },
  {
    restaurantName: 'Délice Pizza — Buchy',
    contact: { name: '', phone: '02 35 60 52 39', email: '' },
    notes:
      'Buchy (76), 98 rue des Halles — pizzas et kebab, livraison et à emporter, en activité depuis 2011, 7 j/7 le soir ; probablement la même enseigne qu’à Ry (source : pagesjaunes.fr, 118000.fr).',
  },

  // ── Pays de Bray & nord de la Seine-Maritime ──
  {
    restaurantName: 'Pizza Palace Neufchâtel',
    contact: { name: '', phone: '02 79 14 00 77', email: '' },
    notes:
      'Neufchâtel-en-Bray (76) — pizzeria à emporter et livraison du réseau normand Pizza Palace, numéro relevé sur le site du réseau ; à l’adresse historique (14 Grande Rue Notre-Dame) opère désormais Gourmanzza, montée par l’ex-équipe — clarifier à l’appel qui tient quoi (source : pizzapalace.fr).',
  },
  {
    restaurantName: 'Le Divan',
    contact: { name: '', phone: '02 35 93 49 15', email: '' },
    notes:
      'Neufchâtel-en-Bray (76), 15 Grande Rue Notre-Dame — kebab et grillades turques, 7 j/7 en continu 11h-23h, avis positifs ; couverture Uber Eats à vérifier (source : pagesjaunes.fr, kebab-frites.com).',
  },
  {
    restaurantName: 'Mc Kebab Döner',
    contact: { name: '', phone: '02 35 94 67 25', email: '' },
    notes:
      'Aumale (76), 22 rue du Long Pont — le seul kebab documenté du bourg, snack typique du profil (source : justacote.com, yelp.fr).',
  },
  {
    restaurantName: 'Nida Kebab',
    contact: { name: '', phone: '02 32 97 81 49', email: '' },
    notes:
      'Blangy-sur-Bresle (76), 5 rue du Maréchal Leclerc — kebab midi et soir 7 j/7, référencé par l’office de tourisme ; des annuaires le titrent désormais « Resto Bresle », même adresse et même numéro — confirmer l’enseigne à l’appel (source : bottin.fr, tourisme-aumale-blangy.fr).',
  },
  {
    restaurantName: 'Chez Nicolas',
    contact: { name: '', phone: '02 35 60 18 38', email: '' },
    notes:
      'Saint-Saëns (76), 5 place Maintenon — kebab de bourg 7 j/7 midi et soir, 4,3/5 sur plus de 160 votes, accepte les titres-restaurant : l’accroche est toute trouvée (source : pagesjaunes.fr, keskeces.fr).',
  },
  {
    restaurantName: 'Kebab Pizza Venise',
    contact: { name: '', phone: '09 81 13 81 74', email: '' },
    notes:
      'Londinières (76), 1 rue du Pont de Pierre — kebab-pizzeria « Au Venise », mardi-dimanche, 4,2/5 sur 129 avis, référencé sur le site de la commune (source : londinieres.fr, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Adiyaman Kebab',
    contact: { name: '', phone: '09 54 03 53 40', email: '' },
    notes:
      'Tôtes (76), 38 rue Guy de Maupassant — kebab créé en 2022, centre-bourg ; annuaires contradictoires sur son ouverture (PagesJaunes le croit fermé, d’autres non) et aucune radiation au registre — statuer à l’appel (source : pagesjaunes.fr, annuaire-entreprises.data.gouv.fr).',
  },
  {
    restaurantName: 'Oscars’ Food',
    contact: { name: '', phone: '02 35 02 07 57', email: '' },
    notes:
      'Val-de-Scie, Auffay (76), 6 rue Roger Fossé — snack kebab-burgers-paninis-tex-mex, SARL fondée en 2014, 4,5/5, référencé par l’office de tourisme Terroir de Caux (source : terroirdecaux.fr, societe.com).',
  },
  {
    restaurantName: 'Délices Pizza',
    contact: { name: '', phone: '02 35 77 57 16', email: '' },
    notes:
      'Bosc-le-Hard (76), 23 place du Marché — pizzeria à emporter et livraison sur 12 km, 7 j/7 le soir, plus de quinze ans d’activité, appli mobile propre (source : delicespizza.com, trouver-ouvert.fr).',
  },
  {
    restaurantName: 'Le 29 Pizzeria',
    contact: { name: '', phone: '02 76 21 06 73', email: '' },
    notes:
      'Bacqueville-en-Caux (76), 62 place du Général de Gaulle — vente à emporter sur la place centrale, pâte maison, Facebook actif (source : pagesjaunes.fr).',
  },
  {
    restaurantName: 'La Petite Adresse',
    contact: { name: '', phone: '02 35 84 56 96', email: '' },
    notes:
      'Bacqueville-en-Caux (76), 77 place du Général de Gaulle — snack multi-produits : pizzas, burgers, kebabs, tacos ; livraison sur 15 km, site propre et seconde adresse à Tôtes, un mini-réseau local (source : terroirdecaux.fr, lapetiteadresse76.com).',
  },
  {
    restaurantName: 'Pizza Palace Longueville-sur-Scie',
    contact: { name: '', phone: '02 35 50 29 12', email: '' },
    notes:
      'Longueville-sur-Scie (76), 4 rue Pierre Le Verdier — pizzeria à emporter et livraison domicile/bureau, site dédié du réseau (source : pizzapalace.fr, pagesjaunes.fr).',
  },

  // ── Sud de l’Eure & vallées ──
  {
    restaurantName: 'Mc Amine',
    contact: { name: '', phone: '02 32 62 33 65', email: '' },
    notes:
      'Le Neubourg (27), 32 rue du Général de Gaulle — kebab-tacos de centre-bourg, référencé par l’office de tourisme, site propre mcamine.fr, environ 220 avis, 7 j/7 (source : tourisme.paysduneubourg.fr, mcamine.fr).',
  },
  {
    restaurantName: 'Délices de Brionne',
    contact: { name: '', phone: '02 32 46 98 57', email: '' },
    notes:
      'Brionne (27), 5 rue Saint-Denis — kebabs, tacos et sandwichs, à emporter et livraison, fermé le lundi (source : restaurants-de-france.fr, my-kebab.fr).',
  },
  {
    restaurantName: 'Déclic Pizza',
    contact: { name: '', phone: '02 32 38 41 77', email: '' },
    notes:
      'Conches-en-Ouche (27), 1 place Carnot — pizzas artisanales à emporter, livraison gratuite sur 12 km, et un distributeur automatique 24/7 (source : hoodspot.fr, societe.com).',
  },
  {
    restaurantName: 'So’Food',
    contact: { name: '', phone: '09 85 01 00 65', email: '' },
    notes:
      'Verneuil-d’Avre-et-d’Iton (27), 31 rue Porte de Mortagne — snack multi-cartes : pizzas pâte maison, tacos, kebabs, burgers, paninis ; site propre actif — l’entité a changé de SIREN en 2022, l’activité continue (source : sofood-pizza.fr, societe.com).',
  },
  {
    restaurantName: 'Verneuil Kebab',
    contact: { name: '', phone: '09 52 00 22 95', email: '' },
    notes:
      'Verneuil-d’Avre-et-d’Iton (27), 11 rue Aristide Briand — kebab turc de centre-ville, 7 j/7, sur place et à emporter (source : au-magasin.fr, kebab-frites.com).',
  },
  {
    restaurantName: 'Star Kebab',
    contact: { name: '', phone: '02 32 43 10 90', email: '' },
    notes:
      'Bernay (27), 34 rue du Général Leclerc — kebab de la rue principale, 7 j/7 midi et soir ; couverture Uber Eats à vérifier (source : restaurantguru.com, tripadvisor.com).',
  },
  {
    restaurantName: 'Pacy Kebab',
    contact: { name: '', phone: '', email: '' },
    notes:
      'Pacy-sur-Eure (27), 4 rue Aristide Briand — fast-food en activité depuis 2005 (SIRET actif), note Google 4,6 ; aucun téléphone publié trouvé, passer au comptoir (source : annuaire-entreprises.data.gouv.fr, kebab-frites.com).',
  },
  {
    restaurantName: 'Restaurant Breteuil',
    contact: { name: '', phone: '07 69 63 61 67', email: '' },
    notes:
      'Breteuil (27), 16 rue Aristide Briand — kebab-pizzas avec livraison, 4,2/5 sur 128 avis (source : restaurants-de-france.fr, pagesjaunes.fr).',
  },
  {
    restaurantName: 'Halikarnas Kebab',
    contact: { name: '', phone: '02 32 07 05 68', email: '' },
    notes:
      'Mesnils-sur-Iton, Damville (27), 6 place du Vieux Marché — le seul kebab du bourg, midi et soir du lundi au samedi, à emporter (source : menuweb.menu, restaurants-de-france.fr).',
  },
  {
    restaurantName: 'Pizzeria Dolce Vita',
    contact: { name: 'Eric D’Agostino', phone: '02 32 35 10 57', email: '' },
    notes:
      'Rugles (27), 21 rue Aristide Briand — pizzeria en SARL sur la rue principale, mardi-samedi (source : casa-pizza.com, tripadvisor.com).',
  },
  {
    restaurantName: 'L’Anka',
    contact: { name: '', phone: '02 76 12 16 70', email: '' },
    notes:
      'Saint-André-de-l’Eure (27), 20 rue du Chanoine Boulogne — kebab 7 j/7 midi et soir (source : my-kebab.fr, kompass.com).',
  },
  {
    restaurantName: 'L’Arche du Burger',
    contact: { name: '', phone: '07 49 51 25 90', email: '' },
    notes:
      'Pont-de-l’Arche (27), 3 rue du Président Roosevelt — burger artisanal très bien noté (4,9/5 sur environ 90 avis), à emporter et livraison ; proche de l’agglomération de Rouen, couverture Uber Eats à vérifier (source : tripadvisor.com, Facebook).',
  },
  {
    restaurantName: 'Le Bosphore',
    contact: { name: '', phone: '02 32 43 07 41', email: '' },
    notes:
      'Beaumont-le-Roger (27), 1 impasse Saint-Nicolas — kebab du bourg, sur place, à emporter et livraison ; numéro confirmé par l’annuaire inversé (source : annuaire-inverse-france.com, lecointurc.com).',
  },
  {
    restaurantName: 'Istambul Kebab',
    contact: { name: '', phone: '02 32 26 51 55', email: '' },
    notes:
      'Ivry-la-Bataille (27), 5 rue d’Ézy — kebab historique, société active depuis 2002, 7 j/7 de 11h à 23h ; couvre aussi la clientèle d’Ézy-sur-Eure (source : societe.com, cylex-locale.fr).',
  },
  {
    restaurantName: 'O’Regal',
    contact: { name: '', phone: '09 84 03 95 97', email: '' },
    notes:
      'Nonancourt (27), 3 rue Gambetta — kebab-tacos-burger-panini, à emporter, livraison et sur place, mardi-dimanche (source : keskeces.fr, bottin.fr).',
  },
  {
    restaurantName: 'Pizzeria Capri',
    contact: { name: 'Alexandre Grassi', phone: '06 89 22 34 95', email: 'alexandre.grassi@sfr.fr' },
    notes:
      'Cormeilles (27), 15 place du Général de Gaulle — pizzeria au four à bois, vente à emporter, 6 j/7 ; coordonnées publiées sur son propre site (source : pizzeria-capri-cormeilles.fr).',
  },
];

/**
 * Les écritures de l'import, prêtes pour `bulkWrite`.
 *
 * Un upsert `$setOnInsert` par nom d'établissement, et RIEN d'autre : pas de
 * `$set`, donc pas d'écrasement possible — une fiche déjà présente garde son
 * étape, ses relances et ses notes, quoi que dise cette liste. Les horodatages
 * sont posés ici (`timestamps: false` sur l'opération) : sans cela, Mongoose
 * ajouterait `updatedAt` en `$set` et chaque démarrage « rafraîchirait » tous
 * les leads importés — le pipeline, trié par `updatedAt`, mentirait sur ce qui
 * vient de bouger.
 */
export function buildProspectionOps(now: Date = new Date()): AnyBulkWriteOperation<Lead>[] {
  return PROSPECTION_LEADS.map((lead) => ({
    updateOne: {
      filter: { restaurantName: lead.restaurantName },
      update: {
        $setOnInsert: {
          restaurantName: lead.restaurantName,
          contact: lead.contact,
          stage: 'nouveau',
          sequence: null,
          notes: lead.notes,
          founderSeatReserved: false,
          // Vide au sens du document, pas du `DocumentArray` hydraté que le
          // type `Lead` décrit : l'écriture passe par le driver, en POJO.
          touches: [] as unknown as Lead['touches'],
          createdAt: now,
          updatedAt: now,
        },
      },
      upsert: true,
      timestamps: false,
    },
  }));
}
