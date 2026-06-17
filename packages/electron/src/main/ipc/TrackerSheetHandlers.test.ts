import { describe, it, expect } from 'vitest';
import { normalizeWebAppUrl } from './TrackerSheetHandlers';

describe('normalizeWebAppUrl', () => {
  it('keeps a plain /exec url', () => {
    expect(normalizeWebAppUrl(' https://script.google.com/a/x/exec ')).toBe('https://script.google.com/a/x/exec');
  });
  it('strips a pasted query string', () => {
    expect(normalizeWebAppUrl('https://x/exec?api=rows&token=z')).toBe('https://x/exec');
  });
});
