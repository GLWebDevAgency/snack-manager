import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

/**
 * La saisie d'un mot de passe d'administration, partagée par les deux
 * scripts qui en manipulent (`set-password.ts`, `create-admin.ts`) : masquée
 * au terminal, jamais en argument, et refusée quand elle est indigne du
 * compte qu'elle protège. Extraite pour que les deux gestes appliquent
 * EXACTEMENT les mêmes règles — deux copies auraient fini par diverger sur
 * la plus sensible.
 */

/** Longueur en dessous de laquelle un mot de passe d'administration ne vaut rien. */
const MIN_LENGTH = 12;

/**
 * Refus des mots de passe construits sur le produit lui-même — c'est la
 * faute historique qu'on répare, pas une coquetterie.
 */
const FORBIDDEN = [/snack/i, /manager/i, /classfood/i, /class.?food/i, /motdepasse/i, /password/i];

/** Saisie masquée — rien ne s'affiche, pas même des étoiles (longueur non révélée). */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const output = stdout as NodeJS.WriteStream & { muted?: boolean };
    const write = output.write.bind(output);
    // On intercepte l'écho du terminal le temps de la saisie.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!output.muted) write(s);
    };
    write(question);
    output.muted = true;
    rl.question('', (answer) => {
      output.muted = false;
      write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

/** `null` si le mot de passe est acceptable, sinon le reproche, en français. */
export function complain(password: string): string | null {
  if (password.length < MIN_LENGTH) {
    return `Trop court : ${MIN_LENGTH} caractères au minimum (celui-ci en fait ${password.length}).`;
  }
  const hit = FORBIDDEN.find((pattern) => pattern.test(password));
  if (hit) {
    return "Ce mot de passe contient le nom du produit ou d'un client : c'est précisément le défaut qu'on corrige.";
  }
  return null;
}
