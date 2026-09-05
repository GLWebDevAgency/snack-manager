import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const controllers = [
  ['devices/devices', 'DevicesController'],
  ['stats/stats', 'StatsController'],
  ['staff/staff', 'StaffController'],
  ['menu/menu', 'MenuController'],
  ['supply/supply', 'SupplyController'],
  ['screens/screens', 'ScreensController'],
  ['loyalty/loyalty', 'LoyaltyController'],
  ['loyalty/loyalty-member', 'LoyaltyMemberController'],
  ['planning/planning', 'PlanningController'],
] as const;

describe('controller initialization in the production CommonJS format', () => {
  it.each(controllers)('%s initializes its runtime imports before its decorators', (path, exportName) => {
    const filename = join(__dirname, `../modules/${path}.controller.ts`);
    const source = readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    } }).outputText;
    // This test isolates execution order. The compiled AppModule smoke separately
    // loads the real dependency graph; no database/provider is started here.
    function decoratorFactory() { return () => undefined; }
    const dependencies = new Proxy({}, { get: () => decoratorFactory });
    const exports: Record<string, unknown> = {};
    expect(() => new Script(compiled, { filename }).runInNewContext({
      exports,
      require: () => dependencies,
    }, { timeout: 1_000 })).not.toThrow();
    expect(typeof exports[exportName]).toBe('function');
  });
});
