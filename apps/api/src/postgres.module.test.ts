import { describe, expect, it } from 'vitest';
import { postgresPoolMax } from './postgres.module';

describe('budget PostgreSQL partagé', () => {
  it.each([
    [undefined, 10],
    ['', 10],
    ['abc', 10],
    ['0', 10],
    ['101', 10],
    ['8.5', 10],
    ['1', 1],
    ['24', 24],
    [100, 100],
  ])('convertit %p en %i connexions', (raw, expected) => {
    expect(postgresPoolMax(raw)).toBe(expected);
  });
});
