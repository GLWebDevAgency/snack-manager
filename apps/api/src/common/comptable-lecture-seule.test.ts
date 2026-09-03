import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LE COMPTABLE NE PEUT ÉCRIRE NULLE PART. Prouvé, pas promis.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── POURQUOI CE CONTRÔLE EXISTE ───
 *
 * `cogerant` est ouvert par SUBSOMPTION : une ligne de données, un point
 * d'application, et rien à oublier. « Lecture seule » ne s'exprime pas ainsi —
 * aucun rôle existant ne signifie « les `@Get` de ce contrôleur, et rien
 * d'autre ». `comptable` est donc AJOUTÉ EXPLICITEMENT, route par route, et la
 * garantie ne peut plus venir du mécanisme : elle doit venir d'un contrôle.
 *
 * Deux façons de perdre la propriété, toutes deux silencieuses :
 *  · un `@Post` ajouté demain sous un contrôleur dont la CLASSE porte déjà
 *    `comptable` — `StatsController` est exactement dans ce cas ;
 *  · un `comptable` ajouté par copier-coller sur un décorateur d'écriture,
 *    parce que la ligne du dessus l'avait.
 *
 * Ce fichier parcourt les contrôleurs et refuse les deux.
 *
 * ─── POURQUOI IL LIT LES SOURCES ET NON LES MÉTADONNÉES ───
 *
 * Lire `Reflect.getMetadata` exigerait d'IMPORTER chaque contrôleur, donc de
 * les énumérer à la main — c'est-à-dire de reproduire ici la liste même qu'on
 * veut surveiller, et d'oublier le contrôleur ajouté demain. Le dossier fait
 * foi : un fichier `*.controller.ts` posé sous `src/` entre dans ce contrôle le
 * jour où il est écrit, sans que personne ait à y penser. C'est le montage déjà
 * employé par `formules-invisibles.test.ts`, et pour le même motif.
 */

const SRC = join(__dirname, '..');

/** Le rôle sous surveillance — écrit une fois, pour que le test se relise. */
const COMPTABLE = 'comptable';

/** Le seul verbe qui ne change rien côté serveur. */
const LECTURE = 'Get';

const VERBES = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'] as const;

/** `@Roles('owner', 'gerant')` en début de ligne — jamais dans un commentaire. */
const LIGNE_ROLES = /^\s*@Roles\(([^)]*)\)/;
/** `@Get('week')`, `@Post()`… en début de ligne. */
const LIGNE_VERBE = new RegExp(`^\\s*@(${VERBES.join('|')})\\(`);
/** La déclaration de classe qui clôt un bloc de décorateurs de classe. */
const LIGNE_CLASSE = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/;

function* controleurs(dir: string): Generator<string> {
  for (const entree of readdirSync(dir, { withFileTypes: true })) {
    const chemin = join(dir, entree.name);
    if (entree.isDirectory()) yield* controleurs(chemin);
    else if (/\.controller\.ts$/.test(entree.name)) yield chemin;
    // Un contrôleur peut vivre dans un fichier de module — `AuditController`
    // est déclaré dans `audit.module.ts`, avec le service qui l'alimente.
    else if (/\.module\.ts$/.test(entree.name) && /@Controller\(/.test(readFileSync(chemin, 'utf8'))) {
      yield chemin;
    }
  }
}

const rolesDeLaLigne = (ligne: string): string[] | null => {
  const trouve = LIGNE_ROLES.exec(ligne);
  if (!trouve) return null;
  return [...trouve[1]!.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
};

/**
 * Les routes d'un fichier, avec les rôles qui les gardent RÉELLEMENT.
 *
 * Le décorateur de méthode l'emporte sur celui de la classe — c'est ce que fait
 * `Reflector.getAllAndOverride` dans `AuthGuard`, et une lecture qui les
 * cumulerait donnerait un verdict que la production ne rend pas.
 */
function routes(fichier: string): { verbe: string; roles: string[]; ligne: number }[] {
  const lignes = readFileSync(fichier, 'utf8').split('\n');
  const trouvees: { verbe: string; roles: string[]; ligne: number }[] = [];
  let rolesClasse: string[] = [];
  let enAttente: string[] | null = null;

  lignes.forEach((ligne, index) => {
    const roles = rolesDeLaLigne(ligne);
    if (roles) {
      enAttente = roles;
      return;
    }
    if (LIGNE_CLASSE.test(ligne)) {
      // Le bloc de décorateurs qui précède une classe appartient à la classe.
      if (enAttente) rolesClasse = enAttente;
      enAttente = null;
      return;
    }
    const verbe = LIGNE_VERBE.exec(ligne);
    if (!verbe) return;
    trouvees.push({ verbe: verbe[1]!, roles: enAttente ?? rolesClasse, ligne: index + 1 });
    enAttente = null;
  });

  return trouvees;
}

describe('le comptable ne touche à rien', () => {
  it('n’est accepté par AUCUNE route qui n’est pas une lecture', () => {
    const fautes: string[] = [];
    for (const fichier of controleurs(SRC)) {
      for (const route of routes(fichier)) {
        if (!route.roles.includes(COMPTABLE)) continue;
        if (route.verbe === LECTURE) continue;
        fautes.push(`${relative(SRC, fichier)}:${route.ligne} — @${route.verbe}`);
      }
    }
    // Le message porte le fichier et la ligne : celui qui vient d'ajouter la
    // route doit savoir laquelle, sans relire tout le contrôleur.
    expect(fautes, `routes en écriture ouvertes au comptable :\n${fautes.join('\n')}`).toEqual([]);
  });

  /**
   * ET IL LIT BIEN CE QU'ON LUI A PROMIS.
   *
   * Le contrôle ci-dessus est un filet : il resterait vert si `comptable`
   * disparaissait de partout — c'est-à-dire sur un rôle devenu inutile. Cette
   * liste-ci est la promesse tenue par l'écran de création (`ROLE_COMPTE_HINTS`)
   * et se lit comme un périmètre, contrôleur par contrôleur.
   */
  it('lit exactement les quatre surfaces de son périmètre', () => {
    const ouvertes = new Map<string, string[]>();
    for (const fichier of controleurs(SRC)) {
      const lues = routes(fichier)
        .filter((r) => r.roles.includes(COMPTABLE))
        .map((r) => r.verbe);
      if (lues.length > 0) ouvertes.set(relative(SRC, fichier).replaceAll('\\', '/'), lues);
    }

    expect([...ouvertes.keys()].sort()).toEqual([
      // Le registre des gestes sensibles : la pièce NF525 qu'il produit au
      // contrôle. `AuditController` vit dans le fichier de son module.
      'modules/audit/audit.module.ts',
      // Le chiffre d'affaires, les canaux, et les deux exports CSV — le
      // fichier qu'il ouvre dans un tableur.
      'modules/stats/stats.controller.ts',
      // L'établissement de la session : sans lui la coque n'a ni nom, ni
      // couleur, ni capacités. Un rôle qui n'ouvre pas l'application n'ouvre
      // rien.
      'modules/tenants/tenants.controller.ts',
    ]);
    // Toutes en lecture, sans exception.
    for (const [fichier, verbes] of ouvertes) {
      expect(new Set(verbes), fichier).toEqual(new Set([LECTURE]));
    }
    // Les FACTURES sont la quatrième surface : elle ne passe pas par `@Roles`
    // mais par `TenantSessionGuard` (le seul garde qui survit à une
    // suspension), dont la liste est épinglée par `roles-subsomption.test.ts`.
    // Ce commentaire existe pour qu'on ne conclue pas de cette liste que le
    // comptable ne voit pas ses factures.
  });

  /** Le balayage doit VOIR quelque chose — un test muet ne prouve rien. */
  it('parcourt bien les contrôleurs de l’API', () => {
    const fichiers = [...controleurs(SRC)];
    expect(fichiers.length).toBeGreaterThan(15);
    const total = fichiers.reduce((n, f) => n + routes(f).length, 0);
    expect(total).toBeGreaterThan(100);
  });
});
