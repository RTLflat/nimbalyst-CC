import { describe, it, expect } from 'vitest';
import { deterministicTrackerId } from './sheetRowId';

describe('deterministicTrackerId', () => {
  it('is stable for the same inputs', () => {
    expect(deterministicTrackerId('src', 'r1')).toBe(deterministicTrackerId('src', 'r1'));
  });
  it('differs for different rows', () => {
    expect(deterministicTrackerId('src', 'r1')).not.toBe(deterministicTrackerId('src', 'r2'));
  });
  it('has the gsheet- prefix', () => {
    expect(deterministicTrackerId('src', 'r1')).toMatch(/^gsheet-[0-9a-f]{32}$/);
  });
});
