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
 * et un JSON illisible ne doit pas faire tomber la console : liste vide, la
 * liste de repli prendra le relais.
 */
export function extraireNomsServices(statut: unknown): string[] {
  const services = (statut as { services?: unknown } | null)?.services;
  const noms = (xs: unknown[]): string[] =>
    xs
      .map((x) => {
        const direct = (x as { name?: unknown }).name;
        const parNoeud = (x as { node?: { name?: unknown } }).node?.name;
        return typeof direct === 'string' ? direct : parNoeud;
      })
      .filter((n): n is string => typeof n === 'string');
  if (Array.isArray(services)) return noms(services);
  const edges = (services as { edges?: unknown } | null)?.edges;
  if (Array.isArray(edges)) return noms(edges);
  return [];
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
      if (valeur.includes('.railway.internal')) interne ??= valeur;
      else candidates.push({ nom, valeur });
    }
  }
  const publique = (candidates.find((c) => /PUBLIC/i.test(c.nom)) ?? candidates[0])?.valeur;
  return { publique, interne };
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
  if (!publique) {
    if (interne) {
      throw new Error(
        'Seule l’URL Mongo INTERNE (….railway.internal) existe dans les variables — elle est ' +
          'injoignable depuis ce poste. Activez le proxy TCP du service Mongo sur Railway ' +
          '(il pose MONGO_PUBLIC_URL), puis relancez.',
      );
    }
    throw new Error(
      `Aucune URL Mongo dans les variables Railway de « ${environnement} ». ` +
        `Services interrogés : ${candidats.join(', ')}.`,
    );
  }
  const url = grefferCheminBase(publique, interne);
  const service = Object.entries(parService).find(([, variables]) =>
    Object.values(variables).includes(publique),
  )?.[0];
  return { url, masquee: masquerUrl(url), service };
}
