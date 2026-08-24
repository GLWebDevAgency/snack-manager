import { execFileSync } from 'node:child_process';

/**
 * Trouver l'URL Mongo d'un environnement Railway SANS la demander à personne.
 *
 * Le poste de l'opérateur ne connaît pas les URL de production — c'est
 * précisément ce qu'on veut : elles vivent dans les variables Railway, et la
 * CLI Railway (déjà le canal des workflows `sonde.yml` et `variable.yml`) sait
 * les lire une fois « railway login » + « railway link » faits.
 *
 * Deux pièges que ce module encaisse :
 * - l'URL que consomme l'API (`MONGO_URL`) pointe souvent sur l'hôte INTERNE
 *   (….railway.internal), joignable depuis les conteneurs Railway et de nulle
 *   part ailleurs — depuis un poste, il faut `MONGO_PUBLIC_URL`, le proxy TCP
 *   du service Mongo ;
 * - l'URL publique ne porte pas toujours le CHEMIN de base (le nom de la base
 *   après l'hôte) que l'API, elle, utilise. Écrire dans la mauvaise base
 *   « créerait » un compte que la production ne verrait jamais — on greffe
 *   donc le chemin de l'URL interne sur l'hôte public.
 */

export type Environnement = 'production' | 'staging';

export type CarteVariables = Record<string, string>;

/**
 * Les noms de services d'un `railway status --json`, quelle que soit la forme
 * — la CLI a déjà changé entre un tableau plat et des `edges` façon GraphQL,
 * et un JSON illisible ne doit pas faire tomber la console. On balaie donc le
 * document EN PROFONDEUR et on ramasse tout champ `name` : quelques faux noms
 * de service au pire (un `railway variables` de plus qui échoue en silence),
 * jamais un vrai nom manqué — c'est le manqué qui a coûté au premier essai
 * terrain.
 */
export function extraireNomsServices(statut: unknown): string[] {
  const noms = new Set<string>();
  const parcourir = (valeur: unknown): void => {
    if (Array.isArray(valeur)) {
      for (const element of valeur) parcourir(element);
      return;
    }
    if (valeur === null || typeof valeur !== 'object') return;
    for (const [cle, contenu] of Object.entries(valeur)) {
      if (cle === 'name' && typeof contenu === 'string' && contenu.trim() !== '') {
        noms.add(contenu);
      } else {
        parcourir(contenu);
      }
    }
  };
  parcourir(statut);
  return [...noms];
}

/**
 * Trie les URL Mongo trouvées dans les variables : la première joignable
 * depuis un poste (jamais ….railway.internal), en préférant celle dont le NOM
 * dit « PUBLIC » — c'est le contrat du proxy TCP Railway ; l'interne est
 * gardée à part, pour son chemin de base.
 */
export function classerUrlsMongo(parService: Record<string, CarteVariables>): {
  publique?: string;
  interne?: string;
} {
  const candidates: Array<{ nom: string; valeur: string }> = [];
  let interne: string | undefined;
  for (const variables of Object.values(parService)) {
    for (const [nom, valeur] of Object.entries(variables)) {
      if (typeof valeur !== 'string' || !/^mongodb(\+srv)?:\/\//.test(valeur)) continue;
      if (valeur.includes('.railway.internal')) {
        // Entre deux URL internes, celle qui PORTE un chemin de base gagne :
        // c'est elle (celle de l'API, en pratique) qui dit où l'API lit.
        if (interne === undefined || (cheminDeBase(interne) === '' && cheminDeBase(valeur) !== '')) {
          interne = valeur;
        }
      } else {
        candidates.push({ nom, valeur });
      }
    }
  }
  const publique = (candidates.find((c) => /PUBLIC/i.test(c.nom)) ?? candidates[0])?.valeur;
  return { publique, interne };
}

/**
 * L'URL publique d'un service Mongo SANS `MONGO_PUBLIC_URL` : Railway pose le
 * proxy TCP en deux variables (`RAILWAY_TCP_PROXY_DOMAIN` et `…_PORT`) sur le
 * service — l'essai terrain du 24/08 n'avait QUE ça. On rebâtit l'URL de
 * l'interne en remplaçant l'hôte : identifiants, chemin de base et requête
 * (dont `authSource=admin`, sans lequel Mongo refuse l'utilisateur) suivent.
 */
export function trouverProxyTcp(
  parService: Record<string, CarteVariables>,
): { interne: string; domaine: string; port: string; service: string } | undefined {
  for (const [service, variables] of Object.entries(parService)) {
    const domaine = variables.RAILWAY_TCP_PROXY_DOMAIN;
    const port = variables.RAILWAY_TCP_PROXY_PORT;
    if (!domaine || !port) continue;
    const interne = Object.values(variables).find(
      (valeur) =>
        typeof valeur === 'string' &&
        /^mongodb(\+srv)?:\/\//.test(valeur) &&
        valeur.includes('.railway.internal'),
    );
    if (interne) return { interne, domaine, port, service };
  }
  return undefined;
}

/** L'URL interne, ré-adressée sur le proxy TCP — tout le reste est conservé. */
export function construireUrlProxy(interne: string, domaine: string, port: string): string {
  return interne.replace(
    /^(mongodb(?:\+srv)?:\/\/)(?:([^@/]*)@)?([^/?]+)/,
    (_, scheme: string, identifiants: string | undefined) =>
      `${scheme}${identifiants ? `${identifiants}@` : ''}${domaine}:${port}`,
  );
}

/** Le chemin de base d'une URL Mongo — '' quand elle n'en désigne aucune. */
function cheminDeBase(url: string): string {
  const apresHote = url.replace(/^mongodb(\+srv)?:\/\//, '').replace(/^[^/]*/, '');
  return (apresHote.split('?')[0] ?? '').replace(/\/+$/, '');
}

/**
 * Greffe le chemin de base de l'URL interne sur l'URL publique quand celle-ci
 * n'en a pas : l'API choisit sa base par le chemin de SON URL, et la console
 * doit écrire exactement là où l'API lira.
 */
export function grefferCheminBase(publique: string, interne?: string): string {
  if (cheminDeBase(publique) !== '' || !interne) return publique;
  const base = cheminDeBase(interne);
  if (base === '') return publique;
  const coupure = publique.indexOf('?');
  const [avant, requete] =
    coupure === -1 ? [publique, ''] : [publique.slice(0, coupure), publique.slice(coupure)];
  return avant.replace(/\/+$/, '') + base + requete;
}

/**
 * Greffe la chaîne de requête de l'interne quand la publique n'en a pas —
 * `authSource=admin` en tête : sans lui, Mongo cherche l'utilisateur dans la
 * base du chemin et refuse des identifiants pourtant justes.
 */
export function grefferRequete(publique: string, interne?: string): string {
  if (publique.includes('?') || !interne) return publique;
  const coupure = interne.indexOf('?');
  return coupure === -1 ? publique : publique + interne.slice(coupure);
}

/**
 * L'URL montrable à l'écran : le mot de passe n'apparaît JAMAIS, même
 * tronqué. Le masque est `***` — la forme-gabarit que le garde-fou secrets
 * du dépôt reconnaît comme « pas une valeur réelle » (.github/gitleaks.toml).
 */
export function masquerUrl(url: string): string {
  return url.replace(/^(mongodb(?:\+srv)?:\/\/[^:/@]+:)[^@]+@/, '$1***@');
}

function railway(args: string[]): string {
  try {
    return execFileSync('railway', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  } catch (cause) {
    const erreur = cause as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (erreur.code === 'ENOENT') {
      throw new Error(
        'La CLI Railway est introuvable. Installez-la (npm i -g @railway/cli), puis ' +
          '« railway login » et, depuis ce dossier, « railway link ».',
      );
    }
    const detail = String(erreur.stderr ?? '').trim() || erreur.message;
    throw new Error(
      `La CLI Railway a refusé « railway ${args.join(' ')} » : ${detail}\n` +
        'Avez-vous fait « railway login » puis « railway link » depuis ce dossier ?',
    );
  }
}

/**
 * L'URL Mongo joignable d'un environnement, lue dans les variables Railway.
 * Interroge les services annoncés par `railway status` (avec une liste de
 * repli des noms usuels du modèle Mongo) et rend aussi l'URL masquée, seule
 * forme qui a le droit de s'afficher.
 */
export function resoudreUrlMongo(environnement: Environnement): {
  url: string;
  masquee: string;
  service?: string;
} {
  let annonces: string[] = [];
  try {
    annonces = extraireNomsServices(JSON.parse(railway(['status', '--json'])));
  } catch {
    // Un `status` illisible n'est pas bloquant : la liste de repli suffit.
  }
  const candidats = [...new Set([...annonces, 'MongoDB', 'Mongo', 'mongo', 'mongodb', 'api'])];
  const parService: Record<string, CarteVariables> = {};
  for (const service of candidats) {
    try {
      parService[service] = JSON.parse(
        railway(['variables', '--environment', environnement, '--service', service, '--json']),
      ) as CarteVariables;
    } catch {
      // Service absent de cet environnement : au suivant.
    }
  }
  const { publique, interne } = classerUrlsMongo(parService);
  // 1. Une URL publique publiée telle quelle (MONGO_PUBLIC_URL) ; 2. sinon,
  // le proxy TCP du service Mongo, ré-adressage de l'URL interne — c'est le
  // cas réel rencontré le 24/08, où seule l'interne était publiée.
  const proxy = publique === undefined ? trouverProxyTcp(parService) : undefined;
  const retenue = publique ?? (proxy ? construireUrlProxy(proxy.interne, proxy.domaine, proxy.port) : undefined);
  if (retenue === undefined) {
    if (interne) {
      throw new Error(
        'Seule l’URL Mongo INTERNE (….railway.internal) existe dans les variables — elle est ' +
          'injoignable depuis ce poste, et aucun proxy TCP (RAILWAY_TCP_PROXY_DOMAIN) n’est posé ' +
          'sur le service Mongo. Activez le proxy TCP du service Mongo sur Railway (onglet ' +
          'Settings → Networking), puis relancez.',
      );
    }
    throw new Error(
      `Aucune URL Mongo dans les variables Railway de « ${environnement} ». ` +
        `Services interrogés : ${candidats.join(', ')}.`,
    );
  }
  const url = grefferRequete(grefferCheminBase(retenue, interne), interne);
  const service =
    proxy?.service ??
    Object.entries(parService).find(([, variables]) => Object.values(variables).includes(retenue))?.[0];
  return { url, masquee: masquerUrl(url), service };
}
