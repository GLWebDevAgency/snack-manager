import { describe, expect, it } from 'vitest';
import { DIRECTIONS, contraste } from '@sm/contracts';
import { repriseMarque } from './backfill-brand';

describe('la reprise du masque', () => {
  it('un tenant sans brand reçoit Nuit avec son accent et son logo', () => {
    const b = repriseMarque({ brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png' });
    expect(b?.preset).toBe('nuit');
    expect(b?.palette.accent).toBe('#2e9e4f');
    expect(b?.logo.mark.dark).toBe('https://r2/l.png');
    expect(contraste(b!).ok).toBe(true);
  });

  /** L'IDEMPOTENCE : un masque déjà posé n'est JAMAIS recalculé. */
  it('ne touche pas un tenant déjà repris', () => {
    expect(repriseMarque({ brand: DIRECTIONS.soleil, brandColor: '#000000' })).toBeNull();
  });

  it('un accent absent ou invalide retombe sur le laiton', () => {
    expect(repriseMarque({})?.palette.accent).toBe('#c9a15a');
    expect(repriseMarque({ brandColor: 'bleu' })?.palette.accent).toBe('#c9a15a');
  });
});
