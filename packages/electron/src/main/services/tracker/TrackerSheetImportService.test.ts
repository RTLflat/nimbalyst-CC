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

import { importFromSheet, composeBody, extractCreateFailureReason } from './TrackerSheetImportService';
import * as client from './AppsScriptSheetClient';
import * as exists from './trackerExists';
import * as handlers from '../../mcp/tools/trackerToolHandlers';

beforeEach(() => { created.length = 0; vi.clearAllMocks(); (exists.trackerExists as any).mockResolvedValue(false); });

describe('extractCreateFailureReason', () => {
  it('returns the summary field when text is a validation-error JSON string', () => {
    const res = {
      content: [{ text: JSON.stringify({ summary: "tracker_create rejected by tracker schema 'task':\n- priority: required" }) }],
    };
    expect(extractCreateFailureReason(res)).toBe("tracker_create rejected by tracker schema 'task':\n- priority: required");
  });

  it('returns the raw text when text is a plain error string', () => {
    const res = { content: [{ text: 'Error creating tracker item: boom' }] };
    expect(extractCreateFailureReason(res)).toBe('Error creating tracker item: boom');
  });

  it('returns a non-empty fallback when content is missing', () => {
    expect(extractCreateFailureReason({})).toBe('Create failed (no detail)');
    expect(extractCreateFailureReason({ content: [] })).toBe('Create failed (no detail)');
  });
});

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

  it('surfaces the real failure reason from handleTrackerCreate, not the generic string', async () => {
    (client.fetchRows as any).mockResolvedValue([
      { rowId: 'r1', type: 'bug', title: 'Crash', commandFeature: '', description: '' },
    ]);
    (handlers.handleTrackerCreate as any).mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ summary: 'X' }) }],
    });
    const result = await importFromSheet('/ws');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('X');
    expect(result.errors[0].reason).not.toBe('Create failed');
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
