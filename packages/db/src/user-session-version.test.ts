import { describe, expect, it } from 'vitest';
import { UserSchema } from './schemas';

describe('génération des sessions utilisateur', () => {
  it('persiste une génération historique sûre sans imposer de backfill', () => {
    const path = UserSchema.path('sessionVersion');

    expect(path).toBeDefined();
    expect(path.options.default).toBe('0');
    expect(path.instance).toBe('String');
  });
});
