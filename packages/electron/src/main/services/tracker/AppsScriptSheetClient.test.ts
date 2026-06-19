import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRows } from './AppsScriptSheetClient';

beforeEach(() => vi.restoreAllMocks());

describe('fetchRows', () => {
  it('GETs ?api=rows and returns the rows', async () => {
    const f = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ rows: [{ rowId: 'r1', type: 'bug', title: 'A', commandFeature: '', description: '' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    const rows = await fetchRows('https://script.google.com/x/exec');
    expect(rows).toHaveLength(1);
    expect(String(f.mock.calls[0][0])).toBe('https://script.google.com/x/exec?api=rows');
  });

  it('appends the token when provided', async () => {
    const f = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    await fetchRows('https://x/exec', 'secret');
    expect(String(f.mock.calls[0][0])).toBe('https://x/exec?api=rows&token=secret');
  });

  it('throws when the payload carries an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 200 })));
    await expect(fetchRows('https://x/exec')).rejects.toThrow(/unauthorized/);
  });

  it('rejects when row count exceeds MAX_ROWS', async () => {
    const overLimit = Array.from({ length: 2001 }, (_, i) => ({
      rowId: `r${i}`,
      type: 'bug',
      title: 'T',
      commandFeature: '',
      description: '',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ rows: overLimit }), { status: 200 })),
    );
    await expect(fetchRows('https://x/exec')).rejects.toThrow(/2001 rows.*2000-row import limit/);
  });

  it('truncates description exceeding MAX_DESCRIPTION_LEN', async () => {
    const longDesc = 'x'.repeat(64_001);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ rows: [{ rowId: 'r1', type: 'bug', title: 'T', commandFeature: '', description: longDesc }] }),
            { status: 200 },
          ),
      ),
    );
    const rows = await fetchRows('https://x/exec');
    expect(rows[0].description.length).toBe(64_000);
  });

  it('truncates title exceeding MAX_TITLE_LEN', async () => {
    const longTitle = 'a'.repeat(501);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ rows: [{ rowId: 'r1', type: 'bug', title: longTitle, commandFeature: '', description: '' }] }),
            { status: 200 },
          ),
      ),
    );
    const rows = await fetchRows('https://x/exec');
    expect(rows[0].title.length).toBe(500);
  });

  it('returns a normal small response unchanged', async () => {
    const normalRow = { rowId: 'r1', type: 'feature', title: 'My feature', commandFeature: 'cmd', description: 'Some description' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ rows: [normalRow] }), { status: 200 })),
    );
    const rows = await fetchRows('https://x/exec');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(normalRow);
  });
});
