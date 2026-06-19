import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: any[] = [];
vi.mock('../../mcp/tools/trackerToolHandlers', () => ({
  handleTrackerCreate: vi.fn(async (args: any) => { created.push(args); return { content: [], isError: false }; }),
}));
vi.mock('./AppsScriptSheetClient', () => ({ fetchRows: vi.fn() }));
vi.mock('./trackerExists', () => ({ findExistingTrackerIds: vi.fn(async () => new Set()) }));
vi.mock('../../utils/store', () => ({
  getWorkspaceState: () => ({
    googleSheetIntegration: { webAppUrl: 'https://x/exec', accessTokenEnc: 'cipher-blob' },
  }),
}));
// Decryption is exercised in sheetTokenCrypto.test.ts; here we just confirm the
// importer feeds the decrypted token to fetchRows.
vi.mock('./sheetTokenCrypto', () => ({ decryptSheetToken: vi.fn(() => 'decrypted-token') }));

import { importFromSheet, composeBody, extractCreateFailureReason } from './TrackerSheetImportService';
import * as client from './AppsScriptSheetClient';
import * as exists from './trackerExists';
import * as handlers from '../../mcp/tools/trackerToolHandlers';
import { deterministicTrackerId } from './sheetRowId';

beforeEach(() => { created.length = 0; vi.clearAllMocks(); (exists.findExistingTrackerIds as any).mockResolvedValue(new Set()); });

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

  it('fetches rows with the decrypted token, not the stored ciphertext', async () => {
    (client.fetchRows as any).mockResolvedValue([]);
    await importFromSheet('/ws');
    expect(client.fetchRows).toHaveBeenCalledWith('https://x/exec', 'decrypted-token');
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
    (exists.findExistingTrackerIds as any).mockImplementation(async (ids: string[]) => new Set(ids));
    const result = await importFromSheet('/ws');
    expect(result.created).toBe(0);
    expect(result.alreadyImported).toBe(1);
    expect(created).toHaveLength(0);
  });

  it('issues a single existence query regardless of row count', async () => {
    const webAppUrl = 'https://x/exec';
    const existingId = deterministicTrackerId(webAppUrl, 'r1');
    (client.fetchRows as any).mockResolvedValue([
      { rowId: 'r1', type: 'bug', title: 'Crash', commandFeature: '', description: '' },
      { rowId: 'r2', type: 'task', title: 'New item', commandFeature: '', description: '' },
      { rowId: 'r3', type: 'nonsense', title: 'X', commandFeature: '', description: '' },
    ]);
    (exists.findExistingTrackerIds as any).mockResolvedValue(new Set([existingId]));
    (handlers.handleTrackerCreate as any).mockResolvedValue({ content: [], isError: false });
    const result = await importFromSheet('/ws');
    expect(exists.findExistingTrackerIds).toHaveBeenCalledTimes(1);
    expect(result.alreadyImported).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  // Cross-workspace collision: two LOCAL workspaces connecting the SAME Google
  // Sheet. Sheet-import ids are deterministic and GLOBAL (deterministicTrackerId
  // hashes `google-sheets:<webAppUrl>:<rowId>`, no workspace) and the pre-import
  // existence check (findExistingTrackerIds) queries tracker_items by id with no
  // workspace filter. So once workspace A imports a row, workspace B's existence
  // check sees that global id and silently counts the row as `alreadyImported` —
  // workspace B can never import the sheet.
  //
  // This is NOT a simple workspace-scoping bug to fix here: bug/task/decision/
  // feature default to sync.mode='shared' and plan to 'hybrid', so the global id
  // is load-bearing — two teammates' machines importing the same upstream row
  // must converge on one row at the server's ON CONFLICT (id) layer. Because
  // sheet-imported items CAN be shared, the correct fix (workspace-scoped URN
  // dedup + sync-policy-aware id derivation) belongs in the importer-registry
  // unification, plan 014. Skipped until then; see plans/006.
  it.skip('cross-workspace collision — resolved by plan 014', async () => {
    (client.fetchRows as any).mockResolvedValue([
      { rowId: 'r1', type: 'bug', title: 'Crash', commandFeature: '', description: '' },
    ]);

    // Model the GLOBAL tracker_items table: keyed by id only, NOT by workspace.
    const globalIds = new Set<string>();
    (exists.findExistingTrackerIds as any).mockImplementation(
      async (ids: string[]) => new Set(ids.filter((id) => globalIds.has(id))),
    );
    (handlers.handleTrackerCreate as any).mockImplementation(async (args: any) => {
      globalIds.add(args.id);
      return { content: [], isError: false };
    });

    // Workspace A imports first and owns the row's global id.
    const a = await importFromSheet('/workspace-a');
    expect(a.created).toBe(1);
    expect(a.alreadyImported).toBe(0);

    // Workspace B imports the SAME sheet. It has never imported this row, but the
    // global existence check sees workspace A's id.
    const b = await importFromSheet('/workspace-b');
    // BUG (today): workspace B is silently swallowed as alreadyImported, created 0.
    expect(b.created).toBe(0);
    expect(b.alreadyImported).toBe(1);
    // Desired post-fix (plan 014): workspace B creates its own workspace-scoped
    // row or surfaces a clear, non-silent outcome — i.e. b.created === 1.
  });
});
