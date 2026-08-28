/**
 * ANALYSE STATIQUE DU SERVEUR — l'API et les paquets partagés.
 *
 * Ces six paquets déclaraient `lint: echo ok`. Le web, lui, était réellement
 * analysé. La conséquence s'est vue à l'usage : un import devenu mort après un
 * remaniement passait la CI sans un mot côté serveur, alors que le même défaut
 * était refusé côté navigateur. Une CI verte ne disait donc pas la même chose
 * selon le côté du monorepo — et c'est exactement ce qu'une CI ne doit jamais
 * faire.
 *
 * DÉLIBÉRÉMENT ÉTROITE. Deux règles, pas trente : celles qui attrapent un
 * défaut réel plutôt que celles qui imposent un style. `tsc --noEmit` couvre
 * déjà les types, et une configuration qui produirait deux cents remarques le
 * premier jour serait désactivée le second.
 *
 * `no-console` mérite son exception : dans un script d'administration,
 * `console.log` n'est pas une trace oubliée, c'est l'INTERFACE — le compte
 * rendu que l'opérateur lit pour décider. L'interdire là reviendrait à rendre
 * ces scripts muets. Dans un service qui répond à des requêtes, en revanche,
 * une trace laissée derrière soi part en production et pollue le journal.
 */
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Le défaut le plus fréquent après un remaniement : un import, un type ou
      // une variable qui ne sert plus. Inoffensif isolément, il fait surtout
      // croire à une dépendance qui n'existe plus.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'no-console': 'warn',
    },
  },
  {
    // Les exécutables : leur sortie console EST leur interface.
    // Ciblés par NOM et non par chemin : chaque paquet lance `eslint` depuis
    // son propre répertoire, où le chemin est `src/seed.ts` et non
    // `packages/db/src/seed.ts`. Un glob ancré sur la racine du dépôt n'y
    // correspondrait à rien, et l'exemption serait silencieusement sans effet —
    // c'est le genre de configuration qui a l'air juste et ne fait rien.
    files: [
      '**/seed*.ts',
      '**/backfill-*.ts',
      '**/admin-cli.ts',
      '**/create-admin.ts',
      '**/set-password.ts',
      '**/copy-database.ts',
      '**/purge-test-invoices.ts',
      '**/repair-options.ts',
      '**/migrate.ts',
    ],
    rules: { 'no-console': 'off' },
  },
];
