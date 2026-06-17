import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: any[] = [];
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerCreate: vi.fn(async (args: any) => { created.push(args); return { content: [], isError: false }; }),
}));
vi.mock('./AppsScriptSheetClient', () => ({ fetchRows: vi.fn() }));
vi.mock('./trackerExists', () => ({ trackerExists: vi.fn(async () => false) }));
vi.mock('../../utils/store', () => ({
  getWorkspaceState: () => ({ googleSheetIntegration: { webAppUrl: 'https://x/exec' } }),
}));

import { importFromSheet, composeBody } from './TrackerSheetImportService';
import * as client from './AppsScriptSheetClient';
import * as exists from './trackerExists';

beforeEach(() => { created.length = 0; vi.clearAllMocks(); (exists.trackerExists as any).mockResolvedValue(false); });

describe('composeBody', () => {
  it('prepends the command/feature line', () => {
    expect(composeBody('Save cmd', 'steps')).toBe('**Affected command / feature:** Save cmd\n\nsteps');
  });
  it('returns description unchanged when empty', () => {
    expect(composeBody('', 'steps')).toBe('steps');
  });
});

describe('importFromSheet', () => {
  it('creates valid rows, skips invalid, composes body', async () => {
    (client.fetchRows as any).mockResolvedValue([
      { rowId: 'r1', type: 'bug', title: 'Crash', commandFeature: 'Save cmd', description: 'steps' },
      { rowId: 'r2', type: 'nonsense', title: 'X', commandFeature: '', description: '' },
      { rowId: 'r3', type: 'task', title: '', commandFeature: '', description: '' },
    ]);
    const result = await importFromSheet('/ws');
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(created[0].type).toBe('bug');
    expect(created[0].description).toContain('**Affected command / feature:** Save cmd');
  });

  it('is idempotent — existing ids are counted as alreadyImported, not re-created', async () => {
    (client.fetchRows as any).mockResolvedValue([
      { rowId: 'r1', type: 'bug', title: 'Crash', commandFeature: '', description: '' },
    ]);
    (exists.trackerExists as any).mockResolvedValue(true);
    const result = await importFromSheet('/ws');
    expect(result.created).toBe(0);
    expect(result.alreadyImported).toBe(1);
    expect(created).toHaveLength(0);
  });
});
