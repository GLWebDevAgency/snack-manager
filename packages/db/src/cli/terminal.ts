import { createInterface, emitKeypressEvents } from 'node:readline';
import { stdin, stdout, exit } from 'node:process';

/**
 * Le kit de terminal de la console d'administration — maison, ~100 lignes.
 *
 * Pourquoi pas inquirer ou prompts : ce paquet touche aux mots de passe de
 * production, et chaque dépendance ajoutée est une surface d'approvisionnement
 * de plus entre le clavier et la base. Un menu aux flèches et deux questions
 * ne valent pas ce risque — on les écrit.
 */

// Couleurs coupées hors terminal ou sous NO_COLOR : la sortie reste lisible
// dans un fichier ou un pipe, sans codes d'échappement qui traînent.
const enCouleurs = stdout.isTTY === true && process.env.NO_COLOR === undefined;
const teinte = (code: string) => (s: string) => (enCouleurs ? `\u001b[${code}m${s}\u001b[0m` : s);

export const gras = teinte('1');
export const gris = teinte('2');
export const rouge = teinte('31');
export const vert = teinte('32');
export const jaune = teinte('33');
export const cyan = teinte('36');

export type Choix<T> = { titre: string; valeur: T; detail?: string };

/**
 * Un menu au clavier : ↑/↓ (ou k/j) pour naviguer, Entrée pour choisir,
 * Ctrl+C pour sortir proprement. Repeint sur place — pas de défilement.
 */
export function choisir<T>(question: string, choix: ReadonlyArray<Choix<T>>): Promise<T> {
  if (!stdin.isTTY) {
    return Promise.reject(
      new Error('Cette console est interactive : lancez-la dans un vrai terminal.'),
    );
  }
  return new Promise((resolve) => {
    let index = 0;
    const lignes = () =>
      choix.map((c, i) => {
        const actif = i === index;
        const puce = actif ? cyan('›') : ' ';
        const titre = actif ? gras(c.titre) : c.titre;
        const detail = c.detail ? `  ${gris(c.detail)}` : '';
        return `  ${puce} ${titre}${detail}`;
      });
    stdout.write(`\n${question}\n${lignes().join('\n')}\n`);
    const repeindre = () => {
      stdout.write(`\u001b[${choix.length}A`);
      for (const ligne of lignes()) stdout.write(`\u001b[2K${ligne}\n`);
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    const finir = () => {
      stdin.off('keypress', surTouche);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const surTouche = (_: string, touche: { name?: string; ctrl?: boolean }) => {
      if (touche.ctrl && touche.name === 'c') {
        finir();
        stdout.write('\n');
        exit(130);
      } else if (touche.name === 'up' || touche.name === 'k') {
        index = (index + choix.length - 1) % choix.length;
        repeindre();
      } else if (touche.name === 'down' || touche.name === 'j') {
        index = (index + 1) % choix.length;
        repeindre();
      } else if (touche.name === 'return' || touche.name === 'enter') {
        const retenu = choix[index];
        if (retenu === undefined) return;
        finir();
        resolve(retenu.valeur);
      }
    };
    stdin.on('keypress', surTouche);
  });
}

/** Une question à réponse visible (adresses, noms — jamais un mot de passe). */
export function demander(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    rl.question(question, (reponse) => {
      rl.close();
      resolve(reponse.trim());
    });
  });
}

/** Oui/non — tout ce qui n'est pas un oui franc vaut non : le refus est le défaut. */
export async function confirmer(question: string): Promise<boolean> {
  const reponse = (await demander(`${question} ${gris('(oui/non)')} `)).toLowerCase();
  return reponse === 'oui' || reponse === 'o';
}
