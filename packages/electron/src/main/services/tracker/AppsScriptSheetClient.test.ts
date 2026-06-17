import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRows } from './AppsScriptSheetClient';

beforeEach(() => vi.restoreAllMocks());

describe('fetchRows', () => {
  it('GETs ?api=rows and returns the rows', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ rows: [{ rowId: 'r1', type: 'bug', title: 'A', commandFeature: '', description: '' }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const rows = await fetchRows('https://script.google.com/x/exec');
    expect(rows).toHaveLength(1);
    expect(String(f.mock.calls[0][0])).toBe('https://script.google.com/x/exec?api=rows');
  });

  it('appends the token when provided', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await fetchRows('https://x/exec', 'secret');
    expect(String(f.mock.calls[0][0])).toBe('https://x/exec?api=rows&token=secret');
  });

  it('throws when the payload carries an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200 })));
    await expect(fetchRows('https://x/exec')).rejects.toThrow(/unauthorized/);
  });
});
